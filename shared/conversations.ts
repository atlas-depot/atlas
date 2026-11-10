import { z } from "zod";
import { noteTextSchema } from "./document.ts";
import { notePassageSourceSchema } from "./passages.ts";

export const conversationIdSchema = z.uuid().transform((value) => value.toLowerCase());
export const conversationOperationKeySchema = conversationIdSchema;
export const conversationInputIdsSchema = z
  .array(conversationIdSchema)
  .min(1)
  .max(100)
  .refine((ids) => new Set(ids).size === ids.length);
export const createConversationSchema = z.strictObject({});
/** All conversation text bounds use UTF-16 code units, preserving valid source text. */
export const conversationTextSchema = noteTextSchema.refine((value) => value.length <= 100_000);
export const conversationCitationInputSchema = z
  .strictObject({
    source: notePassageSourceSchema,
    excerpt: noteTextSchema.refine((value) => value.length > 0 && value.length <= 1_000).nullable(),
    deleted: z.boolean(),
  })
  .refine((citation) => citation.deleted === (citation.excerpt === null));
export const conversationCitationSchema = conversationCitationInputSchema.safeExtend({
  stale: z.boolean(),
});
const maximumCitations = 100;
export const conversationCitationInputsSchema = z
  .array(conversationCitationInputSchema)
  .max(maximumCitations);
const conversationCitationsSchema = z.array(conversationCitationSchema).max(maximumCitations);
export const conversationSchema = z.strictObject({
  id: conversationIdSchema,
  queuePaused: z.boolean(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
const messageFields = {
  id: conversationIdSchema,
  sequence: z.number().int().positive(),
  text: conversationTextSchema,
  createdAt: z.iso.datetime(),
};
export const conversationMessageSchema = z.discriminatedUnion("role", [
  z.strictObject({
    ...messageFields,
    role: z.literal("user"),
    deliveryPolicy: z.enum(["queue", "steer"]),
  }),
  z
    .strictObject({
      ...messageFields,
      role: z.literal("assistant"),
      turnId: conversationIdSchema,
      status: z.enum(["completed", "no-support", "incomplete"]),
      reason: z.enum(["failed", "cancelled"]).nullable(),
      inputIds: conversationInputIdsSchema,
      citations: conversationCitationsSchema,
    })
    .refine((message) => (message.status === "incomplete") === (message.reason !== null)),
]);
export const activeConversationTurnSchema = z.strictObject({
  id: conversationIdSchema,
  status: z.literal("running"),
  text: conversationTextSchema,
  checkpointVersion: z.number().int().nonnegative(),
  inputIds: conversationInputIdsSchema,
});
export const conversationReadSchema = z.strictObject({
  conversation: conversationSchema,
  activeTurn: activeConversationTurnSchema.nullable(),
});
export const conversationListSchema = z.strictObject({
  conversations: z.array(conversationSchema),
  nextCursor: z.string().nullable(),
});
export const conversationHistorySchema = z.strictObject({
  messages: z.array(conversationMessageSchema),
  nextCursor: z.string().nullable(),
});
export const conversationPageSchema = z.strictObject({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().min(1).max(512).optional(),
});
export type Conversation = z.infer<typeof conversationSchema>;
export type ConversationMessage = z.infer<typeof conversationMessageSchema>;
export type ConversationCitation = z.infer<typeof conversationCitationSchema>;
export type ConversationRead = z.infer<typeof conversationReadSchema>;
export type ConversationList = z.infer<typeof conversationListSchema>;
export type ConversationHistory = z.infer<typeof conversationHistorySchema>;
export type ConversationPage = z.infer<typeof conversationPageSchema>;
