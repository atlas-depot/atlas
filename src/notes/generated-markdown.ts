import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";

const parser = unified().use(remarkParse).use(remarkGfm).freeze();
const supportedNodes = new Set([
  "root",
  "paragraph",
  "heading",
  "text",
  "emphasis",
  "strong",
  "delete",
  "inlineCode",
  "code",
  "blockquote",
  "list",
  "listItem",
  "break",
  "thematicBreak",
  "link",
  "table",
  "tableRow",
  "tableCell",
]);

function comparable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(comparable);
  if (value === null || typeof value !== "object") return value;
  const node = value as Record<string, unknown>;
  if (typeof node.type !== "string" || !supportedNodes.has(node.type)) {
    throw new Error("Unsupported Markdown node");
  }
  return Object.fromEntries(
    Object.entries(node)
      .filter(
        ([key]) =>
          key !== "position" &&
          !(key === "spread" && (node.type === "list" || node.type === "listItem")),
      )
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, comparable(child)]),
  );
}

/** Generated text may change Markdown spelling, but not its supported content.
 * Legacy notes use the separate, stricter source-preservation path.
 */
export function canImportGeneratedMarkdown(source: string, roundtrip: string): boolean {
  try {
    // Positions and list spacing describe source layout. Every other AST field,
    // including code, link titles/targets and table alignment, must survive.
    return (
      JSON.stringify(comparable(parser.parse(source))) ===
      JSON.stringify(comparable(parser.parse(roundtrip)))
    );
  } catch {
    return false;
  }
}
