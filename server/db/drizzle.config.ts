import { defineConfig } from "drizzle-kit";

// Generation compares versioned schemas and does not need database credentials.
export default defineConfig({
  dialect: "postgresql",
  schema: "./server/db/schema.ts",
  out: "./drizzle",
});
