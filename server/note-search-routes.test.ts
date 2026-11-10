import { describe, expect, it, vi } from "vite-plus/test";
import { createApp } from "./app.ts";
import type { NoteSearchService, SearchAdmission } from "./note-search-routes.ts";

const vector = Array.from({ length: 1536 }, (_, index) => (index === 0 ? 1 : 0));
const request = (body: unknown) => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

function fixture(authenticated = true) {
  const embed = vi.fn().mockResolvedValue(vector);
  const admit = vi.fn<SearchAdmission>().mockResolvedValue({ allowed: true });
  const candidates = vi.fn<NoteSearchService["candidates"]>().mockResolvedValue({
    passages: [],
    coverage: { ready: 0, pending: 1, failed: 0 },
  });
  const app = createApp(async () => (authenticated ? { userId: "verified-owner" } : null), {
    search: { candidates },
    embedSearch: embed,
    admitSearch: admit,
  });
  return { app, embed, candidates, admit };
}

describe("authenticated note search", () => {
  it("uses verified ownership and returns bounded candidate coverage", async () => {
    const { app, embed, candidates, admit } = fixture();
    const response = await app.request(
      "/api/note-search?ownerId=foreign",
      request({
        query: "  Where is the meeting?  ",
        limit: 3,
      }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({
      candidates: [],
      coverage: { ready: 0, pending: 1, failed: 0 },
    });
    expect(embed).toHaveBeenCalledExactlyOnceWith("Where is the meeting?");
    expect(candidates).toHaveBeenCalledExactlyOnceWith("verified-owner", vector, 3);
    expect(admit).toHaveBeenCalledExactlyOnceWith("verified-owner");
  });

  it("denies anonymous calls before embedding or storage", async () => {
    const { app, embed, candidates, admit } = fixture(false);
    expect((await app.request("/api/note-search", request({ query: "private" }))).status).toBe(401);
    expect(embed).not.toHaveBeenCalled();
    expect(candidates).not.toHaveBeenCalled();
    expect(admit).not.toHaveBeenCalled();
  });

  it("rejects invalid queries, limits and client-supplied control fields", async () => {
    const { app, embed, admit } = fixture();
    for (const body of [
      { query: "  " },
      { query: "x".repeat(501) },
      { query: "bad\0query" },
      { query: "bad\ud800query" },
      { query: "valid", limit: 11 },
      { query: "valid", ownerId: "other" },
      { query: "valid", vector },
    ]) {
      expect((await app.request("/api/note-search", request(body))).status).toBe(400);
    }
    expect(embed).not.toHaveBeenCalled();
    expect(admit).not.toHaveBeenCalled();
  });

  it("distinguishes sanitized embedding and storage failures", async () => {
    const { app, embed, candidates } = fixture();
    embed.mockRejectedValueOnce(new Error("private provider detail"));
    const provider = await app.request("/api/note-search", request({ query: "x" }));
    expect(provider.status).toBe(503);
    expect(await provider.text()).toContain("Search embedding is unavailable.");
    candidates.mockRejectedValueOnce(new Error("private storage detail"));
    const storage = await app.request("/api/note-search", request({ query: "x" }));
    expect(storage.status).toBe(503);
    expect(await storage.text()).toContain("Search storage is unavailable.");
  });

  it("denies exhausted admission before calling the embedding provider", async () => {
    const { app, embed, candidates, admit } = fixture();
    admit.mockResolvedValueOnce({ allowed: false, retryAfterSeconds: 17 });
    const response = await app.request("/api/note-search", request({ query: "x" }));
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("17");
    expect(await response.text()).toContain("RATE_LIMITED");
    expect(embed).not.toHaveBeenCalled();
    expect(candidates).not.toHaveBeenCalled();
  });

  it("fails closed when admission storage is unavailable", async () => {
    const { app, embed, admit } = fixture();
    admit.mockRejectedValueOnce(new Error("private admission detail"));
    const response = await app.request("/api/note-search", request({ query: "x" }));
    expect(response.status).toBe(503);
    expect(await response.text()).toContain("Search admission is unavailable.");
    expect(embed).not.toHaveBeenCalled();
  });

  it("keeps failed provider attempts admitted and does not refund before a retry", async () => {
    const { app, embed, admit } = fixture();
    embed.mockRejectedValueOnce(new Error("provider failed"));
    admit.mockResolvedValueOnce({ allowed: true });
    admit.mockResolvedValueOnce({ allowed: false, retryAfterSeconds: 60 });
    expect((await app.request("/api/note-search", request({ query: "x" }))).status).toBe(503);
    expect((await app.request("/api/note-search", request({ query: "x" }))).status).toBe(429);
    expect(admit).toHaveBeenCalledTimes(2);
    expect(embed).toHaveBeenCalledTimes(1);
  });

  it("requires admission configuration before paying for a search", async () => {
    const { embed, candidates } = fixture();
    const app = createApp(async () => ({ userId: "verified-owner" }), {
      search: { candidates },
      embedSearch: embed,
    });
    expect((await app.request("/api/note-search", request({ query: "x" }))).status).toBe(503);
    expect(embed).not.toHaveBeenCalled();
  });
});
