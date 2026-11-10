import { Hono } from "hono";
import { apiError } from "../shared/http.ts";
import {
  noteSearchRequestSchema,
  noteSearchResponseSchema,
  type NoteSearchResponse,
} from "../shared/note-search.ts";
import type { AuthEnv } from "./auth.ts";
import { readJson } from "./request-body.ts";
import { reportStorageFailure } from "./http-errors.ts";

export interface NoteSearchService {
  candidates(
    ownerId: string,
    vector: number[],
    limit: number,
  ): Promise<{
    passages: NoteSearchResponse["candidates"];
    coverage: NoteSearchResponse["coverage"];
  }>;
}

/** Authentication and cookie-origin protection are supplied by the parent API. */
export function createNoteSearchRoutes(
  store?: NoteSearchService,
  embed?: (query: string) => Promise<number[]>,
) {
  const routes = new Hono<AuthEnv>();
  routes.post("/", async (c) => {
    const input = noteSearchRequestSchema.safeParse(await readJson(c.req.raw));
    if (!input.success) return c.json(apiError("VALIDATION_ERROR", "Invalid search request."), 400);
    if (!store || !embed)
      return c.json(apiError("SERVICE_UNAVAILABLE", "Search is temporarily unavailable."), 503);
    let vector: number[];
    try {
      vector = await embed(input.data.query);
    } catch {
      return c.json(apiError("SERVICE_UNAVAILABLE", "Search embedding is unavailable."), 503);
    }
    try {
      const result = await store.candidates(c.get("user").userId, vector, input.data.limit ?? 5);
      return c.json(
        noteSearchResponseSchema.parse({
          candidates: result.passages,
          coverage: result.coverage,
        }),
      );
    } catch (error) {
      reportStorageFailure(c, error);
      return c.json(apiError("SERVICE_UNAVAILABLE", "Search storage is unavailable."), 503);
    }
  });
  return routes;
}
