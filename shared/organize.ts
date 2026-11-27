import { z } from "zod";
import { noteTextSchema } from "./document.ts";

const sourceUrlSchema = z.url({ protocol: /^https?$/ }).refine((value) => {
  if (!URL.canParse(value)) return false;
  const url = new URL(value);
  return url.username === "" && url.password === "";
});

/** New organizer turns return only these editable fields. */
export const draftProposalSchema = z.strictObject({
  title: noteTextSchema.max(256).refine((value) => value.trim().length > 0),
  markdown: noteTextSchema.max(100_000).refine((value) => value.trim().length > 0),
});

/** The final turn timestamp and the model selected for its successful eve call. */
export const draftGenerationSchema = z.strictObject({
  generatedAt: z.iso.datetime(),
  // The provider may resolve this to another model; eve does not retain its response model ID.
  runtimeModelId: noteTextSchema.min(1).max(512).optional(),
});
export type DraftGeneration = z.infer<typeof draftGenerationSchema>;

/** Older runs have no proposed title. Source records always come from the research adapter. */
export const generatedDraftSchema = draftProposalSchema.partial({ title: true }).extend({
  generation: draftGenerationSchema.optional(),
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
    source: z
      .object({
        noteId: z.uuid(),
        revision: z.number().int().positive().safe(),
        stale: z.boolean(),
      })
      .nullable(),
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
const savedNoteOriginSchema = z.strictObject({
  sourceNoteId: z.uuid(),
  sourceRevision: z.number().int().positive(),
  sources: generatedDraftSchema.shape.sources,
});
export const noteOriginSchema = z.union([
  savedNoteOriginSchema,
  savedNoteOriginSchema.extend({ sourceNoteId: z.null(), sourceRevision: z.null() }),
]);
export type NoteOrigin = z.infer<typeof noteOriginSchema>;
