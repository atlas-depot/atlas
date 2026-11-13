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
const webSource = {
  kind: "web" as const,
  url: "https://example.test/meeting",
  title: "Official meeting notice",
  retrievedAt: "2026-11-11T00:00:00.000Z",
};
const webEvidence = {
  id: evidenceId(webSource),
  text: "The public meeting is on Friday.",
  source: webSource,
};
const researchOutput = {
  status: "completed",
  question: "When is the public meeting?",
  text: webEvidence.text,
  sources: [{ id: webEvidence.id, source: webSource }],
};
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
      ...search("turn-1", "other-1", "unavailable_tool", {
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

await test("a successful research tool contributes distinct, server-verified web evidence", () => {
  const mixedAnswer = {
    status: "completed",
    text: "The note has the time and the public notice has the date.",
    citations: [
      { passageId: passage.id, excerpt: "library at 14:00" },
      { passageId: webEvidence.id, excerpt: "public meeting is on Friday" },
    ],
  };
  const observation = observeAnswer(
    [
      consumed("delivery-1", "turn-1"),
      ...search("turn-1", "notes-1", "search_notes", { passages: [passage] }),
      ...search("turn-1", "research-1", "research", researchOutput),
      reply("turn-1", mixedAnswer),
      turnSettled("turn-1"),
      settled("delivery-1", "turn-1"),
    ],
    deliveries,
  );
  assert.deepEqual(observation, {
    status: "result",
    result: mixedAnswer,
    evidence: [passage, webEvidence],
  });
});

await test("a declined research request permits a no-support reply but adds no web evidence", () => {
  const noSupport = { status: "no-support", text: "No source supports this yet.", citations: [] };
  const observation = observeAnswer(
    [
      consumed("delivery-1", "turn-1"),
      ...search("turn-1", "research-1", "research", {
        status: "not_performed",
        reason: "denied",
      }),
      reply("turn-1", noSupport),
      turnSettled("turn-1"),
      settled("delivery-1", "turn-1"),
    ],
    deliveries,
  );
  assert.deepEqual(observation, { status: "result", result: noSupport, evidence: [] });
});

await test("research output with an invented source ID cannot become answer evidence", () => {
  const observation = observeAnswer(
    [
      consumed("delivery-1", "turn-1"),
      ...search("turn-1", "research-1", "research", {
        ...researchOutput,
        sources: [{ id: "p_0000000000000000", source: webSource }],
      }),
      reply("turn-1", answer),
      turnSettled("turn-1"),
      settled("delivery-1", "turn-1"),
    ],
    deliveries,
  );
  assert.deepEqual(observation, { status: "failed", text: "" });
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

await test("an unhandled steering delivery cannot be credited with the opening turn's answer", () => {
  const events = [
    consumed("delivery-1", "turn-1"),
    ...search("turn-1", "search-1", "search_notes", { passages: [passage] }),
    reply("turn-1", answer),
    turnSettled("turn-1"),
    settled("delivery-1", "turn-1"),
    event({ type: "delivery.settled", data: { deliveryId: "delivery-2", outcome: "rejected" } }),
  ];
  assert.deepEqual(
    observeAnswer(events, { deliveryId: "delivery-1", steerDeliveryIds: ["delivery-2"] }),
    {
      status: "failed",
      text: "",
    },
  );
  assert.equal(observeAnswer(events, deliveries).status, "result");
});

await test("no-support requires a completed note search, including a successful empty search", () => {
  const noSupport = { status: "no-support", text: "The notes do not cover that.", citations: [] };
  const read = (toolEvents: SessionStreamEvent[]) =>
    observeAnswer(
      [
        consumed("delivery-1", "turn-1"),
        ...toolEvents,
        reply("turn-1", noSupport),
        turnSettled("turn-1"),
        settled("delivery-1", "turn-1"),
      ],
      deliveries,
    );
  const empty = search("turn-1", "search-1", "search_notes", { passages: [] });
  const failed = [
    search("turn-1", "search-2", "search_notes", { passages: [] })[0]!,
    event({
      type: "call.settled",
      scope: { turnId: "turn-1" },
      data: {
        callId: "search-2",
        outcome: "failed",
        error: { code: "TOOL_FAILED", message: "Search unavailable" },
      },
    }),
  ];
  assert.deepEqual(read(empty), { status: "result", result: noSupport, evidence: [] });
  for (const events of [[], failed, [...empty, ...failed]]) {
    assert.deepEqual(read(events), { status: "failed", text: "" });
  }
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

await test("an input the runtime refuses for its size is reported as rejected, not retried blindly", async () => {
  const adapter = createDurableEveAnswerer({
    baseUrl: "https://organizer.example.com",
    serviceToken,
    fetchImpl: async () => new Response("Request Entity Too Large", { status: 413 }),
  });
  assert.deepEqual(await adapter.submit("session-1", "turn-key", "Question"), {
    status: "rejected",
  });
});

await test("note search takes its owner from the bound session and refuses an unbound one", async () => {
  const searched: string[] = [];
  const dependencies = {
    ownerOfSession: async (sessionId: string) =>
      sessionId === "session-alex" ? "owner-alex" : undefined,
    embed: async () => [0.1],
    record: async () => true,
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

await test("note search records every returned passage and withholds output it could not record", async () => {
  const recorded: unknown[] = [];
  const dependencies = (saved: boolean) => ({
    ownerOfSession: async () => "owner-alex",
    embed: async () => [0.1],
    candidates: async () => ({
      passages: [{ text: passage.text, source }],
      coverage: { ready: 1, pending: 0, failed: 0 },
    }),
    record: async (sessionId: string, sources: unknown) => {
      recorded.push([sessionId, sources]);
      return saved;
    },
  });
  await searchOwnedNotes("session-alex", { query: "anything" }, dependencies(true));
  assert.deepEqual(recorded, [
    ["session-alex", [{ noteId: source.noteId, version: source.version }]],
  ]);
  await assert.rejects(
    searchOwnedNotes("session-alex", { query: "anything" }, dependencies(false)),
  );
});

await test("an expired session found while reading an answer is reported, not retried", async () => {
  const adapter = createDurableEveAnswerer({
    baseUrl: "https://organizer.example.com",
    serviceToken,
  });
  // The eve reader uses the global fetch, so the expiry is scripted there for this read.
  const original = globalThis.fetch;
  let reads = 0;
  globalThis.fetch = async () => {
    reads++;
    return Response.json({ code: "session_expired" }, { status: 410 });
  };
  try {
    assert.deepEqual(
      await adapter.inspect("session-1", { deliveryId: "delivery", steerDeliveryIds: [] }),
      { status: "expired", text: "" },
    );
    assert.equal(reads, 1);
  } finally {
    globalThis.fetch = original;
  }
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
