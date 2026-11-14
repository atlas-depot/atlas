import { describe, expect, it } from "vite-plus/test";
import { inspectResearchQuestion } from "./research-disclosure.ts";

const privateContext = [
  "Maya Chen works at Northstar Labs. Her salary is $148,000 and her email is maya@example.test.",
];

describe("public research disclosure boundary", () => {
  it("lets a query with no private overlap leave without approval", () => {
    expect(
      inspectResearchQuestion({
        question: "What are current public-company practices for employee onboarding?",
        privateTexts: privateContext,
      }),
    ).toEqual({
      status: "generalized",
      outboundQuestion: "What are current public-company practices for employee onboarding?",
    });
  });

  it("keeps ordinary public years and dates out of the identifier rule", () => {
    expect(
      inspectResearchQuestion({
        question: "What public exhibitions opened in 2026?",
        privateTexts: ["Our planning note for 2026-11-13 is private."],
      }).status,
    ).toBe("generalized");
  });

  it("requires approval for any distinctive token copied from notes or history", () => {
    expect(
      inspectResearchQuestion({
        question: "What are public speaking best practices for Maya Chen at Northstar Labs?",
        privateTexts: privateContext,
      }),
    ).toEqual({ status: "approval_required", reason: "private_context_overlap" });
    expect(
      inspectResearchQuestion({
        question: "How should the quarterly budget freeze affect our roadmap?",
        privateTexts: ["The quarterly budget\nfreeze affects the internal roadmap."],
      }),
    ).toEqual({ status: "approval_required", reason: "private_context_overlap" });
  });

  it("detects lowercase names, short names and uncased scripts", () => {
    for (const [question, text] of [
      ["jane okafor acme layoffs severance", "met jane okafor from acme re layoffs"],
      ["Li public profile", "Li Wei is a private contact."],
      ["肝癌治疗", "张三患有肝癌。"],
      ["محمد", "محمد علي شخص خاص."],
    ] as const)
      expect(inspectResearchQuestion({ question, privateTexts: [text] }).status).toBe(
        "approval_required",
      );
  });

  it("detects a private URL without rewriting part of it", () => {
    expect(
      inspectResearchQuestion({
        question: "What does https://internal.example.com/secret/roadmap say about planning?",
        privateTexts: ["Internal dashboard: https://internal.example.com/secret/roadmap"],
      }),
    ).toEqual({ status: "approval_required", reason: "private_context_overlap" });
  });

  it("preserves URL identity when every label is a single character", () => {
    expect(
      inspectResearchQuestion({
        question: "What does https://a.b.c/d say?",
        privateTexts: ["Private link: https://a.b.c/d"],
      }),
    ).toEqual({ status: "approval_required", reason: "private_context_overlap" });
  });

  it("detects a four-word phrase without leaving its tail", () => {
    expect(
      inspectResearchQuestion({
        question: "What public projects use alpha bravo charlie delta?",
        privateTexts: ["The internal codename is alpha bravo charlie delta."],
      }),
    ).toEqual({ status: "approval_required", reason: "private_context_overlap" });
  });

  it("splits Turkish apostrophe suffixes before comparing terms", () => {
    expect(
      inspectResearchQuestion({
        question: "Ahmet Yılmaz Hacettepe karaciğer kanseri tedavi",
        privateTexts: ["Ahmet'in babası Yılmaz'a Hacettepe'de tedavi görüyor."],
      }),
    ).toEqual({ status: "approval_required", reason: "private_context_overlap" });
  });

  it("screens this turn's input as transcript context", () => {
    expect(
      inspectResearchQuestion({
        question: "What public companies use bluebird horizon project?",
        privateTexts: ["Our internal codename is bluebird horizon project."],
      }),
    ).toEqual({ status: "approval_required", reason: "private_context_overlap" });
  });

  it("normalizes NFD and Turkish dotted/dotless I before comparison", () => {
    expect(
      inspectResearchQuestion({
        question: "şirket içi plan",
        privateTexts: ["S\u0327irket I\u0307c\u0327i plan"],
      }).status,
    ).toBe("approval_required");
  });

  it("catches identifiers embedded in labels instead of relying on ASCII word boundaries", () => {
    expect(
      inspectResearchQuestion({
        question: "Find public records for account_1234",
        privateTexts: [],
      }),
    ).toEqual({ status: "approval_required", reason: "direct_identifier" });
    expect(
      inspectResearchQuestion({
        question: "Find public reports for FY2026",
        privateTexts: [],
      }).status,
    ).toBe("generalized");
  });

  it("matches names whose punctuation differs between notes and the query", () => {
    expect(
      inspectResearchQuestion({
        question: "What did DAngelo publish?",
        privateTexts: ["D'Angelo is a private contact."],
      }),
    ).toEqual({ status: "approval_required", reason: "private_context_overlap" });
  });

  it("does not let a one-character non-Latin term hide inside a longer query token", () => {
    expect(
      inspectResearchQuestion({
        question: "What is 张伟 known for?",
        privateTexts: ["The private codename is 张."],
      }),
    ).toEqual({ status: "approval_required", reason: "private_context_overlap" });
  });

  it("requires approval for direct identifiers even without private context", () => {
    for (const question of [
      "Find public information for a.person@example.test",
      "Find public information for user@example.рф",
      "Who owns 550e8400-e29b-41d4-a716-446655440000?",
      "Who owns id_deadbeef-dead-41d4-a716-deadbeefcafe?",
      "Find 0532 123 45 67 online",
      "Find 4111 1111 1111 1111 online",
      "Find TR33 0006 1005 1978 6457 8413 26 online",
      "Find public records for 1234",
      "Find public records for １２３４",
      "Find +٩٠ ٥٣٢ ١٢٣ ٤٥ ٦٧ online",
    ])
      expect(inspectResearchQuestion({ question, privateTexts: [] })).toEqual({
        status: "approval_required",
        reason: "direct_identifier",
      });
  });

  it("screens Unicode-digit identifiers even when private context contains the same digits", () => {
    expect(
      inspectResearchQuestion({
        question: "Find +٩٠ ٥٣٢ ١٢٣ ٤٥ ٦٧ online",
        privateTexts: ["My phone number is +٩٠ ٥٣٢ ١٢٣ ٤٥ ٦٧."],
      }),
    ).toEqual({ status: "approval_required", reason: "direct_identifier" });
  });

  it("honors explicit escalation and uncertain context", () => {
    expect(
      inspectResearchQuestion({
        question: "Find public news about this topic",
        privateTexts: [],
        requiresPrivateDisclosure: true,
      }),
    ).toEqual({ status: "approval_required", reason: "explicit_private_details" });
    expect(
      inspectResearchQuestion({
        question: "What are public research methods?",
        privateTexts: [],
        contextUncertain: true,
      }),
    ).toEqual({ status: "approval_required", reason: "context_unavailable" });
  });
});
