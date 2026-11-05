import { apiErrorSchema, ifMatchSchema } from "../../shared/http";
import { noteDraftSchema, organizeWorkSchema, type NoteDraft } from "../../shared/drafts";
import { organizeRunResponseSchema, organizeStartResponseSchema } from "../../shared/organize";
import { noteContentSchema, noteIdSchema, noteSchema, type UpdateNote } from "../../shared/notes";
import { NotesRequestError, type NoteSnapshot } from "./notes-store";

/** Same-origin private API. No draft content is persisted in browser storage. */
export function createOrganizeClient(request: typeof fetch = globalThis.fetch) {
  async function response(path: string, init: RequestInit = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);
    try {
      const result = await request(`/api${path}`, {
        ...init,
        credentials: "same-origin",
        signal: controller.signal,
      });
      const bytes = await result.arrayBuffer();
      const copy = new Response(bytes.byteLength ? bytes : null, {
        status: result.status,
        headers: result.headers,
      });
      if (!copy.ok) {
        const error = apiErrorSchema.safeParse(await copy.json().catch(() => null));
        throw new NotesRequestError(
          copy.status,
          error.success ? error.data.error.code : "INVALID_RESPONSE",
        );
      }
      return copy;
    } finally {
      clearTimeout(timer);
    }
  }
  async function draft(result: Response): Promise<NoteDraft> {
    const value = noteDraftSchema.parse(await result.json());
    if (ifMatchSchema.parse(result.headers.get("ETag")) !== value.etag)
      throw new Error("Unexpected draft revision.");
    return value;
  }
  const id = (value: string) => noteIdSchema.parse(value);
  const update = (input: UpdateNote, etag: string): RequestInit => ({
    method: "PUT",
    headers: { "Content-Type": "application/json", "If-Match": ifMatchSchema.parse(etag) },
    body: JSON.stringify(noteContentSchema.parse(input)),
  });
  return {
    async list() {
      return organizeWorkSchema.parse(await (await response("/organize-work")).json());
    },
    async start(noteId: string, etag: string) {
      return organizeStartResponseSchema.parse(
        await (
          await response(`/notes/${id(noteId)}/organize`, {
            method: "POST",
            headers: { "If-Match": ifMatchSchema.parse(etag) },
          })
        ).json(),
      );
    },
    async readRun(runId: string) {
      return organizeRunResponseSchema.parse(
        await (await response(`/organize-runs/${id(runId)}`)).json(),
      );
    },
    async cancel(runId: string) {
      return organizeRunResponseSchema.parse(
        await (await response(`/organize-runs/${id(runId)}/cancel`, { method: "POST" })).json(),
      );
    },
    async handoff(runId: string) {
      return draft(await response(`/organize-runs/${id(runId)}/handoff`, { method: "POST" }));
    },
    async readDraft(draftId: string) {
      return draft(await response(`/note-drafts/${id(draftId)}`));
    },
    async updateDraft(draftId: string, input: UpdateNote, etag: string) {
      return draft(await response(`/note-drafts/${id(draftId)}`, update(input, etag)));
    },
    async discard(draftId: string, etag: string) {
      await response(`/note-drafts/${id(draftId)}`, {
        method: "DELETE",
        headers: { "If-Match": ifMatchSchema.parse(etag) },
      });
    },
    async save(draftId: string, input: UpdateNote, etag: string): Promise<NoteSnapshot> {
      const result = await response(`/note-drafts/${id(draftId)}/save`, {
        ...update(input, etag),
        method: "POST",
      });
      return {
        note: noteSchema.parse(await result.json()),
        etag: ifMatchSchema.parse(result.headers.get("ETag")),
      };
    },
  };
}
export type OrganizeClient = ReturnType<typeof createOrganizeClient>;
