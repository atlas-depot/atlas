import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { z } from "zod";
import * as schema from "./schema.ts";

const databaseUrlSchema = z.url({ protocol: /^postgres(?:ql)?$/ });

export function readDatabaseUrl(environment: Record<string, string | undefined>) {
  const parsed = databaseUrlSchema.safeParse(environment.DATABASE_URL);
  if (!parsed.success) {
    throw new Error("Set DATABASE_URL to a valid PostgreSQL connection URL.");
  }
  return parsed.data;
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
