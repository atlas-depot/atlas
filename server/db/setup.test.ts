import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { expect, it } from "vite-plus/test";

it.each([
  {
    action: "init",
    env: { DATABASE_URL: "postgresql://fixture:SYNTHETIC_SECRET@127.0.0.1:1/ignored" },
  },
  { action: "seed", env: { DEV_DATABASE_URL: "SYNTHETIC_SECRET" } },
  {
    action: "reset",
    env: { DEV_DATABASE_URL: "postgresql://fixture:SYNTHETIC_SECRET@127.0.0.1:1/ignored" },
  },
])(
  "fails closed with sanitized output for invalid development setup: $action",
  async ({ action, env }) => {
    const result = await promisify(execFile)(process.execPath, ["server/db/setup.ts", action], {
      env: { PATH: process.env.PATH, ...env },
      timeout: 10_000,
    }).then(
      () => {
        throw new Error("Expected setup to fail");
      },
      (error: unknown) => error,
    );
    expect(result).toMatchObject({
      code: 1,
      stdout: "",
      stderr:
        "Development database setup failed. Check DEV_DATABASE_URL and database availability.\n",
    });
  },
);
