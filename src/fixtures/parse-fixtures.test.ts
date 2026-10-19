import { describe, expect, it } from "vite-plus/test";

import emptyExampleText from "../../fixtures/briefing/empty-example.json?raw";
import expectedText from "../../fixtures/briefing/expected.json?raw";
import malformedMissingAuthorText from "../../fixtures/briefing/malformed-missing-author.json?raw";
import validExampleText from "../../fixtures/briefing/valid-example.json?raw";
import { type BriefingExample, parseFixtures } from "./parse-fixtures";

type Path = Array<string | number>;

type ExpectedLink = {
  referenceIndex: number;
  targetId: string;
  content: string;
  origin: Record<string, string>;
};

type Oracle = {
  "valid-example.json": {
    sourceCount: number;
    briefingItemCount: number;
    briefingItems: Array<{ index: number; text: string; links: ExpectedLink[] }>;
  };
  "malformed-missing-author.json": { issues: Array<{ path: Path }> };
};

const oracle: Oracle = JSON.parse(expectedText);
const validExample: unknown = JSON.parse(validExampleText);

function withField(path: Path, value: unknown): unknown {
  const copy: unknown = structuredClone(validExample);
  const key = path[path.length - 1];
  let parent = copy as Record<string | number, unknown>;
  for (const segment of path.slice(0, -1)) {
    parent = parent[segment] as Record<string | number, unknown>;
  }
  if (value === undefined) {
    delete parent[key];
  } else {
    parent[key] = value;
  }
  return copy;
}

function issuePaths(input: unknown): Path[] {
  const result = parseFixtures(input);
  return result.success ? [] : result.issues.map((issue) => issue.path);
}

const invalidCases: Array<[string, unknown, Path]> = [
  ["missing input", undefined, []],
  ["null input", null, []],
  ["a bare root array", [], []],
  ["blank source content", withField(["sources", 0, "content"], "   "), ["sources", 0, "content"]],
  ["empty source content", withField(["sources", 0, "content"], ""), ["sources", 0, "content"]],
  ["non-text source content", withField(["sources", 0, "content"], 7), ["sources", 0, "content"]],
  ["non-text source id", withField(["sources", 0, "id"], 1), ["sources", 0, "id"]],
  ["an unknown source kind", withField(["sources", 0, "kind"], "web_page"), ["sources", 0, "kind"]],
  [
    "a missing source author",
    withField(["sources", 1, "source", "author"], undefined),
    ["sources", 1, "source", "author"],
  ],
  [
    "a blank source author",
    withField(["sources", 1, "source", "author"], " "),
    ["sources", 1, "source", "author"],
  ],
  [
    "a timestamp without timezone",
    withField(["sources", 1, "source", "sentAt"], "2026-10-16T09:00:00"),
    ["sources", 1, "source", "sentAt"],
  ],
  [
    "a timestamp that is not a calendar date",
    withField(["sources", 1, "source", "sentAt"], "2026-02-31T09:00:00Z"),
    ["sources", 1, "source", "sentAt"],
  ],
  [
    "a duplicate source id",
    withField(["sources", 2], { id: "note-1", kind: "user_note", content: "Duplicate note." }),
    ["sources", 2, "id"],
  ],
  [
    "an unknown source reference",
    withField(["briefing", "items", 0, "sourceIds", 1], "missing-1"),
    ["briefing", "items", 0, "sourceIds", 1],
  ],
  [
    "blank briefing text",
    withField(["briefing", "items", 0, "text"], "  "),
    ["briefing", "items", 0, "text"],
  ],
  [
    "missing source references",
    withField(["briefing", "items", 0, "sourceIds"], undefined),
    ["briefing", "items", 0, "sourceIds"],
  ],
  [
    "empty source references",
    withField(["briefing", "items", 0, "sourceIds"], []),
    ["briefing", "items", 0, "sourceIds"],
  ],
  ["an unknown field", withField(["sources", 0, "extra"], true), ["sources", 0]],
];

describe("parseFixtures", () => {
  it("accepts the valid example and returns its content unchanged", () => {
    expect(parseFixtures(validExample)).toEqual({ success: true, data: validExample });
  });

  it("resolves each briefing reference to the expected source record", () => {
    const result = parseFixtures(validExample);
    if (!result.success) {
      throw new Error("The valid example must parse.");
    }
    const expected = oracle["valid-example.json"];
    const { sources, briefing }: BriefingExample = result.data;
    expect(sources).toHaveLength(expected.sourceCount);
    expect(briefing.items).toHaveLength(expected.briefingItemCount);
    const links = briefing.items.map((item, index) => ({
      index,
      text: item.text,
      links: item.sourceIds.map((targetId, referenceIndex) => {
        const source = sources.find((candidate) => candidate.id === targetId);
        if (!source) {
          throw new Error(`Unresolved reference ${targetId}.`);
        }
        const origin =
          source.kind === "external_message"
            ? { kind: source.kind, author: source.source.author, sentAt: source.source.sentAt }
            : { kind: source.kind };
        return { referenceIndex, targetId, content: source.content, origin };
      }),
    }));
    expect(links).toEqual(expected.briefingItems);
  });

  it("accepts the empty example", () => {
    expect(parseFixtures(JSON.parse(emptyExampleText))).toEqual({
      success: true,
      data: { sources: [], briefing: { items: [] } },
    });
  });

  it("rejects the malformed example at the path named by the oracle", () => {
    expect(issuePaths(JSON.parse(malformedMissingAuthorText))).toEqual(
      oracle["malformed-missing-author.json"].issues.map((issue) => issue.path),
    );
  });

  it("accepts timestamps with an explicit UTC offset", () => {
    const input = withField(["sources", 1, "source", "sentAt"], "2026-10-16T12:00:00+03:00");
    expect(parseFixtures(input).success).toBe(true);
  });

  it("allows source records that no briefing item references", () => {
    const input = withField(["sources", 2], {
      id: "note-2",
      kind: "user_note",
      content: "Unused note.",
    });
    expect(parseFixtures(input).success).toBe(true);
  });

  it("rejects references that have no source records to resolve against", () => {
    expect(issuePaths(withField(["sources"], []))).toEqual([
      ["briefing", "items", 0, "sourceIds", 0],
      ["briefing", "items", 0, "sourceIds", 1],
    ]);
  });

  it.each(invalidCases)(
    "rejects %s with exactly one issue at the field path",
    (_name, input, path) => {
      expect(issuePaths(input)).toEqual([path]);
    },
  );
});
