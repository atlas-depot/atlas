import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import { setTimeout as delay } from "node:timers/promises";
import { Pool } from "pg";
import { afterAll, afterEach, beforeAll, expect, it } from "vite-plus/test";
import { createOrganizerBackend } from "../../agents/organizer/backend.ts";
import { createDurableOrganizeRuns, type DurableOrganizer } from "../organize-runs.ts";
import { openDatabase, readTestDatabaseUrl } from "./connection.ts";
import { applyMigrations } from "./migrations.ts";
import { createNoteStore } from "./notes.ts";
import { createOrganizeRunStore } from "./organize-runs.ts";
import { notes, organizeRuns } from "./schema.ts";

const databaseName = `atlas_pool_${randomUUID().replaceAll("-", "")}`;
const input = { title: "Source", content: "Keep 42.", createdAt: "2026-11-01T00:00:00Z" };
let admin: Pool;
let noteConnection: ReturnType<typeof openDatabase>;
let databaseUrl: string;

beforeAll(async () => {
  const url = new URL(readTestDatabaseUrl(process.env));
  admin = new Pool({ connectionString: url.href });
  await admin.query(`CREATE DATABASE "${databaseName}"`);
  url.pathname = `/${databaseName}`;
  databaseUrl = url.href;
  noteConnection = openDatabase(databaseUrl);
  await applyMigrations(noteConnection.db);
});

afterEach(async () => {
  await noteConnection.db.delete(organizeRuns);
  await noteConnection.db.delete(notes);
});

afterAll(async () => {
  await noteConnection?.close();
  if (admin) {
    try {
      await admin.query(`DROP DATABASE IF EXISTS "${databaseName}"`);
    } finally {
      await admin.end();
    }
  }
});

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function bounded<T>(work: Promise<T>, milliseconds = 2_000): Promise<T> {
  const timer = new AbortController();
  try {
    return await Promise.race([
      work,
      delay(milliseconds, undefined, { signal: timer.signal }).then(() => {
        throw new Error("Operation did not complete while runtime requests were held.");
      }),
    ]);
  } finally {
    timer.abort();
  }
}

async function listen(server: Server) {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return `http://127.0.0.1:${address.port}`;
}

it("keeps note CRUD available with two held runtime calls and three queued organizer requests", async () => {
  const owner = randomUUID();
  const store = createNoteStore(noteConnection.db);
  const prepared = await Promise.all(Array.from({ length: 5 }, () => store.create(owner, input)));
  const entered = new Set<string>();
  const bothEntered = deferred();
  const release = deferred();
  let released = false;
  let backend: ReturnType<typeof createOrganizerBackend> | undefined;
  const starts: Promise<unknown>[] = [];
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString()) as {
      operationId?: string;
      idempotencyKey?: string;
    };
    response.setHeader("content-type", "application/json");
    if (request.url === "/eve/v1/session") {
      assert.ok(body.operationId);
      entered.add(body.operationId);
      if (entered.size === 2) bothEntered.resolve();
      await release.promise;
      response.writeHead(202).end(JSON.stringify({ sessionId: `session-${body.operationId}` }));
    } else {
      assert.ok(body.idempotencyKey);
      response.writeHead(202).end(
        JSON.stringify({
          sessionId: `session-${body.idempotencyKey}`,
          deliveryId: `delivery-${body.idempotencyKey}`,
        }),
      );
    }
  });
  try {
    backend = createOrganizerBackend({
      connectionString: databaseUrl,
      runtimeUrl: await listen(server),
      serviceToken: "synthetic-service-token-at-least-32-characters",
      resultRetentionMs: 900_000,
    });
    starts.push(
      backend.start(owner, prepared[0].note.id),
      backend.start(owner, prepared[1].note.id),
    );
    await bounded(bothEntered.promise);
    starts.push(...prepared.slice(2).map((note) => backend!.start(owner, note.note.id)));
    const note = prepared[4];
    const updated = await bounded(
      store.update(owner, note.note.id, note.revision, {
        title: "Edited while runtime is unavailable",
        content: "The note API still serves writes.",
      }),
    );
    expect(updated.status).toBe("saved");
    const saved = await bounded(store.read(owner, note.note.id));
    expect(saved?.note.content).toBe("The note API still serves writes.");
    expect((await bounded(store.list(owner))).length).toBe(5);
    expect(released).toBe(false);
    expect(entered.size).toBe(2);
    released = true;
    release.resolve();
    const results = await Promise.all(starts);
    expect(results).toHaveLength(5);
    expect(entered.size).toBe(5);
  } finally {
    release.resolve();
    await Promise.allSettled(starts);
    await backend?.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

it("bounds a cancellation lock wait and allows retry after the in-flight transport releases", async () => {
  const owner = randomUUID();
  const note = await createNoteStore(noteConnection.db).create(owner, input);
  // Short fixture timeout, same PostgreSQL lock_timeout mechanism as the backend's 5 seconds.
  const organizerConnection = openDatabase(databaseUrl, { max: 2, lockTimeoutMs: 100 });
  const store = createOrganizeRunStore(organizerConnection.db);
  const entered = deferred();
  const release = deferred();
  let retired = 0;
  const runtime: DurableOrganizer = {
    async allocate({ operationId }) {
      return { sessionId: operationId, deliveryId: null };
    },
    async submit({ sessionId, operationId }) {
      return { sessionId, deliveryId: operationId };
    },
    async inspect() {
      entered.resolve();
      await release.promise;
      return { status: "running", phase: "writing" };
    },
    async retire() {
      retired += 1;
      return { status: "ended" };
    },
  };
  const backend = createDurableOrganizeRuns({
    store,
    runtimeUrl: "https://synthetic-runtime.example",
    runtimeFor: () => runtime,
    resultRetentionMs: 900_000,
  });
  let reading: Promise<unknown> | undefined;
  try {
    const result = await backend.start(owner, note.note.id);
    assert.ok("runId" in result);
    reading = backend.read(owner, result.runId);
    await bounded(entered.promise);
    await expect(bounded(backend.cancel(owner, result.runId))).rejects.toMatchObject({
      cause: { code: "55P03" },
    });
    expect(retired).toBe(0);
    release.resolve();
    await reading;
    expect(await backend.cancel(owner, result.runId)).toEqual({ status: "cancelled" });
    expect(retired).toBe(1);
    const record = await store.read(owner, result.runId);
    expect(record?.active).toBe(false);
    expect(record?.runtime).toBeNull();
  } finally {
    release.resolve();
    await reading;
    await organizerConnection.close();
  }
});
