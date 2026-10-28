import { describe, expect, it, onTestFinished, vi } from "vite-plus/test";
import { sessionResponseSchema, type SessionUser } from "../shared/auth.ts";
import { createApp } from "./app.ts";
import { createAuthRoutes } from "./auth-routes.ts";
import { createRequestAuthenticator, type AuthenticateRequest } from "./auth.ts";
import type { BrowserAuth } from "./browser-auth.ts";
import { LOGIN_TRANSACTION_COOKIE_NAME, SESSION_COOKIE_NAME } from "./cookies.ts";

const appOrigin = "https://app.example.test";
const alice: SessionUser = {
  id: "user_alice",
  email: "alice@example.test",
  firstName: "Alice",
  lastName: null,
};
const transactionCookie = `${LOGIN_TRANSACTION_COOKIE_NAME}=txn; Path=/api/auth; HttpOnly; SameSite=Lax; Secure; Max-Age=600`;
const clearTransactionCookie = `${LOGIN_TRANSACTION_COOKIE_NAME}=; Path=/api/auth; HttpOnly; SameSite=Lax; Secure; Max-Age=0`;
const sessionCookie = `${SESSION_COOKIE_NAME}=session_fixture; Path=/; HttpOnly; SameSite=Lax; Secure`;
const clearSessionCookie = `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=0`;

type FakeOptions = {
  user?: SessionUser | null;
  authenticate?: AuthenticateRequest;
  startLogin?: BrowserAuth["startLogin"];
  completeLogin?: BrowserAuth["completeLogin"];
  readSession?: BrowserAuth["readSession"];
  logout?: BrowserAuth["logout"];
};

function fakeBrowserAuth(options: FakeOptions = {}): BrowserAuth {
  const user = options.user === undefined ? alice : options.user;
  return {
    authenticate: options.authenticate ?? (async () => (user ? { userId: user.id } : null)),
    readSession: options.readSession ?? (async () => user),
    startLogin:
      options.startLogin ??
      (async () => ({
        url: "https://auth.example.test/authorize?state=state_fixture",
        transactionCookie,
      })),
    completeLogin:
      options.completeLogin ??
      (async () => ({ ok: true, user: alice, sessionCookie, clearTransactionCookie })),
    clearLoginTransactionCookie: () => clearTransactionCookie,
    logout:
      options.logout ??
      (async () => ({
        redirectTo:
          "https://auth.example.test/user_management/sessions/logout?session_id=session_alice&return_to=https%3A%2F%2Fapp.example.test%2F",
        sessionCookie: clearSessionCookie,
      })),
  };
}

function createTestApp(
  auth: BrowserAuth,
  authenticateRequest: AuthenticateRequest = auth.authenticate,
) {
  return createApp(authenticateRequest, {
    appOrigin,
    authRoutes: createAuthRoutes(auth, { appOrigin }),
  });
}

describe("public authentication routes", () => {
  it("redirects login to hosted AuthKit and sets the transaction cookie", async () => {
    const response = await createTestApp(fakeBrowserAuth()).request("/api/auth/login");
    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe(
      "https://auth.example.test/authorize?state=state_fixture",
    );
    expect(response.headers.getSetCookie()).toEqual([transactionCookie]);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("does not leak provider errors from login", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    onTestFinished(() => log.mockRestore());
    const response = await createTestApp(
      fakeBrowserAuth({
        startLogin: async () => {
          throw new Error("SYNTHETIC_SECRET");
        },
      }),
    ).request("/api/auth/login");
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("SYNTHETIC_SECRET");
    expect(JSON.stringify(log.mock.calls)).not.toContain("SYNTHETIC_SECRET");
  });

  it("validates the callback, sets the session and clears the transaction", async () => {
    const completeLogin = vi.fn<BrowserAuth["completeLogin"]>(async () => ({
      ok: true,
      user: alice,
      sessionCookie,
      clearTransactionCookie,
    }));
    const response = await createTestApp(fakeBrowserAuth({ completeLogin })).request(
      "/api/auth/callback?code=code_fixture&state=state_fixture",
      { headers: { Cookie: `${LOGIN_TRANSACTION_COOKIE_NAME}=txn` } },
    );
    expect(response.status).toBe(303);
    expect(response.headers.get("Location")).toBe(`${appOrigin}/`);
    expect(response.headers.getSetCookie()).toEqual([clearTransactionCookie, sessionCookie]);
    expect(completeLogin).toHaveBeenCalledWith({
      code: "code_fixture",
      state: "state_fixture",
      transaction: "txn",
    });
  });

  it("clears the transaction when the provider reports a cancelled login", async () => {
    const completeLogin = vi.fn(async () => {
      throw new Error("Callback must not be exchanged");
    });
    const response = await createTestApp(fakeBrowserAuth({ completeLogin })).request(
      "/api/auth/callback?error=access_denied",
      { headers: { Cookie: `${LOGIN_TRANSACTION_COOKIE_NAME}=txn` } },
    );
    expect(response.status).toBe(401);
    expect(response.headers.getSetCookie()).toEqual([clearTransactionCookie]);
    expect(completeLogin).not.toHaveBeenCalled();
  });

  it("rejects an incomplete callback before exchange", async () => {
    const completeLogin = vi.fn(async () => {
      throw new Error("Callback must not be exchanged");
    });
    const response = await createTestApp(fakeBrowserAuth({ completeLogin })).request(
      "/api/auth/callback?code=only-code",
      { headers: { Cookie: `${LOGIN_TRANSACTION_COOKIE_NAME}=txn` } },
    );
    expect(response.status).toBe(400);
    expect(response.headers.getSetCookie()).toEqual([clearTransactionCookie]);
    expect(completeLogin).not.toHaveBeenCalled();
  });

  it.each(["invalid_transaction", "invalid_code"] as const)(
    "maps a %s callback result without exposing provider details",
    async (error) => {
      const result =
        error === "invalid_transaction"
          ? { ok: false as const, error: "invalid_transaction" as const, clearTransactionCookie }
          : { ok: false as const, error: "invalid_code" as const, clearTransactionCookie };
      const response = await createTestApp(
        fakeBrowserAuth({ completeLogin: async () => result }),
      ).request("/api/auth/callback?code=code_fixture&state=state_fixture", {
        headers: { Cookie: `${LOGIN_TRANSACTION_COOKIE_NAME}=txn` },
      });
      expect(response.status).toBe(error === "invalid_transaction" ? 403 : 401);
      expect(response.headers.getSetCookie()).toEqual([clearTransactionCookie]);
      expect(await response.text()).not.toContain("provider");
    },
  );

  it("returns the browser session without tokens", async () => {
    const response = await createTestApp(fakeBrowserAuth()).request("/api/auth/session", {
      headers: { Cookie: `${SESSION_COOKIE_NAME}=session_fixture` },
    });
    expect(response.status).toBe(200);
    const body: unknown = await response.json();
    expect(sessionResponseSchema.parse(body)).toEqual({ user: alice });
    expect(JSON.stringify(body)).not.toMatch(/token/i);
  });

  it("returns the existing 401 challenge without a browser session", async () => {
    const response = await createTestApp(fakeBrowserAuth({ user: null })).request(
      "/api/auth/session",
    );
    expect(response.status).toBe(401);
    expect(response.headers.get("WWW-Authenticate")).toBe('Bearer realm="atlas"');
    expect(await response.json()).toMatchObject({ error: { code: "UNAUTHENTICATED" } });
  });

  it("never falls back to the cookie when session receives Bearer credentials", async () => {
    const readSession = vi.fn(async () => alice);
    const response = await createTestApp(fakeBrowserAuth({ readSession })).request(
      "/api/auth/session",
      {
        headers: {
          Cookie: `${SESSION_COOKIE_NAME}=session_fixture`,
          Authorization: "Bearer fake",
        },
      },
    );
    expect(response.status).toBe(401);
    expect(readSession).not.toHaveBeenCalled();
  });

  it("applies a refreshed cookie from the session reader", async () => {
    const readSession: BrowserAuth["readSession"] = async (_request, headers) => {
      headers?.append("Set-Cookie", sessionCookie);
      return alice;
    };
    const response = await createTestApp(fakeBrowserAuth({ readSession })).request(
      "/api/auth/session",
    );
    expect(response.headers.getSetCookie()).toEqual([sessionCookie]);
  });

  it("uses the WorkOS logout flow for an origin-checked request", async () => {
    const logout = vi.fn(async () => ({
      redirectTo:
        "https://auth.example.test/user_management/sessions/logout?session_id=session_alice",
      sessionCookie: clearSessionCookie,
    }));
    const response = await createTestApp(fakeBrowserAuth({ logout })).request("/api/auth/logout", {
      method: "POST",
      headers: { Origin: appOrigin, Cookie: `${SESSION_COOKIE_NAME}=session_fixture` },
    });
    expect(response.status).toBe(303);
    expect(response.headers.get("Location")).toBe(
      "https://auth.example.test/user_management/sessions/logout?session_id=session_alice",
    );
    expect(response.headers.getSetCookie()).toEqual([clearSessionCookie]);
    expect(logout).toHaveBeenCalledTimes(1);
  });

  it.each([undefined, "https://evil.example.test"])(
    "rejects logout with a missing or mismatched origin: %s",
    async (origin) => {
      const logout = vi.fn(async () => ({
        redirectTo: appOrigin,
        sessionCookie: clearSessionCookie,
      }));
      const headers: Record<string, string> = {
        Cookie: `${SESSION_COOKIE_NAME}=session_fixture`,
      };
      if (origin) headers.Origin = origin;
      const response = await createTestApp(fakeBrowserAuth({ logout })).request(
        "/api/auth/logout",
        { method: "POST", headers },
      );
      expect(response.status).toBe(403);
      expect(logout).not.toHaveBeenCalled();
      expect(await response.json()).toMatchObject({ error: { code: "FORBIDDEN" } });
    },
  );

  it("does not use the cookie session for Bearer logout requests", async () => {
    const logout = vi.fn(async () => ({
      redirectTo: appOrigin,
      sessionCookie: clearSessionCookie,
    }));
    const response = await createTestApp(fakeBrowserAuth({ logout })).request("/api/auth/logout", {
      method: "POST",
      headers: {
        Origin: appOrigin,
        Cookie: `${SESSION_COOKIE_NAME}=session_fixture`,
        Authorization: "Bearer fake",
      },
    });
    expect(response.status).toBe(401);
    expect(response.headers.get("WWW-Authenticate")).toBe('Bearer realm="atlas"');
    expect(logout).not.toHaveBeenCalled();
  });
});

describe("protected API origin boundary", () => {
  it("rejects cookie-authenticated unsafe requests without the exact origin", async () => {
    const authenticateRequest = vi.fn(async () => ({ userId: alice.id }));
    const auth = fakeBrowserAuth({ authenticate: authenticateRequest });
    const app = createTestApp(auth, authenticateRequest);
    const unsafeRequests: Array<Record<string, string>> = [
      { Cookie: `${SESSION_COOKIE_NAME}=session_fixture` },
      {
        Cookie: `${SESSION_COOKIE_NAME}=session_fixture`,
        Origin: "https://evil.example.test",
      },
    ];
    for (const headers of unsafeRequests) {
      const response = await app.request("/api/notes", { method: "POST", headers });
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ error: { code: "FORBIDDEN" } });
    }
    expect(authenticateRequest).not.toHaveBeenCalled();
  });

  it("allows a cookie-authenticated unsafe request from the configured origin", async () => {
    const authenticateRequest = vi.fn(async () => ({ userId: alice.id }));
    const app = createTestApp(
      fakeBrowserAuth({ authenticate: authenticateRequest }),
      authenticateRequest,
    );
    const response = await app.request("/api/notes", {
      method: "POST",
      headers: {
        Cookie: `${SESSION_COOKIE_NAME}=session_fixture`,
        Origin: appOrigin,
      },
    });
    expect(response.status).toBe(501);
    expect(authenticateRequest).toHaveBeenCalledTimes(1);
  });

  it("does not require an origin for safe methods", async () => {
    const response = await createTestApp(fakeBrowserAuth()).request("/api/notes", {
      headers: { Cookie: `${SESSION_COOKIE_NAME}=session_fixture` },
    });
    expect(response.status).toBe(501);
  });

  it("exempts Bearer requests from the cookie origin check", async () => {
    const authenticateRequest = vi.fn(async () => ({ userId: alice.id }));
    const app = createTestApp(
      fakeBrowserAuth({ authenticate: authenticateRequest }),
      authenticateRequest,
    );
    const response = await app.request("/api/notes", {
      method: "POST",
      headers: {
        Cookie: `${SESSION_COOKIE_NAME}=session_fixture`,
        Authorization: "Bearer fake",
      },
    });
    expect(response.status).toBe(501);
    expect(authenticateRequest).toHaveBeenCalledTimes(1);
  });

  it("does not fall back to the cookie when an invalid Bearer request has no origin", async () => {
    const app = createTestApp(
      fakeBrowserAuth(),
      createRequestAuthenticator(
        async () => null,
        async () => ({ userId: alice.id }),
      ),
    );
    const response = await app.request("/api/notes", {
      method: "POST",
      headers: {
        Cookie: `${SESSION_COOKIE_NAME}=session_fixture`,
        Authorization: "Bearer invalid",
      },
    });
    expect(response.status).toBe(401);
    expect(response.headers.get("WWW-Authenticate")).toBe('Bearer realm="atlas"');
  });

  it("applies refreshed cookies from the authenticator to protected responses", async () => {
    const authenticateRequest: AuthenticateRequest = async (_request, headers) => {
      headers?.append("Set-Cookie", sessionCookie);
      return { userId: alice.id };
    };
    const response = await createTestApp(
      fakeBrowserAuth({ authenticate: authenticateRequest }),
      authenticateRequest,
    ).request("/api/notes", {
      headers: { Cookie: `${SESSION_COOKIE_NAME}=old` },
    });
    expect(response.status).toBe(501);
    expect(response.headers.getSetCookie()).toEqual([sessionCookie]);
  });
});
