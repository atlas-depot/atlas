import { describe, expect, it } from "vite-plus/test";
import { findMarkdownTableDelimiterWarnings } from "./markdown-table-diagnostics";

const figure7 = [
  "## Evaluation set",
  "",
  "Set aside time for a trial run before collecting results.",
  "",
  "| Task | Status |",
  "| --- |",
  "| Check sources | Open |",
  "",
  "## Review checklist",
  "",
  "- Check each answer against its source.",
  "",
  "## Example check",
  "",
  "```text",
  "within_target = result_rank <= 3",
  "```",
  "",
  "Source: [Meeting agenda](https://example.com/meeting-agenda)",
  "",
  "## Table source example",
  "",
  "```markdown",
  "| Task | Status |",
  "| --- |",
  "| Check sources | Open |",
  "```",
].join("\n");

describe("Markdown table delimiter diagnostics", () => {
  it("names the missing delimiter cell in Figure 7 and ignores the fenced copy", () => {
    expect(findMarkdownTableDelimiterWarnings(figure7)).toEqual([
      {
        headerCells: 2,
        delimiterCells: 1,
        summary: "Table needs two delimiter cells. The second one is missing.",
        suggestionLabel: "Add the missing cell:",
        suggestedRow: "| --- | --- |",
      },
    ]);
  });

  it("accepts a valid table", () => {
    expect(
      findMarkdownTableDelimiterWarnings(
        "| Task | Status |\n| --- | --- |\n| Check sources | Done |",
      ),
    ).toEqual([]);
  });

  it("does not report extra delimiter cells or a missing delimiter row", () => {
    expect(
      findMarkdownTableDelimiterWarnings("| Task |\n| --- | --- |\n| Check sources |"),
    ).toEqual([]);
    expect(
      findMarkdownTableDelimiterWarnings("| Task | Status |\n| Check sources | Open |"),
    ).toEqual([]);
  });

  it("ignores fenced, indented and raw HTML examples", () => {
    const examples = [
      "```markdown\n| Task | Status |\n| --- |\n| Check sources | Open |\n```",
      "~~~markdown\n| Task | Status |\n| --- |\n| Check sources | Open |\n~~~",
      "````markdown\n```\n| Task | Status |\n| --- |\n```\n````",
      "    | Task | Status |\n    | --- |",
      "<div>\n| Task | Status |\n| --- |\n</div>",
    ];
    for (const example of examples) {
      expect(findMarkdownTableDelimiterWarnings(example)).toEqual([]);
    }
  });

  it("ignores an unclosed fence", () => {
    expect(findMarkdownTableDelimiterWarnings("```markdown\n| Task | Status |\n| --- |")).toEqual(
      [],
    );
  });

  it("counts escaped pipes without losing cells", () => {
    expect(findMarkdownTableDelimiterWarnings("| A \\| B | C |\n| --- |")).toHaveLength(1);
    expect(findMarkdownTableDelimiterWarnings("| A \\\\| B |\n| --- |")).toHaveLength(1);
    expect(findMarkdownTableDelimiterWarnings("| A \\| B \\|\n| --- |")).toEqual([]);
  });

  it("reports multiple missing cells with bounded wording", () => {
    expect(findMarkdownTableDelimiterWarnings("| A | B | C |\n| --- |")).toEqual([
      {
        headerCells: 3,
        delimiterCells: 1,
        summary: "Table needs three delimiter cells. The second and third ones are missing.",
        suggestionLabel: "Add the missing cells:",
        suggestedRow: "| --- | --- | --- |",
      },
    ]);
  });

  it("preserves existing delimiter alignment in the suggested row", () => {
    expect(
      findMarkdownTableDelimiterWarnings("| A | B | C |\n| :--- | ---: |\n| 1 | 2 | 3 |"),
    ).toEqual([
      {
        headerCells: 3,
        delimiterCells: 2,
        summary: "Table needs three delimiter cells. The third one is missing.",
        suggestionLabel: "Add the missing cell:",
        suggestedRow: "| :--- | ---: | --- |",
      },
    ]);
  });

  it("recognizes a centered delimiter cell with or without outer pipes", () => {
    for (const source of ["| A | B |\n| :---: |", "| A | B |\n:---:"]) {
      expect(findMarkdownTableDelimiterWarnings(source)).toEqual([
        {
          headerCells: 2,
          delimiterCells: 1,
          summary: "Table needs two delimiter cells. The second one is missing.",
          suggestionLabel: "Add the missing cell:",
          suggestedRow: "| :---: | --- |",
        },
      ]);
    }
  });

  it("does not treat a setext heading or thematic break as a missing delimiter", () => {
    expect(findMarkdownTableDelimiterWarnings("Use the pipe | symbol\n---")).toEqual([]);
    expect(findMarkdownTableDelimiterWarnings("Use the pipe | symbol\n:---:")).toEqual([]);
    expect(findMarkdownTableDelimiterWarnings("| A | B |\n---")).toEqual([]);
  });

  const ordinalCases: Array<[number, string]> = [
    [13, "13th"],
    [21, "21st"],
    [22, "22nd"],
    [23, "23rd"],
    [24, "24th"],
  ];

  it.each(ordinalCases)("uses the correct ordinal suffix for column %i", (columns, ordinal) => {
    const header = `| ${Array.from({ length: columns }, (_, index) => `H${index + 1}`).join(" | ")} |`;
    const delimiter = `| ${Array.from({ length: columns - 1 }, () => "---").join(" | ")} |`;
    const [warning] = findMarkdownTableDelimiterWarnings(`${header}\n${delimiter}`);
    expect(warning?.summary).toContain(`The ${ordinal} one is missing.`);
  });

  it("handles CRLF and multiple malformed tables", () => {
    const source = ["| A | B |", "| --- |", "", "| C | D | E |", "| --- |"].join("\r\n");
    expect(findMarkdownTableDelimiterWarnings(source)).toHaveLength(2);
  });

  it("leaves nested tables and unrelated Markdown alone", () => {
    expect(findMarkdownTableDelimiterWarnings("> | A | B |\n> | --- |")).toEqual([]);
    expect(findMarkdownTableDelimiterWarnings("- A | B\n  - C | D")).toEqual([]);
    expect(findMarkdownTableDelimiterWarnings("")).toEqual([]);
  });
});
