import { defineConfig, devices } from "@playwright/test";
import { readTestDatabaseUrl } from "./server/db/connection.ts";

// This explicit command requires real isolated storage. Missing configuration is an error.
readTestDatabaseUrl(process.env);

export default defineConfig({
  testDir: "e2e",
  testMatch: ["**/notes-api.spec.ts", "**/notes-organize-api.spec.ts"],
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: process.env.CI ? "github" : "list",
  outputDir: "test-results/api",
  use: {
    ...devices["Desktop Chrome"],
    baseURL: "http://127.0.0.1:4185",
    channel: process.env.PLAYWRIGHT_CHANNEL,
    trace: "retain-on-failure",
  },
  globalSetup: "./e2e/api-server.ts",
});
