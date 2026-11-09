import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { noteTextSchema } from "../../shared/document.ts";
import { type NotePassage, type NotePassageProjection } from "../../shared/passages.ts";
import { MAX_PASSAGE_CHARS, isMeaningful, splitProse, splitLines } from "./split.ts";
import {
  type SourceBase,
  type Heading,
  type ProjectionState,
  indentLine,
  type PassageLine,
  passageLines,
  passageText,
  indentPassageLines,
  createState,
  addIssue,
  addPassage,
  malformed,
  finalize,
  updateHeadingPath,
  headingTexts,
  cleanCell,
  formatOwnText,
} from "./common.ts";

const MAX_MARKDOWN_DEPTH = 96;

const markdownParser = unified().use(remarkParse).use(remarkGfm).freeze();

class MarkdownProjectionError extends Error {}

type MdastNode = {
  type: string;
  position?: {
    start: { offset?: number };
    end: { offset?: number };
  };
  value?: string;
  children?: MdastNode[];
  ordered?: boolean;
  start?: number | null;
  checked?: boolean | null;
  depth?: number;
};

type MarkdownUnit = {
  kind:
    | "paragraph"
    | "heading"
    | "code"
    | "table"
    | "list"
    | "listItem"
    | "blockquote"
    | "structural";
  ownText: string;
  ownIndent: boolean;
  ownLines: PassageLine[];
  marker: string;
  headingPath: string[];
  startOffset: number;
  endOffset: number;
  children: MarkdownUnit[];
};

function markdownPosition(node: MdastNode): { startOffset: number; endOffset: number } {
  const startOffset = node.position?.start.offset;
  const endOffset = node.position?.end.offset;
  if (
    typeof startOffset !== "number" ||
    typeof endOffset !== "number" ||
    !Number.isInteger(startOffset) ||
    !Number.isInteger(endOffset) ||
    startOffset < 0 ||
    endOffset <= startOffset ||
    endOffset > 100_000
  ) {
    throw new MarkdownProjectionError();
  }
  return { startOffset, endOffset };
}

function markdownHeadingDepth(node: MdastNode): number {
  const depth = node.depth;
  if (typeof depth !== "number" || !Number.isInteger(depth) || depth < 1 || depth > 6) {
    throw new MarkdownProjectionError();
  }
  return depth;
}

function markdownDepthOk(root: MdastNode): boolean {
  const pending = [{ node: root, depth: 0 }];
  while (pending.length > 0) {
    const item = pending.pop();
    if (!item) break;
    if (item.depth > MAX_MARKDOWN_DEPTH) return false;
    for (const child of item.node.children ?? []) {
      pending.push({ node: child, depth: item.depth + 1 });
    }
  }
  return true;
}

function addUnsupportedNode(state: ProjectionState, node: MdastNode): void {
  const { startOffset, endOffset } = markdownPosition(node);
  const nodeType = noteTextSchema.min(1).max(64).safeParse(node.type);
  addIssue(state, {
    code: "unsupported_node",
    nodeType: nodeType.success ? nodeType.data : "unknown",
    startOffset,
    endOffset,
  });
}

function markdownInlineText(nodes: MdastNode[], state: ProjectionState): string {
  let text = "";
  for (const node of nodes) {
    switch (node.type) {
      case "text":
      case "inlineCode":
        text += node.value ?? "";
        break;
      case "emphasis":
      case "strong":
      case "delete":
      case "link":
      case "linkReference":
        text += markdownInlineText(node.children ?? [], state);
        break;
      case "break":
        text += "\n";
        break;
      case "html":
      case "image":
      case "imageReference":
      case "footnoteReference":
        addUnsupportedNode(state, node);
        break;
      default:
        addUnsupportedNode(state, node);
        break;
    }
  }
  return text;
}

function markdownTableText(node: MdastNode, state: ProjectionState): string {
  const rows: string[] = [];
  for (const row of node.children ?? []) {
    const cells = (row.children ?? []).map((cell) =>
      cleanCell(markdownInlineText(cell.children ?? [], state)),
    );
    if (cells.some((cell) => cell.length > 0)) rows.push(cells.join(" | "));
  }
  return rows.join("\n");
}

function flattenMarkdownUnit(unit: MarkdownUnit): PassageLine[] {
  switch (unit.kind) {
    case "paragraph":
    case "heading":
      return passageLines(unit.ownText, true);
    case "code":
    case "table":
      return passageLines(unit.ownText, false);
    case "list":
      return unit.children.flatMap(flattenMarkdownUnit);
    case "listItem": {
      const lines: PassageLine[] = [];
      if (isMeaningful(passageText(unit.ownLines))) {
        const markerAllowed = unit.marker.length > 0 && unit.ownLines[0]?.indent !== false;
        unit.ownLines.forEach((line, index) => {
          if (index === 0 && markerAllowed) {
            lines.push({ text: `${unit.marker}${line.text}`, indent: line.indent });
          } else if (index > 0 && markerAllowed && line.indent) {
            lines.push({ text: indentLine(line.text), indent: true });
          } else {
            lines.push(line);
          }
        });
      }
      for (const child of unit.children) {
        const childLines = flattenMarkdownUnit(child);
        if (!isMeaningful(passageText(childLines))) continue;
        lines.push(...indentPassageLines(childLines));
      }
      return lines;
    }
    case "blockquote":
      return unit.children.flatMap(flattenMarkdownUnit);
    case "structural":
      return [];
  }
}

function buildMarkdownUnit(
  node: MdastNode,
  state: ProjectionState,
  headingPath: string[],
  marker: string,
): MarkdownUnit | undefined {
  const { startOffset, endOffset } = markdownPosition(node);
  const base = {
    marker,
    headingPath,
    startOffset,
    endOffset,
    ownIndent: true,
    ownLines: [] as PassageLine[],
  };
  switch (node.type) {
    case "paragraph":
      return {
        ...base,
        kind: "paragraph",
        ownText: markdownInlineText(node.children ?? [], state),
        children: [],
      };
    case "heading":
      return {
        ...base,
        kind: "heading",
        ownText: markdownInlineText(node.children ?? [], state),
        children: [],
      };
    case "code":
      return {
        ...base,
        kind: "code",
        ownText: node.value ?? "",
        ownIndent: false,
        children: [],
      };
    case "table":
      return {
        ...base,
        kind: "table",
        ownText: markdownTableText(node, state),
        ownIndent: false,
        children: [],
      };
    case "list": {
      const ordered = node.ordered === true;
      const start = typeof node.start === "number" ? node.start : 1;
      const children: MarkdownUnit[] = [];
      for (const [index, item] of (node.children ?? []).entries()) {
        if (item.type !== "listItem") continue;
        const checked = typeof item.checked === "boolean" ? item.checked : null;
        const itemMarker =
          checked !== null ? `- [${checked ? "x" : " "}] ` : ordered ? `${start + index}. ` : "- ";
        const unit = buildMarkdownUnit(item, state, headingPath, itemMarker);
        if (unit) children.push(unit);
      }
      return { ...base, kind: "list", ownText: "", children };
    }
    case "listItem": {
      const blocks = node.children ?? [];
      const first = blocks[0];
      if (!first) return { ...base, kind: "listItem", ownText: "", children: [] };
      if (first.type === "list") {
        const children: MarkdownUnit[] = [];
        for (const block of blocks) {
          const unit = buildMarkdownUnit(block, state, headingPath, "");
          if (unit) children.push(unit);
        }
        return { ...base, kind: "listItem", ownText: "", children };
      }
      const firstUnit = buildMarkdownUnit(first, state, headingPath, "");
      const ownLines = firstUnit ? flattenMarkdownUnit(firstUnit) : [];
      const ownText = passageText(ownLines);
      const children: MarkdownUnit[] = [];
      for (const block of blocks.slice(1)) {
        const unit = buildMarkdownUnit(block, state, headingPath, "");
        if (unit) children.push(unit);
      }
      const ownIndent = ownLines.length > 0 ? ownLines[0].indent : true;
      const ownMarker = ownIndent ? marker : "";
      return {
        ...base,
        marker: ownMarker,
        kind: "listItem",
        ownText,
        ownIndent,
        ownLines,
        children,
      };
    }
    case "blockquote": {
      const children: MarkdownUnit[] = [];
      for (const block of node.children ?? []) {
        const unit = buildMarkdownUnit(block, state, headingPath, "");
        if (unit) children.push(unit);
      }
      return { ...base, kind: "blockquote", ownText: "", children };
    }
    case "thematicBreak":
    case "definition":
      return { ...base, kind: "structural", ownText: "", children: [] };
    case "html":
    case "image":
    case "imageReference":
    case "footnoteReference":
    case "footnoteDefinition":
      addUnsupportedNode(state, node);
      return undefined;
    default:
      addUnsupportedNode(state, node);
      return undefined;
  }
}

function splitMarkdownListOwnText(unit: MarkdownUnit): string[] {
  if (unit.ownLines.length === 0) return [];
  const markerAllowed = unit.marker.length > 0 && unit.ownLines[0]?.indent !== false;
  const lines = unit.ownLines.map((line, index) => {
    if (index === 0 && markerAllowed) return `${unit.marker}${line.text}`;
    if (index > 0 && markerAllowed && line.indent) return indentLine(line.text);
    return line.text;
  });
  return splitLines(lines.join("\n"));
}

function splitMarkdownOwnText(unit: MarkdownUnit): string[] {
  if (unit.kind === "listItem" && unit.ownLines.some((line) => !line.indent)) {
    return splitMarkdownListOwnText(unit);
  }
  const ownText = formatOwnText(unit.marker, unit.ownText);
  return unit.ownIndent ? splitProse(ownText) : splitLines(ownText);
}

export function projectMarkdown(content: string, sourceBase: SourceBase): NotePassageProjection {
  const parsed = noteTextSchema.max(100_000).safeParse(content);
  if (!parsed.success) return malformed("content_schema");
  let root: MdastNode;
  try {
    root = markdownParser.parse(parsed.data) as unknown as MdastNode;
  } catch {
    return malformed("markdown_parse");
  }
  if (!markdownDepthOk(root)) return malformed("nesting_limit");

  const state = createState();
  const sourceFor = (unit: MarkdownUnit, part?: number): NotePassage["source"] => ({
    kind: "markdown",
    ...sourceBase,
    headingPath: unit.headingPath,
    startOffset: unit.startOffset,
    endOffset: unit.endOffset,
    ...(part === undefined ? {} : { part }),
  });
  const projectUnit = (unit: MarkdownUnit): void => {
    const full = passageText(flattenMarkdownUnit(unit));
    if (!isMeaningful(full)) return;
    if (full.length <= MAX_PASSAGE_CHARS) {
      addPassage(state, full, sourceFor(unit));
      return;
    }
    if (isMeaningful(unit.ownText)) {
      const allowBlank =
        !unit.ownIndent || (unit.kind === "listItem" && unit.ownLines.some((line) => !line.indent));
      const parts = splitMarkdownOwnText(unit);
      for (const [index, part] of parts.entries()) {
        if (
          !addPassage(
            state,
            part,
            sourceFor(unit, parts.length > 1 ? index : undefined),
            allowBlank,
          )
        ) {
          return;
        }
      }
    }
    for (const child of unit.children) {
      projectUnit(child);
      if (state.passageLimit) return;
    }
  };

  try {
    let headings: Heading[] = [];
    for (const node of root.children ?? []) {
      const unit = buildMarkdownUnit(node, state, headingTexts(headings), "");
      if (!unit) continue;
      if (node.type === "heading") {
        headings = updateHeadingPath(headings, markdownHeadingDepth(node), unit.ownText);
        unit.headingPath = headingTexts(headings);
      }
      projectUnit(unit);
      if (state.passageLimit) break;
    }
  } catch (error) {
    if (error instanceof MarkdownProjectionError) return malformed("markdown_parse");
    throw error;
  }
  return finalize(state);
}
