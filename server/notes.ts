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

/** Bound actual bytes and total upload time, including requests without Content-Length. */
async function readBody(request: Request, maxBytes: number): Promise<string | undefined> {
  if (Number(request.headers.get("Content-Length")) > maxBytes) return undefined;
  if (!request.body) return "";
  const reader = request.body.getReader();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      (async () => {
        const decoder = new TextDecoder("utf-8", { fatal: true });
        let size = 0;
        let text = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) return text + decoder.decode();
          size += value.byteLength;
          if (size > maxBytes) return undefined;
          text += decoder.decode(value, { stream: true });
        }
      })(),
      new Promise<undefined>((resolve) => {
        timeout = setTimeout(() => resolve(undefined), 5_000);
      }),
    ]);
  } catch {
    return undefined;
  } finally {
    clearTimeout(timeout);
    // Do not wait on an uncooperative upload stream's cancellation hook.
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

async function readJson(request: Request): Promise<unknown> {
  // Allows the 100k UTF-16 content limit even when every character is JSON-escaped.
  const text = await readBody(request, 1024 * 1024);
  if (text === undefined) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

/** Mounted behind requireAuth and the app's cookie-origin protection. */
export function createNoteRoutes(store?: NoteService) {
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
        return c.json(result.value.note, 200, { ETag: etag(result.value) });
      }
      return c.body(null, 204);
    } catch {
      return c.json(unavailable(), 503);
    }
  });

  return routes;
}
