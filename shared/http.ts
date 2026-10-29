import { z } from "zod";

/**
 * Copy the response ETag into If-Match for PUT/DELETE. Atlas requires one strong
 * tag (visible ASCII except inner quotes); weak tags, lists and * are rejected.
 * Missing: 428. Malformed/unsupported: 400. Stale: 412, leaving stored data intact.
 * Compare and write atomically after checking resource access.
 */
export const ifMatchSchema = z
  .string()
  .max(512)
  .regex(/^"[\x21\x23-\x7e]+"$/);

/** Public errors never include provider details, credentials or submitted content. */
export const apiErrorSchema = z.strictObject({
  error: z.strictObject({
    code: z.enum([
      "VALIDATION_ERROR",
      "UNAUTHENTICATED",
      "FORBIDDEN",
      "NOT_FOUND",
      "PRECONDITION_REQUIRED",
      "PRECONDITION_FAILED",
      "NOT_IMPLEMENTED",
      "INTERNAL_ERROR",
    ]),
    message: z.string(),
  }),
});

export type ApiError = z.infer<typeof apiErrorSchema>;

export function apiError(code: ApiError["error"]["code"], message: string): ApiError {
  return { error: { code, message } };
}
