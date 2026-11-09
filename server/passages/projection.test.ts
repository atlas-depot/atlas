import { describe, expect, it } from "vite-plus/test";
import { projectNotePassages } from "../passages.ts";
import {
  noteId,
  version,
  paragraph,
  bullet,
  code,
  divider,
  cell,
  table,
  document,
  project,
  texts,
} from "./test-helpers.ts";

describe("shared passage behavior", () => {
  it("keeps code content exact, including indentation and script-like text", () => {
    const markdownCode = '```ts\nconst text = "<script>";\n  indented();\n```\n';
    expect(texts(project(markdownCode))).toEqual(['const text = "<script>";\n  indented();']);

    const value = "const x = 1;\n  y();\n";
    expect(texts(project(document([code("c1", value)])))).toEqual([value]);
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
});
