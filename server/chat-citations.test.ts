import { describe, expect, it } from "vite-plus/test";
import type { NotePassage } from "../shared/passages.ts";
import { resolveNoteCitation } from "./chat-citations.ts";

const block: NotePassage = {
  source: {
    kind: "block",
    noteId: "389e1044-164c-4931-b054-0384d66b9523",
    version: '"389e1044-164c-4931-b054-0384d66b9523:3"',
    blockId: "meeting",
    headingPath: ["Schedule"],
    part: 0,
  },
  text: "Perşembe görüşmesi kütüphanede saat 14.00'te. Bütçe henüz belirlenmedi.",
};
const markdown: NotePassage = {
  source: {
    kind: "markdown",
    noteId: "29823072-e4c4-41b5-a296-89da6ddda040",
    version: '"29823072-e4c4-41b5-a296-89da6ddda040:2"',
    startOffset: 8,
    endOffset: 65,
    headingPath: [],
  },
  text: "Design review 📝\r\nFriday at 09:30 in room B12.",
};
const evidence = [block, markdown];

describe("note citation provenance", () => {
  it.each([
    [block, "kütüphanede saat 14.00'te"],
    [markdown, "📝\r\nFriday at 09:30"],
  ])("preserves an exact quote and its supplied source", (passage, excerpt) => {
    expect(resolveNoteCitation(passage.source, excerpt, evidence)).toEqual({
      status: "resolved",
      citation: { source: passage.source, excerpt },
    });
  });

  it.each([
    { noteId: "787341d0-2952-4fa5-96a8-4d9cbeab2711" },
    { version: '"389e1044-164c-4931-b054-0384d66b9523:4"' },
    { blockId: "different-block" },
    { headingPath: ["Different heading"] },
    { part: 1 },
  ])("rejects a reference outside the supplied source set: %j", (change) => {
    expect(resolveNoteCitation({ ...block.source, ...change }, "kütüphanede", evidence)).toEqual({
      status: "rejected",
      reason: "unknown_source",
    });
  });

  it("rejects altered Markdown ranges even when the quote exists", () => {
    expect(resolveNoteCitation({ ...markdown.source, startOffset: 9 }, "Friday", evidence)).toEqual(
      { status: "rejected", reason: "unknown_source" },
    );
  });

  it("does not borrow an excerpt from another part of the same block", () => {
    const nextPart = { source: { ...block.source, part: 1 }, text: "The budget is 120 dollars." };
    expect(resolveNoteCitation(block.source, "120 dollars", [block, nextPart])).toEqual({
      status: "rejected",
      reason: "excerpt_mismatch",
    });
  });

  it.each([
    "The meeting is at the library.",
    "Perşembe görüşmesi saat 14.00'te",
    "kütüphanede saat 15.00'te",
  ])("rejects paraphrased, stitched or changed quotes: %s", (excerpt) => {
    expect(resolveNoteCitation(block.source, excerpt, evidence)).toEqual({
      status: "rejected",
      reason: "excerpt_mismatch",
    });
  });

  it("does not normalize line endings to make a quote match", () => {
    expect(resolveNoteCitation(markdown.source, "📝\nFriday", evidence)).toEqual({
      status: "rejected",
      reason: "excerpt_mismatch",
    });
  });

  it.each(["", null, 42, "\0", "\ud800", "a".repeat(1_001), "📝".repeat(501)])(
    "rejects invalid or oversized excerpt without repairing it: %#",
    (excerpt) => {
      expect(resolveNoteCitation(block.source, excerpt, evidence)).toEqual({
        status: "rejected",
        reason: "invalid_citation",
      });
    },
  );

  it("accepts the excerpt limit without splitting Unicode", () => {
    const text = "📝".repeat(500);
    expect(resolveNoteCitation(block.source, text, [{ ...block, text }])).toEqual({
      status: "resolved",
      citation: { source: block.source, excerpt: text },
    });
  });

  it.each([
    null,
    { ...block.source, ownerId: "another-owner" },
    { ...block.source, kind: "web" },
    { ...markdown.source, startOffset: 65 },
  ])("rejects malformed or extended references: %j", (source) => {
    expect(resolveNoteCitation(source, "kütüphanede", evidence)).toEqual({
      status: "rejected",
      reason: "invalid_citation",
    });
  });

  it("rejects citations when no evidence was supplied", () => {
    expect(resolveNoteCitation(block.source, "kütüphanede", [])).toEqual({
      status: "rejected",
      reason: "unknown_source",
    });
  });

  it("matches reordered JSON keys and returns an independent source snapshot", () => {
    const source = Object.fromEntries(Object.entries(block.source).reverse());
    const result = resolveNoteCitation(source, "kütüphanede", evidence);
    expect(result).toEqual({
      status: "resolved",
      citation: { source: block.source, excerpt: "kütüphanede" },
    });
    if (result.status !== "resolved") throw new Error("Expected a resolved citation");
    expect(result.citation.source).not.toBe(block.source);
    expect(result.citation.source.headingPath).not.toBe(block.source.headingPath);
  });
});
