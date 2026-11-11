import type { SessionStreamEvent } from "eve/client";
import { z } from "zod";
import { summaryOutputSchema, type ContextCompactor } from "../../server/conversation-context.ts";
import {
  createEveTransport,
  expired,
  ExpiredSubmission,
  RejectedSubmission,
  type EveTransportOptions,
} from "./eve-transport.ts";
import { CONTEXT_PRINCIPAL } from "./job.ts";

/** Compaction is another bounded job on the existing eve harness, with no note or web tools. */
export function createDurableEveCompactor(
  options: Omit<EveTransportOptions, "username">,
): ContextCompactor {
  const transport = createEveTransport({ ...options, username: CONTEXT_PRINCIPAL });
  return {
    allocate: (operationId) => transport.allocate(operationId),
    async submit(sessionId, operationId, message) {
      try {
        return {
          status: "delivered",
          ...(await transport.deliver(sessionId, {
            idempotencyKey: operationId,
            message,
            outputSchema: summaryOutputSchema,
          })),
        };
      } catch (error) {
        if (error instanceof ExpiredSubmission) return { status: "expired" };
        if (error instanceof RejectedSubmission) return { status: "rejected" };
        throw new Error("Summary delivery is unconfirmed. Retry the same operation only.");
      }
    },
    async inspect(sessionId, deliveryId) {
      try {
        const snapshot = await transport.reader.sessions
          .attach(sessionId)
          .snapshot({ signal: transport.timeout() });
        return observeSummary(snapshot.events, deliveryId);
      } catch (error) {
        if (expired(error)) return { status: "expired" };
        throw new Error("Summary state is unavailable. Existing work was not replaced.");
      }
    },
    retire: (sessionId) => transport.retire(sessionId, "Atlas retired this summary"),
  };
}

const resultSchema = z.object({ kind: z.literal("result"), value: z.unknown() });

/** An unrelated turn or an unsettled delivery cannot supply a checkpoint. */
export function observeSummary(
  events: readonly SessionStreamEvent[],
  deliveryId: string,
): Awaited<ReturnType<ContextCompactor["inspect"]>> {
  const consumed = events.find(
    (event) => event.type === "delivery.consumed" && event.data.deliveryId === deliveryId,
  );
  const settled = events.find(
    (event) => event.type === "delivery.settled" && event.data.deliveryId === deliveryId,
  );
  if (settled?.type !== "delivery.settled")
    return events.some((event) => event.type === "session.ended")
      ? { status: "failed" }
      : { status: "running" };
  if (settled.data.outcome !== "handled" || consumed?.type !== "delivery.consumed")
    return { status: "failed" };
  const turnId = consumed.data.turnId;
  const turn = events.find(
    (event) => event.type === "turn.settled" && event.data.turnId === turnId,
  );
  if (turn?.type !== "turn.settled" || turn.data.outcome !== "completed")
    return { status: "failed" };
  const results = events.flatMap((event) => {
    if (event.type !== "content.completed" || event.scope?.turnId !== turnId) return [];
    const parsed = resultSchema.safeParse(event.data);
    return parsed.success ? [parsed.data.value] : [];
  });
  return results.length === 1 ? { status: "completed", result: results[0] } : { status: "failed" };
}
