import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { createServer } from "node:http";
import { getRequestListener } from "@hono/node-server";
import { Pool } from "pg";
import { afterAll, afterEach, beforeAll, expect, it } from "vite-plus/test";
import { noteListSchema, noteSchema } from "../../shared/notes.ts";
import { createApp } from "../app.ts";
import { createRequestAuthenticator } from "../auth.ts";
import { readCookie, SESSION_COOKIE_NAME } from "../cookies.ts";
import { openDatabase, readTestDatabaseUrl } from "./connection.ts";
import { applyMigrations } from "./migrations.ts";
import { createNoteStore } from "./notes.ts";
import { noteCreateRequests, notes } from "./schema.ts";

// Actual TCP HTTP and migrated PostgreSQL; identity is synthetic, not live WorkOS.
const databaseName = `atlas_notes_http_${randomUUID().replaceAll("-", "")}`;
const appOrigin = "https://atlas.example";
const source = {
  title: "  Source  ",
  content: "# Private Markdown\n",
  createdAt: "2026-10-30T10:00:00.000Z",
};
let admin: Pool;
let connection: ReturnType<typeof openDatabase>;
let databaseUrl: string;
const shutdowns = new Set<() => Promise<void>>();
const extraConnections = new Set<ReturnType<typeof openDatabase>>();

beforeAll(async () => {
  const url = new URL(readTestDatabaseUrl(process.env));
  admin = new Pool({ connectionString: url.href, connectionTimeoutMillis: 10_000 });
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
  if (connection) {
    await connection.db.delete(noteCreateRequests);
    await connection.db.delete(notes);
  }
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

function extraConnection() {
  const database = openDatabase(databaseUrl);
  extraConnections.add(database);
  return database;
}

async function fixture() {
  const owner = randomUUID();
  const stranger = randomUUID();
  const authenticate = createRequestAuthenticator(
    async (request) => {
      const token = request.headers.get("Authorization");
      if (token === "Bearer synthetic-owner") return { userId: owner };
      if (token === "Bearer synthetic-stranger") return { userId: stranger };
      return null;
    },
    async (request) =>
      readCookie(request.headers.get("Cookie"), SESSION_COOKIE_NAME) === "synthetic-owner"
        ? { userId: owner }
        : null,
  );
  const listen = async (
    database = connection,
    afterResponse?: (request: Request) => Promise<void>,
  ) => {
    const app = createApp(authenticate, { notes: createNoteStore(database.db), appOrigin });
    const server = createServer(
      getRequestListener(async (request) => {
        const response = await app.fetch(request);
        await afterResponse?.(request);
        return response;
      }),
    );
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
      if (!headers.has("Authorization")) headers.set("Authorization", "Bearer synthetic-owner");
      const response = await fetch(`${origin}/api${path}`, { ...init, headers });
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      return response;
    };
    return { origin, close, request };
  };
  const http = await listen();
  const create = async (key = randomUUID()) => {
    const response = await http.request("/notes", json("POST", source, { "Idempotency-Key": key }));
    expect(response.status).toBe(201);
    return {
      note: noteSchema.parse(await response.json()),
      tag: response.headers.get("ETag")!,
      key,
    };
  };
  return { owner, stranger, http, listen, create };
}

function json(method: string, body: unknown, headers: Record<string, string> = {}): RequestInit {
  return {
    method,
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  };
}

it("persists CRUD across a new app/pool with immutable creation time and revision ETags", async () => {
  const f = await fixture();
  const created = await f.create();
  expect(created.note).toEqual({ ...source, id: expect.any(String), updatedAt: source.createdAt });
  expect(created.tag).toBe(`"${created.note.id}:1"`);
  const update = await f.http.request(
    `/notes/${created.note.id}`,
    json("PUT", { title: "Edited", content: "# New source" }, { "If-Match": created.tag }),
  );
  expect(update.status).toBe(200);
  const updated = noteSchema.parse(await update.json());
  const updatedTag = update.headers.get("ETag")!;
  expect(updatedTag).toBe(`"${created.note.id}:2"`);
  expect(updated).toMatchObject({
    id: created.note.id,
    title: "Edited",
    content: "# New source",
    createdAt: source.createdAt,
  });
  expect(Date.parse(updated.updatedAt)).toBeGreaterThan(Date.parse(source.createdAt));
  await f.http.close();
  const reloaded = await f.listen(extraConnection());
  const read = await reloaded.request(`/notes/${created.note.id}`);
  expect(read.headers.get("ETag")).toBe(updatedTag);
  expect(await read.json()).toEqual(updated);
  expect(noteListSchema.parse(await (await reloaded.request("/notes")).json()).notes).toEqual([
    updated,
  ]);
  const removed = await reloaded.request(`/notes/${created.note.id}`, {
    method: "DELETE",
    headers: { "If-Match": updatedTag },
  });
  expect(removed.status).toBe(204);
  expect(await removed.text()).toBe("");
  expect((await reloaded.request(`/notes/${created.note.id}`)).status).toBe(404);
  expect(noteListSchema.parse(await (await reloaded.request("/notes")).json()).notes).toEqual([]);
});

it("rejects missing/stale preconditions and permits only one concurrent update", async () => {
  const f = await fixture();
  const created = await f.create();
  const path = `/notes/${created.note.id}`;
  for (const method of ["PUT", "DELETE"]) {
    const body =
      method === "PUT" ? json(method, { title: "Changed", content: "Changed" }) : { method };
    const missing = await f.http.request(path, body);
    expect(missing.status).toBe(428);
    await missing.text();
    const stale = await f.http.request(path, {
      ...body,
      headers: { "If-Match": `"${created.note.id}:0"` },
    });
    expect(stale.status).toBe(412);
    await stale.text();
  }
  const writes = await Promise.all(
    ["First", "Second"].map((title) =>
      f.http.request(path, json("PUT", { title, content: title }, { "If-Match": created.tag })),
    ),
  );
  expect(writes.map((response) => response.status).sort((left, right) => left - right)).toEqual([
    200, 412,
  ]);
  for (const response of writes) await response.text();
  const persisted = await createNoteStore(connection.db).read(f.owner, created.note.id);
  expect(persisted?.revision).toBe(2);
  expect(["First", "Second"]).toContain(persisted?.note.title);
});

it("enforces ownership, anonymous access and cookie origin through the production app", async () => {
  const f = await fixture();
  const created = await f.create();
  for (const method of ["GET", "PUT", "DELETE"]) {
    const body =
      method === "PUT" ? json(method, { title: "stolen", content: "stolen" }) : { method };
    const headers = { Authorization: "Bearer synthetic-stranger", "If-Match": created.tag };
    const foreign = await f.http.request(`/notes/${created.note.id}`, { ...body, headers });
    const absent = await f.http.request(`/notes/${randomUUID()}`, { ...body, headers });
    expect(foreign.status).toBe(404);
    expect(absent.status).toBe(404);
    expect(await foreign.json()).toEqual(await absent.json());
  }
  const anonymous = await fetch(`${f.http.origin}/api/notes`);
  expect(anonymous.status).toBe(401);
  await anonymous.text();
  const listing = await f.http.request("/notes", {
    headers: { Authorization: "Bearer synthetic-stranger" },
  });
  expect(await listing.json()).toEqual({ notes: [] });
  const blocked = await fetch(`${f.http.origin}/api/notes/${created.note.id}`, {
    ...json("PUT", { title: "forged", content: "forged" }),
    headers: {
      Cookie: `${SESSION_COOKIE_NAME}=synthetic-owner`,
      Origin: "https://attacker.example",
      "If-Match": created.tag,
    },
  });
  expect(blocked.status).toBe(403);
  await blocked.text();
  expect((await createNoteStore(connection.db).read(f.owner, created.note.id))?.revision).toBe(1);
});

it("rejects invalid creation/update payloads and missing creation keys without persisting writes", async () => {
  const f = await fixture();
  for (const body of [
    { ...source, ownerId: f.stranger },
    { ...source, content: "x".repeat(100_001) },
  ]) {
    const response = await f.http.request(
      "/notes",
      json("POST", body, { "Idempotency-Key": randomUUID() }),
    );
    expect(response.status).toBe(400);
    await response.text();
  }
  const missingKey = await f.http.request("/notes", json("POST", source));
  expect(missingKey.status).toBe(400);
  await missingKey.text();
  expect(await createNoteStore(connection.db).list(f.owner)).toEqual([]);
  const created = await f.create();
  const immutable = await f.http.request(
    `/notes/${created.note.id}`,
    json("PUT", source, { "If-Match": created.tag }),
  );
  expect(immutable.status).toBe(400);
  await immutable.text();
  const bodyfulDelete = await f.http.request(
    `/notes/${created.note.id}`,
    json("DELETE", {}, { "If-Match": created.tag }),
  );
  expect(bodyfulDelete.status).toBe(400);
  await bodyfulDelete.text();
  expect((await createNoteStore(connection.db).read(f.owner, created.note.id))?.revision).toBe(1);
});

it.each([
  ["title", "high surrogate", "\ud800"],
  ["title", "low surrogate", "\udc00"],
  ["title", "NUL", "\u0000"],
  ["content", "high surrogate", "\ud800"],
  ["content", "low surrogate", "\udc00"],
  ["content", "NUL", "\u0000"],
])(
  "rejects %s containing %s before PostgreSQL writes or key reservation",
  async (field, _label, text) => {
    const f = await fixture();
    const created = await f.create();
    const store = createNoteStore(connection.db);
    const receipts = await connection.db.select().from(noteCreateRequests);
    const key = randomUUID();
    const invalidCreate = await f.http.request(
      "/notes",
      json("POST", { ...source, [field]: text }, { "Idempotency-Key": key }),
    );
    expect.soft(invalidCreate.status).toBe(400);
    await invalidCreate.text();
    expect.soft(await store.list(f.owner)).toEqual([created.note]);
    expect.soft(await connection.db.select().from(noteCreateRequests)).toEqual(receipts);
    const invalidUpdate = await f.http.request(
      `/notes/${created.note.id}`,
      json(
        "PUT",
        { title: source.title, content: source.content, [field]: text },
        { "If-Match": created.tag },
      ),
    );
    expect.soft(invalidUpdate.status).toBe(400);
    await invalidUpdate.text();
    expect
      .soft(await store.read(f.owner, created.note.id))
      .toEqual({ note: created.note, revision: 1 });
    const retry = await f.http.request("/notes", json("POST", source, { "Idempotency-Key": key }));
    expect.soft(retry.status).toBe(201);
    await retry.text();
  },
);

it("rejects year zero before PostgreSQL writes or key reservation", async () => {
  const f = await fixture();
  const key = randomUUID();
  const invalid = await f.http.request(
    "/notes",
    json("POST", { ...source, createdAt: "0000-01-01T00:00:00.000Z" }, { "Idempotency-Key": key }),
  );
  expect.soft(invalid.status).toBe(400);
  await invalid.text();
  expect(await createNoteStore(connection.db).list(f.owner)).toEqual([]);
  expect(await connection.db.select().from(noteCreateRequests)).toEqual([]);
  const retry = await f.http.request("/notes", json("POST", source, { "Idempotency-Key": key }));
  expect(retry.status).toBe(201);
  await retry.text();
});

it("round-trips valid Unicode source exactly through POST, PUT and fresh database reads", async () => {
  const f = await fixture();
  const text = "😀 𐐷 e\u0301 é \ufffd\n  Keep whitespace.  ";
  const payload = { ...source, title: text, content: text };
  const create = await f.http.request(
    "/notes",
    json("POST", payload, { "Idempotency-Key": randomUUID() }),
  );
  expect(create.status).toBe(201);
  const created = noteSchema.parse(await create.json());
  expect(created).toMatchObject(payload);
  const reloaded = await f.listen(extraConnection());
  expect(await (await reloaded.request(`/notes/${created.id}`)).json()).toEqual(created);
  const edit = { title: `${text}\nEdited`, content: `Edited\n${text}` };
  const update = await reloaded.request(
    `/notes/${created.id}`,
    json("PUT", edit, { "If-Match": create.headers.get("ETag")! }),
  );
  expect(update.status).toBe(200);
  expect(await update.json()).toMatchObject(edit);
  expect(await (await f.http.request(`/notes/${created.id}`)).json()).toMatchObject(edit);
});

it("coalesces concurrent creates and returns 409 for changed or deleted creation replays", async () => {
  const f = await fixture();
  const key = randomUUID();
  const responses = await Promise.all(
    Array.from({ length: 6 }, () =>
      f.http.request("/notes", json("POST", source, { "Idempotency-Key": key })),
    ),
  );
  expect(responses.map((response) => response.status)).toEqual([201, 201, 201, 201, 201, 201]);
  const bodies = await Promise.all(
    responses.map(async (response) => noteSchema.parse(await response.json())),
  );
  expect(new Set(bodies.map((note) => note.id)).size).toBe(1);
  expect(new Set(responses.map((response) => response.headers.get("ETag"))).size).toBe(1);
  expect(await createNoteStore(connection.db).list(f.owner)).toEqual([bodies[0]]);
  const changedPayload = await f.http.request(
    "/notes",
    json("POST", { ...source, title: "Different" }, { "Idempotency-Key": key }),
  );
  expect(changedPayload.status).toBe(409);
  await changedPayload.text();
  const changed = await f.http.request(
    `/notes/${bodies[0].id}`,
    json(
      "PUT",
      { title: "Edited", content: "Edited" },
      { "If-Match": responses[0].headers.get("ETag")! },
    ),
  );
  expect(changed.status).toBe(200);
  await changed.text();
  const editedReplay = await f.http.request(
    "/notes",
    json("POST", source, { "Idempotency-Key": key }),
  );
  expect(editedReplay.status).toBe(409);
  await editedReplay.text();
  const deleted = await f.http.request(`/notes/${bodies[0].id}`, {
    method: "DELETE",
    headers: { "If-Match": changed.headers.get("ETag")! },
  });
  expect(deleted.status).toBe(204);
  const deletedReplay = await f.http.request(
    "/notes",
    json("POST", source, { "Idempotency-Key": key }),
  );
  expect(deletedReplay.status).toBe(409);
  await deletedReplay.text();
  expect(await createNoteStore(connection.db).list(f.owner)).toEqual([]);
});

it("recovers the same persisted note after a response is lost and a new app/pool retries", async () => {
  const f = await fixture();
  const key = randomUUID();
  let committed: () => void = () => {};
  let release: () => void = () => {};
  const responseReady = new Promise<void>((resolve) => {
    committed = resolve;
  });
  const responseGate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const gated = await f.listen(connection, async (request) => {
    if (request.method === "POST") {
      committed();
      await responseGate;
    }
  });
  const abort = new AbortController();
  const lost = fetch(`${gated.origin}/api/notes`, {
    ...json("POST", source, { "Idempotency-Key": key, Authorization: "Bearer synthetic-owner" }),
    signal: abort.signal,
  }).then(
    () => "unexpected response",
    (error: unknown) => (error instanceof Error ? error.name : "unknown failure"),
  );
  try {
    await responseReady;
    const before = await createNoteStore(connection.db).list(f.owner);
    expect(before).toHaveLength(1);
    abort.abort();
    expect(await lost).toBe("AbortError");
    release();
    await gated.close();
    const resumed = await f.listen(extraConnection());
    const replay = await resumed.request(
      "/notes",
      json("POST", source, { "Idempotency-Key": key }),
    );
    expect(replay.status).toBe(201);
    expect(await replay.json()).toEqual(before[0]);
    expect(await createNoteStore(connection.db).list(f.owner)).toEqual(before);
  } finally {
    abort.abort();
    release();
  }
});

it("sanitizes an actual failed PostgreSQL pool without leaking connection details", async () => {
  const f = await fixture();
  const failedConnection = extraConnection();
  const failedHttp = await f.listen(failedConnection);
  await failedConnection.close();
  extraConnections.delete(failedConnection);
  for (const init of [{}, json("POST", source, { "Idempotency-Key": randomUUID() })]) {
    const response = await failedHttp.request("/notes", init);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: { code: "SERVICE_UNAVAILABLE", message: "Note storage is temporarily unavailable." },
    });
  }
});
