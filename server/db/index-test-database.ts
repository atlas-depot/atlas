import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll } from "vite-plus/test";
import { openDatabase, readTestDatabaseUrl } from "./connection.ts";
import { applyMigrations } from "./migrations.ts";

type Connection = ReturnType<typeof openDatabase>;

/** Each index suite owns an isolated real database and two independent connection pools. */
export function setupIndexTestDatabase(
  initialize: (connection: Connection) => Promise<void> = ({ db }) => applyMigrations(db),
) {
  const name = `atlas_index_test_${randomUUID().replaceAll("-", "")}`;
  let admin: Pool;
  let connection: Connection;
  let other: Connection;
  let url: string;
  let created = false;
  beforeAll(async () => {
    const target = new URL(readTestDatabaseUrl(process.env));
    admin = new Pool({ connectionString: target.href, connectionTimeoutMillis: 10_000 });
    await admin.query(`CREATE DATABASE "${name}"`);
    created = true;
    target.pathname = `/${name}`;
    url = target.href;
    connection = openDatabase(url);
    other = openDatabase(url);
    await initialize(connection);
  });
  afterAll(async () => {
    await connection?.close();
    await other?.close();
    if (admin) {
      try {
        if (created) await admin.query(`DROP DATABASE "${name}"`);
      } finally {
        await admin.end();
      }
    }
  });
  return {
    get db() {
      return connection.db;
    },
    get other() {
      return other.db;
    },
    get url() {
      return url;
    },
  };
}
