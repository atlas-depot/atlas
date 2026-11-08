import { describe, expect, it } from "vite-plus/test";
import {
  PASSAGE_PROJECTION_VERSION,
  notePassageProjectionSchema,
  notePassageSchema,
  notePassageSourceSchema,
  type NotePassage,
  type PassageIssue,
} from "./passages.ts";

const noteId = "d777e778-3a1f-4d64-a924-194320ad023a";
const version = `"${noteId}:3"`;
const blockSource = {
  kind: "block" as const,
  noteId,
  version,
  blockId: "block-1",
  headingPath: ["Heading"],
};
const markdownSource = {
  kind: "markdown" as const,
  noteId,
  version,
  headingPath: ["Heading"],
  startOffset: 0,
  endOffset: 7,
};
const passage: NotePassage = { text: "Heading", source: blockSource };
const issue: PassageIssue = {
  code: "unsupported_node",
  nodeType: "image",
  startOffset: 0,
  endOffset: 7,
};

describe("note passage contract", () => {
  it("accepts block and Markdown source references", () => {
    expect(notePassageSourceSchema.parse(blockSource)).toEqual(blockSource);
    expect(notePassageSourceSchema.parse(markdownSource)).toEqual(markdownSource);
    expect(notePassageSourceSchema.parse({ ...blockSource, part: 0 })).toEqual({
      ...blockSource,
      part: 0,
    });
    expect(PASSAGE_PROJECTION_VERSION).toBe(1);
  });

  it("keeps the source kinds strict and distinct", () => {
    expect(
      notePassageSourceSchema.safeParse({ ...markdownSource, blockId: "block-1" }).success,
    ).toBe(false);
    expect(
      notePassageSourceSchema.safeParse({ ...blockSource, startOffset: 0, endOffset: 7 }).success,
    ).toBe(false);
    expect(notePassageSourceSchema.safeParse({ ...blockSource, kind: "note" }).success).toBe(false);
    expect(notePassageSourceSchema.safeParse({ ...markdownSource, part: -1 }).success).toBe(false);
  });

  it("rejects invalid note, version, heading path and offset values", () => {
    expect(notePassageSourceSchema.safeParse({ ...blockSource, noteId: "note-1" }).success).toBe(
      false,
    );
    expect(notePassageSourceSchema.safeParse({ ...blockSource, version: "" }).success).toBe(false);
    expect(
      notePassageSourceSchema.safeParse({
        ...blockSource,
        headingPath: ["1", "2", "3", "4", "5", "6", "7"],
      }).success,
    ).toBe(false);
    expect(
      notePassageSourceSchema.safeParse({
        ...markdownSource,
        startOffset: 7,
        endOffset: 7,
      }).success,
    ).toBe(false);
    expect(
      notePassageSourceSchema.safeParse({
        ...markdownSource,
        startOffset: 8,
        endOffset: 7,
      }).success,
    ).toBe(false);
  });

  it("rejects empty text and unknown passage fields", () => {
    expect(notePassageSchema.safeParse({ ...passage, text: "" }).success).toBe(false);
    expect(notePassageSchema.safeParse({ ...passage, extra: true }).success).toBe(false);
  });

  it("accepts each valid projection status", () => {
    expect(notePassageProjectionSchema.parse({ status: "complete", passages: [passage] })).toEqual({
      status: "complete",
      passages: [passage],
    });
    expect(
      notePassageProjectionSchema.parse({
        status: "partial",
        passages: [passage],
        issues: [issue],
      }),
    ).toEqual({ status: "partial", passages: [passage], issues: [issue] });
    expect(notePassageProjectionSchema.parse({ status: "empty", passages: [] })).toEqual({
      status: "empty",
      passages: [],
    });
    expect(
      notePassageProjectionSchema.parse({ status: "unsupported", passages: [], issues: [issue] }),
    ).toEqual({ status: "unsupported", passages: [], issues: [issue] });
    expect(
      notePassageProjectionSchema.parse({
        status: "malformed",
        passages: [],
        issues: [{ code: "malformed_content", reason: "content_schema" }],
      }),
    ).toEqual({
      status: "malformed",
      passages: [],
      issues: [{ code: "malformed_content", reason: "content_schema" }],
    });
  });

  it("rejects incomplete status combinations", () => {
    expect(
      notePassageProjectionSchema.safeParse({ status: "complete", passages: [] }).success,
    ).toBe(false);
    expect(
      notePassageProjectionSchema.safeParse({ status: "partial", passages: [passage] }).success,
    ).toBe(false);
    expect(
      notePassageProjectionSchema.safeParse({ status: "empty", passages: [passage] }).success,
    ).toBe(false);
    expect(
      notePassageProjectionSchema.safeParse({ status: "unsupported", passages: [] }).success,
    ).toBe(false);
    expect(
      notePassageProjectionSchema.safeParse({ status: "malformed", passages: [] }).success,
    ).toBe(false);
    expect(notePassageProjectionSchema.safeParse({ status: "unknown", passages: [] }).success).toBe(
      false,
    );
  });

  it("keeps every issue kind strict and supported", () => {
    const issues: PassageIssue[] = [
      issue,
      { code: "unsupported_block_type", blockType: "image", blockId: "block-1" },
      { code: "unsupported_format", format: "markdown" },
      { code: "unsupported_schema_version", schemaVersion: 2 },
      { code: "malformed_content", reason: "invalid_source" },
      { code: "malformed_content", reason: "markdown_parse" },
      { code: "malformed_content", reason: "nesting_limit" },
      { code: "passage_limit" },
      { code: "issue_limit" },
    ];
    for (const value of issues) {
      expect(
        notePassageProjectionSchema.safeParse({
          status: "partial",
          passages: [passage],
          issues: [value],
        }).success,
      ).toBe(true);
    }
    expect(
      notePassageProjectionSchema.safeParse({
        status: "partial",
        passages: [passage],
        issues: [{ code: "unsupported_node", nodeType: "image" }],
      }).success,
    ).toBe(false);
    expect(
      notePassageProjectionSchema.safeParse({
        status: "partial",
        passages: [passage],
        issues: [{ code: "unsupported_block_type", blockType: "image", extra: true }],
      }).success,
    ).toBe(false);
    for (const [startOffset, endOffset] of [
      [7, 7],
      [8, 7],
    ]) {
      expect(
        notePassageProjectionSchema.safeParse({
          status: "partial",
          passages: [passage],
          issues: [{ code: "unsupported_node", nodeType: "image", startOffset, endOffset }],
        }).success,
      ).toBe(false);
    }
    for (const issue of [
      { code: "unsupported_node" as const, nodeType: "\0", startOffset: 0, endOffset: 7 },
      { code: "unsupported_block_type" as const, blockType: "\0" },
      { code: "unsupported_format" as const, format: "\0" },
    ]) {
      expect(
        notePassageProjectionSchema.safeParse({
          status: "partial",
          passages: [passage],
          issues: [issue],
        }).success,
      ).toBe(false);
    }
    expect(
      notePassageProjectionSchema.safeParse({
        status: "unsupported",
        passages: [],
        issues: [{ code: "unsupported_schema_version", schemaVersion: 1e20 }],
      }).success,
    ).toBe(false);
  });

  it("bounds validated projections to the passage limit", () => {
    expect(
      notePassageProjectionSchema.safeParse({
        status: "complete",
        passages: Array.from({ length: 1_000 }, () => passage),
      }).success,
    ).toBe(true);
    expect(
      notePassageProjectionSchema.safeParse({
        status: "complete",
        passages: Array.from({ length: 1_001 }, () => passage),
      }).success,
    ).toBe(false);
  });
});
