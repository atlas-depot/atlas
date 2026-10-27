import { z } from "zod";

const environmentSchema = z.object({
  API_PORT: z
    .string()
    .regex(/^\d+$/)
    .default("3001")
    .transform(Number)
    .pipe(z.number().int().min(0).max(65535)),
});

export function readServerEnv(environment: Record<string, string | undefined>) {
  const parsed = environmentSchema.safeParse(environment);
  if (!parsed.success) {
    // Configuration errors must never echo environment values or credentials.
    throw new Error("Invalid API_PORT: expected an integer from 0 to 65535.");
  }
  return { port: parsed.data.API_PORT };
}
