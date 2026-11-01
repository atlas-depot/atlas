import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { Pool } from "pg";
import { afterAll, afterEach, beforeAll, expect, it } from "vite-plus/test";
import { createDurableOrganizeRuns, type DurableOrganizer } from "../organize-runs.ts";
import { openDatabase, readTestDatabaseUrl } from "./connection.ts";
import { applyMigrations } from "./migrations.ts";
import { createNoteStore } from "./notes.ts";
import { createOrganizeRunStore } from "./organize-runs.ts";
import { notes, organizeRuns } from "./schema.ts";

const databaseName = `atlas_runs_${randomUUID().replaceAll("-", "")}`;
const origin = "https://organizer-revision-one.example";
const noteInput = { title: "Source", content: "Keep 42.", createdAt: "2026-11-01T00:00:00Z" };
let admin: Pool;
let connection: ReturnType<typeof openDatabase>;
let otherConnection: ReturnType<typeof openDatabase>;
let databaseUrl: string;

beforeAll(async () => {
  const url = new URL(readTestDatabaseUrl(process.env));
  admin = new Pool({ connectionString: url.href });
  await admin.query(`CREATE DATABASE "${databaseName}"`);
  url.pathname = `/${databaseName}`;
  databaseUrl = url.href;
  connection = openDatabase(databaseUrl);
  otherConnection = openDatabase(databaseUrl);
  await applyMigrations(connection.db);
});
afterEach(async () => {
  await connection.db.delete(organizeRuns);
  await connection.db.delete(notes);
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

async function fixture() {
  const owner = randomUUID();
  const noteStore = createNoteStore(connection.db);
  const note = await noteStore.create(owner, noteInput);
  const store = createOrganizeRunStore(connection.db);
  let clock = Date.now() + 60_000;
  let acceptedResponseLost = false;
  let cleanupResponseLost = false;
  let cleanupUnavailable = false;
  let duringInspection: (() => Promise<void>) | undefined;
  let observation: Awaited<ReturnType<DurableOrganizer["inspect"]>> = {
    status: "running",
    phase: "writing",
  };
  const submissions: string[] = [];
  const allocations: string[] = [];
  const payloads: unknown[] = [];
  const destinations: string[] = [];
  const sessions = new Map<string, { sessionId: string; deliveryId: string | null }>();
  const retired = new Set<string>();
  let inspections = 0;
  const runtime: DurableOrganizer = {
    async allocate({ operationId }) {
      allocations.push(operationId);
      let ref = sessions.get(operationId);
      if (!ref) {
        ref = { sessionId: `session-${operationId}`, deliveryId: null };
        sessions.set(operationId, ref);
      }
      return { sessionId: ref.sessionId, deliveryId: null };
    },
    async submit({ sessionId, operationId, note: input }) {
      // A different connection must see the empty session before any model turn is sent.
      const committed = await createOrganizeRunStore(otherConnection.db).read(owner, operationId);
      expect(committed?.runtime?.sessionId).toBe(sessionId);
      submissions.push(operationId);
      payloads.push(input);
      if (retired.has(sessionId)) return { status: "expired" };
      const ref = { sessionId, deliveryId: `delivery-${operationId}` };
      sessions.set(operationId, ref);
      if (acceptedResponseLost) {
        acceptedResponseLost = false;
        throw new Error("Lost acceptance response");
      }
      return ref;
    },
    async inspect() {
      inspections += 1;
      const change = duringInspection;
      duringInspection = undefined;
      await change?.();
      return observation;
    },
    async retire(ref) {
      if (cleanupUnavailable) throw new Error("Temporary cleanup outage");
      const wasRetired = retired.has(ref.sessionId);
      retired.add(ref.sessionId);
      if (cleanupResponseLost) {
        cleanupResponseLost = false;
        throw new Error("Lost retirement receipt");
      }
      return { status: wasRetired ? "expired" : "ended" };
    },
  };
  const manager = (db = connection.db, runtimeUrl = origin) =>
    createDurableOrganizeRuns({
      store: createOrganizeRunStore(db),
      runtimeUrl,
      runtimeFor: (url) => {
        destinations.push(url);
        return runtime;
      },
      resultRetentionMs: 1_000,
      now: () => clock,
    });
  const start = async (backend = manager()) => {
    const result = await backend.start(owner, note.note.id);
    if (!("runId" in result)) throw new Error("Expected owned run");
    return result.runId;
  };
  return {
    owner,
    note,
    noteStore,
    store,
    manager,
    start,
    submissions,
    allocations,
    payloads,
    sessions,
    retired,
    destinations,
    inspections: () => inspections,
    duringInspection: (change: () => Promise<void>) => {
      duringInspection = change;
    },
    loseAcceptance: () => {
      acceptedResponseLost = true;
    },
    loseCleanup: () => {
      cleanupResponseLost = true;
    },
    failCleanup: (fail: boolean) => {
      cleanupUnavailable = fail;
    },
    advance: (ms: number) => {
      clock += ms;
    },
    complete: () => {
      observation = {
        status: "draft",
        draft: { markdown: "# Organized\nKeep 42.", sources: [] },
        completedAt: clock,
      };
    },
  };
}

it("coalesces concurrent starts across API pools and reconnects to the same draft", async () => {
  const f = await fixture();
  const [first, second] = await Promise.all([f.start(), f.start(f.manager(otherConnection.db))]);
  expect(first).toBe(second);
  expect(f.submissions).toEqual([first]);
  f.complete();
  const draft = await f.manager(otherConnection.db).read(f.owner, first);
  expect(draft).toEqual({
    status: "draft",
    draft: { markdown: "# Organized\nKeep 42.", sources: [] },
    source: { noteId: f.note.note.id, revision: 1, stale: false },
  });
  expect(await f.manager().read(f.owner, first)).toEqual(draft);
  expect(f.inspections()).toBe(1);
  expect(await f.noteStore.read(f.owner, f.note.note.id)).toEqual(f.note);
});

it("reads five simultaneous runs without exhausting its five-connection pool", async () => {
  const f = await fixture();
  const backend = f.manager();
  const created = await Promise.all(
    Array.from({ length: 5 }, () => f.noteStore.create(f.owner, noteInput)),
  );
  const runs = await Promise.all(created.map((note) => backend.start(f.owner, note.note.id)));
  f.complete();
  const results = await Promise.all(
    runs.map((run) => {
      if (!("runId" in run)) throw new Error("Expected owned run");
      return backend.read(f.owner, run.runId);
    }),
  );
  expect(results.map((result) => result.status)).toEqual(Array(5).fill("draft"));
});

it.each(["edit", "delete"] as const)(
  "rechecks source %s after inspecting the runtime",
  async (change) => {
    const f = await fixture();
    const runId = await f.start();
    const competingNotes = createNoteStore(otherConnection.db);
    f.complete();
    f.duringInspection(async () => {
      if (change === "edit") {
        const result = await competingNotes.update(f.owner, f.note.note.id, 1, {
          title: "Concurrent edit",
          content: "Keep the user's newer source.",
        });
        expect(result.status).toBe("saved");
      } else {
        expect(await competingNotes.delete(f.owner, f.note.note.id, 1)).toEqual({
          status: "deleted",
        });
      }
    });
    const result = await f.manager().read(f.owner, runId);
    if (change === "edit") {
      expect(result).toMatchObject({ status: "draft", source: { revision: 1, stale: true } });
      expect(await competingNotes.read(f.owner, f.note.note.id)).toMatchObject({
        revision: 2,
        note: { title: "Concurrent edit", content: "Keep the user's newer source." },
      });
      expect(f.retired.size).toBe(0);
    } else {
      expect(result).toEqual({ status: "not_found" });
      expect(f.retired).toEqual(new Set([`session-${runId}`]));
      expect(await competingNotes.read(f.owner, f.note.note.id)).toBeUndefined();
    }
  },
);

it("recovers a lost acceptance with the same payload and pinned deployment after restart", async () => {
  const f = await fixture();
  f.loseAcceptance();
  await expect(f.start()).rejects.toThrow("Lost acceptance response");
  await f.noteStore.update(f.owner, f.note.note.id, 1, { title: "Changed", content: "New source" });
  const runId = await f.start(
    f.manager(otherConnection.db, "https://organizer-revision-two.example"),
  );
  expect(f.submissions).toEqual([runId, runId]);
  expect(f.sessions.size).toBe(1);
  expect(f.allocations).toEqual([runId]);
  expect(f.payloads).toEqual([
    { title: "Source", content: "Keep 42." },
    { title: "Source", content: "Keep 42." },
  ]);
  expect(new Set(f.destinations)).toEqual(new Set([origin]));
  f.complete();
  expect(await f.manager().read(f.owner, runId)).toMatchObject({
    status: "draft",
    source: { revision: 1, stale: true },
  });
});

it("never replaces an expired known session after an uncertain model submission", async () => {
  const f = await fixture();
  f.loseAcceptance();
  await expect(f.start()).rejects.toThrow("Lost acceptance response");
  const runId = f.submissions[0];
  const persisted = await f.store.read(f.owner, runId);
  expect(persisted?.runtime).toEqual({ sessionId: `session-${runId}`, deliveryId: null });
  f.retired.add(`session-${runId}`);
  expect(await f.manager(otherConnection.db).read(f.owner, runId)).toEqual({ status: "expired" });
  expect(await f.store.read(f.owner, runId)).toMatchObject({
    active: false,
    input: null,
    runtime: null,
    cleanupTarget: null,
  });
  expect(f.allocations).toEqual([runId]);
  expect(f.submissions).toEqual([runId, runId]);
});

it.each(["read", "sweep"] as const)(
  "%s never starts a pending run after source deletion",
  async (action) => {
    const f = await fixture();
    const pending = await f.store.claim(f.owner, f.note.note.id, origin);
    if (!pending) throw new Error("Expected owned pending handle");
    await f.noteStore.delete(f.owner, f.note.note.id, 1);
    const recovered = f.manager(otherConnection.db);
    if (action === "sweep")
      expect(await recovered.sweep()).toEqual({ checked: 1, retryPending: 0 });
    expect(await recovered.read(f.owner, pending.runId)).toEqual({ status: "not_found" });
    expect(f.allocations).toHaveLength(0);
    expect(f.submissions).toHaveLength(0);
    expect(f.inspections()).toBe(0);
    expect(await f.store.read(f.owner, pending.runId)).toMatchObject({
      active: false,
      input: null,
      runtime: null,
    });
  },
);

it("only retires the known session when a deleted source has an uncertain submission", async () => {
  const f = await fixture();
  f.loseAcceptance();
  await expect(f.start()).rejects.toThrow("Lost acceptance response");
  const runId = f.submissions[0];
  await f.noteStore.delete(f.owner, f.note.note.id, 1);
  expect(await f.manager(otherConnection.db).read(f.owner, runId)).toEqual({ status: "not_found" });
  expect(f.allocations).toEqual([runId]);
  expect(f.submissions).toEqual([runId]);
  expect(f.retired).toEqual(new Set([`session-${runId}`]));
  expect(f.inspections()).toBe(0);
  expect(await f.store.read(f.owner, runId)).toMatchObject({
    active: false,
    input: null,
    runtime: null,
  });
});

it("cancels an allocated database handle without starting remote work", async () => {
  const f = await fixture();
  const pending = await f.store.claim(f.owner, f.note.note.id, origin);
  if (!pending) throw new Error("Expected owned pending handle");
  expect(await f.manager().cancel(f.owner, pending.runId)).toEqual({ status: "cancelled" });
  expect(f.allocations).toHaveLength(0);
  expect(f.submissions).toHaveLength(0);
  expect(await f.store.read(f.owner, pending.runId)).toMatchObject({
    active: false,
    input: null,
    runtime: null,
  });
});

it("never discloses or mutates another owner's run or invokes the provider for it", async () => {
  const f = await fixture();
  const runId = await f.start();
  const other = f.manager(otherConnection.db);
  expect(await other.start("intruder", f.note.note.id)).toEqual({ status: "not_found" });
  expect(await other.read("intruder", runId)).toEqual({ status: "not_found" });
  expect(await other.cancel("intruder", runId)).toEqual({ status: "not_found" });
  expect(await other.acknowledge("intruder", runId)).toEqual({ status: "not_found" });
  expect(f.submissions).toEqual([runId]);
  expect(f.inspections()).toBe(0);
  expect(f.retired.size).toBe(0);
});

it("persists cleanup failure without content and retries after API replacement", async () => {
  const f = await fixture();
  const runId = await f.start();
  f.complete();
  await f.manager().read(f.owner, runId);
  f.failCleanup(true);
  expect(await f.manager().acknowledge(f.owner, runId)).toEqual({
    status: "failed",
    reason: "cleanup_failed",
  });
  const pending = await f.store.read(f.owner, runId);
  expect(pending).toMatchObject({
    active: true,
    input: null,
    state: { status: "failed", reason: "cleanup_failed" },
    cleanupTarget: { status: "expired" },
  });
  expect(pending?.runtime).not.toBeNull();
  expect(await f.start(f.manager(otherConnection.db))).toBe(runId);
  f.failCleanup(false);
  expect(await f.manager(otherConnection.db).acknowledge(f.owner, runId)).toEqual({
    status: "expired",
  });
  expect(await f.store.read(f.owner, runId)).toMatchObject({
    active: false,
    runtime: null,
    input: null,
    cleanupTarget: null,
  });
  expect(f.submissions).toEqual([runId]);
});

it("does not recreate a session when its successful retirement receipt was lost", async () => {
  const f = await fixture();
  const runId = await f.start();
  f.loseCleanup();
  expect(await f.manager().cancel(f.owner, runId)).toEqual({
    status: "failed",
    reason: "cleanup_failed",
  });
  expect(f.retired.size).toBe(1);
  expect(await f.manager(otherConnection.db).cancel(f.owner, runId)).toEqual({
    status: "cancelled",
  });
  f.complete();
  expect(await f.manager().read(f.owner, runId)).toEqual({ status: "cancelled" });
  expect(await f.manager().acknowledge(f.owner, runId)).toEqual({ status: "cancelled" });
  expect(f.submissions).toEqual([runId]);
  expect(f.inspections()).toBe(0);
});

it("expires unobserved output from completion time and sweeps without a browser", async () => {
  const f = await fixture();
  const runId = await f.start();
  f.complete();
  f.advance(1_001);
  expect(await f.manager(otherConnection.db).sweep()).toEqual({ checked: 1, retryPending: 0 });
  expect(await f.manager().read(f.owner, runId)).toEqual({ status: "expired" });
  expect(f.retired.size).toBe(1);
  expect(await f.store.read(f.owner, runId)).toMatchObject({
    active: false,
    input: null,
    runtime: null,
  });
});

it("keeps enough runtime identity to clean up when the source note is deleted", async () => {
  const f = await fixture();
  const runId = await f.start();
  await f.noteStore.delete(f.owner, f.note.note.id, 1);
  f.complete();
  expect(await f.manager(otherConnection.db).read(f.owner, runId)).toEqual({ status: "not_found" });
  expect(f.retired.size).toBe(1);
  expect(f.inspections()).toBe(0);
});

it("recovers a completed draft after the writer process exits", async () => {
  const f = await fixture();
  const result = await promisify(execFile)(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      `
    import { openDatabase } from './server/db/connection.ts';
    import { createOrganizeRunStore } from './server/db/organize-runs.ts';
    import { createDurableOrganizeRuns } from './server/organize-runs.ts';
    const db = openDatabase(process.env.DATABASE_URL);
    try {
      const runs = createDurableOrganizeRuns({
        store: createOrganizeRunStore(db.db), runtimeUrl: '${origin}',
        resultRetentionMs: 600_000,
        runtimeFor: () => ({
          allocate: async () => ({sessionId: 'child-session', deliveryId: null}),
          submit: async () => ({sessionId: 'child-session', deliveryId: 'child-delivery'}),
          inspect: async () => ({status:'draft',draft:{markdown:'Persisted child result',sources:[]},completedAt:Date.now()}),
          retire: async () => ({status:'ended'})
        })
      });
      const {runId} = await runs.start(process.env.OWNER, process.env.NOTE_ID);
      await runs.read(process.env.OWNER, runId);
      console.log(runId);
    } finally { await db.close(); }
  `,
    ],
    {
      env: {
        PATH: process.env.PATH,
        DATABASE_URL: databaseUrl,
        OWNER: f.owner,
        NOTE_ID: f.note.note.id,
      },
      timeout: 15_000,
    },
  );
  const runId = result.stdout.trim();
  expect(await f.manager(otherConnection.db).read(f.owner, runId)).toMatchObject({
    status: "draft",
    draft: { markdown: "Persisted child result" },
    source: { revision: 1, stale: false },
  });
  expect(f.submissions).toHaveLength(0);
  expect(f.inspections()).toBe(0);
});
