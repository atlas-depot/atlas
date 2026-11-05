import { z } from "zod";
import { noteTextSchema } from "./document.ts";

const sourceUrlSchema = z.url({ protocol: /^https?$/ }).refine((value) => {
  if (!URL.canParse(value)) return false;
  const url = new URL(value);
  return url.username === "" && url.password === "";
});

/** Source records come from the research adapter, never from model-written links. */
export const generatedDraftSchema = z.strictObject({
  markdown: noteTextSchema.max(100_000).refine((value) => value.trim().length > 0),
  sources: z
    .array(
      z.strictObject({
        id: noteTextSchema.min(1),
        url: sourceUrlSchema,
        title: noteTextSchema,
        imageUrl: sourceUrlSchema.optional(),
      }),
    )
    .refine((sources) => new Set(sources.map((source) => source.id)).size === sources.length),
});
export type GeneratedDraft = z.infer<typeof generatedDraftSchema>;

// Parsing projects only these public fields. Runtime identities and accounting stay private.
const runStates = [
  z.object({
    status: z.literal("draft"),
    draft: generatedDraftSchema,
    source: z.object({
      noteId: z.uuid(),
      revision: z.number().int().positive().safe(),
      stale: z.boolean(),
    }),
  }),
  z.object({
    status: z.literal("running"),
    phase: z.enum(["starting", "researching", "writing"]),
    phaseStartedAt: z.number().int().nonnegative().safe().optional(),
    lastProgressAt: z.number().int().nonnegative().safe().optional(),
    stalled: z.boolean().optional(),
  }),
  z.object({ status: z.enum(["cancelled", "cleaning", "expired"]) }),
  z.object({
    status: z.literal("failed"),
    reason: z.enum(["cleanup_failed", "read_failed", "generation_failed", "invalid_draft"]),
  }),
] as const;

export const organizeRunStateSchema = z.discriminatedUnion("status", runStates);
export type OrganizeRunState = z.infer<typeof organizeRunStateSchema>;

export const organizeRunResponseSchema = z.intersection(
  z.object({ runId: z.uuid() }),
  organizeRunStateSchema,
);
export type OrganizeRunResponse = z.infer<typeof organizeRunResponseSchema>;

export const organizeStartResponseSchema = z.strictObject({
  runId: z.uuid(),
  status: z.enum(["accepted", "cleanup_pending"]),
});
export type OrganizeStartResponse = z.infer<typeof organizeStartResponseSchema>;

/** Server-established provenance; note write requests cannot supply this value. */
export const noteOriginSchema = z.strictObject({
  sourceNoteId: z.uuid(),
  sourceRevision: z.number().int().positive(),
  sources: generatedDraftSchema.shape.sources,
});
export type NoteOrigin = z.infer<typeof noteOriginSchema>;
