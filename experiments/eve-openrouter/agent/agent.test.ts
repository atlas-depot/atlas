import assert from "node:assert/strict";
import { test } from "node:test";

await test("the actual agent rejects an unsafe budget and uses its captured key for a safe call", async () => {
  const originalKey = process.env.OPENROUTER_API_KEY;
  const originalFetch = globalThis.fetch;
  const requests: string[] = [];
  let limit = 50;
  process.env.OPENROUTER_API_KEY = "fake-agent-server-key";
  globalThis.fetch = async (input, init) => {
    const url = input instanceof Request ? input.url : input.toString();
    requests.push(url);
    assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer fake-agent-server-key");
    if (url === "https://openrouter.ai/api/v1/key") {
      return Response.json({
        data: { limit, limit_reset: null, limit_remaining: 0.9, include_byok_in_limit: true },
      });
    }
    assert.equal(url, "https://openrouter.ai/api/v1/chat/completions");
    return Response.json({
      id: "synthetic-agent-response",
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
  };

  try {
    // Import after installing the fake boundary: this tests the authored wiring,
    // rather than constructing the budget helper directly.
    const { default: agent } = await import("./agent.ts");
    const prompt = [
      { role: "user" as const, content: [{ type: "text" as const, text: "Synthetic note" }] },
    ];
    await assert.rejects(agent.model.doGenerate({ prompt }), /Server key check failed/);
    assert.deepEqual(requests, ["https://openrouter.ai/api/v1/key"]);

    limit = 1;
    process.env.OPENROUTER_API_KEY = "fake-other-terminal-key";
    await agent.model.doGenerate({ prompt });
    assert.deepEqual(requests, [
      "https://openrouter.ai/api/v1/key",
      "https://openrouter.ai/api/v1/key",
      "https://openrouter.ai/api/v1/chat/completions",
    ]);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = originalKey;
  }
});
