import { z } from "zod";
import { embeddingVectorSchema } from "../shared/embedding.ts";
import { indexRuntimeUrlSchema } from "../shared/index-jobs.ts";
import { searchQuerySchema } from "./search-query.ts";

const responseSchema = z.strictObject({ embedding: embeddingVectorSchema });

/** Private transport to the existing Qwen embedding adapter; errors never expose provider data. */
export function createSearchEmbeddingClient(options: {
  baseUrl: string;
  serviceToken: string;
  deploymentProtectionSecret?: string;
  fetchImpl?: typeof fetch;
}) {
  const base = indexRuntimeUrlSchema.parse(options.baseUrl);
  const token = z.string().min(32).max(512).regex(/^\S+$/).parse(options.serviceToken);
  return async (query: string): Promise<number[]> => {
    const text = searchQuerySchema.parse(query);
    try {
      const response = await (options.fetchImpl ?? fetch)(
        new URL("/internal/note-search/embed", base),
        {
          method: "POST",
          headers: {
            authorization: `Basic ${Buffer.from(`atlas-api:${token}`).toString("base64")}`,
            "content-type": "application/json",
            ...(options.deploymentProtectionSecret
              ? { "x-vercel-protection-bypass": options.deploymentProtectionSecret }
              : {}),
          },
          body: JSON.stringify({ query: text }),
          signal: AbortSignal.timeout(65_000),
          redirect: "error",
          credentials: "omit",
          cache: "no-store",
        },
      );
      if (!response.ok) throw new Error("Private search embedding failed.");
      const parsed = responseSchema.safeParse(await response.json());
      if (!parsed.success) throw new Error("Invalid private search embedding response.");
      return parsed.data.embedding;
    } catch {
      throw new Error("Search embedding is unavailable.");
    }
  };
}
