import { expect, it, vi } from "vite-plus/test";
import { EMBEDDING_DIMENSIONS, encodeSearchQuery } from "../shared/embedding.ts";
import { noteSearchRequestSchema } from "../shared/note-search.ts";
import { createSearchQueryEncoder } from "./search-query.ts";

const vector = () => Array.from({ length: EMBEDDING_DIMENSIONS }, (_, i) => (i === 0 ? 1 : 0));

it("uses the approved query encoding and accepts one valid vector", async () => {
  const embed = vi.fn().mockResolvedValue([vector()]);
  const result = await createSearchQueryEncoder(embed)("  Notu nerede yazdım?  ");
  expect(result).toEqual(vector());
  expect(embed).toHaveBeenCalledExactlyOnceWith([encodeSearchQuery("Notu nerede yazdım?")]);
});

it("rejects empty and oversized queries before any provider call", async () => {
  const embed = vi.fn().mockResolvedValue([vector()]);
  const encode = createSearchQueryEncoder(embed);
  await expect(encode("   ")).rejects.toThrow();
  await expect(encode("x".repeat(501))).rejects.toThrow();
  expect(embed).not.toHaveBeenCalled();
});

it.each(["find\0note", "find\ud800note", "find\udc00note"])(
  "rejects malformed note text at the public and private query boundaries: %#",
  async (query) => {
    expect(noteSearchRequestSchema.safeParse({ query }).success).toBe(false);
    const embed = vi.fn().mockResolvedValue([vector()]);
    await expect(createSearchQueryEncoder(embed)(query)).rejects.toThrow();
    expect(embed).not.toHaveBeenCalled();
  },
);

it("rejects malformed or incompatible provider output", async () => {
  for (const response of [[], [vector(), vector()], [[1]], [Array(EMBEDDING_DIMENSIONS).fill(0)]]) {
    const encode = createSearchQueryEncoder(async () => response);
    await expect(encode("Find a note")).rejects.toThrow();
  }
});
