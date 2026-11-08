import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";
import {
  blockIdSchema,
  blockNoteDocumentSchema,
  noteTextSchema,
  type AtlasBlock,
  type BlockNoteDocument,
} from "../shared/document.ts";
import { noteIdSchema } from "../shared/notes.ts";
import {
  notePassageVersionSchema,
  type NotePassage,
  type NotePassageProjection,
  type NotePassageProjectionInput,
  type PassageIssue,
} from "../shared/passages.ts";

const MAX_PASSAGE_CHARS = 4_000;
const MAX_PASSAGES = 1_000;
const MAX_ISSUES = 100;
const MAX_MARKDOWN_DEPTH = 96;

type SourceBase = { noteId: string; version: string };
type Heading = { level: number; text: string };
type MalformedReason = Extract<PassageIssue, { code: "malformed_content" }>["reason"];

type ProjectionState = {
  passages: NotePassage[];
  issues: PassageIssue[];
  passageLimit: boolean;
  issueLimit: boolean;
};

const markdownParser = unified().use(remarkParse).use(remarkGfm).freeze();
const graphemeSegmenter = new Intl.Segmenter("en", { granularity: "grapheme" });

class MarkdownProjectionError extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isMeaningful(text: string): boolean {
  return text.trim().length > 0;
}

function indentLine(line: string): string {
  return line.length > 0 ? `  ${line}` : line;
}

type PassageLine = { text: string; indent: boolean };

function passageLines(text: string, indent: boolean): PassageLine[] {
  return text.split("\n").map((line) => ({ text: line, indent }));
}

function passageText(lines: PassageLine[]): string {
  return lines.map((line) => line.text).join("\n");
}

function indentPassageLines(lines: PassageLine[]): PassageLine[] {
  return lines.map((line) =>
    line.indent && line.text.length > 0 ? { text: `  ${line.text}`, indent: true } : line,
  );
}

function createState(): ProjectionState {
  return { passages: [], issues: [], passageLimit: false, issueLimit: false };
}

function addIssue(state: ProjectionState, issue: PassageIssue): void {
  if (state.issues.length >= MAX_ISSUES) {
    if (!state.issueLimit) {
      state.issueLimit = true;
      state.issues.push({ code: "issue_limit" });
    }
    return;
  }
  state.issues.push(issue);
}

function addPassage(state: ProjectionState, text: string, source: NotePassage["source"]): boolean {
  if (!isMeaningful(text)) return true;
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

function malformed(reason: MalformedReason): NotePassageProjection {
  return {
    status: "malformed",
    passages: [],
    issues: [{ code: "malformed_content", reason }],
  };
}

function unsupported(issue: PassageIssue): NotePassageProjection {
  return { status: "unsupported", passages: [], issues: [issue] };
}

function finalize(state: ProjectionState): NotePassageProjection {
  if (state.passages.length > 0) {
    return state.issues.length > 0
      ? { status: "partial", passages: state.passages, issues: state.issues }
      : { status: "complete", passages: state.passages };
  }
  return state.issues.length > 0
    ? { status: "unsupported", passages: [], issues: state.issues }
    : { status: "empty", passages: [] };
}

function updateHeadingPath(path: Heading[], level: number, text: string): Heading[] {
  const next = path.slice();
  while (next.length > 0 && next[next.length - 1].level >= level) next.pop();
  next.push({ level, text });
  return next;
}

function headingTexts(path: Heading[]): string[] {
  return path.map((heading) => heading.text);
}

function cleanCell(text: string): string {
  return text.replace(/\s*\n\s*/g, " ").trim();
}

function formatOwnText(marker: string, text: string): string {
  if (!marker || !isMeaningful(text)) return text;
  const lines = text.split("\n");
  return [marker + lines[0], ...lines.slice(1).map(indentLine)].join("\n");
}

function mergeBlankParts(parts: string[]): string[] {
  const merged: string[] = [];
  let pending = "";
  for (const part of parts) {
    if (!isMeaningful(part)) {
      if (
        merged.length > 0 &&
        merged[merged.length - 1].length + part.length <= MAX_PASSAGE_CHARS
      ) {
        merged[merged.length - 1] += part;
      } else {
        pending += part;
      }
      continue;
    }
    const candidate = pending + part;
    merged.push(candidate.length <= MAX_PASSAGE_CHARS ? candidate : part);
    pending = "";
  }
  if (
    pending.length > 0 &&
    merged.length > 0 &&
    merged[merged.length - 1].length + pending.length <= MAX_PASSAGE_CHARS
  ) {
    merged[merged.length - 1] += pending;
  }
  return merged;
}

function safeSliceLength(text: string, limit: number, allowOversized: boolean): number {
  if (text.length <= limit) return text.length;
  const boundaries = graphemeBoundaries(text);
  let end = 0;
  for (const boundary of boundaries) {
    if (boundary > limit) break;
    end = boundary;
  }
  if (end > 0) return end;
  if (!allowOversized) return 0;
  return boundaries.find((boundary) => boundary > 0) ?? text.length;
}

/**
 * Code and tables must keep every character across a split. The 4,000 character limit stays soft
 * for one indivisible grapheme, because cutting it would corrupt Unicode.
 */
function packExactParts(parts: string[]): string[] {
  const packed: string[] = [];
  let current = "";
  for (const part of parts) {
    let offset = 0;
    while (offset < part.length) {
      const room = MAX_PASSAGE_CHARS - current.length;
      const take = safeSliceLength(part.slice(offset), room, current.length === 0);
      if (take === 0) {
        packed.push(current);
        current = "";
        continue;
      }
      current += part.slice(offset, offset + take);
      offset += take;
      if (current.length >= MAX_PASSAGE_CHARS) {
        packed.push(current);
        current = "";
      }
    }
  }
  if (current.length > 0) packed.push(current);
  return packed;
}

function graphemeBoundaries(text: string): number[] {
  const boundaries = [0];
  for (const segment of graphemeSegmenter.segment(text)) {
    if (segment.index > 0) boundaries.push(segment.index);
  }
  boundaries.push(text.length);
  return boundaries;
}

function largestBoundaryAtOrBefore(boundaries: number[], limit: number, after: number): number {
  let result = after;
  for (const boundary of boundaries) {
    if (boundary > limit) break;
    if (boundary > after) result = boundary;
  }
  return result;
}

function splitProse(text: string): string[] {
  if (text.length <= MAX_PASSAGE_CHARS) return [text];
  // One indivisible grapheme may exceed the soft limit; splitting it would corrupt Unicode.
  const boundaries = graphemeBoundaries(text);
  const parts: string[] = [];
  let start = 0;
  while (start < text.length) {
    let end = largestBoundaryAtOrBefore(boundaries, start + MAX_PASSAGE_CHARS, start);
    if (end <= start) {
      end = boundaries.find((boundary) => boundary > start) ?? text.length;
    }
    const minimum = start + Math.floor(MAX_PASSAGE_CHARS / 2);
    if (end > minimum) {
      for (let index = end; index > minimum; index--) {
        const character = text[index - 1];
        if (character === "\n" || character === " " || character === "\t") {
          const boundary = largestBoundaryAtOrBefore(boundaries, index, start);
          if (boundary > start) end = boundary;
          break;
        }
      }
    }
    parts.push(text.slice(start, end));
    start = end;
  }
  return mergeBlankParts(parts);
}

function splitLines(text: string): string[] {
  if (text.length <= MAX_PASSAGE_CHARS) return [text];
  const lines: string[] = [];
  let lineStart = 0;
  for (let index = 0; index < text.length; index++) {
    if (text[index] === "\n") {
      lines.push(text.slice(lineStart, index + 1));
      lineStart = index + 1;
    }
  }
  if (lineStart < text.length) lines.push(text.slice(lineStart));
  const parts: string[] = [];
  let current = "";
  for (const line of lines) {
    if (line.length > MAX_PASSAGE_CHARS) {
      if (current) {
        parts.push(current);
        current = "";
      }
      parts.push(...splitProse(line));
    } else if (current.length > 0 && current.length + line.length > MAX_PASSAGE_CHARS) {
      parts.push(current);
      current = line;
    } else {
      current += line;
    }
  }
  if (current) parts.push(current);
  return packExactParts(parts);
}

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
      if (isMeaningful(unit.ownText)) {
        const ownLines = unit.ownText.split("\n");
        if (unit.marker) {
          lines.push({ text: `${unit.marker}${ownLines[0]}`, indent: unit.ownIndent });
          for (const line of ownLines.slice(1)) {
            lines.push({
              text: unit.ownIndent ? indentLine(line) : line,
              indent: unit.ownIndent,
            });
          }
        } else {
          for (const line of ownLines) lines.push({ text: line, indent: unit.ownIndent });
        }
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
  const base = { marker, headingPath, startOffset, endOffset, ownIndent: true };
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
      const ownText = firstUnit ? passageText(flattenMarkdownUnit(firstUnit)) : "";
      const children: MarkdownUnit[] = [];
      for (const block of blocks.slice(1)) {
        const unit = buildMarkdownUnit(block, state, headingPath, "");
        if (unit) children.push(unit);
      }
      const ownIndent = firstUnit ? firstUnit.kind !== "code" && firstUnit.kind !== "table" : true;
      const ownMarker = ownIndent ? marker : "";
      return { ...base, marker: ownMarker, kind: "listItem", ownText, ownIndent, children };
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

function splitMarkdownOwnText(unit: MarkdownUnit): string[] {
  const ownText = formatOwnText(unit.marker, unit.ownText);
  return unit.kind === "code" || unit.kind === "table" ? splitLines(ownText) : splitProse(ownText);
}

function projectMarkdown(content: string, sourceBase: SourceBase): NotePassageProjection {
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
      const parts = splitMarkdownOwnText(unit);
      for (const [index, part] of parts.entries()) {
        if (!addPassage(state, part, sourceFor(unit, parts.length > 1 ? index : undefined))) {
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

type BlockUnit = {
  kind: AtlasBlock["type"];
  blockId: string;
  ownText: string;
  ownIndent: boolean;
  marker: string;
  headingPath: string[];
  children: BlockUnit[];
};

type TableContent = {
  columnWidths: Array<number | undefined>;
  rows: Array<{ cells: unknown[] }>;
};

function blockInlineText(content: unknown[]): string {
  let text = "";
  for (const node of content) {
    if (!isRecord(node)) continue;
    if (node.type === "text" && typeof node.text === "string") {
      text += node.text;
    } else if (node.type === "link" && Array.isArray(node.content)) {
      text += blockInlineText(node.content);
    }
  }
  return text;
}

function blockCell(item: unknown): { text: string; width: number; height: number } {
  if (Array.isArray(item)) {
    return { text: cleanCell(blockInlineText(item)), width: 1, height: 1 };
  }
  if (isRecord(item)) {
    const props = isRecord(item.props) ? item.props : {};
    const colspan = typeof props.colspan === "number" ? props.colspan : 1;
    const rowspan = typeof props.rowspan === "number" ? props.rowspan : 1;
    const content = Array.isArray(item.content) ? item.content : [];
    return {
      text: cleanCell(blockInlineText(content)),
      width: colspan,
      height: rowspan,
    };
  }
  return { text: "", width: 1, height: 1 };
}

function blockTableText(content: TableContent): string {
  const columns = content.columnWidths.length;
  const occupied = content.rows.map(() => Array.from({ length: columns }, () => false));
  const grid = content.rows.map(() => Array.from({ length: columns }, () => ""));
  for (let row = 0; row < content.rows.length; row++) {
    let column = 0;
    for (const item of content.rows[row].cells) {
      while (column < columns && occupied[row][column]) column++;
      if (column >= columns) break;
      const cell = blockCell(item);
      grid[row][column] = cell.text;
      for (let y = row; y < Math.min(content.rows.length, row + cell.height); y++) {
        for (let x = column; x < Math.min(columns, column + cell.width); x++) {
          occupied[y][x] = true;
        }
      }
      column += cell.width;
    }
  }
  const rows: string[] = [];
  for (const cells of grid) {
    if (cells.some((cell) => cell.length > 0)) rows.push(cells.join(" | "));
  }
  return rows.join("\n");
}

function blockOwnText(block: AtlasBlock): string {
  switch (block.type) {
    case "paragraph":
    case "heading":
    case "bulletListItem":
    case "numberedListItem":
    case "checkListItem":
    case "quote":
      return blockInlineText(block.content);
    case "codeBlock":
      return block.content.map((item) => item.text).join("");
    case "table":
      return blockTableText(block.content);
    case "divider":
      return "";
  }
}

function blockMarker(block: AtlasBlock): string {
  switch (block.type) {
    case "bulletListItem":
      return "- ";
    case "checkListItem":
      return block.props.checked ? "- [x] " : "- [ ] ";
    default:
      return "";
  }
}

function buildBlockUnit(block: AtlasBlock, headingPath: string[], marker: string): BlockUnit {
  return {
    kind: block.type,
    blockId: block.id,
    ownText: blockOwnText(block),
    ownIndent: block.type !== "codeBlock" && block.type !== "table",
    marker,
    headingPath,
    children: buildBlockChildren(block.children, headingPath),
  };
}

function buildBlockChildren(children: AtlasBlock[], headingPath: string[]): BlockUnit[] {
  let nextNumber = 1;
  return children.map((child) => {
    let marker = "";
    if (child.type === "numberedListItem") {
      const start = child.props.start ?? nextNumber;
      marker = `${start}. `;
      nextNumber = start + 1;
    } else {
      marker = blockMarker(child);
      nextNumber = 1;
    }
    return buildBlockUnit(child, headingPath, marker);
  });
}

function flattenBlockUnit(unit: BlockUnit): PassageLine[] {
  const lines: PassageLine[] = [];
  if (isMeaningful(unit.ownText)) {
    const ownLines = unit.ownText.split("\n");
    if (unit.marker) {
      lines.push({ text: `${unit.marker}${ownLines[0]}`, indent: true });
      for (const line of ownLines.slice(1)) {
        lines.push({ text: indentLine(line), indent: true });
      }
    } else {
      for (const line of ownLines) lines.push({ text: line, indent: unit.ownIndent });
    }
  }
  for (const child of unit.children) {
    const childLines = flattenBlockUnit(child);
    if (!isMeaningful(passageText(childLines))) continue;
    lines.push(...indentPassageLines(childLines));
  }
  return lines;
}

function splitBlockOwnText(unit: BlockUnit): string[] {
  const ownText = formatOwnText(unit.marker, unit.ownText);
  return unit.kind === "codeBlock" || unit.kind === "table"
    ? splitLines(ownText)
    : splitProse(ownText);
}

function setBlockHeadingPath(units: BlockUnit[], headingPath: string[]): void {
  for (const unit of units) {
    unit.headingPath = headingPath;
    setBlockHeadingPath(unit.children, headingPath);
  }
}

const SUPPORTED_BLOCK_TYPES = new Set([
  "paragraph",
  "heading",
  "bulletListItem",
  "numberedListItem",
  "checkListItem",
  "quote",
  "codeBlock",
  "divider",
  "table",
]);

function findUnsupportedBlockType(blocks: unknown): { type: string; id?: string } | undefined {
  if (!Array.isArray(blocks)) return undefined;
  const pending = blocks.map((block) => ({ block, depth: 0 }));
  let count = 0;
  while (pending.length > 0) {
    const item = pending.pop();
    if (!item) break;
    if (++count > 1_000 || item.depth > 20) return undefined;
    if (!isRecord(item.block)) return undefined;
    const type = item.block.type;
    if (typeof type !== "string") return undefined;
    if (!SUPPORTED_BLOCK_TYPES.has(type)) {
      return {
        type,
        ...(typeof item.block.id === "string" ? { id: item.block.id } : {}),
      };
    }
    const children = item.block.children;
    if (children === undefined) continue;
    if (!Array.isArray(children)) return undefined;
    for (const child of children) pending.push({ block: child, depth: item.depth + 1 });
  }
  return undefined;
}

function classifyInvalidBlockDocument(content: unknown): NotePassageProjection | undefined {
  if (!isRecord(content)) return undefined;
  const format = content.format;
  if (typeof format !== "string") return undefined;
  if (format !== "blocknote") {
    const value = noteTextSchema.min(1).max(64).safeParse(format);
    return unsupported({
      code: "unsupported_format",
      format: value.success ? value.data : "unknown",
    });
  }
  const schemaVersion = content.schemaVersion;
  if (typeof schemaVersion !== "number" || !Number.isSafeInteger(schemaVersion)) return undefined;
  if (schemaVersion !== 1) {
    return unsupported({ code: "unsupported_schema_version", schemaVersion });
  }
  const unsupportedBlock = findUnsupportedBlockType(content.blocks);
  if (unsupportedBlock) {
    const blockId = blockIdSchema.safeParse(unsupportedBlock.id);
    const blockType = noteTextSchema.min(1).max(128).safeParse(unsupportedBlock.type);
    return unsupported({
      code: "unsupported_block_type",
      blockType: blockType.success ? blockType.data : "unknown",
      ...(blockId.success ? { blockId: blockId.data } : {}),
    });
  }
  return undefined;
}

function projectBlockNote(
  document: BlockNoteDocument,
  sourceBase: SourceBase,
): NotePassageProjection {
  const state = createState();
  const sourceFor = (unit: BlockUnit, part?: number): NotePassage["source"] => ({
    kind: "block",
    ...sourceBase,
    blockId: unit.blockId,
    headingPath: unit.headingPath,
    ...(part === undefined ? {} : { part }),
  });
  const projectUnit = (unit: BlockUnit): void => {
    const full = passageText(flattenBlockUnit(unit));
    if (!isMeaningful(full)) return;
    if (full.length <= MAX_PASSAGE_CHARS) {
      addPassage(state, full, sourceFor(unit));
      return;
    }
    if (isMeaningful(unit.ownText)) {
      const parts = splitBlockOwnText(unit);
      for (const [index, part] of parts.entries()) {
        if (!addPassage(state, part, sourceFor(unit, parts.length > 1 ? index : undefined))) {
          return;
        }
      }
    }
    for (const child of unit.children) {
      projectUnit(child);
      if (state.passageLimit) return;
    }
  };

  let headings: Heading[] = [];
  let nextNumber = 1;
  for (const block of document.blocks) {
    let marker = "";
    if (block.type === "numberedListItem") {
      const start = block.props.start ?? nextNumber;
      marker = `${start}. `;
      nextNumber = start + 1;
    } else {
      marker = blockMarker(block);
      nextNumber = 1;
    }
    const unit = buildBlockUnit(block, headingTexts(headings), marker);
    if (block.type === "heading") {
      headings = updateHeadingPath(headings, block.props.level, unit.ownText);
      const headingPath = headingTexts(headings);
      unit.headingPath = headingPath;
      setBlockHeadingPath(unit.children, headingPath);
    }
    projectUnit(unit);
    if (state.passageLimit) break;
  }
  return finalize(state);
}

function projectBlockDocument(content: unknown, sourceBase: SourceBase): NotePassageProjection {
  const parsed = blockNoteDocumentSchema.safeParse(content);
  if (parsed.success) return projectBlockNote(parsed.data, sourceBase);
  return classifyInvalidBlockDocument(content) ?? malformed("content_schema");
}

export function projectNotePassages(input: NotePassageProjectionInput): NotePassageProjection {
  const noteId = noteIdSchema.safeParse(input.noteId);
  const version = notePassageVersionSchema.safeParse(input.version);
  if (!noteId.success || !version.success) return malformed("invalid_source");
  const sourceBase = { noteId: noteId.data, version: version.data };
  if (typeof input.content === "string") return projectMarkdown(input.content, sourceBase);
  if (typeof input.content === "object" && input.content !== null) {
    return projectBlockDocument(input.content, sourceBase);
  }
  return malformed("content_schema");
}
