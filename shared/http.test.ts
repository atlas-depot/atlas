import { expect, it } from "vite-plus/test";
import { ifMatchSchema } from "./http.ts";

it("accepts a single opaque strong tag", () => {
  expect(ifMatchSchema.parse('"note-version-3"')).toBe('"note-version-3"');
});

it("limits the complete tag to 512 characters, including its quotes", () => {
  expect(ifMatchSchema.safeParse(`"${"x".repeat(510)}"`).success).toBe(true);
  expect(ifMatchSchema.safeParse(`"${"x".repeat(511)}"`).success).toBe(false);
});

it.each([undefined, "*", 'W/"v3"', "v3", '"v3", "v4"', '"v3\r\nx: y"'])(
  "rejects missing or unsupported precondition %s",
  (value) => {
    expect(ifMatchSchema.safeParse(value).success).toBe(false);
  },
);
