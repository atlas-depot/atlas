import { z } from "zod";
import { evidenceId } from "../../server/conversation-answer.ts";
import { searchQuerySchema } from "../../shared/note-search.ts";
import type { NotePassage } from "../../shared/passages.ts";

export const noteSearchInputSchema = z.object({
  query: searchQuerySchema,
  limit: z.number().int().min(1).max(10).optional(),
});

type Dependencies = {
  /** Owner of the running attempt bound to this runtime session, from Atlas storage. */
  ownerOfSession: (sessionId: string) => Promise<string | undefined>;
  embed: (query: string) => Promise<number[]>;
  candidates: (
    ownerId: string,
    vector: number[],
    limit: number,
  ) => Promise<{
    passages: NotePassage[];
    coverage: { ready: number; pending: number; failed: number };
  }>;
  /** Records every returned passage as lineage of the attempt. False refuses the output. */
  record: (
    sessionId: string,
    sources: { noteId: string; version: string }[],
    output: unknown,
  ) => Promise<boolean>;
};

/**
 * The model supplies only a query. The owner comes from the session Atlas bound before any
 * model input was sent, so no prompt or note can widen the search to another account.
 */
export async function searchOwnedNotes(
  sessionId: string,
  input: z.infer<typeof noteSearchInputSchema>,
  { ownerOfSession, embed, candidates, record }: Dependencies,
) {
  const owner = await ownerOfSession(sessionId);
  if (!owner) throw new Error("Note search is not available for this session.");
  const result = await candidates(owner, await embed(input.query), input.limit ?? 5);
  const output = {
    passages: result.passages.map(({ text, source }) => ({
      id: evidenceId(source),
      text,
      source,
    })),
    coverage: result.coverage,
  };
  // Lineage is saved before the model sees a passage, cited later or not.
  const sources = output.passages.map(({ source }) => ({
    noteId: source.noteId,
    version: source.version,
  }));
  if (!(await record(sessionId, sources, output)))
    throw new Error("Search context is unavailable or exceeded its budget.");
  return output;
}
