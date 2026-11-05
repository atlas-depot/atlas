import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import type { NoteDraft } from "../../shared/drafts";
import type { OrganizeRunResponse } from "../../shared/organize";
import { type OrganizeClient } from "./organize-store";
import { NotesRequestError, type NoteSnapshot } from "./notes-store";
import { AIDraftPanel } from "./AIDraftPanel";
import "./organize-workspace.css";

type Run = { runId: string; noteId: string };

export function OrganizeWorkspace({
  source,
  sourceDirty,
  enabled,
  canStart,
  prepareSource,
  onSaved,
  client,
}: {
  client: OrganizeClient;
  source: NoteSnapshot | null;
  sourceDirty: boolean;
  enabled: boolean;
  canStart: boolean;
  prepareSource: () => Promise<NoteSnapshot | undefined>;
  onSaved: (note: NoteSnapshot) => void;
}) {
  const [runs, setRuns] = useState<Run[]>([]);
  const [drafts, setDrafts] = useState<NoteDraft[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const startingRef = useRef(false);
  const finishedDrafts = useRef(new Set<string>());
  const alive = useRef(true);
  const enabledRef = useRef(enabled);
  useEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const recover = useCallback(async () => {
    if (!enabledRef.current) return;
    try {
      const result = await client.list();
      if (!alive.current) return;
      setRuns(result.runs);
      // Missing remote records may have unsaved local edits. Keep their panels
      // until an explicit save/discard; their own reads explain expiry/deletion.
      setDrafts((current) => [
        ...current,
        ...result.drafts.filter(
          (draft) =>
            !finishedDrafts.current.has(draft.id) && !current.some((item) => item.id === draft.id),
        ),
      ]);
      setLoaded(true);
      setFailure(null);
    } catch {
      if (alive.current)
        setFailure("Could not reconnect to your AI drafts. Your notes are unchanged.");
    }
  }, [client]);
  useEffect(() => {
    if (enabled && !loaded) void Promise.resolve().then(recover);
  }, [enabled, loaded, recover]);

  async function start() {
    if (startingRef.current || !enabled || !loaded || !canStart) return;
    startingRef.current = true;
    setStarting(true);
    setFailure(null);
    setNotice(null);
    try {
      const snapshot = await prepareSource();
      if (!snapshot || !alive.current || !enabledRef.current) return;
      const result = await client.start(snapshot.note.id, snapshot.etag);
      if (alive.current)
        setRuns((current) => [
          ...current.filter((run) => run.runId !== result.runId),
          { runId: result.runId, noteId: snapshot.note.id },
        ]);
    } catch (cause) {
      if (!alive.current) return;
      if (cause instanceof NotesRequestError && cause.status === 412)
        setFailure(
          "The saved note changed before Organize started. Reload or compare the latest note, then try again.",
        );
      else if (cause instanceof NotesRequestError && cause.status === 409) {
        await recover();
        setFailure("Save or discard the existing AI draft before organizing this note again.");
      } else {
        // The start may have reached the server. Recover its owned handle rather
        // than assuming failure and blindly issuing another generation request.
        await recover();
        setFailure(
          "Could not confirm Organize started. Reconnect to check the existing work before retrying.",
        );
      }
    } finally {
      startingRef.current = false;
      if (alive.current) setStarting(false);
    }
  }

  const receiveDraft = useCallback((runId: string, draft: NoteDraft) => {
    setRuns((current) => current.filter((run) => run.runId !== runId));
    if (!finishedDrafts.current.has(draft.id))
      setDrafts((current) => [...current.filter((item) => item.id !== draft.id), draft]);
  }, []);
  const selectedPending =
    source &&
    (runs.some((run) => run.noteId === source.note.id) ||
      drafts.some((draft) => draft.source.noteId === source.note.id));
  return (
    <section className="organize-workspace space-y-4" aria-label="Organize notes">
      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="outline"
          disabled={!enabled || !canStart || !loaded || starting || !!selectedPending}
          onClick={() => void start()}
        >
          {starting ? "Starting..." : sourceDirty || !source ? "Save & organize" : "Organize"}
        </Button>
        {selectedPending && (
          <p className="text-sm text-muted-foreground">
            Finish the current AI draft before organizing this note again.
          </p>
        )}
      </div>
      {failure && (
        <div className="space-y-2">
          <p role="alert">{failure}</p>
          <Button variant="outline" disabled={!enabled || starting} onClick={() => void recover()}>
            Reconnect
          </Button>
        </div>
      )}
      {notice && <p role="status">{notice}</p>}
      {runs.map((run) => (
        <RunPanel
          key={run.runId}
          run={run}
          client={client}
          enabled={enabled}
          onDraft={receiveDraft}
          onRetry={
            source?.note.id === run.noteId && canStart
              ? () => {
                  setRuns((current) => current.filter((item) => item.runId !== run.runId));
                  void start();
                }
              : undefined
          }
          onDismiss={() => setRuns((current) => current.filter((item) => item.runId !== run.runId))}
        />
      ))}
      <div className="ai-draft-list">
        {drafts.map((draft) => (
          <AIDraftPanel
            key={draft.id}
            initial={draft}
            client={client}
            enabled={enabled}
            onSaved={(note) => {
              finishedDrafts.current.add(draft.id);
              setDrafts((current) => current.filter((item) => item.id !== draft.id));
              onSaved(note);
              setNotice("AI draft saved as a separate note. Your original is unchanged.");
            }}
            onDiscarded={() => {
              finishedDrafts.current.add(draft.id);
              setDrafts((current) => current.filter((item) => item.id !== draft.id));
              setNotice("AI draft discarded. Your original is unchanged.");
            }}
          />
        ))}
      </div>
    </section>
  );
}

function RunPanel({
  run,
  client,
  enabled,
  onDraft,
  onDismiss,
  onRetry,
}: {
  run: Run;
  client: OrganizeClient;
  enabled: boolean;
  onDraft: (runId: string, draft: NoteDraft) => void;
  onDismiss: () => void;
  onRetry?: () => void;
}) {
  const [state, setState] = useState<OrganizeRunResponse | null>(null);
  const [failedRead, setFailedRead] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [cancelling, setCancelling] = useState(false);
  const cancelLock = useRef(false);
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const recoveredDraft = async () => {
      const work = await client.list();
      const found = work.drafts.find((item) => item.source.noteId === run.noteId);
      if (active && found) onDraft(run.runId, found);
      return found !== undefined;
    };
    const poll = async () => {
      if (cancelLock.current) {
        timer = setTimeout(() => void poll(), 1_000);
        return;
      }
      try {
        const result = await client.readRun(run.runId);
        if (!active) return;
        setState(result);
        setFailedRead(false);
        if (result.status === "draft") {
          const draft = await client.handoff(run.runId);
          if (active) onDraft(run.runId, draft);
          return;
        }
        if (
          result.status === "running" ||
          result.status === "cleaning" ||
          (result.status === "failed" && result.reason === "cleanup_failed")
        )
          timer = setTimeout(() => void poll(), 1_500);
        else await recoveredDraft();
      } catch (cause) {
        try {
          if (!active || (await recoveredDraft())) return;
          if (cause instanceof NotesRequestError && cause.status === 404) {
            // Only retire a missing handle after checking for a delivered draft.
            // A failed recovery read must remain reconnectable instead.
            if (active) {
              setState({ runId: run.runId, status: "expired" });
              setFailedRead(false);
            }
            return;
          }
        } catch {
          /* Keep the same handle for a later reconnect. */
        }
        if (active) setFailedRead(true);
      }
    };
    void poll();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [attempt, client, enabled, onDraft, run.runId, run.noteId]);
  async function cancel() {
    if (cancelLock.current || !enabled) return;
    cancelLock.current = true;
    setCancelling(true);
    try {
      setState(await client.cancel(run.runId));
      setAttempt((value) => value + 1);
    } catch {
      setFailedRead(true);
    } finally {
      cancelLock.current = false;
      setCancelling(false);
    }
  }
  const terminal =
    state?.status === "cancelled" ||
    state?.status === "expired" ||
    (state?.status === "failed" && state.reason !== "cleanup_failed");
  return (
    <section aria-label="Organize progress" className="organize-progress space-y-3">
      <h2 className="font-medium">Organizing your note</h2>
      <p role={failedRead || state?.status === "failed" ? "alert" : "status"}>
        {failedRead
          ? "Connection interrupted. Reconnect to the same work."
          : !state
            ? "Reconnecting..."
            : state.status === "running"
              ? state.phase === "researching"
                ? "Researching sources..."
                : state.phase === "writing"
                  ? "Writing your draft..."
                  : "Starting..."
              : state.status === "cleaning"
                ? "Finishing cleanup..."
                : state.status === "draft"
                  ? "Saving your temporary draft..."
                  : state.status === "cancelled"
                    ? "Generation cancelled."
                    : state.status === "expired"
                      ? "This generation expired or is no longer available."
                      : state.status === "failed" && state.reason === "cleanup_failed"
                        ? "Cleanup is pending. Your original is unchanged."
                        : "Generation failed. Your original is unchanged."}
      </p>
      {state?.status === "running" && state.stalled && (
        <p>No recent progress. You can keep waiting or cancel.</p>
      )}
      <div className="flex flex-wrap gap-3">
        {failedRead && (
          <Button
            variant="outline"
            disabled={!enabled || cancelling}
            onClick={() => setAttempt((value) => value + 1)}
          >
            Reconnect generation
          </Button>
        )}
        {terminal ? (
          <>
            <Button variant="outline" onClick={onDismiss}>
              Dismiss generation
            </Button>
            {onRetry && (
              <Button disabled={!enabled} onClick={onRetry}>
                Retry generation
              </Button>
            )}
          </>
        ) : (
          <Button variant="outline" disabled={!enabled || cancelling} onClick={() => void cancel()}>
            {cancelling ? "Cancelling..." : "Cancel generation"}
          </Button>
        )}
      </div>
    </section>
  );
}
