import { describe, expect, it } from "vite-plus/test";
import { createApp } from "./app.ts";

describe("Hono authentication boundary", () => {
  it.each([
    ["GET", "/api/notes"],
    ["POST", "/api/notes"],
    ["GET", "/api/notes/any-id"],
    ["PUT", "/api/notes/any-id"],
    ["DELETE", "/api/notes/any-id"],
  ])("rejects %s %s without a verified session", async (method, path) => {
    const response = await createApp().request(`${path}?userId=forged`, {
      method,
      headers: { "X-User-Id": "forged", Authorization: "Bearer fake", Cookie: "session=fake" },
    });
    expect(response.status).toBe(401);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({
      error: { code: "UNAUTHENTICATED", message: "Sign in to access notes." },
    });
  });

  it("allows a trusted resolver through the guard without claiming storage exists", async () => {
    const app = createApp(async () => ({ userId: "synthetic-user-a" }));
    const response = await app.request("/api/notes");
    expect(response.status).toBe(501);
    expect(await response.json()).toEqual({
      error: { code: "NOT_IMPLEMENTED", message: "Note storage is not connected yet." },
    });
  });

  it("does not leak exceptions from session verification", async () => {
    const app = createApp(async () => {
      throw new Error("SYNTHETIC_SECRET_NEVER_RETURN");
    });
    const response = await app.request("/api/notes");
    expect(response.status).toBe(500);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({
      error: { code: "INTERNAL_ERROR", message: "Request failed." },
    });
  });

  it("returns JSON for unknown routes", async () => {
    const response = await createApp().request("/api/missing");
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: { code: "NOT_FOUND", message: "Route not found." },
    });
  });
});
