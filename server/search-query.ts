import { encodeSearchQuery, embeddingVectorSchema } from "../shared/embedding.ts";
import { searchQuerySchema } from "../shared/note-search.ts";

export { searchQuerySchema } from "../shared/note-search.ts";

/** Shares the exact query instruction and vector validation with the indexing profile. */
export function createSearchQueryEncoder(
  embed: (texts: string[], signal?: AbortSignal) => Promise<number[][]>,
  signal?: AbortSignal,
) {
  return async (query: string): Promise<number[]> => {
    const text = searchQuerySchema.parse(query);
    const vectors = await embed([encodeSearchQuery(text)], signal);
    if (vectors.length !== 1) throw new Error("Invalid search embedding response.");
    return embeddingVectorSchema.parse(vectors[0]);
  };
}
