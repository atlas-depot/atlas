import { createHash, randomUUID } from "node:crypto";
import { and, eq, gt, lte, sql } from "drizzle-orm";
import { canonicalJson } from "../../shared/document.ts";
import { noteDraftSchema, type NoteDraft } from "../../shared/drafts.ts";
import { noteContentSchema, noteIdSchema } from "../../shared/notes.ts";
import { generatedDraftSchema } from "../../shared/organize.ts";
import type { openDatabase } from "./connection.ts";
import { storedNote, type StoredNote } from "./notes.ts";
import { draftSaveRequests, noteDrafts, notes, organizeRuns } from "./schema.ts";

type Database = ReturnType<typeof openDatabase>["db"];
type Queries = Pick<Database, "select" | "insert" | "update" | "delete">;
type Row = typeof noteDrafts.$inferSelect;
export const DRAFT_RETENTION_MS = 24 * 60 * 60 * 1_000;
export const draftTag = (row: Pick<Row, "id" | "revision">) =>
  JSON.stringify(`draft:${row.id}:${row.revision}`);
const scope = (owner: string, id: string) =>
  and(eq(noteDrafts.ownerId, owner), eq(noteDrafts.id, noteIdSchema.parse(id)));

async function present(db: Queries, row: Row): Promise<NoteDraft> {
  const [source] = await db
    .select({ revision: notes.revision })
    .from(notes)
    .where(and(eq(notes.ownerId, row.ownerId), eq(notes.id, row.sourceNoteId)));
  return noteDraftSchema.parse({
    id: row.id,
    title: row.title,
    content: row.content,
    etag: draftTag(row),
    source: {
      noteId: row.sourceNoteId,
      revision: row.sourceRevision,
      stale: !!source && source.revision !== row.sourceRevision,
      deleted: !source,
    },
    sources: row.sources,
    expiresAt: new Date(row.expiresAt).toISOString(),
    updatedAt: new Date(row.updatedAt).toISOString(),
  });
}

export function createNoteDraftStore(db: Database) {
  const purgeExpired = async () => {
    await db.delete(noteDrafts).where(lte(noteDrafts.expiresAt, sql`clock_timestamp()`));
  };
  return {
    purgeExpired,
    async read(owner: string, id: string): Promise<NoteDraft | undefined> {
      const [row] = await db
        .select()
        .from(noteDrafts)
        .where(and(scope(owner, id), gt(noteDrafts.expiresAt, sql`clock_timestamp()`)));
      return row ? present(db, row) : undefined;
    },
    async list(owner: string): Promise<NoteDraft[]> {
      const rows = await db
        .select()
        .from(noteDrafts)
        .where(and(eq(noteDrafts.ownerId, owner), gt(noteDrafts.expiresAt, sql`clock_timestamp()`)))
        .orderBy(noteDrafts.updatedAt, noteDrafts.id);
      return Promise.all(rows.map((row) => present(db, row)));
    },
    /** The temporary copy and cleanup intent commit together, before any remote deletion. */
    async handoff(
      owner: string,
      id: string,
      now: number,
    ): Promise<{ status: "ready"; draft: NoteDraft } | { status: "not_found" | "not_ready" }> {
      return db.transaction(async (tx) => {
        const [run] = await tx
          .select()
          .from(organizeRuns)
          .where(and(eq(organizeRuns.ownerId, owner), eq(organizeRuns.id, noteIdSchema.parse(id))))
          .for("update");
        if (!run) return { status: "not_found" };
        const [existing] = await tx.select().from(noteDrafts).where(scope(owner, id));
        if (existing)
          return Date.parse(existing.expiresAt) > now
            ? { status: "ready", draft: await present(tx, existing) }
            : { status: "not_found" };
        // A completed handoff removes state.draft, so deleting/expiring a temporary copy
        // can never make a retry recreate it, even when remote cleanup is still pending.
        if (!run.active || run.cleanupTarget || run.state.status !== "draft")
          return { status: "not_ready" };
        if (run.expiresAt && Date.parse(run.expiresAt) <= now) return { status: "not_found" };
        const [source] = await tx
          .select()
          .from(notes)
          .where(and(eq(notes.ownerId, owner), eq(notes.id, run.noteId)))
          .for("share");
        if (!source) return { status: "not_found" };
        const result = generatedDraftSchema.parse(run.state.draft);
        const at = new Date(now).toISOString();
        await tx
          .delete(noteDrafts)
          .where(
            and(
              eq(noteDrafts.ownerId, owner),
              eq(noteDrafts.sourceNoteId, run.noteId),
              lte(noteDrafts.expiresAt, at),
            ),
          );
        const [draft] = await tx
          .insert(noteDrafts)
          .values({
            id,
            ownerId: owner,
            sourceNoteId: run.noteId,
            sourceRevision: run.sourceRevision,
            title: source.title,
            content: result.markdown,
            sources: result.sources,
            expiresAt: new Date(now + DRAFT_RETENTION_MS).toISOString(),
            updatedAt: at,
          })
          .returning();
        await tx
          .update(organizeRuns)
          .set({
            state: { status: "cleaning" },
            cleanupTarget: { status: "expired" },
            input: null,
            expiresAt: null,
            updatedAt: at,
          })
          .where(and(eq(organizeRuns.ownerId, owner), eq(organizeRuns.id, id)));
        return { status: "ready", draft: await present(tx, draft) };
      });
    },
    async update(
      owner: string,
      id: string,
      expected: string,
      input: unknown,
    ): Promise<{ status: "saved"; draft: NoteDraft } | { status: "not_found" | "conflict" }> {
      const data = noteContentSchema.parse(input);
      return db.transaction(async (tx) => {
        const [row] = await tx
          .select()
          .from(noteDrafts)
          .where(and(scope(owner, id), gt(noteDrafts.expiresAt, sql`clock_timestamp()`)))
          .for("update");
        if (!row) return { status: "not_found" };
        if (draftTag(row) !== expected) return { status: "conflict" };
        const [updated] = await tx
          .update(noteDrafts)
          .set({
            ...data,
            revision: sql`${noteDrafts.revision} + 1`,
            updatedAt: sql`clock_timestamp()`,
          })
          .where(scope(owner, id))
          .returning();
        return { status: "saved", draft: await present(tx, updated) };
      });
    },
    async discard(
      owner: string,
      id: string,
      expected: string,
    ): Promise<{ status: "deleted" | "not_found" | "conflict" }> {
      return db.transaction(async (tx) => {
        const [row] = await tx
          .select()
          .from(noteDrafts)
          .where(and(scope(owner, id), gt(noteDrafts.expiresAt, sql`clock_timestamp()`)))
          .for("update");
        if (!row) return { status: "not_found" };
        if (draftTag(row) !== expected) return { status: "conflict" };
        await tx.delete(noteDrafts).where(scope(owner, id));
        return { status: "deleted" };
      });
    },
    async save(
      owner: string,
      id: string,
      expected: string,
      input: unknown,
    ): Promise<
      { status: "saved"; value: StoredNote } | { status: "not_found" | "conflict" | "stale" }
    > {
      const data = noteContentSchema.parse(input);
      const hash = createHash("sha256").update(canonicalJson(data)).digest("hex");
      return db.transaction(
        async (tx) => {
          // Serialize even after the draft row was deleted by an earlier Save. The
          // insert below remains protected by the receipt's unique primary key.
          await tx.execute(
            sql`SELECT pg_advisory_xact_lock(hashtextextended(${`draft:${owner}:${id}`}, 0))`,
          );
          const receiptScope = and(
            eq(draftSaveRequests.ownerId, owner),
            eq(draftSaveRequests.draftId, noteIdSchema.parse(id)),
          );
          const [receipt] = await tx.select().from(draftSaveRequests).where(receiptScope);
          if (receipt) {
            if (receipt.payloadHash !== hash) return { status: "conflict" };
            const [note] = await tx
              .select()
              .from(notes)
              .where(and(eq(notes.ownerId, owner), eq(notes.id, receipt.noteId)))
              .for("share");
            return note && note.revision === 1
              ? { status: "saved", value: storedNote(note) }
              : { status: "conflict" };
          }
          const [draft] = await tx
            .select()
            .from(noteDrafts)
            .where(and(scope(owner, id), gt(noteDrafts.expiresAt, sql`clock_timestamp()`)))
            .for("update");
          if (!draft) return { status: "not_found" };
          if (draftTag(draft) !== expected) return { status: "stale" };
          const noteId = randomUUID();
          const [note] = await tx
            .insert(notes)
            .values({
              ...data,
              id: noteId,
              ownerId: owner,
              origin: {
                sourceNoteId: draft.sourceNoteId,
                sourceRevision: draft.sourceRevision,
                sources: draft.sources,
              },
              createdAt: sql`clock_timestamp()`,
              updatedAt: sql`clock_timestamp()`,
            })
            .returning();
          await tx
            .insert(draftSaveRequests)
            .values({ ownerId: owner, draftId: id, payloadHash: hash, noteId });
          await tx.delete(noteDrafts).where(scope(owner, id));
          return { status: "saved", value: storedNote(note) };
        },
        { isolationLevel: "read committed" },
      );
    },
  };
}
