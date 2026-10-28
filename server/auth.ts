import { createMiddleware } from "hono/factory";
import { apiError } from "../shared/http.ts";
import { SESSION_COOKIE_NAME, readCookie } from "./cookies.ts";

export type AuthenticatedUser = Readonly<{ userId: string }>;
export type AuthEnv = { Variables: { user: AuthenticatedUser } };

/**
 * Return null for invalid credentials; throw on authentication-service failures.
 * Authenticators may append response headers, such as a refreshed or cleared
 * session cookie, through the second argument.
 */
export type AuthenticateRequest = (
  request: Request,
  responseHeaders?: Headers,
) => Promise<AuthenticatedUser | null>;

export function applyResponseHeaders(
  target: {
    header: (name: string, value: string, options?: { append?: boolean }) => void;
  },
  headers: Headers,
): void {
  for (const [name, value] of headers) {
    target.header(name, value, { append: name.toLowerCase() === "set-cookie" });
  }
}

/** Requires a verified identity. Each resource operation still checks its own permissions. */
export function requireAuth(authenticateRequest: AuthenticateRequest) {
  return createMiddleware<AuthEnv>(async (c, next) => {
    const responseHeaders = new Headers();
    const user = await authenticateRequest(c.req.raw, responseHeaders);
    applyResponseHeaders(c, responseHeaders);
    if (!user) {
      c.header("WWW-Authenticate", 'Bearer realm="atlas"');
      return c.json(apiError("UNAUTHENTICATED", "Sign in to continue."), 401);
    }
    c.set("user", user);
    await next();
  });
}

/**
 * Use Bearer verification exclusively whenever an Authorization header exists.
 * Only header-free requests may fall back to the sealed browser session.
 */
export function createRequestAuthenticator(
  bearer: AuthenticateRequest | undefined,
  browser: AuthenticateRequest | undefined,
): AuthenticateRequest {
  return async (request, responseHeaders) => {
    if (request.headers.has("Authorization")) {
      return bearer ? bearer(request, responseHeaders) : null;
    }
    return browser ? browser(request, responseHeaders) : null;
  };
}

/**
 * Cookie-authenticated unsafe requests must come from the configured
 * application origin. Bearer requests do not use ambient cookie identity and
 * are exempt from the origin check.
 */
export function requireCookieRequestOrigin(appOrigin: string) {
  return createMiddleware(async (c, next) => {
    const method = c.req.method.toUpperCase();
    const unsafe = method !== "GET" && method !== "HEAD" && method !== "OPTIONS";
    const cookiePresent =
      readCookie(c.req.header("Cookie") ?? null, SESSION_COOKIE_NAME) !== undefined;
    if (unsafe && !c.req.header("Authorization") && cookiePresent) {
      if (c.req.header("Origin") !== appOrigin) {
        return c.json(apiError("FORBIDDEN", "Request origin is not allowed."), 403);
      }
    }
    await next();
  });
}
