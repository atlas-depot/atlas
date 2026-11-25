import { describe, expect, it } from "vite-plus/test";
import type { BlockNoteDocument } from "../../shared/document";
import type { Note, NoteSummary } from "../../shared/notes";
import {
  buildInternalNoteHref,
  extractLinkedNoteIds,
  formatNoteAuthorship,
  formatNoteTimestamp,
  getNoteAuthorship,
  parseInternalNoteHref,
  resolveNoteSources,
  resolveOriginSource,
} from "./note-metadata";

const meetingId = "11111111-1111-4111-8111-111111111111";
const checklistId = "22222222-2222-4222-8222-222222222222";
const planningId = "33333333-3333-4333-8333-333333333333";
const planId = "44444444-4444-4444-8444-444444444444";
const foreignId = "55555555-5555-4555-8555-555555555555";

const ownedNotes: NoteSummary[] = [
  {
    id: meetingId,
    title: "Meeting agenda",
    createdAt: "2026-11-20T09:00:00.000Z",
    updatedAt: "2026-11-20T09:30:00.000Z",
  },
  {
    id: planningId,
    title: "Planning notes",
    createdAt: "2026-11-21T10:00:00.000Z",
    updatedAt: "2026-11-21T11:15:00.000Z",
  },
];

describe("note metadata helpers", () => {
  it("classifies user-authored and AI-generated notes from server origin", () => {
    expect(getNoteAuthorship({})).toBe("user");
    expect(formatNoteAuthorship({})).toBe("User-authored");
    expect(
      getNoteAuthorship({
        origin: { sourceNoteId: planningId, sourceRevision: 2, sources: [] },
      }),
    ).toBe("ai");
    expect(
      formatNoteAuthorship({
        origin: { sourceNoteId: planningId, sourceRevision: 2, sources: [] },
      }),
    ).toBe("AI-generated");
  });

  it("formats timestamps in the requested locale and falls back on invalid values", () => {
    const formatted = formatNoteTimestamp("2026-11-25T14:30:00.000Z", "en-US");
    expect(formatted).toContain("2026");
    expect(formatNoteTimestamp("not-a-date", "en-US")).toBe("not-a-date");
  });

  it("parses only relative or same-origin /notes/:uuid links", () => {
    const hexId = "a1b2c3d4-1111-4111-8111-abcdef123456";
    expect(buildInternalNoteHref(hexId.toUpperCase())).toBe(`/notes/${hexId}`);
    expect(buildInternalNoteHref(hexId.toUpperCase(), "https://atlas.example/")).toBe(
      `https://atlas.example/notes/${hexId}`,
    );
    expect(parseInternalNoteHref(`/notes/${hexId.toUpperCase()}`)).toBe(hexId);
    expect(parseInternalNoteHref(`/notes/${meetingId}`)).toBe(meetingId);
    expect(
      parseInternalNoteHref(`https://atlas.example/notes/${meetingId}`, "https://atlas.example"),
    ).toBe(meetingId);
    expect(
      parseInternalNoteHref(`https://evil.example/notes/${meetingId}`, "https://atlas.example"),
    ).toBeNull();
    expect(parseInternalNoteHref(`/notes/${meetingId}?extra=1`)).toBeNull();
    expect(parseInternalNoteHref(`/notes/not-a-uuid`)).toBeNull();
    expect(parseInternalNoteHref(`//evil.example/notes/${meetingId}`)).toBeNull();
  });

  it("extracts linked note IDs from BlockNote documents and ignores code and unused references in Markdown", () => {
    const doc: BlockNoteDocument = {
      format: "blocknote",
      schemaVersion: 1,
      blocks: [
        {
          id: "b1",
          type: "paragraph",
          props: { backgroundColor: "default", textColor: "default", textAlignment: "left" },
          content: [
            { type: "text", text: "From ", styles: {} },
            {
              type: "link",
              href: `/notes/${meetingId}`,
              content: [{ type: "text", text: "Meeting agenda", styles: {} }],
            },
            {
              type: "link",
              href: "https://example.com/docs",
              content: [{ type: "text", text: "External", styles: {} }],
            },
          ],
          children: [],
        },
      ],
    };
    expect(extractLinkedNoteIds(doc)).toEqual([meetingId]);

    const markdown = [
      `Review [Meeting agenda](/notes/${meetingId}) and [missing](/notes/${foreignId}).`,
      "",
      "```md",
      `[Inside fenced code](/notes/${planningId})`,
      "```",
      "",
      `    [Inside indented code](/notes/${planId})`,
      "",
      `Inline code \`[ignored](/notes/${planId})\` stays ignored.`,
    ].join("\n");
    expect(extractLinkedNoteIds(markdown)).toEqual([meetingId, foreignId]);

    // Unused reference definitions produce no source; used reference links resolve normally.
    const unusedRefOnly = `[unused]: /notes/${meetingId}\n`;
    expect(extractLinkedNoteIds(unusedRefOnly)).toEqual([]);

    const usedRefs = [
      "See [Meeting agenda][agenda], [Planning][], and [Checklist].",
      "",
      `[agenda]: /notes/${meetingId}`,
      `[planning]: /notes/${planningId}`,
      `[checklist]: /notes/${checklistId}`,
      `[unused]: /notes/${foreignId}`,
    ].join("\n");
    expect(extractLinkedNoteIds(usedRefs)).toEqual([meetingId, planningId, checklistId]);
  });

  it("handles pathological unmatched brackets in linear time", () => {
    const pathological = "[".repeat(100_000);
    const startedAt = performance.now();
    expect(extractLinkedNoteIds(pathological)).toEqual([]);
    expect(performance.now() - startedAt).toBeLessThan(1_000);
  });

  it("resolves owned and unavailable sources without exposing inaccessible target metadata", () => {
    const generated: Pick<Note, "id" | "origin" | "content"> = {
      id: planId,
      origin: { sourceNoteId: planningId, sourceRevision: 2, sources: [] },
      content: "Generated body",
    };
    expect(resolveNoteSources(generated, ownedNotes)).toEqual([
      {
        kind: "origin",
        status: "available",
        noteId: planningId,
        title: "Planning notes",
        revision: 2,
      },
    ]);

    expect(
      resolveOriginSource({ sourceNoteId: foreignId, sourceRevision: 1, sources: [] }, ownedNotes),
    ).toEqual({
      status: "unavailable",
      noteId: foreignId,
      revision: 1,
    });

    const authoredLinked: Pick<Note, "id" | "origin" | "content"> = {
      id: checklistId,
      content: `Source: [Meeting agenda](/notes/${meetingId}) and [Secret](/notes/${foreignId})`,
    };
    expect(resolveNoteSources(authoredLinked, ownedNotes)).toEqual([
      {
        kind: "link",
        status: "available",
        noteId: meetingId,
        title: "Meeting agenda",
      },
      {
        kind: "link",
        status: "unavailable",
        noteId: foreignId,
      },
    ]);
  });
});
