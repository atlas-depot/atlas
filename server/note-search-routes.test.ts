import { describe, expect, it, vi } from "vite-plus/test";
import { createApp } from "./app.ts";
import type { NoteSearchService } from "./note-search-routes.ts";

const vector = Array.from({ length: 1536 }, (_, index) => (index === 0 ? 1 : 0));
const request = (body: unknown) => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

function fixture(authenticated = true) {
  const embed = vi.fn().mockResolvedValue(vector);
  const candidates = vi.fn<NoteSearchService["candidates"]>().mockResolvedValue({
    passages: [],
    coverage: { ready: 0, pending: 1, failed: 0 },
  });
  const app = createApp(async () => (authenticated ? { userId: "verified-owner" } : null), {
    search: { candidates },
    embedSearch: embed,
  });
  return { app, embed, candidates };
}

describe("authenticated note search", () => {
  it("uses verified ownership and returns bounded candidate coverage", async () => {
    const { app, embed, candidates } = fixture();
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
  });

  it("denies anonymous calls before embedding or storage", async () => {
    const { app, embed, candidates } = fixture(false);
    expect((await app.request("/api/note-search", request({ query: "private" }))).status).toBe(401);
    expect(embed).not.toHaveBeenCalled();
    expect(candidates).not.toHaveBeenCalled();
  });

  it("rejects invalid queries, limits and client-supplied control fields", async () => {
    const { app, embed } = fixture();
    for (const body of [
      { query: "  " },
      { query: "x".repeat(501) },
      { query: "valid", limit: 11 },
      { query: "valid", ownerId: "other" },
      { query: "valid", vector },
    ]) {
      expect((await app.request("/api/note-search", request(body))).status).toBe(400);
    }
    expect(embed).not.toHaveBeenCalled();
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
});
