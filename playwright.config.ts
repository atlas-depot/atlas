import { defineConfig, devices } from "@playwright/test";

const host = "127.0.0.1";
const port = 4177;
const baseURL = `http://${host}:${port}`;

// Runs the built bundle, so the regression covers what ships rather than the dev server.
export default defineConfig({
  testDir: "e2e",
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL,
    channel: process.env.PLAYWRIGHT_CHANNEL,
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      testIgnore: "**/notes-production.spec.ts",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "production",
      testMatch: "**/notes-production.spec.ts",
      use: { ...devices["Desktop Chrome"], baseURL: "http://127.0.0.1:4178" },
    },
  ],
  webServer: [
    {
      command: `npm run build && npm run preview -- --host ${host} --port ${port} --strictPort`,
      url: baseURL,
      env: { VITE_NOTES_DEMO: "true" },
      // Never reuse a server: a leftover preview serves an older build, so the test
      // would pass against stale output. An occupied port must fail explicitly.
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command:
        "npm run build -- --outDir .cache/production-build && npm run preview -- --outDir .cache/production-build --host 127.0.0.1 --port 4178 --strictPort",
      url: "http://127.0.0.1:4178",
      env: { VITE_NOTES_DEMO: "false" },
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
