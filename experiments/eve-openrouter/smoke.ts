import { Client, type StepCompletedStreamEvent } from "eve/client";
import { z } from "zod";

const keySchema = z.object({
  data: z.object({
    limit: z.number().positive().max(1),
    limit_reset: z.null(),
    limit_remaining: z.number().nonnegative(),
    usage: z.number().nonnegative(),
  }),
});

async function readKeyUsage(apiKey: string) {
  const response = await fetch("https://openrouter.ai/api/v1/key", {
    headers: { Authorization: `Bearer ${apiKey}` },
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error("OpenRouter key check failed.");
  const parsed = keySchema.safeParse(await response.json());
  if (!parsed.success) {
    throw new Error("Use a key with remaining credit and a non-resetting limit of at most $1.");
  }
  return parsed.data.data;
}

async function main() {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("Set OPENROUTER_API_KEY in the ignored .env.local file.");

  const before = await readKeyUsage(apiKey);
  if (before.limit_remaining <= 0) throw new Error("OpenRouter key has no remaining credit.");
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
    const after = await readKeyUsage(apiKey);
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
          keyUsageDeltaUsd: after.usage - before.usage,
          keyLimitUsd: after.limit,
          note: "Key usage may settle later. This smoke check is not an answer-quality evaluation.",
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
    "Set OPENROUTER_API_KEY in the ignored .env.local file.",
    "OpenRouter key check failed.",
    "OpenRouter key has no remaining credit.",
    "Use a key with remaining credit and a non-resetting limit of at most $1.",
    "Smoke failed. Inspect the local eve status; provider response bodies are not logged here.",
  ]);
  console.error(
    error instanceof Error && safeMessages.has(error.message)
      ? error.message
      : "Smoke setup failed. Check the key, network and local eve server.",
  );
  process.exitCode = 1;
});
