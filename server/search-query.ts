import { z } from "zod";
import { encodeSearchQuery, embeddingVectorSchema } from "../shared/embedding.ts";

const querySchema = z.string().trim().min(1).max(500);

/** Shares the exact query instruction and vector validation with the indexing profile. */
export function createSearchQueryEncoder(embed: (texts: string[]) => Promise<number[][]>) {
  return async (query: string): Promise<number[]> => {
    const text = querySchema.parse(query);
    const vectors = await embed([encodeSearchQuery(text)]);
    if (vectors.length !== 1) throw new Error("Invalid search embedding response.");
    return embeddingVectorSchema.parse(vectors[0]);
  };
}
