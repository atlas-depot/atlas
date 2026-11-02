import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { and, eq, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { afterAll, beforeAll, expect, it } from "vite-plus/test";
import { openDatabase, readTestDatabaseUrl } from "./connection.ts";
import { createNoteStore } from "./notes.ts";
import { noteCreateRequests } from "./schema.ts";

const databaseName = `atlas_idempotency_${randomUUID().replaceAll("-", "")}`;
let admin: Pool;
let connection: ReturnType<typeof openDatabase>;
let otherConnection: ReturnType<typeof openDatabase>;
let store: ReturnType<typeof createNoteStore>;
let otherStore: ReturnType<typeof createNoteStore>;

beforeAll(async () => {
  const url = new URL(readTestDatabaseUrl(process.env));
  admin = new Pool({ connectionString: url.toString(), connectionTimeoutMillis: 10_000 });
  await admin.query(`CREATE DATABASE "${databaseName}"`);
  url.pathname = `/${databaseName}`;
  connection = openDatabase(url.toString());
  await migrate(connection.db, {
    migrationsFolder: fileURLToPath(new URL("../../drizzle/", import.meta.url)),
  });
  store = createNoteStore(connection.db);
  otherConnection = openDatabase(url.toString());
  otherStore = createNoteStore(otherConnection.db);
});

afterAll(async () => {
  await connection?.close();
  await otherConnection?.close();
  if (admin) {
    try {
      await admin.query(`DROP DATABASE IF EXISTS "${databaseName}"`);
    } finally {
      await admin.end();
    }
  }
});

const draft = {
  title: "  Synthetic creation  ",
  content: "# Keep the submitted snapshot",
  createdAt: "2026-10-30T10:00:00.000Z",
};

it("replays a lost response across connections without changing identity, timestamps or revision", async () => {
  const key = randomUUID();
  const first = await store.createIdempotent("owner-replay", key, draft);
  expect(first.status).toBe("saved");
  if (first.status !== "saved") throw new Error("Expected saved note");
  expect(first.value).toEqual({
    note: { ...draft, id: expect.any(String), updatedAt: draft.createdAt },
    revision: 1,
  });
  const replay = await otherStore.createIdempotent("owner-replay", key.toUpperCase(), {
    content: draft.content,
    createdAt: draft.createdAt,
    title: draft.title,
  });
  expect(replay).toEqual(first);
  expect(await store.list("owner-replay")).toEqual([first.value.note]);
  const [receipt] = await connection.db
    .select()
    .from(noteCreateRequests)
    .where(eq(noteCreateRequests.ownerId, "owner-replay"));
  expect(receipt).toEqual({
    ownerId: "owner-replay",
    key,
    noteId: first.value.note.id,
    payloadHash: expect.stringMatching(/^[0-9a-f]{64}$/),
  });
});

it("coalesces simultaneous matching creates across separate connection pools", async () => {
  const key = randomUUID();
  const results = await Promise.all(
    Array.from({ length: 12 }, (_, index) =>
      (index % 2 ? store : otherStore).createIdempotent("owner-concurrent", key, draft),
    ),
  );
  expect(results.every((result) => result.status === "saved")).toBe(true);
  for (const result of results) expect(result).toEqual(results[0]);
  expect(await store.list("owner-concurrent")).toHaveLength(1);
});

it("lets only one of two concurrent payloads claim a creation key", async () => {
  const key = randomUUID();
  const changed = { ...draft, content: "A distinct submitted snapshot" };
  const results = await Promise.all([
    store.createIdempotent("owner-competing", key, draft),
    otherStore.createIdempotent("owner-competing", key, changed),
  ]);
  expect(results.map((result) => result.status).sort()).toEqual(["conflict", "saved"]);
  const winner = results.find((result) => result.status === "saved");
  if (!winner || winner.status !== "saved") throw new Error("Expected one winner");
  expect(await store.list("owner-competing")).toEqual([winner.value.note]);
});

it("rejects changes to each field without modifying the original creation", async () => {
  const key = randomUUID();
  const first = await store.createIdempotent("owner-mismatch", key, draft);
  for (const change of [
    { title: "Different title" },
    { content: "Different content" },
    { createdAt: "2026-10-31T10:00:00.000Z" },
  ]) {
    expect(
      await otherStore.createIdempotent("owner-mismatch", key, { ...draft, ...change }),
    ).toEqual({
      status: "conflict",
    });
  }
  expect(await store.createIdempotent("owner-mismatch", key, draft)).toEqual(first);
  expect(await store.list("owner-mismatch")).toHaveLength(1);
});

it("scopes keys to verified owners and does not return another account's note", async () => {
  const key = randomUUID();
  const [first, second] = await Promise.all([
    store.createIdempotent("owner-a", key, draft),
    otherStore.createIdempotent("owner-b", key, { ...draft, content: "Account B" }),
  ]);
  if (first.status !== "saved" || second.status !== "saved")
    throw new Error("Expected saved notes");
  expect(first.value.note.id).not.toBe(second.value.note.id);
  expect(await store.list("owner-a")).toEqual([first.value.note]);
  expect(await store.list("owner-b")).toEqual([second.value.note]);
  expect(await store.read("owner-a", second.value.note.id)).toBeUndefined();
});

it("does not recreate or replay content after the original note is edited or deleted", async () => {
  const key = randomUUID();
  const first = await store.createIdempotent("owner-changed", key, draft);
  if (first.status !== "saved") throw new Error("Expected saved note");
  // Even an edit retaining the same text changes the original creation revision.
  expect(
    await store.update("owner-changed", first.value.note.id, 1, {
      title: draft.title,
      content: draft.content,
    }),
  ).toMatchObject({ status: "saved", value: { revision: 2 } });
  expect(await otherStore.createIdempotent("owner-changed", key, draft)).toEqual({
    status: "conflict",
  });
  expect(await store.delete("owner-changed", first.value.note.id, 2)).toEqual({
    status: "deleted",
  });
  expect(await otherStore.createIdempotent("owner-changed", key, draft)).toEqual({
    status: "conflict",
  });
  expect(await store.list("owner-changed")).toEqual([]);
  expect(
    await connection.db
      .select()
      .from(noteCreateRequests)
      .where(and(eq(noteCreateRequests.ownerId, "owner-changed"), eq(noteCreateRequests.key, key))),
  ).toHaveLength(1);
});

it("rolls back the claimed key when insertion fails, allowing the unchanged request to retry", async () => {
  const key = randomUUID();
  await connection.db.execute(sql`ALTER TABLE notes ADD CONSTRAINT test_reject_creation
    CHECK (owner_id <> 'owner-rollback')`);
  try {
    await expect(store.createIdempotent("owner-rollback", key, draft)).rejects.toThrow();
    expect(await store.list("owner-rollback")).toEqual([]);
    expect(
      await connection.db
        .select()
        .from(noteCreateRequests)
        .where(eq(noteCreateRequests.ownerId, "owner-rollback")),
    ).toEqual([]);
  } finally {
    await connection.db.execute(sql`ALTER TABLE notes DROP CONSTRAINT test_reject_creation`);
  }
  expect(await otherStore.createIdempotent("owner-rollback", key, draft)).toMatchObject({
    status: "saved",
  });
  expect(await store.list("owner-rollback")).toHaveLength(1);
});

it("validates owner, key and strict payload before reserving a creation", async () => {
  const key = randomUUID();
  await expect(store.createIdempotent("", key, draft)).rejects.toThrow();
  await expect(store.createIdempotent("owner-invalid", "bad-key", draft)).rejects.toThrow();
  await expect(
    store.createIdempotent("owner-invalid", key, { ...draft, ownerId: "injected" }),
  ).rejects.toThrow();
  expect(await store.list("owner-invalid")).toEqual([]);
  expect(
    await connection.db
      .select()
      .from(noteCreateRequests)
      .where(eq(noteCreateRequests.ownerId, "owner-invalid")),
  ).toEqual([]);
});
