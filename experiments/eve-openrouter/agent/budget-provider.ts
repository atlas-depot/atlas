import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { z } from "zod";

const keySchema = z.object({
  data: z.object({
    limit: z.number().positive().max(1),
    limit_reset: z.null(),
    limit_remaining: z.number().positive(),
    include_byok_in_limit: z.literal(true),
  }),
});

export function createBudgetedOpenRouter(
  apiKey: string | undefined,
  fetchImpl: typeof fetch = fetch,
) {
  return createOpenRouter({
    // Keep credential-free configuration inspection working without SDK env fallback.
    apiKey: apiKey ?? "",
    fetch: async (input, init) => {
      if (!apiKey)
        throw new Error("Set OPENROUTER_API_KEY in the server's ignored .env.local file.");
      const throwIfCancelled = () => {
        if (init?.signal?.aborted) throw new DOMException("Model request cancelled.", "AbortError");
      };
      throwIfCancelled();
      // Check the server credential on every request, including SDK retries.
      // Never trust a preflight performed by a client in another process.
      try {
        const response = await fetchImpl("https://openrouter.ai/api/v1/key", {
          headers: { Authorization: `Bearer ${apiKey}` },
          redirect: "error",
          signal: AbortSignal.any([
            AbortSignal.timeout(15_000),
            ...(init?.signal ? [init.signal] : []),
          ]),
        });
        if (!response.ok || !keySchema.safeParse(await response.json()).success) {
          throw new Error("Invalid key budget.");
        }
      } catch {
        // Preserve cancellation semantics without disclosing the caller's reason.
        throwIfCancelled();
        throw new Error(
          "Server key check failed. Use a non-resetting limit of at most $1 with remaining credit and BYOK usage included.",
        );
      }
      throwIfCancelled();
      const headers = new Headers(init?.headers);
      headers.set("Authorization", `Bearer ${apiKey}`);
      return fetchImpl(input, { ...init, headers, redirect: "error" });
    },
  });
}
