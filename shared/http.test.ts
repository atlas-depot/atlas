import { expect, it } from "vite-plus/test";
import { ifMatchSchema } from "./http.ts";

it("accepts a single opaque strong tag", () => {
  expect(ifMatchSchema.parse('"note-version-3"')).toBe('"note-version-3"');
});

it.each([undefined, "*", 'W/"v3"', "v3", '"v3", "v4"', '"v3\r\nx: y"'])(
  "rejects missing or unsupported precondition %s",
  (value) => {
    expect(ifMatchSchema.safeParse(value).success).toBe(false);
  },
);
