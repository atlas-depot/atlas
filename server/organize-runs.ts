import type {
  createOrganizeRunStore,
  OrganizeRunRecord,
  RunTerminalState,
} from "./db/organize-runs.ts";
import { generatedDraftSchema, type GeneratedDraft } from "./organize-note.ts";
export type OrganizeRunState =
  | {
      status: "draft";
      draft: GeneratedDraft;
      source: { noteId: string; revision: number; stale: boolean };
    }
  | { status: "running"; phase: "starting" | "researching" | "writing" }
  | { status: "not_found" | "cancelled" | "cleaning" | "expired" }
  | {
      status: "failed";
      reason: "cleanup_failed" | "read_failed" | "generation_failed" | "invalid_draft";
    };

type RuntimeReference = NonNullable<OrganizeRunRecord["runtime"]>;
export type DurableOrganizer = {
  allocate(input: { operationId: string }): Promise<RuntimeReference>;
  submit(input: {
    sessionId: string;
    operationId: string;
    note: { title: string; content: string };
  }): Promise<(RuntimeReference & { deliveryId: string }) | { status: "expired" }>;
  inspect(
    reference: RuntimeReference & { deliveryId: string },
  ): Promise<
    | { status: "running"; phase: "starting" | "researching" | "writing" }
    | { status: "draft"; draft: GeneratedDraft; completedAt?: number }
    | { status: "cancelled" }
    | { status: "failed"; reason: "generation_failed" | "invalid_draft" | "expired" }
  >;
  retire(reference: RuntimeReference): Promise<{ status: "ended" | "expired" }>;
};

type RunStore = ReturnType<typeof createOrganizeRunStore>;

/** Neon owns handles and delivery. eve owns execution; no generation outlives a request here. */
export function createDurableOrganizeRuns({
  store,
  runtimeUrl,
  runtimeFor,
  resultRetentionMs,
  now = Date.now,
}: {
  store: RunStore;
  runtimeUrl: string;
  runtimeFor: (url: string) => DurableOrganizer;
  resultRetentionMs: number;
  now?: () => number;
}) {
  if (!Number.isSafeInteger(resultRetentionMs) || resultRetentionMs < 1) {
    throw new Error("Organizer result retention must be a positive integer.");
  }

  const view = (record?: OrganizeRunRecord): OrganizeRunState =>
    structuredClone(record?.state ?? { status: "not_found" });

  // The database lock serializes short transport operations, never model generation.
  // A lost acceptance response is reconciled using the persisted immutable operation.
  const ensureStarted = async (ownerId: string, runId: string) => {
    // Allocate without note content first. A lost allocation can leave only an empty
    // idle session; never send a note until its fixed session identity is committed.
    await store.withRun(ownerId, runId, async (record, save, readSource) => {
      if (!record.active || record.cleanupTarget || record.runtime) return;
      if (!(await readSource())) {
        await save({
          ...record,
          input: null,
          state: { status: "cleaning" },
          cleanupTarget: { status: "not_found" },
        });
        return;
      }
      const reference = await runtimeFor(record.runtimeUrl).allocate({ operationId: record.runId });
      if (reference.deliveryId !== null) throw new Error("Organizer allocation must be empty.");
      await save({ ...record, runtime: reference });
    });
    return store.withRun(ownerId, runId, async (record, save, readSource) => {
      if (!record.active || record.cleanupTarget || record.runtime?.deliveryId) return record;
      if (!(await readSource())) {
        const missing: OrganizeRunRecord = {
          ...record,
          input: null,
          state: { status: "cleaning" },
          cleanupTarget: { status: "not_found" },
        };
        await save(missing);
        return missing;
      }
      if (!record.input || !record.runtime)
        throw new Error("Organizer recovery input is unavailable.");
      const reference = await runtimeFor(record.runtimeUrl).submit({
        sessionId: record.runtime.sessionId,
        operationId: record.runId,
        note: record.input,
      });
      if ("status" in reference) {
        const expired: OrganizeRunRecord = {
          ...record,
          input: null,
          state: { status: "cleaning" },
          cleanupTarget: { status: "expired" },
        };
        await save(expired);
        return expired;
      }
      const started = { ...record, runtime: reference, input: null };
      await save(started);
      return started;
    });
  };

  const requestCleanup = async (
    ownerId: string,
    runId: string,
    target: RunTerminalState,
    onlyDraft = false,
  ) =>
    store.withRun(ownerId, runId, async (record, save) => {
      if (!record.active || record.cleanupTarget) return record;
      if (onlyDraft && record.state.status !== "draft") return record;
      const next: OrganizeRunRecord = {
        ...record,
        state: { status: "cleaning" },
        cleanupTarget: target,
        input: null,
        expiresAt: null,
      };
      await save(next);
      return next;
    });

  const finishCleanup = async (ownerId: string, runId: string): Promise<OrganizeRunState> => {
    const record = await store.read(ownerId, runId);
    if (!record?.active || !record.cleanupTarget) return view(record);
    return (
      (await store.withRun(ownerId, runId, async (current, save) => {
        if (!current.active || !current.cleanupTarget) return view(current);
        try {
          // Cancellation before allocation commits must never allocate or send work.
          if (current.runtime) await runtimeFor(current.runtimeUrl).retire(current.runtime);
        } catch {
          const failed: OrganizeRunRecord = {
            ...current,
            state: { status: "failed", reason: "cleanup_failed" },
          };
          await save(failed);
          return view(failed);
        }
        const retired: OrganizeRunRecord = {
          ...current,
          active: false,
          state: current.cleanupTarget,
          cleanupTarget: null,
          runtime: null,
          input: null,
          expiresAt: now() + resultRetentionMs,
        };
        await save(retired);
        return view(retired);
      })) ?? { status: "not_found" }
    );
  };

  const read = async (ownerId: string, runId: string): Promise<OrganizeRunState> => {
    const found = await store.read(ownerId, runId);
    if (!found?.active) return view(found);
    if (found.cleanupTarget) return finishCleanup(ownerId, runId);
    await ensureStarted(ownerId, runId);
    // Persist completion/cleanup intent in one transaction, end the session in a later one.
    const observed = await store.withRun(ownerId, runId, async (record, save, readSource) => {
      if (!record.active || record.cleanupTarget) return record;
      let current = await readSource();
      let target: RunTerminalState | undefined;
      if (!current) target = { status: "not_found" };
      else if (record.expiresAt !== null && record.expiresAt <= now())
        target = { status: "expired" };
      else if (record.state.status === "draft") {
        const refreshed = {
          ...record,
          state: {
            ...record.state,
            source: { ...record.state.source, stale: current.revision !== record.sourceRevision },
          },
        };
        await save(refreshed);
        return refreshed;
      } else {
        if (!record.runtime?.deliveryId)
          throw new Error("Organizer runtime identity is unavailable.");
        const result = await runtimeFor(record.runtimeUrl).inspect({
          ...record.runtime,
          deliveryId: record.runtime.deliveryId,
        });
        current = await readSource();
        if (!current) target = { status: "not_found" };
        else if (result.status === "draft") {
          const draft = generatedDraftSchema.safeParse(result.draft);
          if (!draft.success) target = { status: "failed", reason: "invalid_draft" };
          else {
            const expiresAt = (result.completedAt ?? now()) + resultRetentionMs;
            if (expiresAt <= now()) target = { status: "expired" };
            else {
              const next: OrganizeRunRecord = {
                ...record,
                state: {
                  status: "draft",
                  draft: draft.data,
                  source: {
                    noteId: record.noteId,
                    revision: record.sourceRevision,
                    stale: current.revision !== record.sourceRevision,
                  },
                },
                expiresAt,
              };
              await save(next);
              return next;
            }
          }
        } else if (result.status === "running") {
          const next = { ...record, state: result };
          await save(next);
          return next;
        } else if (result.status === "failed") {
          target =
            result.reason === "expired"
              ? { status: "expired" }
              : { status: "failed", reason: result.reason };
        } else target = result;
      }
      if (!target) throw new Error("Organizer observation did not resolve a state.");
      const next: OrganizeRunRecord = {
        ...record,
        state: { status: "cleaning" },
        cleanupTarget: target,
        input: null,
        expiresAt: null,
      };
      await save(next);
      return next;
    });
    return observed?.cleanupTarget ? finishCleanup(ownerId, runId) : view(observed);
  };

  return {
    async start(
      ownerId: string,
      noteId: string,
    ): Promise<{ runId: string } | { status: "not_found" }> {
      const record = await store.claim(ownerId, noteId, runtimeUrl);
      if (!record) return { status: "not_found" };
      await ensureStarted(ownerId, record.runId);
      return { runId: record.runId };
    },
    read,
    async acknowledge(ownerId: string, runId: string): Promise<OrganizeRunState> {
      const record = await requestCleanup(ownerId, runId, { status: "expired" }, true);
      return record?.cleanupTarget ? finishCleanup(ownerId, runId) : view(record);
    },
    async cancel(ownerId: string, runId: string): Promise<OrganizeRunState> {
      const record = await requestCleanup(ownerId, runId, { status: "cancelled" });
      return record?.cleanupTarget ? finishCleanup(ownerId, runId) : view(record);
    },
    /** A scheduled invocation reconciles abandoned readers and retries persisted cleanup. */
    async sweep(limit = 20): Promise<{ checked: number; retryPending: number }> {
      const pending = await store.pending(limit);
      let retryPending = 0;
      for (const record of pending) {
        try {
          const state = await read(record.ownerId, record.runId);
          if (state.status === "failed" && state.reason === "cleanup_failed") retryPending += 1;
        } catch {
          retryPending += 1;
        }
      }
      await store.purgeExpired();
      return { checked: pending.length, retryPending };
    },
  };
}
