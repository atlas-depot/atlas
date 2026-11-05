import { z } from "zod";
import { ifMatchSchema } from "./http.ts";
import { noteContentSchema } from "./notes.ts";
import { generatedDraftSchema } from "./organize.ts";

export const noteDraftSchema = noteContentSchema.extend({
  id: z.uuid(),
  etag: ifMatchSchema,
  source: z.strictObject({
    noteId: z.uuid(),
    revision: z.number().int().positive(),
    stale: z.boolean(),
    deleted: z.boolean(),
  }),
  sources: generatedDraftSchema.shape.sources,
  expiresAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type NoteDraft = z.infer<typeof noteDraftSchema>;
export const organizeWorkSchema = z.strictObject({
  runs: z.array(z.strictObject({ runId: z.uuid(), noteId: z.uuid() })),
  drafts: z.array(noteDraftSchema),
});
export type OrganizeWork = z.infer<typeof organizeWorkSchema>;
