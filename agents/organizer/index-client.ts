import { z } from "zod";
import { indexRunStatusSchema, indexRuntimeUrlSchema } from "../../shared/index-jobs.ts";
import { noteIdSchema } from "../../shared/notes.ts";

export const indexRunIdSchema = z
  .string()
  .min(1)
  .max(512)
  .regex(/^[a-zA-Z0-9_-]+$/);
export const indexStartResultSchema = z.discriminatedUnion("status", [
  z.strictObject({ status: z.literal("started"), runId: indexRunIdSchema }),
  z.strictObject({ status: z.literal("unchanged") }),
]);
export type IndexStartResult = z.infer<typeof indexStartResultSchema>;
const runResponseSchema = z.strictObject({ runId: indexRunIdSchema, status: indexRunStatusSchema });

/** Private control plane. Never retrieves Workflow input, output or provider errors. */
export function createNoteIndexClient(options: {
  baseUrl: string;
  serviceToken: string;
  deploymentProtectionSecret?: string;
  fetchImpl?: typeof fetch;
}) {
  const base = indexRuntimeUrlSchema.safeParse(options.baseUrl);
  if (!base.success || options.serviceToken.length < 32) {
    throw new Error("Note index endpoint or service credential is invalid.");
  }
  const request = async (path: string, body?: { noteId: string }): Promise<unknown> => {
    try {
      const response = await (options.fetchImpl ?? fetch)(new URL(path, base.data), {
        method: body ? "POST" : "GET",
        headers: {
          authorization: `Basic ${Buffer.from(`atlas-api:${options.serviceToken}`).toString("base64")}`,
          ...(body ? { "content-type": "application/json" } : {}),
          ...(options.deploymentProtectionSecret
            ? { "x-vercel-protection-bypass": options.deploymentProtectionSecret }
            : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(5_000),
        redirect: "error",
        credentials: "omit",
        cache: "no-store",
      });
      if (!response.ok) throw new Error("Unavailable");
      return await response.json();
    } catch {
      throw new Error("Note index runtime is unavailable.");
    }
  };
  return {
    async start(noteId: string): Promise<IndexStartResult> {
      if (!noteIdSchema.safeParse(noteId).success) throw new Error("Invalid note identifier.");
      const parsed = indexStartResultSchema.safeParse(
        await request("/internal/note-index/start", { noteId }),
      );
      if (!parsed.success) throw new Error("Invalid note index runtime response.");
      return parsed.data;
    },
    async status(runId: string) {
      if (!indexRunIdSchema.safeParse(runId).success) throw new Error("Invalid run identifier.");
      const parsed = runResponseSchema.safeParse(
        await request(`/internal/note-index/runs/${encodeURIComponent(runId)}`),
      );
      if (!parsed.success || parsed.data.runId !== runId)
        throw new Error("Invalid note index runtime response.");
      return parsed.data.status;
    },
  };
}
