import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { Pool } from "pg";
import { afterAll, beforeAll, expect, it } from "vite-plus/test";
import { EMBEDDING_DIMENSIONS, EMBEDDING_FINGERPRINT } from "../../shared/embedding.ts";
import { projectNotePassages } from "../passages.ts";
import { openDatabase, readTestDatabaseUrl } from "./connection.ts";
import { applyMigrations } from "./migrations.ts";
import { createNoteIndexJobs } from "./note-index-jobs.ts";
import { createNoteIndexStore } from "./note-index.ts";
import { createNoteStore } from "./notes.ts";
import { noteIndexes, noteIndexIntents, notePassages } from "./schema.ts";

// Real PostgreSQL + pgvector. Embeddings are synthetic, not provider/model-quality evidence.
const databaseName = `atlas_vectors_${randomUUID().replaceAll("-", "")}`;
let admin: Pool;
let connection: ReturnType<typeof openDatabase>;
let other: ReturnType<typeof openDatabase>;

beforeAll(async () => {
  const url = new URL(readTestDatabaseUrl(process.env));
  admin = new Pool({ connectionString: url.href });
  await admin.query(`CREATE DATABASE "${databaseName}"`);
  url.pathname = `/${databaseName}`;
  connection = openDatabase(url.href);
  other = openDatabase(url.href);
  await applyMigrations(connection.db);
});

afterAll(async () => {
  await connection?.close();
  await other?.close();
  if (admin) {
    try {
      await admin.query(`DROP DATABASE IF EXISTS "${databaseName}"`);
    } finally {
      await admin.end();
    }
  }
});

const vector = () =>
  Array.from({ length: EMBEDDING_DIMENSIONS }, (_, index) => (index === 0 ? 1 : 0));
async function fixture(content = "First fact.\n\nSecond fact.") {
  const owner = randomUUID();
  const note = await createNoteStore(connection.db).create(owner, {
    title: "Synthetic source",
    content,
    createdAt: "2026-11-09T10:00:00.000Z",
  });
  const projection = projectNotePassages({
    noteId: note.note.id,
    version: JSON.stringify(`${note.note.id}:${note.revision}`),
    content,
  });
  const claim = await createNoteIndexJobs(connection.db).claim(note.note.id, "https://index.test");
  if (!claim) throw new Error("Fixture claim failed");
  const runId = randomUUID();
  await createNoteIndexJobs(connection.db).bind(claim, runId);
  return {
    job: { claim, runId },
    owner,
    note,
    publication: {
      noteId: note.note.id,
      revision: note.revision,
      fingerprint: EMBEDDING_FINGERPRINT,
      projection,
      embeddings: projection.passages.map(vector),
    },
  };
}

it("publishes all current passages once and scopes reads to the live owner and profile", async () => {
  const f = await fixture();
  const store = createNoteIndexStore(connection.db);
  const results = await Promise.all([
    store.publish(f.owner, f.publication, f.job),
    createNoteIndexStore(other.db).publish(f.owner, f.publication, f.job),
  ]);
  expect(results.sort()).toEqual(["already_ready", "published"]);
  const current = await store.readCurrent(f.owner, f.note.note.id);
  expect(current?.passages.map(({ text }) => text)).toEqual(["First fact.", "Second fact."]);
  expect(current?.passages.every(({ embedding }) => embedding.length === 1536)).toBe(true);
  expect(await store.readCurrent("foreign-owner", f.note.note.id)).toBeUndefined();
  expect(await store.publish("foreign-owner", f.publication, f.job)).toBe("unavailable");
  expect(
    await connection.db
      .select()
      .from(noteIndexIntents)
      .where(eq(noteIndexIntents.noteId, f.note.note.id)),
  ).toEqual([]);
  await connection.db
    .update(noteIndexes)
    .set({ fingerprint: "obsolete-profile" })
    .where(eq(noteIndexes.noteId, f.note.note.id));
  expect(await store.readCurrent(f.owner, f.note.note.id)).toBeUndefined();
});

it("represents a supported empty note as ready with zero passages", async () => {
  const f = await fixture("");
  const store = createNoteIndexStore(connection.db);
  expect(await store.publish(f.owner, f.publication, f.job)).toBe("published");
  expect(await store.readCurrent(f.owner, f.note.note.id)).toEqual({
    revision: 1,
    fingerprint: EMBEDDING_FINGERPRINT,
    passages: [],
  });
});

it("physically removes old derived content on edit and rejects a late completion", async () => {
  const f = await fixture();
  const store = createNoteIndexStore(connection.db);
  expect(await store.publish(f.owner, f.publication, f.job)).toBe("published");
  expect(
    (
      await createNoteStore(other.db).update(f.owner, f.note.note.id, 1, {
        title: "Updated",
        content: "New private fact",
      })
    ).status,
  ).toBe("saved");
  expect(await store.publish(f.owner, f.publication, f.job)).toBe("stale");
  expect(await store.readCurrent(f.owner, f.note.note.id)).toBeUndefined();
  expect(
    await connection.db.select().from(notePassages).where(eq(notePassages.noteId, f.note.note.id)),
  ).toEqual([]);
  expect(
    await connection.db.select().from(noteIndexes).where(eq(noteIndexes.noteId, f.note.note.id)),
  ).toEqual([]);
  const [intent] = await connection.db
    .select()
    .from(noteIndexIntents)
    .where(eq(noteIndexIntents.noteId, f.note.note.id));
  expect(intent.revision).toBe(2);
});

it("cannot recreate deleted content and cascades both publication and passages", async () => {
  const f = await fixture();
  const store = createNoteIndexStore(connection.db);
  expect(await store.publish(f.owner, f.publication, f.job)).toBe("published");
  expect(await createNoteStore(other.db).delete(f.owner, f.note.note.id, 1)).toEqual({
    status: "deleted",
  });
  expect(await store.publish(f.owner, f.publication, f.job)).toBe("unavailable");
  expect(await store.readCurrent(f.owner, f.note.note.id)).toBeUndefined();
  expect(
    await connection.db.select().from(notePassages).where(eq(notePassages.noteId, f.note.note.id)),
  ).toEqual([]);
});

it("rejects invalid vectors, incomplete projections and mismatched source/configuration before publication", async () => {
  const f = await fixture();
  const store = createNoteIndexStore(connection.db);
  for (const bad of [
    [],
    [1],
    Array(1536).fill(0),
    [NaN, ...vector().slice(1)],
    [Infinity, ...vector().slice(1)],
    [1e100, ...vector().slice(1)],
    [1e30, ...vector().slice(1)],
    [1e-30, ...vector().slice(1)],
  ]) {
    await expect(
      store.publish(f.owner, { ...f.publication, embeddings: [bad, vector()] }, f.job),
    ).rejects.toThrow();
  }
  await expect(
    store.publish(f.owner, { ...f.publication, fingerprint: "different-model" }, f.job),
  ).rejects.toThrow();
  await expect(
    store.publish(f.owner, { ...f.publication, embeddings: [vector()] }, f.job),
  ).rejects.toThrow();
  await expect(
    store.publish(
      f.owner,
      {
        ...f.publication,
        projection: {
          ...f.publication.projection,
          status: "partial",
          issues: [{ code: "passage_limit" }],
        },
      },
      f.job,
    ),
  ).rejects.toThrow();
  await expect(
    store.publish(
      f.owner,
      {
        ...f.publication,
        projection: {
          status: "complete",
          passages: [
            {
              text: "foreign",
              source: { ...f.publication.projection.passages[0].source, version: "old-version" },
            },
          ],
        },
        embeddings: [vector()],
      },
      f.job,
    ),
  ).rejects.toThrow();
  expect(await store.readCurrent(f.owner, f.note.note.id)).toBeUndefined();
  expect(
    await connection.db
      .select()
      .from(noteIndexIntents)
      .where(eq(noteIndexIntents.noteId, f.note.note.id)),
  ).toHaveLength(1);
});

it("rolls back metadata and preserves intent when a passage insert fails", async () => {
  const f = await fixture();
  await connection.db.execute(
    sql`ALTER TABLE note_passages ADD CONSTRAINT synthetic_failure CHECK (ordinal < 0) NOT VALID`,
  );
  try {
    await expect(
      createNoteIndexStore(connection.db).publish(f.owner, f.publication, f.job),
    ).rejects.toThrow();
    expect(
      await createNoteIndexStore(other.db).readCurrent(f.owner, f.note.note.id),
    ).toBeUndefined();
    expect(
      await connection.db.select().from(noteIndexes).where(eq(noteIndexes.noteId, f.note.note.id)),
    ).toEqual([]);
    expect(
      await connection.db
        .select()
        .from(noteIndexIntents)
        .where(eq(noteIndexIntents.noteId, f.note.note.id)),
    ).toHaveLength(1);
  } finally {
    await connection.db.execute(sql`ALTER TABLE note_passages DROP CONSTRAINT synthetic_failure`);
  }
  expect(await createNoteIndexStore(connection.db).publish(f.owner, f.publication, f.job)).toBe(
    "published",
  );
});

it("serializes a racing edit and publication without retaining old vectors", async () => {
  const f = await fixture();
  const store = createNoteIndexStore(connection.db);
  const [published, edited] = await Promise.all([
    store.publish(f.owner, f.publication, f.job),
    createNoteStore(other.db).update(f.owner, f.note.note.id, 1, {
      title: "Edited",
      content: "Updated source",
    }),
  ]);
  expect(["published", "stale"]).toContain(published);
  expect(edited.status).toBe("saved");
  expect(await store.readCurrent(f.owner, f.note.note.id)).toBeUndefined();
  expect(
    await connection.db.select().from(notePassages).where(eq(notePassages.noteId, f.note.note.id)),
  ).toEqual([]);
});
