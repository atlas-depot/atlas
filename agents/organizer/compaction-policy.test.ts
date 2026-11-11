import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { wrapLanguageModel } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { contextBudget } from "./context-budget.ts";
import { preserveCompactionFacts } from "./compaction-policy.ts";

const checkpoint = "You are performing a CONTEXT CHECKPOINT COMPACTION. Create a handoff summary.";
const makeProvider = () =>
  new MockLanguageModelV4({
    doGenerate: {
      content: [{ type: "text", text: "ok" }],
      finishReason: { unified: "stop", raw: "stop" },
      usage: {
        inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
        outputTokens: { total: 1, text: 1, reasoning: 0 },
      },
      warnings: [],
    },
    doStream: {
      stream: new ReadableStream<never>({ start: (controller) => controller.close() }),
    },
  });

const makeModel = (provider: MockLanguageModelV4) =>
  wrapLanguageModel({ model: provider, middleware: preserveCompactionFacts() });

await test("the installed eve checkpoint still exposes the supported system marker", async () => {
  const promptModule = new URL(
    "./dist/src/harness/compaction/prompt.js",
    import.meta.resolve("eve/package.json"),
  );
  const source = await readFile(promptModule, "utf8");
  assert.ok(source.includes("You are performing a CONTEXT CHECKPOINT COMPACTION."));
});

await test("native summaries receive preservation instructions on generate and stream", async () => {
  const provider = makeProvider();
  const model = makeModel(provider);
  const params = { prompt: [{ role: "system" as const, content: checkpoint }] };
  await model.doGenerate(params);
  await model.doStream(params);
  for (const call of [provider.doGenerateCalls[0]!, provider.doStreamCalls[0]!]) {
    const message = call.prompt[0]!;
    assert.equal(message.role, "system");
    if (message.role !== "system") throw new Error("Missing system prompt");
    assert.ok(message.content.startsWith(checkpoint));
    assert.match(message.content, /even after their task is completed/);
    assert.match(message.content, /previous checkpoint/);
    assert.match(message.content, /source references and revisions/);
  }
  assert.equal(params.prompt[0].content, checkpoint);
});

await test("ordinary instructions and a checkpoint marker in user content stay unchanged", async () => {
  const provider = makeProvider();
  const model = makeModel(provider);
  const prompt = [
    { role: "system" as const, content: "Prepare a useful draft." },
    { role: "user" as const, content: [{ type: "text" as const, text: checkpoint }] },
  ];
  await model.doGenerate({ prompt });
  assert.deepEqual(provider.doGenerateCalls[0]!.prompt, prompt);
});

await test("the context budget includes added policy and still checks authorization", async () => {
  const provider = makeProvider();
  let authorized = true;
  let checks = 0;
  const model = wrapLanguageModel({
    model: provider,
    middleware: [
      preserveCompactionFacts(),
      contextBudget(21_000, async () => {
        checks++;
        return authorized;
      }),
    ],
  });
  await assert.rejects(
    async () => await model.doGenerate({ prompt: [{ role: "system", content: checkpoint }] }),
    /context budget exceeded/,
  );
  authorized = false;
  await assert.rejects(
    async () => await model.doStream({ prompt: [{ role: "system", content: checkpoint }] }),
    /no longer authorized/,
  );
  assert.equal(checks, 2);
  assert.equal(provider.doGenerateCalls.length, 0);
  assert.equal(provider.doStreamCalls.length, 0);
});
