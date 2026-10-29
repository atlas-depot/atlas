import { Hono } from "hono";
import { apiError } from "../shared/http.ts";
import type { AuthEnv } from "./auth.ts";

/** Mounted behind requireAuth. TODO: Replace 501 handlers with persistent note operations. */
export function createNoteRoutes() {
  const notes = new Hono<AuthEnv>();
  notes.on(["GET", "POST"], "/", (c) =>
    c.json(apiError("NOT_IMPLEMENTED", "Note storage is not connected yet."), 501),
  );
  notes.on(["GET", "PUT", "DELETE"], "/:id", (c) =>
    c.json(apiError("NOT_IMPLEMENTED", "Note storage is not connected yet."), 501),
  );
  return notes;
}
