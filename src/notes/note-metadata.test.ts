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
const fencedId = "66666666-6666-4666-8666-666666666666";
const indentedId = "77777777-7777-4777-8777-777777777777";
const inlineCodeId = "88888888-8888-4888-8888-888888888888";
const imageId = "99999999-9999-4999-8999-999999999999";
const htmlId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const unusedId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

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
    const iso = "2026-11-25T14:30:00.000Z";
    const expectedUs = new Intl.DateTimeFormat("en-US", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(iso));
    const expectedDe = new Intl.DateTimeFormat("de-DE", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(iso));
    expect(formatNoteTimestamp(iso, "en-US")).toBe(expectedUs);
    expect(formatNoteTimestamp(iso, "de-DE")).toBe(expectedDe);
    expect(formatNoteTimestamp(iso, "en-US")).not.toBe(formatNoteTimestamp(iso, "de-DE"));
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

  it("extracts linked note IDs from BlockNote documents and rendered Markdown links", () => {
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
      `Titled [Planning notes](/notes/${planningId} "planning") also counts.`,
      `Encoded [Plan](/no&#116;es/${planId}) also counts.`,
      "",
      "```md",
      `[Fenced code](/notes/${fencedId})`,
      "```",
      "",
      `    [Indented code](/notes/${indentedId})`,
      "",
      `Inline code \`[ignored](/notes/${inlineCodeId})\` stays ignored.`,
      "",
      `![Image destination](/notes/${imageId})`,
      "",
      `<a href="/notes/${htmlId}">Raw HTML stays ignored</a>`,
      "",
      "See [Meeting agenda][agenda], [collapsed][], and [shortcut].",
      "",
      `[agenda]: /notes/${checklistId}`,
      `[collapsed]: /notes/${planningId}`,
      `[shortcut]: /notes/${foreignId}`,
      `[unused]: /notes/${unusedId}`,
    ].join("\n");
    expect(extractLinkedNoteIds(markdown)).toEqual([
      meetingId,
      foreignId,
      planningId,
      planId,
      checklistId,
    ]);

    const unusedRefOnly = `[unused]: /notes/${unusedId}\n`;
    expect(extractLinkedNoteIds(unusedRefOnly)).toEqual([]);

    const encoded = `[Plan](/no&#116;es/${meetingId})`;
    expect(extractLinkedNoteIds(encoded)).toEqual([meetingId]);

    const duplicateDefinitions = [
      "See [Agenda].",
      "",
      `[Agenda]: /notes/${meetingId}`,
      `[Agenda]: /notes/${foreignId}`,
    ].join("\n");
    expect(extractLinkedNoteIds(duplicateDefinitions)).toEqual([meetingId]);

    const footnotes = [
      "Used footnote[^used].",
      "",
      `[^used]: [Agenda](/notes/${meetingId})`,
      `[^unused]: [Missing](/notes/${foreignId})`,
    ].join("\n");
    expect(extractLinkedNoteIds(footnotes)).toEqual([meetingId]);

    const absolute = `[Meeting agenda](https://atlas.example/notes/${meetingId})`;
    expect(extractLinkedNoteIds(absolute, { currentOrigin: "https://atlas.example" })).toEqual([
      meetingId,
    ]);

    const autolinks = [
      `Angle autolink <https://atlas.example/notes/${meetingId}> and bare https://atlas.example/notes/${planningId}.`,
      `External autolink <https://evil.example/notes/${foreignId}> stays ignored.`,
    ].join("\n");
    expect(extractLinkedNoteIds(autolinks, { currentOrigin: "https://atlas.example" })).toEqual([
      meetingId,
      planningId,
    ]);
  });

  it("stays bounded for large notes with and without internal links", () => {
    const fastPath = ["[".repeat(100_000), "[](a ".repeat(20_000), "[](<\n".repeat(20_000) + ">"];
    const parsed = [
      "[".repeat(100_000) + ` [link](/notes/${meetingId})`,
      "[](a ".repeat(1_000) + ` [link](/notes/${meetingId})`,
      "[](<\n".repeat(1_000) + ">" + ` [link](/notes/${meetingId})`,
    ];
    const manyLinks = `[link](/notes/${meetingId}) `.repeat(1_000);
    const startedAt = performance.now();
    for (const content of fastPath) {
      expect(extractLinkedNoteIds(content)).toEqual([]);
    }
    for (const content of parsed) {
      expect(extractLinkedNoteIds(content)).toEqual([meetingId]);
    }
    expect(extractLinkedNoteIds(manyLinks)).toEqual([meetingId]);
    expect(performance.now() - startedAt).toBeLessThan(5_000);
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
