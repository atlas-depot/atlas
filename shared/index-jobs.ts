import { z } from "zod";
import { EMBEDDING_FINGERPRINT } from "./embedding.ts";
import { noteIdSchema } from "./notes.ts";
import { notePassageVersionSchema } from "./passages.ts";

export const indexRuntimeUrlSchema = z.url().refine((value) => {
  const url = new URL(value);
  return (
    (url.protocol === "https:" ||
      (url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))) &&
    !url.username &&
    !url.password &&
    !url.search &&
    !url.hash &&
    url.pathname === "/"
  );
});

/** Only content-free identifiers cross the durable Workflow boundary. */
export const indexClaimSchema = z.strictObject({
  noteId: noteIdSchema,
  revision: z.number().int().positive().max(2_147_483_647),
  fingerprint: z.literal(EMBEDDING_FINGERPRINT),
  token: z.uuid(),
  runtimeUrl: indexRuntimeUrlSchema,
});
export type IndexClaim = z.infer<typeof indexClaimSchema>;
export const indexFailureCodeSchema = z.enum([
  "unsupported_content",
  "invalid_embedding",
  "provider_unavailable",
  "runtime_unavailable",
  "runtime_failed",
  "completion_missing",
]);
export type IndexFailureCode = z.infer<typeof indexFailureCodeSchema>;
export const indexRunStatusSchema = z.enum([
  "pending",
  "running",
  "completed",
  "failed",
  "cancelled",
]);
export type IndexRunStatus = z.infer<typeof indexRunStatusSchema>;

const version = notePassageVersionSchema;
export const indexStatusSchema = z.discriminatedUnion("status", [
  z.strictObject({ status: z.literal("pending"), version }),
  z.strictObject({ status: z.literal("processing"), version }),
  z.strictObject({
    status: z.literal("ready"),
    version,
    passageCount: z.number().int().nonnegative(),
  }),
  z.strictObject({
    status: z.literal("failed"),
    version,
    code: indexFailureCodeSchema,
    retryAt: z.iso.datetime().nullable(),
  }),
]);
export type IndexStatus = z.infer<typeof indexStatusSchema>;
