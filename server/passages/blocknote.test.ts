import { describe, expect, it } from "vite-plus/test";
import {
  noteId,
  version,
  text,
  paragraph,
  heading,
  bullet,
  numbered,
  check,
  quote,
  code,
  cell,
  table,
  document,
  project,
  texts,
  issues,
  fixture,
} from "./test-helpers.ts";

describe("BlockNote passage projection", () => {
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

  it("projects the stored block fixture", () => {
    const result = project(JSON.parse(fixture("supported.block.json")));
    expect(result.status).toBe("complete");
    expect(texts(result)).toContain("Atlas fixture");
    expect(texts(result)).toContain("A short fixture paragraph.");
    expect(texts(result)).toContain("- First\n  - Nested");
    expect(texts(result)).toContain("A | B\n1 | 2");
  });
});
