import { Hono } from "hono";
import { describe, expect, it, onTestFinished, vi } from "vite-plus/test";
import { createApp } from "./app.ts";
import { requireAuth, type AuthEnv } from "./auth.ts";

describe("Hono authentication boundary", () => {
  it.each([
    ["GET", "/api/notes"],
    ["POST", "/api/notes"],
    ["GET", "/api/notes/any-id"],
    ["PUT", "/api/notes/any-id"],
    ["DELETE", "/api/notes/any-id"],
  ])("rejects %s %s without a verified session", async (method, path) => {
    const response = await createApp(async () => null).request(`${path}?userId=forged`, {
      method,
      headers: { "X-User-Id": "forged", Authorization: "Bearer fake", Cookie: "session=fake" },
    });
    expect(response.status).toBe(401);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toMatchObject({ error: { code: "UNAUTHENTICATED" } });
  });

  it("allows authenticated requests to reach the note routes", async () => {
    const app = createApp(async () => ({ userId: "synthetic-user-a" }));
    const response = await app.request("/api/notes");
    expect(response.status).toBe(501);
    expect(await response.json()).toEqual({
      error: { code: "NOT_IMPLEMENTED", message: "Note storage is not connected yet." },
    });
  });

  it("does not leak exceptions from session verification", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    onTestFinished(() => {
      log.mockRestore();
    });
    const app = createApp(async () => {
      throw new Error("SYNTHETIC_SECRET_NEVER_RETURN");
    });
    const response = await app.request("/api/notes");
    expect(response.status).toBe(500);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({
      error: { code: "INTERNAL_ERROR", message: "Request failed." },
    });
    expect(log).toHaveBeenCalled();
    expect(JSON.stringify(log.mock.calls)).not.toContain("SYNTHETIC_SECRET_NEVER_RETURN");
  });

  it("returns JSON for unknown routes", async () => {
    const response = await createApp(async () => null).request("/missing");
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: { code: "NOT_FOUND", message: "Route not found." },
    });
  });

  it("supplies verified identity to any protected resource, not client-supplied identity", async () => {
    const app = new Hono<AuthEnv>();
    app.use(
      "*",
      requireAuth(async () => ({ userId: "verified-user" })),
    );
    app.get("/identity", (c) => c.json(c.get("user")));
    const response = await app.request("/identity?userId=forged");
    expect(await response.json()).toEqual({ userId: "verified-user" });
  });
});
