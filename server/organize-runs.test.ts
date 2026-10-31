import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { createOrganizeRuns } from "./organize-runs.ts";
import type { PreparedNoteResult } from "./prepare-organized-note.ts";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function draft() {
  return {
    status: "draft" as const,
    draft: { markdown: "# Separate draft", sources: [] },
    source: { noteId: "note-1", revision: 3, stale: false },
    acknowledge: vi.fn(async () => ({ status: "expired" as const })),
    discard: vi.fn(async () => ({ status: "expired" as const })),
  };
}
function fixture(
  prepare: Parameters<typeof createOrganizeRuns>[0]["prepareNote"] = async () => draft(),
) {
  const prepareNote = vi.fn(prepare);
  let sequence = 0;
  const runs = createOrganizeRuns({
    prepareNote,
    resultRetentionMs: 1_000,
    newRunId: () => `run-${++sequence}`,
  });
  return { runs, prepareNote };
}
const settle = () => vi.advanceTimersByTimeAsync(0);

it("coalesces double clicks and browser reconnect while work is running or awaiting acknowledgement", async () => {
  const pending = deferred<PreparedNoteResult>();
  const { runs, prepareNote } = fixture(vi.fn(() => pending.promise));
  const first = runs.start("owner", "note-1");
  expect(runs.start("owner", "note-1")).toEqual(first);
  expect(runs.read("owner", first.runId)).toEqual({ status: "running", phase: "starting" });
  await settle();
  expect(prepareNote).toHaveBeenCalledOnce();
  const submittedSignal = prepareNote.mock.calls[0]?.[2].signal;
  expect(submittedSignal?.aborted).toBe(false);
  const result = draft();
  pending.resolve(result);
  await settle();
  expect(runs.start("owner", "note-1")).toEqual(first);
  expect(runs.read("owner", first.runId)).toEqual({
    status: "draft",
    draft: result.draft,
    source: result.source,
  });
  expect(prepareNote).toHaveBeenCalledOnce();
  expect(result.acknowledge).not.toHaveBeenCalled();
  await runs.dispose();
});

it("isolates accounts and notes and never exposes lifecycle handles in a read", async () => {
  const { runs, prepareNote } = fixture();
  const own = runs.start("owner", "note-1");
  const other = runs.start("another-owner", "note-1");
  const otherNote = runs.start("owner", "note-2");
  expect(new Set([own.runId, other.runId, otherNote.runId]).size).toBe(3);
  await settle();
  expect(prepareNote).toHaveBeenCalledTimes(3);
  expect(runs.read("another-owner", own.runId)).toEqual({ status: "not_found" });
  expect(await runs.acknowledge("another-owner", own.runId)).toEqual({ status: "not_found" });
  expect(await runs.cancel("another-owner", own.runId)).toEqual({ status: "not_found" });
  const read = runs.read("owner", own.runId);
  expect(read).not.toHaveProperty("acknowledge");
  expect(read).not.toHaveProperty("discard");
  expect(read).not.toHaveProperty("sessionId");
  if (read.status !== "draft") throw new Error("Expected draft");
  read.draft.markdown = "Browser-side mutation";
  expect(runs.read("owner", own.runId)).toMatchObject({ draft: { markdown: "# Separate draft" } });
  await runs.dispose();
});

it("acknowledges once, removes content and retains a terminal marker without another generation", async () => {
  const prepared = draft();
  const { runs, prepareNote } = fixture(vi.fn(async () => prepared));
  const { runId } = runs.start("owner", "note-1");
  await settle();
  expect(
    await Promise.all([runs.acknowledge("owner", runId), runs.acknowledge("owner", runId)]),
  ).toEqual([{ status: "expired" }, { status: "expired" }]);
  expect(prepared.acknowledge).toHaveBeenCalledOnce();
  expect(prepared.discard).not.toHaveBeenCalled();
  expect(runs.read("owner", runId)).toEqual({ status: "expired" });
  expect(await runs.acknowledge("owner", runId)).toEqual({ status: "expired" });
  expect(prepareNote).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(1_000);
  expect(runs.read("owner", runId)).toEqual({ status: "not_found" });
  expect(prepareNote).toHaveBeenCalledOnce();
});

it("a failed acknowledgement remains visible and retries only cleanup", async () => {
  const prepared = draft();
  prepared.acknowledge.mockRejectedValueOnce(new Error("private provider diagnostic"));
  const { runs, prepareNote } = fixture(vi.fn(async () => prepared));
  const first = runs.start("owner", "note-1");
  await settle();
  expect(await runs.acknowledge("owner", first.runId)).toEqual({
    status: "failed",
    reason: "cleanup_failed",
  });
  expect(runs.start("owner", "note-1")).toEqual(first);
  expect(runs.read("owner", first.runId)).not.toHaveProperty("draft");
  expect(await runs.acknowledge("owner", first.runId)).toEqual({ status: "expired" });
  expect(prepared.acknowledge).toHaveBeenCalledTimes(2);
  expect(prepareNote).toHaveBeenCalledOnce();
  await runs.dispose();
});

it("acknowledgement cannot complete a still-running generation", async () => {
  const pending = deferred<PreparedNoteResult>();
  const { runs } = fixture(vi.fn(() => pending.promise));
  const { runId } = runs.start("owner", "note-1");
  expect(await runs.acknowledge("owner", runId)).toEqual({ status: "running", phase: "starting" });
  pending.resolve({ status: "cancelled" });
  await settle();
  await runs.dispose();
});

it("explicit cancellation aborts accepted work and never leaves a late draft readable", async () => {
  const pending = deferred<PreparedNoteResult>();
  const prepared = draft();
  const prepare = vi.fn(
    (_owner: string, _note: string, _options: { signal: AbortSignal }) => pending.promise,
  );
  const { runs } = fixture(prepare);
  const { runId } = runs.start("owner", "note-1");
  await settle();
  const cancellation = runs.cancel("owner", runId);
  expect(prepare.mock.calls[0]?.[2].signal.aborted).toBe(true);
  pending.resolve(prepared);
  expect(await cancellation).toEqual({ status: "cancelled" });
  expect(prepared.discard).toHaveBeenCalledOnce();
  expect(prepared.acknowledge).not.toHaveBeenCalled();
  expect(runs.read("owner", runId)).toEqual({ status: "cancelled" });
  await runs.dispose();
});

it("cancelling an already completed draft uses discard", async () => {
  const prepared = draft();
  const { runs } = fixture(vi.fn(async () => prepared));
  const { runId } = runs.start("owner", "note-1");
  await settle();
  expect(await runs.cancel("owner", runId)).toEqual({ status: "cancelled" });
  expect(prepared.discard).toHaveBeenCalledOnce();
  expect(prepared.acknowledge).not.toHaveBeenCalled();
  await runs.dispose();
});

it("undelivered drafts expire and are discarded rather than silently acknowledged", async () => {
  const prepared = draft();
  const { runs } = fixture(vi.fn(async () => prepared));
  const { runId } = runs.start("owner", "note-1");
  await settle();
  await vi.advanceTimersByTimeAsync(999);
  expect(runs.read("owner", runId).status).toBe("draft");
  await vi.advanceTimersByTimeAsync(1);
  expect(runs.read("owner", runId)).toEqual({ status: "expired" });
  expect(prepared.discard).toHaveBeenCalledOnce();
  expect(prepared.acknowledge).not.toHaveBeenCalled();
  await runs.dispose();
});

it("expired draft cleanup failure retains a retry handle, not readable content or automatic regeneration", async () => {
  const prepared = draft();
  prepared.discard.mockRejectedValueOnce(new Error("Provider offline"));
  const { runs, prepareNote } = fixture(vi.fn(async () => prepared));
  const first = runs.start("owner", "note-1");
  await settle();
  await vi.advanceTimersByTimeAsync(5_000);
  expect(runs.read("owner", first.runId)).toEqual({ status: "failed", reason: "cleanup_failed" });
  expect(runs.start("owner", "note-1")).toEqual(first);
  expect(prepared.discard).toHaveBeenCalledOnce();
  expect(await runs.cancel("owner", first.runId)).toEqual({ status: "expired" });
  expect(prepared.discard).toHaveBeenCalledTimes(2);
  expect(prepareNote).toHaveBeenCalledOnce();
  await runs.dispose();
});

it("cleanup from a rejected generation stays retryable without fabricating a delivered draft", async () => {
  const retryCleanup = vi.fn(async () => ({ status: "expired" as const }));
  const { runs } = fixture(
    vi.fn(async () => ({
      status: "failed" as const,
      reason: "cleanup_failed" as const,
      retryCleanup,
    })),
  );
  const { runId } = runs.start("owner", "note-1");
  await settle();
  expect(runs.read("owner", runId)).toEqual({ status: "failed", reason: "cleanup_failed" });
  expect(await runs.cancel("owner", runId)).toEqual({ status: "expired" });
  expect(retryCleanup).toHaveBeenCalledOnce();
  await runs.dispose();
});

it("unknown or lost process handles never start replacement runs during reads or controls", async () => {
  const first = fixture();
  const { runId } = first.runs.start("owner", "note-1");
  await settle();
  const restarted = fixture();
  expect(restarted.runs.read("owner", runId)).toEqual({ status: "not_found" });
  expect(await restarted.runs.acknowledge("owner", runId)).toEqual({ status: "not_found" });
  expect(await restarted.runs.cancel("owner", runId)).toEqual({ status: "not_found" });
  expect(restarted.prepareNote).not.toHaveBeenCalled();
  await first.runs.dispose();
});

it("sanitizes unexpected generation exceptions without leaking diagnostics", async () => {
  const { runs } = fixture(
    vi.fn(async () => {
      throw new Error("Private note and provider key");
    }),
  );
  const { runId } = runs.start("owner", "note-1");
  await settle();
  expect(runs.read("owner", runId)).toEqual({ status: "failed", reason: "generation_failed" });
  await runs.dispose();
});

it("shutdown rejects new work, aborts pending work, discards results and reports retryable cleanup failures", async () => {
  const prepared = draft();
  prepared.discard.mockRejectedValueOnce(new Error("Cleanup unavailable"));
  const { runs } = fixture(vi.fn(async () => prepared));
  const { runId } = runs.start("owner", "note-1");
  await settle();
  expect(await runs.dispose()).toEqual({ cleanupFailed: 1 });
  expect(() => runs.start("owner", "note-2")).toThrow(/shutting down/);
  expect(runs.read("owner", runId)).toEqual({ status: "failed", reason: "cleanup_failed" });
  expect(await runs.dispose()).toEqual({ cleanupFailed: 0 });
  expect(runs.read("owner", runId)).toEqual({ status: "not_found" });
  expect(prepared.discard).toHaveBeenCalledTimes(2);
});

it.each([0, -1, 1.5, Infinity, 2_147_483_648])(
  "rejects unsafe result retention %s",
  (resultRetentionMs) => {
    expect(() =>
      createOrganizeRuns({ prepareNote: async () => draft(), resultRetentionMs }),
    ).toThrow(/timer-safe/);
  },
);

it("exposes only meaningful progress for the same active run and ignores late updates", async () => {
  const pending = deferred<PreparedNoteResult>();
  let report: ((phase: "researching" | "writing") => void) | undefined;
  const { runs } = fixture(async (_owner, _note, options) => {
    report = options.onProgress;
    return pending.promise;
  });
  const { runId } = runs.start("owner", "note-1");
  await settle();
  report?.("researching");
  expect(runs.read("owner", runId)).toEqual({ status: "running", phase: "researching" });
  report?.("writing");
  expect(runs.read("owner", runId)).toEqual({ status: "running", phase: "writing" });
  pending.resolve(draft());
  await settle();
  report?.("researching");
  expect(runs.read("owner", runId).status).toBe("draft");
  await runs.dispose();
});

it("expiry cleanup is exposed as cleaning until remote retirement is confirmed", async () => {
  const retirement = deferred<{ status: "expired" }>();
  const prepared = draft();
  prepared.discard.mockImplementation(() => retirement.promise);
  const { runs } = fixture(async () => prepared);
  const { runId } = runs.start("owner", "note-1");
  await settle();
  await vi.advanceTimersByTimeAsync(1_000);
  expect(runs.read("owner", runId)).toEqual({ status: "cleaning" });
  retirement.resolve({ status: "expired" });
  await settle();
  expect(runs.read("owner", runId)).toEqual({ status: "expired" });
  await runs.dispose();
});

it("shutdown aborts pending generation and retires any result arriving during shutdown", async () => {
  const pending = deferred<PreparedNoteResult>();
  const prepared = draft();
  let submitted: AbortSignal | undefined;
  const { runs } = fixture(async (_owner, _note, options) => {
    submitted = options.signal;
    return pending.promise;
  });
  const { runId } = runs.start("owner", "note-1");
  await settle();
  const stopping = runs.dispose();
  expect(submitted?.aborted).toBe(true);
  pending.resolve(prepared);
  expect(await stopping).toEqual({ cleanupFailed: 0 });
  expect(prepared.discard).toHaveBeenCalledOnce();
  expect(runs.read("owner", runId)).toEqual({ status: "not_found" });
});

it("a read after clock advancement expires overdue content even before the timer runs", async () => {
  const prepared = draft();
  const { runs } = fixture(async () => prepared);
  const { runId } = runs.start("owner", "note-1");
  await settle();
  vi.setSystemTime(Date.now() + 1_001);
  expect(runs.read("owner", runId)).toEqual({ status: "cleaning" });
  await settle();
  expect(runs.read("owner", runId)).toEqual({ status: "expired" });
  expect(prepared.discard).toHaveBeenCalledOnce();
  await runs.dispose();
});
