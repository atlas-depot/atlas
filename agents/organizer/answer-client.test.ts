import assert from "node:assert/strict";
import { test } from "node:test";
import type { SessionEvent, SessionStreamEvent } from "eve/client";
import { evidenceId } from "../../server/conversation-answer.ts";
import type { NotePassageSource } from "../../shared/passages.ts";
import { createDurableEveAnswerer, observeAnswer } from "./answer-client.ts";
import { isChatSession, isOrganizeSession } from "./job.ts";
import { searchOwnedNotes } from "./note-search-tool.ts";

const serviceToken = "synthetic-only-organizer-service-token";
const source: NotePassageSource = {
  kind: "block",
  noteId: "389e1044-164c-4931-b054-0384d66b9523",
  version: '"389e1044-164c-4931-b054-0384d66b9523:1"',
  blockId: "meeting-block",
  headingPath: [],
};
const passage = { id: evidenceId(source), text: "Meeting at the library at 14:00.", source };
const answer = {
  status: "completed",
  text: "At 14:00.",
  citations: [{ passageId: passage.id, excerpt: "library at 14:00" }],
};
// The stream types predate structured results, so synthetic events are widened here only.
const event = (input: object) =>
  ({
    ...(input as SessionEvent),
    meta: { at: "2026-11-11T00:00:00.000Z", position: { line: 0, index: 0 } },
  }) as SessionStreamEvent;
const consumed = (deliveryId: string, turnId: string) =>
  event({ type: "delivery.consumed", data: { deliveryId, turnId, parts: [] } });
const settled = (deliveryId: string, turnId: string) =>
  event({ type: "delivery.settled", data: { deliveryId, turnId, outcome: "handled" } });
const turnSettled = (turnId: string, outcome = "completed") =>
  event({ type: "turn.settled", scope: { turnId }, data: { turnId, outcome } });
const search = (turnId: string, callId: string, name: string, output: unknown) => [
  event({
    type: "call.requested",
    scope: { turnId },
    data: { callId, owner: { runId: "model-1" }, capability: { kind: "tool", name } },
  }),
  event({
    type: "call.settled",
    scope: { turnId },
    data: { callId, outcome: "completed", output },
  }),
];
const reply = (turnId: string, value: unknown) =>
  event({
    type: "content.completed",
    scope: { turnId },
    data: { partId: `reply-${turnId}`, kind: "result", value },
  });
const deliveries = { deliveryId: "delivery-1", steerDeliveryIds: [] as string[] };

await test("evidence is the recorded search output of Atlas's own turn, not what the model or another turn claims", () => {
  const other = { ...source, blockId: "other-turn-block" };
  const observation = observeAnswer(
    [
      ...search("turn-0", "search-0", "search_notes", {
        passages: [{ id: evidenceId(other), text: "Earlier turn", source: other }],
      }),
      consumed("delivery-1", "turn-1"),
      ...search("turn-1", "search-1", "search_notes", { passages: [passage] }),
      ...search("turn-1", "other-1", "research", {
        passages: [{ id: evidenceId(other), text: "Not a note search", source: other }],
      }),
      reply("turn-1", answer),
      turnSettled("turn-1"),
      settled("delivery-1", "turn-1"),
    ],
    deliveries,
  );
  assert.deepEqual(observation, { status: "result", result: answer, evidence: [passage] });
});

await test("an answer is not read until every steering input has settled, then comes from the last turn", () => {
  const steered = { deliveryId: "delivery-1", steerDeliveryIds: ["delivery-2"] };
  const first = [
    consumed("delivery-1", "turn-1"),
    reply("turn-1", { ...answer, text: "Before steering" }),
    turnSettled("turn-1"),
    settled("delivery-1", "turn-1"),
  ];
  assert.deepEqual(observeAnswer(first, steered), { status: "running", text: "" });
  const late = [
    ...first,
    consumed("delivery-2", "turn-2"),
    ...search("turn-2", "search-2", "search_notes", { passages: [passage] }),
    reply("turn-2", answer),
    turnSettled("turn-2"),
    settled("delivery-2", "turn-2"),
  ];
  assert.deepEqual(observeAnswer(late, steered), {
    status: "result",
    result: answer,
    evidence: [passage],
  });
});

await test("cancelled, unfinished and unreadable work never becomes a result", () => {
  const base = [consumed("delivery-1", "turn-1")];
  assert.deepEqual(
    observeAnswer(
      [...base, turnSettled("turn-1", "cancelled"), settled("delivery-1", "turn-1")],
      deliveries,
    ),
    { status: "cancelled", text: "" },
  );
  assert.deepEqual(
    observeAnswer([...base, turnSettled("turn-1"), settled("delivery-1", "turn-1")], deliveries),
    { status: "failed", text: "" },
  );
  assert.deepEqual(
    observeAnswer(
      [
        ...base,
        ...search("turn-1", "search-1", "search_notes", { passages: [{ text: "No source" }] }),
        reply("turn-1", answer),
        turnSettled("turn-1"),
        settled("delivery-1", "turn-1"),
      ],
      deliveries,
    ),
    { status: "failed", text: "" },
  );
  assert.deepEqual(observeAnswer([event({ type: "session.ended", data: {} })], deliveries), {
    status: "failed",
    text: "",
  });
});

await test("inputs go to the fixed session as the chat principal with a retry key and the reply schema", async () => {
  const requests: { url: string; authorization: string | null; body: Record<string, unknown> }[] =
    [];
  const adapter = createDurableEveAnswerer({
    baseUrl: "https://organizer.example.com",
    serviceToken,
    fetchImpl: async (url, init) => {
      requests.push({
        url: url instanceof Request ? url.url : url.toString(),
        authorization: new Headers(init?.headers).get("authorization"),
        body: JSON.parse(typeof init?.body === "string" ? init.body : "{}") as Record<
          string,
          unknown
        >,
      });
      return Response.json({ sessionId: "session-1", deliveryId: "delivery-1" }, { status: 202 });
    },
  });
  assert.deepEqual(await adapter.submit("session-1", "turn-key", "Question"), {
    status: "delivered",
    sessionId: "session-1",
    deliveryId: "delivery-1",
  });
  await adapter.steer("session-1", "message-key", "Only Monday");
  const [submit, steer] = requests;
  assert.equal(submit?.url, "https://organizer.example.com/eve/v1/session/session-1");
  assert.equal(
    submit?.authorization,
    `Basic ${Buffer.from(`chat:${serviceToken}`).toString("base64")}`,
  );
  assert.equal(submit?.body.idempotencyKey, "turn-key");
  assert.equal(submit?.body.turnPolicy, undefined);
  assert.equal(typeof submit?.body.outputSchema, "object");
  assert.deepEqual(
    { key: steer?.body.idempotencyKey, policy: steer?.body.turnPolicy, text: steer?.body.message },
    { key: "message-key", policy: "steer", text: "Only Monday" },
  );
});

await test("an expired fixed session is reported and never replaced", async () => {
  const adapter = createDurableEveAnswerer({
    baseUrl: "https://organizer.example.com",
    serviceToken,
    fetchImpl: async () => Response.json({ code: "session_expired" }, { status: 410 }),
  });
  assert.deepEqual(await adapter.submit("session-1", "turn-key", "Question"), {
    status: "expired",
  });
});

await test("note search takes its owner from the bound session and refuses an unbound one", async () => {
  const searched: string[] = [];
  const dependencies = {
    ownerOfSession: async (sessionId: string) =>
      sessionId === "session-alex" ? "owner-alex" : undefined,
    embed: async () => [0.1],
    candidates: async (ownerId: string) => {
      searched.push(ownerId);
      return {
        passages: [{ text: passage.text, source }],
        coverage: { ready: 1, pending: 0, failed: 0 },
      };
    },
  };
  assert.deepEqual(
    await searchOwnedNotes("session-alex", { query: "notes of owner-sam" }, dependencies),
    { passages: [passage], coverage: { ready: 1, pending: 0, failed: 0 } },
  );
  await assert.rejects(searchOwnedNotes("session-unknown", { query: "anything" }, dependencies));
  assert.deepEqual(searched, ["owner-alex"]);
});

await test("each job sees only its own tools: research never joins a chat session", () => {
  const session = (initiator: string | null, current: string | null) => ({
    auth: {
      initiator: initiator ? { principalId: initiator } : null,
      current: current ? { principalId: current } : null,
    },
  });
  const cases = [
    [session("chat", "chat"), true, false],
    [session("api", "api"), false, true],
    [session("api", "chat"), false, false],
    [session("chat", "api"), false, false],
    [session(null, null), false, true],
  ] as const;
  for (const [value, chat, organize] of cases) {
    assert.equal(isChatSession(value), chat);
    assert.equal(isOrganizeSession(value), organize);
  }
});
