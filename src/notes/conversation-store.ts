import { apiErrorSchema } from "../../shared/http";
import {
  conversationHistorySchema,
  conversationIdSchema,
  conversationListSchema,
  conversationOperationKeySchema,
  conversationPageSchema,
  conversationReadSchema,
  conversationSchema,
  conversationSendSchema,
  createConversationSchema,
  sendConversationMessageSchema,
  type Conversation,
  type ConversationHistory,
  type ConversationList,
  type ConversationMessage,
  type ConversationRead,
  type ConversationSend,
} from "../../shared/conversations";
import { boundedFetch } from "../lib/http";
import { NotesRequestError } from "./notes-store";

export type AssistantConversationMessage = Extract<ConversationMessage, { role: "assistant" }>;
export type UserConversationMessage = Extract<ConversationMessage, { role: "user" }>;

export interface ConversationClient {
  list(page?: { limit?: number; cursor?: string }): Promise<ConversationList>;
  create(key: string): Promise<Conversation>;
  read(id: string): Promise<ConversationRead>;
  messages(id: string, page?: { limit?: number; cursor?: string }): Promise<ConversationHistory>;
  delete(id: string): Promise<void>;
  send(
    id: string,
    input: { text: string; policy?: "queue" | "steer" },
    key: string,
  ): Promise<ConversationSend>;
  stop(id: string): Promise<ConversationRead>;
  resume(id: string): Promise<ConversationRead>;
}

function buildPageQuery(page?: { limit?: number; cursor?: string }): string {
  if (!page) return "";
  const validated = conversationPageSchema.parse(page);
  const params = new URLSearchParams();
  params.set("limit", String(validated.limit));
  if (validated.cursor !== undefined) {
    params.set("cursor", validated.cursor);
  }
  const query = params.toString();
  return query ? `?${query}` : "";
}

/** Same-origin private API; credentials stay in the browser's HttpOnly cookie. */
export function createConversationClient(
  request: typeof fetch = globalThis.fetch,
  timeoutMs = 30_000,
): ConversationClient {
  async function sendRequest(path: string, init: RequestInit = {}): Promise<Response> {
    const result = await boundedFetch(
      `/api/conversations${path}`,
      {
        ...init,
        credentials: "same-origin",
      },
      timeoutMs,
      request,
    );
    if (!result.ok) {
      const error = apiErrorSchema.safeParse(await result.json().catch(() => null));
      throw new NotesRequestError(
        result.status,
        error.success ? error.data.error.code : "INVALID_RESPONSE",
      );
    }
    return result;
  }

  return {
    async list(page) {
      const query = buildPageQuery(page);
      const response = await sendRequest(query);
      return conversationListSchema.parse(await response.json());
    },

    async create(key) {
      const normalizedKey = conversationOperationKeySchema.parse(key);
      const body = createConversationSchema.parse({});
      const response = await sendRequest("", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": normalizedKey,
        },
        body: JSON.stringify(body),
      });
      return conversationSchema.parse(await response.json());
    },

    async read(id) {
      const normalizedId = conversationIdSchema.parse(id);
      const response = await sendRequest(`/${normalizedId}`);
      return conversationReadSchema.parse(await response.json());
    },

    async messages(id, page) {
      const normalizedId = conversationIdSchema.parse(id);
      const query = buildPageQuery(page);
      const response = await sendRequest(`/${normalizedId}/messages${query}`);
      return conversationHistorySchema.parse(await response.json());
    },

    async delete(id) {
      const normalizedId = conversationIdSchema.parse(id);
      await sendRequest(`/${normalizedId}`, {
        method: "DELETE",
      });
    },

    async send(id, input, key) {
      const normalizedId = conversationIdSchema.parse(id);
      const normalizedKey = conversationOperationKeySchema.parse(key);
      const payload = sendConversationMessageSchema.parse(input);
      const response = await sendRequest(`/${normalizedId}/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": normalizedKey,
        },
        body: JSON.stringify(payload),
      });
      return conversationSendSchema.parse(await response.json());
    },

    async stop(id) {
      const normalizedId = conversationIdSchema.parse(id);
      const response = await sendRequest(`/${normalizedId}/stop`, {
        method: "POST",
      });
      return conversationReadSchema.parse(await response.json());
    },

    async resume(id) {
      const normalizedId = conversationIdSchema.parse(id);
      const response = await sendRequest(`/${normalizedId}/resume`, {
        method: "POST",
      });
      return conversationReadSchema.parse(await response.json());
    },
  };
}

export function formatConversationLabel(conversation: Conversation): string {
  const shortId = conversation.id.slice(0, 8);
  const datePart = conversation.createdAt.slice(0, 16).replace("T", " ");
  return `Conversation ${shortId} (${datePart} UTC)`;
}

export type AssistantAnswerPresentation = {
  badge: string;
  warning: string | null;
  emptyFallback: string | null;
  isComplete: boolean;
};

export function describeAssistantMessageState(
  message: AssistantConversationMessage,
): AssistantAnswerPresentation {
  if (message.status === "completed") {
    return {
      badge: "Supported answer",
      warning: null,
      emptyFallback: null,
      isComplete: true,
    };
  }
  if (message.status === "no-support") {
    return {
      badge: "No note support",
      warning: "No supporting passage was found in your indexed notes for this turn.",
      emptyFallback:
        message.text.trim().length === 0 ? "No supporting passage was found in your notes." : null,
      isComplete: false,
    };
  }
  const cancelled = message.reason === "cancelled";
  return {
    badge: cancelled ? "Incomplete (cancelled)" : "Incomplete (failed)",
    warning: cancelled
      ? "This answer was cancelled before completion and is not treated as completed evidence."
      : "This answer ended with a failure before completion and is not treated as completed evidence.",
    emptyFallback:
      message.text.trim().length === 0
        ? cancelled
          ? "Answer generation was cancelled before any output was published."
          : "No answer text was published before this attempt failed."
        : null,
    isComplete: false,
  };
}

export function describeConversationRecovery(
  recovery: ConversationRead["recovery"],
): string | null {
  if (!recovery) return null;
  switch (recovery.reason) {
    case "source_changed":
      return "A cited or context source note changed or was deleted. The queue is paused until you resume.";
    case "context_budget":
      return "This conversation reached the context size limit for the last attempt. The queue is paused until you resume.";
    case "summary_failed":
      return "Earlier conversation context could not be compacted. The queue is paused until you resume.";
    case "history_unavailable":
      return "Earlier conversation history could not be verified for context. The queue is paused until you resume.";
    case "runtime_expired":
      return "The previous answer runtime session expired. The queue is paused until you resume.";
  }
}
