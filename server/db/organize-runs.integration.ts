import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import { Pool } from "pg";
import { afterAll, beforeAll, expect, it } from "vite-plus/test";
import { openDatabase, readTestDatabaseUrl } from "./connection.ts";
import { applyMigrations } from "./migrations.ts";
import { createNoteStore } from "./notes.ts";
import { createOrganizeRunStore, type OrganizeRunRecord } from "./organize-runs.ts";

const databaseName = `atlas_runs_test_${randomUUID().replaceAll("-", "")}`;
const runtimeUrl = "https://organizer-deployment.example";
let admin: Pool;
let connection: ReturnType<typeof openDatabase>;
let otherConnection: ReturnType<typeof openDatabase>;
let store: ReturnType<typeof createOrganizeRunStore>;
let otherStore: ReturnType<typeof createOrganizeRunStore>;
let notes: ReturnType<typeof createNoteStore>;

beforeAll(async () => {
  const url = new URL(readTestDatabaseUrl(process.env));
  admin = new Pool({ connectionString: url.toString(), connectionTimeoutMillis: 10_000 });
  await admin.query(`CREATE DATABASE "${databaseName}"`);
  url.pathname = `/${databaseName}`;
  connection = openDatabase(url.toString());
  await applyMigrations(connection.db);
  await applyMigrations(connection.db);
  otherConnection = openDatabase(url.toString());
  store = createOrganizeRunStore(connection.db);
  otherStore = createOrganizeRunStore(otherConnection.db);
  notes = createNoteStore(connection.db);
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

const noteInput = {
  title: "Synthetic source",
  content: "The launch is on Tuesday.",
  createdAt: "2026-11-01T10:00:00.000Z",
};

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function claimed(owner: string): Promise<OrganizeRunRecord> {
  const note = await notes.create(owner, noteInput);
  const run = await store.claim(owner, note.note.id, runtimeUrl);
  if (!run) throw new Error("Expected owned run.");
  return run;
}

it("coalesces concurrent starts across pools and captures one immutable owned source revision", async () => {
  const note = await notes.create("owner-race", noteInput);
  const results = await Promise.all([
    store.claim("owner-race", note.note.id, runtimeUrl),
    otherStore.claim("owner-race", note.note.id, "https://new-deployment.example"),
  ]);
  expect(results[0]).toEqual(results[1]);
  expect(results[0]).toMatchObject({
    ownerId: "owner-race",
    noteId: note.note.id,
    sourceRevision: 1,
    input: { title: noteInput.title, content: noteInput.content },
    runtime: null,
    state: { status: "running", phase: "starting" },
    active: true,
  });
  await notes.update("owner-race", note.note.id, 1, { title: "Changed", content: "Wednesday" });
  expect(await otherStore.claim("owner-race", note.note.id, runtimeUrl)).toEqual(results[0]);
});

it("does not disclose or modify another owner's run or reserve their note", async () => {
  const run = await claimed("owner-private");
  expect(await otherStore.claim("attacker", run.noteId, runtimeUrl)).toBeUndefined();
  expect(await otherStore.read("attacker", run.runId)).toBeUndefined();
  let called = false;
  expect(
    await otherStore.withRun("attacker", run.runId, async () => {
      called = true;
    }),
  ).toBeUndefined();
  expect(called).toBe(false);
  expect(await store.read("owner-private", run.runId)).toEqual(run);
});

it("retains the runtime address and temporary draft after the writer process exits", async () => {
  const run = await claimed("owner-restart");
  const runProcess = (operation: string) =>
    promisify(execFile)(
      process.execPath,
      [
        "--input-type=module",
        "--eval",
        `import { openDatabase } from "./server/db/connection.ts";
     import { createOrganizeRunStore } from "./server/db/organize-runs.ts";
     const connection = openDatabase(process.env.DATABASE_URL);
     const store = createOrganizeRunStore(connection.db);
     try { ${operation} } finally { await connection.close(); }`,
      ],
      {
        env: {
          PATH: process.env.PATH,
          DATABASE_URL: connection.db.$client.options.connectionString,
          RUN_ID: run.runId,
        },
        timeout: 15_000,
      },
    );
  await runProcess(`await store.withRun("owner-restart", process.env.RUN_ID, async (record, save) => {
    await save({ ...record, input: null, runtime: {sessionId:"session-private",deliveryId:"delivery-private"},
      state: { status:"draft", draft:{markdown:"# Separate proposal",sources:[]},
      source:{noteId:record.noteId,revision:1,stale:false}}, expiresAt: Date.now()+60000 });
  });`);
  const recovered = JSON.parse(
    (
      await runProcess(
        `console.log(JSON.stringify(await store.read("owner-restart", process.env.RUN_ID)));`,
      )
    ).stdout,
  ) as unknown;
  expect(recovered).toMatchObject({
    runId: run.runId,
    input: null,
    runtimeUrl,
    runtime: { sessionId: "session-private", deliveryId: "delivery-private" },
    state: { status: "draft", draft: { markdown: "# Separate proposal", sources: [] } },
  });
});

it("serializes run operations across pools and preserves committed cleanup intent on failure", async () => {
  const run = await claimed("owner-cleanup");
  await store.withRun(run.ownerId, run.runId, async (record, save) => {
    await save({
      ...record,
      input: null,
      runtime: { sessionId: "session", deliveryId: "delivery" },
      state: { status: "cleaning" },
      cleanupTarget: { status: "cancelled" },
    });
  });
  const observed: string[] = [];
  const release = deferred();
  const entered = deferred();
  const first = store.withRun(run.ownerId, run.runId, async (record, save) => {
    entered.resolve();
    await release.promise;
    await save({ ...record, state: { status: "failed", reason: "cleanup_failed" } });
  });
  await entered.promise;
  const second = otherStore.withRun(run.ownerId, run.runId, async (record) => {
    observed.push(record.state.status);
  });
  try {
    // Wait for a real PostgreSQL lock waiter rather than treating a short sleep as proof.
    const deadline = Date.now() + 5_000;
    let waiting = false;
    while (Date.now() < deadline && !waiting) {
      const result = await admin.query<{ waiting: boolean }>(
        "select exists(select 1 from pg_stat_activity where datname=$1 and wait_event_type='Lock') as waiting",
        [databaseName],
      );
      waiting = result.rows[0].waiting;
      if (!waiting) await delay(10);
    }
    expect(waiting).toBe(true);
    expect(observed).toEqual([]);
  } finally {
    release.resolve();
    await Promise.all([first, second]);
  }
  expect(observed).toEqual(["failed"]);
  await expect(
    otherStore.withRun(run.ownerId, run.runId, async (record, save) => {
      await save({
        ...record,
        state: { status: "expired" },
        active: false,
        runtime: null,
        cleanupTarget: null,
      });
      throw new Error("Synthetic commit-path failure");
    }),
  ).rejects.toThrow("Synthetic commit-path failure");
  expect(await store.read(run.ownerId, run.runId)).toMatchObject({
    state: { status: "failed", reason: "cleanup_failed" },
    runtime: { sessionId: "session", deliveryId: "delivery" },
    active: true,
    cleanupTarget: { status: "cancelled" },
    input: null,
  });
  expect((await store.claim(run.ownerId, run.noteId, runtimeUrl))?.runId).toBe(run.runId);
});

it("keeps cleanup identity after source deletion and releases the active slot only after retirement", async () => {
  const run = await claimed("owner-delete");
  await store.withRun(run.ownerId, run.runId, async (record, save) => {
    await save({
      ...record,
      input: null,
      runtime: { sessionId: "session", deliveryId: "delivery" },
      state: { status: "cleaning" },
      cleanupTarget: { status: "expired" },
    });
  });
  await notes.delete(run.ownerId, run.noteId, 1);
  expect((await store.read(run.ownerId, run.runId))?.runtime).toEqual({
    sessionId: "session",
    deliveryId: "delivery",
  });
  expect(await store.claim(run.ownerId, run.noteId, runtimeUrl)).toBeUndefined();
  await store.withRun(run.ownerId, run.runId, async (record, save) => {
    await save({
      ...record,
      active: false,
      runtime: null,
      cleanupTarget: null,
      state: { status: "expired" },
      expiresAt: Date.now() - 1,
    });
  });
  await store.purgeExpired();
  expect(await store.read(run.ownerId, run.runId)).toBeUndefined();
});

it("rejects resurrecting retired runs and snapshots or changing their dispatch identity", async () => {
  const run = await claimed("owner-immutable");
  await expect(
    store.withRun(run.ownerId, run.runId, async (record, save) => {
      await save({ ...record, input: { title: "Changed", content: "Wrong snapshot" } });
    }),
  ).rejects.toThrow("input is immutable");
  await expect(
    store.withRun(run.ownerId, run.runId, async (record, save) => {
      await save({ ...record, runtimeUrl: "https://another-deployment.example" });
    }),
  ).rejects.toThrow("immutable");
  await store.withRun(run.ownerId, run.runId, async (record, save) => {
    await save({
      ...record,
      active: false,
      input: null,
      state: { status: "expired" },
      expiresAt: Date.now() + 60_000,
    });
  });
  await expect(
    store.withRun(run.ownerId, run.runId, async (record, save) => {
      await save({ ...record, active: true, state: { status: "running", phase: "starting" } });
    }),
  ).rejects.toThrow("cannot restart");
  const replacement = await store.claim(run.ownerId, run.noteId, runtimeUrl);
  expect(replacement?.runId).not.toBe(run.runId);
});

it("persists empty allocation before submission and never changes a confirmed runtime identity", async () => {
  const run = await claimed("owner-allocation");
  await store.withRun(run.ownerId, run.runId, async (record, save) => {
    await save({ ...record, runtime: { sessionId: "fixed-session", deliveryId: null } });
  });
  expect(await otherStore.read(run.ownerId, run.runId)).toMatchObject({
    runtime: { sessionId: "fixed-session", deliveryId: null },
    input: { title: noteInput.title, content: noteInput.content },
  });
  await otherStore.withRun(run.ownerId, run.runId, async (record, save) => {
    await save({
      ...record,
      runtime: { sessionId: "fixed-session", deliveryId: "fixed-delivery" },
      input: null,
    });
  });
  for (const runtime of [
    { sessionId: "replacement-session", deliveryId: "fixed-delivery" },
    { sessionId: "fixed-session", deliveryId: "replacement-delivery" },
    { sessionId: "fixed-session", deliveryId: null },
  ]) {
    await expect(
      store.withRun(run.ownerId, run.runId, async (record, save) => {
        await save({ ...record, runtime });
      }),
    ).rejects.toThrow("runtime identity is immutable");
  }
});

it("reconciles unobserved running records fairly and never purges active cleanup work", async () => {
  const run = await claimed("owner-pending");
  await store.withRun(run.ownerId, run.runId, async (record, save) => {
    await save({ ...record, expiresAt: Date.now() - 1 });
  });
  await store.purgeExpired();
  expect(await store.read(run.ownerId, run.runId)).toBeDefined();
  const pending = await store.pending();
  expect(pending.some((record) => record.runId === run.runId)).toBe(true);
  expect(pending.every((record) => record.active)).toBe(true);
  expect(pending.map((record) => record.updatedAt)).toEqual(
    pending.map((record) => record.updatedAt).sort((a, b) => a - b),
  );
  const [firstAttempt] = await store.pending(1);
  // No successful update follows this attempt, as on a transport failure.
  const [nextAttempt] = await otherStore.pending(1);
  expect(nextAttempt.runId).not.toBe(firstAttempt.runId);
});
