import assert from "node:assert/strict";
import { test } from "node:test";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { createResearch } from "./research.ts";

const url = "https://example.com/release";
const text = "The release is on 14 October. [Source](https://example.com/release)";
const annotation = {
  type: "url_citation",
  url_citation: { url, title: "Official release", start_index: 29, end_index: text.length },
};

function response({
  content = text,
  annotations = [annotation],
  finishReason = "stop",
  cost = 0.012,
}: {
  content?: string;
  annotations?: unknown[];
  finishReason?: string;
  cost?: number | null;
} = {}) {
  return Response.json({
    id: "synthetic-research",
    model: "openai/gpt-4.1-mini",
    choices: [
      {
        index: 0,
        message: { role: "assistant", content, annotations },
        finish_reason: finishReason,
      },
    ],
    usage: {
      prompt_tokens: 20,
      completion_tokens: 10,
      total_tokens: 30,
      ...(cost === null ? {} : { cost }),
    },
  });
}

function setup(fetchImpl: typeof fetch) {
  const provider = createOpenRouter({ apiKey: "synthetic-key", fetch: fetchImpl });
  return createResearch({
    model: provider("openai/gpt-4.1-mini"),
    webSearch: provider.tools.webSearch({}),
  });
}

await test("one real provider request uses server search and preserves cited evidence and usage", async () => {
  let calls = 0;
  const research = setup(async (input, init) => {
    calls += 1;
    assert.equal(
      input instanceof Request ? input.url : input.toString(),
      "https://openrouter.ai/api/v1/chat/completions",
    );
    assert.ok(typeof init?.body === "string");
    const body: unknown = JSON.parse(init.body);
    assert.ok(body && typeof body === "object");
    assert.deepEqual(Reflect.get(body, "tools"), [{ type: "openrouter:web_search" }]);
    assert.equal(Reflect.get(body, "plugins"), undefined);
    return response({ annotations: [annotation, annotation] });
  });
  assert.deepEqual(await research("When is the public release?", new AbortController().signal), {
    text,
    sources: [{ id: url, url, title: "Official release" }],
    usage: { inputTokens: 20, outputTokens: 10, costUsd: 0.012 },
  });
  assert.equal(calls, 1);
});

await test("an absent reported cost stays absent rather than becoming a zero-cost claim", async () => {
  const research = setup(async () => response({ cost: null }));
  const result = await research("Public question", new AbortController().signal);
  assert.deepEqual(result.usage, { inputTokens: 20, outputTokens: 10 });
});

await test("links written in prose do not substitute for provider citation evidence", async () => {
  const research = setup(async () => response({ annotations: [] }));
  await assert.rejects(research("Public question", new AbortController().signal), {
    message: "Research returned no verified sources.",
  });
});

for (const sourceUrl of ["javascript:alert(1)", "https://user:password@example.com", "not a URL"]) {
  await test(`rejects unsafe provider source ${sourceUrl}`, async () => {
    const research = setup(async () =>
      response({
        annotations: [
          { ...annotation, url_citation: { ...annotation.url_citation, url: sourceUrl } },
        ],
      }),
    );
    await assert.rejects(research("Public question", new AbortController().signal), {
      message: "Research returned an invalid source.",
    });
  });
}

for (const result of [
  { content: "  " },
  { finishReason: "length" },
  { finishReason: "content_filter" },
]) {
  await test(`rejects incomplete answer ${JSON.stringify(result)}`, async () => {
    const research = setup(async () => response(result));
    await assert.rejects(research("Public question", new AbortController().signal), {
      message: "Research did not return a complete answer.",
    });
  });
}

await test("a provider failure has one attempt and does not expose provider diagnostics", async () => {
  let calls = 0;
  const research = setup(async () => {
    calls += 1;
    return new Response("private provider diagnostic", { status: 503 });
  });
  await assert.rejects(research("Public question", new AbortController().signal), {
    message: "Research request failed.",
  });
  assert.equal(calls, 1);
});

await test("blank input and pre-cancelled requests do not reach the provider", async () => {
  const research = setup(async () => assert.fail("No provider call expected."));
  await assert.rejects(research("  ", new AbortController().signal), {
    message: "A research question is required.",
  });
  await assert.rejects(research("Public question", AbortSignal.abort("private reason")), {
    name: "AbortError",
    message: "Research cancelled.",
  });
});

await test("cancellation reaches the actual HTTP boundary and keeps its reason private", async () => {
  const controller = new AbortController();
  const research = setup(async (_input, init) => {
    assert.ok(init?.signal);
    const signal = init.signal;
    return new Promise<Response>((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      controller.abort("private reason");
    });
  });
  await assert.rejects(research("Public question", controller.signal), {
    name: "AbortError",
    message: "Research cancelled.",
  });
});

await test("a provider ignoring cancellation cannot return a successful late result", async () => {
  const controller = new AbortController();
  const research = setup(async () => {
    controller.abort("private reason");
    return response();
  });
  await assert.rejects(research("Public question", controller.signal), {
    name: "AbortError",
    message: "Research cancelled.",
  });
});
