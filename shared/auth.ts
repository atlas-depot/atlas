import { z } from "zod";

/** Browser-safe shape returned by GET /api/auth/session. Never includes tokens. */
export const sessionUserSchema = z.strictObject({
  id: z.string().min(1),
  email: z.email(),
  firstName: z.string().nullable(),
  lastName: z.string().nullable(),
});

export const sessionResponseSchema = z.strictObject({
  user: sessionUserSchema,
});

export type SessionUser = z.infer<typeof sessionUserSchema>;
