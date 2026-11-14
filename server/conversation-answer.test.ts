import { expect, it } from "vite-plus/test";
import type { NotePassageSource } from "../shared/passages.ts";
import {
  evidenceId,
  readResearchEvidence,
  readSearchEvidence,
  resolveAnswer,
} from "./conversation-answer.ts";

const source: NotePassageSource = {
  kind: "block",
  noteId: "389e1044-164c-4931-b054-0384d66b9523",
  version: '"389e1044-164c-4931-b054-0384d66b9523:1"',
  blockId: "meeting-block",
  headingPath: [],
};
const evidence = [{ id: evidenceId(source), text: "Meeting at the library at 14:00.", source }];
const answer = (citations: unknown[], status = "completed") => ({
  status,
  text: "It is at 14:00.",
  citations,
});

it("publishes the server's own source record for a citation that quotes retrieved text exactly", () => {
  expect(
    resolveAnswer(answer([{ passageId: evidence[0]!.id, excerpt: "library at 14:00" }]), evidence),
  ).toEqual({
    ok: true,
    answer: {
      status: "completed",
      text: "It is at 14:00.",
      citations: [{ source, excerpt: "library at 14:00", deleted: false }],
    },
  });
});

it("validates public citations separately and returns the provider's web source record", () => {
  const webSource = {
    kind: "web" as const,
    url: "https://example.test/release",
    title: "Official release",
    retrievedAt: "2026-11-13T12:00:00.000Z",
  };
  const webPassage = {
    id: evidenceId(webSource),
    text: "The release is on 14 October.",
    source: webSource,
  };
  expect(
    resolveAnswer(answer([{ passageId: webPassage.id, excerpt: "release is on 14 October" }]), [
      webPassage,
    ]),
  ).toEqual({
    ok: true,
    answer: {
      status: "completed",
      text: "It is at 14:00.",
      citations: [
        {
          source: webSource,
          excerpt: "release is on 14 October",
          deleted: false,
        },
      ],
    },
  });
  expect(
    readResearchEvidence({
      status: "completed",
      question: "What is the release date?",
      text: webPassage.text,
      sources: [{ id: "p_0000000000000000", source: webSource, snippet: webPassage.text }],
    }),
  ).toBeUndefined();
  expect(readResearchEvidence({ status: "not_performed", reason: "denied" })).toEqual({
    status: "not_performed",
    reason: "denied",
  });
});

it("binds a web excerpt to its own provider-attributed snippet, not the research summary", () => {
  const webSource = {
    kind: "web" as const,
    url: "https://example.test/release",
    title: "Official release",
    retrievedAt: "2026-11-13T12:00:00.000Z",
  };
  const id = evidenceId(webSource);
  const research = readResearchEvidence({
    status: "completed",
    question: "What is the release date?",
    text: "The summary says the release is on 14 October.",
    sources: [{ id, source: webSource, snippet: "Official notice: 14 October release." }],
  });
  expect(research).toEqual({
    status: "completed",
    evidence: [{ id, text: "Official notice: 14 October release.", source: webSource }],
  });
  if (research?.status !== "completed") throw new Error("Expected recorded research evidence.");
  expect(
    resolveAnswer(
      answer([{ passageId: id, excerpt: "summary says the release" }]),
      research.evidence,
    ),
  ).toEqual({ ok: false, reason: "excerpt_mismatch" });
  expect(
    resolveAnswer(answer([{ passageId: id, excerpt: "14 October release" }]), research.evidence),
  ).toMatchObject({ ok: true, answer: { status: "completed" } });
});

it("rejects a well-formed citation of a passage this attempt never retrieved", () => {
  const foreign = evidenceId({ ...source, noteId: "eb48a657-9f15-4da4-8fbc-54cb775da632" });
  expect(resolveAnswer(answer([{ passageId: foreign, excerpt: "library" }]), evidence)).toEqual({
    ok: false,
    reason: "unknown_source",
  });
});

it("rejects an excerpt the cited passage does not contain", () => {
  expect(
    resolveAnswer(answer([{ passageId: evidence[0]!.id, excerpt: "library at 15:00" }]), evidence),
  ).toEqual({ ok: false, reason: "excerpt_mismatch" });
});

it.each([
  ["a completed answer without citations", answer([])],
  [
    "a no-support answer carrying citations",
    answer([{ passageId: evidence[0]!.id, excerpt: "library" }], "no-support"),
  ],
  ["an unknown field", { ...answer([]), status: "no-support", tool: "research" }],
  ["plain text", "It is at 14:00."],
])("rejects %s as malformed", (_name, result) => {
  expect(resolveAnswer(result, evidence)).toEqual({ ok: false, reason: "malformed_result" });
});

it("keeps no-support distinct and free of sources", () => {
  expect(resolveAnswer(answer([], "no-support"), evidence)).toEqual({
    ok: true,
    answer: { status: "no-support", text: "It is at 14:00.", citations: [] },
  });
});

it("recomputes passage identity from the recorded source instead of trusting a returned id", () => {
  expect(
    readSearchEvidence({ passages: [{ id: "p_0000000000000000", text: "Text", source }] }),
  ).toEqual([{ id: evidenceId(source), text: "Text", source }]);
  expect(readSearchEvidence({ passages: [{ id: "x", text: "Text" }] })).toBeUndefined();
});
