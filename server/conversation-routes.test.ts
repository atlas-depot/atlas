import { describe, expect, it, vi } from "vite-plus/test";
import { createApp } from "./app.ts";
import type { ConversationService } from "./conversation-routes.ts";

const id = "130c3220-dc86-4fb0-828d-0338cae029d3";
const key = "f943da92-132d-4a7d-bbe8-bd3c402cf745";
const conversation = {
  id,
  queuePaused: false,
  createdAt: "2026-11-10T12:00:00.000Z",
  updatedAt: "2026-11-10T12:00:00.000Z",
};
function fixture(authenticated = true) {
  const store = {
    createIdempotent: vi
      .fn<ConversationService["createIdempotent"]>()
      .mockResolvedValue({ status: "saved", value: conversation }),
    list: vi
      .fn<ConversationService["list"]>()
      .mockResolvedValue({ conversations: [conversation], nextCursor: null }),
    read: vi
      .fn<ConversationService["read"]>()
      .mockResolvedValue({ conversation, activeTurn: null }),
    messages: vi
      .fn<ConversationService["messages"]>()
      .mockResolvedValue({ messages: [], nextCursor: null }),
    delete: vi.fn<ConversationService["delete"]>().mockResolvedValue({ status: "deleted" }),
  };
  return {
    store,
    app: createApp(async () => (authenticated ? { userId: "verified-owner" } : null), {
      conversations: store,
    }),
  };
}
const create = (body: unknown = {}) => ({
  method: "POST",
  headers: { "Content-Type": "application/json", "Idempotency-Key": key },
  body: JSON.stringify(body),
});

describe("conversation HTTP boundary", () => {
  it("requires identity on every route and takes ownership only from auth", async () => {
    const unauthenticated = fixture(false);
    for (const path of ["", `/${id}`, `/${id}/messages`])
      expect((await unauthenticated.app.request(`/api/conversations${path}`)).status).toBe(401);
    expect((await unauthenticated.app.request("/api/conversations", create())).status).toBe(401);
    expect(
      (await unauthenticated.app.request(`/api/conversations/${id}`, { method: "DELETE" })).status,
    ).toBe(401);
    const { app, store } = fixture();
    expect((await app.request("/api/conversations", create())).status).toBe(201);
    expect(store.createIdempotent).toHaveBeenCalledExactlyOnceWith("verified-owner", key, {});
    expect((await app.request("/api/conversations?ownerId=other")).status).toBe(400);
  });
  it("accepts only an empty creation object and a UUID idempotency key", async () => {
    const { app, store } = fixture();
    for (const body of [null, [], { title: "name" }, { ownerId: "other" }])
      expect((await app.request("/api/conversations", create(body))).status).toBe(400);
    expect((await app.request("/api/conversations", { method: "POST", body: "{}" })).status).toBe(
      400,
    );
    expect(store.createIdempotent).not.toHaveBeenCalled();
    store.createIdempotent.mockResolvedValue({ status: "conflict" });
    expect((await app.request("/api/conversations", create())).status).toBe(409);
  });
  it("bounds and validates cursors before touching storage", async () => {
    const { app, store } = fixture();
    for (const query of ["limit=0", "limit=101", "limit=1.5", "cursor=bad", "cursor="])
      expect((await app.request(`/api/conversations?${query}`)).status).toBe(400);
    expect(store.list).not.toHaveBeenCalled();
    expect((await app.request("/api/conversations")).status).toBe(200);
    expect(store.list).toHaveBeenCalledExactlyOnceWith("verified-owner", { limit: 50 });
    for (const cursor of ["-1", "0", "1e2", "2147483648"])
      expect((await app.request(`/api/conversations/${id}/messages?cursor=${cursor}`)).status).toBe(
        400,
      );
    expect(
      (await app.request(`/api/conversations/${id}/messages?limit=100&cursor=12`)).status,
    ).toBe(200);
    expect(store.messages).toHaveBeenCalledExactlyOnceWith("verified-owner", id, {
      limit: 100,
      cursor: "12",
    });
  });
  it("rejects a year-zero list cursor before querying PostgreSQL", async () => {
    const { app, store } = fixture();
    const cursor = Buffer.from(JSON.stringify({ id, createdAt: "0000-01-01T00:00:00Z" })).toString(
      "base64url",
    );
    expect((await app.request(`/api/conversations?cursor=${cursor}`)).status).toBe(400);
    expect(store.list).not.toHaveBeenCalled();
  });
  it("hides foreign and missing IDs and rejects delete bodies", async () => {
    const { app, store } = fixture();
    store.read.mockResolvedValue(undefined);
    store.messages.mockResolvedValue(undefined);
    store.delete.mockResolvedValue({ status: "not_found" });
    expect((await app.request(`/api/conversations/${id}`)).status).toBe(404);
    expect((await app.request(`/api/conversations/${id}/messages`)).status).toBe(404);
    expect((await app.request(`/api/conversations/${id}`, { method: "DELETE" })).status).toBe(404);
    expect(
      (await app.request(`/api/conversations/${id}`, { method: "DELETE", body: "{}" })).status,
    ).toBe(400);
    expect((await app.request("/api/conversations/not-uuid")).status).toBe(400);
    store.delete.mockResolvedValue({ status: "deleted" });
    expect((await app.request(`/api/conversations/${id}`, { method: "DELETE" })).status).toBe(204);
  });
  it("sanitizes storage failures and rejects unexpected metadata in public results", async () => {
    const { app, store } = fixture();
    store.read.mockRejectedValueOnce(new Error("secret runtime URL"));
    const result = await app.request(`/api/conversations/${id}`);
    expect(result.status).toBe(503);
    expect(await result.text()).not.toContain("secret");
    store.read.mockResolvedValue({
      conversation: { ...conversation, runtimeUrl: "private" },
      activeTurn: null,
    } as never);
    expect((await app.request(`/api/conversations/${id}`)).status).toBe(503);
    expect(
      (await app.request(`/api/conversations/${id}/messages`, { method: "POST", body: "{}" }))
        .status,
    ).toBe(404);
  });
});
