import assert from "node:assert/strict";
import { test } from "node:test";
import { wrapLanguageModel } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { contextBudget } from "./context-budget.ts";

function fixture() {
  const provider = new MockLanguageModelV4({
    doGenerate: {
      content: [{ type: "text", text: "ok" }],
      finishReason: { unified: "stop", raw: "stop" },
      usage: {
        inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
        outputTokens: { total: 1, text: 1, reasoning: 0 },
      },
      warnings: [],
    },
  });
  return {
    provider,
    model: wrapLanguageModel({ model: provider, middleware: contextBudget(21_000) }),
  };
}

await test("provider calls reserve output space and enforce a UTF-8 byte budget", async () => {
  const { model, provider } = fixture();
  await model.doGenerate({
    prompt: [{ role: "user", content: [{ type: "text", text: "a".repeat(200) }] }],
    maxOutputTokens: 32_000,
  });
  assert.equal(provider.doGenerateCalls[0]!.maxOutputTokens, 16_384);
  await assert.rejects(
    async () =>
      await model.doGenerate({
        prompt: [{ role: "user", content: [{ type: "text", text: "漢".repeat(200) }] }],
      }),
    /context budget/,
  );
  assert.equal(provider.doGenerateCalls.length, 1);
});

await test("system instructions and tool schemas count before reaching the provider", async () => {
  const { model, provider } = fixture();
  await assert.rejects(
    async () =>
      await model.doGenerate({ prompt: [{ role: "system", content: "x".repeat(1_000) }] }),
    /context budget/,
  );
  await assert.rejects(
    async () =>
      await model.doGenerate({
        prompt: [],
        tools: [
          {
            type: "function",
            name: "search_notes",
            description: "x".repeat(1_000),
            inputSchema: { type: "object" },
          },
        ],
      }),
    /context budget/,
  );
  assert.equal(provider.doGenerateCalls.length, 0);
});

await test("every provider boundary rechecks context authorization, including streams and summary calls", async () => {
  const provider = new MockLanguageModelV4();
  let checks = 0;
  const model = wrapLanguageModel({
    model: provider,
    middleware: contextBudget(100_000, async () => {
      checks++;
      return false;
    }),
  });
  await assert.rejects(async () => await model.doGenerate({ prompt: [] }), /no longer authorized/);
  await assert.rejects(async () => await model.doStream({ prompt: [] }), /no longer authorized/);
  assert.equal(checks, 2);
  assert.equal(provider.doGenerateCalls.length, 0);
  assert.equal(provider.doStreamCalls.length, 0);
});

await test("an over-budget call records its reason before it is refused", async () => {
  const provider = fixture().provider;
  let recorded = 0;
  const model = wrapLanguageModel({
    model: provider,
    middleware: contextBudget(
      21_000,
      async () => true,
      async () => void recorded++,
    ),
  });
  await assert.rejects(
    async () =>
      model.doGenerate({
        prompt: [{ role: "user", content: [{ type: "text", text: "a".repeat(2_000) }] }],
      }),
    /budget exceeded/,
  );
  assert.equal(recorded, 1);
  assert.equal(provider.doGenerateCalls.length, 0);
});
