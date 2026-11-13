import type { SessionStreamEvent } from "eve/client";
import { z } from "zod";
import {
  answerOutputSchema,
  readResearchEvidence,
  readSearchEvidence,
  type AnswerEvidence,
  type AnswerObservation,
  type AnswerRuntime,
} from "../../server/conversation-answer.ts";
import {
  createEveTransport,
  expired,
  ExpiredSubmission,
  RejectedSubmission,
  sessionIdSchema,
  type EveTransportOptions,
} from "./eve-transport.ts";
import { CHAT_PRINCIPAL } from "./job.ts";

export type AnswerDeliveries = { deliveryId: string; steerDeliveryIds: readonly string[] };

const MAX_TEXT = 100_000;

/** Short server requests only. eve owns generation independently of these readers. */
export function createDurableEveAnswerer(
  options: Omit<EveTransportOptions, "username">,
): AnswerRuntime {
  const transport = createEveTransport({ ...options, username: CHAT_PRINCIPAL });
  const deliver = async (sessionId: string, body: Parameters<typeof transport.deliver>[1]) => {
    try {
      return { status: "delivered" as const, ...(await transport.deliver(sessionId, body)) };
    } catch (error) {
      if (error instanceof ExpiredSubmission) return { status: "expired" as const };
      if (error instanceof RejectedSubmission) return { status: "rejected" as const };
      throw new Error("Answer delivery is unconfirmed. Retry the same fixed session only.");
    }
  };
  return {
    async allocate(operationId: string): Promise<string> {
      try {
        return await transport.allocate(operationId);
      } catch {
        throw new Error("Answer allocation is unconfirmed. No model input was submitted.");
      }
    },

    /** Persist the session ID first. The key makes a lost receipt safe to repeat. */
    submit: (sessionId: string, operationId: string, message: string) =>
      deliver(sessionId, {
        idempotencyKey: operationId,
        message,
        outputSchema: answerOutputSchema,
      }),

    /** Joins the running turn. The runtime, not Atlas, decides where generation is cut. */
    steer: (sessionId: string, operationId: string, message: string) =>
      deliver(sessionId, {
        idempotencyKey: operationId,
        message,
        turnPolicy: "steer",
        outputSchema: answerOutputSchema,
      }),

    async inspect(sessionId: string, deliveries: AnswerDeliveries): Promise<AnswerObservation> {
      try {
        // snapshot pins the durable tail and ends. No live stream survives this request.
        const snapshot = await transport.reader.sessions
          .attach(sessionIdSchema.parse(sessionId))
          .snapshot({ signal: transport.timeout() });
        return observeAnswer(snapshot.events, deliveries);
      } catch (error) {
        if (expired(error)) return { status: "expired", text: "" };
        throw new Error("Answer state could not be read. Existing work was not cancelled.");
      }
    },

    async retire(sessionId: string): Promise<{ status: "ended" | "expired" }> {
      try {
        return await transport.retire(sessionId, "Atlas retired this answer");
      } catch {
        throw new Error("Answer retirement is unconfirmed. Retry cleanup without a new run.");
      }
    },
  };
}

const resultPartSchema = z.object({ kind: z.literal("result"), value: z.unknown() });
const textPartSchema = z.object({ kind: z.literal("text"), value: z.string() });

/**
 * Reads only the turns that consumed Atlas's own deliveries. Evidence comes from recorded
 * search results, never from what the model says it read.
 */
export function observeAnswer(
  events: readonly SessionStreamEvent[],
  { deliveryId, steerDeliveryIds }: AnswerDeliveries,
): AnswerObservation {
  const ids = [deliveryId, ...steerDeliveryIds];
  const ended = events.some((event) => event.type === "session.ended");
  const turnIds: string[] = [];
  const settled = new Set<string>();
  let unhandledDelivery = false;
  for (const event of events) {
    if (event.type === "delivery.consumed" && ids.includes(event.data.deliveryId))
      turnIds.push(event.data.turnId);
    else if (event.type === "delivery.settled" && ids.includes(event.data.deliveryId)) {
      if (event.data.outcome !== "handled") unhandledDelivery = true;
      settled.add(event.data.deliveryId);
    }
  }
  const scoped = events.filter(
    (event) => event.scope?.turnId !== undefined && turnIds.includes(event.scope.turnId),
  );
  const text = scoped
    .flatMap((event) => {
      const part = event.type === "content.completed" ? textPartSchema.safeParse(event.data) : null;
      return part?.success ? [part.data.value] : [];
    })
    .join("\n")
    .slice(0, MAX_TEXT);
  if (unhandledDelivery) return { status: "failed", text };
  const pending = ids.some((id) => !settled.has(id));
  if (pending && !ended) return { status: "running", text };
  // The last turn to take one of our inputs carries the answer to all of them.
  const turnId = turnIds.at(-1);
  const turn = events.find(
    (event) => event.type === "turn.settled" && event.data.turnId === turnId,
  );
  if (turn?.type !== "turn.settled") return { status: "failed", text };
  if (turn.data.outcome === "cancelled") return { status: "cancelled", text };
  if (pending || turn.data.outcome !== "completed") return { status: "failed", text };

  const searches = new Set<string>();
  const researches = new Set<string>();
  const evidence = new Map<string, AnswerEvidence>();
  let searched = false;
  let result: { value: unknown } | undefined;
  for (const event of scoped) {
    if (
      event.type === "call.requested" &&
      event.data.capability.kind === "tool" &&
      event.data.capability.name === "search_notes"
    )
      searches.add(event.data.callId);
    else if (
      event.type === "call.requested" &&
      event.data.capability.kind === "tool" &&
      event.data.capability.name === "research"
    )
      researches.add(event.data.callId);
    else if (event.type === "call.settled" && searches.has(event.data.callId)) {
      if (event.data.outcome !== "completed") return { status: "failed", text };
      const passages = readSearchEvidence(event.data.output);
      if (!passages) return { status: "failed", text };
      searched = true;
      for (const passage of passages) evidence.set(passage.id, passage);
    } else if (event.type === "call.settled" && researches.has(event.data.callId)) {
      if (event.data.outcome !== "completed") return { status: "failed", text };
      const research = readResearchEvidence(event.data.output);
      if (!research) return { status: "failed", text };
      searched = true;
      if (research.status === "completed")
        for (const source of research.evidence) evidence.set(source.id, source);
    } else if (event.type === "content.completed" && event.scope?.turnId === turnId) {
      const part = resultPartSchema.safeParse(event.data);
      if (part.success) result = { value: part.data.value };
    }
  }
  return result && searched
    ? { status: "result", result: result.value, evidence: [...evidence.values()] }
    : { status: "failed", text };
}
