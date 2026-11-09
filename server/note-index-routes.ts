import { Hono } from "hono";
import { apiError } from "../shared/http.ts";
import { indexStatusSchema, type IndexStatus } from "../shared/index-jobs.ts";
import { noteIdSchema } from "../shared/notes.ts";
import type { AuthEnv } from "./auth.ts";

export interface NoteIndexService {
  getStatus(ownerId: string, noteId: string): Promise<IndexStatus | undefined>;
}
export type NoteSaved = (noteId: string) => Promise<unknown>;

/** The transaction already persisted the intent. A wake failure cannot undo the save. */
export function wakeNoteIndex(wake: NoteSaved | undefined, noteId: string) {
  void Promise.resolve()
    .then(() => wake?.(noteId))
    .catch(() => {});
}

export function createNoteIndexRoutes(service?: NoteIndexService) {
  const routes = new Hono<AuthEnv>();
  routes.get("/:id/index", async (c) => {
    const id = noteIdSchema.safeParse(c.req.param("id"));
    if (!id.success) return c.json(apiError("VALIDATION_ERROR", "Invalid note identifier."), 400);
    const unavailable = () =>
      c.json(apiError("SERVICE_UNAVAILABLE", "Index status is temporarily unavailable."), 503);
    if (!service) return unavailable();
    try {
      const status = await service.getStatus(c.get("user").userId, id.data);
      if (!status) return c.json(apiError("NOT_FOUND", "Note not found."), 404);
      return c.json(indexStatusSchema.parse(status));
    } catch {
      return unavailable();
    }
  });
  return routes;
}
