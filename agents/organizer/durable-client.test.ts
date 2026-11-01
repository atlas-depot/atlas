import assert from "node:assert/strict";
import { test } from "node:test";
import { ClientError, type SessionEvent, type SessionStreamEvent } from "eve/client";
import { createDurableEveOrganizer } from "./durable-client.ts";

const reference = { sessionId: "session-1", deliveryId: "delivery-1" };
const serviceToken = "synthetic-only-organizer-service-token";
const completedAt = Date.parse("2026-11-01T00:00:30Z");
function event(input: SessionEvent): SessionStreamEvent {
  return {
    ...input,
    meta: { at: new Date(completedAt).toISOString(), position: { line: 0, index: 0 } },
  };
}
const scope = { turnId: "turn-1" };
const consumed = event({
  type: "delivery.consumed",
  data: { ...reference, turnId: "turn-1", parts: [] },
});
const finished = [
  event({
    type: "model.settled",
    scope,
    data: { runId: "model-1", outcome: "completed", finishReason: "stop" },
  }),
  event({
    type: "content.completed",
    scope,
    data: {
      partId: "reply-1",
      runId: "model-1",
      kind: "text",
      phase: "reply",
      value: "# Kept source facts",
    },
  }),
  event({
    type: "turn.settled",
    scope,
    data: { turnId: "turn-1", outcome: "completed", reply: ["reply-1"] },
  }),
  event({
    type: "delivery.settled",
    data: { deliveryId: "delivery-1", turnId: "turn-1", outcome: "handled" },
  }),
];
const source = {
  id: "https://example.com/doc",
  url: "https://example.com/doc",
  title: "Primary document",
};
const research = [
  event({
    type: "call.requested",
    scope,
    data: {
      callId: "research-1",
      owner: { runId: "model-0" },
      capability: { kind: "tool", name: "research" },
    },
  }),
  event({
    type: "call.settled",
    scope,
    data: {
      callId: "research-1",
      outcome: "completed",
      output: { text: "Sourced fact", sources: [source], usage: {} },
    },
  }),
];

function fixture({
  events = [consumed, ...finished],
  snapshotError,
  endError,
  fetchImpl = async () => Response.json({ ok: true, ...reference }, { status: 202 }),
}: {
  events?: SessionStreamEvent[];
  snapshotError?: Error;
  endError?: Error;
  fetchImpl?: typeof fetch;
} = {}) {
  const calls = { ends: 0, reads: 0 };
  const adapter = createDurableEveOrganizer({
    baseUrl: "https://organizer.example.com",
    serviceToken,
    fetchImpl,
    client: {
      sessions: {
        attach(sessionId) {
          assert.equal(sessionId, reference.sessionId);
          return {
            async snapshot() {
              calls.reads++;
              if (snapshotError) throw snapshotError;
              return { events, session: { sessionId, streamIndex: events.length } };
            },
            async end() {
              calls.ends++;
              if (endError) throw endError;
              return {
                ...reference,
                async *stream() {},
                async result() {
                  throw new Error("No blocking receipt read expected");
                },
              };
            },
          };
        },
      },
    },
  });
  return { adapter, calls };
}

await test("submission retries carry the same operation identity, without browser credentials or redirects", async () => {
  const requests: RequestInit[] = [];
  const { adapter } = fixture({
    fetchImpl: async (url, init) => {
      assert.equal(url, "https://organizer.example.com/eve/v1/session/session-1");
      requests.push(init ?? {});
      return Response.json({ ok: true, ...reference }, { status: 202 });
    },
  });
  const input = {
    sessionId: reference.sessionId,
    operationId: "atlas-run-1",
    note: { title: "Note", content: "Fact" },
  };
  assert.deepEqual(await adapter.submit(input), reference);
  assert.deepEqual(await adapter.submit(input), reference);
  assert.equal(requests[0]?.body, requests[1]?.body);
  const body = requests[0]?.body;
  assert.equal(typeof body, "string");
  if (typeof body !== "string") throw new Error("Expected JSON request body");
  assert.deepEqual(JSON.parse(body), {
    idempotencyKey: "atlas-run-1",
    message: JSON.stringify(input.note),
  });
  assert.equal(requests[0]?.credentials, "omit");
  assert.equal(requests[0]?.redirect, "error");
  assert.equal(new Headers(requests[0]?.headers).get("cookie"), null);
});

await test("a lost creation response stays uncertain and is not automatically replayed", async () => {
  let attempts = 0;
  const { adapter } = fixture({
    fetchImpl: async () => {
      attempts++;
      throw new Error("sensitive provider body");
    },
  });
  await assert.rejects(
    adapter.submit({
      sessionId: reference.sessionId,
      operationId: "run",
      note: { title: "", content: "" },
    }),
    /submission is unconfirmed/,
  );
  assert.equal(attempts, 1);
});

await test("allocation sends no note and waits for a canonical empty session", async () => {
  const bodies: unknown[] = [];
  const ids = ["candidate-loser", "session-1", "session-1"];
  const { adapter } = fixture({
    fetchImpl: async (_url, init) => {
      if (typeof init?.body !== "string") throw new Error("Expected JSON request body");
      bodies.push(JSON.parse(init.body));
      return Response.json({ sessionId: ids.shift() }, { status: 202 });
    },
  });
  assert.deepEqual(await adapter.allocate({ operationId: "run" }), {
    sessionId: "session-1",
    deliveryId: null,
  });
  assert.deepEqual(bodies, [
    { operationId: "run" },
    { operationId: "run" },
    { operationId: "run" },
  ]);
});

await test("allocation failure cannot disclose note content or start generation", async () => {
  const { adapter } = fixture({
    fetchImpl: async (_url, init) => {
      if (typeof init?.body !== "string") throw new Error("Expected JSON request body");
      assert.deepEqual(JSON.parse(init.body), { operationId: "run" });
      throw new Error("lost empty allocation response");
    },
  });
  await assert.rejects(adapter.allocate({ operationId: "run" }), /No model input was submitted/);
});

await test("malformed acceptance is rejected without leaking the response", async () => {
  const { adapter } = fixture({
    fetchImpl: async () => Response.json({ sessionId: "secret", deliveryId: 2 }, { status: 202 }),
  });
  await assert.rejects(
    adapter.submit({
      sessionId: reference.sessionId,
      operationId: "run",
      note: { title: "", content: "" },
    }),
    /submission is unconfirmed/,
  );
});

await test("an expired fixed session is terminal and never replaced by another allocation", async () => {
  for (const [status, code] of [
    [410, "session_expired"],
    [409, "session_not_active"],
  ] as const) {
    const { adapter } = fixture({
      fetchImpl: async (url) => {
        assert.equal(url, "https://organizer.example.com/eve/v1/session/session-1");
        return Response.json({ code }, { status });
      },
    });
    assert.deepEqual(
      await adapter.submit({
        sessionId: reference.sessionId,
        operationId: "run",
        note: { title: "", content: "" },
      }),
      { status: "expired" },
    );
  }
});

await test("finite inspection reconstructs a draft and finish time after a new client starts", async () => {
  const first = fixture();
  const restarted = fixture();
  const expected = {
    status: "draft",
    draft: { markdown: "# Kept source facts", sources: [] },
    completedAt,
  };
  assert.deepEqual(await first.adapter.inspect(reference), expected);
  assert.deepEqual(await restarted.adapter.inspect(reference), expected);
  assert.equal(restarted.calls.ends, 0);
});

await test("sources come only from completed research for the accepted turn", async () => {
  const events = [consumed, ...research, ...finished];
  const { adapter } = fixture({ events });
  assert.deepEqual(await adapter.inspect(reference), {
    status: "draft",
    draft: { markdown: "# Kept source facts", sources: [source] },
    completedAt,
  });
  const otherTurn = research.map((value) => ({ ...value, scope: { turnId: "other-turn" } }));
  const without = fixture({ events: [consumed, ...otherTurn, ...finished] });
  const result = await without.adapter.inspect(reference);
  assert.equal(result.status, "draft");
  if (result.status === "draft") assert.deepEqual(result.draft.sources, []);
});

await test("unfinished research is progress, never a completed draft", async () => {
  const { adapter } = fixture({ events: [consumed, research[0]!] });
  assert.deepEqual(await adapter.inspect(reference), { status: "running", phase: "researching" });
});

await test("a turn finishing before its delivery settles remains in progress", async () => {
  assert.deepEqual(
    await fixture({ events: [consumed, ...finished.slice(0, -1)] }).adapter.inspect(reference),
    { status: "running", phase: "writing" },
  );
});

await test("truncated output and interrupted parts are not successful drafts", async () => {
  for (const events of [
    [
      consumed,
      ...finished.map((value) =>
        value.type === "model.settled"
          ? event({ ...value, data: { ...value.data, finishReason: "length" } })
          : value,
      ),
    ],
    [
      consumed,
      ...finished.map((value) =>
        value.type === "content.completed"
          ? event({ ...value, data: { ...value.data, interrupted: true } })
          : value,
      ),
    ],
    [
      consumed,
      ...finished.map((value) =>
        value.type === "content.completed"
          ? event({ ...value, data: { ...value.data, phase: "narration" } })
          : value,
      ),
    ],
  ]) {
    assert.equal((await fixture({ events }).adapter.inspect(reference)).status, "failed");
  }
});

await test("invalid research metadata fails closed", async () => {
  const events = research.map((value) =>
    value.type === "call.settled"
      ? event({
          ...value,
          data: { ...value.data, output: { text: "unsupported", sources: [], usage: {} } },
        })
      : value,
  );
  assert.deepEqual(
    await fixture({ events: [consumed, ...events, ...finished] }).adapter.inspect(reference),
    { status: "failed", reason: "invalid_draft" },
  );
});

await test("read failures leave generation running and permit later inspection", async () => {
  const { adapter, calls } = fixture({ snapshotError: new Error("network") });
  await assert.rejects(adapter.inspect(reference), /Existing work was not cancelled/);
  assert.equal(calls.ends, 0);
});

await test("retirement verifies the end independently after losing its response", async () => {
  const ended = event({ type: "session.ended", data: { outcome: "completed" } });
  const { adapter } = fixture({ events: [ended], endError: new Error("lost response") });
  assert.deepEqual(await adapter.retire(reference), { status: "ended" });
});

await test("an empty history or failed cleanup is not proof of retirement", async () => {
  await assert.rejects(
    fixture({ events: [], endError: new Error("inactive") }).adapter.retire(reference),
    /retirement is unconfirmed/,
  );
});

await test("expired history is recognized for read and cleanup", async () => {
  const error = new ClientError(410, JSON.stringify({ code: "session_expired" }));
  const { adapter } = fixture({ snapshotError: error, endError: error });
  assert.deepEqual(await adapter.inspect(reference), { status: "failed", reason: "expired" });
  assert.deepEqual(await adapter.retire(reference), { status: "expired" });
});

await test("private runtime credentials cannot be sent to insecure remote or credential-bearing endpoints", () => {
  for (const baseUrl of [
    "http://remote.example.com",
    "https://user:password@example.com",
    "https://example.com?token=x",
    "https://example.com#x",
  ]) {
    assert.throws(
      () => createDurableEveOrganizer({ baseUrl, serviceToken }),
      /endpoint or service credential/,
    );
  }
});

await test("deployment access supplements service auth and cannot follow redirects", async () => {
  const adapter = createDurableEveOrganizer({
    baseUrl: "https://organizer.example.com",
    serviceToken,
    deploymentProtectionSecret: "synthetic-preview-access",
    fetchImpl: async (_url, init) => {
      const headers = new Headers(init?.headers);
      assert.equal(headers.get("x-vercel-protection-bypass"), "synthetic-preview-access");
      assert.equal(
        headers.get("authorization"),
        `Basic ${Buffer.from(`atlas-api:${serviceToken}`).toString("base64")}`,
      );
      assert.equal(init?.redirect, "error");
      return Response.json({ ok: true, ...reference }, { status: 202 });
    },
  });
  assert.deepEqual(
    await adapter.submit({
      sessionId: reference.sessionId,
      operationId: "run",
      note: { title: "Synthetic", content: "Test" },
    }),
    reference,
  );
});
