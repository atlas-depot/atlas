import { z } from "zod";
import { documentContentSchema, noteTextSchema } from "./document.ts";

export const noteIdSchema = z.uuid();
/** Account-scoped key for one logical creation, reused with the original payload. */
export const createNoteKeySchema = z.uuid().transform((value) => value.toLowerCase());

/** Editable fields: preserve whitespace, allow empty drafts. Limits use UTF-16 code units. */
export const noteContentSchema = z.strictObject({
  title: noteTextSchema.max(256),
  /** Legacy Markdown or a versioned block document, never rendered HTML. */
  content: documentContentSchema,
});

export const createNoteSchema = noteContentSchema.extend({
  /** Client creation instant in UTC; immutable after creation. Display in the user's locale. */
  createdAt: z.iso.datetime().refine((value) => !value.startsWith("0000-"), {
    error: "Creation time must use year 0001 or later.",
  }),
});
export const updateNoteSchema = noteContentSchema;
export const noteSchema = createNoteSchema.extend({
  id: noteIdSchema,
  /** Initially createdAt; the server sets this on successful edits, not for conflict detection. */
  updatedAt: z.iso.datetime(),
});
export const noteListSchema = z.strictObject({ notes: z.array(noteSchema) });

/**
 * REST contract under /api/notes:
 * POST: CreateNote -> 201 Note; GET: -> 200 { notes: Note[] }.
 * GET /:id: -> 200 Note; PUT /:id: UpdateNote -> 200 Note; DELETE /:id: -> 204.
 * Individual Note responses carry ETag; PUT replaces both editable fields.
 * POST requires a UUID Idempotency-Key. Matching, unchanged replays return the same 201/ETag.
 * Changed payload, edited note or deleted note under that key returns 409 CONFLICT.
 * Key/hash/note-ID metadata remains until account deletion; no content snapshot is retained.
 * PUT/DELETE require If-Match (shared/http.ts). DELETE has no body.
 * Invalid input/UUID: 400; unauthenticated: 401; absent or inaccessible note: 404.
 * Ownership comes only from the verified user. Clients never supply owner IDs.
 */
export type Note = z.infer<typeof noteSchema>;
export type CreateNote = z.infer<typeof createNoteSchema>;
export type UpdateNote = z.infer<typeof updateNoteSchema>;
