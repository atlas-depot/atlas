import type { ConversationCitation } from "../../shared/conversations";
import type { AtlasBlock, BlockNoteDocument, NoteContent } from "../../shared/document";
import type { NoteSearchResponse } from "../../shared/note-search";
import type { NotePassageSource } from "../../shared/passages";
import type { NoteIndexCoverage, NoteSearchCandidate } from "./note-search-store";
import type { NoteSnapshot } from "./notes-store";

export type SourceTarget = {
  origin: "search" | "citation";
  query?: string;
  noteTitle?: string;
  source: NotePassageSource;
  excerpt: string | null;
  deleted?: boolean;
  stale?: boolean;
};

export type ResolvedSourceStatus =
  | "matched"
  | "location_missing"
  | "stale_markdown_range"
  | "unavailable"
  | "deleted";

export type ResolvedSourceState = {
  target: SourceTarget;
  status: ResolvedSourceStatus;
  noteId: string;
  noteTitle: string | null;
  retrievedRevision: string;
  currentRevision: string | null;
  locationLabel: string;
  headingPathLabel: string | null;
  excerpt: string | null;
  resolvedText: string | null;
  stale: boolean;
  warningMessage: string | null;
  blockId?: string;
  markdownRange?: {
    startOffset: number;
    endOffset: number;
  };
};

export type SearchOutcomeKind = "matches" | "no-match" | "index-updating" | "index-failed";

export type SearchOutcome = {
  kind: SearchOutcomeKind;
  query: string;
  candidates: NoteSearchCandidate[];
  coverage: NoteIndexCoverage;
  emptyMessage: string | null;
  coverageNotice: string | null;
  canRetry: boolean;
};

function isBlockNoteDocument(content: NoteContent): content is BlockNoteDocument {
  return typeof content !== "string" && content.format === "blocknote";
}

export function createSearchSourceTarget(
  candidate: NoteSearchCandidate,
  query: string,
): SourceTarget {
  return {
    origin: "search",
    query: query.trim(),
    source: candidate.source,
    excerpt: candidate.text,
    deleted: false,
    stale: false,
  };
}

export function createCitationSourceTarget(citation: ConversationCitation): SourceTarget | null {
  if (citation.source.kind === "web") return null;
  return {
    origin: "citation",
    source: citation.source,
    excerpt: citation.deleted ? null : citation.excerpt,
    deleted: citation.deleted,
    stale: citation.stale,
  };
}

export function formatSourceRevision(version: string): string {
  const unquoted = version.replace(/^W\//, "").replace(/^"|"$/g, "").trim();
  const colonMatch = /:(\d+)$/.exec(unquoted);
  if (colonMatch) {
    return `Revision ${colonMatch[1]}`;
  }
  const suffixMatch = /-v(\d+)$/i.exec(unquoted);
  if (suffixMatch) {
    return `Revision ${suffixMatch[1]}`;
  }
  if (/^\d+$/.test(unquoted)) {
    return `Revision ${unquoted}`;
  }
  return unquoted.length > 0 ? `Revision ${unquoted}` : "Unknown revision";
}

export function formatHeadingPath(headingPath: string[]): string | null {
  return headingPath.length > 0 ? headingPath.join(" / ") : null;
}

export function formatSourceLocation(source: NotePassageSource): string {
  const partSuffix = source.part !== undefined ? ` (part ${source.part + 1})` : "";
  if (source.kind === "block") {
    return `Block ${source.blockId}${partSuffix}`;
  }
  return `UTF-16 range ${source.startOffset}-${source.endOffset}${partSuffix}`;
}

function inlineItemsText(
  items:
    | Array<
        | { type: "text"; text: string }
        | { type: "link"; href: string; content: Array<{ type: "text"; text: string }> }
      >
    | undefined,
): string {
  if (!items) {
    return "";
  }
  let text = "";
  for (const item of items) {
    if (item.type === "text") {
      text += item.text;
      continue;
    }
    for (const child of item.content) {
      text += child.text;
    }
  }
  return text;
}

function findBlockById(blocks: AtlasBlock[], blockId: string): AtlasBlock | null {
  for (const block of blocks) {
    if (block.id === blockId) {
      return block;
    }
    if (block.children.length > 0) {
      const nested = findBlockById(block.children, blockId);
      if (nested) {
        return nested;
      }
    }
  }
  return null;
}

function summarizeBlockText(block: AtlasBlock): string {
  let ownText = "";
  if (block.type === "table") {
    const cellTexts: string[] = [];
    for (const row of block.content.rows) {
      for (const item of row.cells) {
        const text = Array.isArray(item)
          ? inlineItemsText(item).trim()
          : inlineItemsText(item.content).trim();
        if (text.length > 0) {
          cellTexts.push(text);
        }
      }
    }
    ownText = cellTexts.join(" | ");
  } else if (block.type !== "divider") {
    ownText = inlineItemsText(block.content).trim();
  }
  return [ownText, ...block.children.map(summarizeBlockText)]
    .filter((text) => text.length > 0)
    .join("\n");
}

function baseResolvedSource(
  target: SourceTarget,
  options: {
    status: ResolvedSourceStatus;
    noteTitle: string | null;
    currentRevision: string | null;
    excerpt: string | null;
    resolvedText: string | null;
    stale: boolean;
    warningMessage: string | null;
    blockId?: string;
    markdownRange?: { startOffset: number; endOffset: number };
  },
): ResolvedSourceState {
  return {
    target,
    status: options.status,
    noteId: target.source.noteId,
    noteTitle: options.noteTitle,
    retrievedRevision: formatSourceRevision(target.source.version),
    currentRevision: options.currentRevision,
    locationLabel: formatSourceLocation(target.source),
    headingPathLabel: formatHeadingPath(target.source.headingPath),
    excerpt: options.excerpt,
    resolvedText: options.resolvedText,
    stale: options.stale,
    warningMessage: options.warningMessage,
    blockId: options.blockId,
    markdownRange: options.markdownRange,
  };
}

export function resolveDeletedSource(target: SourceTarget): ResolvedSourceState {
  return baseResolvedSource(target, {
    status: "deleted",
    noteTitle: null,
    currentRevision: null,
    excerpt: null,
    resolvedText: null,
    stale: Boolean(target.stale),
    warningMessage:
      "This cited note was deleted. No excerpt is retained for deleted sources, and the current workspace does not store historical note archives.",
  });
}

export function resolveUnavailableSource(target: SourceTarget): ResolvedSourceState {
  if (target.deleted) {
    return resolveDeletedSource(target);
  }
  return baseResolvedSource(target, {
    status: "unavailable",
    noteTitle: null,
    currentRevision: null,
    excerpt: target.excerpt,
    resolvedText: null,
    stale: Boolean(target.stale),
    warningMessage:
      "This source note is no longer available. It may have been deleted after the search index or citation was created.",
  });
}

export function resolveSourceInNote(
  target: SourceTarget,
  snapshot: NoteSnapshot,
): ResolvedSourceState {
  if (target.deleted) {
    return resolveDeletedSource(target);
  }

  const currentRevision = formatSourceRevision(snapshot.etag);
  const retrievedRevision = formatSourceRevision(target.source.version);
  const isStale = Boolean(target.stale) || target.source.version !== snapshot.etag;
  const { source } = target;

  if (source.kind === "block") {
    const content = snapshot.note.content;
    if (!isBlockNoteDocument(content)) {
      return baseResolvedSource(target, {
        status: "location_missing",
        noteTitle: snapshot.note.title,
        currentRevision,
        excerpt: target.excerpt,
        resolvedText: null,
        stale: isStale,
        warningMessage: `Cited block ${source.blockId} from ${retrievedRevision} no longer exists in the current note (${currentRevision}).`,
      });
    }

    const matchedBlock = findBlockById(content.blocks, source.blockId);
    if (!matchedBlock) {
      return baseResolvedSource(target, {
        status: "location_missing",
        noteTitle: snapshot.note.title,
        currentRevision,
        excerpt: target.excerpt,
        resolvedText: null,
        stale: isStale,
        warningMessage: `Cited block ${source.blockId} from ${retrievedRevision} no longer exists in the current note (${currentRevision}).`,
      });
    }

    const blockText = summarizeBlockText(matchedBlock);
    return baseResolvedSource(target, {
      status: "matched",
      noteTitle: snapshot.note.title,
      currentRevision,
      excerpt: target.excerpt,
      resolvedText: blockText.length > 0 ? blockText : null,
      stale: isStale,
      warningMessage: isStale
        ? `This note changed since ${retrievedRevision} (now ${currentRevision}). Review block ${source.blockId} against the current note.`
        : null,
      blockId: source.blockId,
    });
  }

  if (isStale || typeof snapshot.note.content !== "string") {
    return baseResolvedSource(target, {
      status: "stale_markdown_range",
      noteTitle: snapshot.note.title,
      currentRevision,
      excerpt: target.excerpt,
      resolvedText: null,
      stale: true,
      warningMessage: `This note changed since ${retrievedRevision} (now ${currentRevision}). Legacy Markdown UTF-16 range ${source.startOffset}-${source.endOffset} cannot be applied to the modified note.`,
    });
  }

  const markdownContent = snapshot.note.content;
  if (
    source.startOffset < 0 ||
    source.endOffset <= source.startOffset ||
    source.endOffset > markdownContent.length
  ) {
    return baseResolvedSource(target, {
      status: "location_missing",
      noteTitle: snapshot.note.title,
      currentRevision,
      excerpt: target.excerpt,
      resolvedText: null,
      stale: false,
      warningMessage: `Cited UTF-16 range ${source.startOffset}-${source.endOffset} from ${retrievedRevision} is outside the current note bounds.`,
    });
  }

  const sliced = markdownContent.slice(source.startOffset, source.endOffset).trim();
  return baseResolvedSource(target, {
    status: "matched",
    noteTitle: snapshot.note.title,
    currentRevision,
    excerpt: target.excerpt,
    resolvedText: sliced.length > 0 ? sliced : null,
    stale: false,
    warningMessage: null,
    markdownRange: {
      startOffset: source.startOffset,
      endOffset: source.endOffset,
    },
  });
}

export function describeSearchOutcome(query: string, response: NoteSearchResponse): SearchOutcome {
  const trimmedQuery = query.trim();
  const { candidates, coverage } = response;
  const coverageNotice = buildCoverageNotice(coverage);

  if (candidates.length > 0) {
    return {
      kind: "matches",
      query: trimmedQuery,
      candidates,
      coverage,
      emptyMessage: null,
      coverageNotice,
      canRetry: coverage.pending > 0 || coverage.failed > 0,
    };
  }

  if (coverage.pending > 0) {
    return {
      kind: "index-updating",
      query: trimmedQuery,
      candidates: [],
      coverage,
      emptyMessage:
        coverage.failed > 0
          ? coverageNotice
          : `Search index is still updating (${coverage.pending} ${coverage.pending === 1 ? "note" : "notes"} pending). Retry search once indexing finishes.`,
      coverageNotice: null,
      canRetry: true,
    };
  }

  if (coverage.failed > 0) {
    return {
      kind: "index-failed",
      query: trimmedQuery,
      candidates: [],
      coverage,
      emptyMessage: `Search index failed for ${coverage.failed} ${coverage.failed === 1 ? "note" : "notes"}, so matching passages could not be verified. Retry search to try again.`,
      coverageNotice: null,
      canRetry: true,
    };
  }

  return {
    kind: "no-match",
    query: trimmedQuery,
    candidates: [],
    coverage,
    emptyMessage: `No saved notes matched "${trimmedQuery}".`,
    coverageNotice: null,
    canRetry: false,
  };
}

function buildCoverageNotice(coverage: NoteIndexCoverage): string | null {
  if (coverage.pending > 0 && coverage.failed > 0) {
    return `Search index is updating (${coverage.pending} pending) and ${coverage.failed} ${coverage.failed === 1 ? "note" : "notes"} failed to index. Results may be incomplete.`;
  }
  if (coverage.pending > 0) {
    return `Search index is updating (${coverage.pending} ${coverage.pending === 1 ? "note" : "notes"} pending). Results may be incomplete.`;
  }
  if (coverage.failed > 0) {
    return `Indexing failed for ${coverage.failed} ${coverage.failed === 1 ? "note" : "notes"}. Some saved notes may be missing from results.`;
  }
  return null;
}
