import { createHash, randomUUID } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { noteOriginSchema } from "../../shared/organize.ts";
import { canonicalJson, documentContentSchema } from "../../shared/document.ts";
import {
  createNoteKeySchema,
  createNoteSchema,
  noteIdSchema,
  updateNoteSchema,
  type Note,
} from "../../shared/notes.ts";
import type { openDatabase } from "./connection.ts";
import { noteCreateRequests, notes } from "./schema.ts";
import { requestNoteIndex } from "./note-index-intents.ts";

type Database = ReturnType<typeof openDatabase>["db"];
type Row = typeof notes.$inferSelect;

export type StoredNote = { note: Note; revision: number };
export type NoteWriteResult =
  | { status: "saved"; value: StoredNote }
  | { status: "not_found" }
  | { status: "conflict" };

const revisionSchema = z.number().int().positive().max(2_147_483_647);
const ownerSchema = z.string().min(1);

export function storedNote(row: Row): StoredNote {
  return {
    note: {
      id: row.id,
      title: row.title,
      content: documentContentSchema.parse(row.content),
      ...(row.origin ? { origin: noteOriginSchema.parse(row.origin) } : {}),
      createdAt: new Date(row.createdAt).toISOString(),
      updatedAt: new Date(row.updatedAt).toISOString(),
    },
    revision: row.revision,
  };
}

/** ownerId must come from verified server identity, never from request JSON. */
export function createNoteStore(db: Database) {
  return {
    async create(ownerId: string, input: unknown): Promise<StoredNote> {
      const owner = ownerSchema.parse(ownerId);
      const data = createNoteSchema.parse(input);
      return db.transaction(async (tx) => {
        const [row] = await tx
          .insert(notes)
          .values({ ...data, ownerId: owner, updatedAt: data.createdAt })
          .returning();
        await requestNoteIndex(tx, row);
        return storedNote(row);
      });
    },

    async createIdempotent(
      ownerId: string,
      key: string,
      input: unknown,
    ): Promise<{ status: "saved"; value: StoredNote } | { status: "conflict" }> {
      const owner = ownerSchema.parse(ownerId);
      const creationKey = createNoteKeySchema.parse(key);
      const data = createNoteSchema.parse(input);
      const payloadHash = createHash("sha256")
        .update(canonicalJson([data.title, data.content, data.createdAt]))
        .digest("hex");
      return db.transaction(
        async (tx) => {
          const noteId = randomUUID();
          const [inserted] = await tx
            .insert(noteCreateRequests)
            .values({ ownerId: owner, key: creationKey, payloadHash, noteId })
            .onConflictDoNothing({ target: [noteCreateRequests.ownerId, noteCreateRequests.key] })
            .returning({ noteId: noteCreateRequests.noteId });
          if (inserted) {
            const [row] = await tx
              .insert(notes)
              .values({ ...data, id: noteId, ownerId: owner, updatedAt: data.createdAt })
              .returning();
            await requestNoteIndex(tx, row);
            return { status: "saved", value: storedNote(row) };
          }

          // A separate Read Committed statement sees a concurrent insert's committed receipt.
          const [receipt] = await tx
            .select()
            .from(noteCreateRequests)
            .where(
              and(eq(noteCreateRequests.ownerId, owner), eq(noteCreateRequests.key, creationKey)),
            );
          if (!receipt || receipt.payloadHash !== payloadHash) return { status: "conflict" };
          const [row] = await tx
            .select()
            .from(notes)
            .where(and(eq(notes.ownerId, owner), eq(notes.id, receipt.noteId)))
            .for("share");
          // Do not retain or reconstruct an earlier content snapshot after edits or deletion.
          if (!row || row.revision !== 1) return { status: "conflict" };
          return { status: "saved", value: storedNote(row) };
        },
        { isolationLevel: "read committed" },
      );
    },

    async list(ownerId: string): Promise<Note[]> {
      const rows = await db
        .select()
        .from(notes)
        .where(eq(notes.ownerId, ownerSchema.parse(ownerId)))
        .orderBy(desc(notes.updatedAt), notes.id);
      return rows.map((row) => storedNote(row).note);
    },

    async read(ownerId: string, id: string): Promise<StoredNote | undefined> {
      const [row] = await db
        .select()
        .from(notes)
        .where(
          and(eq(notes.ownerId, ownerSchema.parse(ownerId)), eq(notes.id, noteIdSchema.parse(id))),
        );
      return row ? storedNote(row) : undefined;
    },

    async update(
      ownerId: string,
      id: string,
      expectedRevision: number,
      input: unknown,
    ): Promise<NoteWriteResult> {
      const owner = ownerSchema.parse(ownerId);
      const noteId = noteIdSchema.parse(id);
      const expected = revisionSchema.parse(expectedRevision);
      const data = updateNoteSchema.parse(input);
      return db.transaction(async (tx) => {
        const scope = and(eq(notes.ownerId, owner), eq(notes.id, noteId));
        const [current] = await tx.select().from(notes).where(scope).for("update");
        if (!current) return { status: "not_found" };
        if (current.revision !== expected) return { status: "conflict" };
        const [row] = await tx
          .update(notes)
          .set({ ...data, updatedAt: sql`clock_timestamp()`, revision: sql`${notes.revision} + 1` })
          .where(and(scope, eq(notes.revision, expected)))
          .returning();
        await requestNoteIndex(tx, row);
        return { status: "saved", value: storedNote(row) };
      });
    },

    async delete(
      ownerId: string,
      id: string,
      expectedRevision: number,
    ): Promise<{ status: "deleted" | "not_found" | "conflict" }> {
      const owner = ownerSchema.parse(ownerId);
      const noteId = noteIdSchema.parse(id);
      const expected = revisionSchema.parse(expectedRevision);
      return db.transaction(async (tx) => {
        const scope = and(eq(notes.ownerId, owner), eq(notes.id, noteId));
        const [current] = await tx.select().from(notes).where(scope).for("update");
        if (!current) return { status: "not_found" };
        if (current.revision !== expected) return { status: "conflict" };
        await tx.delete(notes).where(and(scope, eq(notes.revision, expected)));
        return { status: "deleted" };
      });
    },
  };
}
