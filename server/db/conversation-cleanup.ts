import { and, asc, eq, lte, sql } from "drizzle-orm";
import { z } from "zod";
import { noteTextSchema } from "../../shared/document.ts";
import { indexRuntimeUrlSchema } from "../../shared/index-jobs.ts";
import type { openDatabase } from "./connection.ts";
import { conversations, conversationTurns, conversationCleanupIntents } from "./schema.ts";

type Database = ReturnType<typeof openDatabase>["db"];
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Runtime = Pick<
  typeof conversationTurns.$inferSelect,
  "conversationId" | "allocationOperationId" | "runtimeUrl" | "sessionId"
>;
const identitySchema = noteTextSchema.min(1).max(512);
const uuidSchema = z.uuid().transform((value) => value.toLowerCase());

class AllocationConflict extends Error {}

function allocationAlreadyClaimed(error: unknown): boolean {
  if (!(error instanceof Error) || !error.cause || typeof error.cause !== "object") return false;
  return (
    "code" in error.cause &&
    error.cause.code === "23505" &&
    "constraint" in error.cause &&
    error.cause.constraint === "conversation_turns_allocation_idx"
  );
}

/** Caller holds the conversation lock, so deletion and runtime binding cannot pass each other. */
export async function enqueueTurnCleanup(tx: Transaction, ownerId: string, runtime: Runtime) {
  if (
    runtime.allocationOperationId === null &&
    runtime.runtimeUrl === null &&
    runtime.sessionId === null
  )
    return;
  if (!runtime.allocationOperationId || !runtime.runtimeUrl) {
    throw new Error("Conversation runtime identity is incomplete.");
  }
  await tx
    .insert(conversationCleanupIntents)
    .values({
      ownerId,
      conversationId: runtime.conversationId,
      allocationOperationId: runtime.allocationOperationId,
      runtimeUrl: runtime.runtimeUrl,
      sessionId: runtime.sessionId,
      lastFailureCode: runtime.sessionId ? null : "allocation_unknown",
    })
    .onConflictDoNothing({ target: conversationCleanupIntents.allocationOperationId });
}

export async function enqueueConversationCleanup(
  tx: Transaction,
  ownerId: string,
  conversationId: string,
) {
  const turns = await tx
    .select()
    .from(conversationTurns)
    .where(eq(conversationTurns.conversationId, conversationId));
  for (const turn of turns) await enqueueTurnCleanup(tx, ownerId, turn);
  await tx
    .update(conversationCleanupIntents)
    .set({ retryAt: sql`now()` })
    .where(
      and(
        eq(conversationCleanupIntents.ownerId, ownerId),
        eq(conversationCleanupIntents.conversationId, conversationId),
      ),
    );
}

/** Internal runtime bookkeeping. No method performs or claims an external retirement itself. */
export function createConversationCleanupStore(db: Database) {
  return {
    async expedite(owner: string, conversationId: string) {
      await db
        .update(conversationCleanupIntents)
        .set({ retryAt: sql`now()` })
        .where(
          and(
            eq(conversationCleanupIntents.ownerId, owner),
            eq(conversationCleanupIntents.conversationId, conversationId),
          ),
        );
      return db
        .select()
        .from(conversationCleanupIntents)
        .where(
          and(
            eq(conversationCleanupIntents.ownerId, owner),
            eq(conversationCleanupIntents.conversationId, conversationId),
          ),
        )
        .limit(100);
    },
    /** Late receipts can only bind an existing intent, never recreate conversation data. */
    async bindIntent(allocationOperationId: string, sessionId: string) {
      const bound = await db
        .update(conversationCleanupIntents)
        .set({ sessionId: identitySchema.parse(sessionId) })
        .where(
          and(
            eq(
              conversationCleanupIntents.allocationOperationId,
              uuidSchema.parse(allocationOperationId),
            ),
            sql`(${conversationCleanupIntents.sessionId} IS NULL OR ${conversationCleanupIntents.sessionId} = ${sessionId})`,
          ),
        )
        .returning();
      return bound.length === 1;
    },
    async prepareRuntime(
      ownerId: string,
      conversationId: string,
      turnId: string,
      input: { allocationOperationId: string; runtimeUrl: string },
    ) {
      const owner = identitySchema.parse(ownerId);
      const id = uuidSchema.parse(conversationId);
      const turnKey = uuidSchema.parse(turnId);
      const allocation = uuidSchema.parse(input.allocationOperationId);
      const runtimeUrl = indexRuntimeUrlSchema.parse(input.runtimeUrl);
      try {
        return await db.transaction(async (tx) => {
          const [parent] = await tx
            .select()
            .from(conversations)
            .where(and(eq(conversations.id, id), eq(conversations.ownerId, owner)))
            .for("update");
          if (!parent) return { status: "not_found" as const };
          const [turn] = await tx
            .select()
            .from(conversationTurns)
            .where(
              and(eq(conversationTurns.id, turnKey), eq(conversationTurns.conversationId, id)),
            );
          if (!turn) return { status: "not_found" as const };
          if (turn.status !== "running") return { status: "conflict" as const };
          const cleanupScope = eq(conversationCleanupIntents.allocationOperationId, allocation);
          const [intent] = await tx
            .select({ id: conversationCleanupIntents.allocationOperationId })
            .from(conversationCleanupIntents)
            .where(cleanupScope);
          if (intent) return { status: "conflict" as const };
          if (turn.allocationOperationId) {
            return {
              status:
                turn.allocationOperationId === allocation && turn.runtimeUrl === runtimeUrl
                  ? ("prepared" as const)
                  : ("conflict" as const),
            };
          }
          await tx
            .update(conversationTurns)
            .set({ allocationOperationId: allocation, runtimeUrl })
            .where(eq(conversationTurns.id, turnKey));
          // The unique allocation check can wait for deletion of an older turn. Recheck in a
          // new Read Committed statement so its committed cleanup intent cannot be reused.
          const [lateIntent] = await tx
            .select({ id: conversationCleanupIntents.allocationOperationId })
            .from(conversationCleanupIntents)
            .where(cleanupScope);
          if (lateIntent) throw new AllocationConflict();
          return { status: "prepared" as const };
        });
      } catch (error) {
        if (error instanceof AllocationConflict || allocationAlreadyClaimed(error)) {
          return { status: "conflict" as const };
        }
        throw error;
      }
    },

    /** A late allocation response attaches to the surviving cleanup intent after deletion. */
    async bindRuntime(
      ownerId: string,
      conversationId: string,
      turnId: string,
      allocationOperationId: string,
      sessionId: string,
    ) {
      const owner = identitySchema.parse(ownerId);
      const id = uuidSchema.parse(conversationId);
      const turnKey = uuidSchema.parse(turnId);
      const allocation = uuidSchema.parse(allocationOperationId);
      const session = identitySchema.parse(sessionId);
      return db.transaction(async (tx) => {
        const [parent] = await tx
          .select()
          .from(conversations)
          .where(and(eq(conversations.id, id), eq(conversations.ownerId, owner)))
          .for("update");
        const intentScope = and(
          eq(conversationCleanupIntents.allocationOperationId, allocation),
          eq(conversationCleanupIntents.ownerId, owner),
          eq(conversationCleanupIntents.conversationId, id),
        );
        const [intent] = await tx
          .select()
          .from(conversationCleanupIntents)
          .where(intentScope)
          .for("update");
        if (!parent && !intent) return { status: "not_found" as const };
        if (intent?.sessionId && intent.sessionId !== session)
          return { status: "conflict" as const };
        let running = false;
        if (parent) {
          const [turn] = await tx
            .select()
            .from(conversationTurns)
            .where(
              and(
                eq(conversationTurns.id, turnKey),
                eq(conversationTurns.conversationId, id),
                eq(conversationTurns.allocationOperationId, allocation),
              ),
            );
          if (!turn) return { status: "not_found" as const };
          if (turn.sessionId && turn.sessionId !== session) return { status: "conflict" as const };
          running = turn.status === "running";
          await tx
            .update(conversationTurns)
            .set({ sessionId: session })
            .where(eq(conversationTurns.id, turnKey));
          if (!running && !intent)
            await enqueueTurnCleanup(tx, owner, { ...turn, sessionId: session });
        }
        if (intent)
          await tx
            .update(conversationCleanupIntents)
            .set({ sessionId: session, lastFailureCode: null, retryAt: sql`now()` })
            .where(intentScope);
        return { status: running && !intent ? ("bound" as const) : ("cleanup_pending" as const) };
      });
    },

    async pending(limit = 50) {
      const size = z.number().int().min(1).max(100).parse(limit);
      return db
        .select()
        .from(conversationCleanupIntents)
        .where(lte(conversationCleanupIntents.retryAt, sql`now()`))
        .orderBy(
          asc(conversationCleanupIntents.retryAt),
          asc(conversationCleanupIntents.allocationOperationId),
        )
        .limit(size);
    },

    async recordFailure(
      allocationOperationId: string,
      code: "allocation_unknown" | "cleanup_failed",
      retryAt: string,
    ) {
      await db
        .update(conversationCleanupIntents)
        .set({
          attempts: sql`${conversationCleanupIntents.attempts} + 1`,
          lastFailureCode: z.enum(["allocation_unknown", "cleanup_failed"]).parse(code),
          retryAt: z.iso.datetime().parse(retryAt),
        })
        .where(
          eq(
            conversationCleanupIntents.allocationOperationId,
            uuidSchema.parse(allocationOperationId),
          ),
        );
    },

    /** Call only after the runtime adapter verifies retirement of this exact known session. */
    async confirmRetired(allocationOperationId: string, sessionId: string): Promise<boolean> {
      const deleted = await db
        .delete(conversationCleanupIntents)
        .where(
          and(
            eq(
              conversationCleanupIntents.allocationOperationId,
              uuidSchema.parse(allocationOperationId),
            ),
            eq(conversationCleanupIntents.sessionId, identitySchema.parse(sessionId)),
          ),
        )
        .returning({ id: conversationCleanupIntents.allocationOperationId });
      return deleted.length === 1;
    },
  };
}
