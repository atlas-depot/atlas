import { Client, type StepCompletedStreamEvent } from "eve/client";

async function main() {
  const client = new Client({ host: "http://127.0.0.1:2026", redirect: "error" });
  const signal = AbortSignal.timeout(60_000);
  const { session } = await client.sessions.create({ signal });
  const input =
    "Synthetic note: The Atlas review is on 22 October at 14:00. What time is the review?";

  try {
    const response = await session.send(input, {
      signal,
      streamReconnectPolicy: { reconnect: false },
    });
    const result = await response.result();
    const steps = result.events.filter(
      (event): event is StepCompletedStreamEvent & typeof event => event.type === "step.completed",
    );
    const failed = result.events.some((event) =>
      [
        "session.failed",
        "turn.failed",
        "turn.cancelled",
        "input.requested",
        "authorization.required",
      ].includes(event.type),
    );
    const turnCompleted = result.events.some((event) => event.type === "turn.completed");
    const boundaryReached = result.events.some((event) =>
      ["session.waiting", "session.completed"].includes(event.type),
    );
    if (
      failed ||
      !turnCompleted ||
      !boundaryReached ||
      steps.length === 0 ||
      !result.message?.includes("14:00")
    ) {
      throw new Error("The eve turn did not complete with the expected synthetic answer.");
    }
    console.log(
      JSON.stringify(
        {
          eveVersion: "0.83.0",
          model: "openai/gpt-4.1-mini",
          input,
          status: result.status,
          turnCompleted,
          boundaryReached,
          sessionId: result.sessionId,
          answer: result.message,
          steps: steps.map(({ data }) => ({
            stepIndex: data.stepIndex,
            inputTokens: data.usage?.inputTokens ?? null,
            outputTokens: data.usage?.outputTokens ?? null,
            costUsd: data.usage?.costUsd ?? null,
          })),
          note: "The server validates its own key budget. This smoke does not measure dollar spend or answer quality.",
        },
        null,
        2,
      ),
    );
  } catch {
    try {
      await session.cancel({ signal: AbortSignal.timeout(5_000) });
    } catch {
      console.error("Cancellation was not confirmed. Stop the local eve server before retrying.");
    }
    throw new Error(
      "Smoke failed. Inspect the local eve status; provider response bodies are not logged here.",
    );
  }
}

main().catch((error: unknown) => {
  // Only our own fixed diagnostics reach stdout/stderr, never provider bodies or credentials.
  const safeMessages = new Set([
    "Smoke failed. Inspect the local eve status; provider response bodies are not logged here.",
  ]);
  console.error(
    error instanceof Error && safeMessages.has(error.message)
      ? error.message
      : "Smoke setup failed. Check the key, network and local eve server.",
  );
  process.exitCode = 1;
});
