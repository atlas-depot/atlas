import { describe, expect, it, vi } from "vite-plus/test";
import {
  createConversationClient,
  describeAssistantMessageState,
  describeConversationRecovery,
  formatConversationLabel,
} from "./conversation-store";
import { NotesRequestError } from "./notes-store";

const conversationId = "130c3220-dc86-4fb0-828d-0338cae029d3";
const operationKey = "f943da92-132d-4a7d-bbe8-bd3c402cf745";
const turnId = "6f1c2a8e-3b4d-4c5e-8f90-1a2b3c4d5e6f";
const messageId = "9d0f6a55-6f0e-4d0c-9a53-6f6b3a4c2b11";
const noteId = "f0a10b01-4b98-4d4a-aabb-000000000001";

const sampleConversation = {
  id: conversationId,
  queuePaused: false,
  createdAt: "2026-11-10T12:00:00.000Z",
  updatedAt: "2026-11-10T12:05:00.000Z",
};

describe("conversation client and presentation helpers", () => {
  it("lists, creates, reads, fetches messages, sends, stops, resumes, and deletes conversations", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fakeFetch: typeof fetch = vi.fn(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      calls.push({ url, init });
      if (url.startsWith("/api/conversations?") || url === "/api/conversations") {
        if (init?.method === "POST") {
          return new Response(JSON.stringify(sampleConversation), { status: 201 });
        }
        return new Response(
          JSON.stringify({ conversations: [sampleConversation], nextCursor: "cursor-1" }),
          { status: 200 },
        );
      }
      if (url === `/api/conversations/${conversationId}` && init?.method === "DELETE") {
        return new Response(null, { status: 204 });
      }
      if (url === `/api/conversations/${conversationId}`) {
        return new Response(
          JSON.stringify({
            conversation: sampleConversation,
            activeTurn: null,
            recovery: null,
          }),
          { status: 200 },
        );
      }
      if (url.startsWith(`/api/conversations/${conversationId}/messages`)) {
        if (init?.method === "POST") {
          return new Response(
            JSON.stringify({
              message: {
                id: messageId,
                sequence: 1,
                text: "What is the incident status?",
                createdAt: "2026-11-10T12:01:00.000Z",
                role: "user",
                deliveryPolicy: "queue",
              },
              conversation: sampleConversation,
              activeTurn: null,
              recovery: null,
            }),
            { status: 202 },
          );
        }
        return new Response(
          JSON.stringify({
            messages: [
              {
                id: messageId,
                sequence: 1,
                text: "What is the incident status?",
                createdAt: "2026-11-10T12:01:00.000Z",
                role: "user",
                deliveryPolicy: "queue",
              },
            ],
            nextCursor: null,
          }),
          { status: 200 },
        );
      }
      if (
        (url === `/api/conversations/${conversationId}/stop` ||
          url === `/api/conversations/${conversationId}/resume`) &&
        init?.method === "POST"
      ) {
        return new Response(
          JSON.stringify({
            conversation: {
              ...sampleConversation,
              queuePaused: url.endsWith("/stop"),
            },
            activeTurn: null,
            recovery: null,
          }),
          { status: 200 },
        );
      }
      return new Response(null, { status: 404 });
    });

    const client = createConversationClient(fakeFetch);

    const listed = await client.list({ limit: 25, cursor: "prev-cursor" });
    expect(listed.conversations).toEqual([sampleConversation]);
    expect(listed.nextCursor).toBe("cursor-1");
    expect(calls[0]?.url).toBe("/api/conversations?limit=25&cursor=prev-cursor");

    const created = await client.create(operationKey.toUpperCase());
    expect(created).toEqual(sampleConversation);
    expect(calls[1]?.init?.headers).toEqual({
      "Content-Type": "application/json",
      "Idempotency-Key": operationKey,
    });

    const read = await client.read(conversationId);
    expect(read.conversation.id).toBe(conversationId);

    const history = await client.messages(conversationId, { limit: 50 });
    expect(history.messages).toHaveLength(1);

    const sent = await client.send(
      conversationId,
      { text: "What is the incident status?" },
      operationKey,
    );
    expect(sent.message.text).toBe("What is the incident status?");

    const stopped = await client.stop(conversationId);
    expect(stopped.conversation.queuePaused).toBe(true);

    const resumed = await client.resume(conversationId);
    expect(resumed.conversation.queuePaused).toBe(false);

    await client.delete(conversationId);
    expect(calls.at(-1)).toMatchObject({
      url: `/api/conversations/${conversationId}`,
      init: { method: "DELETE", credentials: "same-origin" },
    });
  });

  it("maps API error responses to NotesRequestError", async () => {
    const fakeFetch: typeof fetch = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          error: { code: "SERVICE_UNAVAILABLE", message: "Storage offline" },
        }),
        { status: 503 },
      );
    });

    const client = createConversationClient(fakeFetch);
    await expect(client.list()).rejects.toEqual(new NotesRequestError(503, "SERVICE_UNAVAILABLE"));
  });

  it("formats conversation labels and distinguishes completed, no-support, and incomplete answers", () => {
    expect(formatConversationLabel(sampleConversation)).toBe(
      "Conversation 130c3220 (2026-11-10 12:00 UTC)",
    );

    const completed = describeAssistantMessageState({
      id: messageId,
      sequence: 2,
      text: "The runbook specifies pgvector.",
      createdAt: "2026-11-10T12:02:00.000Z",
      role: "assistant",
      turnId,
      status: "completed",
      reason: null,
      inputIds: [operationKey],
      citations: [
        {
          source: {
            kind: "block",
            noteId,
            version: `"${noteId}:1"`,
            blockId: "block-1",
            headingPath: [],
          },
          excerpt: "pgvector indexes passages.",
          deleted: false,
          stale: false,
        },
      ],
    });
    expect(completed.isComplete).toBe(true);
    expect(completed.badge).toBe("Supported answer");
    expect(completed.warning).toBeNull();

    const noSupport = describeAssistantMessageState({
      id: messageId,
      sequence: 3,
      text: "",
      createdAt: "2026-11-10T12:03:00.000Z",
      role: "assistant",
      turnId,
      status: "no-support",
      reason: null,
      inputIds: [operationKey],
      citations: [],
    });
    expect(noSupport.isComplete).toBe(false);
    expect(noSupport.badge).toBe("No note support");
    expect(noSupport.emptyFallback).toContain("No supporting passage");

    const cancelled = describeAssistantMessageState({
      id: messageId,
      sequence: 4,
      text: "Partial output",
      createdAt: "2026-11-10T12:04:00.000Z",
      role: "assistant",
      turnId,
      status: "incomplete",
      reason: "cancelled",
      inputIds: [operationKey],
      citations: [],
    });
    expect(cancelled.isComplete).toBe(false);
    expect(cancelled.badge).toBe("Incomplete (cancelled)");
    expect(cancelled.warning).toContain("cancelled before completion");

    const failedEmpty = describeAssistantMessageState({
      id: messageId,
      sequence: 5,
      text: "",
      createdAt: "2026-11-10T12:05:00.000Z",
      role: "assistant",
      turnId,
      status: "incomplete",
      reason: "failed",
      inputIds: [operationKey],
      citations: [],
    });
    expect(failedEmpty.badge).toBe("Incomplete (failed)");
    expect(failedEmpty.emptyFallback).toContain("No answer text was published");

    expect(describeConversationRecovery({ turnId, reason: "source_changed" })).toContain(
      "queue is paused until you resume",
    );
    expect(describeConversationRecovery(null)).toBeNull();
  });
});
