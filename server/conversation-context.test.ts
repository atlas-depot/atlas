import { describe, expect, it } from "vite-plus/test";
import {
  byteSize,
  compactionInput,
  composeContext,
  CONTEXT_LIMITS,
  mergeDependencies,
  splitContext,
  summaryOutputSchema,
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
  it("keeps provider and server summary limits aligned", () => {
    expect(summaryOutputSchema.properties.summary.maxLength).toBe(CONTEXT_LIMITS.summaryCodePoints);
    const pattern = new RegExp(summaryOutputSchema.properties.summary.pattern);
    expect(pattern.test('line\n\t"quoted"')).toBe(true);
    expect(pattern.test("\u0001")).toBe(false);
    expect(byteSize("漢")).toBe(3);
    // 650 astral code points are 1,300 UTF-16 units and fit 4,000 JSON bytes.
    expect(summaryResultSchema.safeParse({ summary: "😀".repeat(650) }).success).toBe(true);
    expect(summaryResultSchema.safeParse({ summary: "😀".repeat(651) }).success).toBe(false);
    expect(summaryResultSchema.safeParse({ summary: "漢".repeat(650) }).success).toBe(true);
    expect(summaryResultSchema.safeParse({ summary: "漢".repeat(651) }).success).toBe(false);
    expect(byteSize(JSON.stringify("😀".repeat(650)))).toBeLessThanOrEqual(
      CONTEXT_LIMITS.summaryBytes,
    );
    // Allowed whitespace and quotes fit; other C0 controls are rejected.
    expect(summaryResultSchema.safeParse({ summary: '\n"'.repeat(325) }).success).toBe(true);
    expect(summaryResultSchema.safeParse({ summary: "\u0001".repeat(650) }).success).toBe(false);
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
  it("compacts the newest older messages that fit and leaves whole earlier ones out", () => {
    const older = [1, 2, 3].map((sequence) => ({
      id: String(sequence),
      sequence,
      role: "user" as const,
      text: "a".repeat(20_000),
    }));
    const input = compactionInput("Earlier summary", older)!;
    expect(byteSize(input)).toBeLessThanOrEqual(CONTEXT_LIMITS.reconstructionBytes);
    expect(JSON.parse(input)).toEqual({
      previousSummary: "Earlier summary",
      messages: [older[1], older[2]],
    });
    expect(compactionInput("Earlier summary", [])).toBeNull();
  });
  it("separates historical context from the unchanged current question", () => {
    expect(composeContext(null, [], "What now?")).toBe("What now?");
    expect(composeContext("Older decisions", [], "What now?")).toBe(
      'Conversation context (historical, not current source evidence):\n{"summary":"Older decisions","recent":[]}\n\nCurrent question:\nWhat now?',
    );
  });
  it("accepts every summary length the runtime schema allows, in any script", () => {
    const length = summaryOutputSchema.properties.summary.maxLength;
    for (const letter of ["a", "ğ", "漢"])
      expect(summaryResultSchema.safeParse({ summary: letter.repeat(length) }).success).toBe(true);
  });
  it("compacts the newest older messages that fit and leaves earlier ones out whole", () => {
    const older = [1, 2, 3, 4].map((sequence) => ({
      id: String(sequence),
      sequence,
      role: "assistant" as const,
      text: `m${sequence} ${"a".repeat(20_000)}`,
    }));
    const input = compactionInput("Earlier summary.", older)!;
    expect(byteSize(input)).toBeLessThanOrEqual(CONTEXT_LIMITS.reconstructionBytes);
    expect(JSON.parse(input)).toEqual({
      previousSummary: "Earlier summary.",
      messages: older.slice(2),
    });
    expect(compactionInput(null, [])).toBeNull();
  });
  it("keeps one copy of a dependency whatever its property order", () => {
    const noteId = "00000000-0000-4000-8000-000000000001";
    expect(mergeDependencies([{ noteId, version: "v1" }], [{ version: "v1", noteId }])).toEqual([
      { noteId, version: "v1" },
    ]);
  });
});
