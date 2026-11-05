import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { Pool } from "pg";
import { afterAll, afterEach, beforeAll, expect, it } from "vite-plus/test";
import { noteDraftSchema } from "../../shared/drafts.ts";
import { noteSchema } from "../../shared/notes.ts";
import { createApp } from "../app.ts";
import { createDurableOrganizeRuns, type DurableOrganizer } from "../organize-runs.ts";
import { openDatabase, readTestDatabaseUrl } from "./connection.ts";
import { applyMigrations } from "./migrations.ts";
import { createNoteStore } from "./notes.ts";
import { createOrganizeRunStore } from "./organize-runs.ts";
import { draftSaveRequests, noteDrafts, notes, organizeRuns } from "./schema.ts";

// Hono, ownership-scoped storage, migrations and PostgreSQL transactions are real.
// Authentication and eve are synthetic; no WorkOS or model/provider claim is made.
const databaseName = `atlas_drafts_${randomUUID().replaceAll("-", "")}`;
let admin: Pool;
let connection: ReturnType<typeof openDatabase>;
let other: ReturnType<typeof openDatabase>;
const input = {
  title: "Original",
  content: "Keep the original 42.",
  createdAt: "2026-11-05T12:00:00.000Z",
};
const generated = {
  markdown: "## Organized\n\nKeep 42, with a source.",
  sources: [{ id: "source-1", url: "https://example.com/reference", title: "Reference" }],
};

beforeAll(async () => {
  const url = new URL(readTestDatabaseUrl(process.env));
  admin = new Pool({ connectionString: url.href });
  await admin.query(`CREATE DATABASE "${databaseName}"`);
  url.pathname = `/${databaseName}`;
  connection = openDatabase(url.href);
  other = openDatabase(url.href);
  await applyMigrations(connection.db);
});
afterEach(async () => {
  await connection.db.delete(noteDrafts);
  await connection.db.delete(draftSaveRequests);
  await connection.db.delete(organizeRuns);
  await connection.db.delete(notes);
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
  const foreign = randomUUID();
  const sourceStore = createNoteStore(connection.db);
  const original = await sourceStore.create(owner, input);
  const tag = JSON.stringify(`${original.note.id}:${original.revision}`);
  const clock = Date.now();
  let cleanupUnavailable = false;
  let retired = 0;
  let beforeRetire: (() => Promise<void>) | undefined;
  const runtime: DurableOrganizer = {
    allocate: async ({ operationId }) => ({
      sessionId: `session-${operationId}`,
      deliveryId: null,
    }),
    submit: async ({ sessionId, operationId }) => ({
      sessionId,
      deliveryId: `delivery-${operationId}`,
    }),
    inspect: async () => ({ status: "draft", draft: generated, completedAt: clock }),
    retire: async () => {
      retired += 1;
      await beforeRetire?.();
      if (cleanupUnavailable) throw new Error("Synthetic remote cleanup outage");
      return { status: "ended" };
    },
  };
  const manager = (db = connection.db) =>
    createDurableOrganizeRuns({
      store: createOrganizeRunStore(db),
      runtimeUrl: "https://organizer.example",
      runtimeFor: () => runtime,
      resultRetentionMs: 60_000,
      now: () => clock,
    });
  const backend = manager();
  const app = createApp(
    async (request) => {
      const id = request.headers.get("X-Test-Owner");
      return id ? { userId: id } : null;
    },
    { notes: sourceStore, organizer: backend },
  );
  const request = async (path: string, init: RequestInit = {}, identity = owner) => {
    const headers = new Headers(init.headers);
    headers.set("X-Test-Owner", identity);
    if (init.body !== undefined) headers.set("Content-Type", "application/json");
    return app.request(`/api${path}`, { ...init, headers });
  };
  async function start() {
    const response = await request(`/notes/${original.note.id}/organize`, {
      method: "POST",
      headers: { "If-Match": tag },
    });
    expect(response.status).toBe(202);
    const { runId } = (await response.json()) as { runId: string };
    return runId;
  }
  async function complete() {
    const id = await start();
    expect((await request(`/organize-runs/${id}`)).status).toBe(200);
    return id;
  }
  async function handoff(id: string) {
    const response = await request(`/organize-runs/${id}/handoff`, { method: "POST" });
    expect(response.status).toBe(200);
    const draft = noteDraftSchema.parse(await response.json());
    expect(response.headers.get("ETag")).toBe(draft.etag);
    return draft;
  }
  return {
    owner,
    foreign,
    original,
    sourceStore,
    tag,
    clock,
    backend,
    manager,
    request,
    start,
    complete,
    handoff,
    retired: () => retired,
    failCleanup: (value: boolean) => {
      cleanupUnavailable = value;
    },
    onRetire: (callback: () => Promise<void>) => {
      beforeRetire = callback;
    },
  };
}

it("commits the draft and cleanup intent before retirement, and replays a lost handoff response", async () => {
  const f = await fixture();
  const id = await f.complete();
  f.onRetire(async () => {
    const [draft] = await other.db.select().from(noteDrafts).where(eq(noteDrafts.id, id));
    const run = await createOrganizeRunStore(other.db).read(f.owner, id);
    expect(draft.content).toBe(generated.markdown);
    expect(run).toMatchObject({
      state: { status: "cleaning" },
      cleanupTarget: { status: "expired" },
    });
  });
  const draft = await f.handoff(id);
  expect(await f.handoff(id)).toEqual(draft);
  expect(f.retired()).toBe(1);
  expect(await f.manager(other.db).work(f.owner)).toEqual({ runs: [], drafts: [draft] });
  expect(await f.sourceStore.read(f.owner, f.original.note.id)).toEqual(f.original);
  expect(Date.parse(draft.expiresAt) - f.clock).toBe(24 * 60 * 60 * 1000);
});

it("rolls back the temporary copy when the cleanup-intent transaction fails", async () => {
  const f = await fixture();
  const id = await f.complete();
  await connection.db.execute(
    sql.raw(
      `CREATE FUNCTION reject_handoff() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.state->>'status' = 'cleaning' THEN RAISE EXCEPTION 'synthetic failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_handoff BEFORE UPDATE ON organize_runs FOR EACH ROW EXECUTE FUNCTION reject_handoff();`,
    ),
  );
  try {
    expect((await f.request(`/organize-runs/${id}/handoff`, { method: "POST" })).status).toBe(503);
    expect(await other.db.select().from(noteDrafts)).toEqual([]);
    expect((await createOrganizeRunStore(other.db).read(f.owner, id))?.state.status).toBe("draft");
    expect(f.retired()).toBe(0);
  } finally {
    await connection.db.execute(
      sql.raw("DROP TRIGGER reject_handoff ON organize_runs; DROP FUNCTION reject_handoff();"),
    );
  }
  expect((await f.handoff(id)).content).toBe(generated.markdown);
});

it("retains the recoverable draft across cleanup failure and retries cleanup without another handoff", async () => {
  const f = await fixture();
  const id = await f.complete();
  f.failCleanup(true);
  const draft = await f.handoff(id);
  expect((await createOrganizeRunStore(other.db).read(f.owner, id))?.cleanupTarget).toEqual({
    status: "expired",
  });
  expect(await f.manager(other.db).drafts.read(f.owner, id)).toEqual(draft);
  f.failCleanup(false);
  await f.backend.sweep();
  expect((await createOrganizeRunStore(other.db).read(f.owner, id))?.active).toBe(false);
  expect(await f.backend.drafts.read(f.owner, id)).toEqual(draft);
});

it("binds generation to the saved source and blocks another generation until the draft is resolved", async () => {
  const f = await fixture();
  expect(
    (await f.request(`/notes/${f.original.note.id}/organize`, { method: "POST" })).status,
  ).toBe(428);
  expect(
    (
      await f.request(`/notes/${f.original.note.id}/organize`, {
        method: "POST",
        headers: { "If-Match": '"old"' },
      })
    ).status,
  ).toBe(412);
  const id = await f.complete();
  const draft = await f.handoff(id);
  expect(
    (
      await f.request(`/notes/${f.original.note.id}/organize`, {
        method: "POST",
        headers: { "If-Match": f.tag },
      })
    ).status,
  ).toBe(409);
  expect(
    (
      await f.request(`/note-drafts/${id}`, {
        method: "DELETE",
        headers: { "If-Match": draft.etag },
      })
    ).status,
  ).toBe(204);
  expect((await f.request(`/organize-runs/${id}/handoff`, { method: "POST" })).status).toBe(409);
  expect(await f.backend.drafts.read(f.owner, id)).toBeUndefined();
  expect(await f.start()).not.toBe(id);
});

it("persists edits without extending expiration and rejects stale or malformed writes", async () => {
  const f = await fixture();
  const id = await f.complete();
  const initial = await f.handoff(id);
  const body = { title: "Edited draft", content: "Keep my exact edits 😀." };
  const response = await f.request(`/note-drafts/${id}`, {
    method: "PUT",
    headers: { "If-Match": initial.etag },
    body: JSON.stringify(body),
  });
  expect(response.status).toBe(200);
  const edited = noteDraftSchema.parse(await response.json());
  expect(edited).toMatchObject({ ...body, expiresAt: initial.expiresAt });
  expect(edited.etag).not.toBe(initial.etag);
  expect(await f.manager(other.db).drafts.read(f.owner, id)).toEqual(edited);
  for (const suffix of ["", "/save"]) {
    const stale = await f.request(`/note-drafts/${id}${suffix}`, {
      method: suffix ? "POST" : "PUT",
      headers: { "If-Match": initial.etag },
      body: JSON.stringify({ title: "Stale", content: "Stale" }),
    });
    expect(stale.status).toBe(412);
  }
  expect(
    (
      await f.request(`/note-drafts/${id}`, {
        method: "PUT",
        headers: { "If-Match": edited.etag },
        body: JSON.stringify({ ...body, origin: { sourceNoteId: randomUUID() } }),
      })
    ).status,
  ).toBe(400);
  expect(
    (
      await f.request(`/note-drafts/${id}`, {
        method: "PUT",
        headers: { "If-Match": edited.etag },
        body: JSON.stringify({ ...body, content: "\ud800" }),
      })
    ).status,
  ).toBe(400);
  expect(await f.backend.drafts.read(f.owner, id)).toEqual(edited);
});

it("hides every draft operation and pending-work listing from other owners", async () => {
  const f = await fixture();
  const id = await f.complete();
  const draft = await f.handoff(id);
  expect(await (await f.request("/organize-work", {}, f.foreign)).json()).toEqual({
    runs: [],
    drafts: [],
  });
  const edits = JSON.stringify({ title: "Forged", content: "Forged" });
  for (const [method, suffix, body] of [
    ["GET", "", undefined],
    ["PUT", "", edits],
    ["DELETE", "", undefined],
    ["POST", "/save", edits],
  ] as const) {
    expect(
      (
        await f.request(
          `/note-drafts/${id}${suffix}`,
          { method, headers: { "If-Match": draft.etag }, body },
          f.foreign,
        )
      ).status,
    ).toBe(404);
  }
  expect(
    (await f.request(`/organize-runs/${id}/handoff`, { method: "POST" }, f.foreign)).status,
  ).toBe(404);
  expect(await f.backend.drafts.read(f.owner, id)).toEqual(draft);
});

it("marks changed or deleted sources and saves separately with trusted provenance", async () => {
  const f = await fixture();
  const id = await f.complete();
  const draft = await f.handoff(id);
  await f.sourceStore.update(f.owner, f.original.note.id, 1, {
    title: "Changed source",
    content: "Keep 43.",
  });
  expect((await f.backend.drafts.read(f.owner, id))?.source).toEqual({
    noteId: f.original.note.id,
    revision: 1,
    stale: true,
    deleted: false,
  });
  await f.sourceStore.delete(f.owner, f.original.note.id, 2);
  expect((await f.backend.drafts.read(f.owner, id))?.source).toEqual({
    noteId: f.original.note.id,
    revision: 1,
    stale: false,
    deleted: true,
  });
  const response = await f.request(`/note-drafts/${id}/save`, {
    method: "POST",
    headers: { "If-Match": draft.etag },
    body: JSON.stringify({ title: "Kept derivative", content: draft.content }),
  });
  expect(response.status).toBe(201);
  const saved = noteSchema.parse(await response.json());
  expect(saved.id).not.toBe(f.original.note.id);
  expect(saved.origin).toEqual({
    sourceNoteId: f.original.note.id,
    sourceRevision: 1,
    sources: generated.sources,
  });
  expect(await f.sourceStore.read(f.owner, f.original.note.id)).toBeUndefined();
  expect(await f.backend.drafts.read(f.owner, id)).toBeUndefined();
});

it("converges concurrent Saves on one note and rejects replay after edits or deletion", async () => {
  const f = await fixture();
  const id = await f.complete();
  const draft = await f.handoff(id);
  const body = { title: "Final draft", content: draft.content };
  const save = () =>
    f.request(`/note-drafts/${id}/save`, {
      method: "POST",
      headers: { "If-Match": draft.etag, "Idempotency-Key": randomUUID() },
      body: JSON.stringify(body),
    });
  const responses = await Promise.all(Array.from({ length: 5 }, save));
  expect(responses.map((response) => response.status)).toEqual([201, 201, 201, 201, 201]);
  const saved = await Promise.all(
    responses.map(async (response) => noteSchema.parse(await response.json())),
  );
  expect(new Set(saved.map((note) => note.id)).size).toBe(1);
  expect(await f.sourceStore.list(f.owner)).toHaveLength(2);
  expect(await f.sourceStore.read(f.owner, f.original.note.id)).toEqual(f.original);
  await f.sourceStore.update(f.owner, saved[0].id, 1, {
    title: "Later edit",
    content: "User changed this.",
  });
  expect((await save()).status).toBe(409);
  await f.sourceStore.delete(f.owner, saved[0].id, 2);
  expect((await save()).status).toBe(409);
  expect(await f.sourceStore.list(f.owner)).toHaveLength(1);
  const [receipt] = await connection.db
    .select()
    .from(draftSaveRequests)
    .where(eq(draftSaveRequests.draftId, id));
  expect(Object.keys(receipt).sort()).toEqual(["draftId", "noteId", "ownerId", "payloadHash"]);
});

it("makes expired drafts unreadable and physically purges content during maintenance", async () => {
  const f = await fixture();
  const id = await f.complete();
  const draft = await f.handoff(id);
  await connection.db
    .update(noteDrafts)
    .set({ expiresAt: sql`clock_timestamp() - interval '1 second'` })
    .where(eq(noteDrafts.id, id));
  expect((await f.request(`/note-drafts/${id}`)).status).toBe(404);
  expect(
    (
      await f.request(`/note-drafts/${id}/save`, {
        method: "POST",
        headers: { "If-Match": draft.etag },
        body: JSON.stringify({ title: draft.title, content: draft.content }),
      })
    ).status,
  ).toBe(404);
  await f.backend.sweep();
  expect(await other.db.select().from(noteDrafts).where(eq(noteDrafts.id, id))).toEqual([]);
  expect((await f.request(`/organize-runs/${id}/handoff`, { method: "POST" })).status).toBe(409);
  expect(await f.sourceStore.read(f.owner, f.original.note.id)).toEqual(f.original);
});
