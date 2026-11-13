import { z } from "zod";
import { noteTextSchema } from "./document.ts";
import { conversationIdSchema } from "./conversations.ts";

export const researchDisclosureRequestSchema = z.strictObject({
  id: conversationIdSchema,
  proposedQuery: noteTextSchema.min(1).max(500),
  queryHash: z.string().regex(/^[0-9a-f]{64}$/),
  expiresAt: z.iso.datetime(),
});

export const researchDisclosureRequestsSchema = z.strictObject({
  requests: z.array(researchDisclosureRequestSchema).max(3),
});

export const researchDisclosureDecisionInputSchema = z.strictObject({
  queryHash: z.string().regex(/^[0-9a-f]{64}$/),
});

export const researchDisclosureDecisionSchema = z.strictObject({
  status: z.enum(["approved", "denied"]),
});

export type ResearchDisclosureRequest = z.infer<typeof researchDisclosureRequestSchema>;
