import { describe, expect, it } from "vite-plus/test";
import { bullet, code, document, project, texts } from "./test-helpers.ts";

describe("passage splitting regressions", () => {
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

  it("keeps CRLF passages within the limit when the remaining room is odd", () => {
    const value = `${"a".repeat(3_997)}\r\n${"\r\n".repeat(2_000)}`;
    const markdown = project(`\`\`\`\n${value}\n\`\`\`\n`);
    expect(markdown.status).toBe("complete");
    expect(texts(markdown).join("")).toBe(value);
    expect(markdown.passages.every((passage) => passage.text.length <= 4_000)).toBe(true);

    const block = project(document([code("c1", value)]));
    expect(block.status).toBe("complete");
    expect(texts(block).join("")).toBe(value);
    expect(block.passages.every((passage) => passage.text.length <= 4_000)).toBe(true);
  });

  it("keeps code exact when a list item starts with a quote", () => {
    const content = ["- > ```python", "  > if True:", '  >     print("ok")', "  > ```", ""].join(
      "\n",
    );
    const result = project(content);
    expect(result.status).toBe("complete");
    expect(texts(result)).toEqual(['if True:\n    print("ok")']);
  });

  it("keeps quoted list code exact after a long text split", () => {
    const longText = "a".repeat(4_001);
    const content = [
      `- > ${longText}`,
      "  >",
      "  > ```python",
      "  > if True:",
      '  >     print("ok")',
      "  > ```",
      "",
    ].join("\n");
    const result = project(content);
    expect(result.status).toBe("complete");
    const joined = texts(result).join("\n");
    expect(joined).toContain('    print("ok")');
    expect(joined).not.toContain('      print("ok")');
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
});
