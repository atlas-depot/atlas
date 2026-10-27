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
      "Invalid API_PORT: expected an integer from 0 to 65535.",
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
      "Set both WORKOS_CLIENT_ID and WORKOS_ISSUER to valid WorkOS environment values.",
    );
  }
});
