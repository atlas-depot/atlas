import { runs, type FactOf, type SessionView } from "eve/events";
import { defineHook } from "eve/hooks";

export function enforceModelLimit(
  event: FactOf<"model.requested">,
  ctx: { view: SessionView; cancel(reason: string): void },
) {
  if (
    "turnId" in event.data.owner &&
    runs(ctx.view, { turnId: event.data.owner.turnId }).length > 16
  ) {
    // Count durable requests, not a process-local counter or browser observations.
    ctx.cancel("Organization exceeded its model-call limit.");
  }
}

export default defineHook({ events: { "model.requested": enforceModelLimit } });
