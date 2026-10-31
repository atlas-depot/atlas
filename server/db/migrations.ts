import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import type { openDatabase } from "./connection.ts";

export async function applyMigrations(db: ReturnType<typeof openDatabase>["db"]) {
  await migrate(db, {
    migrationsFolder: fileURLToPath(new URL("../../drizzle/", import.meta.url)),
  });
}
