import { describe, expect, it } from "vite-plus/test";
import {
  EMBEDDING_DIMENSIONS,
  EMBEDDING_FINGERPRINT,
  EMBEDDING_MODEL,
  embeddingVectorSchema,
  encodeSearchQuery,
} from "./embedding.ts";
import { PASSAGE_PROJECTION_VERSION } from "./passages.ts";

describe("the selected retrieval encoding", () => {
  it("shares the evaluated model, dimensions, instruction and projection identity", () => {
    expect(EMBEDDING_MODEL).toBe("qwen/qwen3-embedding-8b");
    expect(EMBEDDING_DIMENSIONS).toBe(1536);
    const encoded = encodeSearchQuery("Diş randevum ne zaman?");
    expect(encoded).toBe(
      "Instruct: Given a question, retrieve personal notes that contain evidence to answer it.\nQuery: Diş randevum ne zaman?",
    );
    expect(JSON.parse(EMBEDDING_FINGERPRINT)).toEqual({
      version: 1,
      model: EMBEDDING_MODEL,
      dimensions: EMBEDDING_DIMENSIONS,
      projection: PASSAGE_PROJECTION_VERSION,
      document: "plain-passage-text",
      query: encodeSearchQuery("<query>"),
    });
  });

  it("rejects vectors that cannot be stored or used for cosine similarity", () => {
    const valid = Array.from({ length: 1536 }, (_, i) => (i === 0 ? 1 : 0));
    expect(embeddingVectorSchema.safeParse(valid).success).toBe(true);
    for (const first of [NaN, Infinity, -Infinity, 1e100, 0, 1e-100, 1e30, 1e-30]) {
      expect(embeddingVectorSchema.safeParse([first, ...valid.slice(1)]).success).toBe(false);
    }
    expect(embeddingVectorSchema.safeParse(valid.slice(1)).success).toBe(false);
    expect(embeddingVectorSchema.safeParse([...valid, 0]).success).toBe(false);
    expect(embeddingVectorSchema.safeParse(Array(1536).fill(1e18)).success).toBe(false);
  });
});
