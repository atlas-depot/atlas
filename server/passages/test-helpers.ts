import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { notePassageProjectionSchema, type PassageIssue } from "../../shared/passages.ts";
import { projectNotePassages } from "../passages.ts";

export const noteId = "d777e778-3a1f-4d64-a924-194320ad023a";

export const version = `"${noteId}:3"`;

export const text = (value: string) => ({ type: "text", text: value, styles: {} });

export const paragraph = (id: string, value: string, children: unknown[] = []) => ({
  id,
  type: "paragraph",
  props: {},
  content: [text(value)],
  children,
});

export const heading = (id: string, value: string, level = 1, children: unknown[] = []) => ({
  id,
  type: "heading",
  props: { level },
  content: [text(value)],
  children,
});

export const bullet = (id: string, value: string, children: unknown[] = []) => ({
  id,
  type: "bulletListItem",
  props: {},
  content: [text(value)],
  children,
});

export const numbered = (id: string, value: string, start?: number, children: unknown[] = []) => ({
  id,
  type: "numberedListItem",
  props: start === undefined ? {} : { start },
  content: [text(value)],
  children,
});

export const check = (id: string, value: string, checked: boolean, children: unknown[] = []) => ({
  id,
  type: "checkListItem",
  props: { checked },
  content: [text(value)],
  children,
});

export const quote = (id: string, value: string) => ({
  id,
  type: "quote",
  props: {},
  content: [text(value)],
  children: [],
});

export const code = (id: string, value: string, language = "ts") => ({
  id,
  type: "codeBlock",
  props: { language },
  content: [text(value)],
  children: [],
});

export const divider = (id: string) => ({ id, type: "divider", props: {}, children: [] });

export const cell = (value: string, props: Record<string, unknown> = {}) => ({
  type: "tableCell",
  props,
  content: [text(value)],
});

export const table = (id: string, rows: unknown[][], columns = rows[0]?.length ?? 1) => ({
  id,
  type: "table",
  props: {},
  content: {
    type: "tableContent",
    columnWidths: Array.from({ length: columns }, () => 120),
    rows: rows.map((cells) => ({ cells })),
  },
  children: [],
});

export const document = (blocks: unknown[]) => ({
  format: "blocknote",
  schemaVersion: 1,
  blocks,
});

export function project(content: unknown) {
  const result = projectNotePassages({ noteId, version, content });
  return notePassageProjectionSchema.parse(result);
}

export function texts(result: ReturnType<typeof project>): string[] {
  return result.passages.map((passage) => passage.text);
}

export function issues(result: ReturnType<typeof project>): PassageIssue[] {
  if (!("issues" in result)) throw new Error("Expected projection issues");
  return result.issues;
}

export function fixture(name: string): string {
  return readFileSync(
    fileURLToPath(new URL(`../../fixtures/passages/${name}`, import.meta.url)),
    "utf8",
  );
}
