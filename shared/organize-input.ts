import { z } from "zod";
import { noteTextSchema } from "./document.ts";

// Inspect whitespace for validation only. The owner can reopen the exact submitted text.
const requestText = noteTextSchema.max(100_000).refine((text) => text.trim().length > 0);

export const requestInputSchema = z.strictObject({ kind: z.literal("request"), text: requestText });
export const noteInputSchema = z.strictObject({
  kind: z.literal("note"),
  noteId: z.uuid(),
  instruction: requestText.optional(),
});
export const organizeInputSchema = z.discriminatedUnion("kind", [
  requestInputSchema,
  noteInputSchema,
]);

export type OrganizeInput = z.infer<typeof organizeInputSchema>;
