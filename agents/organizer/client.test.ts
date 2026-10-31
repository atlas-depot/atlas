import assert from "node:assert/strict";
import { test } from "node:test";
import {
  Client,
  ClientError,
  type SendTurnInput,
  type SessionEvent,
  type SessionStreamEvent,
} from "eve/client";
import type { Delivery, DeliveryResult } from "eve/sessions";
import { createEveOrganizer } from "./client.ts";

const signal = () => new AbortController().signal;
const url = "https://example.com/evidence";
const research = {
  text: "Supported research.",
  sources: [{ id: url, url, title: "Evidence" }],
  usage: { inputTokens: 20, outputTokens: 10 },
};
const completed: DeliveryResult = {
  sessionId: "session-1",
  deliveryId: "delivery-1",
  status: "completed",
  outcome: "handled",
  sessionEnded: false,
  reply: "# Organized note",
  data: undefined,
  interactions: [],
};

function event(value: SessionEvent): SessionStreamEvent {
  return { ...value, meta: { at: "2026-11-01T00:00:00Z", position: { line: 0, index: 0 } } };
}
const consumed = event({
  type: "delivery.consumed",
  data: { deliveryId: "delivery-1", turnId: "turn-1", parts: [] },
});
const replyCompleted = event({
  type: "content.completed",
  scope: { turnId: "turn-1" },
  data: {
    partId: "reply-1",
    runId: "reply-run",
    kind: "text",
    phase: "reply",
    value: completed.reply,
  },
});
function modelSettled(
  finishReason?: string,
  outcome: "completed" | "failed" = "completed",
  runId = "reply-run",
) {
  return event({
    type: "model.settled",
    scope: { turnId: "turn-1" },
    data: { runId, outcome, ...(finishReason === undefined ? {} : { finishReason }) },
  });
}
function researchEvents(name = "research", output = research): SessionStreamEvent[] {
  return [
    event({
      type: "call.requested",
      scope: { turnId: "turn-1" },
      data: { callId: "call-1", owner: { runId: "run-1" }, capability: { kind: "tool", name } },
    }),
    event({
      type: "call.settled",
      scope: { turnId: "turn-1" },
      data: { callId: "call-1", outcome: "completed", output },
    }),
  ];
}

function fixture({
  events = [],
  finalEvents = [replyCompleted, modelSettled("stop")],
  result = async () => completed,
  beforeStream = () => {},
  endResult = async () => ({ ...completed, outcome: "applied" as const, sessionEnded: true }),
  history,
  newCleanupSignal = signal,
}: {
  events?: SessionStreamEvent[];
  finalEvents?: SessionStreamEvent[];
  result?: () => Promise<DeliveryResult>;
  beforeStream?: () => void;
  endResult?: () => Promise<DeliveryResult>;
  history?: (attempt: number, signal?: AbortSignal) => AsyncIterable<SessionStreamEvent>;
  newCleanupSignal?: () => AbortSignal;
} = {}) {
  const calls = { creates: [] as SendTurnInput[], cancels: 0, ends: 0, histories: 0 };
  const cleanups: AbortSignal[] = [];
  let endFailure: Error | undefined;
  let emptyHistory = false;
  const delivery: Delivery = {
    sessionId: "session-1",
    deliveryId: "delivery-1",
    async *stream() {
      beforeStream();
      yield consumed;
      yield* events;
      yield* finalEvents;
    },
    result,
  };
  const control: Delivery = {
    ...delivery,
    result: async () => ({ ...completed, outcome: "applied" }),
  };
  const session = {
    async cancel(options?: { signal?: AbortSignal; turnId?: string | null }) {
      calls.cancels += 1;
      assert.equal(options?.signal?.aborted, false);
      return control;
    },
    async end(options?: { signal?: AbortSignal; reason?: string }) {
      calls.ends += 1;
      assert.equal(options?.signal?.aborted, false);
      if (endFailure) throw endFailure;
      return { ...control, result: endResult };
    },
    async *stream(options?: { startIndex?: number; follow?: boolean; signal?: AbortSignal }) {
      calls.histories += 1;
      assert.equal(options?.startIndex, 0);
      assert.equal(options?.follow, false);
      if (history) yield* history(calls.histories, options?.signal);
      else if (!emptyHistory) yield consumed;
    },
  };
  const prepare = createEveOrganizer({
    client: {
      sessions: {
        async create(input) {
          calls.creates.push(input);
          return { session, delivery };
        },
      },
    },
    cleanupSignal: () => {
      const cleanup = newCleanupSignal();
      cleanups.push(cleanup);
      return cleanup;
    },
  });
  return {
    prepare,
    calls,
    cleanups,
    failEnd(error?: Error) {
      endFailure = error;
    },
    expireHistory() {
      emptyHistory = true;
    },
  };
}

await test("the actual eve Client satisfies the adapter without a custom transport", () => {
  createEveOrganizer({
    client: new Client({ baseUrl: "http://127.0.0.1:2027" }),
    cleanupSignal: signal,
  });
});

await test("a no-research draft stays readable until explicit, coalesced acknowledgement", async () => {
  const f = fixture();
  const note = { title: "Private note", content: "Original content" };
  const prepared = await f.prepare(note, { signal: signal() });
  assert.deepEqual(prepared.draft, { markdown: "# Organized note", sources: [] });
  assert.equal(f.calls.creates[0]?.message, JSON.stringify(note));
  assert.equal(f.calls.ends, 0);
  assert.deepEqual(await Promise.all([prepared.acknowledge(), prepared.acknowledge()]), [
    { status: "ended" },
    { status: "ended" },
  ]);
  await prepared.acknowledge();
  assert.equal(f.calls.ends, 1);
});

await test("only actual research tool results supply sources, deduplicated by URL", async () => {
  const f = fixture({ events: [...researchEvents(), ...researchEvents()] });
  const progress: string[] = [];
  const prepared = await f.prepare(
    { title: "", content: "Public research" },
    { signal: signal(), onProgress: (state) => progress.push(state) },
  );
  assert.deepEqual(prepared.draft.sources, research.sources);
  assert.deepEqual(progress, ["researching", "researching"]);
  const unrelated = fixture({ events: researchEvents("other_tool") });
  assert.deepEqual(
    (await unrelated.prepare({ title: "", content: "Note" }, { signal: signal() })).draft.sources,
    [],
  );
});

await test("invalid research evidence fails safely and retires the session", async () => {
  const unsafe = {
    ...research,
    sources: [{ id: "javascript:alert(1)", url: "javascript:alert(1)", title: "Unsafe" }],
  };
  const f = fixture({ events: researchEvents("research", unsafe) });
  await assert.rejects(
    f.prepare({ title: "", content: "Note" }, { signal: signal() }),
    /^Error: Organization did not return a complete draft\.$/,
  );
  assert.equal(f.calls.cancels, 1);
  assert.equal(f.calls.ends, 1);
});

await test("a failed research call cannot become an apparently complete researched draft", async () => {
  const requested = researchEvents()[0];
  assert.ok(requested);
  const f = fixture({
    events: [
      requested,
      event({ type: "call.settled", data: { callId: "call-1", outcome: "failed" } }),
    ],
  });
  await assert.rejects(
    f.prepare({ title: "", content: "Note" }, { signal: signal() }),
    /did not return a complete draft/,
  );
  assert.equal(f.calls.ends, 1);
});

for (const status of ["failed", "cancelled", "awaiting-input"] as const) {
  await test(`${status} delivery is not a successful draft`, async () => {
    const result: DeliveryResult =
      status === "failed"
        ? {
            ...completed,
            status,
            error: { code: "provider_error", message: "Sensitive provider diagnostic" },
          }
        : { ...completed, status };
    const f = fixture({ result: async () => result });
    await assert.rejects(
      f.prepare({ title: "", content: "Note" }, { signal: signal() }),
      /^Error: Organization did not return a complete draft\.$/,
    );
    assert.equal(f.calls.ends, 1);
  });
}

await test("empty completed output is rejected", async () => {
  const f = fixture({ result: async () => ({ ...completed, reply: "  " }) });
  await assert.rejects(
    f.prepare({ title: "", content: "Note" }, { signal: signal() }),
    /did not return a complete draft/,
  );
});

for (const finishReason of ["length", "content-filter", "error", undefined]) {
  await test(`completed text with finish reason ${String(finishReason)} is rejected`, async () => {
    const f = fixture({ finalEvents: [replyCompleted, modelSettled(finishReason)] });
    await assert.rejects(
      f.prepare({ title: "", content: "Note" }, { signal: signal() }),
      /did not return a complete draft/,
    );
    assert.equal(f.calls.ends, 1);
  });
}

await test("a failed reply model cannot become success through a completed delivery", async () => {
  const f = fixture({ finalEvents: [replyCompleted, modelSettled("stop", "failed")] });
  await assert.rejects(
    f.prepare({ title: "", content: "Note" }, { signal: signal() }),
    /did not return a complete draft/,
  );
});

await test("missing reply model settlement is rejected", async () => {
  const f = fixture({ finalEvents: [replyCompleted] });
  await assert.rejects(
    f.prepare({ title: "", content: "Note" }, { signal: signal() }),
    /did not return a complete draft/,
  );
});

await test("a different model's later stop cannot bless a truncated reply", async () => {
  const f = fixture({
    finalEvents: [
      replyCompleted,
      modelSettled("length"),
      modelSettled("stop", "completed", "unrelated-run"),
    ],
  });
  await assert.rejects(
    f.prepare({ title: "", content: "Note" }, { signal: signal() }),
    /did not return a complete draft/,
  );
});

await test("intermediate tool-calls allow a final reply model to finish with stop", async () => {
  const f = fixture({
    events: [modelSettled("tool-calls", "completed", "research-run"), ...researchEvents()],
  });
  const prepared = await f.prepare({ title: "", content: "Note" }, { signal: signal() });
  assert.equal(prepared.draft.markdown, completed.reply);
  assert.deepEqual(prepared.draft.sources, research.sources);
});

await test("pre-cancellation performs no remote work", async () => {
  const f = fixture();
  await assert.rejects(f.prepare({ title: "", content: "Note" }, { signal: AbortSignal.abort() }), {
    name: "AbortError",
  });
  assert.equal(f.calls.creates.length, 0);
});

await test("late cancellation explicitly cancels work and retires with a fresh signal", async () => {
  const controller = new AbortController();
  const f = fixture({
    result: async () => {
      controller.abort();
      return completed;
    },
  });
  await assert.rejects(f.prepare({ title: "", content: "Note" }, { signal: controller.signal }), {
    name: "AbortError",
  });
  assert.equal(f.calls.cancels, 1);
  assert.equal(f.calls.ends, 1);
  assert.equal(f.cleanups.length, 2);
  assert.notEqual(f.cleanups[0], controller.signal);
});

await test("failed acknowledgement stays retryable and never claims deletion", async () => {
  const f = fixture();
  const prepared = await f.prepare({ title: "", content: "Note" }, { signal: signal() });
  f.failEnd(new Error("Sensitive transport details"));
  await assert.rejects(
    prepared.acknowledge(),
    /^Error: Organization session cleanup is unconfirmed\.$/,
  );
  f.failEnd();
  assert.deepEqual(await prepared.acknowledge(), { status: "ended" });
  assert.equal(f.calls.ends, 2);
  assert.notEqual(f.cleanups[0], f.cleanups[1]);
});

await test("zero-retention expiry of the end receipt confirms unreadability", async () => {
  const f = fixture({
    endResult: async () => {
      throw new ClientError(410, '{"code":"session_expired"}');
    },
  });
  const prepared = await f.prepare({ title: "", content: "Note" }, { signal: signal() });
  assert.deepEqual(await prepared.acknowledge(), { status: "expired" });
});

await test("an empty full history after accepted end handles retention's read race", async () => {
  const f = fixture({
    endResult: async () => {
      throw new Error("Settlement stream ended early");
    },
  });
  const prepared = await f.prepare({ title: "", content: "Note" }, { signal: signal() });
  f.expireHistory();
  assert.deepEqual(await prepared.acknowledge(), { status: "expired" });
  assert.equal(f.calls.histories, 1);
});

await test("404 or still-readable history does not count as confirmed cleanup", async () => {
  const f = fixture({
    endResult: async () => {
      throw new ClientError(404, '{"code":"not_found"}');
    },
  });
  const prepared = await f.prepare({ title: "", content: "Note" }, { signal: signal() });
  await assert.rejects(prepared.acknowledge(), /cleanup is unconfirmed/);
  assert.equal(f.calls.histories, 4);
});

await test("retention race retries metadata-only history until explicit expiry", async () => {
  const f = fixture({
    endResult: async () => {
      throw new Error("Settlement stream ended early");
    },
    async *history(attempt) {
      if (attempt === 1) yield event({ type: "session.started", data: {} });
      else throw new ClientError(410, '{"code":"session_expired"}');
    },
  });
  const prepared = await f.prepare({ title: "", content: "Note" }, { signal: signal() });
  assert.deepEqual(await prepared.acknowledge(), { status: "expired" });
  assert.equal(f.calls.histories, 2);
});

await test("a terminal session event confirms retirement without claiming deletion", async () => {
  const f = fixture({
    endResult: async () => {
      throw new Error("Settlement stream ended early");
    },
    async *history() {
      yield consumed;
      yield event({ type: "session.ended", data: { outcome: "completed" } });
    },
  });
  const prepared = await f.prepare({ title: "", content: "Note" }, { signal: signal() });
  assert.deepEqual(await prepared.acknowledge(), { status: "ended" });
});

await test("verification gets a fresh deadline after the receipt read expires", async () => {
  const receiptDeadline = new AbortController();
  let cleanupCount = 0;
  const f = fixture({
    newCleanupSignal: () => (++cleanupCount === 1 ? receiptDeadline.signal : signal()),
    endResult: async () => {
      receiptDeadline.abort();
      throw new Error("Receipt deadline");
    },
  });
  f.expireHistory();
  const prepared = await f.prepare({ title: "", content: "Note" }, { signal: signal() });
  assert.deepEqual(await prepared.acknowledge(), { status: "expired" });
  assert.equal(f.cleanups.length, 2);
  assert.notEqual(f.cleanups[0], f.cleanups[1]);
});

await test("an expired verification deadline cannot bless a late empty history", async () => {
  const verification = new AbortController();
  const f = fixture({
    newCleanupSignal: () => verification.signal,
    endResult: async () => {
      throw new Error("Settlement stream ended early");
    },
    async *history() {
      verification.abort();
      yield* [];
    },
  });
  const prepared = await f.prepare({ title: "", content: "Note" }, { signal: signal() });
  await assert.rejects(prepared.acknowledge(), /cleanup is unconfirmed/);
  assert.equal(f.calls.histories, 1);
});

await test("verification cancellation interrupts the retry delay", async () => {
  const verification = new AbortController();
  const f = fixture({
    newCleanupSignal: () => verification.signal,
    endResult: async () => {
      throw new Error("Settlement stream ended early");
    },
    async *history() {
      yield consumed;
      setTimeout(() => verification.abort(), 10);
    },
  });
  const prepared = await f.prepare({ title: "", content: "Note" }, { signal: signal() });
  await assert.rejects(prepared.acknowledge(), /cleanup is unconfirmed/);
  assert.equal(f.calls.histories, 1);
});

await test("cleanup failure after generation failure stays visible", async () => {
  const f = fixture({
    beforeStream: () => {
      throw new Error("Provider secret diagnostic");
    },
  });
  f.failEnd(new Error("End failed"));
  await assert.rejects(
    f.prepare({ title: "", content: "Note" }, { signal: signal() }),
    /^Error: Organization session cleanup is unconfirmed\.$/,
  );
});
