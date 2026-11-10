import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { expect, it, vi } from "vite-plus/test";
import { createApp } from "../app.ts";
import { setupIndexTestDatabase } from "./index-test-database.ts";
import { createSearchAdmission } from "./note-search-admission.ts";
import { noteSearchAdmissions } from "./schema.ts";

const database = setupIndexTestDatabase();

it("admits only twenty concurrent requests across independent pools and isolates owners", async () => {
  const owner = randomUUID();
  const first = createSearchAdmission(database.db);
  const second = createSearchAdmission(database.other);
  const results = await Promise.all(
    Array.from({ length: 30 }, (_, index) => (index % 2 ? first(owner) : second(owner))),
  );
  expect(results.filter((result) => result.allowed)).toHaveLength(20);
  expect(results.filter((result) => !result.allowed)).toHaveLength(10);
  expect(await first(randomUUID())).toEqual({ allowed: true });
  const [row] = await database.db
    .select()
    .from(noteSearchAdmissions)
    .where(eq(noteSearchAdmissions.ownerId, owner));
  expect(row.admittedAt).toHaveLength(20);
  for (const result of results) {
    if (!result.allowed) expect(result.retryAfterSeconds).toBeGreaterThan(0);
  }
});

it("expires individual admissions rather than resetting a minute bucket", async () => {
  const owner = randomUUID();
  await database.db.execute(sql`
    INSERT INTO ${noteSearchAdmissions} (owner_id, admitted_at, expires_at)
    VALUES (${owner},
      array_fill(clock_timestamp() - interval '30 seconds', ARRAY[19]) ||
      ARRAY[clock_timestamp() - interval '61 seconds'],
      clock_timestamp() + interval '30 seconds')
  `);
  const admit = createSearchAdmission(database.db);
  expect(await admit(owner)).toEqual({ allowed: true });
  const rejected = await admit(owner);
  expect(rejected.allowed).toBe(false);
  if (rejected.allowed) throw new Error("Expected rolling window rejection");
  expect(rejected.retryAfterSeconds).toBeGreaterThan(0);
  expect(rejected.retryAfterSeconds).toBeLessThanOrEqual(30);
});

it("keeps failed embedding calls consumed when the HTTP request is retried on another process", async () => {
  const owner = randomUUID();
  const embedSearch = vi.fn().mockRejectedValue(new Error("synthetic provider failure"));
  const candidates = vi.fn();
  const applications = [database.db, database.other].map((db) =>
    createApp(async () => ({ userId: owner }), {
      admitSearch: createSearchAdmission(db),
      embedSearch,
      search: { candidates },
    }),
  );
  for (let index = 0; index < 21; index++) {
    const response = await applications[index % 2].request("/api/note-search", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: "Where is the meeting?" }),
    });
    expect(response.status).toBe(index < 20 ? 503 : 429);
  }
  expect(embedSearch).toHaveBeenCalledTimes(20);
  expect(candidates).not.toHaveBeenCalled();
});

it("bounds expired-owner cleanup and retains current admission history", async () => {
  const prefix = randomUUID();
  await database.db.execute(sql`
    INSERT INTO ${noteSearchAdmissions} (owner_id, admitted_at, expires_at)
    SELECT ${prefix} || '-' || value::text, ARRAY[clock_timestamp() - interval '2 minutes'],
      clock_timestamp() - interval '1 minute' FROM generate_series(1, 105) AS value
  `);
  const owner = randomUUID();
  await createSearchAdmission(database.db)(owner);
  const remaining = await database.db.execute<{ count: string }>(sql`
    SELECT count(*)::text AS count FROM ${noteSearchAdmissions}
    WHERE owner_id LIKE ${prefix + "%"}
  `);
  expect(Number(remaining.rows[0].count)).toBe(5);
  expect(
    await database.db
      .select()
      .from(noteSearchAdmissions)
      .where(eq(noteSearchAdmissions.ownerId, owner)),
  ).toHaveLength(1);
});

it("rolls back admission when persistence fails instead of reporting an accepted request", async () => {
  const owner = randomUUID();
  await database.db.execute(sql`
    CREATE FUNCTION fail_search_admission() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'synthetic admission failure'; END; $$
  `);
  await database.db.execute(sql`
    CREATE TRIGGER fail_search_admission BEFORE UPDATE ON ${noteSearchAdmissions}
    FOR EACH ROW EXECUTE FUNCTION fail_search_admission()
  `);
  try {
    await expect(createSearchAdmission(database.db)(owner)).rejects.toThrow();
    expect(
      await database.db
        .select()
        .from(noteSearchAdmissions)
        .where(eq(noteSearchAdmissions.ownerId, owner)),
    ).toEqual([]);
  } finally {
    await database.db.execute(sql`DROP TRIGGER fail_search_admission ON ${noteSearchAdmissions}`);
    await database.db.execute(sql`DROP FUNCTION fail_search_admission()`);
  }
});
