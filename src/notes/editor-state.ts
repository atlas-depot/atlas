import { NotesRequestError } from "./notes-store";
import {
  blockNoteDocumentSchema,
  canonicalNoteContent,
  type NoteContent,
} from "../../shared/document";

export type RequestFailure =
  | "unauthenticated"
  | "forbidden"
  | "missing"
  | "unavailable"
  | "creation-conflict"
  | "conflict"
  | "failed";
export type EditableContent = { title: string; content: NoteContent };

export function emptyNoteDocument() {
  return blockNoteDocumentSchema.parse({
    format: "blocknote",
    schemaVersion: 1,
    blocks: [{ id: crypto.randomUUID(), type: "paragraph", props: {}, content: [], children: [] }],
  });
}

/** Error classes drive recovery; provider text must never become UI copy. */
export function classifyFailure(error: unknown): RequestFailure {
  if (!(error instanceof NotesRequestError)) return "failed";
  switch (error.status) {
    case 401:
      return "unauthenticated";
    case 403:
      return "forbidden";
    case 404:
      return "missing";
    case 409:
      return "creation-conflict";
    case 412:
      return "conflict";
    case 501:
      return "unavailable";
    default:
      return "failed";
  }
}

export function sameContent(left: EditableContent, right: EditableContent) {
  return (
    left.title === right.title &&
    typeof left.content === typeof right.content &&
    canonicalNoteContent(left.content) === canonicalNoteContent(right.content)
  );
}

/** An untouched blank draft is disposable, although explicit Save may create an empty note. */
export function hasUnsavedChanges(draft: EditableContent | null, saved: EditableContent | null) {
  if (!draft) return false;
  if (saved) return !sameContent(draft, saved);
  if (draft.title !== "") return true;
  if (typeof draft.content === "string") return draft.content !== "";
  const blocks = draft.content.blocks;
  return (
    blocks.length !== 1 ||
    blocks[0].type !== "paragraph" ||
    blocks[0].children.length !== 0 ||
    blocks[0].content.length !== 0 ||
    blocks[0].props.backgroundColor !== "default" ||
    blocks[0].props.textColor !== "default" ||
    blocks[0].props.textAlignment !== "left"
  );
}

export function savingMessage(current: EditableContent, submitted: EditableContent) {
  return sameContent(current, submitted)
    ? "Saving..."
    : "Saving earlier edits. Newer changes are unsaved.";
}

export function failureMessage(
  kind: RequestFailure,
  operation: "list" | "read" | "save" | "delete",
) {
  switch (kind) {
    case "unauthenticated":
      return "Your session has ended. Sign in again. Copy any unsaved text before leaving this page.";
    case "forbidden":
      return operation === "list"
        ? "The notes list request was blocked. Restore request access, then reload the page. Your current text is preserved."
        : operation === "read"
          ? "This request was blocked. Your current text is unchanged. You can choose another note."
          : operation === "delete"
            ? "This request was blocked. Deleting is unavailable until request access is restored. Your note and unsaved text are still here."
            : "This request was blocked. Saving is unavailable until request access is restored. Your unsaved text is preserved.";
    case "missing":
      if (operation === "list")
        return "The notes list is no longer available. Refresh the notes list or try again later. Your current text is preserved.";
      return "This note is no longer available. Your unsaved text is preserved. Refresh the notes list or keep your text as a new note.";
    case "unavailable":
      return "Your notes are not available yet. Please try again later.";
    case "creation-conflict":
      return "Could not reconcile this creation. The original note or creation request has changed. Your text is preserved. Refresh the notes list to inspect existing notes; saving a duplicate is blocked.";
    case "conflict":
      return operation === "delete"
        ? "This note changed on the server. Nothing was deleted. Compare the latest version before trying again."
        : "This note changed on the server. Your edits are preserved. Compare the latest version before continuing.";
    default:
      return operation === "list"
        ? "Could not load notes. Try again."
        : operation === "read"
          ? "Could not open note. Your current changes are still here. Try again."
          : operation === "delete"
            ? "Could not confirm deletion. Your text is preserved. Refresh the notes list before trying again; the note may already be gone."
            : "Save failed. Your changes are still here. Try again.";
  }
}
