import { z } from "zod";

export { generatedDraftSchema, type GeneratedDraft } from "../shared/organize.ts";

/** Provider-reported totals only. Missing metrics are unknown, never assumed to be zero. */
export const organizeUsageSchema = z.strictObject({
  inputTokens: z.number().int().nonnegative().safe().optional(),
  outputTokens: z.number().int().nonnegative().safe().optional(),
  costUsd: z.number().finite().nonnegative().optional(),
  complete: z.boolean(),
});
export type OrganizeUsage = z.infer<typeof organizeUsageSchema>;
