import type { Nodes } from "mdast";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";
import type { AtlasBlock, NoteContent } from "../../shared/document";
import { noteIdSchema, type Note, type NoteSummary } from "../../shared/notes";
import type { NoteOrigin } from "../../shared/organize";

export type NoteAuthorship = "user" | "ai";

export type ResolvedOriginSource =
  | {
      status: "available";
      noteId: string;
      title: string;
      revision: number;
    }
  | {
      status: "unavailable";
      noteId: string;
      revision: number;
    };

export type ResolvedNoteSource =
  | ({ kind: "origin" } & ResolvedOriginSource)
  | {
      kind: "link";
      status: "available";
      noteId: string;
      title: string;
    }
  | {
      kind: "link";
      status: "unavailable";
      noteId: string;
    };

const INTERNAL_NOTE_PATH = /^\/notes\/([^/?#]+)$/;

export function getNoteAuthorship(note: Pick<NoteSummary, "origin">): NoteAuthorship {
  return note.origin ? "ai" : "user";
}

export function formatNoteAuthorship(note: Pick<NoteSummary, "origin">): string {
  return note.origin ? "AI-generated" : "User-authored";
}

export function formatNoteTimestamp(iso: string, locale?: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export function buildInternalNoteHref(noteId: string, origin?: string): string {
  const path = `/notes/${noteIdSchema.parse(noteId).toLowerCase()}`;
  return origin ? `${origin.replace(/\/+$/, "")}${path}` : path;
}

export function parseInternalNoteHref(href: string, currentOrigin?: string): string | null {
  if (!href) return null;
  for (const character of href) {
    const code = character.charCodeAt(0);
    if (code <= 0x20 || code === 0x7f) return null;
  }

  let pathname: string | null = null;
  if (href.startsWith("/")) {
    if (href.startsWith("//")) return null;
    pathname = href;
  } else if (currentOrigin && URL.canParse(href)) {
    const url = new URL(href);
    if (
      (url.protocol !== "http:" && url.protocol !== "https:") ||
      url.username !== "" ||
      url.password !== "" ||
      url.origin !== currentOrigin ||
      url.search !== "" ||
      url.hash !== ""
    ) {
      return null;
    }
    pathname = url.pathname;
  }

  if (!pathname) return null;
  const match = INTERNAL_NOTE_PATH.exec(pathname);
  if (!match) return null;
  const parsed = noteIdSchema.safeParse(match[1]);
  return parsed.success ? parsed.data.toLowerCase() : null;
}

function collectInlineLinkHrefs(items: unknown, hrefs: string[]) {
  if (!Array.isArray(items)) return;
  for (const item of items) {
    if (item && typeof item === "object") {
      const record = item as Record<string, unknown>;
      if (record.type === "link" && typeof record.href === "string") {
        hrefs.push(record.href);
      }
    }
  }
}

function collectBlockLinkHrefs(blocks: readonly AtlasBlock[], hrefs: string[]) {
  for (const block of blocks) {
    if (block.type === "table") {
      for (const row of block.content.rows) {
        for (const cell of row.cells) {
          collectInlineLinkHrefs(Array.isArray(cell) ? cell : cell.content, hrefs);
        }
      }
    } else if (block.type !== "divider") {
      collectInlineLinkHrefs(block.content, hrefs);
    }
    if (block.children.length > 0) {
      collectBlockLinkHrefs(block.children, hrefs);
    }
  }
}

const markdownParser = unified().use(remarkParse).use(remarkGfm);

function collectFootnoteReferences(node: Nodes, identifiers: Set<string>) {
  if (node.type === "footnoteReference") identifiers.add(node.identifier);
  if ("children" in node) {
    for (const child of node.children) collectFootnoteReferences(child, identifiers);
  }
}

function collectDefinitions(
  node: Nodes,
  usedFootnotes: Set<string>,
  definitions: Map<string, string>,
) {
  if (node.type === "footnoteDefinition" && !usedFootnotes.has(node.identifier)) return;
  if (node.type === "definition") {
    // CommonMark resolves a reference to the first definition of its label.
    if (!definitions.has(node.identifier)) definitions.set(node.identifier, node.url);
    return;
  }
  if ("children" in node) {
    for (const child of node.children) collectDefinitions(child, usedFootnotes, definitions);
  }
}

function collectLinkHrefs(
  node: Nodes,
  usedFootnotes: Set<string>,
  definitions: Map<string, string>,
  hrefs: string[],
) {
  if (node.type === "footnoteDefinition" && !usedFootnotes.has(node.identifier)) return;
  if (node.type === "link") {
    hrefs.push(node.url);
    return;
  }
  if (node.type === "linkReference") {
    const destination = definitions.get(node.identifier);
    if (destination) hrefs.push(destination);
    return;
  }
  if ("children" in node) {
    for (const child of node.children) {
      collectLinkHrefs(child, usedFootnotes, definitions, hrefs);
    }
  }
}

/**
 * Extract destinations from links the Markdown preview can render.
 * Code, raw HTML, images, unused definitions and unused footnote bodies are ignored.
 */
function extractMarkdownLinkHrefs(markdown: string): string[] {
  // Character references can encode part of /notes/, so parse when an ampersand is present.
  if (!markdown.includes("notes") && !markdown.includes("&")) return [];

  const tree = markdownParser.parse(markdown);
  const usedFootnotes = new Set<string>();
  collectFootnoteReferences(tree, usedFootnotes);

  const definitions = new Map<string, string>();
  collectDefinitions(tree, usedFootnotes, definitions);

  const hrefs: string[] = [];
  collectLinkHrefs(tree, usedFootnotes, definitions, hrefs);
  return hrefs;
}

export function extractLinkedNoteIds(
  content: NoteContent,
  options?: { currentOrigin?: string; excludeNoteIds?: Iterable<string> },
): string[] {
  const rawHrefs: string[] = [];
  if (typeof content === "string") {
    rawHrefs.push(...extractMarkdownLinkHrefs(content));
  } else {
    collectBlockLinkHrefs(content.blocks, rawHrefs);
  }

  const excluded = new Set(Array.from(options?.excludeNoteIds ?? [], (id) => id.toLowerCase()));
  const seen = new Set<string>();
  const result: string[] = [];

  for (const href of rawHrefs) {
    const parsed = parseInternalNoteHref(href, options?.currentOrigin);
    if (!parsed || excluded.has(parsed) || seen.has(parsed)) continue;
    seen.add(parsed);
    result.push(parsed);
  }

  return result;
}

export function resolveOriginSource(
  origin: NoteOrigin | undefined,
  ownedNotes: readonly NoteSummary[],
): ResolvedOriginSource | null {
  if (!origin) return null;
  const targetId = origin.sourceNoteId.toLowerCase();
  const owned = ownedNotes.find((note) => note.id.toLowerCase() === targetId);
  if (owned) {
    return {
      status: "available",
      noteId: owned.id,
      title: owned.title.trim() || "Untitled note",
      revision: origin.sourceRevision,
    };
  }
  return {
    status: "unavailable",
    noteId: origin.sourceNoteId,
    revision: origin.sourceRevision,
  };
}

export function resolveNoteSources(
  note: Pick<Note, "id" | "origin" | "content">,
  ownedNotes: readonly NoteSummary[],
  currentOrigin?: string,
): ResolvedNoteSource[] {
  const sources: ResolvedNoteSource[] = [];
  const excluded = new Set<string>([note.id.toLowerCase()]);

  const originSource = resolveOriginSource(note.origin, ownedNotes);
  if (originSource) {
    sources.push({ kind: "origin", ...originSource });
    excluded.add(originSource.noteId.toLowerCase());
  }

  const linkedIds = extractLinkedNoteIds(note.content, {
    currentOrigin,
    excludeNoteIds: excluded,
  });

  for (const linkedId of linkedIds) {
    const owned = ownedNotes.find((item) => item.id.toLowerCase() === linkedId);
    if (owned) {
      sources.push({
        kind: "link",
        status: "available",
        noteId: owned.id,
        title: owned.title.trim() || "Untitled note",
      });
    } else {
      sources.push({
        kind: "link",
        status: "unavailable",
        noteId: linkedId,
      });
    }
  }

  return sources;
}
