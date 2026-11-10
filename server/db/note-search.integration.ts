import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
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
  expect(first.passages[0].score).toBeCloseTo(1);
  expect(first.coverage).toEqual({ ready: 1, pending: 0, failed: 0 });

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
    coverage: { ready: 0, pending: 1, failed: 0 },
  });
  expect(await createNoteStore(database.other).delete(owner, own.note.id, 2)).toEqual({
    status: "deleted",
  });
  expect(await search.candidates(owner, vector())).toEqual({
    passages: [],
    coverage: { ready: 0, pending: 0, failed: 0 },
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
    coverage: { ready: 0, pending: 1, failed: 0 },
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
    coverage: { ready: 1, pending: 0, failed: 0 },
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
  expect(result.coverage).toEqual({ ready: 2, pending: 0, failed: 1 });
});

it("distinguishes a complete empty index from unfinished coverage", async () => {
  const owner = randomUUID();
  const search = createNoteSearchStore(database.db);
  expect(await search.candidates(owner, vector())).toEqual({
    passages: [],
    coverage: { ready: 0, pending: 0, failed: 0 },
  });
  await published(owner, "");
  expect(await search.candidates(owner, vector())).toEqual({
    passages: [],
    coverage: { ready: 1, pending: 0, failed: 0 },
  });
  await createNoteStore(database.db).create(owner, {
    title: "Awaiting indexing",
    content: "A future passage.",
    createdAt: "2026-11-09T10:00:00.000Z",
  });
  expect(await search.candidates(owner, vector())).toEqual({
    passages: [],
    coverage: { ready: 1, pending: 1, failed: 0 },
  });
});

it("counts current processing and failed revisions without counting another owner", async () => {
  const owner = randomUUID();
  const processing = await createNoteStore(database.db).create(owner, {
    title: "Processing",
    content: "Awaiting a worker.",
    createdAt: "2026-11-09T10:00:00.000Z",
  });
  const failed = await createNoteStore(database.db).create(owner, {
    title: "Failed",
    content: "Worker failed.",
    createdAt: "2026-11-09T10:00:00.000Z",
  });
  await published(owner, "");
  await published(randomUUID(), "Foreign evidence.");
  await createNoteIndexJobs(database.db).claim(processing.note.id, "https://index.test");
  await database.db
    .update(noteIndexIntents)
    .set({ failureCode: "provider_unavailable" })
    .where(eq(noteIndexIntents.noteId, failed.note.id));
  expect((await createNoteSearchStore(database.db).candidates(owner, vector())).coverage).toEqual({
    ready: 1,
    pending: 1,
    failed: 1,
  });
});

it("overfetches and skips invalid top passages while retaining a later safe candidate", async () => {
  const owner = randomUUID();
  const invalid = await published(owner, "Tampered top-ranked passage.");
  const valid = await published(owner, "Still safe to return.");
  await database.db
    .update(notePassages)
    .set({ text: "Tampered private text." })
    .where(eq(notePassages.noteId, invalid.note.id));
  const result = await createNoteSearchStore(database.db).candidates(owner, vector(), 1);
  expect(result.passages.map((item) => item.text)).toEqual(["Still safe to return."]);
  expect(result.passages[0].source.noteId).toBe(valid.note.id);
  expect(result.coverage).toEqual({ ready: 2, pending: 0, failed: 0 });
});

it("suppresses a candidate when a source edit commits while search waits on its lock", async () => {
  const owner = randomUUID();
  const note = await published(owner, "Evidence about to change.");
  let entered!: () => void;
  let release!: () => void;
  const writerEntered = new Promise<void>((resolve) => (entered = resolve));
  const writerGate = new Promise<void>((resolve) => (release = resolve));
  const writer = database.other.transaction(async (tx) => {
    await tx.select().from(notes).where(eq(notes.id, note.note.id)).for("update");
    await tx
      .update(notes)
      .set({ content: "Replacement text.", revision: 2 })
      .where(eq(notes.id, note.note.id));
    await tx.delete(noteIndexes).where(eq(noteIndexes.noteId, note.note.id));
    entered();
    await writerGate;
  });
  await writerEntered;
  const search = createNoteSearchStore(database.db).candidates(owner, vector());
  try {
    const deadline = Date.now() + 5_000;
    let waiting = false;
    while (Date.now() < deadline && !waiting) {
      const result = await database.db.execute(
        sql`select exists(select 1 from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock') as waiting`,
      );
      waiting = result.rows[0].waiting === true;
      if (!waiting) await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(waiting).toBe(true);
  } finally {
    release();
    await writer;
  }
  expect((await search).passages).toEqual([]);
});
