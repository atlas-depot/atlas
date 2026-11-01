import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import type { Context, Env } from "hono";
import { Hono } from "hono";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vite-plus/test";
import { ZodError } from "zod";
import type { SessionUser } from "../../shared/auth.ts";
import { apiError, apiErrorSchema, ifMatchSchema } from "../../shared/http.ts";
import { noteIdSchema, noteListSchema, noteSchema, type Note } from "../../shared/notes.ts";
import { createApp } from "../app.ts";
import { createAuthRoutes } from "../auth-routes.ts";
import { createRequestAuthenticator, type AuthenticateRequest, type AuthEnv } from "../auth.ts";
import type { BrowserAuth } from "../browser-auth.ts";
import { SESSION_COOKIE_NAME, readCookie } from "../cookies.ts";
import { openDatabase, readTestDatabaseUrl } from "./connection.ts";
import { createNoteStore } from "./notes.ts";

/**
 * Identity here is synthetic and mocked: this suite verifies that the verified
 * request identity scopes real PostgreSQL persistence. It does not verify WorkOS
 * token signatures or a live provider sign-in, which remain separate evidence.
 *
 * Production note routes still return 501 until #51. The adapter below mounts the
 * agreed note contract through createApp's protectedRoutes seam so #49 can exercise
 * the real auth middleware and database. Replace the adapter with the real routes
 * and keep these assertions when #51 lands.
 */
const appOrigin = "https://app.example.test";
const aliceIdentity = { userId: "user_alice" } as const;
const bobIdentity = { userId: "user_bob" } as const;
const aliceSession: SessionUser = {
  id: "user_alice",
  email: "alice@example.test",
  firstName: "Alice",
  lastName: null,
};
const bobSession: SessionUser = {
  id: "user_bob",
  email: "bob@example.test",
  firstName: "Bob",
  lastName: null,
};

const aliceDraft = {
  title: "Alice private title",
  content: "# Alice private content\n\nDo not disclose this to another account.",
  createdAt: "2026-10-31T09:00:00.000Z",
};
const bobDraft = {
  title: "Bob private title",
  content: "# Bob private content",
  createdAt: "2026-10-31T10:00:00.000Z",
};

function sessionCookie(value: string): string {
  return `${SESSION_COOKIE_NAME}=${value}; Path=/; HttpOnly; SameSite=Lax`;
}

function authorization(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

const authenticateBearer: AuthenticateRequest = async (request) => {
  const header = request.headers.get("Authorization");
  if (header === "Bearer synthetic-alice") return aliceIdentity;
  if (header === "Bearer synthetic-bob") return bobIdentity;
  return null;
};

const authenticateBrowser: AuthenticateRequest = async (request) => {
  const session = readCookie(request.headers.get("Cookie"), SESSION_COOKIE_NAME);
  if (session === "session_alice") return aliceIdentity;
  if (session === "session_bob") return bobIdentity;
  return null;
};

const authenticateRequest = createRequestAuthenticator(authenticateBearer, authenticateBrowser);

const browserAuth: BrowserAuth = {
  authenticate: authenticateBrowser,
  readSession: async (request) => {
    const session = readCookie(request.headers.get("Cookie"), SESSION_COOKIE_NAME);
    if (session === "session_alice") return aliceSession;
    if (session === "session_bob") return bobSession;
    return null;
  },
  startLogin: async () => ({
    url: `${appOrigin}/login`,
    transactionCookie: "atlas_login_transaction=txn; Path=/api/auth; HttpOnly; SameSite=Lax",
  }),
  completeLogin: async () => ({
    ok: true,
    user: aliceSession,
    sessionCookie: sessionCookie("session_alice"),
    clearTransactionCookie:
      "atlas_login_transaction=; Path=/api/auth; HttpOnly; SameSite=Lax; Max-Age=0",
  }),
  cancelLogin: () => ({ ok: false, error: "invalid_transaction" }),
  logout: async () => ({
    redirectTo: `${appOrigin}/`,
    sessionCookie: `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`,
  }),
};

function invalidRequest<E extends Env>(c: Context<E>) {
  return c.json(apiError("VALIDATION_ERROR", "Invalid note request."), 400);
}

function notFound<E extends Env>(c: Context<E>) {
  return c.json(apiError("NOT_FOUND", "Note not found."), 404);
}

function conflict<E extends Env>(c: Context<E>) {
  return c.json(apiError("PRECONDITION_FAILED", "Note was updated by another client."), 412);
}

/**
 * The client copies the exact per-note tag into If-Match, so the adapter compares
 * opaque strings. Numeric coercion would accept "01", "0x1" or "1e0" as revision 1
 * and let a tag that was never issued for this note satisfy the precondition.
 */
function readIfMatch(value: string | undefined) {
  if (value === undefined) return { status: "missing" } as const;
  return ifMatchSchema.safeParse(value).success
    ? ({ status: "ok", tag: value } as const)
    : ({ status: "invalid" } as const);
}

function revisionEtag(noteId: string, revision: number): string {
  return `"${noteId}:${revision}"`;
}

/**
 * Test-only adapter for the agreed note contract. It is mounted through the real
 * app's protectedRoutes seam, not exported from production code.
 */
function createPreparedNoteRoutes(store: ReturnType<typeof createNoteStore>) {
  const routes = new Hono<AuthEnv>();
  const ownerOf = (c: Context<AuthEnv>) => c.get("user").userId;

  routes.post("/prepared/notes", async (c) => {
    const body: unknown = await c.req.json().catch(() => undefined);
    try {
      const stored = await store.create(ownerOf(c), body);
      return c.json(stored.note, 201, { ETag: revisionEtag(stored.note.id, stored.revision) });
    } catch (error) {
      if (error instanceof ZodError || error instanceof SyntaxError) return invalidRequest(c);
      throw error;
    }
  });

  routes.get("/prepared/notes", async (c) => c.json({ notes: await store.list(ownerOf(c)) }));

  routes.get("/prepared/notes/:id", async (c) => {
    const id = noteIdSchema.safeParse(c.req.param("id"));
    if (!id.success) return invalidRequest(c);
    const stored = await store.read(ownerOf(c), id.data);
    if (!stored) return notFound(c);
    return c.json(stored.note, 200, { ETag: revisionEtag(stored.note.id, stored.revision) });
  });

  routes.put("/prepared/notes/:id", async (c) => {
    const id = noteIdSchema.safeParse(c.req.param("id"));
    if (!id.success) return invalidRequest(c);
    const expected = readIfMatch(c.req.header("If-Match"));
    if (expected.status === "missing") {
      return c.json(apiError("PRECONDITION_REQUIRED", "If-Match is required."), 428);
    }
    if (expected.status === "invalid") return invalidRequest(c);
    const current = await store.read(ownerOf(c), id.data);
    if (!current) return notFound(c);
    if (expected.tag !== revisionEtag(current.note.id, current.revision)) return conflict(c);
    const body: unknown = await c.req.json().catch(() => undefined);
    try {
      const result = await store.update(ownerOf(c), id.data, current.revision, body);
      if (result.status === "not_found") return notFound(c);
      if (result.status === "conflict") return conflict(c);
      return c.json(result.value.note, 200, {
        ETag: revisionEtag(result.value.note.id, result.value.revision),
      });
    } catch (error) {
      if (error instanceof ZodError || error instanceof SyntaxError) return invalidRequest(c);
      throw error;
    }
  });

  routes.delete("/prepared/notes/:id", async (c) => {
    const id = noteIdSchema.safeParse(c.req.param("id"));
    if (!id.success) return invalidRequest(c);
    const expected = readIfMatch(c.req.header("If-Match"));
    if (expected.status === "missing") {
      return c.json(apiError("PRECONDITION_REQUIRED", "If-Match is required."), 428);
    }
    if (expected.status === "invalid") return invalidRequest(c);
    const current = await store.read(ownerOf(c), id.data);
    if (!current) return notFound(c);
    if (expected.tag !== revisionEtag(current.note.id, current.revision)) return conflict(c);
    const result = await store.delete(ownerOf(c), id.data, current.revision);
    if (result.status === "not_found") return notFound(c);
    if (result.status === "conflict") return conflict(c);
    return c.body(null, 204);
  });

  return routes;
}

const databaseName = `atlas_test_${randomUUID().replaceAll("-", "")}`;
let admin: Pool;
let connectionA: ReturnType<typeof openDatabase>;
let connectionB: ReturnType<typeof openDatabase>;
let appA: ReturnType<typeof createApp>;
let appB: ReturnType<typeof createApp>;

beforeAll(async () => {
  const url = new URL(readTestDatabaseUrl(process.env));
  admin = new Pool({ connectionString: url.toString(), connectionTimeoutMillis: 10_000 });
  await admin.query(`CREATE DATABASE "${databaseName}"`);
  url.pathname = `/${databaseName}`;
  connectionA = openDatabase(url.toString());
  await migrate(connectionA.db, {
    migrationsFolder: fileURLToPath(new URL("../../drizzle/", import.meta.url)),
  });
  connectionB = openDatabase(url.toString());
  appA = createApp(authenticateRequest, {
    appOrigin,
    authRoutes: createAuthRoutes(browserAuth, { appOrigin }),
    protectedRoutes: createPreparedNoteRoutes(createNoteStore(connectionA.db)),
  });
  appB = createApp(authenticateRequest, {
    appOrigin,
    protectedRoutes: createPreparedNoteRoutes(createNoteStore(connectionB.db)),
  });
});

afterAll(async () => {
  await connectionA?.close();
  await connectionB?.close();
  if (admin) {
    try {
      await admin.query(`DROP DATABASE IF EXISTS "${databaseName}"`);
    } finally {
      await admin.end();
    }
  }
});

beforeEach(async () => {
  await connectionA.db.execute(sql`TRUNCATE TABLE notes`);
});

async function createNote(
  app: ReturnType<typeof createApp>,
  token: string,
  draft: typeof aliceDraft,
) {
  const response = await app.request("/api/prepared/notes", {
    method: "POST",
    headers: { ...authorization(token), "Content-Type": "application/json" },
    body: JSON.stringify(draft),
  });
  expect(response.status).toBe(201);
  const body: unknown = await response.json();
  const etag = response.headers.get("ETag");
  if (!etag) throw new Error("Expected an ETag");
  return { note: noteSchema.parse(body), etag };
}

async function listNotes(app: ReturnType<typeof createApp>, token: string): Promise<Note[]> {
  const response = await app.request("/api/prepared/notes", { headers: authorization(token) });
  expect(response.status).toBe(200);
  const body: unknown = await response.json();
  return noteListSchema.parse(body).notes;
}

async function readNote(app: ReturnType<typeof createApp>, token: string, id: string) {
  const response = await app.request(`/api/prepared/notes/${id}`, {
    headers: authorization(token),
  });
  expect(response.status).toBe(200);
  const body: unknown = await response.json();
  const etag = response.headers.get("ETag");
  if (!etag) throw new Error("Expected an ETag");
  return { note: noteSchema.parse(body), etag };
}

async function updateNote(
  app: ReturnType<typeof createApp>,
  token: string,
  id: string,
  etag: string,
  input: { title: string; content: string },
) {
  return app.request(`/api/prepared/notes/${id}`, {
    method: "PUT",
    headers: {
      ...authorization(token),
      "If-Match": etag,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  });
}

async function deleteNote(
  app: ReturnType<typeof createApp>,
  token: string,
  id: string,
  etag: string,
) {
  return app.request(`/api/prepared/notes/${id}`, {
    method: "DELETE",
    headers: { ...authorization(token), "If-Match": etag },
  });
}

describe("authenticated note ownership and stale-write boundaries (synthetic identity)", () => {
  it("keeps two synthetic accounts isolated across create, list, read, update and delete", async () => {
    const aliceNote = await createNote(appA, "synthetic-alice", aliceDraft);
    const bobNote = await createNote(appA, "synthetic-bob", bobDraft);

    expect(aliceNote.note).toMatchObject(aliceDraft);
    expect(aliceNote.etag).toBe(`"${aliceNote.note.id}:1"`);
    expect(bobNote.note).toMatchObject(bobDraft);
    expect(bobNote.etag).toBe(`"${bobNote.note.id}:1"`);

    expect((await listNotes(appA, "synthetic-alice")).map((note) => note.id)).toEqual([
      aliceNote.note.id,
    ]);
    const bobList = await listNotes(appA, "synthetic-bob");
    expect(bobList.map((note) => note.id)).toEqual([bobNote.note.id]);
    const bobListText = JSON.stringify(bobList);
    expect(bobListText).not.toContain(aliceDraft.title);
    expect(bobListText).not.toContain(aliceDraft.content);
    expect(bobListText).not.toContain("user_alice");

    const crossRead = await appA.request(`/api/prepared/notes/${aliceNote.note.id}`, {
      headers: authorization("synthetic-bob"),
    });
    expect(crossRead.status).toBe(404);
    const crossReadText = await crossRead.text();
    expect(crossReadText).not.toContain(aliceDraft.title);
    expect(crossReadText).not.toContain(aliceDraft.content);
    expect(crossReadText).not.toContain("user_alice");

    const nonexistentRead = await appA.request(`/api/prepared/notes/${randomUUID()}`, {
      headers: authorization("synthetic-bob"),
    });
    expect(nonexistentRead.status).toBe(crossRead.status);
    expect(await nonexistentRead.text()).toBe(crossReadText);

    const crossUpdate = await updateNote(appA, "synthetic-bob", aliceNote.note.id, aliceNote.etag, {
      title: "Attacked title",
      content: "Attacked content",
    });
    expect(crossUpdate.status).toBe(404);
    const crossUpdateText = await crossUpdate.text();
    expect(crossUpdateText).not.toContain(aliceDraft.title);
    expect(crossUpdateText).not.toContain(aliceDraft.content);
    expect(crossUpdateText).not.toContain("user_alice");
    const nonexistentUpdate = await updateNote(
      appA,
      "synthetic-bob",
      randomUUID(),
      aliceNote.etag,
      { title: "Attacked title", content: "Attacked content" },
    );
    expect(nonexistentUpdate.status).toBe(crossUpdate.status);
    expect(await nonexistentUpdate.text()).toBe(crossUpdateText);
    expect((await readNote(appA, "synthetic-alice", aliceNote.note.id)).note).toEqual(
      aliceNote.note,
    );

    const crossDelete = await deleteNote(appA, "synthetic-bob", aliceNote.note.id, aliceNote.etag);
    expect(crossDelete.status).toBe(404);
    const crossDeleteText = await crossDelete.text();
    expect(crossDeleteText).not.toContain(aliceDraft.title);
    expect(crossDeleteText).not.toContain(aliceDraft.content);
    expect(crossDeleteText).not.toContain("user_alice");
    const nonexistentDelete = await deleteNote(appA, "synthetic-bob", randomUUID(), aliceNote.etag);
    expect(nonexistentDelete.status).toBe(crossDelete.status);
    expect(await nonexistentDelete.text()).toBe(crossDeleteText);
    expect((await readNote(appA, "synthetic-alice", aliceNote.note.id)).note).toEqual(
      aliceNote.note,
    );

    const injected = await appA.request("/api/prepared/notes?userId=user_bob", {
      method: "POST",
      headers: { ...authorization("synthetic-alice"), "Content-Type": "application/json" },
      body: JSON.stringify({ ...aliceDraft, title: "Injected", ownerId: "user_bob" }),
    });
    expect(injected.status).toBe(400);
    expect(await listNotes(appA, "synthetic-alice")).toHaveLength(1);
    expect(await listNotes(appA, "synthetic-bob")).toHaveLength(1);
  });

  it("fails closed for missing, expired and misdirected sessions", async () => {
    for (const headers of [
      {},
      authorization("synthetic-expired"),
      { Cookie: sessionCookie("expired") },
    ]) {
      const response = await appA.request("/api/prepared/notes", { headers });
      expect(response.status).toBe(401);
      expect(response.headers.get("WWW-Authenticate")).toBe('Bearer realm="atlas"');
      expect(await response.json()).toMatchObject({ error: { code: "UNAUTHENTICATED" } });
    }

    const bearerPrecedence = await appA.request("/api/prepared/notes", {
      headers: {
        ...authorization("synthetic-expired"),
        Cookie: sessionCookie("session_alice"),
      },
    });
    expect(bearerPrecedence.status).toBe(401);
    expect(await bearerPrecedence.json()).toMatchObject({
      error: { code: "UNAUTHENTICATED" },
    });

    const aliceNote = await createNote(appA, "synthetic-alice", aliceDraft);
    for (const headers of [
      authorization("synthetic-expired"),
      { Cookie: sessionCookie("expired") },
    ]) {
      const response = await appA.request(`/api/prepared/notes/${aliceNote.note.id}`, { headers });
      expect(response.status).toBe(401);
      const text = await response.text();
      expect(text).not.toContain(aliceDraft.title);
      expect(text).not.toContain(aliceDraft.content);
      expect(text).not.toContain("user_alice");
    }
  });

  it("removes private access when the browser session switches or signs out", async () => {
    const aliceNote = await createNote(appA, "synthetic-alice", aliceDraft);
    const bobNote = await createNote(appA, "synthetic-bob", bobDraft);

    const aliceView = await appA.request(`/api/prepared/notes/${aliceNote.note.id}`, {
      headers: { Cookie: sessionCookie("session_alice") },
    });
    expect(aliceView.status).toBe(200);

    const bobListResponse = await appA.request("/api/prepared/notes", {
      headers: { Cookie: sessionCookie("session_bob") },
    });
    const bobNotes = noteListSchema.parse((await bobListResponse.json()) as unknown).notes;
    expect(bobNotes.map((note) => note.id)).toEqual([bobNote.note.id]);
    expect(JSON.stringify(bobNotes)).not.toContain(aliceDraft.content);

    const switchedRead = await appA.request(`/api/prepared/notes/${aliceNote.note.id}`, {
      headers: { Cookie: sessionCookie("session_bob") },
    });
    expect(switchedRead.status).toBe(404);
    const switchedReadText = await switchedRead.text();
    expect(switchedReadText).not.toContain(aliceDraft.title);
    expect(switchedReadText).not.toContain(aliceDraft.content);
    expect(switchedReadText).not.toContain("user_alice");

    const bearerOverCookie = await appA.request(`/api/prepared/notes/${aliceNote.note.id}`, {
      headers: {
        ...authorization("synthetic-bob"),
        Cookie: sessionCookie("session_alice"),
      },
    });
    expect(bearerOverCookie.status).toBe(404);

    // The synthetic authenticator has no provider-side revocation. This verifies the
    // cleared cookie cannot authenticate, not that a copied pre-logout token is invalid.
    const logout = await appA.request("/api/auth/logout", {
      method: "POST",
      headers: { Cookie: sessionCookie("session_alice"), Origin: appOrigin },
    });
    expect(logout.status).toBe(303);
    const cleared = logout.headers
      .getSetCookie()
      .find((cookie) => cookie.startsWith(`${SESSION_COOKIE_NAME}=;`));
    expect(cleared).toContain("Max-Age=0");

    const afterLogout = await appA.request("/api/prepared/notes", {
      headers: { Cookie: `${SESSION_COOKIE_NAME}=` },
    });
    expect(afterLogout.status).toBe(401);

    const afterLogoutRead = await appA.request(`/api/prepared/notes/${aliceNote.note.id}`, {
      headers: { Cookie: `${SESSION_COOKIE_NAME}=` },
    });
    expect(afterLogoutRead.status).toBe(401);
    const afterLogoutReadText = await afterLogoutRead.text();
    expect(afterLogoutReadText).not.toContain(aliceDraft.title);
    expect(afterLogoutReadText).not.toContain(aliceDraft.content);
    expect(afterLogoutReadText).not.toContain("user_alice");
  });

  it("requires the configured origin for cookie-authenticated unsafe requests", async () => {
    for (const origin of [undefined, "https://evil.example.test"]) {
      const headers: Record<string, string> = {
        Cookie: sessionCookie("session_alice"),
        "Content-Type": "application/json",
      };
      if (origin) headers.Origin = origin;
      const response = await appA.request("/api/prepared/notes", {
        method: "POST",
        headers,
        body: JSON.stringify(aliceDraft),
      });
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ error: { code: "FORBIDDEN" } });
    }

    const allowed = await appA.request("/api/prepared/notes", {
      method: "POST",
      headers: {
        Cookie: sessionCookie("session_alice"),
        Origin: appOrigin,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ...aliceDraft, title: "Allowed browser save" }),
    });
    expect(allowed.status).toBe(201);
  });

  it("allows exactly one of two clients at the same revision and preserves the newer value", async () => {
    const created = await createNote(appA, "synthetic-alice", aliceDraft);

    const [first, second] = await Promise.all([
      updateNote(appA, "synthetic-alice", created.note.id, created.etag, {
        title: "Client A",
        content: "Client A content",
      }),
      updateNote(appB, "synthetic-alice", created.note.id, created.etag, {
        title: "Client B",
        content: "Client B content",
      }),
    ]);

    expect([first.status, second.status].sort((a, b) => a - b)).toEqual([200, 412]);
    const winner = first.status === 200 ? first : second;
    const loser = first.status === 200 ? second : first;
    const winnerEtag = winner.headers.get("ETag");
    if (!winnerEtag) throw new Error("Expected an ETag");
    expect(winnerEtag).toMatch(/^"[^"]+"$/);
    expect(winnerEtag).not.toBe(created.etag);
    const winnerNote = noteSchema.parse((await winner.json()) as unknown);

    expect(apiErrorSchema.parse((await loser.json()) as unknown).error.code).toBe(
      "PRECONDITION_FAILED",
    );

    const stored = await readNote(appA, "synthetic-alice", created.note.id);
    expect(stored.etag).toBe(winnerEtag);
    expect(stored.note.title).toBe(winnerNote.title);
    expect(stored.note.content).toBe(winnerNote.content);

    const staleUpdate = await updateNote(appA, "synthetic-alice", created.note.id, created.etag, {
      title: "Stale title",
      content: "Stale content",
    });
    expect(staleUpdate.status).toBe(412);
    expect(await readNote(appA, "synthetic-alice", created.note.id)).toEqual(stored);

    const staleDelete = await deleteNote(appA, "synthetic-alice", created.note.id, created.etag);
    expect(staleDelete.status).toBe(412);
    expect(await readNote(appA, "synthetic-alice", created.note.id)).toEqual(stored);

    const deleted = await deleteNote(appA, "synthetic-alice", created.note.id, stored.etag);
    expect(deleted.status).toBe(204);
    const afterDelete = await appA.request(`/api/prepared/notes/${created.note.id}`, {
      headers: authorization("synthetic-alice"),
    });
    expect(afterDelete.status).toBe(404);
  });

  it("requires a strong If-Match and rejects malformed preconditions before writing", async () => {
    const created = await createNote(appA, "synthetic-alice", aliceDraft);

    const missing = await appA.request(`/api/prepared/notes/${created.note.id}`, {
      method: "PUT",
      headers: { ...authorization("synthetic-alice"), "Content-Type": "application/json" },
      body: JSON.stringify({ title: "No precondition", content: "No precondition" }),
    });
    expect(missing.status).toBe(428);

    for (const malformedTag of ["*", "v1", '"v3", "v4"', 'W/"1"']) {
      const update = await updateNote(appA, "synthetic-alice", created.note.id, malformedTag, {
        title: "Malformed",
        content: "Malformed",
      });
      expect(update.status).toBe(400);
      expect(apiErrorSchema.parse((await update.json()) as unknown).error.code).toBe(
        "VALIDATION_ERROR",
      );

      const deletion = await deleteNote(appA, "synthetic-alice", created.note.id, malformedTag);
      expect(deletion.status).toBe(400);
      expect(apiErrorSchema.parse((await deletion.json()) as unknown).error.code).toBe(
        "VALIDATION_ERROR",
      );
    }

    const missingDelete = await appA.request(`/api/prepared/notes/${created.note.id}`, {
      method: "DELETE",
      headers: authorization("synthetic-alice"),
    });
    expect(missingDelete.status).toBe(428);

    expect(await readNote(appA, "synthetic-alice", created.note.id)).toEqual(created);
  });

  it("rejects invalid identifiers and payloads before touching stored notes", async () => {
    const created = await createNote(appA, "synthetic-alice", aliceDraft);
    const invalidId = "not-a-uuid";

    const readInvalid = await appA.request(`/api/prepared/notes/${invalidId}`, {
      headers: authorization("synthetic-alice"),
    });
    expect(readInvalid.status).toBe(400);

    const updateInvalid = await updateNote(appA, "synthetic-alice", invalidId, created.etag, {
      title: "Invalid id",
      content: "Invalid id",
    });
    expect(updateInvalid.status).toBe(400);

    const deleteInvalid = await deleteNote(appA, "synthetic-alice", invalidId, created.etag);
    expect(deleteInvalid.status).toBe(400);

    const malformedJson = await appA.request(`/api/prepared/notes/${created.note.id}`, {
      method: "PUT",
      headers: {
        ...authorization("synthetic-alice"),
        "If-Match": created.etag,
        "Content-Type": "application/json",
      },
      body: "{",
    });
    expect(malformedJson.status).toBe(400);

    const injected = await appA.request(`/api/prepared/notes/${created.note.id}`, {
      method: "PUT",
      headers: {
        ...authorization("synthetic-alice"),
        "If-Match": created.etag,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ title: "Injected", content: "Injected", ownerId: "user_bob" }),
    });
    expect(injected.status).toBe(400);

    const malformedCreate = await appA.request("/api/prepared/notes", {
      method: "POST",
      headers: { ...authorization("synthetic-alice"), "Content-Type": "application/json" },
      body: "{",
    });
    expect(malformedCreate.status).toBe(400);

    expect(await readNote(appA, "synthetic-alice", created.note.id)).toEqual(created);
    expect(await listNotes(appA, "synthetic-alice")).toEqual([created.note]);
  });

  it("compares the exact per-note ETag and rejects unissued or cross-note tags", async () => {
    const created = await createNote(appA, "synthetic-alice", aliceDraft);
    const other = await createNote(appA, "synthetic-alice", {
      ...aliceDraft,
      title: "Second note",
      content: "Second note content",
    });
    expect(created.etag).toBe(`"${created.note.id}:1"`);
    expect(other.etag).toBe(`"${other.note.id}:1"`);

    for (const tag of [
      '"01"',
      '"0x1"',
      '"1e0"',
      '"1.0"',
      '"0b1"',
      '"+1"',
      `"${created.note.id}:2"`,
      other.etag,
    ]) {
      const update = await updateNote(appA, "synthetic-alice", created.note.id, tag, {
        title: "Forged",
        content: "Forged",
      });
      expect(update.status).toBe(412);
      expect(apiErrorSchema.parse((await update.json()) as unknown).error.code).toBe(
        "PRECONDITION_FAILED",
      );

      const deletion = await deleteNote(appA, "synthetic-alice", created.note.id, tag);
      expect(deletion.status).toBe(412);
      expect(apiErrorSchema.parse((await deletion.json()) as unknown).error.code).toBe(
        "PRECONDITION_FAILED",
      );
    }

    expect(await readNote(appA, "synthetic-alice", created.note.id)).toEqual(created);
    expect(await readNote(appA, "synthetic-alice", other.note.id)).toEqual(other);

    const saved = await updateNote(appA, "synthetic-alice", created.note.id, created.etag, {
      title: "Edited",
      content: "Edited content",
    });
    expect(saved.status).toBe(200);
    expect(saved.headers.get("ETag")).toBe(`"${created.note.id}:2"`);
    const savedNote = noteSchema.parse((await saved.json()) as unknown);
    expect(savedNote).toMatchObject({ title: "Edited", content: "Edited content" });
    expect(await readNote(appA, "synthetic-alice", created.note.id)).toEqual({
      note: savedNote,
      etag: `"${created.note.id}:2"`,
    });
  });
});
