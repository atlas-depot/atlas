import type {
  createOrganizeRunStore,
  OrganizeRunRecord,
  OrganizeRunState,
  RunTerminalState,
} from "./db/organize-runs.ts";
import {
  generatedDraftSchema,
  organizeUsageSchema,
  type GeneratedDraft,
  type OrganizeUsage,
} from "./organize-note.ts";
import type { StoredNote } from "./db/notes.ts";

export type { OrganizeRunState } from "./db/organize-runs.ts";

export const ORGANIZE_METADATA_RETENTION_MS = 48 * 60 * 60 * 1_000;

type RuntimeReference = NonNullable<OrganizeRunRecord["runtime"]>;
export type DurableOrganizer = {
  allocate(input: { operationId: string }): Promise<RuntimeReference>;
  submit(input: {
    sessionId: string;
    operationId: string;
    note: { title: string; content: string };
  }): Promise<(RuntimeReference & { deliveryId: string }) | { status: "expired" }>;
  inspect(reference: RuntimeReference & { deliveryId: string }): Promise<
    (
      | {
          status: "running";
          phase: "starting" | "researching" | "writing";
          phaseStartedAt?: number;
          lastProgressAt?: number;
        }
      | { status: "draft"; draft: GeneratedDraft; completedAt?: number }
      | { status: "cancelled" }
      | { status: "failed"; reason: "generation_failed" | "invalid_draft" | "expired" }
    ) & { usage?: OrganizeUsage }
  >;
  retire(reference: RuntimeReference): Promise<{ status: "ended" | "expired" }>;
};
type DeliveredReference = RuntimeReference & { deliveryId: string };
type Inspection = Awaited<ReturnType<DurableOrganizer["inspect"]>>;

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

  const view = (record?: OrganizeRunRecord): OrganizeRunState => {
    const state: OrganizeRunState = structuredClone(record?.state ?? { status: "not_found" });
    if (state.status !== "running" || state.lastProgressAt === undefined) return state;
    // Match the existing research deadline and eve model silence timeout. Polls are not progress.
    const silenceMs = state.phase === "researching" ? 180_000 : 600_000;
    return { ...state, stalled: now() - state.lastProgressAt >= silenceMs };
  };

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
    // Commit available accounting before ending a zero-retention session. A later finalization
    // failure must not roll it back after the only remote copy has expired.
    await store.withRun(ownerId, runId, async (current, save) => {
      if (
        !current.active ||
        !current.cleanupTarget ||
        !current.runtime?.deliveryId ||
        current.cleanupTarget.status === "not_found"
      )
        return;
      let usage: OrganizeUsage | undefined;
      try {
        const final = await runtimeFor(current.runtimeUrl).inspect({
          ...current.runtime,
          deliveryId: current.runtime.deliveryId,
        });
        if (final.usage) usage = organizeUsageSchema.parse(final.usage);
      } catch {
        // Unknown accounting does not postpone content cleanup or discard earlier reported totals.
      }
      if (usage) await save({ ...current, usage });
    });
    return (
      (await store.withRun(ownerId, runId, async (current, save) => {
        if (!current.active || !current.cleanupTarget) return view(current);
        const cleanupTarget = current.cleanupTarget;
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
          state: cleanupTarget,
          cleanupTarget: null,
          runtime: null,
          input: null,
          expiresAt: now() + ORGANIZE_METADATA_RETENTION_MS,
        };
        await save(retired);
        return view(retired);
      })) ?? { status: "not_found" }
    );
  };

  // Decides what the database alone can decide under the row lock. Given an inspection,
  // applies that runtime observation; without one, returns the reference to inspect.
  const settle = async (
    record: OrganizeRunRecord,
    save: (next: OrganizeRunRecord) => Promise<void>,
    readSource: () => Promise<StoredNote | undefined>,
    result?: Inspection,
  ): Promise<{ record: OrganizeRunRecord; inspect?: DeliveredReference }> => {
    if (!record.active || record.cleanupTarget) return { record };
    const current = await readSource();
    let target: RunTerminalState | undefined;
    if (!current) target = { status: "not_found" };
    else if (record.expiresAt !== null && record.expiresAt <= now()) target = { status: "expired" };
    else if (record.state.status === "draft") {
      const refreshed = {
        ...record,
        state: {
          ...record.state,
          source: { ...record.state.source, stale: current.revision !== record.sourceRevision },
        },
      };
      await save(refreshed);
      return { record: refreshed };
    } else if (!result) {
      if (!record.runtime?.deliveryId)
        throw new Error("Organizer runtime identity is unavailable.");
      return { record, inspect: { ...record.runtime, deliveryId: record.runtime.deliveryId } };
    } else if (result.status === "draft") {
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
          return { record: next };
        }
      }
    } else if (result.status === "running") {
      const { usage: _usage, ...state } = result;
      const next = { ...record, state };
      await save(next);
      return { record: next };
    } else if (result.status === "failed") {
      target =
        result.reason === "expired"
          ? { status: "expired" }
          : { status: "failed", reason: result.reason };
    } else {
      // Copy only the status: a cancelled answer can carry usage, which is not terminal state.
      target = { status: result.status };
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
    return { record: next };
  };

  // An unlocked inspection may only update the exact stored state it was taken from.
  const sameObservation = (basis: OrganizeRunRecord, stored: OrganizeRunRecord) =>
    stored.runtime?.sessionId === basis.runtime?.sessionId &&
    stored.runtime?.deliveryId === basis.runtime?.deliveryId &&
    JSON.stringify(stored.state) === JSON.stringify(basis.state) &&
    JSON.stringify(stored.usage) === JSON.stringify(basis.usage);

  const read = async (ownerId: string, runId: string): Promise<OrganizeRunState> => {
    const found = await store.read(ownerId, runId);
    if (!found?.active) return view(found);
    if (found.cleanupTarget) return finishCleanup(ownerId, runId);
    // Runtime identity never changes once delivered, so this unlocked read is authoritative.
    if (!found.runtime?.deliveryId) await ensureStarted(ownerId, runId);
    const prepared = await store.withRun(ownerId, runId, (record, save, readSource) =>
      settle(record, save, readSource),
    );
    if (!prepared?.inspect) {
      const settled = prepared?.record;
      return settled?.cleanupTarget ? finishCleanup(ownerId, runId) : view(settled);
    }
    const basis = prepared.record;
    // The runtime can take the whole request timeout to answer. Hold no row lock or pooled
    // connection meanwhile, then persist the answer in a second short transaction.
    const result = await runtimeFor(basis.runtimeUrl).inspect(prepared.inspect);
    const observed = await store.withRun(ownerId, runId, async (record, save, readSource) => {
      if (!record.active || record.cleanupTarget) return record;
      // Another request changed the run meanwhile: discard this answer, keep the stored state.
      if (!sameObservation(basis, record)) return (await settle(record, save, readSource)).record;
      const usage = result.usage ? organizeUsageSchema.parse(result.usage) : record.usage;
      return (await settle({ ...record, usage }, save, readSource, result)).record;
    });
    return observed?.cleanupTarget ? finishCleanup(ownerId, runId) : view(observed);
  };

  return {
    drafts: store.drafts,
    async work(ownerId: string) {
      const drafts = await store.drafts.list(ownerId);
      const ids = new Set(drafts.map((draft) => draft.id));
      return {
        runs: (await store.listActive(ownerId)).filter((run) => !ids.has(run.runId)),
        drafts,
      };
    },
    async handoff(ownerId: string, runId: string) {
      const result = await store.drafts.handoff(ownerId, runId, now());
      if (result.status === "ready") {
        try {
          await finishCleanup(ownerId, runId);
        } catch {
          /* Committed cleanup intent is retried by sweep. */
        }
      }
      return result;
    },
    async start(
      ownerId: string,
      noteId: string,
      expectedTag?: string,
    ): Promise<{ runId: string; status?: "cleanup_pending" } | { status: "not_found" }> {
      const record = await store.claim(ownerId, noteId, runtimeUrl, expectedTag);
      if (!record) return { status: "not_found" };
      if (record.cleanupTarget) return { runId: record.runId, status: "cleanup_pending" };
      const started = await ensureStarted(ownerId, record.runId);
      if (started?.cleanupTarget) return { runId: record.runId, status: "cleanup_pending" };
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
      await store.drafts.purgeExpired();
      return { checked: pending.length, retryPending };
    },
  };
}
