import { defineConfig, devices } from "@playwright/test";

// Local load measurement only. It creates and drops an isolated database and is not part of CI.
export default defineConfig({
  testDir: "scripts/perf",
  testMatch: "**/*.spec.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 30 * 60_000,
  reporter: "list",
  outputDir: "test-results/perf",
  use: {
    ...devices["Desktop Chrome"],
  },
});
