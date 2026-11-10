import { describe, expect, it } from "vite-plus/test";
import type { ConversationCitation } from "../../shared/conversations";
import type { NoteSnapshot } from "./notes-store";
import {
  createCitationSourceTarget,
  createSearchSourceTarget,
  describeSearchOutcome,
  formatSourceLocation,
  formatSourceRevision,
  resolveDeletedSource,
  resolveSourceInNote,
  resolveUnavailableSource,
} from "./source-location";

const noteId = "f0a10b01-4b98-4d4a-aabb-000000000001";

function createBlockSnapshot(etag = `"${noteId}:2"`): NoteSnapshot {
  return {
    etag,
    note: {
      id: noteId,
      title: "Architecture Runbook",
      content: {
        format: "blocknote",
        schemaVersion: 1,
        blocks: [
          {
            id: "heading-1",
            type: "heading",
            props: {
              backgroundColor: "default",
              textColor: "default",
              textAlignment: "left",
              level: 2,
            },
            content: [{ type: "text", text: "Storage", styles: {} }],
            children: [],
          },
          {
            id: "block-1",
            type: "paragraph",
            props: {
              backgroundColor: "default",
              textColor: "default",
              textAlignment: "left",
            },
            content: [{ type: "text", text: "PostgreSQL stores note revisions.", styles: {} }],
            children: [
              {
                id: "block-nested",
                type: "bulletListItem",
                props: {
                  backgroundColor: "default",
                  textColor: "default",
                  textAlignment: "left",
                },
                content: [{ type: "text", text: "pgvector indexes passages.", styles: {} }],
                children: [],
              },
            ],
          },
        ],
      },
      createdAt: "2026-11-08T10:00:00.000Z",
      updatedAt: "2026-11-08T10:05:00.000Z",
    },
  };
}

function createMarkdownSnapshot(
  content = "## Legacy\n\nUTF-16 offsets point to exact characters.",
  etag = `"${noteId}:1"`,
): NoteSnapshot {
  return {
    etag,
    note: {
      id: noteId,
      title: "Legacy Markdown Note",
      content,
      createdAt: "2026-11-08T09:00:00.000Z",
      updatedAt: "2026-11-08T09:00:00.000Z",
    },
  };
}

describe("source location resolution and search outcome classification", () => {
  it("formats strong ETag revisions and source locations cleanly", () => {
    expect(formatSourceRevision(`"${noteId}:3"`)).toBe("Revision 3");
    expect(formatSourceRevision('"welcome-to-atlas-v1"')).toBe("Revision 1");
    expect(
      formatSourceLocation({
        kind: "block",
        noteId,
        version: `"${noteId}:3"`,
        blockId: "block-1",
        headingPath: ["Storage"],
        part: 1,
      }),
    ).toBe("Block block-1 (part 2)");
    expect(
      formatSourceLocation({
        kind: "markdown",
        noteId,
        version: `"${noteId}:1"`,
        headingPath: [],
        startOffset: 11,
        endOffset: 52,
      }),
    ).toBe("UTF-16 range 11-52");
  });

  it("resolves a matching top-level or nested block at the cited revision without a warning", () => {
    const snapshot = createBlockSnapshot(`"${noteId}:2"`);
    const target = createSearchSourceTarget(
      {
        text: "pgvector indexes passages.",
        score: 0.92,
        source: {
          kind: "block",
          noteId,
          version: `"${noteId}:2"`,
          blockId: "block-nested",
          headingPath: ["Storage"],
        },
      },
      "pgvector",
    );

    const resolved = resolveSourceInNote(target, snapshot);
    expect(resolved).toMatchObject({
      status: "matched",
      noteId,
      noteTitle: "Architecture Runbook",
      retrievedRevision: "Revision 2",
      currentRevision: "Revision 2",
      locationLabel: "Block block-nested",
      headingPathLabel: "Storage",
      excerpt: "pgvector indexes passages.",
      resolvedText: "pgvector indexes passages.",
      stale: false,
      warningMessage: null,
      blockId: "block-nested",
    });
  });

  it("warns when the note revision changed after retrieval while still resolving an existing block", () => {
    const snapshot = createBlockSnapshot(`"${noteId}:4"`);
    const target = createSearchSourceTarget(
      {
        text: "PostgreSQL stores note revisions.",
        score: 0.88,
        source: {
          kind: "block",
          noteId,
          version: `"${noteId}:2"`,
          blockId: "block-1",
          headingPath: ["Storage"],
        },
      },
      "PostgreSQL",
    );

    const resolved = resolveSourceInNote(target, snapshot);
    expect(resolved.status).toBe("matched");
    expect(resolved.stale).toBe(true);
    expect(resolved.blockId).toBe("block-1");
    expect(resolved.warningMessage).toContain(
      "This note changed since Revision 2 (now Revision 4).",
    );
  });

  it("includes descendant content when a parent block is the cited source", () => {
    const snapshot = createBlockSnapshot();
    const target = createSearchSourceTarget(
      {
        text: "PostgreSQL stores note revisions.\n  - pgvector indexes passages.",
        score: 0.92,
        source: {
          kind: "block",
          noteId,
          version: snapshot.etag,
          blockId: "block-1",
          headingPath: ["Storage"],
        },
      },
      "pgvector",
    );

    expect(resolveSourceInNote(target, snapshot)).toMatchObject({
      status: "matched",
      blockId: "block-1",
      resolvedText: "PostgreSQL stores note revisions.\npgvector indexes passages.",
      warningMessage: null,
    });
  });

  it("reports location_missing when the cited block ID no longer exists instead of claiming another block", () => {
    const snapshot = createBlockSnapshot(`"${noteId}:3"`);
    const target = createSearchSourceTarget(
      {
        text: "Removed block excerpt.",
        score: 0.79,
        source: {
          kind: "block",
          noteId,
          version: `"${noteId}:2"`,
          blockId: "block-removed",
          headingPath: ["Storage"],
        },
      },
      "Removed",
    );

    const resolved = resolveSourceInNote(target, snapshot);
    expect(resolved.status).toBe("location_missing");
    expect(resolved.blockId).toBeUndefined();
    expect(resolved.resolvedText).toBeNull();
    expect(resolved.warningMessage).toContain(
      "Cited block block-removed from Revision 2 no longer exists in the current note (Revision 3).",
    );
  });

  it("resolves a legacy Markdown UTF-16 range when the cited revision matches the current note", () => {
    const content = "## Legacy\n\nUTF-16 offsets point to exact characters.";
    const snapshot = createMarkdownSnapshot(content, `"${noteId}:1"`);
    const target = createSearchSourceTarget(
      {
        text: "UTF-16 offsets point to exact characters.",
        score: 0.85,
        source: {
          kind: "markdown",
          noteId,
          version: `"${noteId}:1"`,
          headingPath: ["Legacy"],
          startOffset: 11,
          endOffset: content.length,
        },
      },
      "UTF-16",
    );

    const resolved = resolveSourceInNote(target, snapshot);
    expect(resolved).toMatchObject({
      status: "matched",
      stale: false,
      warningMessage: null,
      resolvedText: "UTF-16 offsets point to exact characters.",
      markdownRange: {
        startOffset: 11,
        endOffset: content.length,
      },
    });
  });

  it("never applies a stale Markdown UTF-16 range to a modified note revision", () => {
    const snapshot = createMarkdownSnapshot(
      "## Legacy\n\nInserted prefix shifts every character offset.",
      `"${noteId}:2"`,
    );
    const target = createSearchSourceTarget(
      {
        text: "UTF-16 offsets point to exact characters.",
        score: 0.85,
        source: {
          kind: "markdown",
          noteId,
          version: `"${noteId}:1"`,
          headingPath: ["Legacy"],
          startOffset: 11,
          endOffset: 52,
        },
      },
      "UTF-16",
    );

    const resolved = resolveSourceInNote(target, snapshot);
    expect(resolved.status).toBe("stale_markdown_range");
    expect(resolved.stale).toBe(true);
    expect(resolved.markdownRange).toBeUndefined();
    expect(resolved.resolvedText).toBeNull();
    expect(resolved.warningMessage).toContain(
      "Legacy Markdown UTF-16 range 11-52 cannot be applied to the modified note.",
    );
  });

  it("supports reusable chat citations including deleted sources with no retained excerpt", () => {
    const deletedCitation: ConversationCitation = {
      source: {
        kind: "block",
        noteId,
        version: `"${noteId}:2"`,
        blockId: "block-1",
        headingPath: ["Storage"],
      },
      excerpt: null,
      stale: false,
      deleted: true,
    };

    const target = createCitationSourceTarget(deletedCitation);
    const resolved = resolveDeletedSource(target);
    expect(resolved.status).toBe("deleted");
    expect(resolved.excerpt).toBeNull();
    expect(resolved.warningMessage).toContain("This cited note was deleted.");

    const unavailable = resolveUnavailableSource(
      createSearchSourceTarget(
        {
          text: "Cached search excerpt",
          score: 0.77,
          source: deletedCitation.source,
        },
        "storage",
      ),
    );
    expect(unavailable.status).toBe("unavailable");
    expect(unavailable.excerpt).toBe("Cached search excerpt");
  });

  it("distinguishes matches, no-match, index-updating, and index-failed outcomes", () => {
    const noMatch = describeSearchOutcome("missing", {
      candidates: [],
      coverage: { ready: 4, pending: 0, failed: 0 },
    });
    expect(noMatch.kind).toBe("no-match");
    expect(noMatch.canRetry).toBe(false);
    expect(noMatch.emptyMessage).toBe('No saved notes matched "missing".');

    const updating = describeSearchOutcome("pending query", {
      candidates: [],
      coverage: { ready: 2, pending: 1, failed: 0 },
    });
    expect(updating.kind).toBe("index-updating");
    expect(updating.canRetry).toBe(true);
    expect(updating.emptyMessage).toContain("Search index is still updating (1 note pending).");

    const failed = describeSearchOutcome("failed query", {
      candidates: [],
      coverage: { ready: 1, pending: 0, failed: 2 },
    });
    expect(failed.kind).toBe("index-failed");
    expect(failed.canRetry).toBe(true);
    expect(failed.emptyMessage).toContain("Search index failed for 2 notes");

    const matchesWithPending = describeSearchOutcome("storage", {
      candidates: [
        {
          text: "PostgreSQL stores note revisions.",
          score: 0.91,
          source: {
            kind: "block",
            noteId,
            version: `"${noteId}:2"`,
            blockId: "block-1",
            headingPath: ["Storage"],
          },
        },
      ],
      coverage: { ready: 2, pending: 1, failed: 0 },
    });
    expect(matchesWithPending.kind).toBe("matches");
    expect(matchesWithPending.canRetry).toBe(true);
    expect(matchesWithPending.coverageNotice).toContain(
      "Search index is updating (1 note pending).",
    );
  });

  it("reports both pending and failed indexing when no candidates are available", () => {
    const outcome = describeSearchOutcome("storage", {
      candidates: [],
      coverage: { ready: 0, pending: 2, failed: 3 },
    });
    expect(outcome.kind).toBe("index-updating");
    expect(outcome.emptyMessage).toContain("3 notes failed to index");
    expect(outcome.emptyMessage).toMatch(/2 (?:notes )?pending/);
    expect(outcome.coverageNotice).toBeNull();
    expect(outcome.canRetry).toBe(true);
  });
});
