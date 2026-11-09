import type { createNoteIndexJobs } from "../../server/db/note-index-jobs.ts";
import type { createNoteIndexStore } from "../../server/db/note-index.ts";
import { projectNotePassages } from "../../server/passages.ts";
import { indexClaimSchema, type IndexClaim } from "../../shared/index-jobs.ts";
import { NoteEmbeddingError } from "./embeddings.ts";
import { indexRetryAt } from "./index-coordinator.ts";

export type IndexOutcome = "published" | "superseded" | "failed";
export function createIndexProcessor(ports: {
  jobs: Pick<ReturnType<typeof createNoteIndexJobs>, "bind" | "fail">;
  store: Pick<ReturnType<typeof createNoteIndexStore>, "publish">;
  embed(texts: string[]): Promise<number[][]>;
  now?: () => number;
  random?: () => number;
}) {
  return async (input: IndexClaim, runId: string): Promise<IndexOutcome> => {
    const parsed = indexClaimSchema.safeParse(input);
    if (!parsed.success) throw new Error("Invalid note index claim.");
    const claim = parsed.data;
    // Bind is the provider admission gate. A duplicate Workflow ID cannot bind a
    // claimed intent, and a replay after publication sees no intent at all.
    const current = await ports.jobs.bind(claim, runId);
    if (!current) return "superseded";
    try {
      const projection = projectNotePassages({
        noteId: claim.noteId,
        version: JSON.stringify(`${claim.noteId}:${claim.revision}`),
        content: current.note.content,
      });
      if (projection.status !== "complete" && projection.status !== "empty") {
        await ports.jobs.fail(claim, runId, "unsupported_content", null);
        return "failed";
      }
      const embeddings = projection.passages.length
        ? await ports.embed(projection.passages.map((passage) => passage.text))
        : [];
      const result = await ports.store.publish(
        current.ownerId,
        {
          noteId: claim.noteId,
          revision: claim.revision,
          fingerprint: claim.fingerprint,
          projection,
          embeddings,
        },
        { claim, runId },
      );
      return result === "published" || result === "already_ready" ? "published" : "superseded";
    } catch (error) {
      const code = error instanceof NoteEmbeddingError ? error.code : "runtime_failed";
      await ports.jobs.fail(
        claim,
        runId,
        code,
        indexRetryAt(current.attempts + 1, ports.now?.(), ports.random),
      );
      return "failed";
    }
  };
}
