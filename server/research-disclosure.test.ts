import { describe, expect, it } from "vite-plus/test";
import { inspectResearchQuestion } from "./research-disclosure.ts";

describe("public research disclosure boundary", () => {
  const privateContext = [
    "Maya Chen works at Northstar Labs. Her salary is $148,000 and her email is maya@example.test.",
  ];

  it("lets an already generalized public question run without private context", () => {
    expect(
      inspectResearchQuestion({
        question: "What are current public-company practices for employee onboarding?",
        privateTexts: privateContext,
      }),
    ).toEqual({
      status: "generalized",
      outboundQuestion: "What are current public-company practices for employee onboarding?",
      redacted: false,
    });
  });

  it("removes note and transcript entities before autonomous research", () => {
    const result = inspectResearchQuestion({
      question: "What are public speaking best practices for Maya Chen at Northstar Labs?",
      privateTexts: privateContext,
    });
    expect(result).toEqual({
      status: "generalized",
      outboundQuestion: "What are public speaking best practices for the subject at the subject?",
      redacted: true,
    });
    if (result.status === "generalized") {
      expect(result.outboundQuestion).not.toContain("Maya");
      expect(result.outboundQuestion).not.toContain("Northstar");
    }
  });

  it("keeps ordinary public years and dates autonomous", () => {
    expect(
      inspectResearchQuestion({
        question: "What public exhibitions opened in 2026?",
        privateTexts: ["Our planning note for 2026-11-13 is private."],
      }),
    ).toEqual({
      status: "generalized",
      outboundQuestion: "What public exhibitions opened in 2026?",
      redacted: false,
    });
  });

  it("removes distinctive lowercase wording copied from private context", () => {
    const result = inspectResearchQuestion({
      question: "How should the quarterly budget freeze affect our roadmap?",
      privateTexts: ["The quarterly budget freeze affects the internal roadmap."],
      privatePhraseTexts: ["The quarterly budget freeze affects the internal roadmap."],
    });
    expect(result.status).toBe("generalized");
    if (result.status === "generalized") {
      expect(result.outboundQuestion).not.toContain("quarterly budget freeze");
      expect(result.redacted).toBe(true);
    }
  });

  it("requires approval when private details are necessary or redaction is too vague", () => {
    expect(
      inspectResearchQuestion({
        question: "What did Maya Chen earn at Northstar Labs?",
        privateTexts: privateContext,
      }).status,
    ).toBe("approval_required");
    expect(
      inspectResearchQuestion({
        question: "Find Maya Chen",
        privateTexts: privateContext,
        requiresPrivateDisclosure: true,
      }),
    ).toEqual({ status: "approval_required", reason: "explicit_private_details" });
  });

  it("redacts direct identifiers even when they were not found in notes", () => {
    expect(
      inspectResearchQuestion({
        question: "Find public information for a.person@example.test",
        privateTexts: [],
      }).status,
    ).toBe("approval_required");
    expect(
      inspectResearchQuestion({
        question: "What are public best practices for 555-010-0199?",
        privateTexts: [],
      }),
    ).toMatchObject({ status: "generalized", redacted: true });
  });

  it("fails closed when the private context cannot be inspected", () => {
    expect(
      inspectResearchQuestion({
        question: "What are public research methods?",
        privateTexts: [],
        contextUncertain: true,
      }),
    ).toEqual({ status: "approval_required", reason: "not_usefully_generalized" });
  });
});
