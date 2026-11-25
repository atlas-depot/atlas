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

export function buildInternalNoteHref(noteId: string): string {
  return `/notes/${noteIdSchema.parse(noteId).toLowerCase()}`;
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

/** Extract link destinations from Markdown while ignoring fenced and inline code. */
function extractMarkdownLinkHrefs(markdown: string): string[] {
  const hrefs: string[] = [];
  const lines = markdown.split(/\r?\n/);
  const proseLines: string[] = [];
  let fenceChar: "`" | "~" | null = null;
  let fenceLength = 0;

  for (const line of lines) {
    const fenceMatch = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (fenceChar === null) {
      if (fenceMatch) {
        const marker = fenceMatch[1];
        const char = marker[0] as "`" | "~";
        if (char === "~" || !fenceMatch[2].includes("`")) {
          fenceChar = char;
          fenceLength = marker.length;
          continue;
        }
      }
      const refDef = /^ {0,3}\[[^\]\n]+\]:[ \t]*(?:<([^>\n]+)>|([^\s]+))/.exec(line);
      if (refDef) {
        const destination = refDef[1] ?? refDef[2];
        if (destination) hrefs.push(destination);
        continue;
      }
      proseLines.push(line);
    } else if (
      fenceMatch &&
      fenceMatch[1][0] === fenceChar &&
      fenceMatch[1].length >= fenceLength &&
      fenceMatch[2].trim() === ""
    ) {
      fenceChar = null;
      fenceLength = 0;
    }
  }

  const text = proseLines.join("\n");
  let index = 0;
  while (index < text.length) {
    const char = text[index];
    if (char === "\\") {
      index += 2;
      continue;
    }
    if (char === "`") {
      let tickCount = 1;
      while (text[index + tickCount] === "`") tickCount++;
      const closing = text.indexOf("`".repeat(tickCount), index + tickCount);
      index = closing === -1 ? index + tickCount : closing + tickCount;
      continue;
    }
    if (char === "[" && text[index - 1] !== "!") {
      let depth = 1;
      let cursor = index + 1;
      while (cursor < text.length && depth > 0) {
        const current = text[cursor];
        if (current === "\\") {
          cursor += 2;
          continue;
        }
        if (current === "`") {
          let tickCount = 1;
          while (text[cursor + tickCount] === "`") tickCount++;
          const closing = text.indexOf("`".repeat(tickCount), cursor + tickCount);
          cursor = closing === -1 ? cursor + tickCount : closing + tickCount;
          continue;
        }
        if (current === "[") depth++;
        else if (current === "]") depth--;
        cursor++;
      }
      if (depth === 0 && text[cursor] === "(") {
        cursor++;
        while (cursor < text.length && (text[cursor] === " " || text[cursor] === "\t")) {
          cursor++;
        }
        if (text[cursor] === "<") {
          const end = text.indexOf(">", cursor + 1);
          if (end !== -1 && !text.slice(cursor + 1, end).includes("\n")) {
            hrefs.push(text.slice(cursor + 1, end));
            index = end + 1;
            continue;
          }
        } else {
          const start = cursor;
          let parenDepth = 0;
          while (cursor < text.length) {
            const current = text[cursor];
            if (current === "\\") {
              cursor += 2;
              continue;
            }
            if (current === "(") {
              parenDepth++;
            } else if (current === ")") {
              if (parenDepth === 0) break;
              parenDepth--;
            } else if (current === " " || current === "\t" || current === "\n") {
              break;
            }
            cursor++;
          }
          if (cursor > start) {
            hrefs.push(text.slice(start, cursor));
            index = cursor;
            continue;
          }
        }
      }
    }
    index++;
  }

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
