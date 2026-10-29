import { generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import { once } from "node:events";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { WorkOS } from "@workos-inc/node";
import { afterAll, beforeAll, describe, expect, it, onTestFinished, vi } from "vite-plus/test";
import { createApp } from "./app.ts";
import { createBearerAuthenticator } from "./workos.ts";

const issuer = "https://auth.example.test/";
const key = generateKeyPairSync("rsa", { modulusLength: 2048 });
const otherKey = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...key.publicKey.export({ format: "jwk" }), kid: "fixture-key", alg: "RS256" };

function token(overrides: Record<string, unknown> = {}, privateKey: KeyObject = key.privateKey) {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: "RS256", kid: "fixture-key" })).toString(
    "base64url",
  );
  const payload = Buffer.from(
    JSON.stringify({
      sub: "user_alice",
      sid: "session_alice",
      iss: issuer,
      exp: now + 300,
      iat: now,
      auth_time: now,
      ...overrides,
    }),
  ).toString("base64url");
  const input = `${header}.${payload}`;
  return `${input}.${sign("RSA-SHA256", Buffer.from(input), privateKey).toString("base64url")}`;
}

describe("WorkOS access-token boundary with synthetic signing keys", () => {
  const server = createServer((request, response) => {
    response.setHeader("Content-Type", "application/json");
    if (request.url === "/sso/jwks/client_fixture") {
      response.end(JSON.stringify({ keys: [jwk] }));
    } else {
      response.writeHead(503);
      response.end(JSON.stringify({ error: "SYNTHETIC_PROVIDER_FAILURE" }));
    }
  });
  let port: number;

  beforeAll(async () => {
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing fixture port");
    port = address.port;
  });
  afterAll(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  });

  function authenticator(clientId = "client_fixture") {
    return createBearerAuthenticator(
      new WorkOS({ clientId, issuer, apiHostname: "127.0.0.1", https: false, port }),
    );
  }

  it("derives identity from a verified token and reaches protected operations", async () => {
    const authenticate = authenticator();
    const headers = { Authorization: `bEaReR  ${token()}`, "X-User-Id": "user_bob" };
    expect(
      await authenticate(new Request("http://atlas.test/api/notes?userId=user_bob", { headers })),
    ).toEqual({ userId: "user_alice" });
    const response = await createApp(authenticate).request("/api/notes", { headers });
    expect(response.status).toBe(501);
    expect(response.headers.get("WWW-Authenticate")).toBeNull();
  });

  it("authenticates signed tokens through the real Node entrypoint", async () => {
    // Replace only the JWKS network response; the SDK still verifies real signatures and claims.
    const preload = `
      const originalFetch = globalThis.fetch;
      globalThis.fetch = (input, init) => originalFetch(
        String(input) === 'https://api.workos.com/sso/jwks/client_fixture'
          ? 'http://127.0.0.1:${port}/sso/jwks/client_fixture' : input, init);
    `;
    const child = spawn(
      process.execPath,
      ["--import", `data:text/javascript,${encodeURIComponent(preload)}`, "server/index.ts"],
      {
        cwd: fileURLToPath(new URL("../", import.meta.url)),
        env: {
          ...process.env,
          API_PORT: "0",
          WORKOS_CLIENT_ID: "client_fixture",
          WORKOS_ISSUER: issuer,
          WORKOS_API_KEY: undefined,
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    onTestFinished(async () => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      const closed = once(child, "close");
      child.kill("SIGTERM");
      const deadline = setTimeout(() => child.kill("SIGKILL"), 2_000);
      await closed;
      clearTimeout(deadline);
    });
    let output = "";
    let startupError: Error | undefined;
    child.on("error", (error) => {
      startupError = error;
    });
    child.stdout.on("data", (data: Buffer) => {
      output += data.toString();
    });
    const url = await vi.waitFor(
      () => {
        if (startupError) throw startupError;
        expect(child.exitCode).toBeNull();
        const address = output.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];
        expect(address).toBeDefined();
        return address!;
      },
      { timeout: 5_000, interval: 20 },
    );
    for (const [accessToken, expectedStatus] of [
      [token(), 501],
      [token({}, otherKey.privateKey), 401],
    ] as const) {
      const response = await fetch(`${url}/api/notes`, {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(3_000),
      });
      expect(response.status).toBe(expectedStatus);
      expect(response.headers.get("WWW-Authenticate")).toBe(
        expectedStatus === 401 ? 'Bearer realm="atlas"' : null,
      );
      await response.arrayBuffer();
    }
  }, 15_000);

  it.each([undefined, "Basic abc", "Bearer", "Bearer\tabc", "Bearer abc, Bearer def"])(
    "rejects missing or malformed credentials: %s",
    async (authorization) => {
      const response = await createApp(authenticator()).request("/api/notes", {
        headers: authorization ? { Authorization: authorization } : {},
      });
      expect(response.status).toBe(401);
      expect(response.headers.get("WWW-Authenticate")).toBe('Bearer realm="atlas"');
    },
  );

  it("does not accept tokens from query parameters or cookies", async () => {
    const accessToken = token();
    const response = await createApp(authenticator()).request(
      `/api/notes?access_token=${accessToken}`,
      {
        headers: { Cookie: `session=${accessToken}` },
      },
    );
    expect(response.status).toBe(401);
    expect(response.headers.get("WWW-Authenticate")).toBe('Bearer realm="atlas"');
  });

  it.each([
    ["expired", { exp: 1 }, false],
    ["wrong issuer", { iss: "https://other.example.test/" }, false],
    ["agent token", { sub_profile: "agent" }, false],
    ["missing session", { sid: undefined }, false],
    ["empty subject", { sub: "" }, false],
    ["forged signature", {}, true],
  ] as const)("rejects a %s token", async (_name, claims, forged) => {
    const response = await createApp(authenticator()).request("/api/notes", {
      headers: {
        Authorization: `Bearer ${token(claims, forged ? otherKey.privateKey : key.privateKey)}`,
      },
    });
    expect(response.status).toBe(401);
    expect(response.headers.get("WWW-Authenticate")).toBe('Bearer realm="atlas"');
  });

  it("reports a JWKS outage as a server error without disclosing credentials", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    onTestFinished(() => log.mockRestore());
    const accessToken = token();
    const response = await createApp(authenticator("client_unavailable")).request("/api/notes", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    expect(response.status).toBe(500);
    expect(response.headers.get("WWW-Authenticate")).toBeNull();
    const observable = `${await response.text()} ${JSON.stringify(log.mock.calls)}`;
    expect(observable).not.toContain(accessToken);
    expect(observable).not.toContain("SYNTHETIC_PROVIDER_FAILURE");
  });
});
import { spawn } from "node:child_process";
