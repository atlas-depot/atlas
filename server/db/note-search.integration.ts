import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { expect, it } from "vite-plus/test";
import { EMBEDDING_DIMENSIONS, EMBEDDING_FINGERPRINT } from "../../shared/embedding.ts";
import { projectNotePassages } from "../passages.ts";
import { setupIndexTestDatabase } from "./index-test-database.ts";
import { createNoteIndexJobs } from "./note-index-jobs.ts";
import { createNoteIndexStore } from "./note-index.ts";
import { createNoteSearchStore } from "./note-search.ts";
import { createNoteStore } from "./notes.ts";
import { noteIndexes, noteIndexIntents, notePassages, notes } from "./schema.ts";

const database = setupIndexTestDatabase();
const vector = () => Array.from({ length: EMBEDDING_DIMENSIONS }, (_, i) => (i === 0 ? 1 : 0));

async function published(owner: string, content: string) {
  const note = await createNoteStore(database.db).create(owner, {
    title: "Search fixture",
    content,
    createdAt: "2026-11-09T10:00:00.000Z",
  });
  const claim = await createNoteIndexJobs(database.db).claim(note.note.id, "https://index.test");
  if (!claim) throw new Error("Fixture claim failed");
  const runId = randomUUID();
  await createNoteIndexJobs(database.db).bind(claim, runId);
  const projection = projectNotePassages({
    noteId: note.note.id,
    version: JSON.stringify(`${note.note.id}:${note.revision}`),
    content,
  });
  expect(
    await createNoteIndexStore(database.db).publish(
      owner,
      {
        noteId: note.note.id,
        revision: note.revision,
        fingerprint: EMBEDDING_FINGERPRINT,
        projection,
        embeddings: projection.passages.map(vector),
      },
      { claim, runId },
    ),
  ).toBe("published");
  return note;
}

it("searches only owned, current passages and removes edited or deleted evidence", async () => {
  const owner = randomUUID();
  const foreign = randomUUID();
  const own = await published(owner, "My private search evidence.");
  await published(foreign, "Another account's secret.");
  const search = createNoteSearchStore(database.db);
  const first = await search.candidates(owner, vector());
  expect(first.passages.map((item) => item.text)).toEqual(["My private search evidence."]);
  expect(first.passages[0].source.noteId).toBe(own.note.id);
  expect(first.pendingCoverage).toBe(false);
  expect(first.failedCoverage).toBe(false);

  expect(
    (
      await createNoteStore(database.other).update(owner, own.note.id, 1, {
        title: "Changed",
        content: "New content awaiting an index.",
      })
    ).status,
  ).toBe("saved");
  expect(await search.candidates(owner, vector())).toEqual({
    passages: [],
    pendingCoverage: true,
    failedCoverage: false,
  });
  expect(await createNoteStore(database.other).delete(owner, own.note.id, 2)).toEqual({
    status: "deleted",
  });
  expect(await search.candidates(owner, vector())).toEqual({
    passages: [],
    pendingCoverage: false,
    failedCoverage: false,
  });
});

it("rejects mismatched index profile and tampered source references", async () => {
  const owner = randomUUID();
  const note = await published(owner, "Supported source.");
  const search = createNoteSearchStore(database.db);
  await database.db
    .update(notePassages)
    .set({
      source: {
        kind: "markdown",
        noteId: note.note.id,
        version: "wrong",
        headingPath: [],
        startOffset: 0,
        endOffset: 1,
      },
    })
    .where(eq(notePassages.noteId, note.note.id));
  expect((await search.candidates(owner, vector())).passages).toEqual([]);
  await database.db
    .update(noteIndexes)
    .set({ fingerprint: "obsolete-profile" })
    .where(eq(noteIndexes.noteId, note.note.id));
  expect(await search.candidates(owner, vector())).toEqual({
    passages: [],
    pendingCoverage: true,
    failedCoverage: false,
  });
});

it("revalidates the live source even when a stored revision was not advanced", async () => {
  const owner = randomUUID();
  const note = await published(owner, "Old indexed evidence.");
  await database.db
    .update(notes)
    .set({ content: "Changed without an index update." })
    .where(eq(notes.id, note.note.id));
  expect(await createNoteSearchStore(database.db).candidates(owner, vector())).toEqual({
    passages: [],
    pendingCoverage: false,
    failedCoverage: false,
  });
});

it("ranks bounded candidates and reports failed indexing separately", async () => {
  const owner = randomUUID();
  await published(owner, "Closest evidence.");
  const distant = await published(owner, "Distant evidence.");
  await database.db
    .update(notePassages)
    .set({ embedding: Array.from({ length: EMBEDDING_DIMENSIONS }, (_, i) => (i === 1 ? 1 : 0)) })
    .where(eq(notePassages.noteId, distant.note.id));
  const failed = await createNoteStore(database.db).create(owner, {
    title: "Index failed",
    content: "Unindexed evidence.",
    createdAt: "2026-11-09T10:00:00.000Z",
  });
  await database.db
    .update(noteIndexIntents)
    .set({ failureCode: "provider_unavailable" })
    .where(eq(noteIndexIntents.noteId, failed.note.id));
  const result = await createNoteSearchStore(database.db).candidates(owner, vector(), 1);
  expect(result.passages.map((item) => item.text)).toEqual(["Closest evidence."]);
  expect(result.pendingCoverage).toBe(false);
  expect(result.failedCoverage).toBe(true);
});
