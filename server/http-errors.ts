import { DrizzleQueryError } from "drizzle-orm";
import type { Context } from "hono";
import { routePath } from "hono/route";

function field(error: unknown, key: "name" | "code"): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  try {
    const value: unknown = Reflect.get(error, key);
    return typeof value === "string" ? value : undefined;
  } catch {
    // A hostile getter must not turn the route's 503 into a 500.
    return undefined;
  }
}

/**
 * Writes one structured stderr line for a storage error that a route turns into a 503.
 * The route is the registered template, so note IDs and query strings stay out of logs.
 * Never add request bodies, headers, cookies, note content or error messages here:
 * driver and transport messages can carry SQL parameters or provider tokens.
 */
export function reportStorageFailure(c: Context, error: unknown): void {
  // Drizzle's wrapper message embeds the SQL parameters (titles, content, owner IDs).
  // Report the driver error it wraps, never the wrapper's own message.
  const source = error instanceof DrizzleQueryError ? error.cause : error;
  console.error(
    JSON.stringify({
      event: "storage_failure",
      method: c.req.method,
      route: routePath(c),
      name: field(source, "name"),
      code: field(source, "code"),
    }),
  );
}
