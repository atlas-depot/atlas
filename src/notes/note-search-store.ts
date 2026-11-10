import { apiErrorSchema } from "../../shared/http";
import {
  noteSearchRequestSchema,
  noteSearchResponseSchema,
  type NoteSearchResponse,
} from "../../shared/note-search";
import { boundedFetch } from "../lib/http";
import { NotesRequestError } from "./notes-store";

export type NoteSearchCandidate = NoteSearchResponse["candidates"][number];
export type NoteIndexCoverage = NoteSearchResponse["coverage"];

export interface NoteSearchClient {
  search(query: string, limit?: number): Promise<NoteSearchResponse>;
}

/** Same-origin private API; credentials stay in the browser's HttpOnly cookie. */
export function createNoteSearchClient(
  request: typeof fetch = globalThis.fetch,
  timeoutMs = 30_000,
): NoteSearchClient {
  return {
    async search(query, limit) {
      const payload = noteSearchRequestSchema.parse(
        limit === undefined ? { query } : { query, limit },
      );
      const result = await boundedFetch(
        "/api/note-search",
        {
          method: "POST",
          credentials: "same-origin",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        },
        timeoutMs,
        request,
      );
      if (!result.ok) {
        const error = apiErrorSchema.safeParse(await result.json().catch(() => null));
        throw new NotesRequestError(
          result.status,
          error.success ? error.data.error.code : "INVALID_RESPONSE",
        );
      }
      return noteSearchResponseSchema.parse(await result.json());
    },
  };
}
