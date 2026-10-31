import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { z } from "zod";
import * as schema from "./schema.ts";

const databaseUrlSchema = z.url({ protocol: /^postgres(?:ql)?$/ }).refine((value) => {
  if (!URL.canParse(value)) return false;
  const url = new URL(value);
  // pg query parameters can override the authority/path used to select a target.
  return (
    url.hostname.length > 0 &&
    url.pathname.length > 1 &&
    !["host", "hostaddr", "port", "database", "dbname"].some((key) => url.searchParams.has(key))
  );
});

export function readDatabaseUrl(environment: Record<string, string | undefined>) {
  const parsed = databaseUrlSchema.safeParse(environment.DATABASE_URL);
  if (!parsed.success) {
    throw new Error("Set DATABASE_URL to a valid PostgreSQL connection URL.");
  }
  return parsed.data;
}

/** Only isolated loopback servers may be used by tests that create/drop databases. */
export function readTestDatabaseUrl(environment: Record<string, string | undefined>) {
  const value = readDatabaseUrl({ DATABASE_URL: environment.TEST_DATABASE_URL });
  if (!["localhost", "127.0.0.1", "[::1]"].includes(new URL(value).hostname)) {
    throw new Error("Database integration tests require an isolated local PostgreSQL server.");
  }
  return value;
}

/** The caller owns this pool and must close it when its work finishes. */
export function openDatabase(connectionString: string) {
  const pool = new Pool({
    connectionString,
    max: 5,
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 10_000,
  });
  // Idle connections can fail outside a pending query. Do not log driver details.
  pool.on("error", () => console.error("An idle database connection failed."));
  return { db: drizzle({ client: pool, schema }), close: () => pool.end() };
}
