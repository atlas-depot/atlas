import { expect, it, vi } from "vite-plus/test";
import type { StoredNote } from "./db/notes.ts";
import { createOrganizeNote, type DraftGenerator } from "./organize-note.ts";

const ownerId = "synthetic-owner";
const noteId = "2db0415f-0e24-4502-8b08-b0f9b78b5d02";
const savedNote: StoredNote = {
  revision: 3,
  note: {
    id: noteId,
    title: "Cedar review",
    content: "Review with Alex on 4 November at 14:00. Budget: 120. Run `pnpm test`.",
    createdAt: "2026-11-01T12:00:00.000Z",
    updatedAt: "2026-11-01T12:15:00.000Z",
  },
};
const draft = {
  markdown: "## Cedar review\n\n- Alex, 4 November, 14:00\n- Budget: 120\n- Run `pnpm test`.",
  sources: [],
};

it.each(["missing-note", "different-owner"])(
  "does not invoke generation when the owner-scoped read rejects %s",
  async (scenario) => {
    const readNote = vi.fn(async (owner: string, id: string) =>
      owner === ownerId && id === noteId ? structuredClone(savedNote) : undefined,
    );
    const generateDraft = vi.fn(async () => draft);
    const organize = createOrganizeNote({ readNote, generateDraft });
    const result = await organize(
      scenario === "different-owner" ? "another-owner" : ownerId,
      scenario === "missing-note" ? "bba7cf95-ebfa-4ff2-aafe-44f23337caa1" : noteId,
      { signal: new AbortController().signal },
    );
    expect(result).toEqual({ status: "not_found" });
    expect(generateDraft).not.toHaveBeenCalled();
  },
);

it("passes only the owned note text and derives provenance from the stored snapshot", async () => {
  const original = structuredClone(savedNote);
  const readNote = vi.fn(async () => original);
  const controller = new AbortController();
  const generateDraft = vi.fn<DraftGenerator>(async (input) => {
    expect(input).toEqual({ title: savedNote.note.title, content: savedNote.note.content });
    input.content = "Generator mutates its own input";
    return draft;
  });
  const result = await createOrganizeNote({ readNote, generateDraft })(ownerId, noteId, {
    signal: controller.signal,
  });
  expect(result).toEqual({
    status: "draft",
    draft,
    source: { noteId, revision: 3, stale: false },
  });
  expect(original).toEqual(savedNote);
  expect(readNote.mock.calls).toEqual([
    [ownerId, noteId],
    [ownerId, noteId],
  ]);
  expect(generateDraft.mock.calls[0][1]).toEqual({ signal: controller.signal });
});

it("returns the generated draft with original provenance when the note changes during generation", async () => {
  const note = structuredClone(savedNote);
  const organize = createOrganizeNote({
    readNote: async () => note,
    generateDraft: async () => {
      note.revision = 4;
      note.note.content = "Updated by the owner while the model runs.";
      return draft;
    },
  });
  expect(await organize(ownerId, noteId, { signal: new AbortController().signal })).toEqual({
    status: "draft",
    draft,
    source: { noteId, revision: 3, stale: true },
  });
});

it("does not return a draft when the owned source is no longer accessible", async () => {
  const readNote = vi
    .fn<() => Promise<StoredNote | undefined>>()
    .mockResolvedValueOnce(savedNote)
    .mockResolvedValueOnce(undefined);
  const organize = createOrganizeNote({ readNote, generateDraft: async () => draft });
  expect(await organize(ownerId, noteId, { signal: new AbortController().signal })).toEqual({
    status: "not_found",
  });
});

it("keeps adapter-supplied research sources alongside Markdown", async () => {
  const researched = {
    markdown: "A researched addition [1].",
    sources: [
      {
        id: "source-1",
        url: "https://example.org/article",
        title: "Public research",
        imageUrl: "https://example.org/preview.png",
      },
    ],
  };
  const organize = createOrganizeNote({
    readNote: async () => savedNote,
    generateDraft: async () => researched,
  });
  expect(await organize(ownerId, noteId, { signal: new AbortController().signal })).toMatchObject({
    status: "draft",
    draft: researched,
  });
});

it.each([
  null,
  { ...draft, markdown: " \n " },
  { ...draft, source: { noteId: "forged", revision: 99 } },
  { ...draft, sources: [{ id: "s1", title: "Unsafe", url: "javascript:alert(1)" }] },
  { ...draft, sources: [{ id: "s1", title: "Malformed", url: "not a URL" }] },
  { ...draft, sources: [{ id: "s1", title: "Unsafe", url: "https://user:secret@example.org" }] },
  {
    ...draft,
    sources: [{ id: "s1", title: "Unsafe", url: "https://example.org", imageUrl: "file:///tmp/x" }],
  },
  {
    ...draft,
    sources: [
      { id: "s1", title: "First", url: "https://example.org/first" },
      { id: "s1", title: "Second", url: "https://example.org/second" },
    ],
  },
])("rejects malformed generated data without exposing it", async (generated) => {
  const organize = createOrganizeNote({
    readNote: async () => savedNote,
    generateDraft: async () => generated,
  });
  expect(await organize(ownerId, noteId, { signal: new AbortController().signal })).toEqual({
    status: "failed",
    reason: "invalid_draft",
  });
});

it.each(["read_failed", "generation_failed"] as const)(
  "does not expose upstream details on %s",
  async (reason) => {
    const fail = async () => {
      throw new Error("SYNTHETIC_PRIVATE_PROVIDER_BODY");
    };
    const organize = createOrganizeNote({
      readNote: reason === "read_failed" ? fail : async () => savedNote,
      generateDraft: reason === "generation_failed" ? fail : async () => draft,
    });
    expect(await organize(ownerId, noteId, { signal: new AbortController().signal })).toEqual({
      status: "failed",
      reason,
    });
  },
);

it("does not start work for an already cancelled request", async () => {
  const readNote = vi.fn(async () => savedNote);
  const generateDraft = vi.fn(async () => draft);
  const organize = createOrganizeNote({ readNote, generateDraft });
  expect(
    await organize(ownerId, noteId, { signal: AbortSignal.abort("SYNTHETIC_PRIVATE_REASON") }),
  ).toEqual({ status: "cancelled" });
  expect(readNote).not.toHaveBeenCalled();
  expect(generateDraft).not.toHaveBeenCalled();
});

it.each(["read", "generate", "recheck"])(
  "rejects a late result after cancellation during %s",
  async (phase) => {
    const controller = new AbortController();
    let reads = 0;
    const generateDraft = vi.fn(async () => {
      if (phase === "generate") controller.abort("SYNTHETIC_PRIVATE_REASON");
      return draft;
    });
    const organize = createOrganizeNote({
      readNote: async () => {
        reads += 1;
        if ((phase === "read" && reads === 1) || (phase === "recheck" && reads === 2)) {
          controller.abort("SYNTHETIC_PRIVATE_REASON");
        }
        return savedNote;
      },
      generateDraft,
    });
    expect(await organize(ownerId, noteId, { signal: controller.signal })).toEqual({
      status: "cancelled",
    });
    if (phase === "read") expect(generateDraft).not.toHaveBeenCalled();
  },
);

it("rejects generated Markdown that cannot fit the existing note Save contract", async () => {
  const run = createOrganizeNote({
    readNote: async () => savedNote,
    generateDraft: async () => ({ markdown: "x".repeat(100_001), sources: [] }),
  });
  expect(await run(ownerId, noteId, { signal: new AbortController().signal })).toEqual({
    status: "failed",
    reason: "invalid_draft",
  });
});
