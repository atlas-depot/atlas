import { NotesRequestError } from "./notes-store";

export type RequestFailure =
  | "unauthenticated"
  | "forbidden"
  | "missing"
  | "unavailable"
  | "conflict"
  | "failed";
export type EditableContent = { title: string; content: string };

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
    case 412:
      return "conflict";
    case 501:
      return "unavailable";
    default:
      return "failed";
  }
}

export function sameContent(left: EditableContent, right: EditableContent) {
  return left.title === right.title && left.content === right.content;
}

/** An untouched blank draft is disposable, although explicit Save may create an empty note. */
export function hasUnsavedChanges(draft: EditableContent | null, saved: EditableContent | null) {
  if (!draft) return false;
  return saved ? !sameContent(draft, saved) : draft.title !== "" || draft.content !== "";
}

export function savingMessage(current: EditableContent, submitted: EditableContent) {
  return sameContent(current, submitted)
    ? "Saving..."
    : "Saving earlier edits. Newer changes are unsaved.";
}

export function failureMessage(kind: RequestFailure, operation: "list" | "read" | "save") {
  switch (kind) {
    case "unauthenticated":
      return "Your session has ended. Sign in again. Copy any unsaved text before leaving this page.";
    case "forbidden":
      return "You do not have access to this note. Your unsaved text is preserved.";
    case "missing":
      return "This note is no longer available. Your unsaved text is preserved. Refresh the notes list or keep your text as a new note.";
    case "unavailable":
      return "Your notes are not available yet. Please try again later.";
    case "conflict":
      return "This note changed on the server. Your edits are preserved. Compare the latest version before continuing.";
    default:
      return operation === "list"
        ? "Could not load notes. Try again."
        : operation === "read"
          ? "Could not open note. Your current changes are still here. Try again."
          : "Save failed. Your changes are still here. Try again.";
  }
}
