import assert from "node:assert/strict";
import { test } from "node:test";
import type { SessionEvent, SessionStreamEvent } from "eve/client";
import { createDurableEveCompactor, observeSummary } from "./context-client.ts";
import { isChatSession, isContextSession, isOrganizeSession } from "./job.ts";

const event = (input: object) =>
  ({
    ...(input as SessionEvent),
    meta: { at: "2026-11-11T00:00:00.000Z", position: { line: 0, index: 0 } },
  }) as SessionStreamEvent;
const result = (turnId: string, summary: string) =>
  event({
    type: "content.completed",
    scope: { turnId },
    data: { kind: "result", value: { summary } },
  });
const consumed = event({
  type: "delivery.consumed",
  data: { deliveryId: "delivery", turnId: "turn", parts: [] },
});
const settled = event({
  type: "delivery.settled",
  data: { deliveryId: "delivery", turnId: "turn", outcome: "handled" },
});
const completed = event({ type: "turn.settled", data: { turnId: "turn", outcome: "completed" } });

await test("a summary is scoped to its settled delivery and ignores another turn's output", () => {
  assert.deepEqual(
    observeSummary(
      [
        consumed,
        result("other", "private unrelated summary"),
        result("turn", "decisions"),
        completed,
        settled,
      ],
      "delivery",
    ),
    { status: "completed", result: { summary: "decisions" } },
  );
  assert.deepEqual(
    observeSummary([consumed, result("turn", "not finished"), completed], "delivery"),
    { status: "running" },
  );
});

await test("missing, cancelled, duplicate and unhandled summary results fail closed", () => {
  const failed = [
    [consumed, completed, settled],
    [consumed, result("turn", "one"), result("turn", "two"), completed, settled],
    [
      consumed,
      event({ type: "turn.settled", data: { turnId: "turn", outcome: "cancelled" } }),
      settled,
    ],
    [
      consumed,
      completed,
      event({ type: "delivery.settled", data: { deliveryId: "delivery", outcome: "unhandled" } }),
    ],
    [event({ type: "session.ended", data: {} })],
  ];
  for (const events of failed)
    assert.deepEqual(observeSummary(events, "delivery"), { status: "failed" });
});

await test("summary delivery uses the private context principal, stable key and strict output schema", async () => {
  const token = "synthetic-context-service-credential";
  const requests: { auth: string | null; body: Record<string, unknown> }[] = [];
  const compactor = createDurableEveCompactor({
    baseUrl: "https://runtime.example.test",
    serviceToken: token,
    fetchImpl: async (_url, init) => {
      requests.push({
        auth: new Headers(init?.headers).get("authorization"),
        body: JSON.parse(typeof init?.body === "string" ? init.body : "{}") as Record<
          string,
          unknown
        >,
      });
      return Response.json({ sessionId: "session", deliveryId: "delivery" }, { status: 202 });
    },
  });
  await compactor.submit("session", "fixed-operation", "safe history");
  await compactor.submit("session", "fixed-operation", "safe history");
  assert.deepEqual(requests[0], requests[1]);
  assert.equal(requests[0]!.auth, `Basic ${Buffer.from(`context:${token}`).toString("base64")}`);
  assert.equal(requests[0]!.body.idempotencyKey, "fixed-operation");
  assert.deepEqual((requests[0]!.body.outputSchema as { required: string[] }).required, [
    "summary",
  ]);
});

await test("expired compaction delivery is not silently replaced", async () => {
  let calls = 0;
  const compactor = createDurableEveCompactor({
    baseUrl: "https://runtime.example.test",
    serviceToken: "synthetic-context-service-credential",
    fetchImpl: async () => {
      calls++;
      return Response.json({ code: "session_expired" }, { status: 410 });
    },
  });
  assert.deepEqual(await compactor.submit("fixed-session", "fixed-key", "history"), {
    status: "expired",
  });
  assert.equal(calls, 1);
});

await test("context jobs have neither chat retrieval nor public research capabilities", () => {
  for (const [initiator, current] of [
    ["context", "context"],
    ["context", "api"],
    ["api", "context"],
    ["context", "chat"],
    ["chat", "context"],
  ]) {
    const session = {
      auth: { initiator: { principalId: initiator! }, current: { principalId: current! } },
    };
    assert.equal(isChatSession(session), false);
    assert.equal(isOrganizeSession(session), false);
    assert.equal(isContextSession(session), initiator === "context" && current === "context");
  }
});

await test("a summary input rejected for its size is terminal, not an uncertain delivery", async () => {
  const compactor = createDurableEveCompactor({
    baseUrl: "https://runtime.example.test",
    serviceToken: "synthetic-context-service-credential",
    fetchImpl: async () => new Response(null, { status: 413 }),
  });
  assert.deepEqual(await compactor.submit("session", "operation", "history"), {
    status: "rejected",
  });
});
