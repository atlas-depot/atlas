import { Hono } from "hono";
import { describe, expect, it, vi } from "vite-plus/test";
import { requireAuth, requireCookieRequestOrigin, type AuthEnv } from "./auth.ts";
import { createOrganizeRoutes, type OrganizeService } from "./organize-routes.ts";
import type { OrganizeRunState } from "./organize-runs.ts";

const noteId = "00000000-0000-4000-8000-000000000001";
const runId = "00000000-0000-4000-8000-000000000002";
const ownerId = "synthetic-owner";
const endpoints = [
  ["POST", `/notes/${noteId}/organize`, "start"],
  ["GET", `/organize-runs/${runId}`, "read"],
  ["POST", `/organize-runs/${runId}/cancel`, "cancel"],
  ["POST", `/organize-runs/${runId}/acknowledge`, "acknowledge"],
] as const;

function service() {
  return {
    start: vi.fn<OrganizeService["start"]>().mockResolvedValue({ runId }),
    read: vi
      .fn<OrganizeService["read"]>()
      .mockResolvedValue({ status: "running", phase: "writing" }),
    cancel: vi.fn<OrganizeService["cancel"]>().mockResolvedValue({ status: "cancelled" }),
    acknowledge: vi.fn<OrganizeService["acknowledge"]>().mockResolvedValue({ status: "expired" }),
  };
}

function app(backend?: OrganizeService, authenticated = true) {
  const routes = new Hono<AuthEnv>();
  routes.use("*", requireCookieRequestOrigin("https://atlas.example"));
  routes.use(
    "*",
    requireAuth(async () => (authenticated ? { userId: ownerId } : null)),
  );
  routes.route("/api", createOrganizeRoutes(backend));
  return routes;
}

describe("organizer HTTP boundary", () => {
  it("accepts empty POST streams supplied by the Node adapter", async () => {
    const backend = service();
    const response = await app(backend).request(`/api/notes/${noteId}/organize`, {
      method: "POST",
      body: "",
      headers: { "Content-Length": "0" },
    });
    expect(response.status).toBe(202);
    expect(backend.start).toHaveBeenCalledWith(ownerId, noteId);
  });

  it("rejects and cancels a chunked payload without waiting for its end", async () => {
    const backend = service();
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("injected"));
      },
      cancel,
    });
    const options = { method: "POST", body, duplex: "half" as const };
    const response = await app(backend).request(`/api/notes/${noteId}/organize`, options);
    expect(response.status).toBe(400);
    expect(cancel).toHaveBeenCalled();
    expect(backend.start).not.toHaveBeenCalled();
  });

  it("bounds a stalled upload before invoking the organizer", async () => {
    vi.useFakeTimers();
    try {
      const backend = service();
      const cancel = vi.fn();
      const body = new ReadableStream<Uint8Array>({ cancel });
      const options = { method: "POST", body, duplex: "half" as const };
      const response = app(backend).request(`/api/notes/${noteId}/organize`, options);
      await vi.advanceTimersByTimeAsync(5_001);
      expect((await response).status).toBe(400);
      expect(cancel).toHaveBeenCalled();
      expect(backend.start).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it.each(endpoints)("requires authentication for %s %s", async (method, path) => {
    const backend = service();
    const response = await app(backend, false).request(`/api${path}`, { method });
    expect(response.status).toBe(401);
    for (const operation of Object.values(backend)) expect(operation).not.toHaveBeenCalled();
    // Absence of configuration must not become an anonymous capability probe.
    expect((await app(undefined, false).request(`/api${path}`, { method })).status).toBe(401);
  });

  it.each(endpoints)("uses only the verified owner for %s %s", async (method, path, action) => {
    const backend = service();
    const response = await app(backend).request(`/api${path}?ownerId=forged&userId=forged`, {
      method,
      headers: { "X-User-Id": "forged" },
    });
    expect(response.status).toBe(action === "start" ? 202 : 200);
    expect(backend[action]).toHaveBeenCalledWith(ownerId, action === "start" ? noteId : runId);
  });

  it.each(endpoints)("rejects malformed IDs before %s %s service access", async (method, path) => {
    const backend = service();
    const response = await app(backend).request(
      `/api${path.replace(/00000000-0000-4000-8000-00000000000[12]/, "bad-id")}`,
      { method },
    );
    expect(response.status).toBe(400);
    for (const operation of Object.values(backend)) expect(operation).not.toHaveBeenCalled();
  });

  it.each(endpoints.filter(([method]) => method === "POST"))(
    "rejects client input for %s %s",
    async (method, path) => {
      const backend = service();
      const response = await app(backend).request(`/api${path}`, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ownerId: "forged",
          content: "Injected note",
          runtimeUrl: "https://attacker.example",
        }),
      });
      expect(response.status).toBe(400);
      for (const operation of Object.values(backend)) expect(operation).not.toHaveBeenCalled();
    },
  );

  it.each(endpoints)(
    "returns sanitized 503 when %s %s is unavailable or throws",
    async (method, path, action) => {
      expect((await app().request(`/api${path}`, { method })).status).toBe(503);
      const backend = service();
      backend[action].mockRejectedValue(new Error("SYNTHETIC_SECRET_PRIVATE_RUNTIME"));
      const response = await app(backend).request(`/api${path}`, { method });
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({
        error: { code: "SERVICE_UNAVAILABLE", message: "Organizer is temporarily unavailable." },
      });
    },
  );

  it.each(endpoints)(
    "hides inaccessible and missing resources for %s %s",
    async (method, path, action) => {
      const backend = service();
      backend[action].mockResolvedValue({ status: "not_found" });
      const response = await app(backend).request(`/api${path}`, { method });
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({
        error: { code: "NOT_FOUND", message: "Resource not found." },
      });
    },
  );

  it("exposes acceptance and pending cleanup without runtime identifiers", async () => {
    const backend = service();
    const routes = app(backend);
    expect(
      await (await routes.request(`/api/notes/${noteId}/organize`, { method: "POST" })).json(),
    ).toEqual({ runId, status: "accepted" });
    backend.start.mockResolvedValue({ runId, status: "cleanup_pending" });
    const response = await routes.request(`/api/notes/${noteId}/organize`, { method: "POST" });
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ runId, status: "cleanup_pending" });
  });

  it("returns a sourced stale draft while omitting backend metadata", async () => {
    const backend = service();
    const draft = {
      markdown: "## Research\nA sourced draft.",
      sources: [
        {
          id: "s1",
          url: "https://example.com/source",
          title: "Source",
          imageUrl: "https://example.com/image.png",
        },
      ],
    };
    const source = { noteId, revision: 3, stale: true };
    const internal = {
      status: "draft" as const,
      draft,
      source,
      runtimeUrl: "https://private.example",
      sessionId: "SYNTHETIC_SECRET",
      usage: { costUsd: 2, complete: true },
    };
    backend.read.mockResolvedValue(internal);
    const response = await app(backend).request(`/api/organize-runs/${runId}`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ runId, status: "draft", draft, source });
  });

  it("keeps progress timestamps and stalled state available to reconnecting clients", async () => {
    const backend = service();
    backend.read.mockResolvedValue({
      status: "running",
      phase: "researching",
      phaseStartedAt: 1000,
      lastProgressAt: 2000,
      stalled: true,
    });
    const response = await app(backend).request(`/api/organize-runs/${runId}`);
    expect(await response.json()).toEqual({
      runId,
      status: "running",
      phase: "researching",
      phaseStartedAt: 1000,
      lastProgressAt: 2000,
      stalled: true,
    });
    expect(backend.start).not.toHaveBeenCalled();
  });

  it.each(["cancel", "acknowledge"] as const)(
    "reports pending cleanup on %s without claiming success",
    async (action) => {
      const backend = service();
      for (const state of [
        { status: "cleaning" },
        { status: "failed", reason: "cleanup_failed" },
      ] as const) {
        backend[action].mockResolvedValue(state);
        const response = await app(backend).request(`/api/organize-runs/${runId}/${action}`, {
          method: "POST",
        });
        expect(response.status).toBe(202);
        expect(await response.json()).toEqual({ runId, ...state });
      }
    },
  );

  it("does not acknowledge an unfinished run", async () => {
    const backend = service();
    backend.acknowledge.mockResolvedValue({ status: "running", phase: "starting" });
    const response = await app(backend).request(`/api/organize-runs/${runId}/acknowledge`, {
      method: "POST",
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: "CONFLICT" } });
    expect(backend.cancel).not.toHaveBeenCalled();
  });

  it("rejects malformed backend output rather than exposing an invalid draft", async () => {
    const backend = service();
    backend.read.mockResolvedValue({
      status: "draft",
      draft: { markdown: "", sources: [] },
      source: { noteId, revision: 1, stale: false },
    });
    const response = await app(backend).request(`/api/organize-runs/${runId}`);
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: { code: "SERVICE_UNAVAILABLE" } });
    backend.start.mockResolvedValue({ runId: "private-invalid-id" });
    expect(
      (await app(backend).request(`/api/notes/${noteId}/organize`, { method: "POST" })).status,
    ).toBe(503);
  });

  it.each(["cancelled", "expired"] as const)(
    "returns %s tombstones without starting new work",
    async (status) => {
      const backend = service();
      backend.read.mockResolvedValue({ status });
      const response = await app(backend).request(`/api/organize-runs/${runId}`);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ runId, status });
      expect(backend.start).not.toHaveBeenCalled();
    },
  );

  it("preserves stable failure states on read", async () => {
    const backend = service();
    for (const reason of [
      "generation_failed",
      "invalid_draft",
      "read_failed",
      "cleanup_failed",
    ] as const) {
      backend.read.mockResolvedValue({ status: "failed", reason } satisfies OrganizeRunState);
      const response = await app(backend).request(`/api/organize-runs/${runId}`);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ runId, status: "failed", reason });
    }
  });

  it.each(endpoints.filter(([method]) => method === "POST"))(
    "denies cross-origin cookie requests for %s %s",
    async (method, path) => {
      const backend = service();
      const response = await app(backend).request(`/api${path}`, {
        method,
        headers: { Cookie: "atlas_session=synthetic", Origin: "https://attacker.example" },
      });
      expect(response.status).toBe(403);
      for (const operation of Object.values(backend)) expect(operation).not.toHaveBeenCalled();
    },
  );
});
