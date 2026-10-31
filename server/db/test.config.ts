import { defineConfig } from "vite-plus";

export default defineConfig({
  test: {
    environment: "node",
    include: ["server/db/**/*.integration.ts"],
    passWithNoTests: false,
    testTimeout: 90_000,
    hookTimeout: 30_000,
  },
});
