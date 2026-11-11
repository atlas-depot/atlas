import { describe, expect, it } from "vite-plus/test";
import {
  byteSize,
  composeContext,
  mergeDependencies,
  splitContext,
  summaryResultSchema,
} from "./conversation-context.ts";

describe("bounded conversation context", () => {
  it("preserves whole recent messages, in order, and summarizes the older prefix", () => {
    const messages = [1, 2, 3].map((sequence) => ({
      id: String(sequence),
      sequence,
      role: "user" as const,
      text: "a".repeat(3_000),
    }));
    expect(splitContext(messages)).toEqual({
      older: [messages[0]],
      recent: [messages[1], messages[2]],
    });
  });
  it("does not slice an oversized historical message into apparent accepted input", () => {
    const message = { id: "one", sequence: 1, role: "assistant" as const, text: "a".repeat(9_000) };
    expect(splitContext([message])).toEqual({ older: [message], recent: [] });
  });
  it("counts UTF-8 bytes rather than treating characters as tokens", () => {
    expect(byteSize("漢")).toBe(3);
    expect(summaryResultSchema.safeParse({ summary: "漢".repeat(1_333) }).success).toBe(false);
    expect(summaryResultSchema.safeParse({ summary: "漢".repeat(1_332) }).success).toBe(true);
  });
  it("validates summaries and never accepts an empty or invented result shape", () => {
    for (const result of [
      null,
      { summary: "" },
      { text: "answer" },
      { summary: "fine", sources: [] },
    ])
      expect(summaryResultSchema.safeParse(result).success).toBe(false);
  });
  it("unions transitive source dependencies without letting a summary choose them", () => {
    const a = { noteId: "389e1044-164c-4931-b054-0384d66b9523", version: "revision-1" };
    const b = { ...a, version: "revision-2" };
    expect(mergeDependencies([a], [a, b])).toEqual([a, b]);
  });
  it("separates historical context from the unchanged current question", () => {
    expect(composeContext(null, [], "What now?")).toBe("What now?");
    expect(composeContext("Older decisions", [], "What now?")).toBe(
      'Conversation context (historical, not current source evidence):\n{"summary":"Older decisions","recent":[]}\n\nCurrent question:\nWhat now?',
    );
  });
});
