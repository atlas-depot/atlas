import { expect, it } from "vite-plus/test";
import { readDatabaseUrl, readDevelopmentDatabaseUrl, readTestDatabaseUrl } from "./connection.ts";

it("accepts PostgreSQL URLs without dropping TLS parameters", () => {
  const url = "postgresql://fixture:synthetic@db.example.test/atlas?sslmode=verify-full";
  expect(readDatabaseUrl({ DATABASE_URL: url })).toBe(url);
  expect(readDatabaseUrl({ DATABASE_URL: "postgres://localhost/atlas" })).toBe(
    "postgres://localhost/atlas",
  );
});

it.each([
  undefined,
  "",
  "SYNTHETIC_SECRET",
  "https://fixture:secret@example.test/db",
  "postgresql://",
  "postgresql:foo",
  "postgresql://localhost",
  "postgresql://localhost/",
  "postgresql://localhost/atlas?dbname=",
  "postgresql://localhost/atlas?database=other",
])("rejects missing or non-PostgreSQL configuration without disclosing values", (value) => {
  expect(() => readDatabaseUrl({ DATABASE_URL: value })).toThrow(
    /^Set DATABASE_URL to a valid PostgreSQL connection URL\.$/,
  );
});

it("requires DEV_DATABASE_URL without falling back to a valid DATABASE_URL", () => {
  const normal = "postgresql://localhost/normal";
  const development = "postgresql://localhost/development";
  expect(() => readDevelopmentDatabaseUrl({ DATABASE_URL: normal })).toThrow();
  expect(() =>
    readDevelopmentDatabaseUrl({ DEV_DATABASE_URL: "", DATABASE_URL: normal }),
  ).toThrow();
  expect(readDevelopmentDatabaseUrl({ DEV_DATABASE_URL: development, DATABASE_URL: normal })).toBe(
    development,
  );
});

it.each(["localhost", "127.0.0.1", "[::1]"])(
  "accepts explicit local test databases on %s",
  (host) => {
    const url = `postgresql://fixture@${host}:55468/postgres`;
    expect(readTestDatabaseUrl({ TEST_DATABASE_URL: url })).toBe(url);
  },
);

it.each([
  "postgresql://evil.example.com/atlas",
  "postgresql://127.0.0.1/atlas?host=evil.example.com",
  "postgresql://127.0.0.1/atlas?hostaddr=192.0.2.1",
  "postgresql://127.0.0.1/atlas?%68ost=evil.example.com",
  "postgresql://127.0.0.1/atlas?host=localhost&host=evil.example.com",
  "postgresql://127.0.0.1/atlas?port=9999",
  "postgresql://127.0.0.1/atlas?dbname=other",
])("rejects remote or overridden test connection targets", (url) => {
  expect(() => readTestDatabaseUrl({ TEST_DATABASE_URL: url })).toThrow();
});
