import assert from "node:assert/strict";
import { test } from "node:test";
import { createBudgetedOpenRouter } from "./budget-provider.ts";

const budget = { limit: 1, limit_reset: null, limit_remaining: 0.9, include_byok_in_limit: true };
const prompt = [
  { role: "user" as const, content: [{ type: "text" as const, text: "Synthetic note" }] },
];

await test("missing server key allows inspection but rejects a model call without env fallback", async () => {
  const original = process.env.OPENROUTER_API_KEY;
  const provider = createBudgetedOpenRouter(undefined, async () => {
    assert.fail("A missing key must not reach the network.");
  });
  process.env.OPENROUTER_API_KEY = "fake-later-environment-key";
  try {
    await assert.rejects(
      provider("openai/gpt-4.1-mini").doGenerate({ prompt }),
      /Set OPENROUTER_API_KEY/,
    );
  } finally {
    if (original === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = original;
  }
});

for (const data of [
  { ...budget, limit: 50 },
  { ...budget, limit: null },
  { ...budget, limit_reset: "daily" },
  { ...budget, limit_remaining: 0 },
  { ...budget, include_byok_in_limit: false },
  { limit: 1, limit_reset: null, limit_remaining: 0.9 },
  {},
]) {
  await test(`rejects unsafe server budget ${JSON.stringify(data)} before a model request`, async () => {
    const requests: string[] = [];
    const provider = createBudgetedOpenRouter("fake-server-key", async (input, init) => {
      requests.push(input instanceof Request ? input.url : input.toString());
      assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer fake-server-key");
      return Response.json({ data });
    });
    await assert.rejects(
      provider("openai/gpt-4.1-mini").doGenerate({ prompt }),
      /Server key check failed/,
    );
    assert.deepEqual(requests, ["https://openrouter.ai/api/v1/key"]);
  });
}

await test("the streaming path also rejects a high-limit server key", async () => {
  const requests: string[] = [];
  const provider = createBudgetedOpenRouter("fake-server-key", async (input) => {
    requests.push(input instanceof Request ? input.url : input.toString());
    return Response.json({ data: { ...budget, limit: 50 } });
  });
  await assert.rejects(
    provider("openai/gpt-4.1-mini").doStream({ prompt }),
    /Server key check failed/,
  );
  assert.deepEqual(requests, ["https://openrouter.ai/api/v1/key"]);
});

await test("checks and charges the same captured key even if another credential is supplied", async () => {
  const requests: string[] = [];
  const provider = createBudgetedOpenRouter("fake-server-key", async (input, init) => {
    const url = input instanceof Request ? input.url : input.toString();
    requests.push(url);
    assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer fake-server-key");
    assert.equal(init?.redirect, "error");
    if (url.endsWith("/key")) return Response.json({ data: budget });
    assert.equal(url, "https://openrouter.ai/api/v1/chat/completions");
    return Response.json({
      id: "synthetic-response",
      model: "openai/gpt-4.1-mini",
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: "Synthetic answer" },
          finish_reason: "stop",
        },
      ],
      usage: { prompt_tokens: 2, completion_tokens: 2, total_tokens: 4 },
    });
  });
  const model = provider("openai/gpt-4.1-mini");
  await model.doGenerate({ prompt, headers: { Authorization: "Bearer fake-client-key" } });
  await model.doGenerate({ prompt });
  assert.deepEqual(requests, [
    "https://openrouter.ai/api/v1/key",
    "https://openrouter.ai/api/v1/chat/completions",
    "https://openrouter.ai/api/v1/key",
    "https://openrouter.ai/api/v1/chat/completions",
  ]);
});

for (const failure of ["network", "http", "json"]) {
  await test(`a ${failure} preflight failure sends no model request or raw diagnostic`, async () => {
    let calls = 0;
    const provider = createBudgetedOpenRouter("fake-server-key", async () => {
      calls += 1;
      if (failure === "network") throw new Error("sensitive upstream diagnostic");
      if (failure === "http") return new Response("sensitive upstream diagnostic", { status: 401 });
      return new Response("sensitive upstream diagnostic");
    });
    await assert.rejects(provider("openai/gpt-4.1-mini").doGenerate({ prompt }), {
      message:
        "Server key check failed. Use a non-resetting limit of at most $1 with remaining credit and BYOK usage included.",
    });
    assert.equal(calls, 1);
  });
}

await test("caller cancellation during preflight stays an AbortError without a model request", async () => {
  const controller = new AbortController();
  const requests: string[] = [];
  const provider = createBudgetedOpenRouter("fake-server-key", async (input, init) => {
    requests.push(input instanceof Request ? input.url : input.toString());
    assert.ok(init?.signal);
    const signal = init.signal;
    return new Promise<Response>((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      controller.abort("private cancellation detail");
    });
  });
  await assert.rejects(
    provider("openai/gpt-4.1-mini").doGenerate({ prompt, abortSignal: controller.signal }),
    { name: "AbortError", message: "Model request cancelled." },
  );
  assert.deepEqual(requests, ["https://openrouter.ai/api/v1/key"]);
});

await test("an already-cancelled call performs no HTTP request", async () => {
  const provider = createBudgetedOpenRouter("fake-server-key", async () => {
    assert.fail("A cancelled call must not reach the network.");
  });
  await assert.rejects(
    provider("openai/gpt-4.1-mini").doGenerate({
      prompt,
      abortSignal: AbortSignal.abort("private cancellation detail"),
    }),
    { name: "AbortError", message: "Model request cancelled." },
  );
});
