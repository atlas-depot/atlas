import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vite-plus/test";
import { setupIndexTestDatabase } from "./index-test-database.ts";
import { createConversationStore } from "./conversations.ts";
import {
  conversationCleanupIntents,
  conversationCreateRequests,
  conversationMessages,
  conversations,
  conversationTurns,
  conversationTurnInputs,
} from "./conversation-schema.ts";

const database = setupIndexTestDatabase();
async function create(owner = randomUUID()) {
  const key = randomUUID();
  const result = await createConversationStore(database.db).createIdempotent(owner, key, {});
  if (result.status !== "saved") throw new Error("Expected conversation creation.");
  return { owner, key, id: result.value.id, conversation: result.value };
}

describe("conversation CRUD against PostgreSQL", () => {
  it("concurrent retries create once, return current state, and retain content-free tombstones", async () => {
    const owner = randomUUID();
    const key = randomUUID();
    const results = await Promise.all(
      [database.db, database.other].map((db) =>
        createConversationStore(db).createIdempotent(owner, key, {}),
      ),
    );
    expect(results[0]).toEqual(results[1]);
    const result = results[0]!;
    if (result.status !== "saved") throw new Error("Creation failed.");
    const id = result.value.id;
    await database.db
      .update(conversations)
      .set({ queuePaused: true })
      .where(eq(conversations.id, id));
    expect(
      await createConversationStore(database.db).createIdempotent(owner, key.toUpperCase(), {}),
    ).toMatchObject({ status: "saved", value: { id, queuePaused: true } });
    expect(await createConversationStore(database.db).delete(owner, id)).toEqual({
      status: "deleted",
    });
    expect(await createConversationStore(database.other).createIdempotent(owner, key, {})).toEqual({
      status: "conflict",
    });
    const receipts = await database.db
      .select()
      .from(conversationCreateRequests)
      .where(eq(conversationCreateRequests.ownerId, owner));
    expect(receipts).toHaveLength(1);
    expect(Object.keys(receipts[0]!).sort()).toEqual([
      "conversationId",
      "key",
      "ownerId",
      "payloadHash",
    ]);
    expect(
      (await createConversationStore(database.db).createIdempotent(randomUUID(), key, {})).status,
    ).toBe("saved");
  });
  it("scopes every ID operation to the owner without revealing existence", async () => {
    const { owner, id } = await create();
    const other = randomUUID();
    const store = createConversationStore(database.db);
    expect(await store.read(other, id)).toBeUndefined();
    expect(await store.messages(other, id, { limit: 50 })).toBeUndefined();
    expect(await store.delete(other, id)).toEqual({ status: "not_found" });
    expect(await store.list(other, { limit: 50 })).toEqual({ conversations: [], nextCursor: null });
    expect(await store.read(owner, id)).toBeDefined();
  });
  it("paginates stable creation timestamps without duplicates or microsecond loss", async () => {
    const owner = randomUUID();
    const ids = Array.from({ length: 5 }, () => randomUUID()).sort();
    await database.db
      .insert(conversations)
      .values(ids.map((id) => ({ id, ownerId: owner, createdAt: "2026-11-10T12:00:00.123456Z" })));
    const store = createConversationStore(database.db);
    const first = await store.list(owner, { limit: 2 });
    await database.db
      .update(conversations)
      .set({ updatedAt: "2027-01-01T00:00:00Z" })
      .where(eq(conversations.id, ids[0]!));
    const second = await store.list(owner, { limit: 2, cursor: first.nextCursor! });
    const third = await store.list(owner, { limit: 2, cursor: second.nextCursor! });
    expect(
      [...first.conversations, ...second.conversations, ...third.conversations].map(
        (item) => item.id,
      ),
    ).toEqual([...ids].reverse());
    expect(third.nextCursor).toBeNull();
  });
  it("returns bounded accepted message order and reconnect checkpoint without runtime metadata", async () => {
    const { owner, id } = await create();
    const turnId = randomUUID();
    const messages = Array.from({ length: 3 }, (_, index) => ({
      id: randomUUID(),
      conversationId: id,
      operationId: randomUUID(),
      payloadHash: "hash",
      sequence: index + 1,
      role: "user" as const,
      deliveryPolicy: "queue" as const,
      text: `input ${index}`,
    }));
    await database.db.insert(conversationMessages).values(messages);
    await database.db.insert(conversationTurns).values({
      id: turnId,
      conversationId: id,
      operationId: randomUUID(),
      payloadHash: "hash",
      status: "running",
      runningText: "partial",
      checkpointVersion: 7,
      allocationOperationId: randomUUID(),
      runtimeUrl: "https://private.runtime",
      sessionId: "private-session",
    });
    await database.db
      .insert(conversationTurnInputs)
      .values({ conversationId: id, turnId, messageId: messages[0]!.id, ordinal: 0 });
    const store = createConversationStore(database.db);
    const first = await store.messages(owner, id, { limit: 2 });
    expect(first?.messages.map((message) => message.text)).toEqual(["input 0", "input 1"]);
    expect(first?.nextCursor).toBe("2");
    expect((await store.messages(owner, id, { limit: 2, cursor: "2" }))?.nextCursor).toBeNull();
    const read = await store.read(owner, id);
    expect(read?.activeTurn).toEqual({
      id: turnId,
      status: "running",
      text: "partial",
      checkpointVersion: 7,
      inputIds: [messages[0]!.id],
    });
    expect(JSON.stringify(read)).not.toContain("private");
    await store.delete(owner, id);
    expect(
      await database.db
        .select()
        .from(conversationMessages)
        .where(eq(conversationMessages.conversationId, id)),
    ).toEqual([]);
    expect(
      await database.db
        .select()
        .from(conversationTurns)
        .where(eq(conversationTurns.conversationId, id)),
    ).toEqual([]);
    expect(
      await database.db
        .select()
        .from(conversationCleanupIntents)
        .where(eq(conversationCleanupIntents.conversationId, id)),
    ).toHaveLength(1);
  });
  it("rolls deletion back when durable cleanup intent creation fails", async () => {
    const { owner, id } = await create();
    await database.db.insert(conversationTurns).values({
      conversationId: id,
      operationId: randomUUID(),
      payloadHash: "hash",
      allocationOperationId: randomUUID(),
      runtimeUrl: "https://private.runtime",
    });
    await database.db.execute(
      sql`CREATE FUNCTION reject_cleanup() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected cleanup failure'; END $$`,
    );
    await database.db.execute(
      sql`CREATE TRIGGER reject_cleanup BEFORE INSERT ON conversation_cleanup_intents FOR EACH ROW EXECUTE FUNCTION reject_cleanup()`,
    );
    try {
      await expect(createConversationStore(database.db).delete(owner, id)).rejects.toThrow();
      expect(await createConversationStore(database.db).read(owner, id)).toBeDefined();
      expect(
        await database.db
          .select()
          .from(conversationTurns)
          .where(
            and(
              eq(conversationTurns.conversationId, id),
              eq(conversationTurns.runtimeUrl, "https://private.runtime"),
            ),
          ),
      ).toHaveLength(1);
    } finally {
      await database.db.execute(sql`DROP TRIGGER reject_cleanup ON conversation_cleanup_intents`);
      await database.db.execute(sql`DROP FUNCTION reject_cleanup()`);
    }
  });
});
