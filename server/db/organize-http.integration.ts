import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { createServer } from "node:http";
import { getRequestListener } from "@hono/node-server";
import { Pool } from "pg";
import { afterAll, afterEach, beforeAll, expect, it, vi } from "vite-plus/test";
import { reconcileOrganizerRuns } from "../../agents/organizer/maintenance.ts";
import { createApp } from "../app.ts";
import { createRequestAuthenticator } from "../auth.ts";
import { readCookie, sessionCookieName } from "../cookies.ts";
import {
  createDurableOrganizeRuns,
  ORGANIZE_METADATA_RETENTION_MS,
  type DurableOrganizer,
} from "../organize-runs.ts";
import { openDatabase, readTestDatabaseUrl } from "./connection.ts";
import { applyMigrations } from "./migrations.ts";
import { organizeStartResponseSchema } from "../../shared/organize.ts";
import { createNoteStore, noteTag } from "./notes.ts";
import { createOrganizeRunStore, MAX_ACTIVE_RUNS_PER_OWNER } from "./organize-runs.ts";
import { notes, organizeRuns } from "./schema.ts";

// Real HTTP, migrations and PostgreSQL. Identity verification and eve are synthetic;
// these tests do not claim WorkOS login or live model/provider verification.
const databaseName = `atlas_http_${randomUUID().replaceAll("-", "")}`;
const appOrigin = "https://atlas.example";
// The HTTPS origin above gives the browser session cookie its __Host- name.
const SESSION_COOKIE = sessionCookieName(true);
const runtimeUrl = "https://private-organizer.example";
const source = { title: "Private source", content: "Keep 42.", createdAt: "2026-11-01T00:00:00Z" };
const draft = { markdown: "# Organized\n\nKeep 42.", sources: [] };
const usage = { inputTokens: 21, outputTokens: 13, costUsd: 0.0004, complete: true };
let admin: Pool;
let connection: ReturnType<typeof openDatabase>;
let databaseUrl: string;
const shutdowns = new Set<() => Promise<void>>();
const extraConnections = new Set<ReturnType<typeof openDatabase>>();

beforeAll(async () => {
  const url = new URL(readTestDatabaseUrl(process.env));
  admin = new Pool({ connectionString: url.href });
  await admin.query(`CREATE DATABASE "${databaseName}"`);
  url.pathname = `/${databaseName}`;
  databaseUrl = url.href;
  connection = openDatabase(databaseUrl);
  await applyMigrations(connection.db);
});

afterEach(async () => {
  await Promise.all([...shutdowns].map((close) => close()));
  await Promise.all([...extraConnections].map((database) => database.close()));
  extraConnections.clear();
  await connection.db.delete(organizeRuns);
  await connection.db.delete(notes);
});

afterAll(async () => {
  await connection?.close();
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
  const stranger = randomUUID();
  const noteStore = createNoteStore(connection.db);
  const note = await noteStore.create(owner, source);
  const store = createOrganizeRunStore(connection.db);
  const clock = Date.now() + 60_000;
  let observation: Awaited<ReturnType<DurableOrganizer["inspect"]>> = {
    status: "running",
    phase: "writing",
  };
  let cleanupUnavailable = false;
  const runtime = {
    allocate: vi.fn<DurableOrganizer["allocate"]>(async ({ operationId }) => ({
      sessionId: `private-session-${operationId}`,
      deliveryId: null,
    })),
    submit: vi.fn<DurableOrganizer["submit"]>(async ({ sessionId, operationId }) => ({
      sessionId,
      deliveryId: `private-delivery-${operationId}`,
    })),
    inspect: vi.fn<DurableOrganizer["inspect"]>(async () => observation),
    retire: vi.fn<DurableOrganizer["retire"]>(async () => {
      if (cleanupUnavailable) throw new Error("Private provider token: secret-example");
      return { status: "ended" };
    }),
  };
  const manager = (db = connection.db) =>
    createDurableOrganizeRuns({
      store: createOrganizeRunStore(db),
      runtimeUrl,
      runtimeFor: () => runtime,
      resultRetentionMs: 60_000,
      now: () => clock,
    });
  const authenticate = createRequestAuthenticator(
    async (request) => {
      const token = request.headers.get("Authorization");
      if (token === "Bearer synthetic-owner") return { userId: owner };
      if (token === "Bearer synthetic-stranger") return { userId: stranger };
      return null;
    },
    async (request) =>
      readCookie(request.headers.get("Cookie"), SESSION_COOKIE) === "synthetic-owner"
        ? { userId: owner }
        : null,
  );
  const listen = async (backend = manager()) => {
    const app = createApp(authenticate, {
      appOrigin,
      organizer: backend,
    });
    const server = createServer(getRequestListener(app.fetch));
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Expected TCP listener");
    const origin = `http://127.0.0.1:${address.port}`;
    const close = async () => {
      if (!shutdowns.delete(close)) return;
      const closed = new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
      server.closeAllConnections();
      await closed;
    };
    shutdowns.add(close);
    const request = async (path: string, init: RequestInit = {}) => {
      const headers = new Headers(init.headers);
      if (path.endsWith("/organize") && !headers.has("If-Match"))
        headers.set("If-Match", noteTag(note.note.id, note.revision));
      if (!headers.has("Authorization")) headers.set("Authorization", "Bearer synthetic-owner");
      const response = await fetch(`${origin}/api${path}`, {
        ...init,
        headers,
      });
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      const body: unknown = await response.json();
      return { status: response.status, body };
    };
    return { origin, close, request };
  };
  const http = await listen();
  const start = async () => {
    const result = await http.request(`/notes/${note.note.id}/organize`, { method: "POST" });
    expect(result).toEqual({
      status: 202,
      body: { status: "accepted", runId: expect.any(String) },
    });
    if (!result.body || typeof result.body !== "object" || !("runId" in result.body))
      throw new Error("Expected run ID");
    return String(result.body.runId);
  };
  return {
    owner,
    note,
    noteStore,
    store,
    runtime,
    manager,
    clock,
    http,
    listen,
    start,
    observe: (next: typeof observation) => {
      observation = next;
    },
    failCleanup: (fail: boolean) => {
      cleanupUnavailable = fail;
    },
  };
}

it("enforces authentication, cookie origin and bodyless UUID routes before dispatch", async () => {
  const f = await fixture();
  const path = `/notes/${f.note.note.id}/organize`;
  const anonymous = await fetch(`${f.http.origin}/api${path}`, { method: "POST" });
  expect(anonymous.status).toBe(401);
  await anonymous.text();
  for (const origin of [undefined, "https://attacker.example"]) {
    const response = await fetch(`${f.http.origin}/api${path}`, {
      method: "POST",
      headers: {
        Cookie: `${SESSION_COOKIE}=synthetic-owner`,
        ...(origin ? { Origin: origin } : {}),
      },
    });
    expect(response.status).toBe(403);
    await response.text();
  }
  expect(
    (
      await f.http.request(path, {
        method: "POST",
        headers: {
          Authorization: "Bearer invalid",
          Cookie: `${SESSION_COOKIE}=synthetic-owner`,
        },
      })
    ).status,
  ).toBe(401);
  expect((await f.http.request("/notes/not-a-uuid/organize", { method: "POST" })).status).toBe(400);
  expect(
    (await f.http.request(path, { method: "POST", body: JSON.stringify({ ownerId: f.owner }) }))
      .status,
  ).toBe(400);
  expect(f.runtime.allocate).not.toHaveBeenCalled();
  expect(f.runtime.submit).not.toHaveBeenCalled();
  const accepted = await fetch(`${f.http.origin}/api${path}`, {
    method: "POST",
    headers: {
      Cookie: `${SESSION_COOKIE}=synthetic-owner`,
      Origin: appOrigin,
      "If-Match": noteTag(f.note.note.id, 1),
    },
  });
  expect(accepted.status).toBe(202);
  await accepted.text();
  expect(f.runtime.submit).toHaveBeenCalledOnce();
});

it("hides foreign and unknown notes and runs without invoking the runtime", async () => {
  const f = await fixture();
  const runId = await f.start();
  const counts = [f.runtime.allocate, f.runtime.submit, f.runtime.inspect, f.runtime.retire].map(
    (fn) => fn.mock.calls.length,
  );
  const headers = { Authorization: "Bearer synthetic-stranger" };
  for (const noteId of [f.note.note.id, randomUUID()]) {
    expect(
      (await f.http.request(`/notes/${noteId}/organize`, { method: "POST", headers })).status,
    ).toBe(404);
  }
  for (const id of [runId, randomUUID()]) {
    for (const [suffix, method] of [
      ["", "GET"],
      ["/cancel", "POST"],
      ["/acknowledge", "POST"],
    ]) {
      expect(
        (await f.http.request(`/organize-runs/${id}${suffix}`, { method, headers })).status,
      ).toBe(404);
    }
  }
  expect(
    [f.runtime.allocate, f.runtime.submit, f.runtime.inspect, f.runtime.retire].map(
      (fn) => fn.mock.calls.length,
    ),
  ).toEqual(counts);
});

it("coalesces simultaneous HTTP starts and reconnects through a new app and database pool", async () => {
  const f = await fixture();
  const starts = await Promise.all(Array.from({ length: 6 }, () => f.start()));
  expect(new Set(starts).size).toBe(1);
  const [runId] = starts;
  expect(f.runtime.allocate).toHaveBeenCalledOnce();
  expect(f.runtime.submit).toHaveBeenCalledOnce();
  expect(
    (await f.http.request(`/organize-runs/${runId}/acknowledge`, { method: "POST" })).status,
  ).toBe(409);
  await f.http.close();
  const freshConnection = openDatabase(databaseUrl);
  extraConnections.add(freshConnection);
  const resumed = await f.listen(f.manager(freshConnection.db));
  expect(await resumed.request(`/organize-runs/${runId}`)).toEqual({
    status: 200,
    body: { runId, status: "running", phase: "writing" },
  });
  expect(await resumed.request(`/notes/${f.note.note.id}/organize`, { method: "POST" })).toEqual({
    status: 202,
    body: { runId, status: "accepted" },
  });
  expect(f.runtime.submit).toHaveBeenCalledOnce();
});

it("caps one owner's active runs across notes under concurrent starts and frees a slot on cancel", async () => {
  const f = await fixture();
  const owned = [
    f.note,
    ...(await Promise.all(
      Array.from({ length: MAX_ACTIVE_RUNS_PER_OWNER }, () => f.noteStore.create(f.owner, source)),
    )),
  ];
  const organize = (note: (typeof owned)[number]) =>
    f.http.request(`/notes/${note.note.id}/organize`, {
      method: "POST",
      headers: { "If-Match": noteTag(note.note.id, note.revision) },
    });
  // Claims for different notes do not share a row lock; the owner lock must admit exactly the cap.
  const results = await Promise.all(owned.map(organize));
  expect(results.map((result) => result.status).toSorted((a, b) => a - b)).toEqual([
    ...Array<number>(MAX_ACTIVE_RUNS_PER_OWNER).fill(202),
    429,
  ]);
  const limited = results.findIndex((result) => result.status === 429);
  expect(results[limited].body).toEqual({
    error: { code: "RATE_LIMITED", message: expect.any(String) },
  });
  expect(f.runtime.allocate).toHaveBeenCalledTimes(MAX_ACTIVE_RUNS_PER_OWNER);
  const accepted = results.findIndex((result) => result.status === 202);
  const { runId } = organizeStartResponseSchema.parse(results[accepted].body);
  // At the cap, an owner can still reconnect to a run it already has.
  expect(await organize(owned[accepted])).toEqual({
    status: 202,
    body: { runId, status: "accepted" },
  });
  expect((await f.http.request(`/organize-runs/${runId}/cancel`, { method: "POST" })).status).toBe(
    200,
  );
  expect(await organize(owned[limited])).toEqual({
    status: 202,
    body: { runId: expect.any(String), status: "accepted" },
  });
});

it("returns stale drafts without overwriting notes and erases delivered content while retaining 48h accounting", async () => {
  const f = await fixture();
  const runId = await f.start();
  expect(
    await f.noteStore.update(f.owner, f.note.note.id, 1, {
      title: source.title,
      content: "Now keep 43.",
    }),
  ).toMatchObject({ status: "saved" });
  f.observe({ status: "draft", draft, usage });
  expect(await f.http.request(`/organize-runs/${runId}`)).toEqual({
    status: 200,
    body: {
      runId,
      status: "draft",
      draft,
      source: { noteId: f.note.note.id, revision: 1, stale: true },
    },
  });
  expect((await f.noteStore.read(f.owner, f.note.note.id))?.note.content).toBe("Now keep 43.");
  expect(await f.http.request(`/organize-runs/${runId}/acknowledge`, { method: "POST" })).toEqual({
    status: 200,
    body: { runId, status: "expired" },
  });
  expect(await f.store.read(f.owner, runId)).toMatchObject({
    active: false,
    input: null,
    runtime: null,
    cleanupTarget: null,
    state: { status: "expired" },
    usage,
    expiresAt: f.clock + ORGANIZE_METADATA_RETENTION_MS,
  });
  expect(ORGANIZE_METADATA_RETENTION_MS).toBe(48 * 60 * 60 * 1_000);
  expect(f.runtime.retire).toHaveBeenCalledOnce();
  expect(await f.http.request(`/organize-runs/${runId}/acknowledge`, { method: "POST" })).toEqual({
    status: 200,
    body: { runId, status: "expired" },
  });
  expect(f.runtime.retire).toHaveBeenCalledOnce();
});

it("keeps failed cancellation cleanup retryable on the same handle without another generation", async () => {
  const f = await fixture();
  const runId = await f.start();
  f.failCleanup(true);
  expect(await f.http.request(`/organize-runs/${runId}/cancel`, { method: "POST" })).toEqual({
    status: 202,
    body: { runId, status: "failed", reason: "cleanup_failed" },
  });
  expect(await f.http.request(`/notes/${f.note.note.id}/organize`, { method: "POST" })).toEqual({
    status: 202,
    body: { runId, status: "cleanup_pending" },
  });
  expect(await f.store.read(f.owner, runId)).toMatchObject({
    active: true,
    input: null,
    cleanupTarget: { status: "cancelled" },
  });
  f.failCleanup(false);
  expect(await f.http.request(`/organize-runs/${runId}/cancel`, { method: "POST" })).toEqual({
    status: 200,
    body: { runId, status: "cancelled" },
  });
  expect(f.runtime.submit).toHaveBeenCalledOnce();
  expect(await f.store.read(f.owner, runId)).toMatchObject({
    active: false,
    runtime: null,
    input: null,
  });
});

it("sanitizes transport exceptions and retries the committed operation rather than allocating again", async () => {
  const f = await fixture();
  f.runtime.submit.mockRejectedValueOnce(new Error("Private provider token: secret-example"));
  const response = await f.http.request(`/notes/${f.note.note.id}/organize`, { method: "POST" });
  expect(response.status).toBe(503);
  expect(JSON.stringify(response.body)).not.toContain("secret-example");
  expect(JSON.stringify(response.body)).not.toContain(runtimeUrl);
  const runId = await f.start();
  expect(f.runtime.allocate).toHaveBeenCalledOnce();
  expect(f.runtime.submit).toHaveBeenCalledTimes(2);
  expect(f.runtime.submit.mock.calls.map(([input]) => input.operationId)).toEqual([runId, runId]);
});

it("recovers a committed start after the HTTP client disconnects before receiving its handle", async () => {
  const f = await fixture();
  let release: () => void = () => {};
  const responseGate = new Promise<void>((resolve) => {
    release = resolve;
  });
  f.runtime.submit.mockImplementationOnce(async ({ operationId, sessionId }) => {
    await responseGate;
    return { sessionId, deliveryId: `private-delivery-${operationId}` };
  });
  const abort = new AbortController();
  const lostResponse = fetch(`${f.http.origin}/api/notes/${f.note.note.id}/organize`, {
    method: "POST",
    headers: {
      Authorization: "Bearer synthetic-owner",
      "If-Match": noteTag(f.note.note.id, 1),
    },
    signal: abort.signal,
  }).then(
    () => "unexpected response",
    (error: unknown) => (error instanceof Error ? error.name : "unknown failure"),
  );
  try {
    await vi.waitFor(() => expect(f.runtime.submit).toHaveBeenCalledOnce());
    const runId = f.runtime.submit.mock.calls[0][0].operationId;
    abort.abort();
    expect(await lostResponse).toBe("AbortError");
    release();
    await vi.waitFor(async () => {
      expect((await f.store.read(f.owner, runId))?.runtime?.deliveryId).toBe(
        `private-delivery-${runId}`,
      );
    });
    await f.http.close();
    const freshConnection = openDatabase(databaseUrl);
    extraConnections.add(freshConnection);
    const resumed = await f.listen(f.manager(freshConnection.db));
    expect(await resumed.request(`/notes/${f.note.note.id}/organize`, { method: "POST" })).toEqual({
      status: 202,
      body: { runId, status: "accepted" },
    });
    expect(f.runtime.allocate).toHaveBeenCalledOnce();
    expect(f.runtime.submit).toHaveBeenCalledOnce();
  } finally {
    abort.abort();
    release();
  }
});

const maintenanceEnvironment = () => ({
  ORGANIZER_MAINTENANCE_ENABLED: "true",
  DATABASE_URL: databaseUrl,
  ORGANIZER_RUNTIME_URL: runtimeUrl,
  ORGANIZER_SERVICE_TOKEN: "synthetic-maintenance-service-token",
});

it("leaves disabled maintenance inert even without valid database or service settings", async () => {
  await expect(reconcileOrganizerRuns({})).resolves.toBeUndefined();
  await expect(
    reconcileOrganizerRuns({
      ORGANIZER_MAINTENANCE_ENABLED: "false",
      DATABASE_URL: "invalid",
      ORGANIZER_SERVICE_TOKEN: "short",
    }),
  ).resolves.toBeUndefined();
});

it("runs maintenance through its environment and backend to purge only expired terminal metadata", async () => {
  const expiredId = randomUUID();
  const retainedId = randomUUID();
  const now = Date.now();
  await connection.db.insert(organizeRuns).values(
    [expiredId, retainedId].map((id) => ({
      id,
      ownerId: "synthetic-maintenance-owner",
      noteId: randomUUID(),
      sourceRevision: 1,
      runtimeUrl,
      state: { status: "expired" as const },
      active: false,
      usage,
      expiresAt: new Date(now + (id === expiredId ? -60_000 : 60_000)).toISOString(),
    })),
  );
  const transport = vi
    .spyOn(globalThis, "fetch")
    .mockRejectedValue(new Error("Unexpected maintenance dispatch"));
  try {
    expect(await reconcileOrganizerRuns(maintenanceEnvironment())).toEqual({
      checked: 0,
      retryPending: 0,
    });
    expect(await connection.db.select({ id: organizeRuns.id }).from(organizeRuns)).toEqual([
      { id: retainedId },
    ]);
    expect(transport).not.toHaveBeenCalled();
  } finally {
    transport.mockRestore();
  }
});

it("finishes persisted maintenance cleanup after a crash without dispatching an unstarted run", async () => {
  const owner = randomUUID();
  const note = await createNoteStore(connection.db).create(owner, source);
  const store = createOrganizeRunStore(connection.db);
  const run = await store.claim(owner, note.note.id, runtimeUrl);
  if (!run) throw new Error("Expected owned run");
  // Crash after cleanup intent commits, before the scheduled worker finalizes it.
  await store.withRun(owner, run.runId, async (record, save) => {
    await save({
      ...record,
      input: null,
      state: { status: "cleaning" },
      cleanupTarget: { status: "expired" },
    });
  });
  const transport = vi
    .spyOn(globalThis, "fetch")
    .mockRejectedValue(new Error("Unexpected maintenance dispatch"));
  const before = Date.now();
  try {
    expect(await reconcileOrganizerRuns(maintenanceEnvironment())).toEqual({
      checked: 1,
      retryPending: 0,
    });
    const retired = await store.read(owner, run.runId);
    expect(retired).toMatchObject({
      active: false,
      input: null,
      runtime: null,
      cleanupTarget: null,
      state: { status: "expired" },
    });
    expect(retired?.expiresAt).toBeGreaterThanOrEqual(before + ORGANIZE_METADATA_RETENTION_MS);
    expect(retired?.expiresAt).toBeLessThanOrEqual(Date.now() + ORGANIZE_METADATA_RETENTION_MS);
    expect(transport).not.toHaveBeenCalled();
  } finally {
    transport.mockRestore();
  }
});
