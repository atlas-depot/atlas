import { randomUUID } from "node:crypto";
import type { OrganizeNoteResult } from "./organize-note.ts";
import type { PreparedNoteResult } from "./prepare-organized-note.ts";

type Draft = Extract<PreparedNoteResult, { status: "draft" }>;
type Retirement = { status: "ended" | "expired" };
export type OrganizeRunState =
  | Exclude<OrganizeNoteResult, { reason: "cleanup_failed" }>
  | { status: "running"; phase: "starting" | "researching" | "writing" }
  | { status: "cleaning" | "expired" }
  | { status: "failed"; reason: "cleanup_failed" };
type Entry = {
  ownerId: string;
  noteId: string;
  runId: string;
  controller: AbortController;
  state: OrganizeRunState;
  work: Promise<void>;
  prepared?: Draft;
  cleanup?: () => Promise<Retirement>;
  target?: "expired" | "cancelled";
  cleaning?: Promise<OrganizeRunState>;
  expiresAt?: number;
  timer?: ReturnType<typeof setTimeout>;
};

/** Single-process reconnect support. A lost process loses run handles, never silently restarts them. */
export function createOrganizeRuns({
  prepareNote,
  resultRetentionMs,
  now = Date.now,
  newRunId = randomUUID,
}: {
  prepareNote: (
    ownerId: string,
    noteId: string,
    options: { signal: AbortSignal; onProgress?: (phase: "researching" | "writing") => void },
  ) => Promise<PreparedNoteResult>;
  resultRetentionMs: number;
  now?: () => number;
  newRunId?: () => string;
}) {
  if (
    !Number.isSafeInteger(resultRetentionMs) ||
    resultRetentionMs <= 0 ||
    resultRetentionMs > 2_147_483_647
  ) {
    throw new Error("Result retention must be a positive timer-safe integer.");
  }
  const entries = new Map<string, Entry>();
  const active = new Map<string, string>();
  const key = (ownerId: string, noteId: string) => JSON.stringify([ownerId, noteId]);
  let disposed = false;
  const clearExpiry = (entry: Entry) => {
    clearTimeout(entry.timer);
    entry.timer = undefined;
    entry.expiresAt = undefined;
  };
  const armExpiry = (entry: Entry, expire: () => void) => {
    clearExpiry(entry);
    entry.expiresAt = now() + resultRetentionMs;
    entry.timer = setTimeout(expire, resultRetentionMs);
    entry.timer.unref();
  };
  const terminal = (entry: Entry, state: OrganizeRunState) => {
    entry.state = state;
    entry.prepared = undefined;
    entry.cleanup = undefined;
    entry.target = undefined;
    const identity = key(entry.ownerId, entry.noteId);
    if (active.get(identity) === entry.runId) active.delete(identity);
    armExpiry(entry, () => entries.delete(entry.runId));
  };
  const retire = (
    entry: Entry,
    cleanup: () => Promise<Retirement>,
    target: "expired" | "cancelled",
  ): Promise<OrganizeRunState> => {
    if (entry.cleaning) return entry.cleaning;
    clearExpiry(entry);
    entry.cleanup = cleanup;
    entry.target = target;
    entry.prepared = undefined;
    entry.state = { status: "cleaning" };
    entry.cleaning = Promise.resolve()
      .then(cleanup)
      .then(() => {
        terminal(entry, { status: target });
        return entry.state;
      })
      .catch(() => {
        // Keep only a retryable cleanup handle, never the undelivered draft.
        entry.state = { status: "failed", reason: "cleanup_failed" };
        return entry.state;
      })
      .finally(() => {
        entry.cleaning = undefined;
      });
    return entry.cleaning;
  };
  const expire = (entry: Entry) => {
    if (entry.prepared) void retire(entry, entry.prepared.discard, "expired");
    else if (!entry.cleanup) entries.delete(entry.runId);
  };
  const lookup = (ownerId: string, runId: string): Entry | undefined => {
    const entry = entries.get(runId);
    if (entry?.ownerId !== ownerId) return undefined;
    if (entry.expiresAt !== undefined && entry.expiresAt <= now()) expire(entry);
    return entries.get(runId);
  };
  const view = (entry?: Entry): OrganizeRunState =>
    structuredClone(entry?.state ?? { status: "not_found" });
  const finish = async (entry: Entry) => {
    try {
      const result = await prepareNote(entry.ownerId, entry.noteId, {
        signal: entry.controller.signal,
        onProgress: (phase) => {
          if (entry.state.status === "running" && !entry.controller.signal.aborted) {
            entry.state = { status: "running", phase };
          }
        },
      });
      if (result.status === "draft") {
        if (entry.controller.signal.aborted) {
          await retire(entry, result.discard, "cancelled");
        } else {
          entry.prepared = result;
          entry.state = { status: "draft", draft: result.draft, source: result.source };
          armExpiry(entry, () => expire(entry));
        }
      } else if (result.status === "failed" && result.reason === "cleanup_failed") {
        entry.state = { status: "failed", reason: "cleanup_failed" };
        entry.cleanup = result.retryCleanup;
        entry.target = entry.controller.signal.aborted ? "cancelled" : "expired";
      } else {
        terminal(entry, entry.controller.signal.aborted ? { status: "cancelled" } : result);
      }
    } catch {
      terminal(
        entry,
        entry.controller.signal.aborted
          ? { status: "cancelled" }
          : { status: "failed", reason: "generation_failed" },
      );
    }
  };

  return {
    start(ownerId: string, noteId: string): { runId: string } {
      if (disposed) throw new Error("Organizer runs are shutting down.");
      const identity = key(ownerId, noteId);
      const current = active.get(identity);
      if (current && lookup(ownerId, current)) return { runId: current };
      const runId = newRunId();
      if (entries.has(runId)) throw new Error("Organizer run identity collision.");
      const entry: Entry = {
        ownerId,
        noteId,
        runId,
        controller: new AbortController(),
        state: { status: "running", phase: "starting" },
        work: Promise.resolve(),
      };
      entries.set(runId, entry);
      active.set(identity, runId);
      // No browser request signal: a disconnect only stops that reader.
      entry.work = Promise.resolve().then(() => finish(entry));
      return { runId };
    },
    read(ownerId: string, runId: string): OrganizeRunState {
      return view(lookup(ownerId, runId));
    },
    async acknowledge(ownerId: string, runId: string): Promise<OrganizeRunState> {
      const entry = lookup(ownerId, runId);
      if (!entry) return { status: "not_found" };
      if (entry.cleaning) return structuredClone(await entry.cleaning);
      if (entry.cleanup)
        return structuredClone(await retire(entry, entry.cleanup, entry.target ?? "expired"));
      if (entry.prepared)
        return structuredClone(await retire(entry, entry.prepared.acknowledge, "expired"));
      return view(entry);
    },
    async cancel(ownerId: string, runId: string): Promise<OrganizeRunState> {
      const entry = lookup(ownerId, runId);
      if (!entry) return { status: "not_found" };
      entry.controller.abort();
      if (entry.state.status === "running") entry.state = { status: "cleaning" };
      await entry.work;
      if (entry.cleaning) return structuredClone(await entry.cleaning);
      if (entry.cleanup)
        return structuredClone(await retire(entry, entry.cleanup, entry.target ?? "cancelled"));
      if (entry.prepared)
        return structuredClone(await retire(entry, entry.prepared.discard, "cancelled"));
      return view(entry);
    },
    async dispose(): Promise<{ cleanupFailed: number }> {
      disposed = true;
      const pending = [...entries.values()];
      for (const entry of pending) entry.controller.abort();
      await Promise.all(pending.map((entry) => entry.work));
      await Promise.all(
        pending.map(async (entry) => {
          if (entry.cleaning) await entry.cleaning;
          else if (entry.cleanup) await retire(entry, entry.cleanup, entry.target ?? "cancelled");
          else if (entry.prepared) await retire(entry, entry.prepared.discard, "cancelled");
          clearExpiry(entry);
          if (!entry.cleanup) entries.delete(entry.runId);
        }),
      );
      return {
        cleanupFailed: [...entries.values()].filter((entry) => entry.cleanup !== undefined).length,
      };
    },
  };
}
