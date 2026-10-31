import { expect, it, vi } from "vite-plus/test";
import type { StoredNote } from "./db/notes.ts";
import { createPrepareOrganizedNote } from "./prepare-organized-note.ts";
import { GenerationCleanupError } from "./organize-note.ts";

const note: StoredNote = {
  revision: 3,
  note: {
    id: "2db0415f-0e24-4502-8b08-b0f9b78b5d02",
    title: "Cedar review",
    content: "Alex, 4 November, 14:00. Budget: 120.",
    createdAt: "2026-11-01T12:00:00.000Z",
    updatedAt: "2026-11-01T12:00:00.000Z",
  },
};

function generation(draft: unknown = { markdown: "# Cedar review", sources: [] }) {
  return {
    draft,
    acknowledge: vi.fn(async () => ({ status: "expired" as const })),
    discard: vi.fn(async () => ({ status: "expired" as const })),
  };
}

it("never starts private generation for an inaccessible source", async () => {
  const prepare = vi.fn(async () => generation());
  const run = createPrepareOrganizedNote({ readNote: async () => undefined, prepare });
  expect(await run("other-owner", note.note.id, { signal: new AbortController().signal })).toEqual({
    status: "not_found",
  });
  expect(prepare).not.toHaveBeenCalled();
});

it("keeps successful output until explicit delivery acknowledgement", async () => {
  const prepared = generation();
  const run = createPrepareOrganizedNote({
    readNote: async () => note,
    prepare: async () => prepared,
  });
  const result = await run("owner", note.note.id, { signal: new AbortController().signal });
  expect(result.status).toBe("draft");
  expect(prepared.acknowledge).not.toHaveBeenCalled();
  expect(prepared.discard).not.toHaveBeenCalled();
  if (result.status !== "draft") throw new Error("Expected draft");
  expect(result.source).toEqual({ noteId: note.note.id, revision: 3, stale: false });
  expect(await result.acknowledge()).toEqual({ status: "expired" });
  expect(prepared.acknowledge).toHaveBeenCalledOnce();
});

it.each(["deleted", "read-failed", "invalid-output", "cancelled"])(
  "discards generated history without exposing the draft after %s",
  async (failure) => {
    const controller = new AbortController();
    const prepared = generation(failure === "invalid-output" ? { markdown: "" } : undefined);
    let reads = 0;
    const run = createPrepareOrganizedNote({
      readNote: async () => {
        reads += 1;
        if (reads === 2 && failure === "deleted") return undefined;
        if (reads === 2 && failure === "read-failed") throw new Error("private driver details");
        return note;
      },
      prepare: async () => {
        if (failure === "cancelled") controller.abort();
        return prepared;
      },
    });
    const result = await run("owner", note.note.id, { signal: controller.signal });
    expect(result.status).not.toBe("draft");
    expect(result).not.toHaveProperty("draft");
    expect(prepared.discard).toHaveBeenCalledOnce();
    expect(prepared.acknowledge).not.toHaveBeenCalled();
  },
);

it("preserves a retryable cleanup handle when rejected output could not be retired", async () => {
  const prepared = generation({ markdown: "" });
  prepared.discard.mockRejectedValueOnce(new Error("private remote details"));
  const run = createPrepareOrganizedNote({
    readNote: async () => note,
    prepare: async () => prepared,
  });
  const result = await run("owner", note.note.id, { signal: new AbortController().signal });
  expect(result).toMatchObject({ status: "failed", reason: "cleanup_failed" });
  if (!("retryCleanup" in result)) throw new Error("Expected cleanup retry");
  expect(result).not.toHaveProperty("draft");
  expect(await result.retryCleanup()).toEqual({ status: "expired" });
  expect(prepared.discard).toHaveBeenCalledTimes(2);
});

it("allows discarding a delivered but unsaved draft without acknowledging it", async () => {
  const prepared = generation();
  const run = createPrepareOrganizedNote({
    readNote: async () => note,
    prepare: async () => prepared,
  });
  const result = await run("owner", note.note.id, { signal: new AbortController().signal });
  if (result.status !== "draft") throw new Error("Expected draft");
  await result.discard();
  expect(prepared.discard).toHaveBeenCalledOnce();
  expect(prepared.acknowledge).not.toHaveBeenCalled();
});

it("retains cleanup recovery even when generation never returns a draft handle", async () => {
  const retryCleanup = vi.fn(async () => ({ status: "expired" as const }));
  const prepare = vi.fn(async () => {
    throw new GenerationCleanupError(retryCleanup);
  });
  const run = createPrepareOrganizedNote({ readNote: async () => note, prepare });
  const result = await run("owner", note.note.id, { signal: new AbortController().signal });
  expect(result).toMatchObject({ status: "failed", reason: "cleanup_failed" });
  if (!("retryCleanup" in result)) throw new Error("Expected cleanup retry");
  expect(await result.retryCleanup()).toEqual({ status: "expired" });
  expect(prepare).toHaveBeenCalledOnce();
  expect(retryCleanup).toHaveBeenCalledOnce();
});
