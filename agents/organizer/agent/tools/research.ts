import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { defineDynamic, defineTool } from "eve/tools";
import { z } from "zod";
import { readConfig } from "../../config.ts";
import { isOrganizeSession } from "../../job.ts";
import { createResearch } from "../../research.ts";
import { createRetryFetch } from "../../retry-fetch.ts";

const config = readConfig();
const provider = createOpenRouter({
  apiKey: config.OPENROUTER_API_KEY,
  fetch: createRetryFetch(),
});
const research = createResearch({
  model: provider(config.ORGANIZER_MODEL, { maxTokens: 8_192 }),
  webSearch: provider.tools.webSearch({}),
});

/** Each call is a paid web search. A focused question fits well under this bound. */
export const researchInputSchema = z.object({ question: z.string().trim().min(1).max(500) });

const tool = defineTool({
  description:
    "Research a public question on the web. Returns an answer with source records. " +
    "Use only when outside information helps the note. Ask a focused question, not the entire private note.",
  inputSchema: researchInputSchema,
  label: { start: () => "Researching sources" },
  // Research returns one opaque response, so a stalled tool needs its own runtime deadline.
  execute: ({ question }, ctx) =>
    research(question, AbortSignal.any([ctx.abortSignal, AbortSignal.timeout(180_000)])),
});

/** Public web research never appears in a question-answering session over private notes. */
export default defineDynamic((ctx) => (isOrganizeSession(ctx.session) ? tool : null));
