import { randomUUID } from "node:crypto";
import { and, count, eq, inArray, isNotNull, isNull, lte, or, sql } from "drizzle-orm";
import { z } from "zod";
import { EMBEDDING_FINGERPRINT } from "../../shared/embedding.ts";
import {
  indexClaimSchema,
  indexFailureCodeSchema,
  indexRuntimeUrlSchema,
  type IndexClaim,
  type IndexFailureCode,
  type IndexStatus,
} from "../../shared/index-jobs.ts";
import { noteIdSchema } from "../../shared/notes.ts";
import type { openDatabase } from "./connection.ts";
import { storedNote, type StoredNote } from "./notes.ts";
import { noteIndexes, noteIndexIntents, notePassages, notes } from "./schema.ts";

type Database = ReturnType<typeof openDatabase>["db"];
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Intent = typeof noteIndexIntents.$inferSelect;
const runSchema = z.string().min(1).max(500);
const iso = (value: string | null) => (value === null ? null : new Date(value).toISOString());

/** All writers lock the source before the intent to serialize edit, deletion and publication. */
async function lockedTarget(tx: Transaction, noteId: string) {
  const [note] = await tx.select().from(notes).where(eq(notes.id, noteId)).for("update");
  if (!note) return null;
  const [intent] = await tx
    .select()
    .from(noteIndexIntents)
    .where(eq(noteIndexIntents.noteId, noteId))
    .for("update");
  return intent && intent.revision === note.revision && intent.fingerprint === EMBEDDING_FINGERPRINT
    ? { note, intent }
    : null;
}

function matches(intent: Intent, claim: IndexClaim) {
  return (
    intent.noteId === claim.noteId &&
    intent.revision === claim.revision &&
    intent.fingerprint === claim.fingerprint &&
    intent.claimToken === claim.token &&
    intent.runtimeUrl === claim.runtimeUrl
  );
}

/** Content-free durable intent/claim state. Only bind returns a fresh, locked source snapshot. */
export function createNoteIndexJobs(db: Database) {
  async function modify<T>(
    claim: IndexClaim,
    fallback: T,
    action: (
      tx: Transaction,
      target: NonNullable<Awaited<ReturnType<typeof lockedTarget>>>,
    ) => Promise<T>,
  ) {
    const parsed = indexClaimSchema.parse(claim);
    return db.transaction(async (tx) => {
      const target = await lockedTarget(tx, parsed.noteId);
      return target && matches(target.intent, parsed) ? action(tx, target) : fallback;
    });
  }
  async function claimWithAttempt(
    noteId: string,
    runtimeUrl: string,
  ): Promise<{ claim: IndexClaim; attempts: number } | null> {
    const id = noteIdSchema.parse(noteId);
    const runtime = indexRuntimeUrlSchema.parse(runtimeUrl);
    return db.transaction(async (tx) => {
      const target = await lockedTarget(tx, id);
      if (!target || target.intent.claimToken) return null;
      const token = randomUUID();
      const [row] = await tx
        .update(noteIndexIntents)
        .set({
          claimToken: token,
          runtimeUrl: runtime,
          claimedAt: sql`clock_timestamp()`,
          failureCode: null,
        })
        .where(
          and(
            eq(noteIndexIntents.noteId, id),
            lte(noteIndexIntents.retryAt, sql`clock_timestamp()`),
          ),
        )
        .returning();
      return row
        ? {
            attempts: row.attempts,
            claim: {
              noteId: id,
              revision: row.revision,
              fingerprint: EMBEDDING_FINGERPRINT,
              token,
              runtimeUrl: runtime,
            } satisfies IndexClaim,
          }
        : null;
    });
  }
  return {
    claimWithAttempt,
    async claim(noteId: string, runtimeUrl: string): Promise<IndexClaim | null> {
      return (await claimWithAttempt(noteId, runtimeUrl))?.claim ?? null;
    },
    async bind(claim: IndexClaim, runId: string) {
      const run = runSchema.parse(runId);
      return modify<(StoredNote & { ownerId: string; attempts: number }) | null>(
        claim,
        null,
        async (tx, { note, intent }) => {
          if (intent.runId !== null && (intent.runId !== run || intent.failureCode !== null))
            return null;
          await tx
            .update(noteIndexIntents)
            .set({ runId: run, failureCode: null })
            .where(eq(noteIndexIntents.noteId, note.id));
          return { ...storedNote(note), ownerId: note.ownerId, attempts: intent.attempts };
        },
      );
    },
    async recordRun(claim: IndexClaim, runId: string): Promise<boolean> {
      const run = runSchema.parse(runId);
      return modify(claim, false, async (tx, { intent }) => {
        if (intent.runId !== null && intent.runId !== run) return false;
        await tx
          .update(noteIndexIntents)
          .set({ runId: run })
          .where(eq(noteIndexIntents.noteId, claim.noteId));
        return true;
      });
    },
    async fail(
      claim: IndexClaim,
      runId: string | null,
      code: IndexFailureCode,
      retryAt: Date | null,
    ) {
      const run = runId === null ? null : runSchema.parse(runId);
      const failureCode = indexFailureCodeSchema.parse(code);
      const retry = retryAt === null ? null : z.date().parse(retryAt).toISOString();
      return modify(claim, false, async (tx, { intent }) => {
        if (intent.runId !== run) return false;
        if (intent.failureCode === failureCode && iso(intent.retryAt) === retry) return true;
        // A reconciler may hold a stale snapshot while the worker records its final failure.
        if (intent.failureCode !== null) return false;
        await tx
          .update(noteIndexIntents)
          .set({ failureCode, retryAt: retry, attempts: sql`${noteIndexIntents.attempts} + 1` })
          .where(eq(noteIndexIntents.noteId, claim.noteId));
        return true;
      });
    },
    async release(claim: IndexClaim, runId: string | null): Promise<boolean> {
      const run = runId === null ? null : runSchema.parse(runId);
      return modify(claim, false, async (tx, { intent }) => {
        if (intent.runId !== run) return false;
        const [row] = await tx
          .update(noteIndexIntents)
          .set({
            claimToken: null,
            runtimeUrl: null,
            runId: null,
            claimedAt: null,
          })
          .where(
            and(
              eq(noteIndexIntents.noteId, claim.noteId),
              run === null
                ? lte(noteIndexIntents.claimedAt, sql`clock_timestamp() - interval '2 minutes'`)
                : undefined,
            ),
          )
          .returning({ noteId: noteIndexIntents.noteId });
        return Boolean(row);
      });
    },
    async pending(limit: number) {
      const size = z.number().int().min(1).max(100).parse(limit);
      return db.transaction(async (tx) => {
        const rows = await tx
          .select({
            noteId: noteIndexIntents.noteId,
            revision: noteIndexIntents.revision,
            fingerprint: noteIndexIntents.fingerprint,
            token: noteIndexIntents.claimToken,
            runtimeUrl: noteIndexIntents.runtimeUrl,
            runId: noteIndexIntents.runId,
            claimedAt: noteIndexIntents.claimedAt,
            retryAt: noteIndexIntents.retryAt,
            failureCode: noteIndexIntents.failureCode,
            attempts: noteIndexIntents.attempts,
          })
          .from(noteIndexIntents)
          .innerJoin(
            notes,
            and(
              eq(notes.id, noteIndexIntents.noteId),
              eq(notes.revision, noteIndexIntents.revision),
            ),
          )
          .where(
            and(
              eq(noteIndexIntents.fingerprint, EMBEDDING_FINGERPRINT),
              or(
                isNotNull(noteIndexIntents.claimToken),
                and(
                  isNull(noteIndexIntents.claimToken),
                  lte(noteIndexIntents.retryAt, sql`clock_timestamp()`),
                ),
              ),
            ),
          )
          .orderBy(noteIndexIntents.lastCheckedAt, noteIndexIntents.noteId)
          .limit(size)
          .for("update", { of: noteIndexIntents, skipLocked: true });
        // No source lock is taken here: inspection metadata never waits behind a source writer.
        if (rows.length)
          await tx
            .update(noteIndexIntents)
            .set({ lastCheckedAt: sql`clock_timestamp()` })
            .where(
              inArray(
                noteIndexIntents.noteId,
                rows.map((row) => row.noteId),
              ),
            );
        return rows.map((row) => ({
          ...row,
          claimedAt: iso(row.claimedAt),
          retryAt: iso(row.retryAt),
        }));
      });
    },
    async getStatus(ownerId: string, noteId: string): Promise<IndexStatus | undefined> {
      const owner = z.string().min(1).parse(ownerId);
      const id = noteIdSchema.parse(noteId);
      return db.transaction(async (tx) => {
        const [note] = await tx
          .select({ revision: notes.revision })
          .from(notes)
          .where(and(eq(notes.id, id), eq(notes.ownerId, owner)))
          .for("share");
        if (!note) return undefined;
        const version = JSON.stringify(`${id}:${note.revision}`);
        const [index] = await tx
          .select()
          .from(noteIndexes)
          .where(
            and(
              eq(noteIndexes.noteId, id),
              eq(noteIndexes.revision, note.revision),
              eq(noteIndexes.fingerprint, EMBEDDING_FINGERPRINT),
            ),
          );
        if (index) {
          const [row] = await tx
            .select({ total: count() })
            .from(notePassages)
            .where(eq(notePassages.noteId, id));
          return { status: "ready", version, passageCount: row.total };
        }
        const [intent] = await tx
          .select()
          .from(noteIndexIntents)
          .where(
            and(
              eq(noteIndexIntents.noteId, id),
              eq(noteIndexIntents.revision, note.revision),
              eq(noteIndexIntents.fingerprint, EMBEDDING_FINGERPRINT),
            ),
          );
        if (intent?.failureCode)
          return {
            status: "failed",
            version,
            code: indexFailureCodeSchema.parse(intent.failureCode),
            retryAt: iso(intent.retryAt),
          };
        return { status: intent?.claimToken ? "processing" : "pending", version };
      });
    },
  };
}
