import { z } from "zod";

const sourceUrlSchema = z.url({ protocol: /^https?$/ }).refine((value) => {
  if (!URL.canParse(value)) return false;
  const url = new URL(value);
  return url.username === "" && url.password === "";
});

/** Source records come from the research adapter, never from model-written links. */
export const generatedDraftSchema = z.strictObject({
  // Derivatives must fit the existing Markdown note contract used by explicit Save.
  markdown: z
    .string()
    .max(100_000)
    .refine((value) => value.trim().length > 0),
  sources: z
    .array(
      z.strictObject({
        id: z.string().min(1),
        url: sourceUrlSchema,
        title: z.string(),
        imageUrl: sourceUrlSchema.optional(),
      }),
    )
    .refine((sources) => new Set(sources.map((source) => source.id)).size === sources.length),
});

export type GeneratedDraft = z.infer<typeof generatedDraftSchema>;

/** Provider-reported totals only. Missing metrics are unknown, never assumed to be zero. */
export const organizeUsageSchema = z.strictObject({
  inputTokens: z.number().int().nonnegative().safe().optional(),
  outputTokens: z.number().int().nonnegative().safe().optional(),
  costUsd: z.number().finite().nonnegative().optional(),
  complete: z.boolean(),
});
export type OrganizeUsage = z.infer<typeof organizeUsageSchema>;
