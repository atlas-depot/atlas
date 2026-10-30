import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { noteContentSchema, type CreateNote } from "../../shared/notes";
import type { Note } from "../../shared/notes";
import { MarkdownPreview } from "./MarkdownPreview";
import type { NoteSnapshot, NotesStore } from "./notes-store";
import {
  classifyFailure,
  failureMessage,
  hasUnsavedChanges,
  savingMessage,
  type RequestFailure,
} from "./editor-state";

type Draft = CreateNote;
type Selection =
  | { kind: "new" }
  | { kind: "read"; id: string }
  | { kind: "replace"; snapshot: NoteSnapshot };
type ReadFailure = { id: string; compare: boolean; kind: RequestFailure };
type SaveState = "idle" | "saving" | RequestFailure;

export function NotesWorkspace({
  store,
  example = false,
}: {
  store: NotesStore;
  example?: boolean;
}) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [loadState, setLoadState] = useState<"loading" | "ready" | RequestFailure>("loading");
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saved, setSaved] = useState<NoteSnapshot | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [readFailure, setReadFailure] = useState<ReadFailure | null>(null);
  const [comparison, setComparison] = useState<NoteSnapshot | null>(null);
  const [pending, setPending] = useState<Selection | null>(null);
  const [savingSnapshot, setSavingSnapshot] = useState<Draft | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const busyRef = useRef(false);
  const titleRef = useRef<HTMLInputElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const dirty = hasUnsavedChanges(draft, saved?.note ?? null);
  const valid =
    draft !== null &&
    noteContentSchema.safeParse({ title: draft.title, content: draft.content }).success;
  const busy = saveState === "saving" || openingId !== null || refreshing;
  const recoveryKind =
    readFailure?.kind ??
    (saveState !== "idle" && saveState !== "saving"
      ? saveState
      : loadState !== "loading" && loadState !== "ready"
        ? loadState
        : null);
  const blocked =
    recoveryKind === "unauthenticated" ||
    recoveryKind === "forbidden" ||
    recoveryKind === "unavailable";

  const clearPrivateCache = useCallback(() => {
    setNotes([]);
    setSaved(null);
    setComparison(null);
  }, []);

  const applySnapshot = useCallback((snapshot: NoteSnapshot) => {
    setDraft({
      title: snapshot.note.title,
      content: snapshot.note.content,
      createdAt: snapshot.note.createdAt,
    });
    setSaved(snapshot);
    setSaveState("idle");
    setComparison(null);
    setReadFailure(null);
  }, []);

  useEffect(() => {
    let active = true;
    void (async () => {
      let list: Note[];
      try {
        list = await store.list();
      } catch (error) {
        if (active) {
          const kind = classifyFailure(error);
          setLoadState(kind);
          if (kind === "unauthenticated") clearPrivateCache();
        }
        return;
      }
      if (!active) return;
      setNotes(list);
      setLoadState("ready");
      if (!list[0]) return;
      const id = list[0].id;
      busyRef.current = true;
      setOpeningId(id);
      try {
        const snapshot = await store.read(id);
        if (active) applySnapshot(snapshot);
      } catch (error) {
        if (active) {
          const kind = classifyFailure(error);
          setReadFailure({ id, compare: false, kind });
          if (kind === "unauthenticated") clearPrivateCache();
        }
      } finally {
        if (active) {
          busyRef.current = false;
          setOpeningId(null);
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [store, loadAttempt, applySnapshot, clearPrivateCache]);

  useEffect(() => {
    if (!dirty && saveState !== "saving") return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, saveState]);

  async function openNote(id: string, compare = false) {
    if (busyRef.current) return;
    busyRef.current = true;
    setOpeningId(id);
    setReadFailure(null);
    try {
      const snapshot = await store.read(id);
      if (compare) setComparison(snapshot);
      else {
        applySnapshot(snapshot);
        requestAnimationFrame(() => titleRef.current?.focus());
      }
    } catch (error) {
      const kind = classifyFailure(error);
      setReadFailure({ id, compare, kind });
      if (kind === "unauthenticated") clearPrivateCache();
      if (kind === "missing") setNotes((current) => current.filter((note) => note.id !== id));
    } finally {
      busyRef.current = false;
      setOpeningId(null);
    }
  }

  const save = useCallback(async () => {
    if (
      !draft ||
      (saved !== null && !dirty) ||
      !valid ||
      busyRef.current ||
      blocked ||
      saveState === "conflict" ||
      saveState === "missing"
    )
      return;
    const snapshot = { ...draft };
    busyRef.current = true;
    setSaveState("saving");
    setSavingSnapshot(snapshot);
    setReadFailure(null);
    try {
      const result = saved
        ? await store.update(
            saved.note.id,
            { title: snapshot.title, content: snapshot.content },
            saved.etag,
          )
        : await store.create(snapshot);
      setNotes((current) => [result.note, ...current.filter((note) => note.id !== result.note.id)]);
      setSaved(result);
      // Advance the identity/ETag, but acknowledge only the submitted text, not newer edits.
      setDraft((current) => (current ? { ...current, createdAt: result.note.createdAt } : current));
      setSaveState("idle");
    } catch (error) {
      const kind = classifyFailure(error);
      setSaveState(kind);
      if (kind === "unauthenticated") clearPrivateCache();
    } finally {
      busyRef.current = false;
      setSavingSnapshot(null);
    }
  }, [draft, dirty, valid, saved, saveState, store, blocked, clearPrivateCache]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "s") return;
      event.preventDefault();
      if (!pending) void save();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [save, pending]);

  function select(selection: Selection) {
    setPending(null);
    if (selection.kind === "read") {
      void openNote(selection.id);
      return;
    }
    if (selection.kind === "replace") applySnapshot(selection.snapshot);
    else {
      setDraft({ title: "", content: "", createdAt: new Date().toISOString() });
      setSaved(null);
      setSaveState("idle");
      setReadFailure(null);
      setComparison(null);
    }
    requestAnimationFrame(() => titleRef.current?.focus());
  }
  function requestSelection(selection: Selection) {
    if (
      busyRef.current ||
      blocked ||
      (selection.kind === "read" && selection.id === saved?.note.id)
    )
      return;
    if (dirty) setPending(selection);
    else select(selection);
  }

  async function refreshNotes() {
    if (busyRef.current) return;
    busyRef.current = true;
    setRefreshing(true);
    try {
      setNotes(await store.list());
      setLoadState("ready");
    } catch (error) {
      const kind = classifyFailure(error);
      setLoadState(kind);
      if (kind === "unauthenticated") clearPrivateCache();
    } finally {
      busyRef.current = false;
      setRefreshing(false);
    }
  }

  function keepAsNew() {
    if (!draft) return;
    setSaved(null);
    setSaveState("idle");
    setReadFailure(null);
    setComparison(null);
    setDraft({ ...draft, createdAt: new Date().toISOString() });
  }

  const status =
    loadState === "loading"
      ? "Loading notes..."
      : loadState !== "ready"
        ? failureMessage(loadState, "list")
        : openingId
          ? "Opening note..."
          : readFailure
            ? failureMessage(readFailure.kind, "read")
            : saveState === "saving"
              ? draft && savingSnapshot
                ? savingMessage(draft, savingSnapshot)
                : "Saving..."
              : saveState !== "idle"
                ? failureMessage(saveState, "save")
                : dirty
                  ? "Unsaved changes"
                  : draft && saved === null
                    ? "New note"
                    : draft
                      ? example
                        ? "Saved for this preview session"
                        : "Saved"
                      : "Select a note or create a new one.";
  const failed = !busy && recoveryKind !== null && recoveryKind !== "unavailable";

  return (
    <main className="notes-workspace space-y-5 p-4 sm:p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Atlas notes</h1>
        <Button
          disabled={loadState !== "ready" || busy || blocked}
          onClick={() => requestSelection({ kind: "new" })}
        >
          New note
        </Button>
      </header>
      {example && (
        <p className="text-sm text-muted-foreground" role="note">
          Development preview with synthetic notes. Saves last only until reload.
        </p>
      )}
      <p role={failed ? "alert" : "status"} className="text-sm">
        {status}
      </p>
      {loadState === "failed" && (
        <Button
          onClick={() => {
            if (draft) {
              void refreshNotes();
              return;
            }
            setLoadState("loading");
            setLoadAttempt((value) => value + 1);
          }}
        >
          Retry loading
        </Button>
      )}
      {recoveryKind === "unauthenticated" && (
        <a
          className="inline-flex min-h-11 items-center underline underline-offset-4"
          href="/api/auth/login"
        >
          Sign in again
        </a>
      )}
      {recoveryKind === "missing" && (
        <div className="flex flex-wrap gap-3">
          <Button disabled={busy} onClick={() => void refreshNotes()}>
            Refresh notes
          </Button>
          {draft && (saveState === "missing" || readFailure?.id === saved?.note.id) && (
            <Button variant="outline" disabled={busy} onClick={keepAsNew}>
              Keep as new note
            </Button>
          )}
        </div>
      )}
      {readFailure?.kind === "failed" && (
        <Button disabled={busy} onClick={() => void openNote(readFailure.id, readFailure.compare)}>
          Retry opening
        </Button>
      )}
      {(loadState === "ready" || draft !== null) && (
        <div className="grid gap-5 lg:grid-cols-[minmax(160px,200px)_minmax(0,1fr)]">
          <nav aria-label="Notes" className="space-y-3">
            <h2 className="font-semibold">Your notes</h2>
            {notes.length === 0 ? (
              <p>
                {blocked
                  ? "Restore access to load your notes."
                  : "No notes yet. Create a new note to get started."}
              </p>
            ) : (
              <div className="flex flex-wrap gap-2 lg:flex-col">
                {notes.map((note) => (
                  <Button
                    key={note.id}
                    variant={saved?.note.id === note.id ? "secondary" : "outline"}
                    aria-current={saved?.note.id === note.id ? "true" : undefined}
                    disabled={busy || blocked}
                    className="note-list-button"
                    onClick={() => requestSelection({ kind: "read", id: note.id })}
                  >
                    {note.title || "Untitled note"}
                  </Button>
                ))}
              </div>
            )}
          </nav>
          {draft && (
            <div className="note-detail">
              <Card>
                <CardHeader>
                  <CardTitle>
                    <h2>Edit note</h2>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <Label htmlFor="note-title">Title</Label>
                  <Input
                    ref={titleRef}
                    id="note-title"
                    value={draft.title}
                    maxLength={256}
                    disabled={openingId !== null}
                    onChange={(event) => setDraft({ ...draft, title: event.target.value })}
                  />
                  <Label htmlFor="note-content">Markdown source</Label>
                  <Textarea
                    id="note-content"
                    value={draft.content}
                    maxLength={100_000}
                    rows={6}
                    className="note-source"
                    disabled={openingId !== null}
                    onChange={(event) => setDraft({ ...draft, content: event.target.value })}
                  />
                  {!valid && (
                    <p role="alert">
                      Use a title of up to 256 characters and content of up to 100,000 characters.
                    </p>
                  )}
                  <div className="flex flex-wrap items-center gap-3">
                    <Button
                      disabled={
                        (saved !== null && !dirty) ||
                        busy ||
                        blocked ||
                        !valid ||
                        saveState === "conflict" ||
                        saveState === "missing"
                      }
                      onClick={() => void save()}
                    >
                      Save
                    </Button>
                    <span className="text-xs text-muted-foreground">Ctrl/Cmd+S to save</span>
                    {saveState === "conflict" && saved && (
                      <Button
                        variant="outline"
                        disabled={busy}
                        onClick={() => void openNote(saved.note.id, true)}
                      >
                        Compare latest
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle>
                    <h2>Preview</h2>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {draft.content ? (
                    <MarkdownPreview content={draft.content} />
                  ) : (
                    <p>Write Markdown to see a preview.</p>
                  )}
                </CardContent>
              </Card>
              {comparison && (
                <Card className="note-comparison">
                  <CardHeader>
                    <CardTitle>
                      <h2>Latest saved version</h2>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <p>{comparison.note.title || "Untitled note"}</p>
                    <MarkdownPreview content={comparison.note.content} />
                    <Button
                      variant="outline"
                      onClick={() => requestSelection({ kind: "replace", snapshot: comparison })}
                    >
                      Use latest version
                    </Button>
                  </CardContent>
                </Card>
              )}
            </div>
          )}
        </div>
      )}
      <AlertDialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open) setPending(null);
        }}
      >
        <AlertDialogContent className="notes-dialog" initialFocus={cancelRef} finalFocus={titleRef}>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard unsaved changes?</AlertDialogTitle>
            <AlertDialogDescription>
              Your latest changes have not been saved. Stay to save them, or discard them to
              continue.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel ref={cancelRef}>Keep editing</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                if (pending) select(pending);
              }}
            >
              Discard changes
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  );
}
