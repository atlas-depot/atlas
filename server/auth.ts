import { createMiddleware } from "hono/factory";
import { apiError } from "../shared/http.ts";

export type AuthenticatedUser = Readonly<{ userId: string }>;
export type AuthEnv = { Variables: { user: AuthenticatedUser } };

/** Return null for invalid credentials; throw on authentication-service failures. */
export type AuthenticateRequest = (request: Request) => Promise<AuthenticatedUser | null>;

/** Requires a verified identity. Each resource operation still checks its own permissions. */
export function requireAuth(authenticateRequest: AuthenticateRequest) {
  return createMiddleware<AuthEnv>(async (c, next) => {
    const user = await authenticateRequest(c.req.raw);
    if (!user) return c.json(apiError("UNAUTHENTICATED", "Sign in to continue."), 401);
    c.set("user", user);
    await next();
  });
}
