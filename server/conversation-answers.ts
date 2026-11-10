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
import type { SearchAdmission } from "./note-search-routes.ts";

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
  if (observation.status === "failed") return incomplete("failed", observation.text);
  const resolved = resolveAnswer(observation.result, observation.evidence);
  // An invented source or a malformed result is a failed attempt, never a published answer.
  return resolved.ok
    ? { ...resolved.answer, expectedVersion: turn.checkpointVersion }
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
  admit,
  runtimeUrl,
  runtimeFor,
}: {
  turns: Turns;
  cleanup: Cleanup;
  admit: SearchAdmission;
  /** Immutable deployment URL, stored with the attempt before any runtime call. */
  runtimeUrl: string;
  runtimeFor: (baseUrl: string) => AnswerRuntime;
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
      const opening = inputs.filter((input) => !input.steer).map((input) => input.text);
      const receipt = await runtime.submit(sessionId, turn.id, composeQuestion(opening));
      if (receipt.status === "expired") return void (await fail(owner, conversationId, turn));
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
      if (receipt.status === "expired") return void (await fail(owner, conversationId, turn));
      await turns.recordDelivery(owner, conversationId, turn.id, receipt.deliveryId, input.id);
      steerDeliveryIds.push(receipt.deliveryId);
    }
    return { turn, runtime, sessionId, deliveryId, steerDeliveryIds };
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
    >,
  ) {
    const runtime = runtimeFor(intent.runtimeUrl);
    try {
      let sessionId = intent.sessionId;
      if (!sessionId) {
        // Repeating the stable allocation returns the same session without starting a model.
        sessionId = await runtime.allocate(intent.allocationOperationId);
        await cleanup.bindRuntime(
          intent.ownerId,
          intent.conversationId,
          intent.allocationOperationId,
          intent.allocationOperationId,
          sessionId,
        );
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
      const accepted = await turns.acceptInput(owner, conversationId, operationId, input, admit);
      if (accepted.status === "saved") await advanceQuietly(owner, conversationId);
      return accepted;
    },

    /** Called by reads so a reconnect continues existing work instead of starting more. */
    refresh: advanceQuietly,

    /** Cancels the active attempt and pauses the queue. Accepted inputs stay queued. */
    async stop(owner: string, conversationId: string) {
      const active = (await turns.dispatchState(owner, conversationId))?.turn;
      const stopped = await turns.stop(owner, conversationId);
      // Ending this attempt's session is what stops generation. A failure stays a
      // retryable intent for maintenance and never undoes the stop.
      if (stopped.status === "paused" && active?.allocationOperationId && active.runtimeUrl)
        await retire({
          ownerId: owner,
          conversationId,
          allocationOperationId: active.allocationOperationId,
          runtimeUrl: active.runtimeUrl,
          sessionId: active.sessionId,
          attempts: 0,
        }).catch(() => false);
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
      return { cleanupPending: await sweepCleanup(limit) };
    },
  };
}
export type ConversationAnswerService = ReturnType<typeof createConversationAnswers>;
