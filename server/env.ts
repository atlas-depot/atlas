import { z } from "zod";

const environmentSchema = z.object({
  API_PORT: z
    .string()
    .regex(/^\d+$/)
    .default("3001")
    .transform(Number)
    .pipe(z.number().int().min(0).max(65535)),
});

const workosSchema = z.object({
  WORKOS_CLIENT_ID: z.string().regex(/^client_[A-Za-z0-9]+$/),
  WORKOS_ISSUER: z.url({ protocol: /^https$/ }),
});

export function readServerEnv(environment: Record<string, string | undefined>) {
  const parsed = environmentSchema.safeParse(environment);
  if (!parsed.success) {
    // Configuration errors must never echo environment values or credentials.
    throw new Error("Invalid API_PORT: expected an integer from 0 to 65535.");
  }
  if (environment.WORKOS_CLIENT_ID === undefined && environment.WORKOS_ISSUER === undefined) {
    return { port: parsed.data.API_PORT };
  }
  const workos = workosSchema.safeParse(environment);
  if (!workos.success) {
    throw new Error(
      "Set both WORKOS_CLIENT_ID and WORKOS_ISSUER to valid WorkOS environment values.",
    );
  }
  return {
    port: parsed.data.API_PORT,
    workos: { clientId: workos.data.WORKOS_CLIENT_ID, issuer: workos.data.WORKOS_ISSUER },
  };
}
