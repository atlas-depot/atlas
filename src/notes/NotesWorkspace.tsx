import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { noteContentSchema, type CreateNote, type NoteSummary } from "../../shared/notes";
import { SignInLink } from "@/auth/SignInLink";
import { MarkdownPreview } from "./MarkdownPreview";
import { NoteContentView } from "./NoteContentView";
import { OrganizeWorkspace } from "./OrganizeWorkspace";
import type { OrganizeClient } from "./organize-store";
import { toSummary, type NoteSnapshot, type NotesStore } from "./notes-store";
import {
  classifyFailure,
  hasUnsavedChanges,
  sameContent,
  emptyNoteDocument,
  statusMessage,
  type RequestFailure,
} from "./editor-state";

type Draft = CreateNote;
type Selection =
  | { kind: "new" }
  | { kind: "read"; id: string }
  | { kind: "replace"; snapshot: NoteSnapshot };
type ReadFailure = { id: string; compare: boolean; kind: RequestFailure };
type SaveState = "idle" | "saving" | RequestFailure;
const BlockNoteEditor = lazy(() =>
  import("./BlockNoteEditor").then((module) => ({ default: module.BlockNoteEditor })),
);

export function NotesWorkspace({
  store,
  organizer,
  example = false,
  requestsEnabled = true,
}: {
  store: NotesStore;
  organizer?: OrganizeClient;
  example?: boolean;
  requestsEnabled?: boolean;
}) {
  const [notes, setNotes] = useState<NoteSummary[]>([]);
  const [loadState, setLoadState] = useState<"loading" | "ready" | RequestFailure>("loading");
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [editorKey, setEditorKey] = useState(0);
  const [editorMode, setEditorMode] = useState<"loading" | "rich" | "source">("loading");
  const [editorValid, setEditorValid] = useState(true);
  const [saved, setSaved] = useState<NoteSnapshot | null>(null);
  const [pendingCreation, setPendingCreation] = useState<{ key: string; input: CreateNote } | null>(
    null,
  );
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [readFailure, setReadFailure] = useState<ReadFailure | null>(null);
  const [comparison, setComparison] = useState<NoteSnapshot | null>(null);
  const [pending, setPending] = useState<Selection | null>(null);
  const [savingSnapshot, setSavingSnapshot] = useState<Draft | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [writesForbidden, setWritesForbidden] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteFailure, setDeleteFailure] = useState<RequestFailure | null>(null);
  const [deleteNotice, setDeleteNotice] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const busyRef = useRef(false);
  const titleRef = useRef<HTMLInputElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const newNoteRef = useRef<HTMLButtonElement>(null);
  const signInRef = useRef<HTMLAnchorElement>(null);
  const compareRef = useRef<HTMLButtonElement>(null);
  const deleteRefreshRef = useRef<HTMLButtonElement>(null);
  const deleteCancelRef = useRef<HTMLButtonElement>(null);
  const deleteButtonRef = useRef<HTMLButtonElement>(null);
  const dirty = useMemo(
    () => !editorValid || hasUnsavedChanges(draft, saved?.note ?? null),
    [draft, saved, editorValid],
  );
  const valid = useMemo(() => {
    if (!editorValid || draft === null) return false;
    // A block document enters the draft only after blockNoteDocumentSchema accepted it: the
    // server note, emptyNoteDocument, or the rich editor, which reports validity for every
    // changed document and publishes only valid ones. Its reported validity is enough here.
    if (typeof draft.content !== "string")
      return noteContentSchema.shape.title.safeParse(draft.title).success;
    return noteContentSchema.safeParse({ title: draft.title, content: draft.content }).success;
  }, [draft, editorValid]);
  const busy =
    !requestsEnabled || saveState === "saving" || openingId !== null || refreshing || deleting;
  const loadFailureKind =
    loadState === "unauthenticated" || loadState === "unavailable" ? loadState : null;
  const recoveryKind =
    loadFailureKind ??
    readFailure?.kind ??
    deleteFailure ??
    (saveState !== "idle" && saveState !== "saving"
      ? saveState
      : loadState !== "loading" && loadState !== "ready"
        ? loadState
        : null);
  const blocked =
    !requestsEnabled || recoveryKind === "unauthenticated" || recoveryKind === "unavailable";

  const writeBlocked = blocked || writesForbidden || loadState === "forbidden";
  const deleteBlocked =
    loadState !== "ready" ||
    saveState === "conflict" ||
    saveState === "missing" ||
    deleteFailure === "conflict" ||
    deleteFailure === "failed";

  const clearPrivateCache = useCallback(() => {
    setNotes([]);
    setSaved(null);
    setComparison(null);
  }, []);

  /** The request state every selection change clears. Paths that keep a part say so. */
  const resetSelectionState = useCallback(
    ({ creation = true, deletion = true }: { creation?: boolean; deletion?: boolean } = {}) => {
      setSaveState("idle");
      setReadFailure(null);
      setComparison(null);
      if (creation) setPendingCreation(null);
      if (deletion) {
        setDeleteFailure(null);
        setDeleteNotice(null);
        setDeleteOpen(false);
      }
    },
    [],
  );

  const applySnapshot = useCallback(
    (snapshot: NoteSnapshot) => {
      setEditorKey((key) => key + 1);
      setEditorMode("loading");
      setEditorValid(true);
      setDraft({
        title: snapshot.note.title,
        content: snapshot.note.content,
        createdAt: snapshot.note.createdAt,
      });
      setNotes((current) =>
        current.map((note) => (note.id === snapshot.note.id ? toSummary(snapshot.note) : note)),
      );
      setSaved(snapshot);
      resetSelectionState();
    },
    [resetSelectionState],
  );

  useEffect(() => {
    let active = true;
    void (async () => {
      let list: NoteSummary[];
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
          if (kind === "missing") setNotes((current) => current.filter((note) => note.id !== id));
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
    if (!dirty && saveState !== "saving" && pendingCreation === null) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, saveState, pendingCreation]);

  useEffect(() => {
    const target =
      deleteNotice !== null
        ? newNoteRef.current
        : deleteFailure === "conflict"
          ? compareRef.current
          : deleteFailure === "missing"
            ? titleRef.current
            : deleteFailure === "unauthenticated"
              ? signInRef.current
              : deleteFailure === "failed"
                ? deleteRefreshRef.current
                : deleteFailure === "forbidden" || deleteFailure === "unavailable"
                  ? titleRef.current
                  : null;
    if (!target) return;
    const frame = requestAnimationFrame(() => target.focus());
    return () => cancelAnimationFrame(frame);
  }, [deleteFailure, deleteNotice]);

  async function openNote(id: string, compare = false) {
    if (!requestsEnabled || busyRef.current) return;
    busyRef.current = true;
    setOpeningId(id);
    setReadFailure(null);
    setDeleteNotice(null);
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

  const save = useCallback(async (): Promise<NoteSnapshot | undefined> => {
    if (
      !draft ||
      !valid ||
      busyRef.current ||
      writeBlocked ||
      deleteFailure !== null ||
      saveState === "creation-conflict" ||
      saveState === "conflict" ||
      saveState === "missing"
    )
      return;
    if (saved && !dirty) return saved;
    const snapshot = { ...draft };
    busyRef.current = true;
    setSaveState("saving");
    setSavingSnapshot(snapshot);
    setReadFailure(null);
    setDeleteNotice(null);
    let savedId = saved?.note.id;
    try {
      let result: NoteSnapshot;
      if (saved) {
        result = await store.update(
          saved.note.id,
          { title: snapshot.title, content: snapshot.content },
          saved.etag,
        );
      } else {
        const creation = pendingCreation ?? { key: crypto.randomUUID(), input: snapshot };
        setPendingCreation(creation);
        result = await store.create(creation.input, creation.key);
        // Keep the recovered identity even if saving the newer edits subsequently fails.
        savedId = result.note.id;
        setSaved(result);
        setNotes((current) => [
          toSummary(result.note),
          ...current.filter((note) => note.id !== result.note.id),
        ]);
        setPendingCreation(null);
        if (!sameContent(snapshot, creation.input)) {
          result = await store.update(
            result.note.id,
            { title: snapshot.title, content: snapshot.content },
            result.etag,
          );
        }
      }
      setNotes((current) => [
        toSummary(result.note),
        ...current.filter((note) => note.id !== result.note.id),
      ]);
      setSaved(result);
      // Advance the identity/ETag, but acknowledge only the submitted text, not newer edits.
      setDraft((current) => (current ? { ...current, createdAt: result.note.createdAt } : current));
      setSaveState("idle");
      setDeleteFailure(null);
      setDeleteNotice(null);
      return result;
    } catch (error) {
      const kind = classifyFailure(error);
      setSaveState(kind);
      if (kind === "forbidden") setWritesForbidden(true);
      if (kind === "missing" && savedId)
        setNotes((current) => current.filter((note) => note.id !== savedId));
      if (kind === "unauthenticated") clearPrivateCache();
    } finally {
      busyRef.current = false;
      setSavingSnapshot(null);
    }
  }, [
    draft,
    pendingCreation,
    dirty,
    valid,
    saved,
    saveState,
    store,
    writeBlocked,
    deleteFailure,
    clearPrivateCache,
  ]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "s") return;
      event.preventDefault();
      if (!pending && !deleteOpen) void save();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [save, pending, deleteOpen]);

  function select(selection: Selection) {
    if (!requestsEnabled) return;
    setPending(null);
    if (selection.kind === "read") {
      void openNote(selection.id);
      return;
    }
    if (selection.kind === "replace") applySnapshot(selection.snapshot);
    else {
      setEditorKey((key) => key + 1);
      setEditorMode("loading");
      setEditorValid(true);
      setDraft({ title: "", content: emptyNoteDocument(), createdAt: new Date().toISOString() });
      setSaved(null);
      resetSelectionState();
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
    if (dirty || pendingCreation !== null) setPending(selection);
    else select(selection);
  }

  async function refreshNotes() {
    if (!requestsEnabled || busyRef.current) return;
    busyRef.current = true;
    setRefreshing(true);
    try {
      const list = await store.list();
      setNotes(list);
      setLoadState("ready");
      setDeleteNotice(null);
      const deleteWasUnconfirmed = deleteFailure === "failed";
      if (saved && !list.some((note) => note.id === saved.note.id)) {
        setSaveState("missing");
        setDeleteFailure(null);
        requestAnimationFrame(() => titleRef.current?.focus());
      } else if (deleteWasUnconfirmed) {
        setDeleteFailure(null);
        requestAnimationFrame(() => deleteButtonRef.current?.focus());
      }
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
    resetSelectionState();
    setDraft({ ...draft, createdAt: new Date().toISOString() });
    requestAnimationFrame(() => titleRef.current?.focus());
  }

  function removeSelection(remaining: NoteSummary[], removedId: string) {
    setNotes(remaining);
    setDraft(null);
    setSaved(null);
    // deleteNote already cleared the delete fields; the empty state below sets its notice.
    resetSelectionState({ deletion: false });
    const removedIndex = notes.findIndex((note) => note.id === removedId);
    const next = remaining[removedIndex] ?? remaining[removedIndex - 1] ?? null;
    if (next) return next.id;
    setDeleteNotice("Note deleted. No notes left.");
    return null;
  }

  async function deleteNote() {
    if (!saved || busyRef.current || writeBlocked || deleteBlocked) return;
    const snapshot = saved;
    // A pending creation cannot coexist with a saved note, so it is left untouched.
    resetSelectionState({ creation: false });
    busyRef.current = true;
    setDeleting(true);
    let nextId: string | null = null;
    try {
      await store.delete(snapshot.note.id, snapshot.etag);
      nextId = removeSelection(
        notes.filter((note) => note.id !== snapshot.note.id),
        snapshot.note.id,
      );
    } catch (error) {
      const kind = classifyFailure(error);
      if (kind === "missing") {
        setNotes(notes.filter((note) => note.id !== snapshot.note.id));
        setSaveState("missing");
        setReadFailure(null);
        setComparison(null);
        setDeleteFailure("missing");
        return;
      }
      setDeleteFailure(kind);
      if (kind === "forbidden") setWritesForbidden(true);
      if (kind === "unauthenticated") clearPrivateCache();
    } finally {
      busyRef.current = false;
      setDeleting(false);
    }
    if (nextId) await openNote(nextId);
  }

  const status = statusMessage({
    loadState,
    opening: openingId !== null,
    deleting,
    readFailure: readFailure?.kind ?? null,
    writesForbidden,
    deleteFailure,
    saveState,
    draft,
    savingSnapshot,
    hasSaved: saved !== null,
    deleteNotice,
    dirty,
    example,
  });
  const failed =
    !busy && ((recoveryKind !== null && recoveryKind !== "unavailable") || writesForbidden);
  const unsavedNotice = readFailure && dirty ? "Unsaved changes" : null;

  return (
    <main className="notes-workspace space-y-5 p-4 sm:p-6">
      <header className="workspace-header">
        <h1 className="text-2xl font-semibold">Atlas notes</h1>
        <Button
          ref={newNoteRef}
          disabled={loadState !== "ready" || busy || blocked}
          onClick={() => requestSelection({ kind: "new" })}
        >
          New note
        </Button>
        <div className="workspace-save-controls">
          <div className="workspace-save-status">
            {/* Both live regions stay mounted so a status-to-failure switch is announced. */}
            <div>
              <p role="status" className="text-sm">
                {failed ? unsavedNotice : status}
              </p>
              <p role="alert" className="text-sm">
                {failed ? status : null}
              </p>
            </div>
            {!failed && unsavedNotice && (
              <p role="status" className="text-sm">
                {unsavedNotice}
              </p>
            )}
            {deleteFailure === "failed" && saved && (
              <Button ref={deleteRefreshRef} disabled={busy} onClick={() => void refreshNotes()}>
                Refresh notes
              </Button>
            )}
            {(saveState === "failed" || saveState === "creation-conflict") &&
              saved === null &&
              !readFailure &&
              !blocked &&
              loadState !== "forbidden" && (
                <Button disabled={busy} onClick={() => void refreshNotes()}>
                  Refresh notes
                </Button>
              )}
            {loadState === "failed" && (
              <Button
                disabled={busy}
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
              <SignInLink ref={signInRef}>Sign in again</SignInLink>
            )}
            {recoveryKind === "missing" && (
              <div className="flex flex-wrap gap-3">
                <Button disabled={busy} onClick={() => void refreshNotes()}>
                  Refresh notes
                </Button>
                {draft &&
                  (saveState === "missing" ||
                    deleteFailure === "missing" ||
                    readFailure?.id === saved?.note.id) && (
                    <Button variant="outline" disabled={busy} onClick={keepAsNew}>
                      Keep as new note
                    </Button>
                  )}
              </div>
            )}
            {readFailure && recoveryKind === "failed" && (
              <Button
                disabled={busy}
                onClick={() => {
                  if (readFailure.compare) void openNote(readFailure.id, true);
                  else requestSelection({ kind: "read", id: readFailure.id });
                }}
              >
                Retry opening
              </Button>
            )}
          </div>
          {draft && (
            <div className="flex flex-wrap items-center gap-2">
              <Button
                disabled={
                  (saved !== null && !dirty) ||
                  busy ||
                  writeBlocked ||
                  deleteFailure !== null ||
                  !valid ||
                  saveState === "creation-conflict" ||
                  saveState === "conflict" ||
                  saveState === "missing"
                }
                title="Save (Ctrl/Cmd+S)"
                onClick={() => void save()}
              >
                Save
              </Button>
              {(saveState === "conflict" || deleteFailure === "conflict") && saved && (
                <Button
                  ref={compareRef}
                  variant="outline"
                  disabled={busy || blocked}
                  onClick={() => void openNote(saved.note.id, true)}
                >
                  Compare latest
                </Button>
              )}
            </div>
          )}
        </div>
      </header>
      {example && (
        <p className="text-sm text-muted-foreground" role="note">
          Development preview with synthetic notes. Saves last only until reload.
        </p>
      )}
      <div className="notes-body">
        {(loadState === "ready" || draft !== null) && (
          <>
            <nav aria-label="Notes" className="space-y-3">
              <h2 className="font-semibold">Your notes</h2>
              {notes.length === 0 ? (
                <p>
                  {blocked
                    ? "Restore access to load your notes."
                    : "No notes yet. Create a new note to get started."}
                </p>
              ) : (
                <ul className="flex flex-wrap gap-2 lg:flex-col">
                  {notes.map((note) => (
                    // A grid item stretches, so the button keeps its full column width.
                    <li key={note.id} className="grid">
                      <Button
                        variant={saved?.note.id === note.id ? "secondary" : "outline"}
                        aria-current={saved?.note.id === note.id ? "true" : undefined}
                        disabled={busy || blocked}
                        className="note-list-button"
                        onClick={() => requestSelection({ kind: "read", id: note.id })}
                      >
                        {note.title || "Untitled note"}
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </nav>
            {draft && (
              <div className="note-detail" data-editor-mode={editorMode}>
                <section aria-label="Original note" className="note-editor-plane space-y-3">
                  <Label htmlFor="note-title">Title</Label>
                  <Input
                    ref={titleRef}
                    id="note-title"
                    value={draft.title}
                    maxLength={256}
                    disabled={openingId !== null || deleting}
                    onChange={(event) => setDraft({ ...draft, title: event.target.value })}
                  />
                  <Suspense fallback={<p>Opening editor...</p>}>
                    <BlockNoteEditor
                      key={editorKey}
                      initialContent={draft.content}
                      disabled={openingId !== null || deleting}
                      onChange={(content) =>
                        setDraft((current) => (current ? { ...current, content } : current))
                      }
                      onModeChange={setEditorMode}
                      onValidityChange={setEditorValid}
                    />
                  </Suspense>
                  {!valid && (
                    <p role="alert">
                      The text contains unsupported characters or is too long. Use up to 256
                      characters for the title and 100,000 for the content. Your text is preserved.
                    </p>
                  )}
                  <div className="flex flex-wrap items-center gap-3">
                    {saved && (
                      <Button
                        ref={deleteButtonRef}
                        variant="destructive"
                        disabled={busy || writeBlocked || deleteBlocked}
                        onClick={() => setDeleteOpen(true)}
                      >
                        Delete note
                      </Button>
                    )}
                  </div>
                </section>
                {editorMode === "source" && typeof draft.content === "string" && (
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
                )}
                {comparison && (
                  <Card className="note-comparison">
                    <CardHeader>
                      <CardTitle>
                        <h2>Latest saved version</h2>
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <p>{comparison.note.title || "Untitled note"}</p>
                      <NoteContentView content={comparison.note.content} />
                      <Button
                        variant="outline"
                        disabled={busy || blocked}
                        onClick={() => requestSelection({ kind: "replace", snapshot: comparison })}
                      >
                        Use latest version
                      </Button>
                    </CardContent>
                  </Card>
                )}
              </div>
            )}
          </>
        )}
        {!example && organizer && (
          <OrganizeWorkspace
            client={organizer}
            source={saved}
            sourceDirty={dirty}
            enabled={requestsEnabled && !blocked}
            canStart={
              draft !== null &&
              valid &&
              !busy &&
              !writeBlocked &&
              deleteFailure === null &&
              !["creation-conflict", "conflict", "missing"].includes(saveState)
            }
            prepareSource={save}
            onCheckNotes={refreshNotes}
            onSaved={(snapshot) =>
              setNotes((current) => [
                toSummary(snapshot.note),
                ...current.filter((note) => note.id !== snapshot.note.id),
              ])
            }
          />
        )}
      </div>
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
      <AlertDialog
        open={deleteOpen}
        onOpenChange={(open) => {
          if (!open) setDeleteOpen(false);
        }}
      >
        <AlertDialogContent
          className="notes-dialog"
          initialFocus={deleteCancelRef}
          finalFocus={saved ? deleteButtonRef : newNoteRef}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>Delete note?</AlertDialogTitle>
            <AlertDialogDescription>
              &quot;{saved?.note.title || "Untitled note"}&quot; will be permanently deleted. This
              cannot be undone.
              {dirty ? " Your unsaved changes will also be discarded." : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel ref={deleteCancelRef}>Keep note</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => void deleteNote()}>
              Delete permanently
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  );
}
