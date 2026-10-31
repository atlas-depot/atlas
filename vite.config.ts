import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";
import { defineConfig, lazyPlugins } from "vite-plus";
import { readServerEnv } from "./server/env.ts";

// https://vite.dev/config/
export default defineConfig(({ command, isPreview }) => {
  const isDevServer = command === "serve" && !isPreview && !process.env.VITEST;
  const apiPort = isDevServer ? readServerEnv({ API_PORT: process.env.API_PORT }).port : undefined;
  if (apiPort === 0) throw new Error("Use a nonzero API_PORT for the development proxy.");
  return {
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
    plugins: lazyPlugins(() => [react(), tailwindcss()]),
    resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
    server: {
      proxy: {
        ...(apiPort === undefined
          ? {}
          : {
              "^/api(?:[/?]|$)": { target: `http://127.0.0.1:${apiPort}` },
            }),
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
          "**/*.integration.*",
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
  };
});
