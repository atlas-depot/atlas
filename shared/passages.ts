import { z } from "zod";
import { blockIdSchema, noteTextSchema } from "./document.ts";
import { noteIdSchema } from "./notes.ts";

/** Opaque note version. The API uses the note's strong ETag, so the internal revision stays private. */
export const notePassageVersionSchema = noteTextSchema.min(1).max(256);
const headingPathSchema = z.array(noteTextSchema).max(6);
const offsetSchema = z.number().int().min(0).max(100_000);
const partSchema = z.number().int().min(0);

const blockPassageSourceSchema = z.strictObject({
  kind: z.literal("block"),
  noteId: noteIdSchema,
  version: notePassageVersionSchema,
  blockId: blockIdSchema,
  headingPath: headingPathSchema,
  part: partSchema.optional(),
});

const markdownPassageSourceSchema = z.strictObject({
  kind: z.literal("markdown"),
  noteId: noteIdSchema,
  version: notePassageVersionSchema,
  headingPath: headingPathSchema,
  startOffset: offsetSchema,
  endOffset: offsetSchema,
  part: partSchema.optional(),
});

/**
 * A block reference identifies a top-level block and its subtree. A Markdown reference identifies
 * the source node by UTF-16 code-unit offsets. The offsets can include syntax that is absent from
 * the projected text.
 */
export const notePassageSourceSchema = z
  .discriminatedUnion("kind", [blockPassageSourceSchema, markdownPassageSourceSchema])
  .superRefine((source, ctx) => {
    if (source.kind === "markdown" && source.startOffset >= source.endOffset) {
      ctx.addIssue({
        code: "custom",
        message: "Markdown passage offsets must identify a non-empty source range.",
      });
    }
  });

export const notePassageSchema = z.strictObject({
  text: noteTextSchema.min(1).max(100_000),
  source: notePassageSourceSchema,
});

const unsupportedNodeIssueSchema = z.strictObject({
  code: z.literal("unsupported_node"),
  nodeType: z.string().min(1).max(64),
  startOffset: offsetSchema,
  endOffset: offsetSchema,
});
const unsupportedBlockTypeIssueSchema = z.strictObject({
  code: z.literal("unsupported_block_type"),
  blockType: z.string().min(1).max(128),
  blockId: blockIdSchema.optional(),
});
const unsupportedFormatIssueSchema = z.strictObject({
  code: z.literal("unsupported_format"),
  format: z.string().min(1).max(64),
});
const unsupportedSchemaVersionIssueSchema = z.strictObject({
  code: z.literal("unsupported_schema_version"),
  schemaVersion: z.number().int(),
});
const malformedContentIssueSchema = z.strictObject({
  code: z.literal("malformed_content"),
  reason: z.enum(["invalid_source", "content_schema", "markdown_parse", "nesting_limit"]),
});
const passageLimitIssueSchema = z.strictObject({ code: z.literal("passage_limit") });
const issueLimitIssueSchema = z.strictObject({ code: z.literal("issue_limit") });

export const passageIssueSchema = z
  .discriminatedUnion("code", [
    unsupportedNodeIssueSchema,
    unsupportedBlockTypeIssueSchema,
    unsupportedFormatIssueSchema,
    unsupportedSchemaVersionIssueSchema,
    malformedContentIssueSchema,
    passageLimitIssueSchema,
    issueLimitIssueSchema,
  ])
  .superRefine((issue, ctx) => {
    if (issue.code === "unsupported_node" && issue.startOffset >= issue.endOffset) {
      ctx.addIssue({
        code: "custom",
        message: "Unsupported node offsets must identify a non-empty source range.",
      });
    }
  });

export const notePassageProjectionSchema = z.discriminatedUnion("status", [
  z.strictObject({
    status: z.literal("complete"),
    passages: z.array(notePassageSchema).min(1).max(1_000),
  }),
  z.strictObject({
    status: z.literal("partial"),
    passages: z.array(notePassageSchema).min(1).max(1_000),
    issues: z.array(passageIssueSchema).min(1),
  }),
  z.strictObject({
    status: z.literal("empty"),
    passages: z.tuple([]),
  }),
  z.strictObject({
    status: z.literal("unsupported"),
    passages: z.tuple([]),
    issues: z.array(passageIssueSchema).min(1),
  }),
  z.strictObject({
    status: z.literal("malformed"),
    passages: z.tuple([]),
    issues: z.array(passageIssueSchema).min(1),
  }),
]);

export type NotePassage = z.infer<typeof notePassageSchema>;
export type NotePassageSource = z.infer<typeof notePassageSourceSchema>;
export type PassageIssue = z.infer<typeof passageIssueSchema>;
export type NotePassageProjection = z.infer<typeof notePassageProjectionSchema>;
export type NotePassageProjectionInput = {
  noteId: string;
  /** Opaque note version, normally the strong ETag returned with the note. */
  version: string;
  content: unknown;
};

/**
 * Changes to the projected text, source shape or split rules invalidate stored embeddings. The
 * index must rebuild when this value changes.
 */
export const PASSAGE_PROJECTION_VERSION = 1;
