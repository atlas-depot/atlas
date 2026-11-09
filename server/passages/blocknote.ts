import {
  blockIdSchema,
  blockNoteDocumentSchema,
  noteTextSchema,
  type AtlasBlock,
  type BlockNoteDocument,
} from "../../shared/document.ts";
import { type NotePassage, type NotePassageProjection } from "../../shared/passages.ts";
import { MAX_PASSAGE_CHARS, isMeaningful, splitProse, splitLines } from "./split.ts";
import {
  type SourceBase,
  type Heading,
  isRecord,
  indentLine,
  type PassageLine,
  passageText,
  indentPassageLines,
  createState,
  addPassage,
  malformed,
  unsupported,
  finalize,
  updateHeadingPath,
  headingTexts,
  cleanCell,
  formatOwnText,
} from "./common.ts";

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
  return unit.ownIndent ? splitProse(ownText) : splitLines(ownText);
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
        if (
          !addPassage(
            state,
            part,
            sourceFor(unit, parts.length > 1 ? index : undefined),
            !unit.ownIndent,
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

export function projectBlockDocument(
  content: unknown,
  sourceBase: SourceBase,
): NotePassageProjection {
  const parsed = blockNoteDocumentSchema.safeParse(content);
  if (parsed.success) return projectBlockNote(parsed.data, sourceBase);
  return classifyInvalidBlockDocument(content) ?? malformed("content_schema");
}
