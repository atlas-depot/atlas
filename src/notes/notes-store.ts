import { apiErrorSchema, ifMatchSchema } from "../../shared/http";
import {
  createNoteSchema,
  noteIdSchema,
  noteListSchema,
  noteSchema,
  updateNoteSchema,
  type CreateNote,
  type Note,
  type UpdateNote,
} from "../../shared/notes";

export interface NoteSnapshot {
  note: Note;
  etag: string;
}

/** Matches #45/#56. Open list records individually to obtain their authoritative content and ETag. */
export interface NotesStore {
  list(): Promise<Note[]>;
  read(id: string): Promise<NoteSnapshot>;
  create(input: CreateNote): Promise<NoteSnapshot>;
  update(id: string, input: UpdateNote, etag: string): Promise<NoteSnapshot>;
  delete(id: string, etag: string): Promise<void>;
}

export class NotesRequestError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string) {
    super("The notes request did not succeed.");
    this.name = "NotesRequestError";
    this.status = status;
    this.code = code;
  }
}

/** Same-origin transport; credentials stay in the browser's HttpOnly cookie. */
export function createNotesClient(
  request: typeof fetch = globalThis.fetch,
  timeoutMs = 30_000,
): NotesStore {
  async function boundedRequest(path: string, init: RequestInit) {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error("The notes request timed out."));
      }, timeoutMs);
    });
    try {
      return await Promise.race([
        (async () => {
          const result = await request(path, { ...init, signal: controller.signal });
          // Bound body delivery as well as headers. Late responses cannot update the screen.
          const body = await result.arrayBuffer();
          return new Response(body.byteLength ? body : null, {
            status: result.status,
            statusText: result.statusText,
            headers: result.headers,
          });
        })(),
        timeout,
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
  async function response(path: string, init: RequestInit = {}, expectedStatus = 200) {
    const result = await boundedRequest(`/api/notes${path}`, {
      ...init,
      credentials: "same-origin",
    });
    if (!result.ok) {
      const error = apiErrorSchema.safeParse(await result.json().catch(() => null));
      throw new NotesRequestError(
        result.status,
        error.success ? error.data.error.code : "INVALID_RESPONSE",
      );
    }
    if (result.status !== expectedStatus) throw new Error("Unexpected notes response.");
    return result;
  }
  async function snapshot(result: Response, expectedId?: string): Promise<NoteSnapshot> {
    const note = noteSchema.parse(await result.json());
    const etag = ifMatchSchema.parse(result.headers.get("ETag"));
    if (expectedId !== undefined && note.id !== expectedId)
      throw new Error("Unexpected note identity.");
    return { note, etag };
  }
  return {
    async list() {
      return noteListSchema.parse(await (await response("")).json()).notes;
    },
    async read(id) {
      return snapshot(await response(`/${noteIdSchema.parse(id)}`), id);
    },
    async create(input) {
      return snapshot(
        await response(
          "",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(createNoteSchema.parse(input)),
          },
          201,
        ),
      );
    },
    async update(id, input, etag) {
      return snapshot(
        await response(`/${noteIdSchema.parse(id)}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json", "If-Match": ifMatchSchema.parse(etag) },
          body: JSON.stringify(updateNoteSchema.parse(input)),
        }),
        id,
      );
    },
    async delete(id, etag) {
      await response(
        `/${noteIdSchema.parse(id)}`,
        {
          method: "DELETE",
          headers: { "If-Match": ifMatchSchema.parse(etag) },
        },
        204,
      );
    },
  };
}
