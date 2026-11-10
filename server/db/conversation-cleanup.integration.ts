import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { expect, it } from "vite-plus/test";
import { setupIndexTestDatabase } from "./index-test-database.ts";
import {
  createConversationCleanupStore,
  enqueueConversationCleanup,
  enqueueTurnCleanup,
} from "./conversation-cleanup.ts";
import { createConversationStore } from "./conversations.ts";
import { createConversationTurns } from "./conversation-turns.ts";
import {
  conversationCleanupIntents,
  conversationTurns,
  conversations,
} from "./conversation-schema.ts";

const database = setupIndexTestDatabase();
const runtimeUrl = "https://synthetic-runtime.example/";

function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function fixture() {
  const owner = randomUUID();
  const store = createConversationStore(database.db);
  const parent = await store.createIdempotent(owner, randomUUID(), {});
  if (parent.status !== "saved") throw new Error("Missing conversation");
  const id = parent.value.id;
  const turns = createConversationTurns(database.db);
  const input = await turns.acceptInput(owner, id, randomUUID(), { text: "Synthetic question" });
  if (input.status !== "saved") throw new Error("Missing input");
  const attempt = await turns.startAttempt(owner, id, randomUUID(), { inputIds: [input.value.id] });
  if (attempt.status !== "saved") throw new Error("Missing attempt");
  const cleanup = createConversationCleanupStore(database.db);
  const other = createConversationCleanupStore(database.other);
  const allocationOperationId = randomUUID();
  const prepare = () =>
    cleanup.prepareRuntime(owner, id, attempt.value.id, { allocationOperationId, runtimeUrl });
  const bind = (session = "synthetic-session") =>
    other.bindRuntime(owner, id, attempt.value.id, allocationOperationId, session);
  const intent = async () =>
    (
      await database.db
        .select()
        .from(conversationCleanupIntents)
        .where(eq(conversationCleanupIntents.allocationOperationId, allocationOperationId))
    )[0];
  const turn = async () =>
    (
      await database.db
        .select()
        .from(conversationTurns)
        .where(eq(conversationTurns.id, attempt.value.id))
    )[0];
  return {
    owner,
    id,
    store,
    turns,
    attempt: attempt.value,
    cleanup,
    other,
    allocationOperationId,
    prepare,
    bind,
    intent,
    turn,
  };
}

it("commits allocation identity before a response, preserves matching replay and refuses replacement", async () => {
  const f = await fixture();
  expect(await f.bind()).toEqual({ status: "not_found" });
  expect(await f.prepare()).toEqual({ status: "prepared" });
  expect(await f.turn()).toMatchObject({
    allocationOperationId: f.allocationOperationId,
    runtimeUrl,
    sessionId: null,
  });
  expect(
    await f.other.prepareRuntime(f.owner, f.id.toUpperCase(), f.attempt.id.toUpperCase(), {
      allocationOperationId: f.allocationOperationId.toUpperCase(),
      runtimeUrl,
    }),
  ).toEqual({ status: "prepared" });
  expect(
    await f.other.prepareRuntime(f.owner, f.id, f.attempt.id, {
      allocationOperationId: randomUUID(),
      runtimeUrl,
    }),
  ).toEqual({ status: "conflict" });
  expect(
    await f.other.prepareRuntime(f.owner, f.id, f.attempt.id, {
      allocationOperationId: f.allocationOperationId,
      runtimeUrl: "https://other-runtime.example/",
    }),
  ).toEqual({ status: "conflict" });
  expect(await f.bind()).toEqual({ status: "bound" });
  expect(await f.bind()).toEqual({ status: "bound" });
  expect(await f.bind("different-session")).toEqual({ status: "conflict" });
});

it("retains an unknown allocation after deletion and accepts only its matching late response", async () => {
  const f = await fixture();
  await f.prepare();
  expect(await f.store.delete(f.owner, f.id)).toEqual({ status: "deleted" });
  expect(await f.turn()).toBeUndefined();
  expect(await f.intent()).toMatchObject({
    ownerId: f.owner,
    conversationId: f.id,
    runtimeUrl,
    sessionId: null,
    lastFailureCode: "allocation_unknown",
  });
  expect(
    await f.other.bindRuntime(
      randomUUID(),
      f.id,
      f.attempt.id,
      f.allocationOperationId,
      "synthetic-session",
    ),
  ).toEqual({ status: "not_found" });
  expect(
    await f.other.bindRuntime(f.owner, f.id, f.attempt.id, randomUUID(), "synthetic-session"),
  ).toEqual({ status: "not_found" });
  expect(
    await f.other.bindRuntime(
      f.owner,
      randomUUID(),
      f.attempt.id,
      f.allocationOperationId,
      "synthetic-session",
    ),
  ).toEqual({ status: "not_found" });
  expect(await f.bind()).toEqual({ status: "cleanup_pending" });
  expect(await f.bind("different-session")).toEqual({ status: "conflict" });
  expect(await f.intent()).toMatchObject({ sessionId: "synthetic-session", lastFailureCode: null });
  expect(await f.store.read(f.owner, f.id)).toBeUndefined();
});

it("keeps unknown or failed cleanup until the exact known session is confirmed retired", async () => {
  const f = await fixture();
  await f.prepare();
  await f.store.delete(f.owner, f.id);
  expect(await f.cleanup.confirmRetired(f.allocationOperationId, "guessed-session")).toBe(false);
  await f.cleanup.recordFailure(
    f.allocationOperationId,
    "allocation_unknown",
    "2000-01-01T00:00:00Z",
  );
  expect(await f.intent()).toMatchObject({
    sessionId: null,
    attempts: 1,
    lastFailureCode: "allocation_unknown",
  });
  expect(
    (await f.cleanup.pending()).some(
      (intent) => intent.allocationOperationId === f.allocationOperationId,
    ),
  ).toBe(true);
  await f.bind();
  await f.cleanup.recordFailure(f.allocationOperationId, "cleanup_failed", "2000-01-01T00:00:00Z");
  expect(await f.intent()).toMatchObject({ attempts: 2, lastFailureCode: "cleanup_failed" });
  expect(await f.cleanup.confirmRetired(f.allocationOperationId, "different-session")).toBe(false);
  expect(await f.cleanup.confirmRetired(f.allocationOperationId, "synthetic-session")).toBe(true);
  expect(await f.intent()).toBeUndefined();
});

it.each(["stop", "complete"] as const)(
  "sends a late response to cleanup after %s without restarting the turn",
  async (action) => {
    const f = await fixture();
    await f.prepare();
    if (action === "stop") await f.turns.stop(f.owner, f.id);
    else
      await f.turns.finalize(f.owner, f.id, f.attempt.id, {
        status: "no-support",
        text: "No support",
        citations: [],
        expectedVersion: 0,
      });
    expect(await f.bind()).toEqual({ status: "cleanup_pending" });
    expect(await f.intent()).toMatchObject({ sessionId: "synthetic-session" });
    expect(await f.turn()).toMatchObject({
      status: action === "stop" ? "incomplete" : "no-support",
    });
    expect(await f.prepare()).toEqual({ status: "conflict" });
  },
);

it("rejects allocation reuse both while an earlier turn is live and after it is deleted", async () => {
  const old = await fixture();
  const next = await fixture();
  await old.prepare();
  const reuse = () =>
    next.cleanup.prepareRuntime(next.owner, next.id, next.attempt.id, {
      allocationOperationId: old.allocationOperationId,
      runtimeUrl,
    });
  expect(await reuse()).toEqual({ status: "conflict" });
  await old.store.delete(old.owner, old.id);
  expect(await reuse()).toEqual({ status: "conflict" });
  expect(await next.turn()).toMatchObject({ allocationOperationId: null, runtimeUrl: null });
});

it("rolls back reuse that waited for concurrent deletion of the old allocation", async () => {
  const old = await fixture();
  const next = await fixture();
  await old.prepare();
  const deleted = gate();
  const release = gate();
  const removal = database.db.transaction(async (tx) => {
    await tx
      .select()
      .from(conversations)
      .where(and(eq(conversations.id, old.id), eq(conversations.ownerId, old.owner)))
      .for("update");
    await enqueueConversationCleanup(tx, old.owner, old.id);
    await tx.delete(conversations).where(eq(conversations.id, old.id));
    deleted.resolve();
    await release.promise;
  });
  let reuse: ReturnType<typeof next.other.prepareRuntime> | undefined;
  try {
    await deleted.promise;
    reuse = next.other.prepareRuntime(next.owner, next.id, next.attempt.id, {
      allocationOperationId: old.allocationOperationId,
      runtimeUrl,
    });
    await expect
      .poll(async () => {
        const result = await database.db.execute<{ waiting: boolean }>(sql`SELECT EXISTS (
        SELECT 1 FROM pg_stat_activity WHERE datname = current_database()
        AND wait_event_type = 'Lock' AND query LIKE 'update "conversation_turns"%'
      ) AS waiting`);
        return result.rows[0]?.waiting;
      })
      .toBe(true);
  } finally {
    release.resolve();
    await removal;
  }
  expect(await reuse).toEqual({ status: "conflict" });
  expect(await next.turn()).toMatchObject({ allocationOperationId: null, runtimeUrl: null });
  expect(await old.intent()).toMatchObject({ sessionId: null });
});

it("does not silently drop a malformed runtime cleanup identity", async () => {
  const f = await fixture();
  for (const runtime of [
    { allocationOperationId: f.allocationOperationId, runtimeUrl: null, sessionId: null },
    { allocationOperationId: null, runtimeUrl, sessionId: null },
    { allocationOperationId: null, runtimeUrl: null, sessionId: "orphan-session" },
  ]) {
    await expect(
      database.db.transaction((tx) =>
        enqueueTurnCleanup(tx, f.owner, { conversationId: f.id, ...runtime }),
      ),
    ).rejects.toThrow("runtime identity is incomplete");
  }
  await database.db.transaction((tx) =>
    enqueueTurnCleanup(tx, f.owner, {
      conversationId: f.id,
      allocationOperationId: null,
      runtimeUrl: null,
      sessionId: null,
    }),
  );
  expect(await f.intent()).toBeUndefined();
});
