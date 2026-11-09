import { indexClaimSchema, type IndexClaim, type IndexRunStatus } from "../../shared/index-jobs.ts";
import type { createNoteIndexJobs } from "../../server/db/note-index-jobs.ts";
import type { IndexStartResult } from "./index-client.ts";

type Jobs = ReturnType<typeof createNoteIndexJobs>;
export type IndexCoordinatorPorts = {
  jobs: Pick<Jobs, "claimWithAttempt" | "recordRun" | "fail" | "pending" | "release">;
  runtimeUrl: string;
  startRun(claim: IndexClaim): Promise<string>;
  status(runtimeUrl: string, runId: string): Promise<IndexRunStatus>;
  now?: () => number;
  random?: () => number;
};

/** One automatic retry policy, outside SDK retries. Cap exponent and delay for long outages. */
export function indexRetryAt(attempt: number, now = Date.now(), random = Math.random): Date {
  const cap = Math.min(900_000, 30_000 * 2 ** Math.min(5, Math.max(0, attempt - 1)));
  return new Date(now + Math.floor(Math.max(0, Math.min(1, random())) * cap));
}

export function createIndexCoordinator(ports: IndexCoordinatorPorts) {
  const now = ports.now ?? Date.now;
  const retry = (attempt: number) => indexRetryAt(attempt, now(), ports.random);
  const start = async (noteId: string): Promise<IndexStartResult> => {
    const allocated = await ports.jobs.claimWithAttempt(noteId, ports.runtimeUrl);
    if (!allocated) return { status: "unchanged" };
    const { claim, attempts } = allocated;
    let runId: string;
    try {
      runId = await ports.startRun(claim);
    } catch {
      // A timed-out start might still have enqueued a run. Keep its token until the
      // allocation grace expires; a late old run must bind before using the provider.
      await ports.jobs.fail(claim, null, "runtime_unavailable", retry(attempts + 1));
      throw new Error("Note index runtime is unavailable.");
    }
    await ports.jobs.recordRun(claim, runId);
    return { status: "started", runId };
  };
  return {
    start,
    async sweep(limit = 5) {
      const counts = { checked: 0, started: 0, released: 0, uncertain: 0 };
      for (const row of await ports.jobs.pending(limit)) {
        counts.checked++;
        try {
          if (!row.token) {
            if ((await start(row.noteId)).status === "started") counts.started++;
            continue;
          }
          const parsed = indexClaimSchema.safeParse({
            noteId: row.noteId,
            revision: row.revision,
            fingerprint: row.fingerprint,
            token: row.token,
            runtimeUrl: row.runtimeUrl,
          });
          if (!parsed.success) {
            counts.uncertain++;
            continue;
          }
          const claim = parsed.data;
          if (!row.runId) {
            if (!row.claimedAt || now() - Date.parse(row.claimedAt) < 120_000) continue;
          } else {
            const status = await ports.status(claim.runtimeUrl, row.runId);
            if (status === "pending" || status === "running") continue;
            if (!row.failureCode) {
              await ports.jobs.fail(
                claim,
                row.runId,
                status === "completed" ? "completion_missing" : "runtime_failed",
                retry(row.attempts + 1),
              );
            }
          }
          if (await ports.jobs.release(claim, row.runId)) {
            counts.released++;
            if ((await start(row.noteId)).status === "started") counts.started++;
          }
        } catch {
          // Network/404/configuration failures do not prove a run stopped. Keep
          // claims and do not expose service URLs, note text or provider details.
          counts.uncertain++;
        }
      }
      return counts;
    },
  };
}
