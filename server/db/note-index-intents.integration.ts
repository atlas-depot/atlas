import { EMBEDDING_FINGERPRINT } from "../../shared/embedding.ts";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { eq, sql } from "drizzle-orm";
import { expect, it } from "vite-plus/test";
import { setupIndexTestDatabase } from "./index-test-database.ts";
import { createNoteDraftStore, draftTag } from "./note-drafts.ts";
import { createNoteStore } from "./notes.ts";
import {
  draftSaveRequests,
  noteCreateRequests,
  noteDrafts,
  noteIndexIntents,
  notes,
} from "./schema.ts";
import { seedNotes } from "./seed.ts";

// Real PostgreSQL transactions and separate pools, without a model or Workflow runtime.
const legacyId = randomUUID();
const input = {
  title: "Synthetic source",
  content: "The launch is Tuesday.",
  createdAt: "2026-11-08T10:00:00.000Z",
};

const database = setupIndexTestDatabase(async (connection) => {
  // Upgrade an existing database, not only a freshly empty schema.
  for (const name of [
    "0000_create-notes",
    "0001_organize-runs",
    "0002_organize-usage",
    "0003_note-create-idempotency",
    "0004_note-documents",
    "0005_ai-note-drafts",
  ]) {
    await connection.db.execute(
      sql.raw(await readFile(new URL(`../../drizzle/${name}.sql`, import.meta.url), "utf8")),
    );
  }
  await connection.db.insert(notes).values({
    ...input,
    id: legacyId,
    ownerId: "legacy-owner",
    revision: 7,
    updatedAt: input.createdAt,
  });
  await connection.db.execute(
    sql.raw(await readFile(new URL("../../drizzle/0006_note-index.sql", import.meta.url), "utf8")),
  );
});

const intents = (id: string) =>
  database.other
    .select({
      noteId: noteIndexIntents.noteId,
      revision: noteIndexIntents.revision,
      requestedAt: noteIndexIntents.requestedAt,
    })
    .from(noteIndexIntents)
    .where(eq(noteIndexIntents.noteId, id));

async function temporaryDraft(owner: string) {
  const source = await createNoteStore(database.db).create(owner, input);
  const [draft] = await database.db
    .insert(noteDrafts)
    .values({
      id: randomUUID(),
      ownerId: owner,
      sourceNoteId: source.note.id,
      sourceRevision: 1,
      title: "Organized source",
      content: "## Launch\n\nTuesday.",
      sources: [],
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      updatedAt: new Date().toISOString(),
    })
    .returning();
  return draft;
}

it("backfills an existing note at its current revision without changing its content", async () => {
  expect(await intents(legacyId)).toEqual([
    { noteId: legacyId, revision: 7, requestedAt: expect.any(String) },
  ]);
  const [backfilled] = await database.db
    .select()
    .from(noteIndexIntents)
    .where(eq(noteIndexIntents.noteId, legacyId));
  expect(backfilled).toMatchObject({
    fingerprint: EMBEDDING_FINGERPRINT,
    claimToken: null,
    runId: null,
    runtimeUrl: null,
    claimedAt: null,
    failureCode: null,
    attempts: 0,
    retryAt: expect.any(String),
  });
  expect(await createNoteStore(database.other).read("legacy-owner", legacyId)).toEqual({
    note: { ...input, id: legacyId, updatedAt: input.createdAt },
    revision: 7,
  });
});

it("enqueues only newly inserted development seeds, never a replay", async () => {
  expect(await seedNotes(database.db)).toBe(2);
  const seeds = await database.other
    .select()
    .from(noteIndexIntents)
    .innerJoin(notes, eq(notes.id, noteIndexIntents.noteId));
  const seeded = seeds.filter((row) => row.notes.ownerId.startsWith("synthetic-seed-"));
  expect(seeded).toHaveLength(2);
  for (const { note_index_intents: intent } of seeded) {
    expect(intent.revision).toBe(1);
    await database.db.delete(noteIndexIntents).where(eq(noteIndexIntents.noteId, intent.noteId));
  }
  expect(await seedNotes(database.db)).toBe(0);
  for (const { note_index_intents: intent } of seeded)
    expect(await intents(intent.noteId)).toEqual([]);
});

it("commits a durable revision-bound intent with ordinary and idempotent creates", async () => {
  const owner = randomUUID();
  const store = createNoteStore(database.db);
  const ordinary = await store.create(owner, input);
  const idempotent = await store.createIdempotent(owner, randomUUID(), input);
  if (idempotent.status !== "saved") throw new Error("Expected saved note");
  for (const created of [ordinary, idempotent.value]) {
    expect(await intents(created.note.id)).toEqual([
      { noteId: created.note.id, revision: 1, requestedAt: expect.any(String) },
    ]);
  }
});

it("does not requeue an already consumed intent when a creation response is replayed", async () => {
  const owner = randomUUID();
  const key = randomUUID();
  const store = createNoteStore(database.db);
  const created = await store.createIdempotent(owner, key, input);
  if (created.status !== "saved") throw new Error("Expected saved note");
  await database.db
    .delete(noteIndexIntents)
    .where(eq(noteIndexIntents.noteId, created.value.note.id));
  expect(await createNoteStore(database.other).createIdempotent(owner, key, input)).toEqual(
    created,
  );
  expect(await intents(created.value.note.id)).toEqual([]);
});

it("coalesces edits to the newest revision without changing intent on rejected writes", async () => {
  const owner = randomUUID();
  const store = createNoteStore(database.db);
  const created = await store.create(owner, input);
  const id = created.note.id;
  const update = { title: input.title, content: "The launch is Wednesday." };
  expect((await store.update(owner, id, 1, update)).status).toBe("saved");
  expect((await store.update(owner, id, 2, update)).status).toBe("saved");
  const pending = await intents(id);
  expect(pending).toEqual([{ noteId: id, revision: 3, requestedAt: expect.any(String) }]);
  expect(await store.update(owner, id, 1, update)).toEqual({ status: "conflict" });
  expect(await store.update("foreign-owner", id, 3, update)).toEqual({ status: "not_found" });
  expect(await store.delete("foreign-owner", id, 3)).toEqual({ status: "not_found" });
  expect(await store.delete(owner, id, 2)).toEqual({ status: "conflict" });
  expect(await intents(id)).toEqual(pending);
  expect(await store.delete(owner, id, 3)).toEqual({ status: "deleted" });
  expect(await intents(id)).toEqual([]);
});

it("keeps concurrent edits and the pending revision consistent across connection pools", async () => {
  const owner = randomUUID();
  const store = createNoteStore(database.db);
  const created = await store.create(owner, input);
  const results = await Promise.all([
    store.update(owner, created.note.id, 1, { title: "A", content: "First writer" }),
    createNoteStore(database.other).update(owner, created.note.id, 1, {
      title: "B",
      content: "Second writer",
    }),
  ]);
  expect(results.map((result) => result.status).sort()).toEqual(["conflict", "saved"]);
  expect((await store.read(owner, created.note.id))?.revision).toBe(2);
  expect(await intents(created.note.id)).toEqual([
    { noteId: created.note.id, revision: 2, requestedAt: expect.any(String) },
  ]);
});

it("indexes a saved AI draft once while preserving the original note's intent", async () => {
  const owner = randomUUID();
  const draft = await temporaryDraft(owner);
  const original = await intents(draft.sourceNoteId);
  const data = { title: draft.title, content: draft.content };
  const saved = await createNoteDraftStore(database.db).save(
    owner,
    draft.id,
    draftTag(draft),
    data,
  );
  if (saved.status !== "saved") throw new Error("Expected saved draft");
  expect(await intents(saved.value.note.id)).toEqual([
    { noteId: saved.value.note.id, revision: 1, requestedAt: expect.any(String) },
  ]);
  await database.db
    .delete(noteIndexIntents)
    .where(eq(noteIndexIntents.noteId, saved.value.note.id));
  expect(
    await createNoteDraftStore(database.other).save(owner, draft.id, draftTag(draft), data),
  ).toEqual(saved);
  expect(await intents(saved.value.note.id)).toEqual([]);
  expect(await intents(draft.sourceNoteId)).toEqual(original);
});

it("rolls back notes, receipts and draft removal when the indexing intent cannot be written", async () => {
  const owner = randomUUID();
  const store = createNoteStore(database.db);
  const existing = await store.create(owner, input);
  const pending = await intents(existing.note.id);
  const draft = await temporaryDraft(owner);
  const before = await store.list(owner);
  const key = randomUUID();
  await database.db.execute(
    sql.raw(`
    CREATE FUNCTION reject_index_intent() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'synthetic intent outage'; END $$;
    CREATE TRIGGER reject_index_intent BEFORE INSERT OR UPDATE ON note_index_intents
      FOR EACH ROW EXECUTE FUNCTION reject_index_intent();
  `),
  );
  try {
    await expect(store.create(owner, input)).rejects.toThrow();
    await expect(store.createIdempotent(owner, key, input)).rejects.toThrow();
    await expect(
      store.update(owner, existing.note.id, 1, { title: "Changed", content: "Must roll back" }),
    ).rejects.toThrow();
    await expect(
      createNoteDraftStore(database.db).save(owner, draft.id, draftTag(draft), {
        title: draft.title,
        content: draft.content,
      }),
    ).rejects.toThrow();
    expect(await createNoteStore(database.other).list(owner)).toEqual(before);
    expect(await intents(existing.note.id)).toEqual(pending);
    expect(
      await database.other.select().from(noteCreateRequests).where(eq(noteCreateRequests.key, key)),
    ).toEqual([]);
    expect(
      await database.other
        .select()
        .from(draftSaveRequests)
        .where(eq(draftSaveRequests.draftId, draft.id)),
    ).toEqual([]);
    expect(await createNoteDraftStore(database.other).read(owner, draft.id)).toBeDefined();
  } finally {
    await database.db.execute(
      sql.raw(`
      DROP TRIGGER reject_index_intent ON note_index_intents;
      DROP FUNCTION reject_index_intent();
    `),
    );
  }
});
