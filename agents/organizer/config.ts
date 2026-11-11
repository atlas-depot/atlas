import { z } from "zod";

export const DEFAULT_ORGANIZER_MODEL = "openai/gpt-6-luna";

const configSchema = z.object({
  OPENROUTER_API_KEY: z.string().min(1),
  ORGANIZER_MODEL: z.string().min(1).default(DEFAULT_ORGANIZER_MODEL),
  ORGANIZER_CONTEXT_TOKENS: z.coerce.number().int().positive(),
  ORGANIZER_IDLE_TIMEOUT_MS: z.coerce.number().int().positive().max(2_147_483_647),
  ORGANIZER_SERVICE_TOKEN: z.string().min(32),
});

export function readConfig(env: NodeJS.ProcessEnv = process.env) {
  const result = configSchema.safeParse(env);
  if (!result.success) throw new Error("Organizer configuration is missing or invalid.");
  return result.data;
}
