import { wakeNoteIndex, type NoteSaved } from "./note-index-routes.ts";
import { Hono } from "hono";
import { apiError, ifMatchSchema } from "../shared/http.ts";
import { noteContentSchema, noteIdSchema } from "../shared/notes.ts";
import type { AuthEnv } from "./auth.ts";
import type { OrganizeService } from "./organize-routes.ts";
import { hasEmptyBody, readJson } from "./request-body.ts";

const invalid = () => apiError("VALIDATION_ERROR", "Invalid draft request.");
const missing = () => apiError("NOT_FOUND", "Draft not found.");
const unavailable = () =>
  apiError("SERVICE_UNAVAILABLE", "Draft storage is temporarily unavailable.");
const stale = () => apiError("PRECONDITION_FAILED", "The draft changed. Reload before retrying.");

export function createDraftRoutes(service?: OrganizeService, onSaved?: NoteSaved) {
  const routes = new Hono<AuthEnv>();
  routes.get("/organize-work", async (c) => {
    if (!service?.work) return c.json(unavailable(), 503);
    try {
      return c.json(await service.work(c.get("user").userId));
    } catch {
      return c.json(unavailable(), 503);
    }
  });
  routes.post("/organize-runs/:id/handoff", async (c) => {
    const id = noteIdSchema.safeParse(c.req.param("id"));
    if (!id.success || !(await hasEmptyBody(c.req.raw))) return c.json(invalid(), 400);
    if (!service?.handoff) return c.json(unavailable(), 503);
    try {
      const result = await service.handoff(c.get("user").userId, id.data);
      if (result.status === "not_found") return c.json(missing(), 404);
      if (result.status !== "ready")
        return c.json(apiError("CONFLICT", "This run has no draft to deliver."), 409);
      return c.json(result.draft, 200, { ETag: result.draft.etag });
    } catch {
      return c.json(unavailable(), 503);
    }
  });
  routes.get("/note-drafts/:id", async (c) => {
    const id = noteIdSchema.safeParse(c.req.param("id"));
    if (!id.success) return c.json(invalid(), 400);
    if (!service?.drafts) return c.json(unavailable(), 503);
    try {
      const draft = await service.drafts.read(c.get("user").userId, id.data);
      return draft ? c.json(draft, 200, { ETag: draft.etag }) : c.json(missing(), 404);
    } catch {
      return c.json(unavailable(), 503);
    }
  });
  for (const action of ["update", "discard", "save"] as const) {
    routes.on(
      action === "update" ? "PUT" : action === "discard" ? "DELETE" : "POST",
      `/note-drafts/:id${action === "save" ? "/save" : ""}`,
      async (c) => {
        const id = noteIdSchema.safeParse(c.req.param("id"));
        if (!id.success) return c.json(invalid(), 400);
        if (!service?.drafts) return c.json(unavailable(), 503);
        const expected = c.req.header("If-Match");
        if (expected === undefined)
          return c.json(apiError("PRECONDITION_REQUIRED", "If-Match is required."), 428);
        if (!ifMatchSchema.safeParse(expected).success) return c.json(invalid(), 400);
        const input =
          action === "discard" ? undefined : noteContentSchema.safeParse(await readJson(c.req.raw));
        if (action === "discard" ? !(await hasEmptyBody(c.req.raw)) : !input?.success)
          return c.json(invalid(), 400);
        try {
          const owner = c.get("user").userId;
          const result =
            action === "discard"
              ? await service.drafts.discard(owner, id.data, expected)
              : input?.success
                ? await service.drafts[action](owner, id.data, expected, input.data)
                : undefined;
          if (!result) return c.json(invalid(), 400);
          if (result.status === "not_found") return c.json(missing(), 404);
          if (result.status === "conflict")
            return action === "save"
              ? c.json(apiError("CONFLICT", "The saved note changed or was deleted."), 409)
              : c.json(stale(), 412);
          if (result.status === "stale") return c.json(stale(), 412);
          if (result.status === "deleted") return c.body(null, 204);
          if ("draft" in result) return c.json(result.draft, 200, { ETag: result.draft.etag });
          if ("value" in result) {
            wakeNoteIndex(onSaved, result.value.note.id);
            return c.json(result.value.note, 201, {
              ETag: JSON.stringify(`${result.value.note.id}:${result.value.revision}`),
            });
          }
          return c.json(unavailable(), 503);
        } catch {
          return c.json(unavailable(), 503);
        }
      },
    );
  }
  return routes;
}
