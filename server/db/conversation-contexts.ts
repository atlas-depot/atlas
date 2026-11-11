import { randomUUID } from "node:crypto";
import { and, asc, eq, gt, inArray, lte, sql } from "drizzle-orm";
import { z } from "zod";
import {
  byteSize,
  compactionInputSchema,
  contextMessagesSchema,
  CONTEXT_LIMITS,
  mergeDependencies,
  sourceDependenciesSchema,
  splitContext,
  summaryResultSchema,
  type ContextMessage,
  type ContextRecovery,
  type SourceDependency,
} from "../conversation-context.ts";
import type { openDatabase } from "./connection.ts";
import { lockOwnedConversation, type ConversationTransaction } from "./conversation-publication.ts";
import {
  conversationCleanupIntents,
  conversationContexts,
  conversationMessages,
  conversationSummaries,
  conversationTurnInputs,
  conversationTurns,
  conversations,
} from "./conversation-schema.ts";
import { notes } from "./schema.ts";
import { noteTag } from "./notes.ts";
import { enqueueTurnCleanup } from "./conversation-cleanup.ts";

type Database = ReturnType<typeof openDatabase>["db"];
type Context = typeof conversationContexts.$inferSelect;

/** All source locks precede the conversation lock, including for uncited evidence. */
export async function lockContextSources(
  tx: ConversationTransaction,
  owner: string,
  sources: SourceDependency[],
) {
  const ids = [...new Set(sources.map((source) => source.noteId))].sort();
  if (ids.length === 0) return true;
  const available = await tx
    .select({ id: notes.id })
    .from(notes)
    .where(and(inArray(notes.id, ids), eq(notes.ownerId, owner)))
    .orderBy(asc(notes.id))
    .for("share");
  return available.length === ids.length;
}

/** Note mutations already hold the source lock. Preserve UI answers, erase derived context. */
export async function invalidateSourceContext(tx: ConversationTransaction, noteId: string) {
  const affected = sql`${conversationContexts.sources} @> ${JSON.stringify([{ noteId }])}::jsonb`;
  const rows = await tx
    .select({
      context: {
        turnId: conversationContexts.turnId,
        conversationId: conversationContexts.conversationId,
        operationId: conversationContexts.operationId,
      },
      owner: conversations.ownerId,
    })
    .from(conversationContexts)
    .innerJoin(conversations, eq(conversations.id, conversationContexts.conversationId))
    .where(affected)
    .orderBy(asc(conversations.id), asc(conversationContexts.turnId));
  for (const { context, owner } of rows) {
    const parent = await lockOwnedConversation(tx, owner, context.conversationId);
    if (!parent) continue;
    const [turn] = await tx
      .select()
      .from(conversationTurns)
      .where(eq(conversationTurns.id, context.turnId));
    if (turn?.status === "running") await enqueueTurnCleanup(tx, owner, turn);
    await tx
      .update(conversationCleanupIntents)
      .set({ retryAt: sql`now()` })
      .where(eq(conversationCleanupIntents.allocationOperationId, context.operationId));
  }
  await tx
    .update(conversationContexts)
    .set({ state: "recovery", recent: [], summary: null, summaryInput: null })
    .where(affected);
  await tx
    .delete(conversationSummaries)
    .where(sql`${conversationSummaries.sources} @> ${JSON.stringify([{ noteId }])}::jsonb`);
}

function validContext(context: Context): boolean {
  let validInput = context.summaryInput === null;
  if (context.summaryInput !== null) {
    try {
      validInput = compactionInputSchema.safeParse(JSON.parse(context.summaryInput)).success;
    } catch {
      validInput = false;
    }
  }
  return (
    validInput &&
    context.throughSequence >= 0 &&
    sourceDependenciesSchema.safeParse(context.sources).success &&
    z.array(z.uuid()).max(CONTEXT_LIMITS.historyMessages).safeParse(context.deferredInputIds)
      .success &&
    contextMessagesSchema.safeParse(context.recent).success &&
    byteSize(context.recent) <= CONTEXT_LIMITS.recentBytes &&
    (context.summary === null
      ? context.state !== "ready" || context.throughSequence === 0
      : summaryResultSchema.safeParse({ summary: context.summary }).success) &&
    (context.summaryInput === null ||
      byteSize(context.summaryInput) <= CONTEXT_LIMITS.reconstructionBytes)
  );
}

/** Durable snapshots prevent a reconnect from changing a delivery's prompt or summary job. */
export function createConversationContextStore(db: Database) {
  async function recover(
    owner: string,
    conversationId: string,
    turnId: string,
    code: ContextRecovery,
  ) {
    return db.transaction(async (tx) => {
      const parent = await lockOwnedConversation(tx, owner, conversationId);
      if (!parent) return;
      await tx
        .update(conversationTurns)
        .set({ contextRecovery: sql`coalesce(${conversationTurns.contextRecovery}, ${code})` })
        .where(
          and(
            eq(conversationTurns.id, turnId),
            eq(conversationTurns.conversationId, parent.id),
            eq(conversationTurns.status, "running"),
          ),
        );
      const [context] = await tx
        .update(conversationContexts)
        .set({ state: "recovery", summary: null, summaryInput: null, recent: [] })
        .where(eq(conversationContexts.turnId, turnId))
        .returning();
      if (context)
        await tx
          .update(conversationCleanupIntents)
          .set({ retryAt: sql`now()` })
          .where(eq(conversationCleanupIntents.allocationOperationId, context.operationId));
    });
  }

  async function existing(owner: string, conversationId: string, turnId: string) {
    const [row] = await db
      .select({ context: conversationContexts })
      .from(conversationContexts)
      .innerJoin(conversations, eq(conversations.id, conversationContexts.conversationId))
      .where(
        and(
          eq(conversations.ownerId, owner),
          eq(conversations.id, conversationId),
          eq(conversationContexts.turnId, turnId),
        ),
      );
    if (row && !validContext(row.context)) {
      await recover(owner, conversationId, turnId, "history_unavailable");
      return {
        ...row.context,
        state: "recovery" as const,
        recent: [],
        summary: null,
        summaryInput: null,
      };
    }
    return row?.context;
  }

  return {
    recover,
    async summaryAuthorized(sessionId: string) {
      const rows = await db
        .select({ sources: conversationContexts.sources, owner: conversations.ownerId })
        .from(conversationContexts)
        .innerJoin(conversations, eq(conversations.id, conversationContexts.conversationId))
        .innerJoin(conversationTurns, eq(conversationTurns.id, conversationContexts.turnId))
        .innerJoin(
          conversationCleanupIntents,
          eq(conversationCleanupIntents.allocationOperationId, conversationContexts.operationId),
        )
        .where(
          and(
            eq(conversationContexts.sessionId, sessionId),
            eq(conversationContexts.state, "summarizing"),
            eq(conversationTurns.status, "running"),
            gt(conversationCleanupIntents.retryAt, sql`now()`),
          ),
        )
        .limit(2);
      const row = rows.length === 1 ? rows[0] : undefined;
      return (
        !!row &&
        db.transaction((tx) =>
          lockContextSources(tx, row.owner, sourceDependenciesSchema.parse(row.sources)),
        )
      );
    },
    async prepare(owner: string, conversationId: string, turnId: string, runtimeUrl: string) {
      const saved = await existing(owner, conversationId, turnId);
      if (saved) {
        if (
          saved.state !== "recovery" &&
          !(await db.transaction((tx) => lockContextSources(tx, owner, saved.sources)))
        ) {
          await recover(owner, conversationId, turnId, "source_changed");
          return undefined;
        }
        return saved;
      }
      // Read a bounded candidate without locks. Recheck its watermark under locks before save.
      const [parent] = await db
        .select()
        .from(conversations)
        .where(and(eq(conversations.id, conversationId), eq(conversations.ownerId, owner)));
      if (!parent) return undefined;
      const [checkpoint] = await db
        .select()
        .from(conversationSummaries)
        .where(eq(conversationSummaries.conversationId, conversationId));
      if (
        checkpoint &&
        (!summaryResultSchema.safeParse({ summary: checkpoint.text }).success ||
          !sourceDependenciesSchema.safeParse(checkpoint.sources).success ||
          !Number.isSafeInteger(checkpoint.throughSequence) ||
          checkpoint.throughSequence < 1 ||
          checkpoint.throughSequence >= parent.nextSequence ||
          !z
            .array(z.uuid())
            .max(CONTEXT_LIMITS.historyMessages)
            .safeParse(checkpoint.deferredInputIds).success)
      ) {
        await recover(owner, conversationId, turnId, "history_unavailable");
        return undefined;
      }
      const after = checkpoint?.throughSequence ?? 0;
      const rows = await db
        .select({ message: conversationMessages, turn: conversationTurns })
        .from(conversationMessages)
        .leftJoin(conversationTurns, eq(conversationTurns.id, conversationMessages.turnId))
        .where(
          and(
            eq(conversationMessages.conversationId, conversationId),
            gt(conversationMessages.sequence, after),
            lte(conversationMessages.sequence, parent.nextSequence - 1),
          ),
        )
        .orderBy(asc(conversationMessages.sequence))
        .limit(CONTEXT_LIMITS.historyMessages + 1);
      if (
        rows.length > CONTEXT_LIMITS.historyMessages ||
        rows.some(({ message }, i) => message.sequence !== after + i + 1) ||
        (rows.at(-1)?.message.sequence ?? after) !== parent.nextSequence - 1
      ) {
        await recover(owner, conversationId, turnId, "history_unavailable");
        return undefined;
      }
      // A queued input can precede an older answer in UI order. A checkpoint must not lose
      // that input merely because it was still the current/pending question when compacted.
      const deferred = checkpoint?.deferredInputIds.length
        ? await db
            .select({ message: conversationMessages, turn: conversationTurns })
            .from(conversationMessages)
            .leftJoin(conversationTurns, eq(conversationTurns.id, conversationMessages.turnId))
            .where(
              and(
                eq(conversationMessages.conversationId, conversationId),
                inArray(conversationMessages.id, checkpoint.deferredInputIds),
              ),
            )
        : [];
      if (
        deferred.length !== (checkpoint?.deferredInputIds.length ?? 0) ||
        deferred.some(({ message }) => message.role !== "user" || message.sequence > after)
      ) {
        await recover(owner, conversationId, turnId, "history_unavailable");
        return undefined;
      }
      rows.unshift(...deferred);
      rows.sort((a, b) => a.message.sequence - b.message.sequence);
      if (rows.length > CONTEXT_LIMITS.historyMessages) {
        await recover(owner, conversationId, turnId, "history_unavailable");
        return undefined;
      }
      const consumed = await db
        .select({ id: conversationTurnInputs.messageId })
        .from(conversationTurnInputs)
        .where(
          and(
            eq(conversationTurnInputs.conversationId, conversationId),
            inArray(
              conversationTurnInputs.messageId,
              rows.map(({ message }) => message.id),
            ),
            sql`${conversationTurnInputs.turnId} <> ${turnId}`,
          ),
        );
      const consumedIds = new Set(consumed.map(({ id }) => id));
      const currentInputs = await db
        .select({ id: conversationTurnInputs.messageId })
        .from(conversationTurnInputs)
        .where(eq(conversationTurnInputs.turnId, turnId));
      const currentIds = new Set(currentInputs.map(({ id }) => id));
      const dependencies = mergeDependencies(
        checkpoint?.sources ?? [],
        ...rows.flatMap(({ turn }) =>
          turn?.provenanceComplete ? [sourceDependenciesSchema.parse(turn.sourceDependencies)] : [],
        ),
      );
      const current = dependencies.length
        ? await db
            .select({ id: notes.id, revision: notes.revision })
            .from(notes)
            .where(
              and(
                eq(notes.ownerId, owner),
                inArray(
                  notes.id,
                  dependencies.map(({ noteId }) => noteId),
                ),
              ),
            )
        : [];
      const versions = new Map(current.map((note) => [note.id, noteTag(note.id, note.revision)]));
      const eligible = (sources: SourceDependency[]) =>
        sources.every((source) => versions.get(source.noteId) === source.version);
      // Invalidated checkpoints are rebuilt from eligible messages, never edited by a model.
      if (checkpoint && !eligible(checkpoint.sources)) {
        await db
          .delete(conversationSummaries)
          .where(
            and(
              eq(conversationSummaries.conversationId, conversationId),
              eq(conversationSummaries.throughSequence, checkpoint.throughSequence),
            ),
          );
        return undefined;
      }
      const selected: ContextMessage[] = [];
      let sources = checkpoint?.sources ?? [];
      for (const { message, turn } of rows) {
        if (message.role === "user" && (!consumedIds.has(message.id) || currentIds.has(message.id)))
          continue;
        if (message.role === "assistant") {
          if (!turn) {
            await recover(owner, conversationId, turnId, "history_unavailable");
            return undefined;
          }
          if (turn.status === "incomplete") continue;
          if (!turn.provenanceComplete) {
            await recover(owner, conversationId, turnId, "history_unavailable");
            return undefined;
          }
          if (!eligible(turn.sourceDependencies)) continue;
          sources = mergeDependencies(sources, turn.sourceDependencies);
        }
        selected.push({
          id: message.id,
          sequence: message.sequence,
          role: message.role,
          text: message.text,
        });
      }
      const { older, recent } = splitContext(selected);
      contextMessagesSchema.parse(selected);
      const throughSequence = Math.max(
        older.at(-1)?.sequence ?? 0,
        checkpoint?.throughSequence ?? 0,
      );
      const deferredInputIds = rows
        .filter(
          ({ message }) =>
            message.role === "user" &&
            (!consumedIds.has(message.id) || currentIds.has(message.id)) &&
            message.sequence <= throughSequence,
        )
        .map(({ message }) => message.id);
      const summaryInput = older.length
        ? JSON.stringify({ previousSummary: checkpoint?.text ?? null, messages: older })
        : null;
      if (summaryInput && byteSize(summaryInput) > CONTEXT_LIMITS.reconstructionBytes) {
        await recover(owner, conversationId, turnId, "context_budget");
        return undefined;
      }
      return db.transaction(async (tx) => {
        if (!(await lockContextSources(tx, owner, sources))) return undefined;
        const locked = await lockOwnedConversation(tx, owner, conversationId);
        if (!locked || locked.nextSequence !== parent.nextSequence) return undefined;
        const [turn] = await tx
          .select()
          .from(conversationTurns)
          .where(
            and(
              eq(conversationTurns.id, turnId),
              eq(conversationTurns.conversationId, conversationId),
              eq(conversationTurns.status, "running"),
            ),
          );
        if (!turn) return undefined;
        const [winner] = await tx
          .select()
          .from(conversationContexts)
          .where(eq(conversationContexts.turnId, turnId));
        if (winner) return winner;
        const operationId = randomUUID();
        const [context] = await tx
          .insert(conversationContexts)
          .values({
            conversationId,
            turnId,
            operationId,
            state: summaryInput ? "summarizing" : "ready",
            throughSequence,
            deferredInputIds,
            recent,
            summary: checkpoint?.text ?? null,
            summaryInput,
            sources,
            runtimeUrl,
          })
          .returning();
        await tx
          .update(conversationTurns)
          .set({ sourceDependencies: sources, provenanceComplete: true })
          .where(eq(conversationTurns.id, turnId));
        if (summaryInput)
          await tx.insert(conversationCleanupIntents).values({
            ownerId: owner,
            conversationId,
            allocationOperationId: operationId,
            runtimeUrl,
            purpose: "summary",
            retryAt: new Date(Date.now() + 600_000).toISOString(),
            lastFailureCode: "allocation_unknown",
          });
        return context;
      });
    },

    async bindSummary(owner: string, context: Context, sessionId: string, deliveryId?: string) {
      return db.transaction(async (tx) => {
        const parent = await lockOwnedConversation(tx, owner, context.conversationId);
        // The intent survives deletion and receives late allocation receipts for cleanup only.
        await tx
          .update(conversationCleanupIntents)
          .set({ sessionId })
          .where(
            and(
              eq(conversationCleanupIntents.allocationOperationId, context.operationId),
              eq(conversationCleanupIntents.ownerId, owner),
              sql`(${conversationCleanupIntents.sessionId} IS NULL OR ${conversationCleanupIntents.sessionId} = ${sessionId})`,
            ),
          );
        if (!parent) return false;
        const [running] = await tx
          .select({ id: conversationTurns.id })
          .from(conversationTurns)
          .where(
            and(eq(conversationTurns.id, context.turnId), eq(conversationTurns.status, "running")),
          );
        if (!running) return false;
        const [row] = await tx
          .update(conversationContexts)
          .set({ sessionId, ...(deliveryId ? { deliveryId } : {}) })
          .where(
            and(
              eq(conversationContexts.turnId, context.turnId),
              eq(conversationContexts.operationId, context.operationId),
              eq(conversationContexts.state, "summarizing"),
              sql`(${conversationContexts.sessionId} IS NULL OR ${conversationContexts.sessionId} = ${sessionId})`,
            ),
          )
          .returning();
        return !!row;
      });
    },

    async publishSummary(owner: string, context: Context, result: unknown) {
      const parsed = summaryResultSchema.safeParse(result);
      if (!parsed.success) {
        await recover(owner, context.conversationId, context.turnId, "summary_failed");
        return false;
      }
      return db.transaction(async (tx) => {
        if (!(await lockContextSources(tx, owner, context.sources))) return false;
        const parent = await lockOwnedConversation(tx, owner, context.conversationId);
        if (!parent) return false;
        const [turn] = await tx
          .select()
          .from(conversationTurns)
          .where(
            and(eq(conversationTurns.id, context.turnId), eq(conversationTurns.status, "running")),
          );
        if (!turn) return false;
        const [saved] = await tx
          .update(conversationContexts)
          .set({ state: "ready", summary: parsed.data.summary, summaryInput: null })
          .where(
            and(
              eq(conversationContexts.turnId, context.turnId),
              eq(conversationContexts.operationId, context.operationId),
              eq(conversationContexts.state, "summarizing"),
            ),
          )
          .returning();
        if (!saved) return false;
        await tx
          .insert(conversationSummaries)
          .values({
            conversationId: parent.id,
            throughSequence: context.throughSequence,
            text: parsed.data.summary,
            sources: context.sources,
            deferredInputIds: context.deferredInputIds,
          })
          .onConflictDoUpdate({
            target: conversationSummaries.conversationId,
            set: {
              throughSequence: context.throughSequence,
              text: parsed.data.summary,
              sources: context.sources,
              deferredInputIds: context.deferredInputIds,
            },
          });
        await tx
          .update(conversationCleanupIntents)
          .set({ retryAt: sql`now()` })
          .where(eq(conversationCleanupIntents.allocationOperationId, context.operationId));
        return true;
      });
    },
  };
}
