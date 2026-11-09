import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { sql } from "drizzle-orm";
import { Pool } from "pg";
import { afterAll, beforeAll, expect, it } from "vite-plus/test";
import { blockNoteDocumentSchema, canonicalNoteContent } from "../../shared/document.ts";
import { noteSchema } from "../../shared/notes.ts";
import { createApp } from "../app.ts";
import { openDatabase, readTestDatabaseUrl } from "./connection.ts";
import { createNoteStore } from "./notes.ts";
import { createOrganizeRunStore } from "./organize-runs.ts";

const databaseName = `atlas_documents_${randomUUID().replaceAll("-", "")}`;
const legacyId = randomUUID();
const legacyKey = randomUUID();
const legacy = {
  title: "Legacy note",
  content: '  # Exact source\r\n\n{"keep":true} *markup* 😀\n',
  createdAt: "2026-11-01T10:00:00.000Z",
};
let admin: Pool;
let connection: ReturnType<typeof openDatabase>;
let reopened: ReturnType<typeof openDatabase>;
let store: ReturnType<typeof createNoteStore>;

beforeAll(async () => {
  const url = new URL(readTestDatabaseUrl(process.env));
  admin = new Pool({ connectionString: url.href, connectionTimeoutMillis: 10_000 });
  await admin.query(`CREATE DATABASE "${databaseName}"`);
  url.pathname = `/${databaseName}`;
  connection = openDatabase(url.href);
  // Replay the previous schema before inserting a real pre-migration note and receipt.
  for (const name of [
    "0000_create-notes",
    "0001_organize-runs",
    "0002_organize-usage",
    "0003_note-create-idempotency",
  ]) {
    await connection.db.execute(
      sql.raw(await readFile(new URL(`../../drizzle/${name}.sql`, import.meta.url), "utf8")),
    );
  }
  await connection.db.execute(
    sql`INSERT INTO notes (id, owner_id, title, content, created_at, updated_at) VALUES (${legacyId}, 'legacy-owner', ${legacy.title}, ${legacy.content}, ${legacy.createdAt}, ${legacy.createdAt})`,
  );
  const oldHash = createHash("sha256")
    .update(JSON.stringify([legacy.title, legacy.content, legacy.createdAt]))
    .digest("hex");
  await connection.db.execute(
    sql`INSERT INTO note_create_requests (owner_id, key, payload_hash, note_id) VALUES ('legacy-owner', ${legacyKey}, ${oldHash}, ${legacyId})`,
  );
  await connection.db.execute(
    sql.raw(
      await readFile(new URL("../../drizzle/0004_note-documents.sql", import.meta.url), "utf8"),
    ),
  );
  await connection.db.execute(
    sql.raw(
      await readFile(new URL("../../drizzle/0005_ai-note-drafts.sql", import.meta.url), "utf8"),
    ),
  );
  store = createNoteStore(connection.db);
  reopened = openDatabase(url.href);
});

afterAll(async () => {
  await reopened?.close();
  await connection?.close();
  if (admin) {
    try {
      await admin.query(`DROP DATABASE IF EXISTS "${databaseName}"`);
    } finally {
      await admin.end();
    }
  }
});

function document() {
  return blockNoteDocumentSchema.parse({
    format: "blocknote",
    schemaVersion: 1,
    blocks: [
      {
        id: "parent",
        type: "paragraph",
        props: {},
        content: [
          { type: "text", text: "A structured note 😀", styles: { bold: true, italic: true } },
        ],
        children: [
          {
            id: "child",
            type: "checkListItem",
            props: { checked: false },
            content: [{ type: "text", text: "Keep the IDs", styles: {} }],
            children: [],
          },
        ],
      },
      {
        id: "table",
        type: "table",
        props: {},
        content: {
          type: "tableContent",
          columnWidths: [null],
          rows: [{ cells: [[{ type: "text", text: "Cell", styles: {} }]] }],
        },
        children: [],
      },
    ],
  });
}

it("preserves pre-migration Markdown and accepts its existing creation receipt", async () => {
  const replay = await store.createIdempotent("legacy-owner", legacyKey, legacy);
  expect(replay).toEqual({
    status: "saved",
    value: { revision: 1, note: { ...legacy, id: legacyId, updatedAt: legacy.createdAt } },
  });
  const result = await connection.db.execute(
    sql`SELECT jsonb_typeof(content) AS kind FROM notes WHERE id = ${legacyId}`,
  );
  expect(result.rows).toEqual([{ kind: "string" }]);
});

it("persists JSON, IDs and tables across pools while retaining ownership and revision checks", async () => {
  const content = document();
  const first = await store.create("json-owner", { ...legacy, content });
  const otherStore = createNoteStore(reopened.db);
  expect(await otherStore.read("json-owner", first.note.id)).toEqual(first);
  expect(first.note.content).toEqual(content);
  expect(await otherStore.read("stranger", first.note.id)).toBeUndefined();
  expect(await otherStore.update("stranger", first.note.id, 1, { title: "No", content })).toEqual({
    status: "not_found",
  });
  const edited = { ...content, blocks: [...content.blocks].reverse() };
  expect(
    (await store.update("json-owner", first.note.id, 1, { title: "Edited", content: edited }))
      .status,
  ).toBe("saved");
  expect(
    await otherStore.update("json-owner", first.note.id, 1, { title: "Stale", content }),
  ).toEqual({ status: "conflict" });
  const current = await otherStore.read("json-owner", first.note.id);
  expect(current?.note.content).toEqual(edited);
  expect(current?.revision).toBe(2);
});

it("replays reordered JSON keys but never confuses JSON with a legacy string", async () => {
  const content = document();
  const key = randomUUID();
  const first = await store.createIdempotent("json-replay", key, { ...legacy, content });
  const reordered = {
    blocks: content.blocks,
    schemaVersion: 1 as const,
    format: "blocknote" as const,
  };
  expect(
    await createNoteStore(reopened.db).createIdempotent("json-replay", key, {
      ...legacy,
      content: reordered,
    }),
  ).toEqual(first);
  expect(
    await store.createIdempotent("json-replay", key, {
      ...legacy,
      content: canonicalNoteContent(content),
    }),
  ).toEqual({ status: "conflict" });
  expect(await store.list("json-replay")).toHaveLength(1);
});

it("projects a JSON source for the organizer without replacing or truncating the stored document", async () => {
  const content = document();
  const note = await store.create("organizer-json", { ...legacy, content });
  const run = await createOrganizeRunStore(connection.db).claim(
    "organizer-json",
    note.note.id,
    "https://organizer.example",
  );
  expect(run?.sourceRevision).toBe(1);
  expect(run?.input?.content).toBe(`BlockNote JSON document:\n${canonicalNoteContent(content)}`);
  expect((await store.read("organizer-json", note.note.id))?.note.content).toEqual(content);
});

it("validates document writes at the actual HTTP and PostgreSQL boundary", async () => {
  // Identity is synthetic. Hono handlers, payload parsing and PostgreSQL storage are real.
  const app = createApp(async () => ({ userId: "json-http" }), { notes: store });
  const write = (content: unknown) =>
    app.request("/api/notes", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": randomUUID() },
      body: JSON.stringify({ ...legacy, content }),
    });
  const invalid = document();
  invalid.blocks.push(invalid.blocks[0]);
  expect((await write(invalid)).status).toBe(400);
  expect(await store.list("json-http")).toEqual([]);
  const response = await write(document());
  expect(response.status).toBe(201);
  const saved = noteSchema.parse(await response.json());
  const read = await app.request(`/api/notes/${saved.id}`);
  expect(read.status).toBe(200);
  expect(read.headers.get("ETag")).toBe(response.headers.get("ETag"));
  expect(noteSchema.parse(await read.json())).toEqual(saved);
});
