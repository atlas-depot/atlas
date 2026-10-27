import { describe, expect, it } from "vite-plus/test";
import {
  apiErrorSchema,
  createNoteSchema,
  noteSchema,
  noteWriteHeadersSchema,
  updateNoteSchema,
} from "./notes.ts";

const input = {
  title: "",
  content: "# Review\n\n  Keep this indentation.  \n\n```ts\nconst total = 42;\n```\n",
  createdAt: "2026-10-28T18:30:00.000Z",
};

describe("notes wire contract", () => {
  it("preserves client creation time and Markdown exactly, including empty titles", () => {
    expect(createNoteSchema.parse(input)).toEqual(input);
    expect(createNoteSchema.parse({ ...input, content: "" }).content).toBe("");
  });

  it.each(["ownerId", "userId", "id", "revision", "updatedAt", "authoredAt", "markdown"])(
    "rejects client-assigned %s rather than silently stripping it",
    (field) => {
      expect(createNoteSchema.safeParse({ ...input, [field]: "forged" }).success).toBe(false);
    },
  );

  it("requires a full content replacement and does not allow creation time to change", () => {
    expect(updateNoteSchema.parse({ title: "Review", content: input.content })).toEqual({
      title: "Review",
      content: input.content,
    });
    expect(updateNoteSchema.safeParse({ title: "Review" }).success).toBe(false);
    expect(updateNoteSchema.safeParse(input).success).toBe(false);
  });

  it.each(["28/10/2026 21:30", "2026-10-28T21:30:00+03:00", "2026-02-30T18:30:00Z"])(
    "rejects noncanonical or invalid creation time %s",
    (createdAt) => {
      expect(createNoteSchema.safeParse({ ...input, createdAt }).success).toBe(false);
    },
  );

  it("bounds payloads and checks the five-field response", () => {
    const note = {
      ...input,
      id: "d777e778-3a1f-4d64-a924-194320ad023a",
      updatedAt: input.createdAt,
    };
    expect(noteSchema.parse(note)).toEqual(note);
    expect(noteSchema.safeParse({ ...note, id: "note-1" }).success).toBe(false);
    expect(noteSchema.safeParse({ ...note, revision: 1 }).success).toBe(false);
    expect(createNoteSchema.safeParse({ ...input, title: "x".repeat(257) }).success).toBe(false);
    expect(createNoteSchema.safeParse({ ...input, content: "x".repeat(100_001) }).success).toBe(
      false,
    );
  });

  it("carries the opaque write precondition outside the note JSON", () => {
    expect(noteWriteHeadersSchema.parse({ "if-match": '"note-version-3"' })).toEqual({
      "if-match": '"note-version-3"',
    });
  });

  it.each([undefined, "*", 'W/"v3"', "v3", '"v3", "v4"', '"v3\r\nx: y"'])(
    "rejects missing or unsupported precondition %s",
    (value) => {
      expect(noteWriteHeadersSchema.safeParse({ "if-match": value }).success).toBe(false);
    },
  );

  it("rejects accidental debug data in the public error envelope", () => {
    expect(
      apiErrorSchema.safeParse({
        error: { code: "INTERNAL_ERROR", message: "Request failed.", stack: "secret" },
      }).success,
    ).toBe(false);
  });
});
