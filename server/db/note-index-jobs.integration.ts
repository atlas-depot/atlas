import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { Pool } from "pg";
import { afterAll, beforeAll, expect, it } from "vite-plus/test";
import { EMBEDDING_FINGERPRINT } from "../../shared/embedding.ts";
import { openDatabase, readTestDatabaseUrl } from "./connection.ts";
import { applyMigrations } from "./migrations.ts";
import { createNoteIndexJobs } from "./note-index-jobs.ts";
import { createNoteIndexStore } from "./note-index.ts";
import { createNoteStore } from "./notes.ts";
import { noteIndexIntents } from "./schema.ts";

const databaseName = `atlas_jobs_${randomUUID().replaceAll("-", "")}`;
const runtimeUrl = "https://immutable-index.test";
let admin: Pool;
let databaseUrl: string;
let connection: ReturnType<typeof openDatabase>;
let other: ReturnType<typeof openDatabase>;

beforeAll(async () => {
  const url = new URL(readTestDatabaseUrl(process.env));
  admin = new Pool({ connectionString: url.href });
  await admin.query(`CREATE DATABASE "${databaseName}"`);
  url.pathname = `/${databaseName}`;
  databaseUrl = url.href;
  connection = openDatabase(databaseUrl);
  other = openDatabase(databaseUrl);
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

async function fixture() {
  const owner = randomUUID();
  const value = await createNoteStore(connection.db).create(owner, {
    title: "Synthetic",
    content: "Private source must never enter the intent.",
    createdAt: "2026-11-09T10:00:00.000Z",
  });
  const noteId = value.note.id;
  const jobs = createNoteIndexJobs(connection.db);
  const claim = await jobs.claim(noteId, runtimeUrl);
  if (!claim) throw new Error("Fixture claim failed");
  return { owner, noteId, value, jobs, claim };
}
const intent = async (id: string) =>
  (await connection.db.select().from(noteIndexIntents).where(eq(noteIndexIntents.noteId, id)))[0];

it("persists save-before-dispatch across pool recreation without copying source content", async () => {
  const writer = openDatabase(databaseUrl);
  const note = await createNoteStore(writer.db).create("durable-owner", {
    title: "Source",
    content: "Secret body",
    createdAt: "2026-11-09T10:00:00.000Z",
  });
  await writer.close();
  const fresh = openDatabase(databaseUrl);
  try {
    const jobs = createNoteIndexJobs(fresh.db);
    const pending = await jobs.pending(100);
    expect(pending).toContainEqual(expect.objectContaining({ noteId: note.note.id, token: null }));
    expect(JSON.stringify(pending)).not.toContain("Secret body");
    const claims = await Promise.all([
      jobs.claim(note.note.id, runtimeUrl),
      createNoteIndexJobs(other.db).claim(note.note.id, runtimeUrl),
    ]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    expect(await jobs.getStatus("foreign-owner", note.note.id)).toBeUndefined();
  } finally {
    await fresh.close();
  }
});

it("binds one runtime only, permits same-run replay and derives ownership from the source", async () => {
  const f = await fixture();
  const otherJobs = createNoteIndexJobs(other.db);
  const results = await Promise.all([
    f.jobs.bind(f.claim, "run-a"),
    otherJobs.bind(f.claim, "run-b"),
  ]);
  expect(results.filter(Boolean)).toHaveLength(1);
  const runId = results[0] ? "run-a" : "run-b";
  expect(await f.jobs.bind(f.claim, runId)).toEqual({ ...f.value, ownerId: f.owner, attempts: 0 });
  expect(await f.jobs.recordRun(f.claim, runId)).toBe(true);
  expect(await f.jobs.recordRun(f.claim, "wrong-run")).toBe(false);
  expect(await f.jobs.getStatus(f.owner, f.noteId)).toEqual({
    status: "processing",
    version: JSON.stringify(`${f.noteId}:1`),
  });
});

it("fences stale tokens on edit and deletion, resetting all recovery state on edit", async () => {
  const f = await fixture();
  await f.jobs.bind(f.claim, "run");
  await f.jobs.fail(f.claim, "run", "provider_unavailable", new Date(Date.now() + 60000));
  await createNoteStore(other.db).update(f.owner, f.noteId, 1, {
    title: "Edited",
    content: "Current",
  });
  expect(await f.jobs.bind(f.claim, "run")).toBeNull();
  expect(await f.jobs.recordRun(f.claim, "run")).toBe(false);
  expect(await f.jobs.fail(f.claim, "run", "runtime_failed", null)).toBe(false);
  expect(await f.jobs.release(f.claim, "run")).toBe(false);
  expect(await intent(f.noteId)).toMatchObject({
    revision: 2,
    fingerprint: EMBEDDING_FINGERPRINT,
    claimToken: null,
    runId: null,
    runtimeUrl: null,
    claimedAt: null,
    failureCode: null,
    attempts: 0,
  });
  const next = await f.jobs.claim(f.noteId, runtimeUrl);
  expect(next?.token).not.toBe(f.claim.token);
  if (!next) throw new Error("Next claim missing");
  await createNoteStore(other.db).delete(f.owner, f.noteId, 2);
  expect(await f.jobs.bind(next, "next-run")).toBeNull();
  expect(await f.jobs.getStatus(f.owner, f.noteId)).toBeUndefined();
});

it("retains failed claims until terminal confirmation and honors retry time", async () => {
  const f = await fixture();
  await f.jobs.bind(f.claim, "run");
  const retryAt = new Date(Date.now() + 60000);
  expect(await f.jobs.fail(f.claim, "wrong", "provider_unavailable", retryAt)).toBe(false);
  expect(await f.jobs.fail(f.claim, "run", "provider_unavailable", retryAt)).toBe(true);
  expect(await f.jobs.fail(f.claim, "run", "provider_unavailable", retryAt)).toBe(true);
  expect(await intent(f.noteId)).toMatchObject({
    claimToken: f.claim.token,
    runId: "run",
    attempts: 1,
  });
  expect(await f.jobs.pending(100)).toContainEqual(
    expect.objectContaining({
      noteId: f.noteId,
      token: f.claim.token,
      retryAt: retryAt.toISOString(),
      failureCode: "provider_unavailable",
    }),
  );
  expect(await f.jobs.getStatus(f.owner, f.noteId)).toEqual({
    status: "failed",
    version: JSON.stringify(`${f.noteId}:1`),
    code: "provider_unavailable",
    retryAt: retryAt.toISOString(),
  });
  expect(await f.jobs.bind(f.claim, "run")).toBeNull();
  expect(await f.jobs.release(f.claim, "wrong")).toBe(false);
  expect(await f.jobs.release(f.claim, "run")).toBe(true);
  expect(await f.jobs.claim(f.noteId, runtimeUrl)).toBeNull();
  await connection.db
    .update(noteIndexIntents)
    .set({ retryAt: sql`clock_timestamp() - interval '1 second'` })
    .where(eq(noteIndexIntents.noteId, f.noteId));
  const allocation = await f.jobs.claimWithAttempt(f.noteId, runtimeUrl);
  expect(allocation?.attempts).toBe(1);
  const next = allocation?.claim;
  expect(next?.token).not.toBe(f.claim.token);
  if (!next) throw new Error("Retry claim missing");
  expect((await f.jobs.bind(next, "retry-run"))?.attempts).toBe(1);
});

it("blocks permanent failures until a source change", async () => {
  const f = await fixture();
  await f.jobs.bind(f.claim, "run");
  expect(await f.jobs.fail(f.claim, "run", "unsupported_content", null)).toBe(true);
  expect(await f.jobs.release(f.claim, "run")).toBe(true);
  expect(await f.jobs.getStatus(f.owner, f.noteId)).toEqual({
    status: "failed",
    version: JSON.stringify(`${f.noteId}:1`),
    code: "unsupported_content",
    retryAt: null,
  });
  expect(await f.jobs.claim(f.noteId, runtimeUrl)).toBeNull();
  expect((await f.jobs.pending(100)).some((row) => row.noteId === f.noteId)).toBe(false);
});

it("reclaims unbound dispatch after two minutes, rejecting a late runtime and stale token", async () => {
  const f = await fixture();
  await f.jobs.fail(f.claim, null, "runtime_unavailable", new Date(0));
  expect(await f.jobs.release(f.claim, null)).toBe(false);
  await connection.db
    .update(noteIndexIntents)
    .set({ claimedAt: sql`clock_timestamp() - interval '3 minutes'` })
    .where(eq(noteIndexIntents.noteId, f.noteId));
  expect(await f.jobs.release(f.claim, null)).toBe(true);
  const next = await f.jobs.claim(f.noteId, runtimeUrl);
  expect(next?.token).not.toBe(f.claim.token);
  expect(await f.jobs.bind(f.claim, "late-run")).toBeNull();
  expect(await f.jobs.recordRun(f.claim, "late-run")).toBe(false);
});

it("does not claim or mutate another deployment's profile and never calls missing work ready", async () => {
  const f = await fixture();
  await connection.db
    .update(noteIndexIntents)
    .set({ fingerprint: "future-profile" })
    .where(eq(noteIndexIntents.noteId, f.noteId));
  expect(await f.jobs.bind(f.claim, "run")).toBeNull();
  expect(await f.jobs.fail(f.claim, null, "runtime_failed", null)).toBe(false);
  expect((await f.jobs.pending(100)).some((row) => row.noteId === f.noteId)).toBe(false);
  expect(await f.jobs.getStatus(f.owner, f.noteId)).toMatchObject({ status: "pending" });
  await connection.db.delete(noteIndexIntents).where(eq(noteIndexIntents.noteId, f.noteId));
  expect(await f.jobs.getStatus(f.owner, f.noteId)).toMatchObject({ status: "pending" });
  expect(await f.jobs.claim(f.noteId, runtimeUrl)).toBeNull();
});

it("requires a matching bound claim before publication and exposes supported empty readiness", async () => {
  const f = await fixture();
  const store = createNoteIndexStore(connection.db);
  const publication = {
    noteId: f.noteId,
    revision: 1,
    fingerprint: EMBEDDING_FINGERPRINT,
    projection: { status: "empty", passages: [] },
    embeddings: [],
  };
  expect(await store.publish(f.owner, publication, { claim: f.claim, runId: "run" })).toBe("stale");
  await f.jobs.bind(f.claim, "run");
  expect(
    await store.publish(f.owner, publication, {
      claim: { ...f.claim, token: randomUUID() },
      runId: "run",
    }),
  ).toBe("stale");
  expect(await store.publish(f.owner, publication, { claim: f.claim, runId: "wrong" })).toBe(
    "stale",
  );
  expect(await store.publish(f.owner, publication, { claim: f.claim, runId: "run" })).toBe(
    "published",
  );
  expect(await store.publish(f.owner, publication, { claim: f.claim, runId: "run" })).toBe(
    "already_ready",
  );
  expect(await f.jobs.getStatus(f.owner, f.noteId)).toEqual({
    status: "ready",
    version: JSON.stringify(`${f.noteId}:1`),
    passageCount: 0,
  });
});

it("lets an uncertain-start runtime bind once before reclamation without stale allocation failure", async () => {
  const f = await fixture();
  await f.jobs.fail(f.claim, null, "runtime_unavailable", new Date(Date.now() + 60000));
  expect((await f.jobs.bind(f.claim, "late-start"))?.ownerId).toBe(f.owner);
  expect(await f.jobs.getStatus(f.owner, f.noteId)).toMatchObject({ status: "processing" });
  expect(await intent(f.noteId)).toMatchObject({
    failureCode: null,
    attempts: 1,
    runId: "late-start",
  });
});

it("rotates bounded inspection so active claims cannot starve due work or later claim checks", async () => {
  // Isolate scheduling order from other cases without deleting their lifecycle evidence.
  await connection.db.update(noteIndexIntents).set({ lastCheckedAt: "2099-01-01T00:00:00Z" });
  const fixtures = [await fixture(), await fixture(), await fixture(), await fixture()];
  for (const [index, f] of fixtures.entries()) {
    await connection.db
      .update(noteIndexIntents)
      .set({ lastCheckedAt: `200${index}-01-01T00:00:00Z` })
      .where(eq(noteIndexIntents.noteId, f.noteId));
  }
  const due = fixtures[3];
  await connection.db
    .update(noteIndexIntents)
    .set({ claimedAt: sql`clock_timestamp() - interval '3 minutes'` })
    .where(eq(noteIndexIntents.noteId, due.noteId));
  await due.jobs.release(due.claim, null);
  const originalRequest = (await intent(due.noteId)).requestedAt;
  const batches = [];
  for (let i = 0; i < 3; i++) batches.push((await due.jobs.pending(2)).map((row) => row.noteId));
  expect(batches).toEqual([
    fixtures.slice(0, 2).map((f) => f.noteId),
    fixtures.slice(2).map((f) => f.noteId),
    expect.arrayContaining(fixtures.slice(0, 2).map((f) => f.noteId)),
  ]);
  expect((await intent(due.noteId)).requestedAt).toBe(originalRequest);
  const locked = fixtures[0];
  const bounded = openDatabase(databaseUrl, { lockTimeoutMs: 100 });
  try {
    await connection.db.transaction(async (tx) => {
      // A source writer holds its note and intent while a concurrent reconciler inspects others.
      await tx.execute(sql`SELECT id FROM notes WHERE id = ${locked.noteId} FOR UPDATE`);
      await tx.execute(
        sql`SELECT note_id FROM note_index_intents WHERE note_id = ${locked.noteId} FOR UPDATE`,
      );
      const inspected = await createNoteIndexJobs(bounded.db).pending(2);
      expect(inspected).toHaveLength(2);
      expect(inspected.some((row) => row.noteId === locked.noteId)).toBe(false);
    });
  } finally {
    await bounded.close();
  }
});

it("preserves the worker's permanent failure against a stale reconciler completion fallback", async () => {
  const f = await fixture();
  await f.jobs.bind(f.claim, "worker-run");
  const pending = (await createNoteIndexJobs(other.db).pending(100)).find(
    (row) => row.noteId === f.noteId,
  );
  expect(pending?.failureCode).toBeNull();
  // Runtime status is in flight after this snapshot. The worker records its specific failure first.
  expect(await f.jobs.fail(f.claim, "worker-run", "unsupported_content", null)).toBe(true);
  expect(
    await createNoteIndexJobs(other.db).fail(
      f.claim,
      "worker-run",
      "completion_missing",
      new Date(0),
    ),
  ).toBe(false);
  expect(await f.jobs.release(f.claim, "worker-run")).toBe(true);
  expect(await intent(f.noteId)).toMatchObject({
    failureCode: "unsupported_content",
    retryAt: null,
    attempts: 1,
  });
  expect(await f.jobs.getStatus(f.owner, f.noteId)).toMatchObject({
    status: "failed",
    code: "unsupported_content",
    retryAt: null,
  });
  expect(await f.jobs.claim(f.noteId, runtimeUrl)).toBeNull();
});
