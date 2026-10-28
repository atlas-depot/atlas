import { Hono } from "hono";
import { describe, expect, it, onTestFinished, vi } from "vite-plus/test";
import { createApp } from "./app.ts";
import { createRequestAuthenticator, requireAuth, type AuthEnv } from "./auth.ts";

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
    expect(response.headers.get("WWW-Authenticate")).toBe('Bearer realm="atlas"');
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
    const secret = "SYNTHETIC_SECRET_NEVER_RETURN";
    const app = createApp(async () => {
      const error = new Error(secret);
      error.name = secret;
      throw error;
    });
    const response = await app.request(`/api/notes/${secret}?token=${secret}`, {
      headers: { Cookie: `session=${secret}` },
    });
    expect(response.status).toBe(500);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({
      error: { code: "INTERNAL_ERROR", message: "Request failed." },
    });
    expect(log).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ method: "GET", route: "/api/notes/:id" }),
    );
    expect(JSON.stringify(log.mock.calls)).not.toContain(secret);
  });

  it("keeps refreshed session headers when a protected handler fails", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    onTestFinished(() => log.mockRestore());
    const protectedRoutes = new Hono<AuthEnv>();
    protectedRoutes.get("/fail", () => {
      throw new Error("SYNTHETIC_FAILURE");
    });
    const app = createApp(
      async (_request, headers) => {
        headers?.append("Set-Cookie", "atlas_session=refreshed; Path=/; HttpOnly");
        return { userId: "user_alice" };
      },
      { protectedRoutes },
    );
    const response = await app.request("/api/fail");
    expect(response.status).toBe(500);
    expect(response.headers.getSetCookie()).toEqual(["atlas_session=refreshed; Path=/; HttpOnly"]);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({
      error: { code: "INTERNAL_ERROR", message: "Request failed." },
    });
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

  it.each(["", "Bearer invalid"])(
    "uses Bearer verification exclusively when Authorization is present: %s",
    async (authorization) => {
      const bearer = vi.fn(async () => null);
      const browser = vi.fn(async () => ({ userId: "cookie-user" }));
      const response = await createApp(createRequestAuthenticator(bearer, browser)).request(
        "/api/notes",
        {
          headers: {
            Authorization: authorization,
            Cookie: "atlas_session=valid-looking-cookie",
          },
        },
      );
      expect(response.status).toBe(401);
      expect(bearer).toHaveBeenCalledTimes(1);
      expect(browser).not.toHaveBeenCalled();
    },
  );

  it("uses the browser session only when Authorization is absent", async () => {
    const bearer = vi.fn(async () => ({ userId: "bearer-user" }));
    const browser = vi.fn(async () => ({ userId: "cookie-user" }));
    const response = await createApp(createRequestAuthenticator(bearer, browser)).request(
      "/api/notes",
      { headers: { Cookie: "atlas_session=valid-looking-cookie" } },
    );
    expect(response.status).toBe(501);
    expect(browser).toHaveBeenCalledTimes(1);
    expect(bearer).not.toHaveBeenCalled();
  });
});
