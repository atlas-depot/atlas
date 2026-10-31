import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { defineAgent } from "eve";
import { readConfig } from "../config.ts";

const config = readConfig();
const provider = createOpenRouter({ apiKey: config.OPENROUTER_API_KEY });

export default defineAgent({
  model: provider(config.ORGANIZER_MODEL),
  modelContextWindowTokens: config.ORGANIZER_CONTEXT_TOKENS,
  defaultTools: false,
  limits: { sessionTimeoutMs: config.ORGANIZER_IDLE_TIMEOUT_MS },
  experimental: { workflow: { retention: 0 } },
});
