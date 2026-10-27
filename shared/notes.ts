import { z } from "zod";

export const noteIdSchema = z.uuid();

/** Editable fields: preserve whitespace, allow empty drafts. Limits use UTF-16 code units. */
export const noteContentSchema = z.strictObject({
  title: z.string().max(256),
  /** Markdown source, never rendered HTML. */
  content: z.string().max(100_000),
});

export const createNoteSchema = noteContentSchema.extend({
  /** Client creation instant in UTC; immutable after creation. Display in the user's locale. */
  createdAt: z.iso.datetime(),
});
export const updateNoteSchema = noteContentSchema;
export const noteSchema = createNoteSchema.extend({
  id: noteIdSchema,
  /** Initially createdAt; the server sets this on successful edits, not for conflict detection. */
  updatedAt: z.iso.datetime(),
});
export const noteListSchema = z.strictObject({ notes: z.array(noteSchema) });

/**
 * REST target under /api/notes (storage is not connected yet):
 * POST: CreateNote -> 201 Note; GET: -> 200 { notes: Note[] }.
 * GET /:id: -> 200 Note; PUT /:id: UpdateNote -> 200 Note; DELETE /:id: -> 204.
 * Individual Note responses carry ETag; PUT replaces both editable fields.
 * PUT/DELETE require If-Match (shared/http.ts). DELETE has no body.
 * Invalid input/UUID: 400; unauthenticated: 401; absent or inaccessible note: 404.
 * Ownership comes only from the verified user. Clients never supply owner IDs.
 */
export type Note = z.infer<typeof noteSchema>;
export type CreateNote = z.infer<typeof createNoteSchema>;
export type UpdateNote = z.infer<typeof updateNoteSchema>;
