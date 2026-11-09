import { z } from "zod";
import { readDatabaseUrl } from "./db/connection.ts";

const organizerSchema = z.object({
  ORGANIZER_RUNTIME_URL: z.url({ protocol: /^https?$/ }).refine((value) => {
    if (!URL.canParse(value)) return false;
    const url = new URL(value);
    return (
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      url.pathname === "/" &&
      (url.protocol === "https:" || ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
    );
  }),
  ORGANIZER_SERVICE_TOKEN: z.string().min(32).max(512).regex(/^\S+$/),
  ORGANIZER_DEPLOYMENT_PROTECTION_SECRET: z.string().min(1).max(512).regex(/^\S+$/).optional(),
  ORGANIZER_RESULT_RETENTION_MS: z
    .string()
    .regex(/^\d+$/)
    .default("900000")
    .transform(Number)
    .pipe(z.number().int().min(1).max(2_147_483_647)),
});

function readOrganizerEnv(environment: Record<string, string | undefined>) {
  if (!Object.keys(organizerSchema.shape).some((key) => environment[key] !== undefined)) {
    return undefined;
  }
  const parsed = organizerSchema.safeParse(environment);
  if (!parsed.success)
    throw new Error("Set valid organizer runtime, service and retention settings.");
  return {
    connectionString: readDatabaseUrl(environment),
    runtimeUrl: parsed.data.ORGANIZER_RUNTIME_URL,
    serviceToken: parsed.data.ORGANIZER_SERVICE_TOKEN,
    deploymentProtectionSecret: parsed.data.ORGANIZER_DEPLOYMENT_PROTECTION_SECRET,
    resultRetentionMs: parsed.data.ORGANIZER_RESULT_RETENTION_MS,
  };
}

const environmentSchema = z.object({
  API_PORT: z
    .string()
    .regex(/^\d+$/)
    .default("3001")
    .transform(Number)
    .pipe(z.number().int().min(0).max(65535)),
});

/** 30 days. */
export const DEFAULT_SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;
/** 400 days, the longest session duration WorkOS allows. */
export const MAX_SESSION_MAX_AGE_SECONDS = 400 * 24 * 60 * 60;

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
  // Client-side ceiling for the session cookie. WorkOS still decides when a refresh is refused.
  SESSION_MAX_AGE_SECONDS: z
    .string()
    .regex(/^\d+$/)
    .default(String(DEFAULT_SESSION_MAX_AGE_SECONDS))
    .transform(Number)
    .pipe(z.number().int().min(60).max(MAX_SESSION_MAX_AGE_SECONDS)),
});

const browserSettings = [
  "APP_ORIGIN",
  "WORKOS_API_KEY",
  "WORKOS_COOKIE_PASSWORD",
  "SESSION_MAX_AGE_SECONDS",
] as const;

export function readServerEnv(environment: Record<string, string | undefined>): {
  port: number;
  databaseUrl?: string;
  organizer?: NonNullable<ReturnType<typeof readOrganizerEnv>>;
  workos?: { clientId: string; issuer: string };
  browserAuth?: {
    appOrigin: string;
    apiKey: string;
    cookiePassword: string;
    sessionMaxAgeSeconds: number;
  };
} {
  const parsed = environmentSchema.safeParse(environment);
  if (!parsed.success) {
    // Configuration errors must never echo environment values or credentials.
    throw new Error("Invalid API_PORT: expected an integer from 0 to 65535.");
  }
  const organizer = readOrganizerEnv(environment);
  const databaseUrl =
    environment.DATABASE_URL === undefined ? undefined : readDatabaseUrl(environment);
  const base = {
    port: parsed.data.API_PORT,
    ...(databaseUrl ? { databaseUrl } : {}),
    ...(organizer ? { organizer } : {}),
  };
  if (browserSettings.some((name) => environment[name] !== undefined)) {
    const browser = browserAuthSchema.safeParse(environment);
    if (!browser.success) {
      throw new Error(
        "Set APP_ORIGIN, WORKOS_API_KEY, WORKOS_CLIENT_ID, WORKOS_COOKIE_PASSWORD and WORKOS_ISSUER to valid WorkOS browser sign-in values.",
      );
    }
    return {
      ...base,
      workos: { clientId: browser.data.WORKOS_CLIENT_ID, issuer: browser.data.WORKOS_ISSUER },
      browserAuth: {
        appOrigin: browser.data.APP_ORIGIN,
        apiKey: browser.data.WORKOS_API_KEY,
        cookiePassword: browser.data.WORKOS_COOKIE_PASSWORD,
        sessionMaxAgeSeconds: browser.data.SESSION_MAX_AGE_SECONDS,
      },
    };
  }
  if (environment.WORKOS_CLIENT_ID === undefined && environment.WORKOS_ISSUER === undefined) {
    return base;
  }
  const workos = workosSchema.safeParse(environment);
  if (!workos.success) {
    throw new Error(
      "Set both WORKOS_CLIENT_ID and WORKOS_ISSUER to valid WorkOS environment values.",
    );
  }
  return {
    ...base,
    workos: { clientId: workos.data.WORKOS_CLIENT_ID, issuer: workos.data.WORKOS_ISSUER },
  };
}
