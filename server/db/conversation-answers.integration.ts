import { randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { readFileSync } from "node:fs";
import { expect, it } from "vite-plus/test";
import type { NotePassageSource } from "../../shared/passages.ts";
import { evidenceId, type AnswerObservation, type AnswerRuntime } from "../conversation-answer.ts";
import { createConversationAnswers } from "../conversation-answers.ts";
import { openDatabase } from "./connection.ts";
import { createConversationCleanupStore } from "./conversation-cleanup.ts";
import {
  conversationAdmissions,
  conversationCleanupIntents,
  conversations,
  conversationTurns,
  conversationContexts,
  conversationMessages,
  conversationSummaries,
  conversationTurnInputs,
} from "./conversation-schema.ts";
import { createConversationStore } from "./conversations.ts";
import { createConversationTurns } from "./conversation-turns.ts";
import { createConversationContextStore, lockContextSources } from "./conversation-contexts.ts";
import type { ContextCompactor } from "../conversation-context.ts";
import { setupIndexTestDatabase } from "./index-test-database.ts";
import { createNoteStore, noteTag } from "./notes.ts";
import { notes as noteRows } from "./schema.ts";

const database = setupIndexTestDatabase();
const malicious = JSON.parse(
  readFileSync(
    new URL("../../fixtures/conversations/malicious-note.json", import.meta.url),
    "utf8",
  ),
) as { title: string; content: string; question: string; supportedExcerpt: string };
const cases = JSON.parse(
  readFileSync(
    new URL("../../fixtures/conversations/follow-up-context.json", import.meta.url),
    "utf8",
  ),
) as {
  followUp: { question: string; next: string };
  expiredRuntime: { question: string; partial: string; next: string };
  deletedSource: { title: string; content: string; question: string; next: string };
};

/** A scripted private runtime. It records every call so duplicated work is visible. */
function fakeRuntime() {
  const calls = {
    allocate: [] as string[],
    submit: [] as { sessionId: string; key: string; message: string }[],
    steer: [] as { sessionId: string; key: string; message: string }[],
    retire: [] as string[],
    compact: [] as { sessionId: string; key: string; message: string }[],
  };
  let observation: AnswerObservation = { status: "running", text: "" };
  let lostSubmits = 0;
  const unreachable = new Set<string>();
  const inspected: string[] = [];
  let summaryResult: unknown = { summary: "Synthetic older conversation summary." };
  const compactor: ContextCompactor = {
    async allocate(key) {
      return `summary-${key}`;
    },
    async submit(sessionId, key, message) {
      calls.compact.push({ sessionId, key, message });
      return { status: "delivered", deliveryId: `summary-delivery-${key}` };
    },
    async inspect() {
      return { status: "completed", result: summaryResult };
    },
    async retire(sessionId) {
      calls.retire.push(sessionId);
      return { status: "ended" };
    },
  };
  const runtime: AnswerRuntime = {
    async allocate(operationId) {
      calls.allocate.push(operationId);
      return `session-${operationId}`;
    },
    async submit(sessionId, key, message) {
      if (lostSubmits-- > 0) throw new Error("lost response");
      calls.submit.push({ sessionId, key, message });
      return { status: "delivered", sessionId, deliveryId: `delivery-${key}` };
    },
    async steer(sessionId, key, message) {
      calls.steer.push({ sessionId, key, message });
      return { status: "delivered", sessionId, deliveryId: `delivery-${key}` };
    },
    async inspect(sessionId) {
      if (unreachable.has(sessionId)) throw new Error("runtime unreachable");
      inspected.push(sessionId);
      return observation;
    },
    async retire(sessionId) {
      calls.retire.push(sessionId);
      return { status: "ended" };
    },
  };
  return {
    calls,
    runtime,
    compactor,
    summary: (value: unknown) => void (summaryResult = value),
    observe: (next: AnswerObservation) => void (observation = next),
    loseNextSubmit: () => void (lostSubmits = 1),
    inspected,
    unreachable,
  };
}

async function fixture(owner = randomUUID()) {
  const fake = fakeRuntime();
  const service = (db: typeof database.db) =>
    createConversationAnswers({
      turns: createConversationTurns(db),
      cleanup: createConversationCleanupStore(db),
      contexts: createConversationContextStore(db),
      compactorFor: () => fake.compactor,
      runtimeUrl: "https://answers.example.test",
      runtimeFor: () => fake.runtime,
    });
  const [parent] = await database.db.insert(conversations).values({ ownerId: owner }).returning();
  const id = parent!.id;
  const store = createConversationStore(database.db);
  const history = async () => (await store.messages(owner, id, { limit: 50 }))!.messages;
  async function note(title: string, content: string) {
    const stored = await createNoteStore(database.db).create(owner, {
      title,
      content,
      createdAt: new Date().toISOString(),
    });
    const source: NotePassageSource = {
      kind: "markdown",
      noteId: stored.note.id,
      version: noteTag(stored.note.id, stored.revision),
      headingPath: [],
      startOffset: 0,
      endOffset: content.length,
    };
    return { noteId: stored.note.id, revision: stored.revision, source, text: content };
  }
  const result = (
    passages: { source: NotePassageSource; text: string }[],
    citations: { source: NotePassageSource; excerpt: string }[],
    text = "Synthetic answer.",
  ): AnswerObservation => ({
    status: "result",
    evidence: passages.map((passage) => ({ id: evidenceId(passage.source), ...passage })),
    result: {
      status: citations.length ? "completed" : "no-support",
      text,
      citations: citations.map(({ source, excerpt }) => ({
        passageId: evidenceId(source),
        excerpt,
      })),
    },
  });
  return {
    owner,
    id,
    fake,
    store,
    history,
    note,
    result,
    service,
    first: service(database.db),
    /** A second API process: its own pool and no shared memory. */
    second: service(database.other),
  };
}

it("accepts a new message using one pool connection", async () => {
  const f = await fixture();
  const connection = openDatabase(database.url, { max: 1 });
  try {
    const answer = await f
      .service(connection.db)
      .send(f.owner, f.id, randomUUID(), { text: "When?" });
    expect(answer).toMatchObject({ status: "saved" });
  } finally {
    await connection.close();
  }
});

it("resolves a repeated send and a reconnect in another process to one delivery", async () => {
  const f = await fixture();
  const key = randomUUID();
  const [a, b] = await Promise.all([
    f.first.send(f.owner, f.id, key, { text: "When is the meeting?" }),
    f.second.send(f.owner, f.id, key, { text: "When is the meeting?" }),
  ]);
  expect(a).toEqual(b);
  await f.second.refresh(f.owner, f.id);
  await f.first.refresh(f.owner, f.id);
  expect(new Set(f.fake.calls.allocate).size).toBe(1);
  expect(new Set(f.fake.calls.submit.map((call) => `${call.sessionId} ${call.key}`)).size).toBe(1);
  expect((await f.history()).filter((message) => message.role === "user")).toHaveLength(1);
  expect(
    await f.first.send(f.owner, f.id, key, { text: "A different question under the same key" }),
  ).toEqual({ status: "conflict" });
  // Overlapping retries of one key spend one admission, not two.
  const [window] = await database.db
    .select()
    .from(conversationAdmissions)
    .where(eq(conversationAdmissions.ownerId, f.owner));
  expect(window?.admittedAt).toHaveLength(1);
});

it("keeps an accepted input when delivery is interrupted and redelivers it under the same key", async () => {
  const f = await fixture();
  f.fake.loseNextSubmit();
  expect(
    await f.first.send(f.owner, f.id, randomUUID(), { text: "Interrupted question" }),
  ).toMatchObject({ status: "saved" });
  expect(f.fake.calls.submit).toHaveLength(0);
  await f.second.refresh(f.owner, f.id);
  expect(f.fake.calls.submit).toHaveLength(1);
  expect(f.fake.calls.submit[0]).toMatchObject({
    sessionId: `session-${f.fake.calls.allocate[0]}`,
    key: f.fake.calls.allocate[0],
    message: "Interrupted question",
  });
});

it("queues inputs behind a running answer, keeps them across reconnect and groups them into one answer", async () => {
  const f = await fixture();
  const plan = await f.note("Plan", "Meeting at the library at 14:00.");
  const first = await f.first.send(f.owner, f.id, randomUUID(), { text: "First" });
  const queued = [
    await f.first.send(f.owner, f.id, randomUUID(), { text: "Second" }),
    await f.second.send(f.owner, f.id, randomUUID(), { text: "Third" }),
  ];
  if (first.status !== "saved" || queued.some((input) => input.status !== "saved"))
    throw new Error("Inputs not saved");
  const ids = queued.flatMap((input) => (input.status === "saved" ? [input.value.id] : []));
  expect(f.fake.calls.submit).toHaveLength(1);
  expect(f.fake.calls.steer).toHaveLength(0);
  expect(await f.store.read(f.owner, f.id)).toMatchObject({
    activeTurn: { inputIds: [first.value.id] },
  });

  f.fake.observe(f.result([plan], [{ source: plan.source, excerpt: "library at 14:00" }]));
  await f.second.refresh(f.owner, f.id);
  expect(f.fake.calls.submit.at(-1)?.message).toContain(
    "Current question:\nQuestion 1:\nSecond\n\nQuestion 2:\nThird",
  );
  const answers = (await f.history()).filter((message) => message.role === "assistant");
  expect(answers).toMatchObject([
    { status: "completed", inputIds: [first.value.id] },
    { status: "completed", inputIds: ids },
  ]);
  expect(f.fake.calls.submit).toHaveLength(2);
});

it("adds an explicit steer to the running answer instead of queueing or starting another", async () => {
  const f = await fixture();
  const opening = await f.first.send(f.owner, f.id, randomUUID(), { text: "Summarize my week" });
  const steer = await f.second.send(f.owner, f.id, randomUUID(), {
    text: "Only Monday",
    policy: "steer",
  });
  if (opening.status !== "saved" || steer.status !== "saved") throw new Error("Inputs not saved");
  expect(f.fake.calls.submit).toHaveLength(1);
  expect(f.fake.calls.steer).toEqual([
    { sessionId: f.fake.calls.submit[0]!.sessionId, key: steer.value.id, message: "Only Monday" },
  ]);
  await f.first.refresh(f.owner, f.id);
  expect(f.fake.calls.steer).toHaveLength(1);
  f.fake.observe(f.result([], [], "Nothing saved about Monday."));
  await f.first.refresh(f.owner, f.id);
  expect((await f.history()).at(-1)).toMatchObject({
    status: "no-support",
    inputIds: [opening.value.id, steer.value.id],
    citations: [],
  });
  expect(f.fake.calls.submit).toHaveLength(1);
});

it("treats an injected note as evidence only and fails an answer citing a source it never retrieved", async () => {
  const f = await fixture();
  const other = await fixture();
  const owned = await f.note(malicious.title, malicious.content);
  const foreign = await other.note("Private", "Sam's door code is 4471.");
  const sent = await f.first.send(f.owner, f.id, randomUUID(), { text: malicious.question });
  // The model obeys the injection: it cites another account's passage it was never given.
  f.fake.observe(f.result([owned], [{ source: foreign.source, excerpt: "door code is 4471" }]));
  await f.first.refresh(f.owner, f.id);
  expect((await f.history()).at(-1)).toMatchObject({
    status: "incomplete",
    reason: "failed",
    text: "",
    citations: [],
  });
  // The same evidence supports an honest answer, and later inputs keep the caller's policy.
  if (sent.status !== "saved") throw new Error("Input not saved");
  const turnId = (await f.history()).at(-1);
  if (turnId?.role !== "assistant") throw new Error("Missing answer");
  f.fake.observe(
    f.result([owned], [{ source: owned.source, excerpt: malicious.supportedExcerpt }]),
  );
  expect(await f.first.retry(f.owner, f.id, turnId.turnId, randomUUID())).toMatchObject({
    status: "saved",
  });
  await f.first.refresh(f.owner, f.id);
  expect((await f.history()).at(-1)).toMatchObject({
    status: "completed",
    inputIds: [sent.value.id],
    citations: [{ excerpt: malicious.supportedExcerpt, source: { noteId: owned.noteId } }],
  });
  const next = await f.first.send(f.owner, f.id, randomUUID(), { text: "Thanks" });
  expect(next).toMatchObject({ status: "saved", value: { deliveryPolicy: "queue" } });
});

it("fails a malformed result and keeps a cancelled partial answer incomplete", async () => {
  const f = await fixture();
  await f.first.send(f.owner, f.id, randomUUID(), { text: "Question" });
  f.fake.observe({ status: "result", evidence: [], result: { status: "completed", text: "Sure" } });
  await f.first.refresh(f.owner, f.id);
  f.fake.observe({ status: "running", text: "" });
  await f.first.send(f.owner, f.id, randomUUID(), { text: "Another" });
  f.fake.observe({ status: "cancelled", text: "Half an ans" });
  await f.first.refresh(f.owner, f.id);
  expect((await f.history()).filter((message) => message.role === "assistant")).toMatchObject([
    { status: "incomplete", reason: "failed", text: "" },
    { status: "incomplete", reason: "cancelled", text: "Half an ans" },
  ]);
});

it("suppresses an unpublished answer whose source was deleted and flags one whose source changed", async () => {
  const f = await fixture();
  const notes = createNoteStore(database.db);
  const deleted = await f.note("Gone", "The key is under the mat.");
  await f.first.send(f.owner, f.id, randomUUID(), { text: "Where is the key?" });
  f.fake.observe(f.result([deleted], [{ source: deleted.source, excerpt: "under the mat" }]));
  await notes.delete(f.owner, deleted.noteId, deleted.revision);
  await f.first.refresh(f.owner, f.id);
  expect((await f.history()).at(-1)).toMatchObject({
    status: "incomplete",
    reason: "failed",
    text: "",
    citations: [],
  });

  f.fake.observe({ status: "running", text: "" });
  const edited = await f.note("Edited", "Rent is due on the 5th.");
  // The source loss paused the queue, so the next question waits for an explicit resume.
  await f.first.resume(f.owner, f.id);
  await f.first.send(f.owner, f.id, randomUUID(), { text: "When is rent due?" });
  f.fake.observe(f.result([edited], [{ source: edited.source, excerpt: "due on the 5th" }]));
  await notes.update(f.owner, edited.noteId, edited.revision, {
    title: "Edited",
    content: "Rent is due on the 1st.",
  });
  await f.first.refresh(f.owner, f.id);
  expect((await f.history()).at(-1)).toMatchObject({
    status: "completed",
    citations: [{ excerpt: "due on the 5th", stale: true, source: edited.source }],
  });
});

it("Stop cancels the answer, retires its session and holds queued inputs until resume", async () => {
  const f = await fixture();
  await f.first.send(f.owner, f.id, randomUUID(), { text: "Long question" });
  const queued = await f.first.send(f.owner, f.id, randomUUID(), { text: "Next question" });
  expect(await f.second.stop(f.owner, f.id)).toMatchObject({
    status: "paused",
    message: { status: "incomplete", reason: "cancelled" },
  });
  expect(f.fake.calls.retire).toEqual([f.fake.calls.submit[0]!.sessionId]);
  await f.first.refresh(f.owner, f.id);
  expect(f.fake.calls.submit).toHaveLength(1);
  expect(await f.store.read(f.owner, f.id)).toMatchObject({
    conversation: { queuePaused: true },
    activeTurn: null,
  });
  await f.second.resume(f.owner, f.id);
  if (queued.status !== "saved") throw new Error("Input not saved");
  expect(await f.store.read(f.owner, f.id)).toMatchObject({
    conversation: { queuePaused: false },
    activeTurn: { inputIds: [queued.value.id] },
  });
});

it("denies another account and never reaches the runtime for it", async () => {
  const f = await fixture();
  const stranger = randomUUID();
  expect(await f.first.send(stranger, f.id, randomUUID(), { text: "Let me in" })).toEqual({
    status: "not_found",
  });
  expect(await f.first.stop(stranger, f.id)).toEqual({ status: "not_found" });
  expect(await f.first.resume(stranger, f.id)).toEqual({ status: "not_found" });
  await f.first.refresh(stranger, f.id);
  expect(f.fake.calls.allocate).toHaveLength(0);
  expect(await f.history()).toHaveLength(0);
});

it("limits sends per owner across processes without charging a replay, and caps running answers", async () => {
  const f = await fixture();
  const key = randomUUID();
  for (let index = 0; index < 20; index++) {
    const send = index % 2 ? f.first : f.second;
    expect(
      await send.send(f.owner, f.id, index ? randomUUID() : key, { text: `Message ${index}` }),
    ).toMatchObject({ status: "saved" });
  }
  expect(await f.first.send(f.owner, f.id, randomUUID(), { text: "One too many" })).toMatchObject({
    status: "rate_limited",
  });
  expect(await f.second.send(f.owner, f.id, key, { text: "Message 0" })).toMatchObject({
    status: "saved",
  });

  const busy = await fixture();
  const turns = createConversationTurns(database.db);
  const extra = await database.db
    .insert(conversations)
    .values([1, 2, 3].map(() => ({ ownerId: busy.owner })))
    .returning();
  for (const conversation of [busy, ...extra])
    await turns.acceptInput(busy.owner, conversation.id, randomUUID(), { text: "Question" });
  const started = [];
  for (const conversation of [busy, ...extra])
    started.push((await turns.startNext(busy.owner, conversation.id)).status);
  expect(started).toEqual(["started", "started", "started", "owner_busy"]);
});

it("retires the session of a published answer and keeps a failed retirement pending", async () => {
  const f = await fixture();
  await f.first.send(f.owner, f.id, randomUUID(), { text: "Question" });
  f.fake.observe(f.result([], [], "Nothing saved about that."));
  await f.first.refresh(f.owner, f.id);
  const session = f.fake.calls.submit[0]!.sessionId;
  f.fake.runtime.retire = async () => {
    throw new Error("unconfirmed");
  };
  expect((await f.first.sweep(100)).cleanupPending).toBeGreaterThan(0);
  expect(
    (await database.db.select().from(conversationCleanupIntents)).find(
      (intent) => intent.sessionId === session,
    ),
  ).toMatchObject({ attempts: 1, lastFailureCode: "cleanup_failed" });
});

it("does not publish an answer observed before a steer joined, and delivers the steer first", async () => {
  const f = await fixture();
  const turns = createConversationTurns(database.db);
  const opening = await f.first.send(f.owner, f.id, randomUUID(), { text: "Summarize my week" });
  const observed = (await turns.dispatchState(f.owner, f.id))!.turn;
  // Another request stores a steer after this reader inspected the attempt.
  const steer = await turns.acceptInput(f.owner, f.id, randomUUID(), {
    text: "Only Monday",
    policy: "steer",
  });
  if (opening.status !== "saved" || steer.status !== "saved") throw new Error("Inputs not saved");
  expect(
    await turns.finalize(f.owner, f.id, observed.id, {
      status: "no-support",
      text: "Answer that never saw the steer.",
      citations: [],
      expectedVersion: observed.checkpointVersion,
    }),
  ).toEqual({ status: "conflict" });
  expect(f.fake.calls.steer).toHaveLength(0);
  f.fake.observe(f.result([], [], "Nothing saved about Monday."));
  await f.second.refresh(f.owner, f.id);
  expect(f.fake.calls.steer.map((call) => call.key)).toEqual([steer.value.id]);
  expect((await f.history()).at(-1)).toMatchObject({
    text: "Nothing saved about Monday.",
    inputIds: [opening.value.id, steer.value.id],
  });
});

it("maintenance rotates past an attempt whose runtime keeps failing", async () => {
  const f = await fixture();
  const [other] = await database.db.insert(conversations).values({ ownerId: f.owner }).returning();
  await f.first.send(f.owner, f.id, randomUUID(), { text: "Unreachable" });
  await f.first.send(f.owner, other!.id, randomUUID(), { text: "Healthy" });
  const [stuck, healthy] = f.fake.calls.submit.map((call) => call.sessionId);
  // Both are unobserved. The failing one is older, so it is always selected first.
  await database.db
    .update(conversationTurns)
    .set({
      updatedAt: sql`now() - CASE WHEN ${conversationTurns.sessionId} = ${stuck} THEN interval '2 hours' ELSE interval '1 hour' END`,
    })
    .where(inArray(conversationTurns.sessionId, [stuck!, healthy!]));
  f.fake.unreachable.add(stuck!);
  f.fake.inspected.length = 0;
  await f.first.sweep(1);
  await f.first.sweep(1);
  expect(f.fake.inspected).toEqual([healthy]);
});

it("starts an accepted conversation in maintenance once its owner has a free slot", async () => {
  const f = await fixture();
  const [second, third, delayed, paused] = await database.db
    .insert(conversations)
    .values(Array.from({ length: 4 }, () => ({ ownerId: f.owner })))
    .returning();
  await f.first.stop(f.owner, paused!.id);
  for (const id of [f.id, second!.id, third!.id, delayed!.id, paused!.id])
    expect(await f.first.send(f.owner, id, randomUUID(), { text: id })).toMatchObject({
      status: "saved",
    });
  const active = (id: string) => f.store.read(f.owner, id).then((state) => state?.activeTurn);
  await f.second.sweep(5);
  expect(await active(delayed!.id)).toBeNull();
  await f.first.stop(f.owner, f.id);
  await f.second.sweep(5);
  expect(await active(delayed!.id)).toMatchObject({ status: "running" });
  expect(f.fake.calls.submit.filter((call) => call.message === delayed!.id)).toHaveLength(1);
  expect(await active(paused!.id)).toBeNull();
});

it("keeps one answer's combined input within the runtime request limit and fails a refused delivery once", async () => {
  const f = await fixture();
  const turns = createConversationTurns(database.db);
  await turns.stop(f.owner, f.id);
  const large = "\u754c".repeat(2_000);
  const ids: string[] = [];
  for (let index = 0; index < 3; index++) {
    const accepted = await turns.acceptInput(f.owner, f.id, randomUUID(), { text: large });
    if (accepted.status !== "saved") throw new Error("Input not saved");
    ids.push(accepted.value.id);
  }
  await turns.resume(f.owner, f.id);
  // Each input is 6,000 bytes: two exceed the model-context grouping bound, so they go one by one.
  expect(await turns.startNext(f.owner, f.id)).toMatchObject({ status: "started" });
  expect(await f.store.read(f.owner, f.id)).toMatchObject({ activeTurn: { inputIds: [ids[0]] } });

  f.fake.runtime.submit = async (sessionId, key, message) => {
    f.fake.calls.submit.push({ sessionId, key, message });
    return { status: "rejected" };
  };
  await f.first.refresh(f.owner, f.id);
  expect((await f.history()).find((message) => message.role === "assistant")).toMatchObject({
    status: "incomplete",
    reason: "failed",
    inputIds: [ids[0]],
  });
  // The refused attempt ended and paused the queue. A read alone starts nothing more.
  await f.first.refresh(f.owner, f.id);
  expect(f.fake.calls.submit).toHaveLength(1);
  // Its input is never resent; after a resume the next input gets its own attempt.
  await f.first.resume(f.owner, f.id);
  expect(f.fake.calls.submit).toHaveLength(2);
  expect(new Set(f.fake.calls.submit.map((call) => call.key)).size).toBe(2);
  expect((await f.history()).filter((message) => message.role === "assistant")).toMatchObject([
    { inputIds: [ids[0]] },
    { inputIds: [ids[1]] },
  ]);
});

it.each([
  { size: 10, legacy: false },
  // Two 6,000-byte inputs exceed the 10,000-byte grouping bound but fit one prompt budget.
  { size: 2_000, legacy: false },
  { size: 2_000, legacy: true },
])("retries with separate deliveries for size $size (legacy $legacy)", async ({ size, legacy }) => {
  const f = await fixture();
  const text = "例".repeat(size);
  const question = await f.first.send(f.owner, f.id, randomUUID(), { text });
  const steer = await f.first.send(f.owner, f.id, randomUUID(), { text, policy: "steer" });
  if (question.status !== "saved" || steer.status !== "saved") throw new Error("Inputs not saved");
  const stopped = await f.first.stop(f.owner, f.id);
  if (stopped.status !== "paused" || stopped.message?.role !== "assistant")
    throw new Error("Nothing stopped");
  if (legacy) {
    // Old retries stored every input as part of the opening.
    await database.db
      .update(conversationTurnInputs)
      .set({ steer: false, deliveryId: null })
      .where(eq(conversationTurnInputs.turnId, stopped.message.turnId));
  }
  await f.first.resume(f.owner, f.id);
  f.fake.observe(f.result([], [], "No support"));
  expect(await f.second.retry(f.owner, f.id, stopped.message.turnId, randomUUID())).toMatchObject({
    status: "saved",
  });

  const sessions = f.fake.calls.submit.map((call) => call.sessionId);
  expect(new Set(sessions).size).toBe(2);
  expect(f.fake.calls.submit.map((call) => Buffer.byteLength(call.message))).toEqual([
    Buffer.byteLength(text),
    Buffer.byteLength(text),
  ]);
  expect(f.fake.calls.steer.map(({ sessionId, key }) => [sessionId, key])).toEqual(
    sessions.map((sessionId) => [sessionId, steer.value.id]),
  );
  expect((await f.history()).at(-1)).toMatchObject({
    status: "no-support",
    inputIds: [question.value.id, steer.value.id],
  });
});

it("counts an explicit retry against the owner's running answers", async () => {
  const f = await fixture();
  const turns = createConversationTurns(database.db);
  await turns.acceptInput(f.owner, f.id, randomUUID(), { text: "Question" });
  await turns.startNext(f.owner, f.id);
  const stopped = await turns.stop(f.owner, f.id);
  if (stopped.status !== "paused" || stopped.message?.role !== "assistant")
    throw new Error("Nothing stopped");
  await turns.resume(f.owner, f.id);
  const others = await database.db
    .insert(conversations)
    .values([1, 2, 3].map(() => ({ ownerId: f.owner })))
    .returning();
  for (const other of others) {
    await turns.acceptInput(f.owner, other.id, randomUUID(), { text: "Question" });
    expect((await turns.startNext(f.owner, other.id)).status).toBe("started");
  }
  const key = randomUUID();
  expect(await f.first.retry(f.owner, f.id, stopped.message.turnId, key)).toEqual({
    status: "owner_busy",
  });
  await turns.stop(f.owner, others[0]!.id);
  expect(await f.first.retry(f.owner, f.id, stopped.message.turnId, key)).toMatchObject({
    status: "saved",
  });
});
it("reconstructs a context-dependent follow-up in a new runtime after the old session expires", async () => {
  const f = await fixture();
  const source = await f.note("Project", "Project Cedar meets on Tuesday.");
  f.fake.observe(
    f.result(
      [source],
      [{ source: source.source, excerpt: "Project Cedar" }],
      "The project is Project Cedar.",
    ),
  );
  await f.first.send(f.owner, f.id, randomUUID(), { text: "Which project?" });
  const before = await f.history();
  const oldSession = f.fake.calls.submit[0]!.sessionId;
  f.fake.unreachable.add(oldSession);
  f.fake.observe({ status: "running", text: "" });
  const followup = await f.second.send(f.owner, f.id, randomUUID(), {
    text: "When does that project meet?",
  });
  expect(followup.status).toBe("saved");
  const next = f.fake.calls.submit.at(-1)!;
  expect(next.sessionId).not.toBe(oldSession);
  expect(next.message).toContain("The project is Project Cedar.");
  expect(next.message).toContain("When does that project meet?");
  expect((await f.history()).slice(0, before.length)).toEqual(before);
  await Promise.all([f.first.refresh(f.owner, f.id), f.second.refresh(f.owner, f.id)]);
  expect(f.fake.calls.submit).toHaveLength(2);
  expect(new Set(f.fake.calls.submit.map(({ key }) => key)).size).toBe(2);
});

it("forces compaction, tracks transitive dependencies and removes deleted evidence from every future context", async () => {
  const f = await fixture();
  const secret = "SYNTHETIC-CEDAR-SECRET-7193";
  const source = await f.note("Project", secret);
  const answer = `${secret}. ${"Historical detail. ".repeat(600)}`;
  f.fake.observe(f.result([source], [{ source: source.source, excerpt: secret }], answer));
  await f.first.send(f.owner, f.id, randomUUID(), { text: "Describe the project." });
  f.fake.summary({ summary: `The earlier project has marker ${secret}.` });
  f.fake.observe({ status: "running", text: "" });
  await f.second.send(f.owner, f.id, randomUUID(), { text: "What does that mean?" });
  expect(f.fake.calls.compact).toHaveLength(1);
  expect(f.fake.calls.compact[0]!.message).toContain(secret);
  await f.first.refresh(f.owner, f.id);
  expect(f.fake.calls.submit.at(-1)!.message).toContain(secret);
  // A subsequent answer inherits the dependency even without citing it itself.
  f.fake.observe(f.result([], [], `The earlier marker was ${secret}.`));
  await f.second.refresh(f.owner, f.id);
  f.fake.observe({ status: "running", text: "" });
  await f.first.send(f.owner, f.id, randomUUID(), { text: "Explain the earlier marker." });
  const active = f.fake.calls.submit.at(-1)!;
  const turns = createConversationTurns(database.db);
  expect(await turns.contextAuthorized(active.sessionId)).toBe(true);
  await createNoteStore(database.db).delete(f.owner, source.noteId, source.revision);
  expect(await turns.contextAuthorized(active.sessionId)).toBe(false);
  expect(
    await database.db
      .select()
      .from(conversationSummaries)
      .where(eq(conversationSummaries.conversationId, f.id)),
  ).toEqual([]);
  const contexts = await database.db
    .select()
    .from(conversationContexts)
    .where(eq(conversationContexts.conversationId, f.id));
  expect(JSON.stringify(contexts)).not.toContain(secret);
  f.fake.observe(f.result([], [], `A late result containing ${secret}.`));
  await f.second.refresh(f.owner, f.id);
  expect((await f.history()).at(-1)).toMatchObject({ status: "incomplete", text: "" });
  expect((await f.store.read(f.owner, f.id))?.recovery?.reason).toBe("source_changed");
  f.fake.observe({ status: "running", text: "" });
  // Recovery pauses the queue: a new message is saved but waits for an explicit resume.
  await f.first.send(f.owner, f.id, randomUUID(), { text: "What remains available?" });
  expect(f.fake.calls.submit.at(-1)!.sessionId).toBe(active.sessionId);
  expect((await f.store.read(f.owner, f.id))?.recovery?.reason).toBe("source_changed");
  await f.first.resume(f.owner, f.id);
  const safe = f.fake.calls.submit.at(-1)!;
  expect(safe.sessionId).not.toBe(active.sessionId);
  expect(safe.message).not.toContain(secret);
  const history = await f.history();
  expect(history.find((message) => message.text === answer)).toMatchObject({
    text: answer,
    citations: [{ deleted: true, excerpt: null }],
  });
  expect(history.some((message) => message.text === `The earlier marker was ${secret}.`)).toBe(
    true,
  );
});

it("records uncited retrieval before the model sees it and excludes the entire derived answer after deletion", async () => {
  const f = await fixture();
  const cited = await f.note("Cited", "A harmless cited passage.");
  const uncited = await f.note("Uncited", "UNCITED-SOURCE-MARKER");
  await f.first.send(f.owner, f.id, randomUUID(), { text: "What is saved?" });
  const session = f.fake.calls.submit[0]!.sessionId;
  const turns = createConversationTurns(database.db);
  expect(
    await turns.recordSearch(
      session,
      [cited, uncited].map(({ source }) => ({ noteId: source.noteId, version: source.version })),
      { passages: [cited, uncited] },
    ),
  ).toMatchObject({ status: "recorded" });
  f.fake.observe(
    f.result(
      [cited],
      [{ source: cited.source, excerpt: "harmless" }],
      "UNCITED-SOURCE-MARKER influenced this answer.",
    ),
  );
  await f.first.refresh(f.owner, f.id);
  await createNoteStore(database.db).delete(f.owner, uncited.noteId, uncited.revision);
  f.fake.observe({ status: "running", text: "" });
  await f.second.send(f.owner, f.id, randomUUID(), { text: "Tell me more." });
  expect(f.fake.calls.submit.at(-1)!.message).not.toContain("UNCITED-SOURCE-MARKER");
  expect((await f.history()).find((message) => message.text.includes("influenced"))).toMatchObject({
    status: "completed",
    citations: [{ deleted: false }],
  });
});

it("merges concurrent retrieval from one attempt instead of rejecting a parallel search", async () => {
  const f = await fixture();
  const first = await f.note("First", "Alpha evidence.");
  const second = await f.note("Second", "Beta evidence.");
  await f.first.send(f.owner, f.id, randomUUID(), { text: "Search twice" });
  const session = f.fake.calls.submit[0]!.sessionId;
  const turns = createConversationTurns(database.db);
  const outputs = [first, second].map((note) => ({
    sources: [{ noteId: note.noteId, version: note.source.version }],
    output: { passages: [note] },
  }));
  expect(
    await Promise.all(
      outputs.map(({ sources, output }) => turns.recordSearch(session, sources, output)),
    ),
  ).toEqual([{ status: "recorded" }, { status: "recorded" }]);
  const [turn] = await database.db
    .select()
    .from(conversationTurns)
    .where(eq(conversationTurns.sessionId, session));
  expect(turn!.sourceDependencies).toEqual(
    expect.arrayContaining(outputs.flatMap(({ sources }) => sources)),
  );
  expect(turn!.retrievalBytes).toBeGreaterThan(0);
  expect(await turns.contextAuthorized(session)).toBe(true);
});

it("does not authorize another account's source or an over-budget tool result", async () => {
  const f = await fixture();
  const other = await fixture();
  const foreign = await other.note("Private", "Not for Alex.");
  await f.first.send(f.owner, f.id, randomUUID(), { text: "Question" });
  const turns = createConversationTurns(database.db);
  const session = f.fake.calls.submit[0]!.sessionId;
  expect(
    await turns.recordSearch(
      session,
      [{ noteId: foreign.noteId, version: foreign.source.version }],
      "small",
    ),
  ).toMatchObject({ status: "unavailable" });
  expect(await turns.recordSearch(session, [], "x".repeat(48_001))).toMatchObject({
    status: "budget",
  });
});

it("keeps a paused queue across expiry/reload and concurrent explicit resumes start one attempt", async () => {
  const f = await fixture();
  await f.first.send(f.owner, f.id, randomUUID(), { text: "Active" });
  const queued = await f.first.send(f.owner, f.id, randomUUID(), { text: "Queued" });
  await f.first.stop(f.owner, f.id);
  f.fake.unreachable.add(f.fake.calls.submit[0]!.sessionId);
  await Promise.all([f.first.refresh(f.owner, f.id), f.second.refresh(f.owner, f.id)]);
  expect(f.fake.calls.submit).toHaveLength(1);
  await Promise.all([f.first.resume(f.owner, f.id), f.second.resume(f.owner, f.id)]);
  expect(new Set(f.fake.calls.submit.slice(1).map(({ key }) => key)).size).toBe(1);
  expect(await f.store.read(f.owner, f.id)).toMatchObject({
    conversation: { queuePaused: false },
    activeTurn: { inputIds: queued.status === "saved" ? [queued.value.id] : [] },
  });
});

it("reports a confirmed runtime expiry without blindly allocating a replacement", async () => {
  const f = await fixture();
  await f.first.send(f.owner, f.id, randomUUID(), { text: "Question" });
  f.fake.observe({ status: "expired", text: "" });
  await f.second.refresh(f.owner, f.id);
  expect((await f.store.read(f.owner, f.id))?.recovery?.reason).toBe("runtime_expired");
  expect(new Set(f.fake.calls.allocate).size).toBe(1);
  const failed = (await f.history()).at(-1)!;
  if (failed.role !== "assistant") throw new Error("Missing incomplete answer");
  f.fake.observe({ status: "running", text: "" });
  const operation = randomUUID();
  expect((await f.first.retry(f.owner, f.id, failed.turnId, randomUUID())).status).toBe("paused");
  await f.first.resume(f.owner, f.id);
  const [a, b] = await Promise.all([
    f.first.retry(f.owner, f.id, failed.turnId, operation),
    f.second.retry(f.owner, f.id, failed.turnId, operation),
  ]);
  expect(a.status).toBe("saved");
  expect(b.status).toBe("saved");
  expect(new Set(f.fake.calls.allocate).size).toBe(2);
  expect((await f.history()).filter(({ role }) => role === "user")).toHaveLength(1);
});

it("reports missing history as recovery but leaves an answer of unknown provenance out of context", async () => {
  for (const mode of ["missing", "unknown"] as const) {
    const f = await fixture();
    f.fake.observe(f.result([], [], "An earlier answer."));
    await f.first.send(f.owner, f.id, randomUUID(), { text: "First" });
    const [answer] = (await f.history()).filter((message) => message.role === "assistant");
    if (!answer || answer.role !== "assistant") throw new Error("Missing answer");
    if (mode === "missing")
      await database.db.delete(conversationMessages).where(eq(conversationMessages.id, answer.id));
    else
      await database.db
        .update(conversationTurns)
        .set({ provenanceComplete: false })
        .where(eq(conversationTurns.id, answer.turnId));
    f.fake.observe({ status: "running", text: "" });
    await f.second.send(f.owner, f.id, randomUUID(), { text: "What did that mean?" });
    const read = await f.store.read(f.owner, f.id);
    if (mode === "missing") {
      expect(read?.recovery?.reason).toBe("history_unavailable");
      expect(read?.conversation.queuePaused).toBe(true);
      expect(f.fake.calls.submit).toHaveLength(1);
    } else {
      // A pre-migration answer cannot prove its lineage. The follow-up still runs without it.
      expect(read?.recovery).toBeNull();
      expect(f.fake.calls.submit).toHaveLength(2);
      expect(f.fake.calls.submit[1]!.message).toContain("First");
      expect(f.fake.calls.submit[1]!.message).not.toContain("An earlier answer.");
    }
  }
});

it("reports a summary failure instead of using the unbounded old answer", async () => {
  const f = await fixture();
  f.fake.observe(f.result([], [], "old ".repeat(3_000)));
  await f.first.send(f.owner, f.id, randomUUID(), { text: "First" });
  f.fake.summary({ summary: "" });
  await f.second.send(f.owner, f.id, randomUUID(), { text: "Follow-up" });
  expect((await f.store.read(f.owner, f.id))?.recovery?.reason).toBe("summary_failed");
  expect(f.fake.calls.submit).toHaveLength(1);
  expect((await f.history()).some(({ text }) => text === "old ".repeat(3_000))).toBe(true);
});

it("fences a summary that completes after its source was deleted", async () => {
  const f = await fixture();
  const source = await f.note("Source", "SUMMARY-RACE-MARKER");
  f.fake.observe(
    f.result(
      [source],
      [{ source: source.source, excerpt: source.text }],
      `${source.text} ${"detail ".repeat(1_500)}`,
    ),
  );
  await f.first.send(f.owner, f.id, randomUUID(), { text: "First" });
  f.fake.compactor.inspect = async () => {
    await createNoteStore(database.db).delete(f.owner, source.noteId, source.revision);
    return { status: "completed", result: { summary: source.text } };
  };
  await f.second.send(f.owner, f.id, randomUUID(), { text: "Follow-up" });
  await f.first.refresh(f.owner, f.id);
  expect(
    await database.db
      .select()
      .from(conversationSummaries)
      .where(eq(conversationSummaries.conversationId, f.id)),
  ).toEqual([]);
  expect(f.fake.calls.submit).toHaveLength(1);
  expect((await f.store.read(f.owner, f.id))?.recovery?.reason).toBe("source_changed");
});

it("rebuilds against edited sources without silently reusing their historical facts", async () => {
  const f = await fixture();
  const source = await f.note("Schedule", "Tuesday");
  f.fake.observe(
    f.result([source], [{ source: source.source, excerpt: "Tuesday" }], "The meeting is Tuesday."),
  );
  await f.first.send(f.owner, f.id, randomUUID(), { text: "When?" });
  await createNoteStore(database.db).update(f.owner, source.noteId, source.revision, {
    title: "Schedule",
    content: "Wednesday",
  });
  f.fake.observe({ status: "running", text: "" });
  await f.second.send(f.owner, f.id, randomUUID(), { text: "When is it now?" });
  expect(f.fake.calls.submit.at(-1)!.message).not.toContain("Tuesday");
  expect((await f.history()).find(({ text }) => text === "The meeting is Tuesday.")).toMatchObject({
    citations: [{ stale: true }],
  });
});

it("stops a compaction session and retains its queued input until an explicit resume", async () => {
  const f = await fixture();
  f.fake.observe(f.result([], [], "old ".repeat(3_000)));
  await f.first.send(f.owner, f.id, randomUUID(), { text: "First" });
  f.fake.compactor.inspect = async () => ({ status: "running" });
  await f.first.send(f.owner, f.id, randomUUID(), { text: "Follow-up" });
  await f.first.send(f.owner, f.id, randomUUID(), { text: "Still queued" });
  const session = f.fake.calls.compact[0]!.sessionId;
  expect(await createConversationContextStore(database.db).summaryAuthorized(session)).toBe(true);
  await f.second.stop(f.owner, f.id);
  expect(f.fake.calls.retire).toContain(session);
  expect(await createConversationContextStore(database.db).summaryAuthorized(session)).toBe(false);
  expect((await f.store.read(f.owner, f.id))?.conversation.queuePaused).toBe(true);
});

it("shows corrupt context as recovery and never resubmits a changed prompt under the old key", async () => {
  const f = await fixture();
  await f.first.send(f.owner, f.id, randomUUID(), { text: "Question" });
  await database.db
    .update(conversationContexts)
    .set({ recent: sql`'[{"invalid":"history"}]'::jsonb` })
    .where(eq(conversationContexts.conversationId, f.id));
  await f.second.refresh(f.owner, f.id);
  expect((await f.store.read(f.owner, f.id))?.recovery?.reason).toBe("history_unavailable");
  expect(f.fake.calls.submit).toHaveLength(1);
});

it("keeps a queued question whose sequence falls inside a compacted checkpoint", async () => {
  const f = await fixture();
  await f.first.send(f.owner, f.id, randomUUID(), { text: "First question" });
  await f.first.send(f.owner, f.id, randomUUID(), { text: "Remember my choice of blue?" });
  f.fake.observe(f.result([], [], "Old answer detail. ".repeat(600)));
  await f.second.refresh(f.owner, f.id);
  const [checkpoint] = await database.db
    .select()
    .from(conversationSummaries)
    .where(eq(conversationSummaries.conversationId, f.id));
  const queued = (await f.history()).find(({ text }) => text === "Remember my choice of blue?")!;
  expect(checkpoint!.deferredInputIds).toContain(queued.id);
  f.fake.observe(f.result([], [], "Recorded your choice."));
  await f.first.refresh(f.owner, f.id);
  f.fake.observe({ status: "running", text: "" });
  await f.second.send(f.owner, f.id, randomUUID(), { text: "Which color did I choose?" });
  expect(f.fake.calls.submit.at(-1)!.message).toContain("Remember my choice of blue?");
});

it("reconnects to one durable compaction operation across concurrent API processes", async () => {
  const f = await fixture();
  f.fake.observe(f.result([], [], "old ".repeat(3_000)));
  await f.first.send(f.owner, f.id, randomUUID(), { text: "First" });
  f.fake.compactor.inspect = async () => ({ status: "running" });
  await f.second.send(f.owner, f.id, randomUUID(), { text: "Follow-up" });
  await Promise.all([f.first.refresh(f.owner, f.id), f.second.refresh(f.owner, f.id)]);
  expect(new Set(f.fake.calls.compact.map(({ key }) => key)).size).toBe(1);
  expect(f.fake.calls.submit).toHaveLength(1);
  f.fake.compactor.inspect = async () => ({
    status: "completed",
    result: { summary: "Earlier discussion." },
  });
  await Promise.all([f.first.refresh(f.owner, f.id), f.second.refresh(f.owner, f.id)]);
  f.fake.observe({ status: "running", text: "" });
  await f.first.refresh(f.owner, f.id);
  expect(f.fake.calls.submit.at(-1)!.message).toContain("Earlier discussion.");
});

it("retains an oversized accepted input but reports context budget recovery without starting a model", async () => {
  const f = await fixture();
  const text = "漢".repeat(9_000);
  await f.first.send(f.owner, f.id, randomUUID(), { text });
  expect((await f.store.read(f.owner, f.id))?.recovery?.reason).toBe("context_budget");
  expect((await f.history())[0]!.text).toBe(text);
  expect(f.fake.calls.allocate).toHaveLength(0);
});

it("retains cleanup for a summary allocation returned after conversation deletion", async () => {
  const f = await fixture();
  f.fake.observe(f.result([], [], "old ".repeat(3_000)));
  await f.first.send(f.owner, f.id, randomUUID(), { text: "First" });
  f.fake.compactor.allocate = async () => {
    await f.store.delete(f.owner, f.id);
    return "late-summary-session";
  };
  await f.second.send(f.owner, f.id, randomUUID(), { text: "Follow-up" });
  expect(await f.store.read(f.owner, f.id)).toBeUndefined();
  expect(f.fake.calls.compact).toHaveLength(0);
  expect(
    await database.db
      .select()
      .from(conversationContexts)
      .where(eq(conversationContexts.conversationId, f.id)),
  ).toEqual([]);
  const intents = await database.db
    .select()
    .from(conversationCleanupIntents)
    .where(eq(conversationCleanupIntents.conversationId, f.id));
  expect(
    intents.some(
      (intent) => intent.purpose === "summary" && intent.sessionId === "late-summary-session",
    ),
  ).toBe(true);
});

it("suppresses a late answer after access loss even when no citation names the lost source", async () => {
  const f = await fixture();
  const source = await f.note("Private", "ACCESS-LOSS-MARKER");
  f.fake.observe(
    f.result([source], [{ source: source.source, excerpt: source.text }], source.text),
  );
  await f.first.send(f.owner, f.id, randomUUID(), { text: "First" });
  f.fake.observe({ status: "running", text: "" });
  await f.second.send(f.owner, f.id, randomUUID(), { text: "More on that?" });
  const session = f.fake.calls.submit.at(-1)!.sessionId;
  await database.db
    .update(noteRows)
    .set({ ownerId: "synthetic-new-owner" })
    .where(eq(noteRows.id, source.noteId));
  expect(await createConversationTurns(database.db).contextAuthorized(session)).toBe(false);
  f.fake.observe(f.result([], [], "Unpublished ACCESS-LOSS-MARKER"));
  await f.first.refresh(f.owner, f.id);
  expect((await f.history()).at(-1)).toMatchObject({ status: "incomplete", text: "" });
});

it("exposes a refused summary as recovery instead of retrying the same refused input forever", async () => {
  const f = await fixture();
  f.fake.observe(f.result([], [], "old ".repeat(3_000)));
  await f.first.send(f.owner, f.id, randomUUID(), { text: "First" });
  let submissions = 0;
  f.fake.compactor.submit = async () => {
    submissions++;
    return { status: "rejected" };
  };
  await f.second.send(f.owner, f.id, randomUUID(), { text: "Follow-up" });
  await f.first.refresh(f.owner, f.id);
  expect(submissions).toBe(1);
  expect((await f.store.read(f.owner, f.id))?.recovery?.reason).toBe("context_budget");
});

it("requires current source revisions for new context but allows an in-flight used revision", async () => {
  const f = await fixture();
  const note = await f.note("Source", "Original content.");
  const oldSource = { noteId: note.noteId, version: note.source.version };
  await createNoteStore(database.db).update(f.owner, note.noteId, note.revision, {
    title: "Source",
    content: "Changed content.",
  });
  expect(await database.db.transaction((tx) => lockContextSources(tx, f.owner, [oldSource]))).toBe(
    true,
  );
  expect(
    await database.db.transaction((tx) =>
      lockContextSources(tx, f.owner, [oldSource], { requireCurrentVersion: true }),
    ),
  ).toBe(false);
});

it("does not call the summary provider after its durable window closes", async () => {
  const f = await fixture();
  f.fake.observe(f.result([], [], "old ".repeat(3_000)));
  await f.first.send(f.owner, f.id, randomUUID(), { text: "First" });
  f.fake.compactor.inspect = async () => ({ status: "running" });
  await f.second.send(f.owner, f.id, randomUUID(), { text: "Follow-up" });
  const summarySubmissions = f.fake.calls.compact.length;
  expect(summarySubmissions).toBeGreaterThan(0);
  await database.db
    .update(conversationCleanupIntents)
    .set({ retryAt: sql`now() - interval '1 minute'` })
    .where(
      and(
        eq(conversationCleanupIntents.ownerId, f.owner),
        eq(conversationCleanupIntents.purpose, "summary"),
      ),
    );
  await database.db
    .update(conversationContexts)
    .set({ sessionId: null, deliveryId: null })
    .where(eq(conversationContexts.conversationId, f.id));
  await f.first.refresh(f.owner, f.id);
  expect(f.fake.calls.compact).toHaveLength(summarySubmissions);
  expect((await f.store.read(f.owner, f.id))?.recovery?.reason).toBe("summary_failed");
  expect((await f.history()).at(-1)).toMatchObject({ status: "incomplete", reason: "failed" });
});

it("redacts a delivered citation when note deletion receives an uppercase UUID", async () => {
  const f = await fixture();
  const source = await f.note("Source", "UPPERCASE-MARKER");
  f.fake.observe(
    f.result(
      [source],
      [{ source: source.source, excerpt: "UPPERCASE-MARKER" }],
      "UPPERCASE-MARKER",
    ),
  );
  await f.first.send(f.owner, f.id, randomUUID(), { text: "First" });
  await database.db
    .delete(conversationSummaries)
    .where(eq(conversationSummaries.conversationId, f.id));
  await database.db.insert(conversationSummaries).values({
    conversationId: f.id,
    throughSequence: 1,
    text: "UPPERCASE-MARKER summary",
    sources: [{ noteId: source.noteId, version: source.source.version }],
  });
  const deleted = await createNoteStore(database.db).delete(
    f.owner,
    source.noteId.toUpperCase(),
    source.revision,
  );
  expect(deleted.status).toBe("deleted");
  expect(
    await database.db
      .select()
      .from(conversationSummaries)
      .where(eq(conversationSummaries.conversationId, f.id)),
  ).toEqual([]);
  expect((await f.history()).find((message) => message.text === "UPPERCASE-MARKER")).toMatchObject({
    citations: [{ deleted: true, excerpt: null }],
  });
});

it("replays a stopped terminal result with the same normalized publication hash", async () => {
  const f = await fixture();
  await f.first.send(f.owner, f.id, randomUUID(), { text: "Question" });
  const active = (await f.store.read(f.owner, f.id))!.activeTurn!;
  const stopped = await f.first.stop(f.owner, f.id);
  if (stopped.status !== "paused" || stopped.message?.role !== "assistant")
    throw new Error("Stop did not publish an incomplete answer");
  expect(
    await createConversationTurns(database.db).finalize(f.owner, f.id, active.id, {
      status: "incomplete",
      reason: "cancelled",
      text: stopped.message.text,
      citations: [],
      expectedVersion: active.checkpointVersion,
    }),
  ).toMatchObject({ status: "saved" });
});

it("does not let stale summary recovery overwrite a ready context", async () => {
  const f = await fixture();
  f.fake.observe(f.result([], [], "old ".repeat(3_000)));
  await f.first.send(f.owner, f.id, randomUUID(), { text: "First" });
  f.fake.compactor.inspect = async () => ({ status: "running" });
  await f.second.send(f.owner, f.id, randomUUID(), { text: "Follow-up" });
  const active = (await f.store.read(f.owner, f.id))!.activeTurn!;
  const contexts = createConversationContextStore(database.db);
  const [context] = await database.db
    .select()
    .from(conversationContexts)
    .where(eq(conversationContexts.turnId, active.id));
  if (!context) throw new Error("Missing summarizing context");
  expect(await contexts.publishSummary(f.owner, context, { summary: "Valid summary." })).toBe(true);
  expect(await contexts.recoverSummarizing(f.owner, f.id, active.id, "summary_failed")).toBe(false);
  expect(
    await database.db
      .select()
      .from(conversationContexts)
      .where(eq(conversationContexts.turnId, active.id)),
  ).toMatchObject([{ state: "ready", summary: "Valid summary." }]);
  expect((await f.store.read(f.owner, f.id))?.conversation.queuePaused).toBe(false);
});

it("persists a failed search context as a visible recovery state", async () => {
  const f = await fixture();
  await f.first.send(f.owner, f.id, randomUUID(), { text: "Question" });
  const session = f.fake.calls.submit[0]!.sessionId;
  expect(
    await createConversationContextStore(database.db).recoverBySession(session, "context_budget"),
  ).toBe(true);
  expect((await f.store.read(f.owner, f.id))?.recovery?.reason).toBe("context_budget");
});

it("invalidates derived context when the deleted note id arrives in upper case", async () => {
  const f = await fixture();
  const { title, content, question, next } = cases.deletedSource;
  const source = await f.note(title, content);
  f.fake.observe(
    f.result(
      [source],
      [{ source: source.source, excerpt: content }],
      `${content} ${"detail ".repeat(1_500)}`,
    ),
  );
  await f.first.send(f.owner, f.id, randomUUID(), { text: question });
  f.fake.summary({ summary: `Earlier: ${content}` });
  f.fake.observe({ status: "running", text: "" });
  await f.second.send(f.owner, f.id, randomUUID(), { text: next });
  const summaries = () =>
    database.db
      .select()
      .from(conversationSummaries)
      .where(eq(conversationSummaries.conversationId, f.id));
  expect(await summaries()).toHaveLength(1);
  await createNoteStore(database.db).delete(f.owner, source.noteId.toUpperCase(), source.revision);
  expect(await summaries()).toEqual([]);
});

it("leaves a message too large for any context out of later turns instead of blocking them", async () => {
  const f = await fixture();
  const huge = "漢".repeat(17_000);
  await f.first.send(f.owner, f.id, randomUUID(), { text: huge });
  expect(await f.store.read(f.owner, f.id)).toMatchObject({
    recovery: { reason: "context_budget" },
    conversation: { queuePaused: true },
  });
  await f.first.resume(f.owner, f.id);
  await f.second.send(f.owner, f.id, randomUUID(), { text: "A normal question" });
  expect((await f.store.read(f.owner, f.id))?.recovery).toBeNull();
  expect(f.fake.calls.compact).toHaveLength(0);
  expect(f.fake.calls.submit.map(({ message }) => message)).toEqual(["A normal question"]);
  // A reconnect rereads the saved snapshot. It must still be valid without the huge message.
  await f.first.refresh(f.owner, f.id);
  expect((await f.store.read(f.owner, f.id))?.recovery).toBeNull();
  expect((await f.history())[0]!.text).toBe(huge);
});

it("leaves a cancelled partial answer out of the next prompt", async () => {
  const f = await fixture();
  const { question, partial, next } = cases.expiredRuntime;
  await f.first.send(f.owner, f.id, randomUUID(), { text: question });
  f.fake.observe({ status: "cancelled", text: partial });
  await f.first.refresh(f.owner, f.id);
  f.fake.observe({ status: "running", text: "" });
  await f.second.send(f.owner, f.id, randomUUID(), { text: next });
  const prompt = f.fake.calls.submit.at(-1)!.message;
  expect(prompt).toContain(question);
  expect(prompt).not.toContain(partial);
  expect((await f.history()).some(({ text }) => text === partial)).toBe(true);
});

it("does not reopen the summary window when retiring its expired session fails", async () => {
  const f = await fixture();
  f.fake.observe(f.result([], [], "old ".repeat(3_000)));
  await f.first.send(f.owner, f.id, randomUUID(), { text: "First" });
  f.fake.compactor.inspect = async () => ({ status: "running" });
  await f.first.send(f.owner, f.id, randomUUID(), { text: "Follow-up" });
  const session = f.fake.calls.compact[0]!.sessionId;
  const contexts = createConversationContextStore(database.db);
  expect(await contexts.summaryAuthorized(session)).toBe(true);
  await database.db
    .update(conversationCleanupIntents)
    .set({ retryAt: sql`now()` })
    .where(eq(conversationCleanupIntents.sessionId, session));
  f.fake.compactor.retire = async () => {
    throw new Error("unconfirmed");
  };
  await f.first.sweep(100);
  const [intent] = await database.db
    .select()
    .from(conversationCleanupIntents)
    .where(eq(conversationCleanupIntents.sessionId, session));
  // The failed retirement was rescheduled into the future. That is not a new deadline.
  expect(Date.parse(intent!.retryAt)).toBeGreaterThan(Date.now());
  expect(await contexts.summaryAuthorized(session)).toBe(false);
});

it("sends no context to a session allocated while its source was being deleted", async () => {
  const f = await fixture();
  const source = await f.note("Source", "ALLOCATION-RACE-MARKER");
  f.fake.observe(
    f.result([source], [{ source: source.source, excerpt: source.text }], source.text),
  );
  await f.first.send(f.owner, f.id, randomUUID(), { text: "First" });
  f.fake.observe({ status: "running", text: "" });
  f.fake.runtime.allocate = async (operationId) => {
    await createNoteStore(database.db).delete(f.owner, source.noteId, source.revision);
    return `session-${operationId}`;
  };
  await f.second.send(f.owner, f.id, randomUUID(), { text: "More on that?" });
  expect(f.fake.calls.submit).toHaveLength(1);
  // The next read ends the attempt. It still never delivers the stale snapshot.
  await f.first.refresh(f.owner, f.id);
  expect(f.fake.calls.submit).toHaveLength(1);
  expect((await f.store.read(f.owner, f.id))?.recovery?.reason).toBe("source_changed");
  expect((await f.history()).at(-1)).toMatchObject({ status: "incomplete", text: "" });
});

it("charges an explicit retry against the owner's send limit", async () => {
  const f = await fixture();
  await f.first.send(f.owner, f.id, randomUUID(), { text: "Question" });
  f.fake.observe({ status: "failed", text: "" });
  await f.first.refresh(f.owner, f.id);
  const failed = (await f.history()).at(-1)!;
  if (failed.role !== "assistant") throw new Error("Missing incomplete answer");
  const now = new Date().toISOString();
  await database.db
    .update(conversationAdmissions)
    .set({ admittedAt: Array.from({ length: 20 }, () => now) })
    .where(eq(conversationAdmissions.ownerId, f.owner));
  expect(await f.first.retry(f.owner, f.id, failed.turnId, randomUUID())).toMatchObject({
    status: "rate_limited",
  });
  expect(f.fake.calls.allocate).toHaveLength(1);
});

it("rebuilds from the newest history that fits after a long conversation loses its summary", async () => {
  const f = await fixture();
  for (let index = 0; index < 7; index++) {
    f.fake.observe(f.result([], [], `Answer ${index}. ${"w ".repeat(4_500)}`));
    await f.first.send(f.owner, f.id, randomUUID(), { text: `Question ${index}` });
    for (let pass = 0; pass < 3; pass++) await f.first.refresh(f.owner, f.id);
  }
  expect((await f.history()).filter(({ role }) => role === "assistant")).toHaveLength(7);
  // The same loss a source deletion causes, without needing a note here.
  await database.db
    .delete(conversationSummaries)
    .where(eq(conversationSummaries.conversationId, f.id));
  f.fake.observe({ status: "running", text: "" });
  await f.first.send(f.owner, f.id, randomUUID(), { text: cases.followUp.next });
  await f.first.refresh(f.owner, f.id);
  const rebuilt = f.fake.calls.compact.at(-1)!.message;
  expect(Buffer.byteLength(rebuilt)).toBeLessThanOrEqual(48_000);
  expect(rebuilt).toContain("Answer 6.");
  expect(rebuilt).not.toContain("Answer 0.");
  expect((await f.store.read(f.owner, f.id))?.recovery).toBeNull();
  expect(f.fake.calls.submit.at(-1)!.message).toContain(cases.followUp.next);
});

it("stops inheriting lineage at its cap instead of making the conversation unanswerable", async () => {
  const f = await fixture();
  const now = new Date().toISOString();
  const texts = ["LINEAGE-CAP-FIRST answer.", "LINEAGE-CAP-SECOND answer."];
  for (const text of texts) {
    f.fake.observe(f.result([], [], text));
    await f.first.send(f.owner, f.id, randomUUID(), { text: "Another question" });
    // Each answer depends on 400 distinct notes, as many searches over a long attempt would.
    const sources = await database.db
      .insert(noteRows)
      .values(
        Array.from({ length: 400 }, () => ({
          ownerId: f.owner,
          title: "Synthetic",
          content: "Synthetic source.",
          createdAt: now,
          updatedAt: now,
        })),
      )
      .returning({ id: noteRows.id, revision: noteRows.revision });
    const answer = (await f.history()).at(-1)!;
    if (answer.role !== "assistant") throw new Error("Missing answer");
    await database.db
      .update(conversationTurns)
      .set({
        sourceDependencies: sources.map(({ id, revision }) => ({
          noteId: id,
          version: noteTag(id, revision),
        })),
      })
      .where(eq(conversationTurns.id, answer.turnId));
  }
  f.fake.observe({ status: "running", text: "" });
  await f.first.send(f.owner, f.id, randomUUID(), { text: "And now?" });
  await f.first.refresh(f.owner, f.id);
  expect((await f.store.read(f.owner, f.id))?.recovery).toBeNull();
  const prompt = f.fake.calls.submit.at(-1)!.message;
  // 800 inherited sources would leave no room to record new retrieval. The later answer is
  // left out whole; its lineage is never dropped while its text stays.
  expect(prompt).toContain(texts[0]);
  expect(prompt).not.toContain(texts[1]);
  const [context] = await database.db
    .select()
    .from(conversationContexts)
    .where(eq(conversationContexts.conversationId, f.id))
    .orderBy(
      sql`cardinality(ARRAY(SELECT jsonb_array_elements(${conversationContexts.sources}))) DESC`,
    )
    .limit(1);
  expect(context!.sources).toHaveLength(400);
});

it("drops a running draft when its source is deleted and refuses a late checkpoint", async () => {
  const f = await fixture();
  const source = await f.note("Source", "CHECKPOINT-MARKER");
  f.fake.observe(
    f.result([source], [{ source: source.source, excerpt: source.text }], source.text),
  );
  await f.first.send(f.owner, f.id, randomUUID(), { text: "First" });
  f.fake.observe({ status: "running", text: "A draft with CHECKPOINT-MARKER" });
  await f.second.send(f.owner, f.id, randomUUID(), { text: "More on that?" });
  const turns = createConversationTurns(database.db);
  expect((await turns.dispatchState(f.owner, f.id))?.turn.runningText).toContain("MARKER");
  await createNoteStore(database.db).delete(f.owner, source.noteId, source.revision);
  const { turn } = (await turns.dispatchState(f.owner, f.id))!;
  expect(turn.runningText).toBe("");
  // A driver that read the runtime before the deletion reports its text afterwards.
  expect(
    await turns.checkpoint(
      f.owner,
      f.id,
      turn.id,
      turn.checkpointVersion,
      "Late CHECKPOINT-MARKER",
    ),
  ).toEqual({ status: "conflict" });
  await f.first.stop(f.owner, f.id);
  expect((await f.history()).at(-1)).toMatchObject({ status: "incomplete", text: "" });
});

it("sends no context when its source is deleted before the runtime is prepared", async () => {
  const f = await fixture();
  const source = await f.note("Source", "PRE-ALLOCATION-MARKER");
  f.fake.observe(
    f.result([source], [{ source: source.source, excerpt: source.text }], source.text),
  );
  await f.first.send(f.owner, f.id, randomUUID(), { text: "First" });
  f.fake.observe({ status: "running", text: "" });
  const cleanup = createConversationCleanupStore(database.db);
  // The deletion lands after the context snapshot and before any cleanup intent exists.
  const racing = createConversationAnswers({
    turns: createConversationTurns(database.db),
    contexts: createConversationContextStore(database.db),
    compactorFor: () => f.fake.compactor,
    runtimeUrl: "https://answers.example.test",
    runtimeFor: () => f.fake.runtime,
    cleanup: {
      ...cleanup,
      prepareRuntime: async (...args) => {
        await createNoteStore(database.db).delete(f.owner, source.noteId, source.revision);
        return cleanup.prepareRuntime(...args);
      },
    },
  });
  await racing.send(f.owner, f.id, randomUUID(), { text: "More on that?" });
  expect(f.fake.calls.submit).toHaveLength(1);
  expect(await f.store.read(f.owner, f.id)).toMatchObject({
    recovery: { reason: "source_changed" },
    conversation: { queuePaused: true },
  });
});
