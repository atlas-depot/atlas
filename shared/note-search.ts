import { z } from "zod";
import { notePassageSourceSchema } from "./passages.ts";

export const noteSearchRequestSchema = z.strictObject({
  query: z.string().trim().min(1).max(500),
  limit: z.number().int().min(1).max(10).optional(),
});

export const noteSearchResponseSchema = z.strictObject({
  candidates: z
    .array(
      z.strictObject({
        text: z.string().min(1).max(100_000),
        source: notePassageSourceSchema,
        /** Cosine similarity for ranking, not confidence that the question is answered. */
        score: z.number().finite(),
      }),
    )
    .max(10),
  coverage: z.strictObject({
    ready: z.number().int().min(0),
    pending: z.number().int().min(0),
    failed: z.number().int().min(0),
  }),
});

export type NoteSearchResponse = z.infer<typeof noteSearchResponseSchema>;
