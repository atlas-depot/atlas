import { FatalError, getWorkflowMetadata } from "eve/workflow";
import { openDatabase, readDatabaseUrl } from "../../server/db/connection.ts";
import { createNoteIndexJobs } from "../../server/db/note-index-jobs.ts";
import { createNoteIndexStore } from "../../server/db/note-index.ts";
import type { IndexClaim } from "../../shared/index-jobs.ts";
import { createNoteEmbedder } from "./embeddings.ts";
import { createIndexProcessor } from "./index-processor.ts";

export async function indexNoteWorkflow(claim: IndexClaim) {
  "use workflow";
  return indexNoteStep(claim, getWorkflowMetadata().workflowRunId);
}

/** Note text and vectors stay inside this single step, never in durable arguments/results. */
export async function indexNoteStep(claim: IndexClaim, runId: string) {
  "use step";
  try {
    const connection = openDatabase(readDatabaseUrl(process.env), { max: 1, lockTimeoutMs: 5_000 });
    try {
      const processIndex = createIndexProcessor({
        jobs: createNoteIndexJobs(connection.db),
        store: createNoteIndexStore(connection.db),
        embed: (texts) =>
          createNoteEmbedder({ apiKey: process.env.OPENROUTER_API_KEY ?? "" })(texts),
      });
      return await processIndex(claim, runId);
    } finally {
      await connection.close();
    }
  } catch {
    // Workflow records thrown errors. Never persist a DB/provider error or its
    // cause. The reconciler observes this terminal run and schedules one retry.
    throw new FatalError("Note indexing failed.");
  }
}
