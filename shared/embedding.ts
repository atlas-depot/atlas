import { z } from "zod";
import { noteTextSchema } from "./document.ts";
import { PASSAGE_PROJECTION_VERSION } from "./passages.ts";

export const EMBEDDING_MODEL = "qwen/qwen3-embedding-8b";
export const EMBEDDING_DIMENSIONS = 1536;
const QUERY_INSTRUCTION =
  "Given a question, retrieve personal notes that contain evidence to answer it.";

/** Both index and query must use this exact encoding profile, not just the model name. */
export const EMBEDDING_FINGERPRINT = JSON.stringify({
  version: 1,
  model: EMBEDDING_MODEL,
  dimensions: EMBEDDING_DIMENSIONS,
  projection: PASSAGE_PROJECTION_VERSION,
  document: "plain-passage-text",
  query: `Instruct: ${QUERY_INSTRUCTION}\nQuery: <query>`,
});

export function encodeSearchQuery(query: string): string {
  const text = noteTextSchema.min(1).max(100_000).parse(query);
  return `Instruct: ${QUERY_INSTRUCTION}\nQuery: ${text}`;
}

/** pgvector's cosine norm must remain finite and nonzero in float32 arithmetic. */
export const embeddingVectorSchema = z
  .array(
    z
      .number()
      .finite()
      .refine((value) => Number.isFinite(Math.fround(value))),
  )
  .length(EMBEDDING_DIMENSIONS)
  .refine((values) => {
    let normSquared = 0;
    for (const value of values) {
      const component = Math.fround(value);
      normSquared = Math.fround(normSquared + Math.fround(component * component));
    }
    return Number.isFinite(normSquared) && normSquared > 0;
  });
