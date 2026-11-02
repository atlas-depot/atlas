import { expect, it } from "vite-plus/test";
import { readServerEnv } from "./env.ts";

it("starts without unused provider credentials", () => {
  expect(readServerEnv({})).toEqual({ port: 3001 });
  expect(readServerEnv({ API_PORT: "0" })).toEqual({ port: 0 });
  expect(readServerEnv({ API_PORT: "4317" })).toEqual({ port: 4317 });
});

it.each(["", " 3001", "1.5", "-1", "65536", "SYNTHETIC_SECRET", "Infinity"])(
  "rejects invalid port %s without echoing its value",
  (port) => {
    expect(() => readServerEnv({ API_PORT: port })).toThrow(
      /^Invalid API_PORT: expected an integer from 0 to 65535\.$/,
    );
  },
);

it("requires both WorkOS settings and preserves the exact configured issuer", () => {
  expect(
    readServerEnv({
      WORKOS_CLIENT_ID: "client_atlasTest",
      WORKOS_ISSUER: "https://api.workos.com/",
    }),
  ).toEqual({
    port: 3001,
    workos: { clientId: "client_atlasTest", issuer: "https://api.workos.com/" },
  });
  for (const settings of [
    { WORKOS_CLIENT_ID: "client_atlasTest" },
    { WORKOS_ISSUER: "https://api.workos.com/" },
    { WORKOS_CLIENT_ID: "SYNTHETIC_SECRET", WORKOS_ISSUER: "https://api.workos.com/" },
    { WORKOS_CLIENT_ID: "client_atlasTest", WORKOS_ISSUER: "http://issuer.test" },
  ]) {
    expect(() => readServerEnv(settings)).toThrow(
      /^Set both WORKOS_CLIENT_ID and WORKOS_ISSUER to valid WorkOS environment values\.$/,
    );
  }
});

const browserSettings = {
  APP_ORIGIN: "https://app.example.test",
  WORKOS_API_KEY: "sk_test_fixture",
  WORKOS_CLIENT_ID: "client_atlasTest",
  WORKOS_COOKIE_PASSWORD: "c".repeat(32),
  WORKOS_ISSUER: "https://api.workos.com/",
};

const organizerSettings = {
  DATABASE_URL: "postgresql://synthetic:password@localhost/atlas_test",
  ORGANIZER_RUNTIME_URL: "https://organizer.example.test",
  ORGANIZER_SERVICE_TOKEN: "synthetic-service-token-for-test-only",
};

it("configures note persistence independently of organizer", () => {
  expect(readServerEnv({ DATABASE_URL: organizerSettings.DATABASE_URL })).toEqual({
    port: 3001,
    databaseUrl: organizerSettings.DATABASE_URL,
  });
  expect(() => readServerEnv({ DATABASE_URL: "SYNTHETIC_INVALID_DATABASE" })).toThrow(
    /^Set DATABASE_URL to a valid PostgreSQL connection URL\.$/,
  );
});

it("maps a complete organizer configuration alongside browser authentication", () => {
  expect(
    readServerEnv({
      ...browserSettings,
      ...organizerSettings,
      ORGANIZER_DEPLOYMENT_PROTECTION_SECRET: "synthetic-bypass",
      ORGANIZER_RESULT_RETENTION_MS: "1800000",
    }),
  ).toEqual({
    port: 3001,
    workos: { clientId: "client_atlasTest", issuer: "https://api.workos.com/" },
    browserAuth: {
      appOrigin: "https://app.example.test",
      apiKey: "sk_test_fixture",
      cookiePassword: "c".repeat(32),
    },
    databaseUrl: organizerSettings.DATABASE_URL,
    organizer: {
      connectionString: organizerSettings.DATABASE_URL,
      runtimeUrl: organizerSettings.ORGANIZER_RUNTIME_URL,
      serviceToken: organizerSettings.ORGANIZER_SERVICE_TOKEN,
      deploymentProtectionSecret: "synthetic-bypass",
      resultRetentionMs: 1800000,
    },
  });
});

it("defaults only the draft delivery lifetime, keeping metadata retention separate", () => {
  expect(readServerEnv(organizerSettings)).toEqual({
    port: 3001,
    databaseUrl: organizerSettings.DATABASE_URL,
    organizer: {
      connectionString: organizerSettings.DATABASE_URL,
      runtimeUrl: organizerSettings.ORGANIZER_RUNTIME_URL,
      serviceToken: organizerSettings.ORGANIZER_SERVICE_TOKEN,
      deploymentProtectionSecret: undefined,
      resultRetentionMs: 900000,
    },
  });
});

it.each(["http://localhost:3100", "http://127.0.0.1:3100", "http://[::1]:3100"])(
  "permits loopback organizer development at %s",
  (runtimeUrl) => {
    expect(
      readServerEnv({ ...organizerSettings, ORGANIZER_RUNTIME_URL: runtimeUrl }),
    ).toMatchObject({
      organizer: { runtimeUrl },
    });
  },
);

it("rejects incomplete organizer settings without echoing values", () => {
  for (const settings of [
    { ORGANIZER_RUNTIME_URL: organizerSettings.ORGANIZER_RUNTIME_URL },
    { ORGANIZER_SERVICE_TOKEN: "SYNTHETIC_SECRET" },
    { ORGANIZER_RESULT_RETENTION_MS: "900000" },
    { ORGANIZER_DEPLOYMENT_PROTECTION_SECRET: "SYNTHETIC_SECRET" },
    { ...organizerSettings, ORGANIZER_RUNTIME_URL: undefined },
    { ...organizerSettings, ORGANIZER_SERVICE_TOKEN: undefined },
  ]) {
    expect(() => readServerEnv(settings)).toThrow(
      /^Set valid organizer runtime, service and retention settings\.$/,
    );
  }
  for (const databaseUrl of [
    undefined,
    "SYNTHETIC_SECRET",
    "https://user:SYNTHETIC_SECRET@db.example/atlas",
    "postgresql://user:SYNTHETIC_SECRET@db.example/atlas?host=elsewhere",
  ]) {
    expect(() => readServerEnv({ ...organizerSettings, DATABASE_URL: databaseUrl })).toThrow(
      /^Set DATABASE_URL to a valid PostgreSQL connection URL\.$/,
    );
  }
});

it.each([
  "http://organizer.example.test",
  "http://localhost.attacker.test",
  "http://0.0.0.0:3000",
  "https://user:SYNTHETIC_SECRET@organizer.example.test",
  "https://organizer.example.test/path",
  "https://organizer.example.test?token=SYNTHETIC_SECRET",
  "https://organizer.example.test#SYNTHETIC_SECRET",
  "SYNTHETIC_SECRET",
])("rejects unsafe organizer endpoint %s without exposing it", (runtimeUrl) => {
  expect(() => readServerEnv({ ...organizerSettings, ORGANIZER_RUNTIME_URL: runtimeUrl })).toThrow(
    /^Set valid organizer runtime, service and retention settings\.$/,
  );
});

it("rejects invalid organizer tokens and retention without exposing values", () => {
  for (const overrides of [
    { ORGANIZER_SERVICE_TOKEN: "SYNTHETIC_SECRET" },
    { ORGANIZER_SERVICE_TOKEN: ` ${organizerSettings.ORGANIZER_SERVICE_TOKEN}` },
    { ORGANIZER_SERVICE_TOKEN: "s".repeat(513) },
    { ORGANIZER_DEPLOYMENT_PROTECTION_SECRET: "" },
    { ORGANIZER_DEPLOYMENT_PROTECTION_SECRET: "SYNTHETIC_SECRET\n" },
    ...["", "0", "-1", "1.5", " 1000", "Infinity", "2147483648", "SYNTHETIC_SECRET"].map(
      (value) => ({ ORGANIZER_RESULT_RETENTION_MS: value }),
    ),
  ]) {
    expect(() => readServerEnv({ ...organizerSettings, ...overrides })).toThrow(
      /^Set valid organizer runtime, service and retention settings\.$/,
    );
  }
});

it("accepts the complete browser sign-in configuration", () => {
  expect(readServerEnv(browserSettings)).toEqual({
    port: 3001,
    workos: { clientId: "client_atlasTest", issuer: "https://api.workos.com/" },
    browserAuth: {
      appOrigin: "https://app.example.test",
      apiKey: "sk_test_fixture",
      cookiePassword: "c".repeat(32),
    },
  });
  expect(readServerEnv({ ...browserSettings, APP_ORIGIN: "http://localhost:5173" })).toMatchObject({
    browserAuth: { appOrigin: "http://localhost:5173" },
  });
});

it.each([
  "https://app.example.test",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://[::1]:5173",
])("accepts HTTPS or a local development origin: %s", (appOrigin) => {
  expect(readServerEnv({ ...browserSettings, APP_ORIGIN: appOrigin })).toMatchObject({
    browserAuth: { appOrigin },
  });
});

it.each([
  "http://app.example.test",
  "http://192.168.1.10:5173",
  "http://0.0.0.0:5173",
  "http://localhost.example.test:5173",
  "http://127.0.0.1.example.test:5173",
  "http://[::]:5173",
])("rejects non-loopback HTTP browser origins: %s", (appOrigin) => {
  expect(() => readServerEnv({ ...browserSettings, APP_ORIGIN: appOrigin })).toThrow(
    /^Set APP_ORIGIN, WORKOS_API_KEY, WORKOS_CLIENT_ID, WORKOS_COOKIE_PASSWORD and WORKOS_ISSUER to valid WorkOS browser sign-in values\.$/,
  );
});

it("rejects incomplete or non-canonical browser sign-in settings without echoing values", () => {
  const settings = [
    { APP_ORIGIN: "https://app.example.test" },
    {
      ...browserSettings,
      WORKOS_COOKIE_PASSWORD: "SYNTHETIC_SECRET",
    },
    { ...browserSettings, WORKOS_API_KEY: " " },
    { ...browserSettings, APP_ORIGIN: "https://app.example.test/" },
    { ...browserSettings, APP_ORIGIN: "https://app.example.test/path" },
    { ...browserSettings, APP_ORIGIN: "https://user:pass@app.example.test" },
    {
      APP_ORIGIN: "https://app.example.test",
      WORKOS_API_KEY: "sk_test_fixture",
      WORKOS_CLIENT_ID: "client_atlasTest",
      WORKOS_COOKIE_PASSWORD: "c".repeat(32),
    },
  ];
  for (const value of settings) {
    expect(() => readServerEnv(value)).toThrow(
      /^Set APP_ORIGIN, WORKOS_API_KEY, WORKOS_CLIENT_ID, WORKOS_COOKIE_PASSWORD and WORKOS_ISSUER to valid WorkOS browser sign-in values\.$/,
    );
  }
  let message = "";
  try {
    readServerEnv({ ...browserSettings, WORKOS_COOKIE_PASSWORD: "SYNTHETIC_SECRET" });
  } catch (error) {
    message = String(error);
  }
  expect(message).toMatch(/^Error: Set APP_ORIGIN/);
  expect(message).not.toContain("SYNTHETIC_SECRET");
});
