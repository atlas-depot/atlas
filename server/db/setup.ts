import { openDatabase, readDevelopmentDatabaseUrl } from "./connection.ts";
import { applyMigrations } from "./migrations.ts";
import { seedNotes } from "./seed.ts";

async function main() {
  const action = process.argv[2];
  if (!["seed", "init"].includes(action ?? "")) {
    throw new Error("Development database setup is unavailable.");
  }
  const url = readDevelopmentDatabaseUrl(process.env);
  const connection = openDatabase(url);
  try {
    if (action === "init") await applyMigrations(connection.db);
    const inserted = await seedNotes(connection.db);
    console.log(`Development database ready: ${inserted} synthetic notes inserted.`);
  } finally {
    await connection.close();
  }
}

try {
  await main();
} catch {
  console.error(
    "Development database setup failed. Set NODE_ENV=development and check DATABASE_URL and database availability.",
  );
  process.exitCode = 1;
}
