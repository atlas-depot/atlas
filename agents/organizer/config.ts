import { z } from "zod";

const configSchema = z.object({
  OPENROUTER_API_KEY: z.string().min(1),
  ORGANIZER_MODEL: z.string().min(1),
  ORGANIZER_CONTEXT_TOKENS: z.coerce.number().int().positive(),
  ORGANIZER_IDLE_TIMEOUT_MS: z.coerce.number().int().positive(),
  ORGANIZER_SERVICE_TOKEN: z.string().min(32),
});

export function readConfig(env: NodeJS.ProcessEnv = process.env) {
  const result = configSchema.safeParse(env);
  if (!result.success) throw new Error("Organizer configuration is missing or invalid.");
  return result.data;
}
