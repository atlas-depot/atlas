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

const browserAuthSchema = workosSchema.extend({
  APP_ORIGIN: z
    .url({ protocol: /^https?$/ })
    .refine((value) => new URL(value).origin === value)
    .refine((value) => {
      const url = new URL(value);
      return (
        url.protocol === "https:" || ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
      );
    }),
  WORKOS_API_KEY: z.string().min(1).max(512).regex(/^\S+$/),
  WORKOS_COOKIE_PASSWORD: z.string().min(32).max(512),
});

const browserSettings = ["APP_ORIGIN", "WORKOS_API_KEY", "WORKOS_COOKIE_PASSWORD"] as const;

export function readServerEnv(environment: Record<string, string | undefined>) {
  const parsed = environmentSchema.safeParse(environment);
  if (!parsed.success) {
    // Configuration errors must never echo environment values or credentials.
    throw new Error("Invalid API_PORT: expected an integer from 0 to 65535.");
  }
  if (browserSettings.some((name) => environment[name] !== undefined)) {
    const browser = browserAuthSchema.safeParse(environment);
    if (!browser.success) {
      throw new Error(
        "Set APP_ORIGIN, WORKOS_API_KEY, WORKOS_CLIENT_ID, WORKOS_COOKIE_PASSWORD and WORKOS_ISSUER to valid WorkOS browser sign-in values.",
      );
    }
    return {
      port: parsed.data.API_PORT,
      workos: { clientId: browser.data.WORKOS_CLIENT_ID, issuer: browser.data.WORKOS_ISSUER },
      browserAuth: {
        appOrigin: browser.data.APP_ORIGIN,
        apiKey: browser.data.WORKOS_API_KEY,
        cookiePassword: browser.data.WORKOS_COOKIE_PASSWORD,
      },
    };
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
