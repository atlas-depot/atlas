import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { defineTool } from "eve/tools";
import { z } from "zod";
import { readConfig } from "../../config.ts";
import { createResearch } from "../../research.ts";
import { createRetryFetch } from "../../retry-fetch.ts";

const config = readConfig();
const provider = createOpenRouter({
  apiKey: config.OPENROUTER_API_KEY,
  fetch: createRetryFetch(),
});
const research = createResearch({
  model: provider(config.ORGANIZER_MODEL),
  webSearch: provider.tools.webSearch({}),
});

export default defineTool({
  description:
    "Research a public question on the web. Returns an answer with source records. " +
    "Use only when outside information helps the note. Ask a focused question, not the entire private note.",
  inputSchema: z.object({ question: z.string().trim().min(1) }),
  label: { start: () => "Researching sources" },
  execute: ({ question }, ctx) => research(question, ctx.abortSignal),
});
