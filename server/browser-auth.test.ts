import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { once } from "node:events";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { WorkOS } from "@workos-inc/node";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vite-plus/test";
import { createBrowserAuth, type BrowserAuth } from "./browser-auth.ts";
import { LOGIN_TRANSACTION_COOKIE_NAME, SESSION_COOKIE_NAME, readCookie } from "./cookies.ts";

const issuer = "https://auth.example.test/";
const clientId = "client_fixture";
const appOrigin = "https://app.example.test";
const cookiePassword = "atlas-test-cookie-password-at-least-32";
const key = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = {
  ...key.publicKey.export({ format: "jwk" }),
  kid: "fixture-key",
  alg: "RS256",
  use: "sig",
};

type RefreshMode = "success" | "invalid_grant" | "unavailable";

const provider = {
  codeError: false,
  codeExpired: false,
  codeUserId: "user_alice",
  refreshMode: "success" as RefreshMode,
  challenge: undefined as string | undefined,
  requests: [] as Array<Record<string, unknown>>,
};

function accessToken(userId: string, sessionId: string, expired: boolean): string {
  const now = Math.floor(Date.now() / 1_000);
  const header = Buffer.from(
    JSON.stringify({ alg: "RS256", kid: "fixture-key", typ: "JWT" }),
  ).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({
      sub: userId,
      sid: sessionId,
      iss: issuer,
      exp: expired ? now - 60 : now + 300,
      iat: now,
      auth_time: now,
    }),
  ).toString("base64url");
  const input = `${header}.${payload}`;
  return `${input}.${sign("RSA-SHA256", Buffer.from(input), key.privateKey).toString("base64url")}`;
}

function authenticationResponse(userId: string, expired: boolean) {
  const now = new Date().toISOString();
  return {
    user: {
      object: "user",
      id: userId,
      email: `${userId}@example.test`,
      email_verified: true,
      profile_picture_url: null,
      name: null,
      first_name: userId === "user_alice" ? "Alice" : null,
      last_name: userId === "user_alice" ? "Example" : null,
      last_sign_in_at: now,
      locale: "en-US",
      created_at: now,
      updated_at: now,
    },
    access_token: accessToken(userId, `session_${userId}`, expired),
    refresh_token: `refresh_${userId}`,
    authentication_method: "GoogleOAuth",
  };
}

async function readBody(request: IncomingMessage): Promise<string> {
  let body = "";
  for await (const chunk of request) body += chunk;
  return body;
}

function writeJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
}

async function handleProviderRequest(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  if (url.pathname === `/sso/jwks/${clientId}`) {
    writeJson(response, 200, { keys: [jwk] });
    return;
  }
  if (url.pathname === "/user_management/authenticate" && request.method === "POST") {
    const body = JSON.parse(await readBody(request)) as Record<string, unknown>;
    provider.requests.push(body);
    if (body.grant_type === "authorization_code") {
      if (provider.codeError) {
        writeJson(response, 400, { error: "invalid_grant", error_description: "synthetic" });
        return;
      }
      const verifier = typeof body.code_verifier === "string" ? body.code_verifier : "";
      const challenge = createHash("sha256").update(verifier).digest("base64url");
      if (!provider.challenge || challenge !== provider.challenge) {
        writeJson(response, 400, { error: "invalid_grant", error_description: "PKCE mismatch" });
        return;
      }
      writeJson(response, 200, authenticationResponse(provider.codeUserId, provider.codeExpired));
      return;
    }
    if (body.grant_type === "refresh_token") {
      if (provider.refreshMode === "invalid_grant") {
        writeJson(response, 400, { error: "invalid_grant", error_description: "synthetic" });
        return;
      }
      if (provider.refreshMode === "unavailable") {
        writeJson(response, 503, { message: "synthetic outage" });
        return;
      }
      writeJson(response, 200, authenticationResponse(provider.codeUserId, false));
      return;
    }
  }
  writeJson(response, 404, { message: "not found" });
}

const server = createServer((request, response) => {
  void handleProviderRequest(request, response).catch(() => {
    if (!response.headersSent) response.writeHead(500);
    response.end();
  });
});
let port: number;

beforeAll(async () => {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing provider port");
  port = address.port;
});
afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
});
beforeEach(() => {
  provider.codeError = false;
  provider.codeExpired = false;
  provider.codeUserId = "user_alice";
  provider.refreshMode = "success";
  provider.challenge = undefined;
  provider.requests = [];
});

function createAuth(overrides: { transactionTtlSeconds?: number } = {}): BrowserAuth {
  const workos = new WorkOS({
    clientId,
    issuer,
    apiKey: "sk_test_fixture",
    apiHostname: "127.0.0.1",
    https: false,
    port,
    maxRetries: 0,
  });
  return createBrowserAuth(workos, { appOrigin, cookiePassword, ...overrides });
}

async function startLogin(auth: BrowserAuth) {
  const login = await auth.startLogin();
  const url = new URL(login.url);
  provider.challenge = url.searchParams.get("code_challenge") ?? undefined;
  return {
    login,
    url,
    state: url.searchParams.get("state") ?? "",
    transaction: readCookie(login.transactionCookie, LOGIN_TRANSACTION_COOKIE_NAME) ?? "",
  };
}

async function complete(
  auth: BrowserAuth,
  started: Awaited<ReturnType<typeof startLogin>>,
  overrides: { code?: string; state?: string; transaction?: string } = {},
) {
  return auth.completeLogin({
    code: overrides.code ?? "code_fixture",
    state: overrides.state ?? started.state,
    transaction: overrides.transaction ?? started.transaction,
  });
}

function sessionRequest(sessionCookie: string): Request {
  const value = readCookie(sessionCookie, SESSION_COOKIE_NAME);
  if (!value) throw new Error("Missing session cookie");
  return new Request(`${appOrigin}/api/auth/session`, {
    headers: { Cookie: `${SESSION_COOKIE_NAME}=${value}` },
  });
}

function responseSetCookies(headers: Headers): string[] {
  return headers.getSetCookie();
}

describe("WorkOS browser auth with a synthetic provider", () => {
  it("starts hosted AuthKit login with PKCE and a sealed transaction cookie", async () => {
    const started = await startLogin(createAuth());
    expect(started.url.pathname).toBe("/user_management/authorize");
    expect(started.url.searchParams.get("provider")).toBe("authkit");
    expect(started.url.searchParams.get("redirect_uri")).toBe(`${appOrigin}/api/auth/callback`);
    expect(started.url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(started.url.searchParams.get("code_challenge")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(started.state).not.toBe("");
    expect(started.transaction).toMatch(/^v1\./);
    expect(started.login.transactionCookie).toContain("Path=/api/auth");
    expect(started.login.transactionCookie).toContain("HttpOnly");
    expect(started.login.transactionCookie).toContain("SameSite=Lax");
    expect(started.login.transactionCookie).toContain("Secure");
    expect(started.login.transactionCookie).toContain("Max-Age=600");
    expect(provider.requests).toEqual([]);
  });

  it("exchanges a valid callback and returns a sealed session cookie", async () => {
    const auth = createAuth();
    const result = await complete(auth, await startLogin(auth));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.user).toEqual({
      id: "user_alice",
      email: "user_alice@example.test",
      firstName: "Alice",
      lastName: "Example",
    });
    expect(result.sessionCookie).toContain(`${SESSION_COOKIE_NAME}=`);
    expect(result.sessionCookie).toContain("Path=/");
    expect(result.sessionCookie).toContain("HttpOnly");
    expect(result.sessionCookie).toContain("SameSite=Lax");
    expect(result.sessionCookie).toContain("Secure");
    expect(result.clearTransactionCookie).toContain("Max-Age=0");
    expect(provider.requests).toHaveLength(1);
    expect(provider.requests[0]).toMatchObject({
      grant_type: "authorization_code",
      code: "code_fixture",
    });
    expect(provider.requests[0]?.code_verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(JSON.stringify(result.user)).not.toMatch(/token/i);
    expect(await auth.readSession(sessionRequest(result.sessionCookie))).toEqual(result.user);
  });

  it("rejects a mismatched, tampered or expired transaction before exchange", async () => {
    const auth = createAuth();
    const started = await startLogin(auth);
    expect(await complete(auth, started, { state: "wrong-state" })).toMatchObject({
      ok: false,
      error: "invalid_transaction",
    });
    const parts = started.transaction.split(".");
    const ciphertext = parts[2] ?? "";
    const index = Math.floor(ciphertext.length / 2);
    const replacement = ciphertext[index] === "A" ? "B" : "A";
    parts[2] = `${ciphertext.slice(0, index)}${replacement}${ciphertext.slice(index + 1)}`;
    const tampered = parts.join(".");
    expect(await complete(auth, started, { transaction: tampered })).toMatchObject({
      ok: false,
      error: "invalid_transaction",
    });
    const shortTag = started.transaction.split(".");
    shortTag[3] = Buffer.from([1, 2, 3, 4]).toString("base64url");
    expect(await complete(auth, started, { transaction: shortTag.join(".") })).toMatchObject({
      ok: false,
      error: "invalid_transaction",
    });
    const expiredAuth = createAuth({ transactionTtlSeconds: -1 });
    const expired = await startLogin(expiredAuth);
    expect(await complete(expiredAuth, expired)).toMatchObject({
      ok: false,
      error: "invalid_transaction",
    });
    expect(provider.requests).toEqual([]);
  });

  it("validates the transaction before cancelling a login", async () => {
    const auth = createAuth();
    const started = await startLogin(auth);
    const cancelled = auth.cancelLogin({
      state: started.state,
      transaction: started.transaction,
    });
    expect(cancelled).toMatchObject({ ok: true });
    if (!cancelled.ok) return;
    expect(cancelled.clearTransactionCookie).toContain("Max-Age=0");
    expect(
      auth.cancelLogin({ state: "wrong-state", transaction: started.transaction }),
    ).toMatchObject({ ok: false, error: "invalid_transaction" });
    expect(auth.cancelLogin({ state: started.state, transaction: "v1.invalid" })).toMatchObject({
      ok: false,
      error: "invalid_transaction",
    });
    expect(provider.requests).toEqual([]);
  });

  it("maps a rejected authorization code to invalid_code", async () => {
    provider.codeError = true;
    const auth = createAuth();
    const result = await complete(auth, await startLogin(auth));
    expect(result).toMatchObject({ ok: false, error: "invalid_code" });
    expect(provider.requests).toHaveLength(1);
  });

  it("refreshes an expired browser session and returns a new sealed cookie", async () => {
    provider.codeExpired = true;
    const auth = createAuth();
    const login = await complete(auth, await startLogin(auth));
    if (!login.ok) throw new Error("Synthetic login failed");

    const headers = new Headers();
    expect(await auth.readSession(sessionRequest(login.sessionCookie), headers)).toEqual(
      login.user,
    );
    const setCookies = responseSetCookies(headers);
    expect(setCookies).toHaveLength(1);
    expect(setCookies[0]).toContain(`${SESSION_COOKIE_NAME}=`);
    expect(setCookies[0]).not.toBe(login.sessionCookie);
    expect(provider.requests.at(-1)).toMatchObject({ grant_type: "refresh_token" });

    const refreshed = setCookies[0]?.split(";")[0];
    if (!refreshed) throw new Error("Missing refreshed cookie");
    expect(
      await auth.readSession(
        new Request(`${appOrigin}/api/auth/session`, { headers: { Cookie: refreshed } }),
      ),
    ).toEqual(login.user);
  });

  it("clears the cookie after a terminal refresh failure", async () => {
    provider.codeExpired = true;
    const auth = createAuth();
    const login = await complete(auth, await startLogin(auth));
    if (!login.ok) throw new Error("Synthetic login failed");

    provider.refreshMode = "invalid_grant";
    const headers = new Headers();
    expect(await auth.readSession(sessionRequest(login.sessionCookie), headers)).toBeNull();
    expect(responseSetCookies(headers)[0]).toContain("Max-Age=0");
  });

  it("preserves the session on a retryable refresh failure", async () => {
    provider.codeExpired = true;
    const auth = createAuth();
    const login = await complete(auth, await startLogin(auth));
    if (!login.ok) throw new Error("Synthetic login failed");

    provider.refreshMode = "unavailable";
    const headers = new Headers();
    await expect(auth.readSession(sessionRequest(login.sessionCookie), headers)).rejects.toThrow(
      /temporarily unavailable/,
    );
    expect(responseSetCookies(headers)).toEqual([]);
  });

  it("clears an unreadable session cookie", async () => {
    const headers = new Headers();
    const request = new Request(`${appOrigin}/api/auth/session`, {
      headers: { Cookie: `${SESSION_COOKIE_NAME}=not-a-sealed-session` },
    });
    expect(await createAuth().readSession(request, headers)).toBeNull();
    expect(responseSetCookies(headers)[0]).toContain("Max-Age=0");
  });

  it("uses the WorkOS logout flow and clears the local session", async () => {
    const auth = createAuth();
    const login = await complete(auth, await startLogin(auth));
    if (!login.ok) throw new Error("Synthetic login failed");
    const sessionValue = readCookie(login.sessionCookie, SESSION_COOKIE_NAME);
    if (!sessionValue) throw new Error("Missing session value");

    const result = await auth.logout(
      new Request(`${appOrigin}/api/auth/logout`, {
        method: "POST",
        headers: { Cookie: `${SESSION_COOKIE_NAME}=${sessionValue}` },
      }),
    );
    const url = new URL(result.redirectTo);
    expect(url.pathname).toBe("/user_management/sessions/logout");
    expect(url.searchParams.get("session_id")).toBe("session_user_alice");
    expect(url.searchParams.get("return_to")).toBe(`${appOrigin}/`);
    expect(result.sessionCookie).toContain("Max-Age=0");
  });

  it("refreshes an expired session before building the logout URL", async () => {
    provider.codeExpired = true;
    const auth = createAuth();
    const login = await complete(auth, await startLogin(auth));
    if (!login.ok) throw new Error("Synthetic login failed");
    const sessionValue = readCookie(login.sessionCookie, SESSION_COOKIE_NAME);
    if (!sessionValue) throw new Error("Missing session value");

    const result = await auth.logout(
      new Request(`${appOrigin}/api/auth/logout`, {
        method: "POST",
        headers: { Cookie: `${SESSION_COOKIE_NAME}=${sessionValue}` },
      }),
    );
    expect(result.redirectTo).toContain("/user_management/sessions/logout");
    expect(provider.requests.at(-1)).toMatchObject({ grant_type: "refresh_token" });
  });

  it("returns the local application origin when no session exists", async () => {
    const result = await createAuth().logout(
      new Request(`${appOrigin}/api/auth/logout`, { method: "POST" }),
    );
    expect(result.redirectTo).toBe(`${appOrigin}/`);
    expect(result.sessionCookie).toContain("Max-Age=0");
  });

  it("replaces the browser session when a different account completes login", async () => {
    const auth = createAuth();
    const first = await complete(auth, await startLogin(auth));
    if (!first.ok) throw new Error("First synthetic login failed");
    provider.codeUserId = "user_bob";
    const second = await complete(auth, await startLogin(auth));
    if (!second.ok) throw new Error("Second synthetic login failed");
    expect(second.user.id).toBe("user_bob");
    expect(await auth.readSession(sessionRequest(second.sessionCookie))).toEqual(second.user);
  });
});
