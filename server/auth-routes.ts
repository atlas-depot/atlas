import { Hono } from "hono";
import type { Context } from "hono";
import { apiError } from "../shared/http.ts";
import { applyResponseHeaders } from "./auth.ts";
import type { BrowserAuth } from "./browser-auth.ts";
import { LOGIN_TRANSACTION_COOKIE_NAME, readCookie } from "./cookies.ts";

function unauthorized(c: Context) {
  c.header("WWW-Authenticate", 'Bearer realm="atlas"');
  return c.json(apiError("UNAUTHENTICATED", "Sign in to continue."), 401);
}

/**
 * Public authentication routes. They mount before the protected API router so
 * that login and callback requests never require an existing session.
 */
export function createAuthRoutes(browserAuth: BrowserAuth, options: { appOrigin: string }) {
  const routes = new Hono();
  const home = new URL("/", options.appOrigin).toString();

  routes.get("/login", async (c) => {
    const { url, transactionCookie } = await browserAuth.startLogin();
    c.header("Set-Cookie", transactionCookie, { append: true });
    return c.redirect(url, 302);
  });

  routes.get("/callback", async (c) => {
    const transaction = readCookie(c.req.header("Cookie") ?? null, LOGIN_TRANSACTION_COOKIE_NAME);
    if (c.req.query("error")) {
      const state = c.req.query("state");
      const canceled = browserAuth.cancelLogin({ state, transaction });
      if (!canceled.ok) {
        return c.json(apiError("FORBIDDEN", "Sign in state is invalid or expired."), 403);
      }
      c.header("Set-Cookie", canceled.clearTransactionCookie, { append: true });
      return c.json(apiError("UNAUTHENTICATED", "Sign in could not be completed."), 401);
    }
    const code = c.req.query("code");
    const state = c.req.query("state");
    if (!code || !state) {
      const canceled = browserAuth.cancelLogin({ state, transaction });
      if (canceled.ok) {
        c.header("Set-Cookie", canceled.clearTransactionCookie, { append: true });
      }
      return c.json(apiError("VALIDATION_ERROR", "Sign in callback is incomplete."), 400);
    }

    const result = await browserAuth.completeLogin({ code, state, transaction });
    c.header("Set-Cookie", result.clearTransactionCookie, { append: true });
    if (!result.ok) {
      if (result.error === "invalid_transaction") {
        return c.json(apiError("FORBIDDEN", "Sign in state is invalid or expired."), 403);
      }
      return c.json(apiError("UNAUTHENTICATED", "Sign in could not be completed."), 401);
    }

    c.header("Set-Cookie", result.sessionCookie, { append: true });
    return c.redirect(home, 303);
  });

  routes.get("/session", async (c) => {
    // Bearer credentials never fall back to the ambient cookie on this route.
    if (c.req.raw.headers.has("Authorization")) return unauthorized(c);
    const responseHeaders = new Headers();
    const user = await browserAuth.readSession(c.req.raw, responseHeaders);
    applyResponseHeaders(c, responseHeaders);
    if (!user) return unauthorized(c);
    return c.json({ user });
  });

  routes.post("/logout", async (c) => {
    // Logout is a browser-session operation; Bearer credentials never fall
    // back to the ambient cookie on this route.
    if (c.req.raw.headers.has("Authorization")) return unauthorized(c);
    const { redirectTo, sessionCookie } = await browserAuth.logout(c.req.raw);
    c.header("Set-Cookie", sessionCookie, { append: true });
    return c.redirect(redirectTo, 303);
  });

  return routes;
}
