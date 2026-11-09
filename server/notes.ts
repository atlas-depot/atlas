import { wakeNoteIndex, type NoteSaved } from "./note-index-routes.ts";
import { readJson, readBody } from "./request-body.ts";
import { Hono } from "hono";
import { apiError, ifMatchSchema } from "../shared/http.ts";
import {
  createNoteKeySchema,
  createNoteSchema,
  noteIdSchema,
  updateNoteSchema,
  type CreateNote,
  type Note,
  type UpdateNote,
} from "../shared/notes.ts";
import type { AuthEnv } from "./auth.ts";
import type { NoteWriteResult, StoredNote } from "./db/notes.ts";

export interface NoteService {
  list(ownerId: string): Promise<Note[]>;
  read(ownerId: string, id: string): Promise<StoredNote | undefined>;
  createIdempotent(
    ownerId: string,
    key: string,
    input: CreateNote,
  ): Promise<{ status: "saved"; value: StoredNote } | { status: "conflict" }>;
  update(
    ownerId: string,
    id: string,
    expectedRevision: number,
    input: UpdateNote,
  ): Promise<NoteWriteResult>;
  delete(
    ownerId: string,
    id: string,
    expectedRevision: number,
  ): Promise<{ status: "deleted" | "not_found" | "conflict" }>;
}

const notFound = () => apiError("NOT_FOUND", "Note not found.");
const unavailable = () =>
  apiError("SERVICE_UNAVAILABLE", "Note storage is temporarily unavailable.");
const invalid = () => apiError("VALIDATION_ERROR", "Invalid note request.");
const stale = () =>
  apiError("PRECONDITION_FAILED", "The note has changed. Reload before retrying.");
const etag = (value: StoredNote) => JSON.stringify(`${value.note.id}:${value.revision}`);

/** Mounted behind requireAuth and the app's cookie-origin protection. */
export function createNoteRoutes(store?: NoteService, onSaved?: NoteSaved) {
  const routes = new Hono<AuthEnv>();

  routes.get("/", async (c) => {
    if (!store) return c.json(unavailable(), 503);
    try {
      return c.json({ notes: await store.list(c.get("user").userId) });
    } catch {
      return c.json(unavailable(), 503);
    }
  });

  routes.post("/", async (c) => {
    if (!store) return c.json(unavailable(), 503);
    const key = createNoteKeySchema.safeParse(c.req.header("Idempotency-Key"));
    if (!key.success) return c.json(invalid(), 400);
    const input = createNoteSchema.safeParse(await readJson(c.req.raw));
    if (!input.success) return c.json(invalid(), 400);
    try {
      const result = await store.createIdempotent(c.get("user").userId, key.data, input.data);
      if (result.status === "conflict") {
        return c.json(
          apiError("CONFLICT", "This creation key cannot be reused for this note."),
          409,
        );
      }
      wakeNoteIndex(onSaved, result.value.note.id);
      return c.json(result.value.note, 201, { ETag: etag(result.value) });
    } catch {
      return c.json(unavailable(), 503);
    }
  });

  routes.get("/:id", async (c) => {
    if (!store) return c.json(unavailable(), 503);
    const id = noteIdSchema.safeParse(c.req.param("id"));
    if (!id.success) return c.json(invalid(), 400);
    try {
      const value = await store.read(c.get("user").userId, id.data);
      if (!value) return c.json(notFound(), 404);
      return c.json(value.note, 200, { ETag: etag(value) });
    } catch {
      return c.json(unavailable(), 503);
    }
  });

  routes.on(["PUT", "DELETE"], "/:id", async (c) => {
    if (!store) return c.json(unavailable(), 503);
    const id = noteIdSchema.safeParse(c.req.param("id"));
    if (!id.success) return c.json(invalid(), 400);
    const deleting = c.req.method === "DELETE";
    const input = deleting ? undefined : updateNoteSchema.safeParse(await readJson(c.req.raw));
    if (deleting ? (await readBody(c.req.raw, 0)) !== "" : !input?.success) {
      return c.json(invalid(), 400);
    }
    try {
      const owner = c.get("user").userId;
      const current = await store.read(owner, id.data);
      if (!current) return c.json(notFound(), 404);
      const header = c.req.header("If-Match");
      if (header === undefined) {
        return c.json(apiError("PRECONDITION_REQUIRED", "If-Match is required."), 428);
      }
      if (!ifMatchSchema.safeParse(header).success) return c.json(invalid(), 400);
      if (header !== etag(current)) return c.json(stale(), 412);
      const result = deleting
        ? await store.delete(owner, id.data, current.revision)
        : input?.success
          ? await store.update(owner, id.data, current.revision, input.data)
          : undefined;
      if (!result) return c.json(invalid(), 400);
      if (result.status === "not_found") return c.json(notFound(), 404);
      if (result.status === "conflict") return c.json(stale(), 412);
      if (result.status === "saved") {
        wakeNoteIndex(onSaved, result.value.note.id);
        return c.json(result.value.note, 200, { ETag: etag(result.value) });
      }
      return c.body(null, 204);
    } catch {
      return c.json(unavailable(), 503);
    }
  });

  return routes;
}
