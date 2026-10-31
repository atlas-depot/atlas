import { expect, it } from "vite-plus/test";
import { readDatabaseUrl } from "./connection.ts";

it("accepts PostgreSQL URLs without dropping TLS parameters", () => {
  const url = "postgresql://fixture:synthetic@db.example.test/atlas?sslmode=verify-full";
  expect(readDatabaseUrl({ DATABASE_URL: url })).toBe(url);
  expect(readDatabaseUrl({ DATABASE_URL: "postgres://localhost/atlas" })).toBe(
    "postgres://localhost/atlas",
  );
});

it.each([undefined, "", "SYNTHETIC_SECRET", "https://fixture:secret@example.test/db"])(
  "rejects missing or non-PostgreSQL configuration without disclosing values",
  (value) => {
    expect(() => readDatabaseUrl({ DATABASE_URL: value })).toThrow(
      /^Set DATABASE_URL to a valid PostgreSQL connection URL\.$/,
    );
  },
);
