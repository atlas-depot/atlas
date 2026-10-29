import { expect, it } from "vite-plus/test";
import { readServerEnv } from "./env.ts";

it("starts without unused provider credentials", () => {
  expect(readServerEnv({})).toEqual({ port: 3001 });
  expect(readServerEnv({ API_PORT: "0" })).toEqual({ port: 0 });
  expect(readServerEnv({ API_PORT: "4317", DATABASE_URL: "unused" })).toEqual({ port: 4317 });
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
