import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertDialog,
  Box,
  Button,
  Card,
  Flex,
  Grid,
  Heading,
  Text,
  TextArea,
  TextField,
} from "@radix-ui/themes";
import { noteContentSchema, type Note } from "../../shared/notes";
import { MarkdownPreview } from "./MarkdownPreview";
import type { NotesStore } from "./notes-store";

type LoadState = "loading" | "ready" | "failed";
type SaveState = "idle" | "saving" | "failed";
type PendingSelection = { kind: "new" } | { kind: "select"; note: Note };

function sameContent(left: Note, right: Note) {
  return left.title === right.title && left.content === right.content;
}

export function NotesWorkspace({
  store,
  example = false,
}: {
  store: NotesStore;
  example?: boolean;
}) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [draft, setDraft] = useState<Note | null>(null);
  const [saved, setSaved] = useState<Note | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [pending, setPending] = useState<PendingSelection | null>(null);
  const savingRef = useRef(false);
  const titleRef = useRef<HTMLInputElement>(null);
  const dirty = draft !== null && (saved === null || !sameContent(draft, saved));
  const validation = draft
    ? noteContentSchema.safeParse({ title: draft.title, content: draft.content })
    : null;

  useEffect(() => {
    let active = true;
    void store.list().then(
      (result) => {
        if (!active) return;
        setNotes(result);
        setDraft(result[0] ?? null);
        setSaved(result[0] ?? null);
        setLoadState("ready");
      },
      () => {
        if (active) setLoadState("failed");
      },
    );
    return () => {
      active = false;
    };
  }, [store, loadAttempt]);

  useEffect(() => {
    if (!dirty && saveState !== "saving") return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, saveState]);

  const save = useCallback(async () => {
    if (!draft || !dirty || savingRef.current || !validation?.success) return;
    const snapshot = { ...draft };
    savingRef.current = true;
    setSaveState("saving");
    try {
      const result = await store.save(snapshot);
      setNotes((current) => [result, ...current.filter((note) => note.id !== result.id)]);
      setSaved(result);
      // A completed save acknowledges only the snapshot, not edits typed during the request.
      setDraft((current) =>
        current && sameContent(current, snapshot)
          ? result
          : current
            ? { ...result, title: current.title, content: current.content }
            : null,
      );
      setSaveState("idle");
    } catch {
      setSaveState("failed");
    } finally {
      savingRef.current = false;
    }
  }, [draft, dirty, store, validation?.success]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "s") return;
      event.preventDefault();
      if (!pending) void save();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [save, pending]);

  function select(selection: PendingSelection) {
    const createdAt = new Date().toISOString();
    const next =
      selection.kind === "select"
        ? selection.note
        : {
            id: crypto.randomUUID(),
            title: "",
            content: "",
            createdAt,
            updatedAt: createdAt,
          };
    setDraft(next);
    setSaved(selection.kind === "select" ? next : null);
    setSaveState("idle");
    requestAnimationFrame(() => titleRef.current?.focus());
  }

  function requestSelection(selection: PendingSelection) {
    if (savingRef.current || (selection.kind === "select" && selection.note.id === draft?.id))
      return;
    if (dirty) setPending(selection);
    else select(selection);
  }

  const status =
    saveState === "saving"
      ? "Saving..."
      : saveState === "failed"
        ? "Save failed. Your changes are still here. Try again."
        : dirty
          ? "Unsaved changes"
          : example
            ? "Saved for this preview session"
            : "Saved";

  return (
    <Box asChild p={{ initial: "4", sm: "6" }}>
      <main className="notes-workspace">
        <Flex justify="between" align="center" gap="3" wrap="wrap" mb="4">
          <Heading as="h1">Atlas notes</Heading>
          <Button
            disabled={loadState !== "ready" || saveState === "saving"}
            onClick={() => requestSelection({ kind: "new" })}
          >
            New note
          </Button>
        </Flex>
        {example && (
          <Text as="p" size="2" mb="4" role="note">
            Development preview with synthetic notes. Saves last only until reload.
          </Text>
        )}
        {loadState === "loading" && (
          <Text as="p" role="status">
            Loading notes...
          </Text>
        )}
        {loadState === "failed" && (
          <Flex direction="column" align="start" gap="3">
            <Text as="p" role="alert">
              Could not load notes. {example ? "Try again." : "Notes are not connected yet."}
            </Text>
            <Button
              onClick={() => {
                setLoadState("loading");
                setLoadAttempt((attempt) => attempt + 1);
              }}
            >
              Retry loading
            </Button>
          </Flex>
        )}
        {loadState === "ready" && (
          <Grid columns={{ initial: "1", sm: "220px minmax(0, 1fr)" }} gap="4">
            <Box asChild>
              <nav aria-label="Notes">
                <Heading as="h2" size="4" mb="3">
                  Your notes
                </Heading>
                {notes.length === 0 ? (
                  <Text as="p">No notes yet. Create a new note to get started.</Text>
                ) : (
                  <Flex direction="column" gap="2">
                    {notes.map((note) => (
                      <Button
                        key={note.id}
                        variant={note.id === draft?.id ? "soft" : "outline"}
                        aria-current={note.id === draft?.id ? "true" : undefined}
                        disabled={saveState === "saving"}
                        className="note-list-button"
                        onClick={() => requestSelection({ kind: "select", note })}
                      >
                        {note.title || "Untitled note"}
                      </Button>
                    ))}
                  </Flex>
                )}
              </nav>
            </Box>
            {draft ? (
              <Flex direction="column" gap="4" className="note-detail">
                <Card>
                  <Flex direction="column" gap="3">
                    <Heading as="h2" size="4">
                      Edit note
                    </Heading>
                    <Text as="label" htmlFor="note-title" size="2" weight="medium">
                      Title
                    </Text>
                    <TextField.Root
                      ref={titleRef}
                      id="note-title"
                      value={draft.title}
                      maxLength={256}
                      onChange={(event) => setDraft({ ...draft, title: event.target.value })}
                    />
                    <Text as="label" htmlFor="note-content" size="2" weight="medium">
                      Markdown source
                    </Text>
                    <TextArea
                      id="note-content"
                      value={draft.content}
                      maxLength={100_000}
                      rows={14}
                      className="note-source"
                      onChange={(event) => setDraft({ ...draft, content: event.target.value })}
                    />
                    {validation && !validation.success && (
                      <Text as="p" role="alert">
                        Use a title of up to 256 characters and content of up to 100,000 characters.
                      </Text>
                    )}
                    <Flex align="center" gap="3" wrap="wrap">
                      <Button
                        disabled={!dirty || saveState === "saving" || !validation?.success}
                        onClick={() => void save()}
                      >
                        Save
                      </Button>
                      <Text as="p" role={saveState === "failed" ? "alert" : "status"} size="2">
                        {status}
                      </Text>
                      <Text size="1" color="gray">
                        Ctrl/Cmd+S to save
                      </Text>
                    </Flex>
                  </Flex>
                </Card>
                <Card>
                  <Heading as="h2" size="4" mb="3">
                    Preview
                  </Heading>
                  {draft.content ? (
                    <MarkdownPreview content={draft.content} />
                  ) : (
                    <Text as="p">Write Markdown to see a preview.</Text>
                  )}
                </Card>
              </Flex>
            ) : (
              <Text as="p">Select a note or create a new one.</Text>
            )}
          </Grid>
        )}
        <AlertDialog.Root
          open={pending !== null}
          onOpenChange={(open) => {
            if (!open) setPending(null);
          }}
        >
          <AlertDialog.Content maxWidth="450px">
            <AlertDialog.Title>Discard unsaved changes?</AlertDialog.Title>
            <AlertDialog.Description>
              Your latest changes have not been saved. Stay to save them, or discard them to
              continue.
            </AlertDialog.Description>
            <Flex gap="3" mt="4" justify="end" wrap="wrap">
              <AlertDialog.Cancel>
                <Button variant="soft" color="gray">
                  Keep editing
                </Button>
              </AlertDialog.Cancel>
              <AlertDialog.Action>
                <Button
                  color="red"
                  onClick={() => {
                    if (pending) select(pending);
                  }}
                >
                  Discard changes
                </Button>
              </AlertDialog.Action>
            </Flex>
          </AlertDialog.Content>
        </AlertDialog.Root>
      </main>
    </Box>
  );
}
