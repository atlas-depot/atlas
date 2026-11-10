import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { expect, it, vi } from "vite-plus/test";
import type { NotePassageSource } from "../../shared/passages.ts";
import { setupIndexTestDatabase } from "./index-test-database.ts";
import { createConversationStore } from "./conversations.ts";
import { createConversationTurns } from "./conversation-turns.ts";
import { conversationMessages, conversationTurns, conversations } from "./conversation-schema.ts";
import { createNoteStore, noteTag } from "./notes.ts";
import { notes } from "./schema.ts";

const database = setupIndexTestDatabase();
function latch() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function waiting(count: number) {
  await vi.waitFor(
    async () => {
      const result = await database.db.execute<{ count: number }>(
        sql`select count(*)::int as count from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock'`,
      );
      expect(result.rows[0]?.count).toBeGreaterThanOrEqual(count);
    },
    { timeout: 5_000, interval: 10 },
  );
}
async function fixture() {
  const owner = randomUUID();
  const [parent] = await database.db.insert(conversations).values({ ownerId: owner }).returning();
  const store = createConversationTurns(database.other);
  const input = await store.acceptInput(owner, parent!.id, randomUUID(), {
    text: "Synthetic question",
  });
  if (input.status !== "saved") throw new Error("Missing input");
  const attempt = await store.startAttempt(owner, parent!.id, randomUUID(), {
    inputIds: [input.value.id],
  });
  if (attempt.status !== "saved") throw new Error("Missing attempt");
  const note = await createNoteStore(database.db).create(owner, {
    title: "Synthetic",
    content: "Synthetic excerpt",
    createdAt: new Date().toISOString(),
  });
  const source: NotePassageSource = {
    kind: "markdown",
    noteId: note.note.id,
    version: noteTag(note.note.id, 1),
    headingPath: [],
    startOffset: 0,
    endOffset: 17,
  };
  const payload = {
    status: "completed" as const,
    text: "Synthetic answer",
    expectedVersion: 0,
    citations: [{ source, excerpt: "Synthetic excerpt", deleted: false }],
  };
  return { owner, id: parent!.id, turnId: attempt.value.id, noteId: note.note.id, store, payload };
}

it("deletion winning the source row lock suppresses pending publication", async () => {
  const f = await fixture();
  const locked = latch();
  const release = latch();
  const holder = database.db.transaction(async (tx) => {
    await tx.select().from(notes).where(eq(notes.id, f.noteId)).for("update");
    locked.resolve();
    await release.promise;
  });
  await locked.promise;
  const deletion = createNoteStore(database.other).delete(f.owner, f.noteId, 1);
  let publication: ReturnType<typeof f.store.finalize> | undefined;
  try {
    await waiting(1);
    publication = f.store.finalize(f.owner, f.id, f.turnId, f.payload);
    await waiting(2);
  } finally {
    release.resolve();
  }
  await holder;
  expect(await deletion).toEqual({ status: "deleted" });
  expect(await publication).toEqual({ status: "source_unavailable" });
  const history = await createConversationStore(database.db).messages(f.owner, f.id, { limit: 50 });
  expect(history?.messages.at(-1)).toMatchObject({
    text: "",
    status: "incomplete",
    reason: "failed",
    citations: [],
  });
});

it("publication winning source locks is subsequently redacted by deletion", async () => {
  const f = await fixture();
  const locked = latch();
  const release = latch();
  const holder = database.db.transaction(async (tx) => {
    await tx.select().from(conversations).where(eq(conversations.id, f.id)).for("update");
    locked.resolve();
    await release.promise;
  });
  await locked.promise;
  const publication = f.store.finalize(f.owner, f.id, f.turnId, f.payload);
  let deletion: ReturnType<ReturnType<typeof createNoteStore>["delete"]> | undefined;
  try {
    await waiting(1); // Publication holds the note and waits on the conversation.
    deletion = createNoteStore(database.other).delete(f.owner, f.noteId, 1);
    await waiting(2);
  } finally {
    release.resolve();
  }
  await holder;
  expect(await publication).toMatchObject({ status: "saved" });
  expect(await deletion).toEqual({ status: "deleted" });
  expect(await f.store.finalize(f.owner, f.id, f.turnId, f.payload)).toMatchObject({
    status: "saved",
    value: { text: "Synthetic answer", citations: [{ excerpt: null, deleted: true }] },
  });
});

it.each(["delete-first", "write-first"] as const)(
  "conversation deletion fences checkpoints (%s)",
  async (order) => {
    const f = await fixture();
    const locked = latch();
    const release = latch();
    const holder = database.db.transaction(async (tx) => {
      await tx.select().from(conversations).where(eq(conversations.id, f.id)).for("update");
      locked.resolve();
      await release.promise;
    });
    await locked.promise;
    const remove = () => createConversationStore(database.other).delete(f.owner, f.id);
    const write = () => f.store.checkpoint(f.owner, f.id, f.turnId, 0, "Partial");
    const first = order === "delete-first" ? remove() : write();
    let second: ReturnType<typeof remove> | ReturnType<typeof write> | undefined;
    try {
      await waiting(1);
      second = order === "delete-first" ? write() : remove();
      await waiting(2);
    } finally {
      release.resolve();
    }
    await holder;
    const results = await Promise.all([first, second]);
    expect(results).toMatchObject(
      order === "delete-first"
        ? [{ status: "deleted" }, { status: "not_found" }]
        : [{ status: "saved" }, { status: "deleted" }],
    );
    expect(await f.store.checkpoint(f.owner, f.id, f.turnId, 1, "Late private text")).toEqual({
      status: "not_found",
    });
    expect(
      await database.db
        .select()
        .from(conversationMessages)
        .where(eq(conversationMessages.conversationId, f.id)),
    ).toHaveLength(0);
  },
);

it("a late transaction failure rolls back the answer, terminal transition and sequence allocation", async () => {
  const f = await fixture();
  await database.db
    .update(conversations)
    .set({ nextSequence: 2_147_483_647 })
    .where(eq(conversations.id, f.id));
  await expect(f.store.finalize(f.owner, f.id, f.turnId, f.payload)).rejects.toMatchObject({
    cause: { code: "22003" },
  });
  const [parent] = await database.db.select().from(conversations).where(eq(conversations.id, f.id));
  const [turn] = await database.db
    .select()
    .from(conversationTurns)
    .where(eq(conversationTurns.id, f.turnId));
  expect(parent?.nextSequence).toBe(2_147_483_647);
  expect(turn).toMatchObject({ status: "running", runningText: "" });
  expect(
    await database.db
      .select()
      .from(conversationMessages)
      .where(
        and(
          eq(conversationMessages.conversationId, f.id),
          eq(conversationMessages.role, "assistant"),
        ),
      ),
  ).toHaveLength(0);
});
