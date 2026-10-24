import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { defineAgent } from "eve";

const openrouter = createOpenRouter();

// eve discovers agent configuration through this default export.
export default defineAgent({
  model: openrouter("openai/gpt-4.1-mini", {
    maxTokens: 256,
    temperature: 0,
    usage: { include: true },
  }),
  modelContextWindowTokens: 1_047_576,
  defaultTools: false,
  limits: {
    sessionUsage: ({ total }) => total.outputTokens >= 1,
  },
});
