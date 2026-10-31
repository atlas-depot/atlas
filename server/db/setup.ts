import { openDatabase, readDatabaseUrl } from "./connection.ts";
import { applyMigrations } from "./migrations.ts";
import { seedNotes } from "./seed.ts";

async function main() {
  const action = process.argv[2];
  if (!["seed", "init"].includes(action ?? "") || process.env.NODE_ENV === "production") {
    throw new Error("Development database setup is unavailable.");
  }
  const url = readDatabaseUrl(process.env);
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
  console.error("Development database setup failed. Check DATABASE_URL and database availability.");
  process.exitCode = 1;
}
