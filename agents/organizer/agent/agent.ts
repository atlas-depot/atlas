import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { defineAgent } from "eve";
import { readConfig } from "../config.ts";

const config = readConfig();
const provider = createOpenRouter({ apiKey: config.OPENROUTER_API_KEY });

export default defineAgent({
  model: provider(config.ORGANIZER_MODEL, { maxTokens: 16_384 }),
  modelContextWindowTokens: config.ORGANIZER_CONTEXT_TOKENS,
  defaultTools: false,
  limits: {
    sessionTimeoutMs: config.ORGANIZER_IDLE_TIMEOUT_MS,
    // Runtime backstop if the Atlas observer disappears. This pauses rather
    // than starting another call; the adapter rejects an incomplete proposal.
    sessionUsage: ({ total }) => total.inputTokens >= 1_000_000 || total.outputTokens >= 65_536,
  },
  experimental: { workflow: { retention: 0 } },
});
