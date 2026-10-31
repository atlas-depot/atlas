import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { afterAll, beforeAll, expect, it } from "vite-plus/test";
import { openDatabase, readTestDatabaseUrl } from "./connection.ts";
import { createNoteStore } from "./notes.ts";
import { noteIdSchema } from "../../shared/notes.ts";

const databaseName = `atlas_test_${randomUUID().replaceAll("-", "")}`;
let admin: Pool;
let connection: ReturnType<typeof openDatabase>;
let store: ReturnType<typeof createNoteStore>;
let otherConnection: ReturnType<typeof openDatabase>;
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
  // Replay verifies the journal prevents duplicate table creation.
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
  title: "  Synthetic title  ",
  content: "# Private Markdown",
  createdAt: "2026-10-30T10:00:00.000Z",
};

it("persists drafts with generated identity and initial revision across connections", async () => {
  const created = await store.create("owner-create", draft);
  expect(created.revision).toBe(1);
  expect(created.note).toEqual({ ...draft, id: expect.any(String), updatedAt: draft.createdAt });
  expect(await otherStore.read("owner-create", created.note.id)).toEqual(created);
  expect(await store.list("owner-create")).toEqual([created.note]);
  expect(Object.keys(created.note).sort()).toEqual([
    "content",
    "createdAt",
    "id",
    "title",
    "updatedAt",
  ]);
});

it("retains edited notes after the writer exits and a new application process starts", async () => {
  const runProcess = (operation: string, noteId = "") =>
    promisify(execFile)(
      process.execPath,
      [
        "--input-type=module",
        "--eval",
        `import { openDatabase } from "./server/db/connection.ts";
         import { createNoteStore } from "./server/db/notes.ts";
         const connection = openDatabase(process.env.DATABASE_URL);
         const store = createNoteStore(connection.db);
         try { ${operation} } finally { await connection.close(); }`,
      ],
      {
        env: {
          PATH: process.env.PATH,
          DATABASE_URL: connection.db.$client.options.connectionString,
          NOTE_ID: noteId,
        },
        timeout: 15_000,
      },
    );
  const written = await runProcess(`
    const created = await store.create("owner-restart", ${JSON.stringify(draft)});
    const result = await store.update("owner-restart", created.note.id, 1,
      { title: "Persisted edit", content: "# Survives process exit" });
    if (result.status !== "saved") throw new Error("Expected saved note");
    console.log(created.note.id);
  `);
  const id = noteIdSchema.parse(written.stdout.trim());
  const read = await runProcess(
    `
    console.log(JSON.stringify(await store.read("owner-restart", process.env.NOTE_ID)));
  `,
    id,
  );
  const recovered: unknown = JSON.parse(read.stdout);
  expect(recovered).toEqual({
    note: {
      id,
      title: "Persisted edit",
      content: "# Survives process exit",
      createdAt: draft.createdAt,
      updatedAt: expect.any(String),
    },
    revision: 2,
  });
});

it("does not disclose or mutate another owner's note, even with a stale revision", async () => {
  const created = await store.create("owner-private", draft);
  await store.create("owner-other", { ...draft, content: "Other owner's marker" });
  expect(await store.list("owner-other")).toHaveLength(1);
  expect((await store.list("owner-other"))[0].content).toBe("Other owner's marker");
  expect(await store.read("owner-other", created.note.id)).toBeUndefined();
  expect(
    await store.update("owner-other", created.note.id, 99, { title: "attack", content: "attack" }),
  ).toEqual({ status: "not_found" });
  expect(await store.delete("owner-other", created.note.id, 99)).toEqual({ status: "not_found" });
  expect(await store.read("owner-private", created.note.id)).toEqual(created);
});

it("updates editable fields, preserves creation time and rejects stale update and delete", async () => {
  const created = await store.create("owner-edit", draft);
  const saved = await store.update("owner-edit", created.note.id, 1, {
    title: "Edited",
    content: "New content",
  });
  expect(saved.status).toBe("saved");
  if (saved.status !== "saved") throw new Error("Expected saved note");
  expect(saved.value.revision).toBe(2);
  expect(saved.value.note).toMatchObject({
    title: "Edited",
    content: "New content",
    createdAt: draft.createdAt,
  });
  expect(Date.parse(saved.value.note.updatedAt)).toBeGreaterThan(Date.parse(draft.createdAt));
  expect(
    await store.update("owner-edit", created.note.id, 1, { title: "stale", content: "stale" }),
  ).toEqual({ status: "conflict" });
  expect(await store.delete("owner-edit", created.note.id, 1)).toEqual({ status: "conflict" });
  expect(await store.read("owner-edit", created.note.id)).toEqual(saved.value);
  expect(await store.delete("owner-edit", created.note.id, 2)).toEqual({ status: "deleted" });
  expect(await store.read("owner-edit", created.note.id)).toBeUndefined();
  expect(await store.list("owner-edit")).toEqual([]);
  expect(await store.delete("owner-edit", created.note.id, 2)).toEqual({ status: "not_found" });
});

it("allows exactly one concurrent update from the same revision across separate pools", async () => {
  const created = await store.create("owner-race", draft);
  const results = await Promise.all([
    store.update("owner-race", created.note.id, 1, { title: "A", content: "A" }),
    otherStore.update("owner-race", created.note.id, 1, { title: "B", content: "B" }),
  ]);
  expect(results.map((result) => result.status).sort()).toEqual(["conflict", "saved"]);
  const winner = results.find((result) => result.status === "saved");
  if (!winner || winner.status !== "saved") throw new Error("Expected one winner");
  expect(await store.read("owner-race", created.note.id)).toEqual(winner.value);
  expect(winner.value.revision).toBe(2);
});

it("rejects payload ownership and immutable-field injection before writing", async () => {
  await expect(store.create("owner-validation", { ...draft, ownerId: "victim" })).rejects.toThrow();
  await expect(
    store.create("owner-validation", { ...draft, title: "x".repeat(257) }),
  ).rejects.toThrow();
  expect(await store.list("owner-validation")).toEqual([]);
  const created = await store.create("owner-validation", draft);
  await expect(
    store.update("owner-validation", created.note.id, 1, {
      title: "x",
      content: "y",
      createdAt: draft.createdAt,
    }),
  ).rejects.toThrow();
  expect(await store.read("owner-validation", created.note.id)).toEqual(created);
});

it("returns not found for nonexistent notes without turning them into conflicts", async () => {
  const id = randomUUID();
  expect(await store.read("owner-missing", id)).toBeUndefined();
  expect(
    await store.update("owner-missing", id, 1, { title: "missing", content: "missing" }),
  ).toEqual({ status: "not_found" });
  expect(await store.delete("owner-missing", id, 1)).toEqual({ status: "not_found" });
});

it("serializes a concurrent update and delete without deleting a newer revision", async () => {
  const created = await store.create("owner-delete-race", draft);
  const [updated, deleted] = await Promise.all([
    store.update("owner-delete-race", created.note.id, 1, { title: "new", content: "new" }),
    otherStore.delete("owner-delete-race", created.note.id, 1),
  ]);
  if (updated.status === "saved") {
    expect(deleted).toEqual({ status: "conflict" });
    expect(await store.read("owner-delete-race", created.note.id)).toEqual(updated.value);
  } else {
    expect(updated).toEqual({ status: "not_found" });
    expect(deleted).toEqual({ status: "deleted" });
    expect(await store.read("owner-delete-race", created.note.id)).toBeUndefined();
  }
});

it("propagates storage failure rather than reporting a successful save", async () => {
  const disconnected = openDatabase(admin.options.connectionString ?? "");
  const disconnectedStore = createNoteStore(disconnected.db);
  await disconnected.close();
  await expect(disconnectedStore.create("owner-failure", draft)).rejects.toThrow();
});

it("initializes an empty database and preserves edits and unrelated notes on setup reruns", async () => {
  const setupDatabase = `${databaseName}_setup`;
  await admin.query(`CREATE DATABASE "${setupDatabase}"`);
  const url = new URL(admin.options.connectionString ?? "");
  url.pathname = `/${setupDatabase}`;
  const fresh = openDatabase(url.toString());
  const runSetup = (action: string, extra: Record<string, string> = {}) =>
    promisify(execFile)(process.execPath, ["server/db/setup.ts", action], {
      env: {
        PATH: process.env.PATH,
        NODE_ENV: "development",
        DATABASE_URL: url.toString(),
        ...extra,
      },
      timeout: 15_000,
    });
  try {
    await expect(runSetup("seed")).rejects.toThrow();
    for (const mode of ["", "test", "staging", "production"]) {
      await expect(runSetup("init", { NODE_ENV: mode })).rejects.toThrow();
    }
    const before = await fresh.db.execute<{ table: string | null }>(
      sql`SELECT to_regclass('public.notes')::text AS "table"`,
    );
    expect(before.rows).toEqual([{ table: null }]);

    expect((await runSetup("init")).stdout).toContain("2 synthetic notes inserted.");
    const freshStore = createNoteStore(fresh.db);
    const first = await freshStore.list("synthetic-seed-alex");
    expect(first).toHaveLength(1);
    expect(first[0].title).toBe("Sample project notes");
    expect((await freshStore.list("synthetic-seed-sam"))[0].title).toBe("Sample private note");
    const edited = await freshStore.update("synthetic-seed-alex", first[0].id, 1, {
      title: "Keep this development edit",
      content: "Keep my Markdown",
    });
    expect(edited.status).toBe("saved");
    const unrelated = await freshStore.create("unrelated-owner", draft);

    expect((await runSetup("seed")).stdout).toContain("0 synthetic notes inserted.");
    expect((await runSetup("init")).stdout).toContain("0 synthetic notes inserted.");
    if (edited.status !== "saved") throw new Error("Expected saved note");
    expect(await freshStore.read("synthetic-seed-alex", first[0].id)).toEqual(edited.value);
    expect(await freshStore.read("unrelated-owner", unrelated.note.id)).toEqual(unrelated);
    const count = await fresh.db.execute<{ count: number }>(
      sql`SELECT count(*)::int AS count FROM notes`,
    );
    expect(count.rows).toEqual([{ count: 3 }]);
  } finally {
    await fresh.close();
    await admin.query(`DROP DATABASE "${setupDatabase}"`);
  }
});
