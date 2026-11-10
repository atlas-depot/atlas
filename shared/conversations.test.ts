import { describe, expect, it } from "vite-plus/test";
import { randomUUID } from "node:crypto";
import {
  activeConversationTurnSchema,
  conversationCitationSchema,
  conversationMessageSchema,
  conversationTextSchema,
} from "./conversations.ts";
const id = "130c3220-dc86-4fb0-828d-0338cae029d3";
const source = {
  kind: "markdown",
  noteId: id,
  version: JSON.stringify(`${id}:1`),
  headingPath: [],
  startOffset: 0,
  endOffset: 1,
};
describe("conversation public contracts", () => {
  it("enforces valid Unicode, no NUL, and exact UTF-16 text and excerpt boundaries", () => {
    expect(conversationTextSchema.safeParse("😀".repeat(50_000)).success).toBe(true);
    for (const value of ["😀".repeat(50_000) + "a", "bad\0", "\uD800"])
      expect(conversationTextSchema.safeParse(value).success).toBe(false);
    expect(
      conversationCitationSchema.safeParse({
        source,
        excerpt: "😀".repeat(500),
        deleted: false,
        stale: false,
      }).success,
    ).toBe(true);
    expect(
      conversationCitationSchema.safeParse({
        source,
        excerpt: "😀".repeat(500) + "a",
        deleted: false,
        stale: false,
      }).success,
    ).toBe(false);
    expect(
      conversationCitationSchema.safeParse({
        source,
        excerpt: "private",
        deleted: true,
        stale: false,
      }).success,
    ).toBe(false);
  });
  it("requires incomplete reasons and forbids them on completed output", () => {
    const message = {
      id,
      sequence: 1,
      text: "",
      createdAt: "2026-11-10T00:00:00Z",
      role: "assistant",
      turnId: id,
      status: "incomplete",
      reason: "cancelled",
      inputIds: [id],
      citations: [],
    };
    expect(conversationMessageSchema.safeParse(message).success).toBe(true);
    expect(conversationMessageSchema.safeParse({ ...message, reason: null }).success).toBe(false);
    expect(conversationMessageSchema.safeParse({ ...message, status: "completed" }).success).toBe(
      false,
    );
  });
  it("bounds public completed and active turn input IDs and citations", () => {
    const inputIds = Array.from({ length: 100 }, () => randomUUID());
    const citation = { source, excerpt: "x", deleted: false, stale: false };
    const message = {
      id,
      sequence: 1,
      text: "Answer",
      createdAt: "2026-11-10T00:00:00Z",
      role: "assistant",
      turnId: id,
      status: "completed",
      reason: null,
      inputIds,
      citations: Array.from({ length: 100 }, () => citation),
    };
    const active = { id, status: "running", text: "", checkpointVersion: 0, inputIds };
    expect(conversationMessageSchema.safeParse(message).success).toBe(true);
    expect(activeConversationTurnSchema.safeParse(active).success).toBe(true);
    for (const invalidIds of [[], [...inputIds, randomUUID()]]) {
      expect(
        conversationMessageSchema.safeParse({ ...message, inputIds: invalidIds }).success,
      ).toBe(false);
      expect(
        activeConversationTurnSchema.safeParse({ ...active, inputIds: invalidIds }).success,
      ).toBe(false);
    }
    expect(
      conversationMessageSchema.safeParse({
        ...message,
        citations: [...message.citations, citation],
      }).success,
    ).toBe(false);
  });
});
