import { z } from "zod";

export const noteIdSchema = z.uuid();
export const noteContentSchema = z.strictObject({
  title: z.string().max(256),
  content: z.string().max(100_000),
});

export const createNoteSchema = noteContentSchema.extend({
  createdAt: z.iso.datetime(),
});
export const updateNoteSchema = noteContentSchema;
export const noteSchema = createNoteSchema.extend({
  id: noteIdSchema,
  updatedAt: z.iso.datetime(),
});
export const noteListSchema = z.strictObject({ notes: z.array(noteSchema) });

// Atlas accepts one strong tag on writes, not wildcard or list preconditions.
// Clients must copy the opaque tag from the latest single-note response.
export const noteETagSchema = z
  .string()
  .max(512)
  .regex(/^"[\x21\x23-\x7e]+"$/);
export const noteWriteHeadersSchema = z.strictObject({ "if-match": noteETagSchema });

export const apiErrorSchema = z.strictObject({
  error: z.strictObject({
    code: z.enum([
      "VALIDATION_ERROR",
      "UNAUTHENTICATED",
      "NOT_FOUND",
      "PRECONDITION_REQUIRED",
      "PRECONDITION_FAILED",
      "NOT_IMPLEMENTED",
      "INTERNAL_ERROR",
    ]),
    message: z.string(),
  }),
});

export type Note = z.infer<typeof noteSchema>;
export type CreateNote = z.infer<typeof createNoteSchema>;
export type UpdateNote = z.infer<typeof updateNoteSchema>;
export type ApiError = z.infer<typeof apiErrorSchema>;

export function apiError(code: ApiError["error"]["code"], message: string): ApiError {
  return { error: { code, message } };
}
