import assert from "node:assert/strict";
import { test } from "node:test";
import { createRetryFetch } from "./retry-fetch.ts";

const request = { method: "POST", body: JSON.stringify({ model: "synthetic" }) };
const endpoint = "https://openrouter.ai/api/v1/chat/completions";

await test("three total attempts use full jitter and release failed bodies before waiting", async () => {
  const events: (string | number)[] = [];
  const retryFetch = createRetryFetch({
    fetchImpl: async () => {
      events.push("request");
      return new Response(
        new ReadableStream({
          cancel: () => {
            events.push("cancel body");
          },
        }),
        { status: 503 },
      );
    },
    random: () => 0.5,
    sleep: async (milliseconds) => {
      events.push(milliseconds);
    },
  });
  const response = await retryFetch(endpoint, request);
  assert.equal(response.status, 503);
  assert.deepEqual(events, [
    "request",
    "cancel body",
    250,
    "request",
    "cancel body",
    500,
    "request",
  ]);
  assert.equal(response.bodyUsed, false);
  await response.body?.cancel();
});

for (const status of [429, 502, 503, 504]) {
  await test(`HTTP ${status} retries once when the next response succeeds`, async () => {
    let calls = 0;
    const retryFetch = createRetryFetch({
      fetchImpl: async () => new Response(null, { status: ++calls === 1 ? status : 200 }),
      sleep: async () => {},
    });
    assert.equal((await retryFetch(endpoint, request)).status, 200);
    assert.equal(calls, 2);
  });
}

await test("Retry-After seconds and dates are minimum waits, even beyond the jitter cap", async () => {
  const delays: number[] = [];
  let calls = 0;
  const retryFetch = createRetryFetch({
    fetchImpl: async () =>
      new Response(null, {
        status: ++calls === 3 ? 200 : 429,
        headers: { "retry-after": calls === 1 ? "60" : "Sun, 01 Nov 2026 00:02:00 GMT" },
      }),
    now: () => Date.parse("2026-11-01T00:00:00Z"),
    random: () => 0.5,
    sleep: async (milliseconds) => {
      delays.push(milliseconds);
    },
  });
  assert.equal((await retryFetch(endpoint, request)).status, 200);
  assert.deepEqual(delays, [60_000, 120_000]);
});

await test("unrepresentable Retry-After is returned instead of retried earlier than requested", async () => {
  let calls = 0;
  const retryFetch = createRetryFetch({
    fetchImpl: async () => {
      calls += 1;
      return new Response(null, { status: 429, headers: { "retry-after": "9999999999" } });
    },
    sleep: async () => assert.fail("Must not shorten the provider wait."),
  });
  assert.equal((await retryFetch(endpoint, request)).status, 429);
  assert.equal(calls, 1);
});

for (const status of [200, 400, 401, 403, 404, 500]) {
  await test(`HTTP ${status} passes through without retry`, async () => {
    let calls = 0;
    const retryFetch = createRetryFetch({
      fetchImpl: async () => {
        calls += 1;
        return new Response("body", { status });
      },
    });
    assert.equal(await (await retryFetch(endpoint, request)).text(), "body");
    assert.equal(calls, 1);
  });
}

await test("an uncertain network exception is not retried", async () => {
  let calls = 0;
  const failure = new TypeError("network failure");
  const retryFetch = createRetryFetch({
    fetchImpl: async () => {
      calls += 1;
      throw failure;
    },
  });
  await assert.rejects(retryFetch(endpoint, request), (error) => error === failure);
  assert.equal(calls, 1);
});

await test("a failed success-response stream never launches another request", async () => {
  let calls = 0;
  const retryFetch = createRetryFetch({
    fetchImpl: async () => {
      calls += 1;
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.error(new Error("broken stream"));
          },
        }),
      );
    },
  });
  await assert.rejects((await retryFetch(endpoint, request)).text(), /broken stream/);
  assert.equal(calls, 1);
});

await test("cancellation during backoff prevents the next request", async () => {
  const controller = new AbortController();
  let calls = 0;
  const retryFetch = createRetryFetch({
    fetchImpl: async () => {
      calls += 1;
      return new Response(null, { status: 503 });
    },
    sleep: async (_milliseconds, signal) => {
      assert.equal(signal, controller.signal);
      controller.abort();
    },
  });
  await assert.rejects(retryFetch(endpoint, { ...request, signal: controller.signal }), {
    name: "AbortError",
  });
  assert.equal(calls, 1);
});

await test("an already cancelled request never reaches fetch", async () => {
  const retryFetch = createRetryFetch({
    fetchImpl: async () => assert.fail("No request expected."),
  });
  await assert.rejects(retryFetch(endpoint, { ...request, signal: AbortSignal.abort() }), {
    name: "AbortError",
  });
});

await test("request bodies supplied as streams are not replayed", async () => {
  let calls = 0;
  const retryFetch = createRetryFetch({
    fetchImpl: async () => {
      calls += 1;
      return new Response(null, { status: 503 });
    },
  });
  assert.equal((await retryFetch(new Request(endpoint, request))).status, 503);
  assert.equal(calls, 1);
});
