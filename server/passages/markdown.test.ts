import { describe, expect, it } from "vite-plus/test";
import { noteId, version, project, texts, issues, fixture } from "./test-helpers.ts";

describe("Markdown passage projection", () => {
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

  it("keeps code exact when it is the first child of a list item", () => {
    const result = project("- ```\n  const x = 1;\n    y();\n  ```\n");
    expect(result.status).toBe("complete");
    expect(texts(result)).toEqual(["const x = 1;\n  y();"]);
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
});
