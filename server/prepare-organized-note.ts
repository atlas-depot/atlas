import type { StoredNote } from "./db/notes.ts";
import { createOrganizeNote, type OrganizeNoteResult } from "./organize-note.ts";

type Retirement = { status: "ended" | "expired" };
type PreparationOptions = {
  signal: AbortSignal;
  onProgress?: (phase: "researching" | "writing") => void;
};
export type PreparedGeneration = {
  draft: unknown;
  acknowledge: () => Promise<Retirement>;
  discard: () => Promise<Retirement>;
};

export type PreparedNoteResult =
  | Exclude<OrganizeNoteResult, { status: "draft" }>
  | (Extract<OrganizeNoteResult, { status: "draft" }> &
      Pick<PreparedGeneration, "acknowledge" | "discard">);

/** Server-only lifecycle handles. The HTTP layer must bind delivery and acknowledgement to the owner. */
export function createPrepareOrganizedNote({
  readNote,
  prepare,
}: {
  readNote: (ownerId: string, noteId: string) => Promise<StoredNote | undefined>;
  prepare: (
    note: { title: string; content: string },
    options: PreparationOptions,
  ) => Promise<PreparedGeneration>;
}) {
  return async (
    ownerId: string,
    noteId: string,
    options: PreparationOptions,
  ): Promise<PreparedNoteResult> => {
    let generation: PreparedGeneration | undefined;
    const organize = createOrganizeNote({
      readNote,
      generateDraft: async (note, input) => {
        generation = await prepare(note, { ...input, onProgress: options.onProgress });
        return generation.draft;
      },
    });
    const result = await organize(ownerId, noteId, options);
    if (!generation) {
      return result.status === "draft" ? { status: "failed", reason: "invalid_draft" } : result;
    }

    const { acknowledge, discard } = generation;
    if (result.status === "draft") {
      return {
        ...result,
        acknowledge,
        discard,
      };
    }

    // Ownership, validation or cancellation can reject a completed generation.
    // Do not leave its private history behind or mark rejection as successful delivery.
    try {
      await discard();
      return result;
    } catch {
      return {
        status: "failed",
        reason: "cleanup_failed",
        retryCleanup: discard,
      };
    }
  };
}
