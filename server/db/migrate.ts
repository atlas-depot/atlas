import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { openDatabase, readDatabaseUrl } from "./connection.ts";

async function main() {
  const connection = openDatabase(readDatabaseUrl(process.env));
  try {
    await migrate(connection.db, {
      migrationsFolder: fileURLToPath(new URL("../../drizzle/", import.meta.url)),
    });
    console.log("Database migrations completed.");
  } finally {
    await connection.close();
  }
}

try {
  await main();
} catch {
  // Driver errors may contain connection details or submitted values.
  console.error("Database migration failed. Check configuration and database availability.");
  process.exitCode = 1;
}
