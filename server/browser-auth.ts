import { timingSafeEqual } from "node:crypto";
import { AuthenticationException, OauthException, type User, type WorkOS } from "@workos-inc/node";
import type { SessionUser } from "../shared/auth.ts";
import type { AuthenticateRequest } from "./auth.ts";
import {
  LOGIN_TRANSACTION_COOKIE_NAME,
  SESSION_COOKIE_NAME,
  clearCookie,
  readCookie,
  serializeCookie,
  type CookieSettings,
} from "./cookies.ts";
import { createTransactionSealer } from "./transaction.ts";

const DEFAULT_TRANSACTION_TTL_SECONDS = 10 * 60;

export type BrowserAuthOptions = Readonly<{
  appOrigin: string;
  cookiePassword: string;
  transactionTtlSeconds?: number;
  now?: () => number;
}>;

export type CompleteLoginResult =
  | Readonly<{
      ok: true;
      user: SessionUser;
      sessionCookie: string;
      clearTransactionCookie: string;
    }>
  | Readonly<{
      ok: false;
      error: "invalid_transaction" | "invalid_code";
      clearTransactionCookie: string;
    }>;

export type BrowserAuth = Readonly<{
  authenticate: AuthenticateRequest;
  readSession: (request: Request, responseHeaders?: Headers) => Promise<SessionUser | null>;
  startLogin: () => Promise<{ url: string; transactionCookie: string }>;
  completeLogin: (input: {
    code: string;
    state: string;
    transaction: string | undefined;
  }) => Promise<CompleteLoginResult>;
  cancelLogin: (input: {
    state: string | undefined;
    transaction: string | undefined;
  }) =>
    | Readonly<{ ok: true; clearTransactionCookie: string }>
    | Readonly<{ ok: false; error: "invalid_transaction" }>;
  logout: (request: Request) => Promise<{ redirectTo: string; sessionCookie: string }>;
}>;

function toSessionUser(user: User): SessionUser {
  return {
    id: user.id,
    email: user.email,
    firstName: user.firstName ?? null,
    lastName: user.lastName ?? null,
  };
}

function statesMatch(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function isClientAuthError(error: unknown): boolean {
  return (
    (error instanceof OauthException || error instanceof AuthenticationException) &&
    error.status >= 400 &&
    error.status < 500
  );
}

/**
 * Owns the browser session lifecycle: AuthKit PKCE login, callback exchange,
 * sealed HttpOnly session cookies, refresh and WorkOS logout.
 */
export function createBrowserAuth(workos: WorkOS, options: BrowserAuthOptions): BrowserAuth {
  const appOrigin = new URL(options.appOrigin).origin;
  const secure = new URL(appOrigin).protocol === "https:";
  const redirectUri = new URL("/api/auth/callback", appOrigin).toString();
  const returnTo = new URL("/", appOrigin).toString();
  const transactionTtlSeconds = options.transactionTtlSeconds ?? DEFAULT_TRANSACTION_TTL_SECONDS;
  const now = options.now ?? Date.now;
  const sealer = createTransactionSealer(options.cookiePassword);
  const sessionCookieSettings: CookieSettings = { path: "/", secure };
  const loginCookieSettings: CookieSettings = { path: "/api/auth", secure };

  function sessionCookie(sealedSession: string): string {
    return serializeCookie(SESSION_COOKIE_NAME, sealedSession, sessionCookieSettings);
  }

  function clearSessionCookie(): string {
    return clearCookie(SESSION_COOKIE_NAME, sessionCookieSettings);
  }

  function clearLoginTransactionCookie(): string {
    return clearCookie(LOGIN_TRANSACTION_COOKIE_NAME, loginCookieSettings);
  }

  function appendCookie(headers: Headers | undefined, cookie: string): void {
    headers?.append("Set-Cookie", cookie);
  }

  function validateTransaction(state: string | undefined, transaction: string | undefined) {
    if (!state) return null;
    const parsed = sealer.unseal(transaction, now());
    if (!parsed || !statesMatch(state, parsed.state)) return null;
    return parsed;
  }

  async function readSession(
    request: Request,
    responseHeaders?: Headers,
  ): Promise<SessionUser | null> {
    const sealedSession = readCookie(request.headers.get("Cookie"), SESSION_COOKIE_NAME);
    if (!sealedSession) return null;
    const session = workos.userManagement.loadSealedSession({
      sessionData: sealedSession,
      cookiePassword: options.cookiePassword,
    });
    const authenticated = await session.authenticate();
    if (authenticated.authenticated) return toSessionUser(authenticated.user);

    if (authenticated.reason === "invalid_jwt") {
      const refreshed = await session.refresh({ cookiePassword: options.cookiePassword });
      if (refreshed.authenticated) {
        if (!refreshed.sealedSession) throw new Error("WorkOS did not return a refreshed session.");
        appendCookie(responseHeaders, sessionCookie(refreshed.sealedSession));
        return toSessionUser(refreshed.user);
      }
      if (refreshed.retryable) {
        // Keep the existing cookie so the user can retry without signing in again.
        throw new Error("WorkOS session refresh is temporarily unavailable.");
      }
    }

    appendCookie(responseHeaders, clearSessionCookie());
    return null;
  }

  return {
    authenticate: async (request, responseHeaders) => {
      const user = await readSession(request, responseHeaders);
      return user ? { userId: user.id } : null;
    },

    readSession,

    startLogin: async () => {
      const authorization = await workos.userManagement.getAuthorizationUrlWithPKCE({
        provider: "authkit",
        redirectUri,
      });
      const transaction = sealer.seal({
        state: authorization.state,
        codeVerifier: authorization.codeVerifier,
        expiresAt: now() + transactionTtlSeconds * 1_000,
      });
      return {
        url: authorization.url,
        transactionCookie: serializeCookie(
          LOGIN_TRANSACTION_COOKIE_NAME,
          transaction,
          loginCookieSettings,
          transactionTtlSeconds,
        ),
      };
    },

    completeLogin: async (input) => {
      const clearTransactionCookie = clearLoginTransactionCookie();
      const transaction = validateTransaction(input.state, input.transaction);
      if (!transaction) {
        return { ok: false, error: "invalid_transaction", clearTransactionCookie };
      }
      try {
        const response = await workos.userManagement.authenticateWithCode({
          code: input.code,
          codeVerifier: transaction.codeVerifier,
          session: { sealSession: true, cookiePassword: options.cookiePassword },
        });
        if (!response.sealedSession) throw new Error("WorkOS did not return a sealed session.");
        return {
          ok: true,
          user: toSessionUser(response.user),
          sessionCookie: sessionCookie(response.sealedSession),
          clearTransactionCookie,
        };
      } catch (error) {
        if (isClientAuthError(error)) {
          return { ok: false, error: "invalid_code", clearTransactionCookie };
        }
        throw error;
      }
    },

    cancelLogin: (input) => {
      const clearTransactionCookie = clearLoginTransactionCookie();
      return validateTransaction(input.state, input.transaction)
        ? { ok: true, clearTransactionCookie }
        : { ok: false, error: "invalid_transaction" };
    },

    logout: async (request) => {
      const sealedSession = readCookie(request.headers.get("Cookie"), SESSION_COOKIE_NAME);
      if (sealedSession) {
        try {
          const session = workos.userManagement.loadSealedSession({
            sessionData: sealedSession,
            cookiePassword: options.cookiePassword,
          });
          const authenticated = await session.authenticate();
          if (authenticated.authenticated) {
            return {
              redirectTo: workos.userManagement.getLogoutUrl({
                sessionId: authenticated.sessionId,
                returnTo,
              }),
              sessionCookie: clearSessionCookie(),
            };
          }
          if (authenticated.reason === "invalid_jwt") {
            const refreshed = await session.refresh({ cookiePassword: options.cookiePassword });
            if (refreshed.authenticated) {
              return {
                redirectTo: workos.userManagement.getLogoutUrl({
                  sessionId: refreshed.sessionId,
                  returnTo,
                }),
                sessionCookie: clearSessionCookie(),
              };
            }
          }
        } catch {
          // Local sign-out must still complete when the provider is unreachable.
        }
      }
      return { redirectTo: returnTo, sessionCookie: clearSessionCookie() };
    },
  };
}
