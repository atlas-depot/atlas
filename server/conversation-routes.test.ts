import { describe, expect, it, vi } from "vite-plus/test";
import { createApp } from "./app.ts";
import type { ConversationAnswerService } from "./conversation-answers.ts";
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
  });
});

describe("conversation answer HTTP boundary", () => {
  const message = {
    id: "9d0f6a55-6f0e-4d0c-9a53-6f6b3a4c2b11",
    sequence: 1,
    text: "When is the meeting?",
    createdAt: "2026-11-10T12:00:00.000Z",
    role: "user" as const,
    deliveryPolicy: "steer" as const,
  };
  function answering(authenticated = true) {
    const base = fixture(authenticated);
    const answers = {
      send: vi
        .fn<ConversationAnswerService["send"]>()
        .mockResolvedValue({ status: "saved", value: message }),
      refresh: vi.fn<ConversationAnswerService["refresh"]>().mockResolvedValue(undefined),
      stop: vi.fn<ConversationAnswerService["stop"]>().mockResolvedValue({ status: "not_found" }),
      resume: vi.fn<ConversationAnswerService["resume"]>().mockResolvedValue({ status: "resumed" }),
      retry: vi.fn<ConversationAnswerService["retry"]>().mockResolvedValue({ status: "paused" }),
      sweep: vi.fn<ConversationAnswerService["sweep"]>(),
    };
    return {
      ...base,
      answers,
      app: createApp(async () => (authenticated ? { userId: "verified-owner" } : null), {
        conversations: base.store,
        answers,
      }),
    };
  }
  const send = (body: unknown, headers: Record<string, string> = { "Idempotency-Key": key }) => ({
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });

  it("authorizes before any answer work and passes only the verified owner and the caller's policy", async () => {
    const denied = answering(false);
    for (const path of ["messages", "stop", "resume", `turns/${id}/retry`])
      expect(
        (await denied.app.request(`/api/conversations/${id}/${path}`, send({ text: "x" }))).status,
      ).toBe(401);
    expect(denied.answers.send).not.toHaveBeenCalled();

    const { app, answers } = answering();
    const response = await app.request(
      `/api/conversations/${id}/messages`,
      send({ text: "When is the meeting?", policy: "steer" }),
    );
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ message, conversation, activeTurn: null });
    expect(answers.send).toHaveBeenCalledExactlyOnceWith("verified-owner", id, key, {
      text: "When is the meeting?",
      policy: "steer",
    });
    for (const body of [
      { text: " " },
      { text: "x", policy: "interrupt" },
      { text: "x", ownerId: "o" },
    ])
      expect((await app.request(`/api/conversations/${id}/messages`, send(body))).status).toBe(400);
    expect(
      (await app.request(`/api/conversations/${id}/messages`, send({ text: "x" }, {}))).status,
    ).toBe(400);
    expect(answers.send).toHaveBeenCalledOnce();
  });

  it("reports a refused steer, a rate limit and missing service instead of accepting silently", async () => {
    const { app, answers } = answering();
    const post = () => app.request(`/api/conversations/${id}/messages`, send({ text: "x" }));
    answers.send.mockResolvedValueOnce({ status: "policy_unsupported" });
    expect((await post()).status).toBe(409);
    answers.send.mockResolvedValueOnce({ status: "rate_limited", retryAfterSeconds: 7 });
    const limited = await post();
    expect([limited.status, limited.headers.get("Retry-After")]).toEqual([429, "7"]);
    answers.send.mockResolvedValueOnce({ status: "not_found" });
    expect((await post()).status).toBe(404);
    expect((await app.request(`/api/conversations/${id}/stop`, { method: "POST" })).status).toBe(
      404,
    );
    expect(
      (
        await app.request(`/api/conversations/${id}/turns/${id}/retry`, {
          method: "POST",
          headers: { "Idempotency-Key": key },
        })
      ).status,
    ).toBe(409);
    expect(
      (await fixture().app.request(`/api/conversations/${id}/messages`, send({ text: "x" })))
        .status,
    ).toBe(503);
  });

  it("continues existing work on a read instead of starting more", async () => {
    const { app, answers } = answering();
    expect((await app.request(`/api/conversations/${id}`)).status).toBe(200);
    expect(answers.refresh).toHaveBeenCalledExactlyOnceWith("verified-owner", id);
    expect(answers.send).not.toHaveBeenCalled();
  });
});
