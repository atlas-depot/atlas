import { z } from "zod";
import { noteTextSchema } from "./document.ts";
import { notePassageSourceSchema } from "./passages.ts";

export const publicSourceUrlSchema = z.url({ protocol: /^https?$/ }).refine((value) => {
  if (!URL.canParse(value)) return false;
  const url = new URL(value);
  return url.username === "" && url.password === "";
});

/** A provider-verified public page record; unlike note evidence, it has no private note identity. */
export const webEvidenceSourceSchema = z.strictObject({
  kind: z.literal("web"),
  url: publicSourceUrlSchema,
  title: noteTextSchema.min(1).max(2_000),
  retrievedAt: z.iso.datetime(),
});

export const answerEvidenceSourceSchema = z.union([
  notePassageSourceSchema,
  webEvidenceSourceSchema,
]);

export const evidenceIdSchema = z.string().regex(/^p_[0-9a-f]{16}$/);

export const researchToolResultSchema = z.discriminatedUnion("status", [
  z.strictObject({
    status: z.literal("completed"),
    question: noteTextSchema.min(1).max(500),
    text: noteTextSchema.min(1).max(100_000),
    sources: z
      .array(
        z.strictObject({
          id: evidenceIdSchema,
          source: webEvidenceSourceSchema,
        }),
      )
      .min(1)
      .max(50),
  }),
  z.strictObject({
    status: z.literal("not_performed"),
    reason: z.enum(["denied", "expired", "cancelled", "stale"]),
  }),
]);

export type AnswerEvidenceSource = z.infer<typeof answerEvidenceSourceSchema>;
export type WebEvidenceSource = z.infer<typeof webEvidenceSourceSchema>;
export type ResearchToolResult = z.infer<typeof researchToolResultSchema>;
