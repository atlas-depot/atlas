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

function normalizeReferenceLabel(label: string): string {
  return label.trim().replace(/\s+/g, " ").toLowerCase();
}

/** Extract link destinations from Markdown in linear time, skipping code and unused references. */
function extractMarkdownLinkHrefs(markdown: string): string[] {
  const hrefs: string[] = [];
  const lines = markdown.split(/\r?\n/);
  const proseLines: string[] = [];
  const refDefinitions = new Map<string, string>();
  let fenceChar: "`" | "~" | null = null;
  let fenceLength = 0;
  let inParagraph = false;

  for (const line of lines) {
    const fenceMatch = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (fenceChar === null) {
      if (fenceMatch) {
        const marker = fenceMatch[1];
        const char = marker[0] as "`" | "~";
        if (char === "~" || !fenceMatch[2].includes("`")) {
          fenceChar = char;
          fenceLength = marker.length;
          inParagraph = false;
          continue;
        }
      }
      if (line.trim() === "") {
        inParagraph = false;
        proseLines.push("");
        continue;
      }
      // CommonMark indented code blocks start with 4 spaces or a tab outside an active paragraph.
      if (!inParagraph && /^(?: {4}|\t)/.test(line)) {
        continue;
      }
      if (!inParagraph) {
        const refDef = /^ {0,3}\[([^\]\n]+)\]:[ \t]*(?:<([^>\n]+)>|([^\s]+))/.exec(line);
        if (refDef) {
          const normalized = normalizeReferenceLabel(refDef[1]);
          const destination = refDef[2] ?? refDef[3];
          if (normalized && destination && !refDefinitions.has(normalized)) {
            refDefinitions.set(normalized, destination);
          }
          continue;
        }
      }
      inParagraph = true;
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
  const openBrackets: Array<{ index: number; isImage: boolean }> = [];
  const failedTickLengths = new Set<number>();
  let failedParenFrom = Number.POSITIVE_INFINITY;
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
      if (!failedTickLengths.has(tickCount)) {
        const closing = text.indexOf("`".repeat(tickCount), index + tickCount);
        if (closing !== -1) {
          index = closing + tickCount;
          continue;
        }
        failedTickLengths.add(tickCount);
      }
      index += tickCount;
      continue;
    }
    if (char === "[") {
      let backslashes = 0;
      let back = index - 2;
      while (back >= 0 && text[back] === "\\") {
        backslashes++;
        back--;
      }
      const isImage = text[index - 1] === "!" && backslashes % 2 === 0;
      openBrackets.push({ index, isImage });
      index++;
      continue;
    }
    if (char === "]") {
      const opener = openBrackets.pop();
      if (!opener || opener.isImage) {
        index++;
        continue;
      }

      const afterClose = index + 1;
      if (text[afterClose] === "(" && afterClose < failedParenFrom) {
        let cursor = afterClose + 1;
        while (cursor < text.length && (text[cursor] === " " || text[cursor] === "\t")) {
          cursor++;
        }
        let destination = "";
        let closeParen = -1;
        if (text[cursor] === "<") {
          const endAngle = text.indexOf(">", cursor + 1);
          if (endAngle !== -1 && !text.slice(cursor + 1, endAngle).includes("\n")) {
            destination = text.slice(cursor + 1, endAngle);
            let afterAngle = endAngle + 1;
            while (
              afterAngle < text.length &&
              (text[afterAngle] === " " || text[afterAngle] === "\t")
            ) {
              afterAngle++;
            }
            if (text[afterAngle] === ")") {
              closeParen = afterAngle;
            }
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
              if (parenDepth === 0) {
                closeParen = cursor;
                break;
              }
              parenDepth--;
            } else if (current === " " || current === "\t" || current === "\n") {
              break;
            }
            cursor++;
          }
          destination = text.slice(start, cursor);
          if (closeParen === -1 && destination.length > 0 && text[cursor] !== "\n") {
            let tail = cursor;
            while (tail < text.length && text[tail] !== ")" && text[tail] !== "\n") {
              if (text[tail] === "\\") tail += 2;
              else tail++;
            }
            if (text[tail] === ")") closeParen = tail;
          }
        }

        if (closeParen !== -1 && destination.length > 0) {
          hrefs.push(destination);
          index = closeParen + 1;
          continue;
        }
        if (closeParen === -1 && cursor >= text.length) {
          failedParenFrom = Math.min(failedParenFrom, afterClose);
        }
      } else if (text[afterClose] === "[") {
        let cursor = afterClose + 1;
        while (
          cursor < text.length &&
          text[cursor] !== "]" &&
          text[cursor] !== "[" &&
          text[cursor] !== "\n"
        ) {
          if (text[cursor] === "\\") cursor += 2;
          else cursor++;
        }
        if (text[cursor] === "]") {
          const rawRef = text.slice(afterClose + 1, cursor);
          const label = normalizeReferenceLabel(
            rawRef.length > 0 ? rawRef : text.slice(opener.index + 1, index),
          );
          const destination = refDefinitions.get(label);
          if (destination) {
            hrefs.push(destination);
            index = cursor + 1;
            continue;
          }
        }
      } else {
        const label = normalizeReferenceLabel(text.slice(opener.index + 1, index));
        const destination = refDefinitions.get(label);
        if (destination) {
          hrefs.push(destination);
        }
      }
      index++;
      continue;
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
