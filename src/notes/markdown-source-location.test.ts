import { describe, expect, it, vi } from "vite-plus/test";
import { findMarkdownSourceBlock } from "./markdown-source-location";

type Block = { id: string; text: string };
const paragraphs = (blocks: Block[]) => `${blocks.map((block) => block.text).join("\n\n")}\n`;

describe("exact Markdown source to rich block navigation", () => {
  it("uses offsets to distinguish duplicate paragraphs and accepts a range spanning blocks", () => {
    const blocks = [
      { id: "first", text: "Repeated evidence." },
      { id: "second", text: "Repeated evidence." },
      { id: "third", text: "Following context." },
    ];
    const source = paragraphs(blocks);
    const startOffset = source.lastIndexOf("Repeated evidence.");
    expect(
      findMarkdownSourceBlock(
        source,
        blocks,
        { startOffset, endOffset: source.length },
        paragraphs,
      ),
    ).toBe("second");
  });

  it("counts UTF-16 offsets without confusing astral characters with single code units", () => {
    const blocks = [
      { id: "compass", text: "🧭 Direction" },
      { id: "target", text: "İkinci 🧭 kanıt." },
    ];
    const source = paragraphs(blocks);
    const startOffset = source.indexOf("İkinci");
    expect(
      findMarkdownSourceBlock(
        source,
        blocks,
        { startOffset, endOffset: startOffset + 5 },
        paragraphs,
      ),
    ).toBe("target");
  });

  it("serializes prefixes in list context rather than matching isolated item text", () => {
    const blocks = [
      { id: "one", text: "Same" },
      { id: "two", text: "Same" },
      { id: "three", text: "Same" },
    ];
    const serialize = (prefix: Block[]) =>
      `${prefix.map((block, index) => `${index + 1}. ${block.text}`).join("\n")}\n`;
    const source = serialize(blocks);
    const startOffset = source.indexOf("2. Same");
    expect(
      findMarkdownSourceBlock(
        source,
        blocks,
        { startOffset, endOffset: startOffset + 7 },
        serialize,
      ),
    ).toBe("two");
  });

  it("rejects separator and trailing-newline offsets instead of selecting a neighboring block", () => {
    const blocks = [
      { id: "first", text: "First" },
      { id: "second", text: "Second" },
    ];
    const source = paragraphs(blocks);
    for (const startOffset of [5, 6, source.length - 1]) {
      expect(
        findMarkdownSourceBlock(
          source,
          blocks,
          { startOffset, endOffset: startOffset + 1 },
          paragraphs,
        ),
      ).toBeUndefined();
    }
  });

  it("rejects lossy or context-dependent prefixes even when the full document matches", () => {
    const blocks = [
      { id: "first", text: "Alpha" },
      { id: "second", text: "Beta" },
    ];
    const source = paragraphs(blocks);
    const range = { startOffset: 7, endOffset: 11 };
    expect(findMarkdownSourceBlock(source, blocks, range, () => "Changed source")).toBeUndefined();
    expect(
      findMarkdownSourceBlock(source, blocks, range, (prefix) =>
        prefix.length === 1 ? "Other" : paragraphs(prefix),
      ),
    ).toBeUndefined();
    expect(
      findMarkdownSourceBlock(source, blocks, { startOffset: 1, endOffset: 3 }, (prefix) =>
        prefix.length === 1 ? "Other" : paragraphs(prefix),
      ),
    ).toBeUndefined();
  });

  it("rejects invalid ranges and serializer failures", () => {
    const blocks = [{ id: "only", text: "Text" }];
    for (const range of [
      { startOffset: -1, endOffset: 1 },
      { startOffset: 0, endOffset: 100 },
      { startOffset: 2, endOffset: 2 },
      { startOffset: 0.5, endOffset: 2 },
      { startOffset: 0, endOffset: Number.NaN },
    ]) {
      expect(findMarkdownSourceBlock("Text", blocks, range, paragraphs)).toBeUndefined();
    }
    expect(
      findMarkdownSourceBlock("Text", blocks, { startOffset: 0, endOffset: 2 }, () => {
        throw new Error("Conversion failed");
      }),
    ).toBeUndefined();
  });

  it("uses logarithmically many prefix serializations for a long document", () => {
    const blocks = Array.from({ length: 1_024 }, (_, index) => ({
      id: `block-${index}`,
      text: `Paragraph ${index}`,
    }));
    const source = paragraphs(blocks);
    const startOffset = source.indexOf("Paragraph 777\n");
    const serialize = vi.fn(paragraphs);
    expect(
      findMarkdownSourceBlock(
        source,
        blocks,
        { startOffset, endOffset: startOffset + 13 },
        serialize,
      ),
    ).toBe("block-777");
    expect(serialize.mock.calls.length).toBeLessThanOrEqual(13);
  });
});
