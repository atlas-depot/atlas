import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vite-plus/test";
import { notePassageProjectionSchema, type PassageIssue } from "../shared/passages.ts";
import { projectNotePassages } from "./passages.ts";

const noteId = "d777e778-3a1f-4d64-a924-194320ad023a";
const version = `"${noteId}:3"`;

const text = (value: string) => ({ type: "text", text: value, styles: {} });
const paragraph = (id: string, value: string, children: unknown[] = []) => ({
  id,
  type: "paragraph",
  props: {},
  content: [text(value)],
  children,
});
const heading = (id: string, value: string, level = 1, children: unknown[] = []) => ({
  id,
  type: "heading",
  props: { level },
  content: [text(value)],
  children,
});
const bullet = (id: string, value: string, children: unknown[] = []) => ({
  id,
  type: "bulletListItem",
  props: {},
  content: [text(value)],
  children,
});
const numbered = (id: string, value: string, start?: number, children: unknown[] = []) => ({
  id,
  type: "numberedListItem",
  props: start === undefined ? {} : { start },
  content: [text(value)],
  children,
});
const check = (id: string, value: string, checked: boolean, children: unknown[] = []) => ({
  id,
  type: "checkListItem",
  props: { checked },
  content: [text(value)],
  children,
});
const quote = (id: string, value: string) => ({
  id,
  type: "quote",
  props: {},
  content: [text(value)],
  children: [],
});
const code = (id: string, value: string, language = "ts") => ({
  id,
  type: "codeBlock",
  props: { language },
  content: [text(value)],
  children: [],
});
const divider = (id: string) => ({ id, type: "divider", props: {}, children: [] });
const cell = (value: string, props: Record<string, unknown> = {}) => ({
  type: "tableCell",
  props,
  content: [text(value)],
});
const table = (id: string, rows: unknown[][], columns = rows[0]?.length ?? 1) => ({
  id,
  type: "table",
  props: {},
  content: {
    type: "tableContent",
    columnWidths: Array.from({ length: columns }, () => 120),
    rows: rows.map((cells) => ({ cells })),
  },
  children: [],
});
const document = (blocks: unknown[]) => ({
  format: "blocknote",
  schemaVersion: 1,
  blocks,
});

function project(content: unknown) {
  const result = projectNotePassages({ noteId, version, content });
  return notePassageProjectionSchema.parse(result);
}

function texts(result: ReturnType<typeof project>): string[] {
  return result.passages.map((passage) => passage.text);
}

function issues(result: ReturnType<typeof project>): PassageIssue[] {
  if (!("issues" in result)) throw new Error("Expected projection issues");
  return result.issues;
}

function fixture(name: string): string {
  return readFileSync(
    fileURLToPath(new URL(`../fixtures/passages/${name}`, import.meta.url)),
    "utf8",
  );
}

describe("note passage projection", () => {
  it("projects Markdown units with deterministic offsets and heading paths", () => {
    const content = "# Atlas\n\nShort note.\n\n- First\n  - Nested\n";
    const result = project(content);
    expect(result.status).toBe("complete");
    expect(texts(result)).toEqual(["Atlas", "Short note.", "- First\n  - Nested"]);
    expect(result.passages.map((passage) => passage.source)).toEqual([
      {
        kind: "markdown",
        noteId,
        version,
        headingPath: ["Atlas"],
        startOffset: 0,
        endOffset: 7,
      },
      {
        kind: "markdown",
        noteId,
        version,
        headingPath: ["Atlas"],
        startOffset: 9,
        endOffset: 20,
      },
      {
        kind: "markdown",
        noteId,
        version,
        headingPath: ["Atlas"],
        startOffset: 22,
        endOffset: 40,
      },
    ]);
    for (const passage of result.passages) {
      if (passage.source.kind !== "markdown") throw new Error("Expected Markdown source");
      expect(content.slice(passage.source.startOffset, passage.source.endOffset)).not.toBe("");
    }
  });

  it("projects top-level BlockNote blocks and their nested children", () => {
    const result = project(
      document([
        heading("h1", "Atlas"),
        paragraph("p1", "Short note."),
        bullet("l1", "First", [bullet("l2", "Nested")]),
      ]),
    );
    expect(result.status).toBe("complete");
    expect(texts(result)).toEqual(["Atlas", "Short note.", "- First\n  - Nested"]);
    expect(result.passages.map((passage) => passage.source)).toEqual([
      {
        kind: "block",
        noteId,
        version,
        blockId: "h1",
        headingPath: ["Atlas"],
      },
      {
        kind: "block",
        noteId,
        version,
        blockId: "p1",
        headingPath: ["Atlas"],
      },
      {
        kind: "block",
        noteId,
        version,
        blockId: "l1",
        headingPath: ["Atlas"],
      },
    ]);
  });

  it("keeps list markers, ordering, and nested hierarchy", () => {
    const result = project(
      [
        "3. Third",
        "4. Fourth",
        "   - Child",
        "     1. Grandchild",
        "- [x] Done",
        "- [ ] Todo",
      ].join("\n"),
    );
    expect(result.status).toBe("complete");
    expect(texts(result)).toEqual([
      "3. Third\n4. Fourth\n  - Child\n    1. Grandchild",
      "- [x] Done\n- [ ] Todo",
    ]);
  });

  it("projects Markdown tables in row and cell order", () => {
    const result = project("| A | B |\n| --- | --- |\n| 1 | 2 |\n");
    expect(result.status).toBe("complete");
    expect(texts(result)).toEqual(["A | B\n1 | 2"]);
  });

  it("expands BlockNote table spans and accepts legacy inline cells", () => {
    const spanned = project(
      document([table("t1", [[cell("A", { colspan: 2 })], [cell("B"), cell("C")]], 2)]),
    );
    expect(spanned.status).toBe("complete");
    expect(texts(spanned)).toEqual(["A | \nB | C"]);

    const legacy = project(
      document([
        table("t2", [
          [[text("Left")], [text("Right")]],
          [[text("One")], [text("Two")]],
        ]),
      ]),
    );
    expect(legacy.status).toBe("complete");
    expect(texts(legacy)).toEqual(["Left | Right\nOne | Two"]);
  });

  it("keeps code content exact, including indentation and script-like text", () => {
    const markdownCode = '```ts\nconst text = "<script>";\n  indented();\n```\n';
    expect(texts(project(markdownCode))).toEqual(['const text = "<script>";\n  indented();']);

    const value = "const x = 1;\n  y();\n";
    expect(texts(project(document([code("c1", value)])))).toEqual([value]);
  });

  it("keeps code exact when it is the first child of a list item", () => {
    const result = project("- ```\n  const x = 1;\n    y();\n  ```\n");
    expect(result.status).toBe("complete");
    expect(texts(result)).toEqual(["const x = 1;\n  y();"]);
  });

  it("keeps code exact through nested list indentation", () => {
    const markdown = project(
      [
        "- Parent",
        "  - Child",
        "",
        "    ```",
        "    const x = 1;",
        "      y();",
        "    ```",
        "",
      ].join("\n"),
    );
    expect(markdown.status).toBe("complete");
    expect(texts(markdown)).toEqual(["- Parent\n  - Child\nconst x = 1;\n  y();"]);

    const block = project(
      document([
        bullet("b1", "Parent", [bullet("b2", "Child", [code("c1", "const x = 1;\n  y();\n")])]),
      ]),
    );
    expect(block.status).toBe("complete");
    expect(texts(block)).toEqual(["- Parent\n  - Child\nconst x = 1;\n  y();\n"]);
  });

  it("preserves Turkish, supplementary and combining Unicode", () => {
    const value = "Başlık 😀 𐐷 e\u0301";
    const result = project(`# ${value}\n\n${value}\n`);
    expect(result.status).toBe("complete");
    expect(texts(result)).toEqual([value, value]);
  });

  it("uses UTF-16 offsets with CRLF input", () => {
    const content = "# 😀\r\n\r\nText\r\n";
    const result = project(content);
    expect(result.status).toBe("complete");
    const source = result.passages[1].source;
    if (source.kind !== "markdown") throw new Error("Expected Markdown source");
    expect(source.startOffset).toBe(8);
    expect(source.endOffset).toBe(12);
    expect(content.slice(source.startOffset, source.endOffset)).toBe("Text");
  });

  it("returns empty for supported content without meaningful text", () => {
    expect(project("")).toEqual({ status: "empty", passages: [] });
    expect(project("---\n")).toEqual({ status: "empty", passages: [] });
    expect(project(document([paragraph("p1", "")]))).toEqual({
      status: "empty",
      passages: [],
    });
    expect(project(document([divider("d1")]))).toEqual({ status: "empty", passages: [] });
    expect(project(document([table("t1", [[cell(""), cell("")]])]))).toEqual({
      status: "empty",
      passages: [],
    });
  });

  it("distinguishes unsupported content from empty and partial content", () => {
    const imageOnly = project("![x](https://example.com/x.png)\n");
    expect(imageOnly.status).toBe("unsupported");
    expect(imageOnly.passages).toEqual([]);
    expect(issues(imageOnly)[0]?.code).toBe("unsupported_node");

    const mixed = project("Hello\n\n![x](https://example.com/x.png)\n");
    expect(mixed.status).toBe("partial");
    expect(texts(mixed)).toEqual(["Hello"]);
    expect(issues(mixed)[0]?.code).toBe("unsupported_node");

    const htmlOnly = project("<div>Hello</div>\n");
    expect(htmlOnly.status).toBe("unsupported");
    expect(issues(htmlOnly)[0]?.code).toBe("unsupported_node");

    const footnote = project("Claim[^1]\n\n[^1]: Evidence\n");
    expect(footnote.status).toBe("partial");
    expect(texts(footnote)).toEqual(["Claim"]);
    expect(issues(footnote).length).toBeGreaterThan(0);
  });

  it("supports reference links and task lists without fake block IDs", () => {
    const result = project("[Source][ref]\n\n[ref]: https://example.com\n\n- [x] Done\n");
    expect(result.status).toBe("complete");
    expect(texts(result)).toEqual(["Source", "- [x] Done"]);
    for (const passage of result.passages) {
      expect(passage.source.kind).toBe("markdown");
      expect("blockId" in passage.source).toBe(false);
    }
  });

  it("keeps a top-level heading path across siblings and pops it", () => {
    const result = project("# A\n\n## B\n\nText\n\n# C\n\nText 2\n");
    expect(result.status).toBe("complete");
    expect(texts(result)).toEqual(["A", "B", "Text", "C", "Text 2"]);
    expect(
      result.passages.map((passage) =>
        passage.source.kind === "markdown" ? passage.source.headingPath : [],
      ),
    ).toEqual([["A"], ["A", "B"], ["A", "B"], ["C"], ["C"]]);
  });

  it("does not treat headings inside quotes or lists as top-level sections", () => {
    const result = project("# A\n\n> ### Quoted\n>\n> Text\n\n- Item\n\nText 2\n");
    expect(texts(result)).toEqual(["A", "Quoted\nText", "- Item", "Text 2"]);
    expect(
      result.passages.map((passage) =>
        passage.source.kind === "markdown" ? passage.source.headingPath.join("/") : "",
      ),
    ).toEqual(["A", "A", "A", "A"]);
  });

  it("does not split a heading path grapheme at the cap", () => {
    const value = `a${"\u0301".repeat(256)}`;
    const result = project(`# ${value}\n\nChild\n`);
    expect(result.status).toBe("complete");
    const child = result.passages.find((passage) => passage.text === "Child");
    if (!child || child.source.kind !== "markdown") throw new Error("Expected Markdown child");
    expect(child.source.headingPath).toEqual([""]);
    for (const passage of result.passages) {
      if (passage.source.kind === "markdown") {
        expect(passage.source.headingPath.every((entry) => entry.length <= 256)).toBe(true);
      }
    }
  });

  it("propagates a heading path to children of an oversized heading", () => {
    const headingText = "Heading ".repeat(600);
    const result = project(document([heading("h1", headingText, 1, [paragraph("p1", "Child")])]));
    expect(result.status).toBe("complete");
    const child = result.passages.find(
      (passage) => passage.source.kind === "block" && passage.source.blockId === "p1",
    );
    if (!child || child.source.kind !== "block") throw new Error("Expected child block source");
    expect(child.source.headingPath).toEqual([headingText.slice(0, 256)]);
    expect(child.source.headingPath[0]).toHaveLength(256);
  });

  it("splits long text at grapheme boundaries without corrupting Unicode", () => {
    const value = "😀".repeat(2_500);
    const result = project(value);
    expect(result.status).toBe("complete");
    expect(result.passages.length).toBeGreaterThan(1);
    expect(texts(result).join("")).toBe(value);
    for (const passage of result.passages) {
      expect(() => encodeURIComponent(passage.text)).not.toThrow();
      if (passage.source.kind !== "markdown") throw new Error("Expected Markdown source");
    }
    expect(
      result.passages.map((passage) =>
        passage.source.kind === "markdown" ? passage.source.part : undefined,
      ),
    ).toEqual([0, 1]);
  });

  it("keeps one indivisible grapheme whole above the soft limit", () => {
    const value = `a${"\u0301".repeat(4_000)}`;
    const result = project(value);
    expect(result.status).toBe("complete");
    expect(texts(result)).toEqual([value]);
    expect(value.length).toBe(4_001);
  });

  it("splits long code at line boundaries", () => {
    const value = "const value = 1;\n".repeat(400);
    const result = project(`\`\`\`ts\n${value}\`\`\`\n`);
    expect(result.status).toBe("complete");
    expect(result.passages.length).toBeGreaterThan(1);
    expect(texts(result).join("")).toBe(value.replace(/\n$/, ""));
  });

  it("keeps formatted list passages within the passage limit", () => {
    const value = "a".repeat(3_999);
    const markdown = project(`- ${value}\n`);
    expect(markdown.status).toBe("complete");
    expect(texts(markdown).every((text) => text.length <= 4_000)).toBe(true);

    const block = project(document([bullet("b1", value)]));
    expect(block.status).toBe("complete");
    expect(texts(block).every((text) => text.length <= 4_000)).toBe(true);
  });

  it("keeps blank lines exact in long code passages", () => {
    const value = `${"a".repeat(3_999)}\n\n${"b".repeat(4_000)}`;
    const markdown = project(`\`\`\`\n${value}\n\`\`\`\n`);
    expect(markdown.status).toBe("complete");
    expect(texts(markdown).join("")).toBe(value);
    expect(markdown.passages.every((passage) => passage.text.length <= 4_000)).toBe(true);

    const block = project(document([code("c1", value)]));
    expect(block.status).toBe("complete");
    expect(texts(block).join("")).toBe(value);
    expect(block.passages.every((passage) => passage.text.length <= 4_000)).toBe(true);

    const list = project(`- \`\`\`\n  ${value.replace(/\n/g, "\n  ")}\n  \`\`\`\n`);
    expect(list.status).toBe("complete");
    expect(texts(list).join("")).toBe(value);
    expect(list.passages.every((passage) => passage.text.length <= 4_000)).toBe(true);
  });

  it("keeps a long blank run exact in code", () => {
    const value = `${"a".repeat(3_999)}${"\n".repeat(12_000)}${"b".repeat(3_999)}`;
    const markdown = project(`\`\`\`\n${value}\n\`\`\`\n`);
    expect(markdown.status).toBe("complete");
    expect(texts(markdown).join("")).toBe(value);
    expect(markdown.passages.every((passage) => passage.text.length <= 4_000)).toBe(true);

    const block = project(document([code("c1", value)]));
    expect(block.status).toBe("complete");
    expect(texts(block).join("")).toBe(value);
    expect(block.passages.every((passage) => passage.text.length <= 4_000)).toBe(true);
  });

  it("keeps a long single-line code value exact", () => {
    const value = `${"a".repeat(4_000)}${" ".repeat(4_000)}${"b".repeat(4_000)}`;
    const markdown = project(`\`\`\`\n${value}\n\`\`\`\n`);
    expect(markdown.status).toBe("complete");
    expect(texts(markdown).join("")).toBe(value);
    expect(markdown.passages.every((passage) => passage.text.length <= 4_000)).toBe(true);

    const block = project(document([code("c1", value)]));
    expect(block.status).toBe("complete");
    expect(texts(block).join("")).toBe(value);
    expect(block.passages.every((passage) => passage.text.length <= 4_000)).toBe(true);
  });

  it("keeps CRLF code order exact", () => {
    const value = `${"a".repeat(4_001)}${"\r\n".repeat(2_001)}b`;
    const block = project(document([code("c1", value)]));
    expect(block.status).toBe("complete");
    expect(texts(block).join("")).toBe(value);
    expect(block.passages.every((passage) => passage.text.length <= 4_000)).toBe(true);

    const markdown = project(`\`\`\`\n${value}\n\`\`\`\n`);
    expect(markdown.status).toBe("complete");
    expect(texts(markdown).join("")).toBe(value);
    expect(markdown.passages.every((passage) => passage.text.length <= 4_000)).toBe(true);
  });

  it("keeps code exact when a list item starts with a quote", () => {
    const content = ["- > ```python", "  > if True:", '  >     print("ok")', "  > ```", ""].join(
      "\n",
    );
    const result = project(content);
    expect(result.status).toBe("complete");
    expect(texts(result)).toEqual(['if True:\n    print("ok")']);
  });

  it("keeps code splits on whole lines when lines fit", () => {
    const lineA = "a".repeat(3_000);
    const lineB = "b".repeat(3_000);
    const result = project(`\`\`\`\n${lineA}\n${lineB}\n\`\`\`\n`);
    expect(result.status).toBe("complete");
    expect(texts(result)).toEqual([`${lineA}\n`, lineB]);
  });

  it("does not overflow a code passage to fit one grapheme", () => {
    const value = `${"a".repeat(3_999)}😀`;
    const result = project(`\`\`\`\n${value}\n\`\`\`\n`);
    expect(result.status).toBe("complete");
    expect(texts(result).join("")).toBe(value);
    expect(result.passages.every((passage) => passage.text.length <= 4_000)).toBe(true);
  });

  it("reports malformed content separately", () => {
    expect(project("\0")).toEqual({
      status: "malformed",
      passages: [],
      issues: [{ code: "malformed_content", reason: "content_schema" }],
    });
    expect(project("\ud800")).toEqual({
      status: "malformed",
      passages: [],
      issues: [{ code: "malformed_content", reason: "content_schema" }],
    });
    expect(project("x".repeat(100_001))).toEqual({
      status: "malformed",
      passages: [],
      issues: [{ code: "malformed_content", reason: "content_schema" }],
    });
    expect(project("> ".repeat(97) + "Text")).toEqual({
      status: "malformed",
      passages: [],
      issues: [{ code: "malformed_content", reason: "nesting_limit" }],
    });
  });

  it("classifies unsupported block documents and malformed schemas", () => {
    expect(project({ format: "blocknote", schemaVersion: 2, blocks: [] })).toEqual({
      status: "unsupported",
      passages: [],
      issues: [{ code: "unsupported_schema_version", schemaVersion: 2 }],
    });
    expect(project({ format: "markdown", schemaVersion: 1, blocks: [] })).toEqual({
      status: "unsupported",
      passages: [],
      issues: [{ code: "unsupported_format", format: "markdown" }],
    });
    expect(project({ format: "blocknote", schemaVersion: 1e20, blocks: [] })).toEqual({
      status: "malformed",
      passages: [],
      issues: [{ code: "malformed_content", reason: "content_schema" }],
    });
    expect(
      project(document([{ id: "image", type: "image", props: {}, content: [], children: [] }])),
    ).toEqual({
      status: "unsupported",
      passages: [],
      issues: [{ code: "unsupported_block_type", blockType: "image", blockId: "image" }],
    });
    expect(project(document([paragraph("same", "One"), paragraph("same", "Two")]))).toEqual({
      status: "malformed",
      passages: [],
      issues: [{ code: "malformed_content", reason: "content_schema" }],
    });
    expect(project(document([table("t1", [[cell("Only one")]], 2)]))).toEqual({
      status: "malformed",
      passages: [],
      issues: [{ code: "malformed_content", reason: "content_schema" }],
    });
  });

  it("keeps unsupported block issues valid for bad type and ID values", () => {
    const emptyType = project(
      document([{ id: "x".repeat(200), type: "", props: {}, content: [], children: [] }]),
    );
    expect(emptyType.status).toBe("unsupported");
    expect(issues(emptyType)).toEqual([{ code: "unsupported_block_type", blockType: "unknown" }]);

    const nulId = project(
      document([{ id: "\0", type: "image", props: {}, content: [], children: [] }]),
    );
    expect(nulId.status).toBe("unsupported");
    expect(issues(nulId)).toEqual([{ code: "unsupported_block_type", blockType: "image" }]);

    const nulType = project(
      document([{ id: "block-1", type: "\0", props: {}, content: [], children: [] }]),
    );
    expect(nulType.status).toBe("unsupported");
    expect(issues(nulType)).toEqual([
      { code: "unsupported_block_type", blockType: "unknown", blockId: "block-1" },
    ]);

    const nulFormat = project({ format: "\0", schemaVersion: 1, blocks: [] });
    expect(nulFormat.status).toBe("unsupported");
    expect(issues(nulFormat)).toEqual([{ code: "unsupported_format", format: "unknown" }]);
  });

  it("returns malformed for invalid source metadata", () => {
    expect(projectNotePassages({ noteId: "note-1", version, content: "Text" })).toEqual({
      status: "malformed",
      passages: [],
      issues: [{ code: "malformed_content", reason: "invalid_source" }],
    });
    expect(projectNotePassages({ noteId, version: "", content: "Text" })).toEqual({
      status: "malformed",
      passages: [],
      issues: [{ code: "malformed_content", reason: "invalid_source" }],
    });
  });

  it("is deterministic and leaves the input unchanged", () => {
    const input = document([
      heading("h1", "Atlas"),
      bullet("b1", "First", [numbered("n1", "Nested", 3), check("c1", "Done", true)]),
      quote("q1", "Quoted"),
      table("t1", [
        [cell("A"), cell("B")],
        [cell("1"), cell("2")],
      ]),
      code("k1", "const x = 1;\n"),
    ]);
    const copy = JSON.parse(JSON.stringify(input));
    const first = project(input);
    const second = project(input);
    const roundTrip = project(JSON.parse(JSON.stringify(input)));
    expect(first).toEqual(second);
    expect(first).toEqual(roundTrip);
    expect(texts(first)).toContain("Quoted");
    expect(input).toEqual(copy);
    expect(new Set(first.passages.map((passage) => JSON.stringify(passage.source))).size).toBe(
      first.passages.length,
    );
  });

  it("caps passages and reports the limit", () => {
    const content = Array.from({ length: 1_001 }, (_, index) => `p${index}`).join("\n\n");
    const result = project(content);
    expect(result.status).toBe("partial");
    expect(result.passages.length).toBe(1_000);
    expect(issues(result).some((issue) => issue.code === "passage_limit")).toBe(true);
  });

  it("caps issues and reports the limit", () => {
    const content = Array.from(
      { length: 101 },
      (_, index) => `![x](https://example.com/${index}.png)`,
    ).join("\n\n");
    const result = project(content);
    expect(result.status).toBe("unsupported");
    expect(issues(result).filter((issue) => issue.code === "unsupported_node").length).toBe(100);
    expect(issues(result).some((issue) => issue.code === "issue_limit")).toBe(true);
  });

  it("keeps the passage limit visible when the issue cap is full", () => {
    const images = Array.from(
      { length: 101 },
      (_, index) => `![x](https://example.com/${index}.png)`,
    );
    const paragraphs = Array.from({ length: 1_001 }, (_, index) => `p${index}`);
    const result = project([...images, ...paragraphs].join("\n\n"));
    expect(result.status).toBe("partial");
    expect(result.passages.length).toBe(1_000);
    const codes = issues(result).map((issue) => issue.code);
    expect(codes).toContain("issue_limit");
    expect(codes).toContain("passage_limit");
  });

  it("projects the stored Markdown fixture", () => {
    const result = project(fixture("supported.md"));
    expect(result.status).toBe("complete");
    expect(texts(result)).toContain("Atlas fixture");
    expect(texts(result)).toContain("A short fixture paragraph.");
    expect(texts(result)).toContain("- First\n  - Nested");
    expect(texts(result)).toContain("A | B\n1 | 2");
  });

  it("projects the stored block fixture", () => {
    const result = project(JSON.parse(fixture("supported.block.json")));
    expect(result.status).toBe("complete");
    expect(texts(result)).toContain("Atlas fixture");
    expect(texts(result)).toContain("A short fixture paragraph.");
    expect(texts(result)).toContain("- First\n  - Nested");
    expect(texts(result)).toContain("A | B\n1 | 2");
  });
});
