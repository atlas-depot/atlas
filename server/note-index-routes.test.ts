import { describe, expect, it, vi } from "vite-plus/test";
import { createApp } from "./app.ts";
import type { NoteIndexService } from "./note-index-routes.ts";

const id = "130c3220-dc86-4fb0-828d-0338cae029d3";
const version = JSON.stringify(`${id}:3`);
const path = `/api/notes/${id}/index`;
function fixture(authenticated = true) {
  const getStatus = vi
    .fn<NoteIndexService["getStatus"]>()
    .mockResolvedValue({ status: "pending", version });
  const app = createApp(async () => (authenticated ? { userId: "verified-owner" } : null), {
    indexing: { getStatus },
  });
  return { app, getStatus };
}

describe("authenticated note index status", () => {
  it("uses only authenticated ownership and returns current version without control-plane data", async () => {
    const { app, getStatus } = fixture();
    const response = await app.request(`${path}?ownerId=other`);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ status: "pending", version });
    expect(getStatus).toHaveBeenCalledExactlyOnceWith("verified-owner", id);
  });
  it("rejects missing identity before storage access", async () => {
    const { app, getStatus } = fixture(false);
    expect((await app.request(path)).status).toBe(401);
    expect(getStatus).not.toHaveBeenCalled();
  });
  it("validates IDs, hides missing or foreign notes and exposes no retry mutation", async () => {
    const { app, getStatus } = fixture();
    expect((await app.request("/api/notes/bad/index")).status).toBe(400);
    expect(getStatus).not.toHaveBeenCalled();
    getStatus.mockResolvedValue(undefined);
    expect((await app.request(path)).status).toBe(404);
    expect((await app.request(`${path}/retry`, { method: "POST" })).status).toBe(404);
  });
  it("fails closed on database errors or invalid status payloads", async () => {
    const { app, getStatus } = fixture();
    getStatus.mockRejectedValueOnce(new Error("private database details"));
    const response = await app.request(path);
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("private database");
    getStatus.mockResolvedValue({ status: "ready", version, passageCount: -1 });
    expect((await app.request(path)).status).toBe(503);
  });
});
