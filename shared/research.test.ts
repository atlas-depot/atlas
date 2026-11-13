import { describe, expect, it } from "vite-plus/test";
import {
  researchDisclosureDecisionInputSchema,
  researchDisclosureRequestSchema,
} from "./research.ts";

describe("public research approval contract", () => {
  it("returns the exact proposed query and a hash-bound short-lived request", () => {
    const request = {
      id: "130c3220-dc86-4fb0-828d-0338cae029d3",
      proposedQuery: "What did Northstar Labs announce?",
      queryHash: "a".repeat(64),
      expiresAt: "2026-11-13T12:02:00.000Z",
    };
    expect(researchDisclosureRequestSchema.parse(request)).toEqual(request);
    expect(researchDisclosureDecisionInputSchema.parse({ queryHash: request.queryHash })).toEqual({
      queryHash: request.queryHash,
    });
  });

  it("rejects missing or malformed payload binding", () => {
    for (const queryHash of ["short", "A".repeat(64)])
      expect(researchDisclosureDecisionInputSchema.safeParse({ queryHash }).success).toBe(false);
    expect(
      researchDisclosureRequestSchema.safeParse({
        id: "130c3220-dc86-4fb0-828d-0338cae029d3",
        proposedQuery: "x".repeat(501),
        queryHash: "a".repeat(64),
        expiresAt: "2026-11-13T12:02:00.000Z",
      }).success,
    ).toBe(false);
  });
});
