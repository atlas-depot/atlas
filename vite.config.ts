import react from "@vitejs/plugin-react";
import { defineConfig, lazyPlugins } from "vite-plus";
import { readServerEnv } from "./server/env.ts";

// https://vite.dev/config/
export default defineConfig({
  fmt: {
    ignorePatterns: ["docs/**", ".agents/**", ".claude/**", "commitlint.config.cjs"],
  },
  lint: {
    plugins: ["react", "typescript", "oxc"],
    rules: {
      "typescript/no-explicit-any": "error",
      "react/rules-of-hooks": "error",
      "react/only-export-components": [
        "warn",
        {
          allowConstantExport: true,
        },
      ],
      "vite-plus/prefer-vite-plus-imports": "error",
    },
    options: {
      typeAware: true,
      typeCheck: true,
    },
    jsPlugins: [
      {
        name: "vite-plus",
        specifier: "vite-plus/oxlint-plugin",
      },
    ],
  },
  plugins: lazyPlugins(() => [react()]),
  server: {
    proxy: {
      "^/api(?:/|$)": {
        target: `http://127.0.0.1:${readServerEnv(process.env).port}`,
      },
    },
  },
  test: {
    environment: "node",
    include: [
      "src/**/*.test.ts",
      "scripts/**/*.test.ts",
      "server/**/*.test.ts",
      "shared/**/*.test.ts",
    ],
    coverage: {
      provider: "v8",
      include: ["src/**/*.{ts,tsx}", "scripts/**/*.ts", "server/**/*.ts", "shared/**/*.ts"],
      exclude: [
        "**/*.test.*",
        "**/*.spec.*",
        "**/*.config.*",
        "**/*.d.ts",
        "e2e/**",
        "experiments/**",
        "dist/**",
        "coverage/**",
      ],
      reporter: [
        ["text", { maxCols: 120, skipFull: false }],
        ["text-summary", { file: "summary.txt" }],
      ],
      reportsDirectory: "coverage",
    },
    passWithNoTests: false,
  },
});
