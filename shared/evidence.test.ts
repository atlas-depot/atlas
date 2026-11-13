import { describe, expect, it } from "vite-plus/test";
import { conversationCitationSchema } from "./conversations.ts";
import { webEvidenceSourceSchema } from "./evidence.ts";

const source = {
  kind: "web",
  url: "https://example.test/release",
  title: "Official release",
  retrievedAt: "2026-11-13T12:00:00.000Z",
} as const;

describe("distinct public evidence records", () => {
  it("validates provider-returned HTTP sources and retains them independently from note sources", () => {
    expect(webEvidenceSourceSchema.parse(source)).toEqual(source);
    expect(
      conversationCitationSchema.parse({
        source,
        excerpt: "The release is on 14 October.",
        deleted: false,
        stale: false,
      }),
    ).toEqual({
      source,
      excerpt: "The release is on 14 October.",
      deleted: false,
      stale: false,
    });
  });

  it("rejects unsafe URLs and note-only deleted or stale states for web citations", () => {
    for (const url of [
      "javascript:alert(1)",
      "https://user:password@example.test/page",
      "not a URL",
    ])
      expect(webEvidenceSourceSchema.safeParse({ ...source, url }).success).toBe(false);

    expect(
      conversationCitationSchema.safeParse({
        source,
        excerpt: null,
        deleted: true,
        stale: false,
      }).success,
    ).toBe(false);
    expect(
      conversationCitationSchema.safeParse({
        source,
        excerpt: "Quote",
        deleted: false,
        stale: true,
      }).success,
    ).toBe(false);
  });
});
