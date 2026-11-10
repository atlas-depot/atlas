import { randomUUID } from "node:crypto";
import { eq, inArray, sql } from "drizzle-orm";
import { readFileSync } from "node:fs";
import { expect, it } from "vite-plus/test";
import type { NotePassageSource } from "../../shared/passages.ts";
import { evidenceId, type AnswerObservation, type AnswerRuntime } from "../conversation-answer.ts";
import { createConversationAnswers } from "../conversation-answers.ts";
import { createConversationAdmission } from "./conversation-admission.ts";
import { createConversationCleanupStore } from "./conversation-cleanup.ts";
import {
  conversationAdmissions,
  conversationCleanupIntents,
  conversations,
  conversationTurns,
} from "./conversation-schema.ts";
import { createConversationStore } from "./conversations.ts";
import { createConversationTurns } from "./conversation-turns.ts";
import { setupIndexTestDatabase } from "./index-test-database.ts";
import { createNoteStore, noteTag } from "./notes.ts";

const database = setupIndexTestDatabase();
const malicious = JSON.parse(
  readFileSync(
    new URL("../../fixtures/conversations/malicious-note.json", import.meta.url),
    "utf8",
  ),
) as { title: string; content: string; question: string; supportedExcerpt: string };

/** A scripted private runtime. It records every call so duplicated work is visible. */
function fakeRuntime() {
  const calls = {
    allocate: [] as string[],
    submit: [] as { sessionId: string; key: string; message: string }[],
    steer: [] as { sessionId: string; key: string; message: string }[],
    retire: [] as string[],
  };
  let observation: AnswerObservation = { status: "running", text: "" };
  let lostSubmits = 0;
  const unreachable = new Set<string>();
  const inspected: string[] = [];
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
      admit: createConversationAdmission(db),
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
    first: service(database.db),
    /** A second API process: its own pool and no shared memory. */
    second: service(database.other),
  };
}

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
  expect(f.fake.calls.submit.at(-1)?.message).toBe("Question 1:\nSecond\n\nQuestion 2:\nThird");
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
