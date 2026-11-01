import { and, eq, inArray, lte, sql } from "drizzle-orm";
import { z } from "zod";
import { noteIdSchema } from "../../shared/notes.ts";
import { generatedDraftSchema } from "../organize-note.ts";
import type { OrganizeRunState } from "../organize-runs.ts";
import type { openDatabase } from "./connection.ts";
import { storedNote, type StoredNote } from "./notes.ts";
import { notes, organizeRuns } from "./schema.ts";

type Database = ReturnType<typeof openDatabase>["db"];
type Row = typeof organizeRuns.$inferSelect;

const ownerSchema = z.string().min(1);
const runtimeUrlSchema = z.url().refine((value) => {
  const url = new URL(value);
  return (
    !url.username &&
    !url.password &&
    !url.search &&
    !url.hash &&
    (url.protocol === "https:" ||
      (url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)))
  );
});
const terminalSchema = z.union([
  z.strictObject({ status: z.enum(["not_found", "cancelled", "expired"]) }),
  z.strictObject({
    status: z.literal("failed"),
    reason: z.enum(["read_failed", "generation_failed", "invalid_draft"]),
  }),
]);
export type RunTerminalState = z.infer<typeof terminalSchema>;
const stateSchema = z.union([
  z.strictObject({
    status: z.literal("draft"),
    draft: generatedDraftSchema,
    source: z.strictObject({
      noteId: noteIdSchema,
      revision: z.number().int().positive(),
      stale: z.boolean(),
    }),
  }),
  z.strictObject({
    status: z.literal("running"),
    phase: z.enum(["starting", "researching", "writing"]),
  }),
  z.strictObject({ status: z.enum(["not_found", "cancelled", "cleaning", "expired"]) }),
  z.strictObject({
    status: z.literal("failed"),
    reason: z.enum(["cleanup_failed", "read_failed", "generation_failed", "invalid_draft"]),
  }),
]);
const inputSchema = z.strictObject({ title: z.string(), content: z.string() }).nullable();
const runtimeSchema = z
  .strictObject({ sessionId: z.string().min(1), deliveryId: z.string().min(1).nullable() })
  .nullable();

export type OrganizeRunRecord = {
  runId: string;
  ownerId: string;
  noteId: string;
  sourceRevision: number;
  runtimeUrl: string;
  input: z.infer<typeof inputSchema>;
  runtime: z.infer<typeof runtimeSchema>;
  state: OrganizeRunState;
  active: boolean;
  cleanupTarget: RunTerminalState | null;
  expiresAt: number | null;
  updatedAt: number;
};

function fromRow(row: Row): OrganizeRunRecord {
  return {
    runId: row.id,
    ownerId: row.ownerId,
    noteId: row.noteId,
    sourceRevision: row.sourceRevision,
    runtimeUrl: runtimeUrlSchema.parse(row.runtimeUrl),
    input: inputSchema.parse(row.input),
    runtime: runtimeSchema.parse(row.runtime),
    state: stateSchema.parse(row.state),
    active: row.active,
    cleanupTarget: terminalSchema.nullable().parse(row.cleanupTarget),
    expiresAt: row.expiresAt === null ? null : Date.parse(row.expiresAt),
    updatedAt: Date.parse(row.updatedAt),
  };
}

/** Only trusted backend identity reaches this store. Runtime IDs never leave the backend. */
export function createOrganizeRunStore(db: Database) {
  return {
    async claim(
      ownerId: string,
      noteId: string,
      runtimeUrl: string,
    ): Promise<OrganizeRunRecord | undefined> {
      const owner = ownerSchema.parse(ownerId);
      const id = noteIdSchema.parse(noteId);
      const target = runtimeUrlSchema.parse(runtimeUrl);
      return db.transaction(async (tx) => {
        // Serializes claim with note edits/deletion and captures one exact source revision.
        const [note] = await tx
          .select()
          .from(notes)
          .where(and(eq(notes.ownerId, owner), eq(notes.id, id)))
          .for("update");
        if (!note) return undefined;
        const [existing] = await tx
          .select()
          .from(organizeRuns)
          .where(
            and(
              eq(organizeRuns.ownerId, owner),
              eq(organizeRuns.noteId, id),
              eq(organizeRuns.active, true),
            ),
          );
        if (existing) return fromRow(existing);
        const [created] = await tx
          .insert(organizeRuns)
          .values({
            ownerId: owner,
            noteId: id,
            sourceRevision: note.revision,
            runtimeUrl: target,
            input: { title: note.title, content: note.content },
            state: { status: "running", phase: "starting" },
            active: true,
          })
          .returning();
        return fromRow(created);
      });
    },

    async read(ownerId: string, runId: string): Promise<OrganizeRunRecord | undefined> {
      const [row] = await db
        .select()
        .from(organizeRuns)
        .where(
          and(
            eq(organizeRuns.ownerId, ownerSchema.parse(ownerId)),
            eq(organizeRuns.id, noteIdSchema.parse(runId)),
          ),
        );
      return row ? fromRow(row) : undefined;
    },

    /**
     * Serialize short, bounded runtime metadata operations across API instances.
     * Never await generation here. Persist cleanup intent in a preceding transaction
     * before ending a remote session, so a failed commit leaves cleanup retryable.
     */
    async withRun<T>(
      ownerId: string,
      runId: string,
      operate: (
        record: OrganizeRunRecord,
        save: (next: OrganizeRunRecord) => Promise<void>,
        readSource: () => Promise<StoredNote | undefined>,
      ) => Promise<T>,
    ): Promise<T | undefined> {
      const owner = ownerSchema.parse(ownerId);
      const id = noteIdSchema.parse(runId);
      return db.transaction(async (tx) => {
        const scope = and(eq(organizeRuns.ownerId, owner), eq(organizeRuns.id, id));
        const [row] = await tx.select().from(organizeRuns).where(scope).for("update");
        if (!row) return undefined;
        let original = fromRow(row);
        return operate(
          structuredClone(original),
          async (next) => {
            if (
              next.runId !== original.runId ||
              next.ownerId !== original.ownerId ||
              next.noteId !== original.noteId ||
              next.sourceRevision !== original.sourceRevision ||
              next.runtimeUrl !== original.runtimeUrl
            ) {
              throw new Error("Organize run identity and source revision are immutable.");
            }
            if (!original.active && next.active)
              throw new Error("A retired organize run cannot restart.");
            const state = stateSchema.parse(next.state);
            const input = inputSchema.parse(next.input);
            const runtime = runtimeSchema.parse(next.runtime);
            if (input !== null && JSON.stringify(input) !== JSON.stringify(original.input))
              throw new Error("Organize run input is immutable until erased.");
            if (
              runtime !== null &&
              original.runtime !== null &&
              (runtime.sessionId !== original.runtime.sessionId ||
                (original.runtime.deliveryId !== null &&
                  runtime.deliveryId !== original.runtime.deliveryId))
            )
              throw new Error("Organize runtime identity is immutable until erased.");
            if (
              !next.active &&
              (input !== null ||
                runtime !== null ||
                next.cleanupTarget !== null ||
                ["running", "draft", "cleaning"].includes(state.status) ||
                (state.status === "failed" && state.reason === "cleanup_failed"))
            )
              throw new Error("Retired organize runs must contain only terminal metadata.");
            const expiresAt =
              next.expiresAt === null
                ? null
                : new Date(z.number().int().safe().parse(next.expiresAt)).toISOString();
            await tx
              .update(organizeRuns)
              .set({
                input,
                runtime,
                state,
                active: next.active,
                cleanupTarget: terminalSchema.nullable().parse(next.cleanupTarget),
                expiresAt,
                updatedAt: sql`clock_timestamp()`,
              })
              .where(scope);
            original = structuredClone(next);
          },
          async () => {
            const [source] = await tx
              .select()
              .from(notes)
              .where(and(eq(notes.ownerId, owner), eq(notes.id, original.noteId)));
            return source ? storedNote(source) : undefined;
          },
        );
      });
    },

    async pending(limit = 100): Promise<OrganizeRunRecord[]> {
      const count = z.number().int().min(1).max(1000).parse(limit);
      return db.transaction(async (tx) => {
        const rows = await tx
          .select()
          .from(organizeRuns)
          .where(eq(organizeRuns.active, true))
          .orderBy(organizeRuns.updatedAt, organizeRuns.id)
          .limit(count)
          .for("update", { skipLocked: true });
        if (rows.length === 0) return [];
        // Record the attempt before network work so failures cannot starve later records.
        const touched = await tx
          .update(organizeRuns)
          .set({ updatedAt: sql`clock_timestamp()` })
          .where(
            inArray(
              organizeRuns.id,
              rows.map((row) => row.id),
            ),
          )
          .returning();
        return touched
          .sort(
            (left, right) =>
              left.updatedAt.localeCompare(right.updatedAt) || left.id.localeCompare(right.id),
          )
          .map(fromRow);
      });
    },

    async purgeExpired(): Promise<void> {
      await db
        .delete(organizeRuns)
        .where(
          and(eq(organizeRuns.active, false), lte(organizeRuns.expiresAt, sql`clock_timestamp()`)),
        );
    },
  };
}
