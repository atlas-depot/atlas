import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { defineAgent } from "eve";
import { readConfig } from "../config.ts";
import { wrapLanguageModel } from "ai";
import { contextBudget } from "../context-budget.ts";
import { defineDynamic } from "eve/models";
import { isChatSession, isContextSession } from "../job.ts";
import { openDatabase, readDatabaseUrl } from "../../../server/db/connection.ts";
import { createConversationTurns } from "../../../server/db/conversation-turns.ts";
import { createConversationContextStore } from "../../../server/db/conversation-contexts.ts";

const config = readConfig();
const provider = createOpenRouter({ apiKey: config.OPENROUTER_API_KEY });

export default defineAgent({
  model: defineDynamic((ctx) => {
    const model = provider(config.ORGANIZER_MODEL, { maxTokens: 16_384 });
    if (!isChatSession(ctx.session) && !isContextSession(ctx.session))
      return { model, modelContextWindowTokens: config.ORGANIZER_CONTEXT_TOKENS };
    // The provider boundary also covers eve's automatic compaction and provider retries.
    const guarded = wrapLanguageModel({
      model,
      middleware: contextBudget(config.ORGANIZER_CONTEXT_TOKENS, async () => {
        const connection = openDatabase(readDatabaseUrl(process.env), {
          max: 1,
          lockTimeoutMs: 5_000,
        });
        try {
          return isChatSession(ctx.session)
            ? await createConversationTurns(connection.db).contextAuthorized(ctx.session.id)
            : await createConversationContextStore(connection.db).summaryAuthorized(ctx.session.id);
        } finally {
          await connection.close();
        }
      }),
    });
    return { model: guarded, modelContextWindowTokens: config.ORGANIZER_CONTEXT_TOKENS };
  }),
  defaultTools: false,
  limits: {
    sessionTimeoutMs: config.ORGANIZER_IDLE_TIMEOUT_MS,
    // Runtime backstop if the Atlas observer disappears. This pauses rather
    // than starting another call; the adapter rejects an incomplete proposal.
    sessionUsage: ({ total }) => total.inputTokens >= 1_000_000 || total.outputTokens >= 65_536,
  },
  experimental: { workflow: { retention: 0 } },
});
