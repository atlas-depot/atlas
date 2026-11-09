import {
  MAX_HEADING_PATH_CHARS,
  type NotePassage,
  type NotePassageProjection,
  type PassageIssue,
} from "../../shared/passages.ts";
import { isMeaningful, graphemeBoundaries } from "./split.ts";

const MAX_PASSAGES = 1_000;

const MAX_ISSUES = 100;

export type SourceBase = { noteId: string; version: string };

export type Heading = { level: number; text: string };

type MalformedReason = Extract<PassageIssue, { code: "malformed_content" }>["reason"];

export type ProjectionState = {
  passages: NotePassage[];
  issues: PassageIssue[];
  passageLimit: boolean;
  issueLimit: boolean;
};

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function indentLine(line: string): string {
  return line.length > 0 ? `  ${line}` : line;
}

export type PassageLine = { text: string; indent: boolean };

export function passageLines(text: string, indent: boolean): PassageLine[] {
  return text.split("\n").map((line) => ({ text: line, indent }));
}

export function passageText(lines: PassageLine[]): string {
  return lines.map((line) => line.text).join("\n");
}

export function indentPassageLines(lines: PassageLine[]): PassageLine[] {
  return lines.map((line) =>
    line.indent && line.text.length > 0 ? { text: `  ${line.text}`, indent: true } : line,
  );
}

export function createState(): ProjectionState {
  return { passages: [], issues: [], passageLimit: false, issueLimit: false };
}

export function addIssue(state: ProjectionState, issue: PassageIssue): void {
  if (state.issues.length >= MAX_ISSUES) {
    if (!state.issueLimit) {
      state.issueLimit = true;
      state.issues.push({ code: "issue_limit" });
    }
    return;
  }
  state.issues.push(issue);
}

export function addPassage(
  state: ProjectionState,
  text: string,
  source: NotePassage["source"],
  allowBlank = false,
): boolean {
  if (text.length === 0 || (!allowBlank && !isMeaningful(text))) return true;
  if (state.passages.length >= MAX_PASSAGES) {
    if (!state.passageLimit) {
      state.passageLimit = true;
      state.issues.push({ code: "passage_limit" });
    }
    return false;
  }
  state.passages.push({ text, source });
  return true;
}

export function malformed(reason: MalformedReason): NotePassageProjection {
  return {
    status: "malformed",
    passages: [],
    issues: [{ code: "malformed_content", reason }],
  };
}

export function unsupported(issue: PassageIssue): NotePassageProjection {
  return { status: "unsupported", passages: [], issues: [issue] };
}

export function finalize(state: ProjectionState): NotePassageProjection {
  if (state.passages.length > 0) {
    return state.issues.length > 0
      ? { status: "partial", passages: state.passages, issues: state.issues }
      : { status: "complete", passages: state.passages };
  }
  return state.issues.length > 0
    ? { status: "unsupported", passages: [], issues: state.issues }
    : { status: "empty", passages: [] };
}

export function updateHeadingPath(path: Heading[], level: number, text: string): Heading[] {
  const next = path.slice();
  while (next.length > 0 && next[next.length - 1].level >= level) next.pop();
  next.push({ level, text });
  return next;
}

function truncateHeadingPath(text: string): string {
  if (text.length <= MAX_HEADING_PATH_CHARS) return text;
  const boundaries = graphemeBoundaries(text);
  let end = 0;
  for (const boundary of boundaries) {
    if (boundary > MAX_HEADING_PATH_CHARS) break;
    end = boundary;
  }
  if (end > 0) return text.slice(0, end);
  // A single grapheme longer than the cap cannot be truncated without corruption.
  return "";
}

export function headingTexts(path: Heading[]): string[] {
  return path.map((heading) => truncateHeadingPath(heading.text));
}

export function cleanCell(text: string): string {
  return text.replace(/\s*\n\s*/g, " ").trim();
}

export function formatOwnText(marker: string, text: string): string {
  if (!marker || !isMeaningful(text)) return text;
  const lines = text.split("\n");
  return [marker + lines[0], ...lines.slice(1).map(indentLine)].join("\n");
}
