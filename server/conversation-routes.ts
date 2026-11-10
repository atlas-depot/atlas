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
  conversationSendSchema,
  createConversationSchema,
  sendConversationMessageSchema,
} from "../shared/conversations.ts";
import type { AuthEnv } from "./auth.ts";
import type { ConversationAnswerService } from "./conversation-answers.ts";
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
export function createConversationRoutes(
  store?: ConversationService,
  answers?: ConversationAnswerService,
) {
  const routes = new Hono<AuthEnv>();
  const conflict = (message: string) => apiError("CONFLICT", message);
  routes.post("/:id/messages", async (c) => {
    if (!store || !answers) return c.json(unavailable(), 503);
    const id = conversationIdSchema.safeParse(c.req.param("id"));
    const key = conversationOperationKeySchema.safeParse(c.req.header("Idempotency-Key"));
    const input = sendConversationMessageSchema.safeParse(await readJson(c.req.raw));
    if (!id.success || !key.success || !input.success) return c.json(invalid(), 400);
    const owner = c.get("user").userId;
    try {
      const result = await answers.send(owner, id.data, key.data, input.data);
      if (result.status === "rate_limited") {
        c.header("Retry-After", String(result.retryAfterSeconds));
        return c.json(apiError("RATE_LIMITED", "Too many messages. Try again later."), 429);
      }
      if (result.status === "not_found") return c.json(notFound(), 404);
      if (result.status === "conflict")
        return c.json(conflict("This message key was already used for a different message."), 409);
      // Never downgrade a steer to a queued message without the caller knowing.
      if (result.status === "policy_unsupported")
        return c.json(conflict("The running answer cannot take another steering message."), 409);
      const current = await store.read(owner, id.data);
      if (!current) return c.json(notFound(), 404);
      return c.json(conversationSendSchema.parse({ message: result.value, ...current }), 202);
    } catch (error) {
      reportStorageFailure(c, error);
      return c.json(unavailable(), 503);
    }
  });
  for (const action of ["stop", "resume"] as const)
    routes.post(`/:id/${action}`, async (c) => {
      if (!store || !answers) return c.json(unavailable(), 503);
      const id = conversationIdSchema.safeParse(c.req.param("id"));
      if (!id.success || !(await hasEmptyBody(c.req.raw))) return c.json(invalid(), 400);
      const owner = c.get("user").userId;
      try {
        const result = await answers[action](owner, id.data);
        const current =
          result.status === "not_found" ? undefined : await store.read(owner, id.data);
        return current ? c.json(conversationReadSchema.parse(current)) : c.json(notFound(), 404);
      } catch (error) {
        reportStorageFailure(c, error);
        return c.json(unavailable(), 503);
      }
    });
  routes.post("/:id/turns/:turnId/retry", async (c) => {
    if (!store || !answers) return c.json(unavailable(), 503);
    const id = conversationIdSchema.safeParse(c.req.param("id"));
    const turnId = conversationIdSchema.safeParse(c.req.param("turnId"));
    const key = conversationOperationKeySchema.safeParse(c.req.header("Idempotency-Key"));
    if (!id.success || !turnId.success || !key.success || !(await hasEmptyBody(c.req.raw)))
      return c.json(invalid(), 400);
    const owner = c.get("user").userId;
    try {
      const result = await answers.retry(owner, id.data, turnId.data, key.data);
      if (result.status === "not_found") return c.json(notFound(), 404);
      if (result.status !== "saved")
        return c.json(conflict("This answer cannot be retried right now."), 409);
      const current = await store.read(owner, id.data);
      return current ? c.json(conversationReadSchema.parse(current), 202) : c.json(notFound(), 404);
    } catch (error) {
      reportStorageFailure(c, error);
      return c.json(unavailable(), 503);
    }
  });
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
      // A reconnect continues the existing attempt. It never starts a second model run.
      await answers?.refresh(c.get("user").userId, id.data);
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
