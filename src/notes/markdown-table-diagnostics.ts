import { markdownParser } from "./markdown-ast";

type MarkdownNode = {
  type: string;
  position?: {
    start: { offset?: number };
    end: { offset?: number };
  };
  children?: MarkdownNode[];
};

export type MarkdownTableDelimiterWarning = {
  headerCells: number;
  delimiterCells: number;
  summary: string;
  suggestionLabel: string;
  suggestedRow: string;
};

const delimiterCellPattern = /^:?-+:?$/;
const pipeWrappedHeaderPattern = /^\s*\|.*\|\s*$/;
const numberWords: Record<number, string> = {
  1: "one",
  2: "two",
  3: "three",
  4: "four",
  5: "five",
  6: "six",
  7: "seven",
  8: "eight",
  9: "nine",
  10: "ten",
};
const ordinalWords: Record<number, string> = {
  1: "first",
  2: "second",
  3: "third",
  4: "fourth",
  5: "fifth",
  6: "sixth",
  7: "seventh",
  8: "eighth",
  9: "ninth",
  10: "tenth",
  11: "eleventh",
  12: "twelfth",
};

function numberWord(value: number) {
  return numberWords[value] ?? String(value);
}

function ordinalWord(value: number) {
  const named = ordinalWords[value];
  if (named) return named;
  const lastTwo = value % 100;
  if (lastTwo >= 11 && lastTwo <= 13) return `${value}th`;
  const suffix = ["th", "st", "nd", "rd"][value % 10] ?? "th";
  return `${value}${suffix}`;
}

function listWords(values: string[]) {
  if (values.length === 0) return "";
  if (values.length === 1) return values[0];
  return `${values.slice(0, -1).join(", ")} and ${values[values.length - 1]}`;
}

/** Split one GFM table row into cells. An odd number of backslashes keeps a pipe literal. */
function splitRow(line: string) {
  const cells: string[] = [];
  let current = "";
  let backslashes = 0;
  for (const character of line.trim()) {
    if (character === "\\") {
      current += character;
      backslashes += 1;
      continue;
    }
    if (character === "|" && backslashes % 2 === 0) {
      cells.push(current.trim());
      current = "";
    } else {
      current += character;
    }
    backslashes = 0;
  }
  cells.push(current.trim());
  // Optional outer pipes produce empty edge segments. Interior empty cells remain.
  if (cells[0] === "") cells.shift();
  if (cells.length > 0 && cells[cells.length - 1] === "") cells.pop();
  return cells;
}

function isDelimiterRow(line: string, headerLine: string) {
  if (!line.includes("|")) {
    // A pipe-less row is ambiguous with a setext heading or thematic break. Only
    // accept an explicit alignment marker under a pipe-wrapped header row.
    if (!line.includes(":") || !pipeWrappedHeaderPattern.test(headerLine)) return false;
  }
  const cells = splitRow(line);
  return cells.length > 0 && cells.every((cell) => delimiterCellPattern.test(cell));
}

function missingSentence(firstMissing: number, missing: number) {
  const ordinals = Array.from({ length: missing }, (_, index) => ordinalWord(firstMissing + index));
  const listed = listWords(ordinals.slice(0, 3));
  if (missing === 1) return `The ${listed} one is missing.`;
  if (missing <= 3) return `The ${listed} ones are missing.`;
  const remaining = missing - 3;
  return `The ${listed} ones are missing, along with ${remaining} more ${
    remaining === 1 ? "cell" : "cells"
  }.`;
}

function createWarning(
  headerCells: number,
  delimiterCellTexts: string[],
): MarkdownTableDelimiterWarning {
  const delimiterCells = delimiterCellTexts.length;
  const missing = headerCells - delimiterCells;
  const suggestedCells = [...delimiterCellTexts, ...Array.from({ length: missing }, () => "---")];
  return {
    headerCells,
    delimiterCells,
    summary: `Table needs ${numberWord(headerCells)} delimiter ${
      headerCells === 1 ? "cell" : "cells"
    }. ${missingSentence(delimiterCells + 1, missing)}`,
    suggestionLabel: missing === 1 ? "Add the missing cell:" : "Add the missing cells:",
    suggestedRow: `| ${suggestedCells.join(" | ")} |`,
  };
}

/**
 * Find top-level table-like blocks whose delimiter row has fewer cells than the header
 * row. Fenced, indented and raw HTML blocks are separate AST nodes, so their examples
 * never produce a warning. Tables nested in blockquotes or lists are outside this editor
 * diagnostic. A parse failure leaves the source unchanged.
 */
export function findMarkdownTableDelimiterWarnings(
  source: string,
): MarkdownTableDelimiterWarning[] {
  if (!source.includes("|") || !source.includes("-")) return [];
  let tree: MarkdownNode;
  try {
    tree = markdownParser.parse(source) as MarkdownNode;
  } catch {
    return [];
  }
  const warnings: MarkdownTableDelimiterWarning[] = [];
  for (const node of tree.children ?? []) {
    if (node.type !== "paragraph") continue;
    const start = node.position?.start.offset;
    const end = node.position?.end.offset;
    if (typeof start !== "number" || typeof end !== "number" || end <= start) continue;
    const lines = source.slice(start, end).split(/\r?\n/);
    for (let index = 0; index + 1 < lines.length; index++) {
      const headerLine = lines[index];
      const delimiterLine = lines[index + 1];
      if (!headerLine.includes("|") || !isDelimiterRow(delimiterLine, headerLine)) continue;
      const headerCells = splitRow(headerLine).length;
      const delimiterCellTexts = splitRow(delimiterLine);
      if (headerCells > delimiterCellTexts.length && delimiterCellTexts.length > 0) {
        warnings.push(createWarning(headerCells, delimiterCellTexts));
      }
    }
  }
  return warnings;
}
