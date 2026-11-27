import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { expect, it, vi } from "vite-plus/test";
import { createApp } from "../app.ts";
import { createDurableOrganizeRuns, type DurableOrganizer } from "../organize-runs.ts";
import { setupIndexTestDatabase } from "./index-test-database.ts";
import { createNoteStore } from "./notes.ts";
import { createOrganizeRunStore } from "./organize-runs.ts";
import { failedOrganizeRequests, organizeRuns } from "./schema.ts";

const database = setupIndexTestDatabase();
const runtimeUrl = "https://organizer.example";
const text = "  Create a note titled Review checklist.\n\n```js\nrun();\n```\n";

it("replays identical standalone operations across pools and bounds simultaneous paid runs per owner", async () => {
  const owner = randomUUID();
  const key = randomUUID();
  const stores = [createOrganizeRunStore(database.db), createOrganizeRunStore(database.other)];
  const input = { kind: "request" as const, text };
  const claims = await Promise.all(stores.map((s) => s.claim(owner, { key, input }, runtimeUrl)));
  expect(claims[0]?.runId).toBeTruthy();
  expect(claims[0]?.runId).toBe(claims[1]?.runId);
  expect(claims[0]).toMatchObject({ noteId: null, sourceRevision: null, input: { request: text } });
  await expect(
    stores[1].claim(owner, { key, input: { kind: "request", text: text.trim() } }, runtimeUrl),
  ).rejects.toMatchObject({ reason: "key_conflict" });
  const remaining = await Promise.allSettled(
    Array.from({ length: 4 }, (_, i) =>
      stores[i % 2].claim(owner, { key: randomUUID(), input }, runtimeUrl),
    ),
  );
  expect(remaining.filter((claim) => claim.status === "fulfilled")).toHaveLength(2);
  expect(
    remaining.filter((claim) => claim.status === "rejected").map((claim) => claim.reason),
  ).toEqual([
    expect.objectContaining({ reason: "limit" }),
    expect.objectContaining({ reason: "limit" }),
  ]);
  expect(await createNoteStore(database.db).list(owner)).toEqual([]);
});

it("recovers only the owner's exact failed request for 24h independently of run cleanup and idempotency", async () => {
  const owner = randomUUID();
  const other = randomUUID();
  const key = randomUUID();
  const runtime = {
    allocate: vi.fn(async ({ operationId }) => ({ sessionId: operationId, deliveryId: null })),
    submit: vi.fn(async ({ sessionId, operationId }) => ({ sessionId, deliveryId: operationId })),
    inspect: async () => ({ status: "failed", reason: "generation_failed" }),
    retire: async () => ({ status: "ended" }),
  } satisfies DurableOrganizer;
  const store = createOrganizeRunStore(database.db);
  const service = createDurableOrganizeRuns({
    store,
    runtimeUrl,
    runtimeFor: () => runtime,
    resultRetentionMs: 60_000,
  });
  const app = createApp(
    async (request) => ({ userId: request.headers.get("x-test-owner") ?? owner }),
    { organizer: service },
  );
  const start = (operationKey: string) =>
    app.request("/api/organize-runs", {
      method: "POST",
      headers: { "Idempotency-Key": operationKey, "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "request", text }),
    });
  const accepted = await start(key);
  expect(accepted.status).toBe(202);
  const { runId } = (await accepted.json()) as { runId: string };
  expect((await app.request(`/api/organize-requests/${runId}`)).status).toBe(404);
  expect(await (await app.request("/api/organize-work")).json()).toEqual({ runs: [], drafts: [] });
  expect(await (await app.request("/api/organize-work?include=requests")).json()).toMatchObject({
    runs: [{ runId, noteId: null }],
  });
  const failedAt = Date.now();
  expect(await (await app.request(`/api/organize-runs/${runId}`)).json()).toMatchObject({
    status: "failed",
    reason: "generation_failed",
  });
  const read = await app.request(`/api/organize-requests/${runId}`);
  expect(read.headers.get("cache-control")).toBe("no-store");
  const recovery = (await read.json()) as { runId: string; text: string; expiresAt: string };
  expect(recovery).toMatchObject({ runId, text });
  const expiry = Date.parse(recovery.expiresAt);
  expect(expiry).toBeGreaterThanOrEqual(failedAt + 86_400_000 - 1000);
  expect(expiry).toBeLessThanOrEqual(Date.now() + 86_400_000 + 1000);
  expect(await (await app.request("/api/organize-requests")).json()).toEqual({
    requests: [{ runId, expiresAt: recovery.expiresAt }],
  });
  expect(
    (await app.request(`/api/organize-requests/${runId}`, { headers: { "x-test-owner": other } }))
      .status,
  ).toBe(404);
  expect(
    await (
      await app.request("/api/organize-requests", { headers: { "x-test-owner": other } })
    ).json(),
  ).toEqual({ requests: [] });
  expect(await (await start(key)).json()).toMatchObject({ runId });
  expect(runtime.submit).toHaveBeenCalledTimes(1);
  expect(await (await start(randomUUID())).json()).not.toMatchObject({ runId });
  expect(runtime.submit).toHaveBeenCalledTimes(2);
  await database.db
    .update(failedOrganizeRequests)
    .set({ expiresAt: sql`clock_timestamp()` })
    .where(eq(failedOrganizeRequests.runId, runId));
  expect((await app.request(`/api/organize-requests/${runId}`)).status).toBe(404);
  expect(await (await app.request("/api/organize-requests")).json()).toEqual({ requests: [] });
  await store.purgeExpired();
  expect(
    await database.db
      .select()
      .from(failedOrganizeRequests)
      .where(eq(failedOrganizeRequests.runId, runId)),
  ).toHaveLength(0);
  await database.db
    .update(organizeRuns)
    .set({ expiresAt: sql`clock_timestamp()` })
    .where(eq(organizeRuns.id, runId));
  await store.purgeExpired();
  expect((await start(key)).status).toBe(409);
  expect(runtime.submit).toHaveBeenCalledTimes(2);
  expect(await createNoteStore(database.db).list(owner)).toEqual([]);
});

it.each(["submit-expired", "inspect-expired", "missing-title"] as const)(
  "keeps a recoverable request when no valid draft can be delivered (%s)",
  async (fault) => {
    const owner = randomUUID();
    const store = createOrganizeRunStore(database.db);
    const runtime: DurableOrganizer = {
      allocate: async ({ operationId }) => ({ sessionId: operationId, deliveryId: null }),
      submit: async ({ sessionId, operationId }) =>
        fault === "submit-expired" ? { status: "expired" } : { sessionId, deliveryId: operationId },
      inspect: async () =>
        fault === "missing-title"
          ? { status: "draft", draft: { markdown: "A body with no title", sources: [] } }
          : { status: "failed", reason: "expired" },
      retire: async () => ({ status: "ended" }),
    };
    const service = createDurableOrganizeRuns({
      store,
      runtimeUrl,
      runtimeFor: () => runtime,
      resultRetentionMs: 60_000,
    });
    const result = await service.start(owner, {
      key: randomUUID(),
      input: { kind: "request", text },
    });
    if (!("runId" in result)) throw new Error("Expected a standalone run");
    expect(await service.read(owner, result.runId)).toMatchObject({
      status: "failed",
      reason: fault === "missing-title" ? "invalid_draft" : "generation_failed",
    });
    expect(await store.recover(owner, result.runId)).toMatchObject({ text });
  },
);
