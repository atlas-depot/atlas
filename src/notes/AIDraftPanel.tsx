import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
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
import type { NoteDraft } from "../../shared/drafts";
import { noteContentSchema, type UpdateNote } from "../../shared/notes";
import { sameContent } from "./editor-state";
import { NotesRequestError, type NoteSnapshot } from "./notes-store";
import type { OrganizeClient } from "./organize-store";
import { MarkdownPreview } from "./MarkdownPreview";

const Editor = lazy(() =>
  import("./BlockNoteEditor").then((module) => ({ default: module.BlockNoteEditor })),
);

export function AIDraftPanel({
  initial,
  client,
  enabled,
  onSaved,
  onDiscarded,
}: {
  initial: NoteDraft;
  client: OrganizeClient;
  enabled: boolean;
  onSaved: (note: NoteSnapshot) => void;
  onDiscarded: () => void;
}) {
  const [remote, setRemote] = useState(initial);
  const [content, setContent] = useState<UpdateNote>({
    title: initial.title,
    content: initial.content,
  });
  const [valid, setValid] = useState(true);
  const [mode, setMode] = useState<"loading" | "source" | "rich">("loading");
  const [saving, setSaving] = useState(false);
  const [savePending, setSavePending] = useState(false);
  const [action, setAction] = useState<"save" | "discard" | null>(null);
  const [error, setError] = useState<"conflict" | "missing" | "failed" | null>(null);
  const [confirm, setConfirm] = useState<"discard" | "reload" | null>(null);
  const [editorKey, setEditorKey] = useState(0);
  const current = useRef(content);
  const latest = useRef(remote);
  const permission = useRef(enabled);
  const validity = useRef(valid);
  const alive = useRef(true);
  const flight = useRef<Promise<NoteDraft | undefined> | null>(null);
  const actionLock = useRef(false);
  const pendingSave = useRef<{ id: string; input: UpdateNote; etag: string } | null>(null);
  useEffect(() => {
    permission.current = enabled;
  }, [enabled]);
  useEffect(() => {
    validity.current = valid && noteContentSchema.safeParse(content).success;
  }, [valid, content]);
  function edit(value: UpdateNote) {
    current.current = value;
    setContent(value);
  }
  const dirty = !valid || !sameContent(content, remote);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const accept = useCallback((value: NoteDraft) => {
    latest.current = value;
    if (alive.current) setRemote(value);
  }, []);

  const persist = useCallback((): Promise<NoteDraft | undefined> => {
    if (flight.current) return flight.current;
    if (!permission.current || !validity.current) return Promise.resolve(undefined);
    if (sameContent(current.current, latest.current)) return Promise.resolve(latest.current);
    setSaving(true);
    const run = async () => {
      try {
        while (
          permission.current &&
          validity.current &&
          !sameContent(current.current, latest.current)
        ) {
          const submitted = current.current;
          const before = latest.current;
          let updated: NoteDraft;
          try {
            updated = await client.updateDraft(before.id, submitted, before.etag);
          } catch (cause) {
            // A lost PUT response may already have committed. Read before retrying
            // with an old ETag; never overwrite another tab's different contents.
            if (!(cause instanceof NotesRequestError) || cause.status === 412) {
              const recovered = await client.readDraft(before.id);
              if (!sameContent(submitted, recovered)) throw cause;
              updated = recovered;
            } else throw cause;
          }
          accept(updated);
        }
        if (alive.current) setError(null);
        return latest.current;
      } catch (cause) {
        if (alive.current)
          setError(
            cause instanceof NotesRequestError && [409, 412].includes(cause.status)
              ? "conflict"
              : cause instanceof NotesRequestError && cause.status === 404
                ? "missing"
                : "failed",
          );
        return undefined;
      } finally {
        flight.current = null;
        if (alive.current) setSaving(false);
      }
    };
    const promise = run();
    flight.current = promise;
    return promise;
  }, [accept, client]);

  useEffect(() => {
    if (!dirty || !enabled || !valid || error || action !== null) return;
    const timer = setTimeout(() => void persist(), 600);
    return () => clearTimeout(timer);
  }, [content, dirty, enabled, valid, error, action, persist]);

  useEffect(() => {
    if (!dirty && action === null && !savePending) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, action, savePending]);

  useEffect(() => {
    if (!enabled) return;
    const refresh = () => {
      if (!alive.current || flight.current || actionLock.current || pendingSave.current) return;
      const requestedETag = latest.current.etag;
      void client
        .readDraft(latest.current.id)
        .then((value) => {
          if (
            !alive.current ||
            flight.current ||
            actionLock.current ||
            pendingSave.current ||
            requestedETag !== latest.current.etag
          )
            return;
          // Refresh source deletion/staleness without silently replacing local edits.
          if (value.etag === latest.current.etag) accept(value);
          else if (sameContent(current.current, latest.current)) {
            current.current = { title: value.title, content: value.content };
            setContent(current.current);
            accept(value);
            setEditorKey((key) => key + 1);
          } else setError("conflict");
        })
        .catch((cause) => {
          if (
            alive.current &&
            !pendingSave.current &&
            cause instanceof NotesRequestError &&
            cause.status === 404
          )
            setError("missing");
        });
    };
    const timer = setInterval(refresh, 10_000);
    const onFocus = () => {
      void Promise.resolve().then(refresh);
    };
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [accept, client, enabled]);

  async function finish(kind: "save" | "discard") {
    if (actionLock.current || !enabled) return;
    actionLock.current = true;
    setAction(kind);
    setConfirm(null);
    try {
      if (kind === "save") {
        if (!pendingSave.current) {
          const value = await persist();
          if (!value || !validity.current || !alive.current || !permission.current) return;
          pendingSave.current = { id: value.id, input: current.current, etag: value.etag };
          setSavePending(true);
        }
        const submitted = pendingSave.current;
        const result = await client.save(submitted.id, submitted.input, submitted.etag);
        pendingSave.current = null;
        setSavePending(false);
        if (alive.current) onSaved(result);
      } else {
        if (flight.current) await flight.current;
        try {
          await client.discard(latest.current.id, latest.current.etag);
        } catch (cause) {
          if (!(cause instanceof NotesRequestError && cause.status === 404)) {
            // A successful DELETE can lose its response. Confirm absence before
            // asking the user to repeat an already completed discard.
            try {
              await client.readDraft(latest.current.id);
            } catch (readError) {
              if (readError instanceof NotesRequestError && readError.status === 404) {
                if (alive.current) onDiscarded();
                return;
              }
            }
            throw cause;
          }
        }
        if (alive.current) onDiscarded();
      }
    } catch (cause) {
      if (
        kind === "save" &&
        cause instanceof NotesRequestError &&
        [400, 404, 409, 412, 422, 428].includes(cause.status)
      ) {
        pendingSave.current = null;
        if (alive.current) setSavePending(false);
      }
      if (alive.current)
        setError(
          cause instanceof NotesRequestError && [409, 412].includes(cause.status)
            ? "conflict"
            : cause instanceof NotesRequestError && cause.status === 404
              ? "missing"
              : "failed",
        );
    } finally {
      actionLock.current = false;
      if (alive.current) setAction(null);
    }
  }

  async function reload() {
    if (actionLock.current || !enabled) return;
    setConfirm(null);
    actionLock.current = true;
    try {
      const value = await client.readDraft(remote.id);
      if (!alive.current) return;
      current.current = { title: value.title, content: value.content };
      setContent(current.current);
      accept(value);
      setValid(true);
      pendingSave.current = null;
      setSavePending(false);
      setError(null);
      setEditorKey((key) => key + 1);
    } catch {
      if (alive.current) setError("failed");
    } finally {
      actionLock.current = false;
    }
  }

  const disabled = !enabled || action !== null;
  const editingDisabled = disabled || savePending;
  return (
    <section
      className="ai-draft-panel space-y-4"
      aria-label="AI draft"
      onKeyDown={(event) => {
        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
          event.preventDefault();
          event.stopPropagation();
          if (!error && !actionLock.current) void persist();
        }
      }}
    >
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">AI draft</h2>
        <span role="status" className="text-sm text-muted-foreground">
          {action === "save"
            ? "Saving as a new note..."
            : saving
              ? "Saving draft..."
              : dirty
                ? "Draft changes not saved"
                : "Draft saved"}
        </span>
        <div className="flex flex-wrap gap-3">
          <Button
            disabled={disabled || !valid || error !== null}
            onClick={() => void finish("save")}
          >
            Save as new note
          </Button>
          <Button
            variant="outline"
            disabled={disabled || savePending}
            onClick={() => setConfirm("discard")}
          >
            Discard draft
          </Button>
        </div>
      </header>
      <p className="text-sm text-muted-foreground">
        Generated from your note. Review it before saving. This draft expires{" "}
        {new Date(remote.expiresAt).toLocaleString()}.
      </p>
      {remote.source.deleted ? (
        <p role="note">
          The source note was deleted. You can still save this draft as a separate note.
        </p>
      ) : remote.source.stale ? (
        <p role="note">The source note has changed. This draft belongs to an older version.</p>
      ) : null}
      {error && (
        <div className="space-y-2">
          <p role="alert">
            {error === "conflict"
              ? "This draft changed elsewhere. Your edits are preserved."
              : error === "missing"
                ? "This draft expired or was removed. Your text is still here; copy it before leaving."
                : savePending
                  ? "Could not confirm the new note was saved. Retry to recover the same note."
                  : "Could not save the draft. Your edits are preserved."}
          </p>
          {error === "conflict" ? (
            <Button variant="outline" disabled={disabled} onClick={() => setConfirm("reload")}>
              Reload saved draft
            </Button>
          ) : error === "failed" ? (
            <Button
              variant="outline"
              disabled={disabled}
              onClick={() => void (pendingSave.current ? finish("save") : persist())}
            >
              {savePending ? "Retry saving note" : "Retry draft save"}
            </Button>
          ) : null}
        </div>
      )}
      <Label htmlFor={`draft-title-${initial.id}`}>Draft title</Label>
      <Input
        id={`draft-title-${initial.id}`}
        value={content.title}
        maxLength={256}
        disabled={editingDisabled}
        onChange={(event) => edit({ ...content, title: event.target.value })}
      />
      <Suspense fallback={<p>Opening draft editor...</p>}>
        <Editor
          key={editorKey}
          initialContent={content.content}
          disabled={editingDisabled}
          onChange={(value) => edit({ ...content, content: value })}
          onModeChange={setMode}
          onValidityChange={setValid}
        />
      </Suspense>
      {mode === "source" && typeof content.content === "string" && (
        <MarkdownPreview content={content.content} />
      )}
      {!valid && <p role="alert">This content cannot be saved yet. Your text is preserved.</p>}
      {remote.sources.length > 0 && (
        <div className="space-y-2">
          <h3 className="font-medium">Sources</h3>
          <ul className="space-y-2">
            {remote.sources.map((source) => (
              <li key={source.id}>
                <a
                  className="break-all underline underline-offset-4"
                  href={source.url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {source.title || source.url}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
      <AlertDialog
        open={confirm !== null}
        onOpenChange={(open) => {
          if (!open) setConfirm(null);
        }}
      >
        <AlertDialogContent className="notes-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirm === "reload" ? "Replace local draft edits?" : "Discard AI draft?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirm === "reload"
                ? "Reloading replaces your local edits with the saved draft."
                : "This removes the generated draft and your edits. Your original note stays unchanged."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep editing</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => void (confirm === "reload" ? reload() : finish("discard"))}
            >
              {confirm === "reload" ? "Reload draft" : "Discard permanently"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
