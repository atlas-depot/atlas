import { openDatabase, readDatabaseUrl } from "./connection.ts";
import { applyMigrations } from "./migrations.ts";

async function main() {
  const connection = openDatabase(readDatabaseUrl(process.env));
  try {
    await applyMigrations(connection.db);
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
