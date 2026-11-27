import { z } from "zod";
import { ifMatchSchema } from "./http.ts";
import { noteContentSchema, organizerOriginalSchema } from "./notes.ts";
import { draftGenerationSchema, generatedDraftSchema } from "./organize.ts";

export const noteDraftSchema = noteContentSchema.extend({
  id: z.uuid(),
  etag: ifMatchSchema,
  original: organizerOriginalSchema.optional(),
  source: z
    .strictObject({
      noteId: z.uuid(),
      revision: z.number().int().positive(),
      stale: z.boolean(),
      deleted: z.boolean(),
    })
    .nullable(),
  sources: generatedDraftSchema.shape.sources,
  generation: draftGenerationSchema.optional(),
  expiresAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type NoteDraft = z.infer<typeof noteDraftSchema>;
export const organizeWorkSchema = z.strictObject({
  runs: z.array(z.strictObject({ runId: z.uuid(), noteId: z.uuid().nullable() })),
  drafts: z.array(noteDraftSchema),
});
export type OrganizeWork = z.infer<typeof organizeWorkSchema>;
