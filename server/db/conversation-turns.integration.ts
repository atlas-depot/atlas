import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { expect, it } from "vite-plus/test";
import type { NotePassageSource } from "../../shared/passages.ts";
import { setupIndexTestDatabase } from "./index-test-database.ts";
import { createConversationStore } from "./conversations.ts";
import { createConversationTurns } from "./conversation-turns.ts";
import { conversationMessages, conversationTurns, conversations } from "./conversation-schema.ts";
import { createNoteStore, noteTag } from "./notes.ts";
import { notes } from "./schema.ts";

const database = setupIndexTestDatabase();
async function fixture() {
  const owner = randomUUID();
  const [parent] = await database.db.insert(conversations).values({ ownerId: owner }).returning();
  const first = createConversationTurns(database.db);
  const second = createConversationTurns(database.other);
  const id = parent!.id;
  async function input(text = "Synthetic question", policy: "queue" | "steer" = "queue") {
    const result = await first.acceptInput(owner, id, randomUUID(), { text, policy });
    if (result.status !== "saved") throw new Error("Input not saved");
    return result.value;
  }
  async function start(inputIds: string[], retryOfId?: string) {
    const result = await first.startAttempt(owner, id, randomUUID(), { inputIds, retryOfId });
    if (result.status !== "saved") throw new Error(`Attempt not saved: ${result.status}`);
    return result.value;
  }
  return { owner, id, first, second, input, start };
}

it("serializes duplicate acceptance across two pools and never changes the original input", async () => {
  const f = await fixture();
  const key = randomUUID();
  const payload = { text: "Original synthetic message" };
  const [a, b] = await Promise.all([
    f.first.acceptInput(f.owner, f.id, key, payload),
    f.second.acceptInput(f.owner, f.id, key, payload),
  ]);
  expect(a).toEqual(b);
  expect(a).toMatchObject({ status: "saved", value: { sequence: 1, deliveryPolicy: "queue" } });
  expect(await f.first.acceptInput(f.owner, f.id, key, { text: "Different" })).toEqual({
    status: "conflict",
  });
  expect(await f.first.acceptInput(randomUUID(), f.id, key, payload)).toEqual({
    status: "not_found",
  });
  const next = await f.input();
  expect(next.sequence).toBe(2);
});

it("admits one attempt, preserves grouped input order and rejects stale/checkpoint and terminal writes", async () => {
  const f = await fixture();
  const inputs = [await f.input("One"), await f.input("Two")];
  const inputIds = inputs.map((input) => input.id);
  const operation = randomUUID();
  const [a, b] = await Promise.all([
    f.first.startAttempt(f.owner, f.id, operation, { inputIds }),
    f.second.startAttempt(f.owner, f.id, operation, { inputIds }),
  ]);
  expect(a).toEqual(b);
  if (a.status !== "saved") throw new Error("Missing attempt");
  const turn = a.value;
  expect(await f.second.startAttempt(f.owner, f.id, randomUUID(), { inputIds })).toMatchObject({
    status: "busy",
  });
  expect(await f.first.checkpoint(f.owner, f.id, turn.id, 0, "Partial")).toEqual({
    status: "saved",
    version: 1,
  });
  expect(await f.second.checkpoint(f.owner, f.id, turn.id, 0, "Partial")).toEqual({
    status: "saved",
    version: 1,
  });
  expect(await f.first.checkpoint(f.owner, f.id, turn.id, 0, "Stale overwrite")).toEqual({
    status: "conflict",
  });
  const result = {
    status: "no-support" as const,
    text: "No support in current notes.",
    citations: [],
    expectedVersion: 1,
  };
  expect(await f.first.finalize(f.owner, f.id, turn.id, { ...result, expectedVersion: 0 })).toEqual(
    { status: "conflict" },
  );
  const final = await f.first.finalize(f.owner, f.id, turn.id, result);
  expect(final).toMatchObject({
    status: "saved",
    value: { status: "no-support", inputIds, sequence: 3 },
  });
  expect(await f.second.finalize(f.owner, f.id, turn.id, result)).toEqual(final);
  expect(
    await f.first.finalize(f.owner, f.id, turn.id, { ...result, text: "Replacement" }),
  ).toEqual({ status: "conflict" });
  expect(await f.first.checkpoint(f.owner, f.id, turn.id, 1, "Late chunk")).toEqual({
    status: "conflict",
  });
  expect(await f.first.startAttempt(f.owner, f.id, randomUUID(), { inputIds })).toEqual({
    status: "conflict",
  });
});

it("Stop preserves partial output and queued messages, requires resume and explicit retry keeps original identity", async () => {
  const f = await fixture();
  const question = await f.input();
  const turn = await f.start([question.id]);
  await f.first.checkpoint(f.owner, f.id, turn.id, 0, "Useful unfinished text");
  const queued = await f.input("Next question");
  const stopped = await f.second.stop(f.owner, f.id);
  expect(stopped).toMatchObject({
    status: "paused",
    message: {
      status: "incomplete",
      reason: "cancelled",
      text: "Useful unfinished text",
      inputIds: [question.id],
    },
  });
  expect(
    await f.first.startAttempt(f.owner, f.id, randomUUID(), { inputIds: [queued.id] }),
  ).toEqual({ status: "paused" });
  expect(await createConversationStore(database.other).read(f.owner, f.id)).toMatchObject({
    conversation: { queuePaused: true },
    activeTurn: null,
  });
  await f.first.resume(f.owner, f.id);
  const retry = await f.start([question.id], turn.id);
  expect(retry.id).not.toBe(turn.id);
  await f.first.finalize(f.owner, f.id, retry.id, {
    status: "incomplete",
    reason: "failed",
    text: "Retry failed",
    citations: [],
    expectedVersion: 0,
  });
  const history = await createConversationStore(database.db).messages(f.owner, f.id, { limit: 50 });
  expect(history?.messages.filter((message) => message.role === "user")).toHaveLength(2);
  expect(history?.messages.filter((message) => message.role === "assistant")).toMatchObject([
    { text: "Useful unfinished text", status: "incomplete" },
    { text: "Retry failed", status: "incomplete" },
  ]);
  expect((await f.start([queued.id])).status).toBe("running");
});

it("concurrent Stop and completion publish exactly one terminal answer", async () => {
  const f = await fixture();
  const turn = await f.start([(await f.input()).id]);
  await f.first.checkpoint(f.owner, f.id, turn.id, 0, "Partial answer");
  const [stopped, finalized] = await Promise.all([
    f.first.stop(f.owner, f.id),
    f.second.finalize(f.owner, f.id, turn.id, {
      status: "no-support",
      text: "No supporting source",
      citations: [],
      expectedVersion: 1,
    }),
  ]);
  expect(stopped.status).toBe("paused");
  expect(["saved", "conflict"]).toContain(finalized.status);
  const history = await createConversationStore(database.db).messages(f.owner, f.id, { limit: 50 });
  expect(history?.messages).toHaveLength(2);
  expect(history?.messages[1]).toMatchObject(
    finalized.status === "saved"
      ? { status: "no-support", text: "No supporting source" }
      : { status: "incomplete", reason: "cancelled", text: "Partial answer" },
  );
});

it("rejects input reordering and foreign identity, and starts a steer normally when nothing is running", async () => {
  const f = await fixture();
  const one = await f.input("One");
  const two = await f.input("Two");
  const steer = await f.input("Different direction", "steer");
  expect(
    await f.first.startAttempt(f.owner, f.id, randomUUID(), { inputIds: [two.id, one.id] }),
  ).toEqual({ status: "conflict" });
  expect(
    await f.first.startAttempt(f.owner, f.id, randomUUID(), { inputIds: [randomUUID()] }),
  ).toEqual({ status: "conflict" });
  expect(steer).toMatchObject({ deliveryPolicy: "steer" });
  expect(await f.first.startNext(f.owner, f.id)).toMatchObject({ status: "started" });
  expect(await createConversationStore(database.db).read(f.owner, f.id)).toMatchObject({
    activeTurn: { inputIds: [one.id, two.id, steer.id] },
  });
});

async function source(owner: string) {
  const stored = await createNoteStore(database.db).create(owner, {
    title: "Synthetic source",
    content: "The source excerpt.",
    createdAt: new Date().toISOString(),
  });
  const source: NotePassageSource = {
    kind: "markdown",
    noteId: stored.note.id,
    version: noteTag(stored.note.id, stored.revision),
    headingPath: [],
    startOffset: 0,
    endOffset: 19,
  };
  return { source, excerpt: "The source excerpt.", deleted: false };
}

it("publishes a used old revision as stale and replay returns redacted citations after source deletion", async () => {
  const f = await fixture();
  const citation = await source(f.owner);
  const turn = await f.start([(await f.input()).id]);
  await database.db.update(notes).set({ revision: 2 }).where(eq(notes.id, citation.source.noteId));
  const payload = {
    status: "completed" as const,
    text: "Supported answer",
    citations: [citation],
    expectedVersion: 0,
  };
  expect(await f.first.finalize(f.owner, f.id, turn.id, payload)).toMatchObject({
    status: "saved",
    value: { citations: [{ stale: true, excerpt: citation.excerpt }] },
  });
  expect(await createNoteStore(database.other).delete(f.owner, citation.source.noteId, 2)).toEqual({
    status: "deleted",
  });
  expect(await f.second.finalize(f.owner, f.id, turn.id, payload)).toMatchObject({
    status: "saved",
    value: {
      text: "Supported answer",
      citations: [{ deleted: true, excerpt: null, stale: false }],
    },
  });
});

it("source access lost before finalization erases the partial checkpoint and fences late Stop/publication", async () => {
  const f = await fixture();
  const citation = await source(randomUUID());
  const turn = await f.start([(await f.input()).id]);
  await f.first.checkpoint(f.owner, f.id, turn.id, 0, "Must not survive refusal");
  const payload = {
    status: "completed" as const,
    text: "Private source output",
    citations: [citation],
    expectedVersion: 1,
  };
  expect(await f.first.finalize(f.owner, f.id, turn.id, payload)).toEqual({
    status: "source_unavailable",
  });
  expect(await f.first.finalize(f.owner, f.id, turn.id, payload)).toEqual({ status: "conflict" });
  await f.first.stop(f.owner, f.id);
  const history = await createConversationStore(database.db).messages(f.owner, f.id, { limit: 50 });
  expect(history?.messages.at(-1)).toMatchObject({
    status: "incomplete",
    reason: "failed",
    text: "",
    citations: [],
  });
  const [row] = await database.db
    .select()
    .from(conversationTurns)
    .where(eq(conversationTurns.id, turn.id));
  expect(row?.runningText).toBeNull();
});

it("bounds accepted input and quote text before any database write", async () => {
  const f = await fixture();
  await expect(f.input("x".repeat(100_001))).rejects.toThrow();
  await expect(f.input("\ud800")).rejects.toThrow();
  const turn = await f.start([(await f.input()).id]);
  const citation = await source(f.owner);
  await expect(
    f.first.finalize(f.owner, f.id, turn.id, {
      status: "completed",
      text: "Answer",
      citations: [{ ...citation, excerpt: "x".repeat(1_001) }],
      expectedVersion: 0,
    }),
  ).rejects.toThrow();
  const messages = await database.db
    .select()
    .from(conversationMessages)
    .where(eq(conversationMessages.conversationId, f.id));
  expect(messages).toHaveLength(1);
});

it("accepts 100 grouped inputs and citations, rejects 101 before writing, and preserves the remaining queue", async () => {
  const f = await fixture();
  const inputIds: string[] = [];
  for (let index = 0; index < 101; index++) inputIds.push((await f.input(`Question ${index}`)).id);
  await expect(f.first.startAttempt(f.owner, f.id, randomUUID(), { inputIds })).rejects.toThrow();
  expect(
    await database.db
      .select()
      .from(conversationTurns)
      .where(eq(conversationTurns.conversationId, f.id)),
  ).toHaveLength(0);
  const turn = await f.start(inputIds.slice(0, 100));
  const citation = await source(f.owner);
  const citations = Array.from({ length: 100 }, () => citation);
  const payload = {
    status: "completed" as const,
    text: "Answer for the first hundred inputs",
    citations,
    expectedVersion: 0,
  };
  await expect(
    f.first.finalize(f.owner, f.id, turn.id, { ...payload, citations: [...citations, citation] }),
  ).rejects.toThrow();
  expect(
    await database.db
      .select()
      .from(conversationMessages)
      .where(eq(conversationMessages.turnId, turn.id)),
  ).toHaveLength(0);
  const completed = await f.first.finalize(f.owner, f.id, turn.id, payload);
  expect(completed).toMatchObject({ status: "saved", value: { inputIds: inputIds.slice(0, 100) } });
  if (completed.status !== "saved" || completed.value.role !== "assistant")
    throw new Error("Missing answer");
  expect(completed.value.citations).toHaveLength(100);
  const remaining = await f.start([inputIds[100]!]);
  expect(await createConversationStore(database.db).read(f.owner, f.id)).toMatchObject({
    activeTurn: { id: remaining.id, inputIds: [inputIds[100]] },
  });
});
