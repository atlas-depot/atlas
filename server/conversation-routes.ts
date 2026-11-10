import { Hono } from "hono";
import { apiError } from "../shared/http.ts";
import {
  conversationHistorySchema,
  conversationIdSchema,
  conversationListSchema,
  conversationOperationKeySchema,
  conversationPageSchema,
  conversationReadSchema,
  conversationSchema,
  createConversationSchema,
} from "../shared/conversations.ts";
import type { AuthEnv } from "./auth.ts";
import type { createConversationStore } from "./db/conversations.ts";
import { parseConversationCursor, parseMessageCursor } from "./db/conversation-cursors.ts";
import { reportStorageFailure } from "./http-errors.ts";
import { hasEmptyBody, readJson } from "./request-body.ts";

export type ConversationService = ReturnType<typeof createConversationStore>;
const invalid = () => apiError("VALIDATION_ERROR", "Invalid conversation request.");
const unavailable = () =>
  apiError("SERVICE_UNAVAILABLE", "Conversation storage is temporarily unavailable.");
const notFound = () => apiError("NOT_FOUND", "Conversation not found.");

/** Mounted behind verified authentication and cookie-origin protection. */
export function createConversationRoutes(store?: ConversationService) {
  const routes = new Hono<AuthEnv>();
  routes.post("/", async (c) => {
    if (!store) return c.json(unavailable(), 503);
    const key = conversationOperationKeySchema.safeParse(c.req.header("Idempotency-Key"));
    const input = createConversationSchema.safeParse(await readJson(c.req.raw));
    if (!key.success || !input.success) return c.json(invalid(), 400);
    try {
      const result = await store.createIdempotent(c.get("user").userId, key.data, input.data);
      if (result.status === "conflict")
        return c.json(
          apiError("CONFLICT", "This creation key cannot be reused for this conversation."),
          409,
        );
      return c.json(conversationSchema.parse(result.value), 201);
    } catch (error) {
      reportStorageFailure(c, error);
      return c.json(unavailable(), 503);
    }
  });
  routes.get("/", async (c) => {
    if (!store) return c.json(unavailable(), 503);
    const page = conversationPageSchema.safeParse(c.req.query());
    if (!page.success) return c.json(invalid(), 400);
    try {
      parseConversationCursor(page.data.cursor);
    } catch {
      return c.json(invalid(), 400);
    }
    try {
      return c.json(
        conversationListSchema.parse(await store.list(c.get("user").userId, page.data)),
      );
    } catch (error) {
      reportStorageFailure(c, error);
      return c.json(unavailable(), 503);
    }
  });
  routes.get("/:id/messages", async (c) => {
    if (!store) return c.json(unavailable(), 503);
    const id = conversationIdSchema.safeParse(c.req.param("id"));
    const page = conversationPageSchema.safeParse(c.req.query());
    if (!id.success || !page.success) return c.json(invalid(), 400);
    try {
      parseMessageCursor(page.data.cursor);
    } catch {
      return c.json(invalid(), 400);
    }
    try {
      const value = await store.messages(c.get("user").userId, id.data, page.data);
      return value ? c.json(conversationHistorySchema.parse(value)) : c.json(notFound(), 404);
    } catch (error) {
      reportStorageFailure(c, error);
      return c.json(unavailable(), 503);
    }
  });
  routes.get("/:id", async (c) => {
    if (!store) return c.json(unavailable(), 503);
    const id = conversationIdSchema.safeParse(c.req.param("id"));
    if (!id.success) return c.json(invalid(), 400);
    try {
      const value = await store.read(c.get("user").userId, id.data);
      return value ? c.json(conversationReadSchema.parse(value)) : c.json(notFound(), 404);
    } catch (error) {
      reportStorageFailure(c, error);
      return c.json(unavailable(), 503);
    }
  });
  routes.delete("/:id", async (c) => {
    if (!store) return c.json(unavailable(), 503);
    const id = conversationIdSchema.safeParse(c.req.param("id"));
    if (!id.success || !(await hasEmptyBody(c.req.raw))) return c.json(invalid(), 400);
    try {
      const result = await store.delete(c.get("user").userId, id.data);
      return result.status === "deleted" ? c.body(null, 204) : c.json(notFound(), 404);
    } catch (error) {
      reportStorageFailure(c, error);
      return c.json(unavailable(), 503);
    }
  });
  return routes;
}
