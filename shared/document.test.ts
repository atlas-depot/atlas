import { describe, expect, it } from "vite-plus/test";
import {
  blockNoteDocumentSchema,
  canonicalJson,
  canonicalNoteContent,
  documentContentSchema,
  noteContentPlainText,
  organizerContent,
} from "./document.ts";

function paragraph(id = "paragraph", value = "A note") {
  return {
    id,
    type: "paragraph",
    props: {},
    content: [{ type: "text", text: value, styles: {} }],
    children: [],
  };
}
const document = (blocks: unknown[] = [paragraph()]) => ({
  format: "blocknote",
  schemaVersion: 1,
  blocks,
});

describe("stored note documents", () => {
  it("preserves exact legacy Markdown and its receipt serialization", () => {
    const source = "  # Note\r\n\n- untouched *source* 😀\n";
    expect(documentContentSchema.parse(source)).toBe(source);
    expect(organizerContent(source)).toBe(source);
    expect(canonicalJson(["title", source, "2026-11-05T12:00:00.000Z"])).toBe(
      JSON.stringify(["title", source, "2026-11-05T12:00:00.000Z"]),
    );
  });

  it("preserves IDs, nesting, code and table content across JSON serialization", () => {
    const value = blockNoteDocumentSchema.parse(
      document([
        { ...paragraph("parent"), children: [paragraph("child", "Nested 😀")] },
        {
          id: "code",
          type: "codeBlock",
          props: { language: "typescript" },
          content: [{ type: "text", text: "const text = '<script>';\n", styles: {} }],
          children: [],
        },
        {
          id: "table",
          type: "table",
          props: {},
          content: {
            type: "tableContent",
            columnWidths: [undefined, 180],
            rows: [
              {
                cells: [
                  [{ type: "text", text: "Left", styles: {} }],
                  [{ type: "text", text: "Right", styles: { bold: true } }],
                ],
              },
            ],
          },
          children: [],
        },
        { id: "divider", type: "divider", props: {}, children: [] },
      ]),
    );
    expect(blockNoteDocumentSchema.parse(JSON.parse(JSON.stringify(value)))).toEqual(value);
    expect(value.blocks.map((block) => block.id)).toEqual(["parent", "code", "table", "divider"]);
    expect(value.blocks[0].children[0].id).toBe("child");
    expect(organizerContent(value)).toContain("const text = '<script>';\\n");
  });

  it("extracts plain block text across spans and line breaks without serialization fields", () => {
    const value = blockNoteDocumentSchema.parse(
      document([
        {
          ...paragraph("split", "The quarterly budget "),
          content: [
            { type: "text", text: "The quarterly budget ", styles: {} },
            { type: "text", text: "freeze", styles: { bold: true } },
          ],
          children: [paragraph("nested", "horizon child")],
        },
        paragraph("next", "for the bluebird acquisition"),
        {
          id: "link",
          type: "paragraph",
          props: {},
          content: [
            {
              type: "link",
              href: "https://internal.example.com/secret/roadmap",
              content: [{ type: "text", text: "dashboard", styles: {} }],
            },
          ],
          children: [],
        },
        {
          id: "table",
          type: "table",
          props: {},
          content: {
            type: "tableContent",
            columnWidths: [180, 180],
            rows: [
              {
                cells: [
                  [{ type: "text", text: "secret cell", styles: {} }],
                  [{ type: "text", text: "code", styles: {} }],
                ],
              },
            ],
          },
          children: [],
        },
      ]),
    );
    const text = noteContentPlainText(value);
    expect(text).toContain("The quarterly budget freeze");
    expect(text).toContain("freeze\nhorizon child");
    expect(text).toContain("freeze\nhorizon child\nfor the bluebird acquisition");
    expect(text).toContain("secret cell\ncode\n");
    expect(text).toContain("https://internal.example.com/secret/roadmap\ndashboard");
    expect(text).not.toContain('"type"');
    expect(text).not.toContain("columnWidths");
  });

  it("keeps text immediately before a link from merging into the destination", () => {
    const value = blockNoteDocumentSchema.parse(
      document([
        {
          id: "para",
          type: "paragraph",
          props: {},
          content: [
            { type: "text", text: "bluebird", styles: {} },
            {
              type: "link",
              href: "https://example.com",
              content: [{ type: "text", text: "Read", styles: {} }],
            },
          ],
          children: [],
        },
      ]),
    );
    const text = noteContentPlainText(value);
    expect(text).toContain("bluebird");
    expect(text).toContain("https://example.com");
    expect(text).not.toContain("bluebirdhttps");
  });

  it("distinguishes a structured document from a literal string containing the same JSON", () => {
    const value = blockNoteDocumentSchema.parse(document());
    expect(canonicalNoteContent(value)).not.toBe(canonicalNoteContent(canonicalNoteContent(value)));
    expect(canonicalJson(["title", value, "date"])).not.toBe(
      canonicalJson(["title", canonicalNoteContent(value), "date"]),
    );
    expect(canonicalJson({ z: 1, a: [{ b: 2, a: 1 }] })).toBe(
      canonicalJson({ a: [{ a: 1, b: 2 }], z: 1 }),
    );
  });

  it.each(["https://example.com/path", "mailto:person@example.com", "../notes/other", "#section"])(
    "accepts safe link %s",
    (href) => {
      const block = {
        ...paragraph(),
        content: [{ type: "link", href, content: [{ type: "text", text: "Read", styles: {} }] }],
      };
      expect(blockNoteDocumentSchema.safeParse(document([block])).success).toBe(true);
    },
  );

  it.each([
    "javascript:alert(1)",
    "JaVaScRiPt:alert(1)",
    "data:text/html,<script>",
    "java\nscript:alert(1)",
    "https://user:password@example.com",
  ])("rejects unsafe link %s", (href) => {
    const block = {
      ...paragraph(),
      content: [{ type: "link", href, content: [{ type: "text", text: "Read", styles: {} }] }],
    };
    expect(blockNoteDocumentSchema.safeParse(document([block])).success).toBe(false);
  });

  it.each(["\0", "\ud800", "\udc00"])(
    "rejects unsupported characters in nested text and properties",
    (value) => {
      expect(
        blockNoteDocumentSchema.safeParse(
          document([{ ...paragraph(), children: [paragraph("child", value)] }]),
        ).success,
      ).toBe(false);
      expect(
        blockNoteDocumentSchema.safeParse(
          document([{ ...paragraph(), props: { textColor: value } }]),
        ).success,
      ).toBe(false);
    },
  );

  it("rejects duplicate IDs, unsupported media, unknown properties and invalid type-specific props", () => {
    expect(blockNoteDocumentSchema.safeParse(document([paragraph(), paragraph()])).success).toBe(
      false,
    );
    expect(
      blockNoteDocumentSchema.safeParse(document([{ ...paragraph(), type: "image" }])).success,
    ).toBe(false);
    expect(
      blockNoteDocumentSchema.safeParse(
        document([{ ...paragraph(), props: { onclick: "alert(1)" } }]),
      ).success,
    ).toBe(false);
    expect(
      blockNoteDocumentSchema.safeParse(
        document([{ ...paragraph(), type: "heading", props: { level: 99 } }]),
      ).success,
    ).toBe(false);
  });

  it("bounds text, recursive depth and total blocks before recursive validation", () => {
    expect(
      blockNoteDocumentSchema.safeParse(document([paragraph("long", "x".repeat(100_001))])).success,
    ).toBe(false);
    let deep: unknown = paragraph("bottom");
    for (let level = 0; level < 5_000; level++)
      deep = { ...paragraph(`level-${level}`), children: [deep] };
    expect(blockNoteDocumentSchema.safeParse(document([deep])).success).toBe(false);
    expect(
      blockNoteDocumentSchema.safeParse(
        document(Array.from({ length: 1_001 }, (_, index) => paragraph(`block-${index}`))),
      ).success,
    ).toBe(false);
  });

  it("counts normalized properties so an accepted write remains readable", () => {
    expect(
      blockNoteDocumentSchema.safeParse(document([paragraph("paragraph", "x".repeat(99_960))]))
        .success,
    ).toBe(false);
    const accepted = blockNoteDocumentSchema.parse(
      document([paragraph("paragraph", "x".repeat(99_900))]),
    );
    expect(blockNoteDocumentSchema.parse(JSON.parse(JSON.stringify(accepted)))).toEqual(accepted);
  });

  it("accepts a merged table grid and rejects holes or out-of-bounds spans", () => {
    const merged = {
      id: "table",
      type: "table",
      props: {},
      children: [],
      content: {
        type: "tableContent",
        columnWidths: [null, null],
        rows: [
          { cells: [{ type: "tableCell", props: { colspan: 2, rowspan: 2 }, content: [] }] },
          { cells: [] },
        ],
      },
    };
    expect(blockNoteDocumentSchema.safeParse(document([merged])).success).toBe(true);
    expect(
      blockNoteDocumentSchema.safeParse(
        document([{ ...merged, content: { ...merged.content, columnWidths: [null] } }]),
      ).success,
    ).toBe(false);
    expect(
      blockNoteDocumentSchema.safeParse(
        document([{ ...merged, content: { ...merged.content, rows: [{ cells: [[]] }] } }]),
      ).success,
    ).toBe(false);
  });
});
