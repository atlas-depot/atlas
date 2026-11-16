import { afterEach, expect, it, vi } from "vite-plus/test";
import hosted from "../api/index.ts";
import { apiErrorSchema } from "../shared/http.ts";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

it("requires the full hosted configuration and uses real browser auth on the API origin", async () => {
  const origin = "https://atlas-staging.example";
  const request = (path: string) => hosted.fetch(new Request(origin + path));
  // Prove an unset browser credential cannot start a partially configured deployment.
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  vi.stubEnv("WORKOS_COOKIE_PASSWORD", "");
  const unavailable = await request("/api/notes");
  expect(unavailable.status).toBe(503);
  expect(log.mock.calls).toEqual([["atlas_api_startup_failed: configuration"]]);
  expect(apiErrorSchema.parse(await unavailable.json()).error.code).toBe("SERVICE_UNAVAILABLE");

  for (const [key, value] of Object.entries({
    APP_ORIGIN: origin,
    WORKOS_CLIENT_ID: "client_stagingfixture",
    WORKOS_ISSUER: "https://api.workos.com/user_management/",
    WORKOS_API_KEY: "sk_test_staging_fixture",
    WORKOS_COOKIE_PASSWORD: "synthetic-cookie-fixture-for-hosted-entry",
    DATABASE_URL: "postgresql://local@127.0.0.1:1/unused",
    ORGANIZER_RUNTIME_URL: "https://private-agent.example",
    ORGANIZER_SERVICE_TOKEN: "synthetic-service-token-for-hosted-entry",
  }))
    vi.stubEnv(key, value);

  expect((await request("/api/health")).status).toBe(200);
  expect((await request("/api/notes")).status).toBe(401);
  const login = await request("/api/auth/login");
  expect(login.status).toBe(302);
  const target = new URL(login.headers.get("Location")!);
  expect(target.hostname).toBe("api.workos.com");
  expect(target.searchParams.get("redirect_uri")).toBe(origin + "/api/auth/callback");
  expect(login.headers.get("Set-Cookie")).toContain("HttpOnly");
});
