import { describe, expect, it } from "vite-plus/test";
import { classifyFailure, failureMessage, hasUnsavedChanges, savingMessage } from "./editor-state";
import { NotesRequestError } from "./notes-store";

describe("editor recovery and save state", () => {
  it.each([
    [401, "unauthenticated"],
    [403, "forbidden"],
    [404, "missing"],
    [412, "conflict"],
    [501, "unavailable"],
    [500, "failed"],
  ] as const)("classifies HTTP %s as %s", (status, kind) => {
    expect(classifyFailure(new NotesRequestError(status, "INTERNAL_ERROR"))).toBe(kind);
  });
  it("treats network failures as recoverable without exposing their message", () => {
    expect(classifyFailure(new Error("sensitive transport detail"))).toBe("failed");
    expect(failureMessage("failed", "save")).toBe(
      "Save failed. Your changes are still here. Try again.",
    );
  });
  it("does not warn for an untouched blank note but preserves meaningful whitespace and edits", () => {
    expect(hasUnsavedChanges(null, null)).toBe(false);
    expect(hasUnsavedChanges({ title: "", content: "" }, null)).toBe(false);
    expect(hasUnsavedChanges({ title: "", content: " " }, null)).toBe(true);
    expect(hasUnsavedChanges({ title: "Draft", content: "" }, null)).toBe(true);
    expect(
      hasUnsavedChanges(
        { title: "Saved", content: "Original" },
        { title: "Saved", content: "Original" },
      ),
    ).toBe(false);
    expect(
      hasUnsavedChanges(
        { title: "Saved", content: "Changed" },
        { title: "Saved", content: "Original" },
      ),
    ).toBe(true);
  });
  it("distinguishes the saving snapshot from newer unsaved text before completion", () => {
    const submitted = { title: "Note", content: "First" };
    expect(savingMessage({ title: "Note", content: "First" }, submitted)).toBe("Saving...");
    expect(savingMessage({ title: "Note", content: "Second" }, submitted)).toBe(
      "Saving earlier edits. Newer changes are unsaved.",
    );
  });
  it("reports unavailable storage as pending rather than a retryable load failure", () => {
    expect(failureMessage("unavailable", "list")).toBe(
      "Your notes are not available yet. Please try again later.",
    );
  });
});

it("does not misreport a forbidden request as resource ownership denial", () => {
  expect(failureMessage("forbidden", "read")).toBe(
    "This request was blocked. Your current text is unchanged. You can choose another note.",
  );
  expect(failureMessage("forbidden", "save")).toBe(
    "This request was blocked. Saving is unavailable until request access is restored. Your unsaved text is preserved.",
  );
});

it("gives list failures their own recovery messages", () => {
  expect(failureMessage("forbidden", "list")).toBe(
    "The notes list request was blocked. Restore request access, then reload the page. Your current text is preserved.",
  );
  expect(failureMessage("missing", "list")).toBe(
    "The notes list is no longer available. Refresh the notes list or try again later. Your current text is preserved.",
  );
});

it("describes delete failures without implying the note was removed", () => {
  expect(failureMessage("conflict", "delete")).toBe(
    "This note changed on the server. Nothing was deleted. Compare the latest version before trying again.",
  );
  expect(failureMessage("failed", "delete")).toBe(
    "Could not confirm deletion. Your text is preserved. Refresh the notes list before trying again; the note may already be gone.",
  );
  expect(failureMessage("forbidden", "delete")).toContain("Deleting is unavailable");
  expect(failureMessage("missing", "delete")).toBe(
    "This note is no longer available. Your unsaved text is preserved. Refresh the notes list or keep your text as a new note.",
  );
});
