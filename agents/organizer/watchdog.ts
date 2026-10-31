import type { SessionStreamEvent } from "eve/client";

export type OrganizerTimeouts = {
  startupMs: number;
  modelSilenceMs: number;
  researchMs: number;
};

export function validateOrganizerTimeouts(timeouts: OrganizerTimeouts): void {
  for (const value of [timeouts.startupMs, timeouts.modelSilenceMs, timeouts.researchMs]) {
    if (!Number.isSafeInteger(value) || value <= 0 || value > 2_147_483_647) {
      throw new Error("Organizer timeouts must be positive timer-safe integers.");
    }
  }
}

/** Bounds silence and opaque research calls, never the total duration of progressing work. */
export function createOrganizerWatchdog(timeouts: OrganizerTimeouts, callerSignal: AbortSignal) {
  validateOrganizerTimeouts(timeouts);
  const timeout = new AbortController();
  const signal = AbortSignal.any([callerSignal, timeout.signal]);
  let modelTimer: ReturnType<typeof setTimeout> | undefined;
  const researchTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const seenResearch = new Set<string>();
  let disposed = false;

  const dispose = () => {
    disposed = true;
    clearTimeout(modelTimer);
    for (const timer of researchTimers.values()) clearTimeout(timer);
    researchTimers.clear();
    signal.removeEventListener("abort", dispose);
  };
  const expire = (message: string) => timeout.abort(new DOMException(message, "TimeoutError"));
  const modelActivity = () => {
    if (disposed || researchTimers.size > 0) return;
    clearTimeout(modelTimer);
    modelTimer = setTimeout(
      () => expire("Organization stalled while waiting for model output."),
      timeouts.modelSilenceMs,
    );
  };

  signal.addEventListener("abort", dispose, { once: true });
  if (signal.aborted) dispose();
  else {
    modelTimer = setTimeout(
      () => expire("Organization startup timed out; its remote state is unconfirmed."),
      timeouts.startupMs,
    );
  }

  return {
    signal,
    accepted: modelActivity,
    observe(event: SessionStreamEvent) {
      if (disposed) return;
      if (
        event.type === "call.requested" &&
        event.data.capability.kind === "tool" &&
        event.data.capability.name === "research"
      ) {
        if (seenResearch.has(event.data.callId)) return;
        seenResearch.add(event.data.callId);
        clearTimeout(modelTimer);
        researchTimers.set(
          event.data.callId,
          setTimeout(() => expire("Organization research stalled."), timeouts.researchMs),
        );
      } else if (event.type === "call.settled") {
        const timer = researchTimers.get(event.data.callId);
        if (timer === undefined) return;
        clearTimeout(timer);
        researchTimers.delete(event.data.callId);
        if (researchTimers.size === 0) modelActivity();
      } else if (
        (event.type === "content.delta" || event.type === "call.input") &&
        event.data.delta.length > 0
      ) {
        // Reasoning and tool-input tokens count, but usage/heartbeats/metadata do not.
        modelActivity();
      }
    },
    dispose,
  };
}
