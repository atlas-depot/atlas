import { randomInt } from "node:crypto";
import type { z } from "zod";
import type { sendConversationMessageSchema } from "../shared/conversations.ts";
import {
  resolveAnswer,
  type AnswerObservation,
  type AnswerRuntime,
} from "./conversation-answer.ts";
import type { createConversationCleanupStore } from "./db/conversation-cleanup.ts";
import type { createConversationTurns } from "./db/conversation-turns.ts";
import type { createConversationContextStore } from "./db/conversation-contexts.ts";
import {
  byteSize,
  composeContext,
  CONTEXT_LIMITS,
  mergeDependencies,
  type ContextCompactor,
} from "./conversation-context.ts";

type Turns = ReturnType<typeof createConversationTurns>;
type Cleanup = ReturnType<typeof createConversationCleanupStore>;
type Turn = NonNullable<Awaited<ReturnType<Turns["dispatchState"]>>>["turn"];

/** Several accepted inputs become one question so one answer can address them together. */
export function composeQuestion(texts: readonly string[]): string {
  return texts.length === 1
    ? texts[0]!
    : texts.map((text, index) => `Question ${index + 1}:\n${text}`).join("\n\n");
}

function finalization(observation: Exclude<AnswerObservation, { status: "running" }>, turn: Turn) {
  const incomplete = (reason: "failed" | "cancelled", text: string) => ({
    status: "incomplete" as const,
    reason,
    text,
    citations: [],
    expectedVersion: turn.checkpointVersion,
  });
  if (observation.status === "cancelled") return incomplete("cancelled", observation.text);
  if (observation.status === "failed" || observation.status === "expired")
    return incomplete("failed", observation.text);
  const resolved = resolveAnswer(observation.result, observation.evidence);
  // An invented source or a malformed result is a failed attempt, never a published answer.
  return resolved.ok
    ? {
        ...resolved.answer,
        expectedVersion: turn.checkpointVersion,
        provenanceComplete: true,
        sourceDependencies: mergeDependencies(
          turn.sourceDependencies,
          observation.evidence.map(({ source }) => ({
            noteId: source.noteId,
            version: source.version,
          })),
        ),
      }
    : incomplete("failed", "");
}

/**
 * Drives answer attempts through short, repeatable steps. Postgres holds every decision and
 * no lock spans a runtime call, so any API process or the maintenance sweep can continue
 * where another stopped.
 */
export function createConversationAnswers({
  turns,
  cleanup,
  runtimeUrl,
  runtimeFor,
  contexts,
  compactorFor,
}: {
  turns: Turns;
  cleanup: Cleanup;
  /** Immutable deployment URL, stored with the attempt before any runtime call. */
  runtimeUrl: string;
  runtimeFor: (baseUrl: string) => AnswerRuntime;
  contexts: ReturnType<typeof createConversationContextStore>;
  compactorFor: (baseUrl: string) => ContextCompactor;
}) {
  const fail = (owner: string, conversationId: string, turn: Turn) =>
    turns.finalize(owner, conversationId, turn.id, {
      status: "incomplete",
      reason: "failed",
      text: "",
      citations: [],
      expectedVersion: turn.checkpointVersion,
    });

  /** Binds the running attempt to one session and delivers each input exactly once by key. */
  async function dispatch(owner: string, conversationId: string) {
    const state = await turns.dispatchState(owner, conversationId);
    if (!state) return undefined;
    const { turn, inputs } = state;
    let context;
    try {
      context = await contexts.prepare(owner, conversationId, turn.id, runtimeUrl);
    } catch (error) {
      if (!(error instanceof Error) || error.name !== "ZodError") throw error;
      await contexts.recover(owner, conversationId, turn.id, "history_unavailable");
    }
    if (!context) {
      const updated = await turns.dispatchState(owner, conversationId);
      if (updated?.turn.contextRecovery) await fail(owner, conversationId, updated.turn);
      return undefined;
    }
    if (context.state === "recovery") {
      await contexts.recover(
        owner,
        conversationId,
        turn.id,
        turn.contextRecovery ?? "source_changed",
      );
      await fail(owner, conversationId, turn);
      return undefined;
    }
    if (context.state === "summarizing") {
      const compactor = compactorFor(context.runtimeUrl);
      const sessionId = context.sessionId ?? (await compactor.allocate(context.operationId));
      if (!(await contexts.bindSummary(owner, context, sessionId))) return undefined;
      let deliveryId = context.deliveryId;
      if (!deliveryId) {
        const receipt = await compactor.submit(
          sessionId,
          context.operationId,
          context.summaryInput!,
        );
        if (receipt.status !== "delivered") {
          await contexts.recover(owner, conversationId, turn.id, "summary_failed");
          await fail(owner, conversationId, turn);
          return undefined;
        }
        deliveryId = receipt.deliveryId;
        if (!(await contexts.bindSummary(owner, context, sessionId, deliveryId))) return undefined;
      }
      const observation = await compactor.inspect(sessionId, deliveryId);
      if (observation.status === "running") {
        await turns.touch(turn.id);
        return undefined;
      }
      if (observation.status === "failed") {
        await contexts.recover(owner, conversationId, turn.id, "summary_failed");
        await fail(owner, conversationId, turn);
      } else await contexts.publishSummary(owner, context, observation.result);
      // Reread the durable ready context next pass; never send an uncommitted summary.
      return undefined;
    }
    const opening = inputs.filter((input) => !input.steer).map((input) => input.text);
    const question = composeContext(context.summary, context.recent, composeQuestion(opening));
    if (
      byteSize(question) +
        inputs
          .filter((input) => input.steer)
          .reduce((size, input) => size + byteSize(input.text), 0) >
      CONTEXT_LIMITS.promptBytes
    ) {
      await contexts.recover(owner, conversationId, turn.id, "context_budget");
      await fail(owner, conversationId, turn);
      return undefined;
    }
    const runtime = runtimeFor(turn.runtimeUrl ?? runtimeUrl);
    // The attempt ID is the allocation and delivery key, so a crash at any step converges.
    if (!turn.allocationOperationId) {
      const prepared = await cleanup.prepareRuntime(owner, conversationId, turn.id, {
        allocationOperationId: turn.id,
        runtimeUrl,
      });
      if (prepared.status !== "prepared") return undefined;
    }
    let sessionId = turn.sessionId;
    if (!sessionId) {
      sessionId = await runtime.allocate(turn.id);
      const bound = await cleanup.bindRuntime(owner, conversationId, turn.id, turn.id, sessionId);
      if (bound.status !== "bound") return undefined;
    }
    let deliveryId = turn.deliveryId;
    if (!deliveryId) {
      const receipt = await runtime.submit(sessionId, turn.id, question);
      if (receipt.status !== "delivered") {
        await contexts.recover(
          owner,
          conversationId,
          turn.id,
          receipt.status === "expired" ? "runtime_expired" : "context_budget",
        );
        return void (await fail(owner, conversationId, turn));
      }
      deliveryId = receipt.deliveryId;
      await turns.recordDelivery(owner, conversationId, turn.id, deliveryId);
    }
    const steerDeliveryIds: string[] = [];
    for (const input of inputs.filter((candidate) => candidate.steer)) {
      if (input.deliveryId) {
        steerDeliveryIds.push(input.deliveryId);
        continue;
      }
      const receipt = await runtime.steer(sessionId, input.id, input.text);
      if (receipt.status !== "delivered") {
        await contexts.recover(
          owner,
          conversationId,
          turn.id,
          receipt.status === "expired" ? "runtime_expired" : "context_budget",
        );
        return void (await fail(owner, conversationId, turn));
      }
      await turns.recordDelivery(owner, conversationId, turn.id, receipt.deliveryId, input.id);
      steerDeliveryIds.push(receipt.deliveryId);
    }
    return {
      turn: {
        ...turn,
        sourceDependencies: mergeDependencies(turn.sourceDependencies, context.sources),
      },
      runtime,
      sessionId,
      deliveryId,
      steerDeliveryIds,
    };
  }

  /** One pass: start or continue the attempt, publish it if it ended, then take the queue. */
  async function advance(owner: string, conversationId: string) {
    for (let pass = 0; pass < 2; pass++) {
      const next = await turns.startNext(owner, conversationId);
      if (next.status !== "busy" && next.status !== "started") return;
      const bound = await dispatch(owner, conversationId);
      if (!bound) return;
      const { turn, runtime, sessionId, deliveryId, steerDeliveryIds } = bound;
      const observation = await runtime.inspect(sessionId, { deliveryId, steerDeliveryIds });
      if (observation.status === "running") {
        if (observation.text !== (turn.runningText ?? ""))
          await turns.checkpoint(
            owner,
            conversationId,
            turn.id,
            turn.checkpointVersion,
            observation.text,
          );
        else await turns.touch(turn.id);
        return;
      }
      if (observation.status === "expired")
        await contexts.recover(owner, conversationId, turn.id, "runtime_expired");
      await turns.finalize(owner, conversationId, turn.id, finalization(observation, turn));
    }
  }

  /** Runtime trouble never undoes accepted input. The next read or the sweep continues. */
  async function advanceQuietly(owner: string, conversationId: string) {
    try {
      await advance(owner, conversationId);
    } catch {
      // Accepted state is already durable. No content or provider detail is logged.
    }
  }

  async function retire(
    intent: Pick<
      Awaited<ReturnType<Cleanup["pending"]>>[number],
      | "ownerId"
      | "conversationId"
      | "allocationOperationId"
      | "runtimeUrl"
      | "sessionId"
      | "attempts"
      | "purpose"
    >,
  ) {
    const runtime =
      intent.purpose === "summary"
        ? compactorFor(intent.runtimeUrl)
        : runtimeFor(intent.runtimeUrl);
    try {
      let sessionId = intent.sessionId;
      if (!sessionId) {
        // Repeating the stable allocation returns the same session without starting a model.
        sessionId = await runtime.allocate(intent.allocationOperationId);
        if (!(await cleanup.bindIntent(intent.allocationOperationId, sessionId))) return false;
      }
      await runtime.retire(sessionId);
      return await cleanup.confirmRetired(intent.allocationOperationId, sessionId);
    } catch {
      const backoff = Math.min(900_000, 30_000 * 2 ** Math.min(intent.attempts, 5));
      await cleanup.recordFailure(
        intent.allocationOperationId,
        intent.sessionId ? "cleanup_failed" : "allocation_unknown",
        new Date(Date.now() + randomInt(1_000, backoff + 1)).toISOString(),
      );
      return false;
    }
  }

  /** Ends sessions of finished, stopped or deleted work. Unknown outcomes stay pending. */
  async function sweepCleanup(limit: number) {
    let pending = 0;
    for (const intent of await cleanup.pending(limit)) if (!(await retire(intent))) pending++;
    return pending;
  }

  return {
    /** Accepts one input and starts or steers work. A replay never spends admission twice. */
    async send(
      owner: string,
      conversationId: string,
      operationId: string,
      input: z.input<typeof sendConversationMessageSchema>,
    ) {
      const accepted = await turns.acceptInput(owner, conversationId, operationId, input);
      if (accepted.status === "saved") await advanceQuietly(owner, conversationId);
      return accepted;
    },

    /** Called by reads so a reconnect continues existing work instead of starting more. */
    refresh: advanceQuietly,

    /** Cancels the active attempt and pauses the queue. Accepted inputs stay queued. */
    async stop(owner: string, conversationId: string) {
      const stopped = await turns.stop(owner, conversationId);
      if (stopped.status === "paused") {
        for (const intent of await cleanup.expedite(owner, conversationId)) await retire(intent);
      }
      return stopped;
    },

    async resume(owner: string, conversationId: string) {
      const resumed = await turns.resume(owner, conversationId);
      if (resumed.status === "resumed") await advanceQuietly(owner, conversationId);
      return resumed;
    },

    /** A new attempt over the same inputs. The incomplete answer stays in history. */
    async retry(owner: string, conversationId: string, turnId: string, operationId: string) {
      const inputIds = await turns.attemptInputs(owner, conversationId, turnId);
      if (!inputIds?.length) return { status: "not_found" as const };
      const started = await turns.startAttempt(owner, conversationId, operationId, {
        inputIds,
        retryOfId: turnId,
      });
      if (started.status === "saved") await advanceQuietly(owner, conversationId);
      return started;
    },

    /** Maintenance: continue attempts no reader is watching, then retire finished sessions. */
    async sweep(limit: number) {
      for (const { ownerId, conversationId, turnId } of await turns.unobserved(limit, 30_000)) {
        // Rotate first, so an attempt whose runtime keeps failing cannot starve the others.
        await turns.touch(turnId);
        await advanceQuietly(ownerId, conversationId);
      }
      for (const { ownerId, conversationId } of await turns.runnableQueues(limit))
        await advanceQuietly(ownerId, conversationId);
      return { cleanupPending: await sweepCleanup(limit) };
    },
  };
}
export type ConversationAnswerService = ReturnType<typeof createConversationAnswers>;
