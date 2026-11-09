import { describe, expect, it } from "vite-plus/test";
import {
  classifyFailure,
  emptyNoteDocument,
  failureMessage,
  hasUnsavedChanges,
  sameContent,
  savingMessage,
  statusMessage,
  type StatusView,
} from "./editor-state";
import { NotesRequestError } from "./notes-store";

describe("editor recovery and save state", () => {
  it("recognizes blank structured drafts but preserves formatting and block edits", () => {
    const content = emptyNoteDocument();
    expect(hasUnsavedChanges({ title: "", content }, null)).toBe(false);
    const formatted = structuredClone(content);
    if (formatted.blocks[0].type !== "paragraph") throw new Error("Expected paragraph");
    formatted.blocks[0].props.backgroundColor = "red";
    expect(hasUnsavedChanges({ title: "", content: formatted }, null)).toBe(true);
    const extraBlock = structuredClone(content);
    extraBlock.blocks.push({ ...extraBlock.blocks[0], id: "second" });
    expect(hasUnsavedChanges({ title: "", content: extraBlock }, null)).toBe(true);
  });
  it("compares document values, while preserving format and stable block identity", () => {
    const content = emptyNoteDocument();
    const copy = {
      blocks: content.blocks,
      schemaVersion: content.schemaVersion,
      format: content.format,
    };
    expect(sameContent({ title: "", content }, { title: "", content: copy })).toBe(true);
    expect(sameContent({ title: "", content }, { title: "", content: "" })).toBe(false);
    expect(sameContent({ title: "", content }, { title: "", content: emptyNoteDocument() })).toBe(
      false,
    );
  });
  it.each([
    [401, "unauthenticated"],
    [403, "forbidden"],
    [404, "missing"],
    [409, "creation-conflict"],
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

it("keeps creation replay conflicts separate from editable-note revision conflicts", () => {
  expect(failureMessage("creation-conflict", "save")).toContain("saving a duplicate is blocked");
});

describe("header status precedence", () => {
  const draft = { title: "Note", content: "Current" };
  const idle: StatusView = {
    loadState: "ready",
    opening: false,
    deleting: false,
    readFailure: null,
    writesForbidden: false,
    deleteFailure: null,
    saveState: "idle",
    draft: null,
    savingSnapshot: null,
    hasSaved: false,
    deleteNotice: null,
    dirty: false,
    example: false,
  };
  it.each<[string, Partial<StatusView>, string]>([
    ["loading over everything", { loadState: "loading", opening: true }, "Loading notes..."],
    [
      "a list failure over opening",
      { loadState: "failed", opening: true },
      "Could not load notes. Try again.",
    ],
    ["opening over deleting", { opening: true, deleting: true }, "Opening note..."],
    ["deleting over a read failure", { deleting: true, readFailure: "failed" }, "Deleting note..."],
    [
      "a missing read over forbidden writes",
      { readFailure: "missing", writesForbidden: true },
      "This note is no longer available. Your current text is unchanged. Refresh the notes list or choose another note.",
    ],
    ["another read failure", { readFailure: "failed" }, failureMessage("failed", "read")],
    [
      "forbidden writes over a delete failure, worded for the delete",
      { writesForbidden: true, deleteFailure: "forbidden" },
      failureMessage("forbidden", "delete"),
    ],
    [
      "forbidden writes after a save",
      { writesForbidden: true, saveState: "forbidden" },
      failureMessage("forbidden", "save"),
    ],
    [
      "a delete failure over saving",
      { deleteFailure: "conflict", saveState: "saving" },
      failureMessage("conflict", "delete"),
    ],
    [
      "saving with newer edits",
      { saveState: "saving", draft, savingSnapshot: { title: "Note", content: "Earlier" } },
      "Saving earlier edits. Newer changes are unsaved.",
    ],
    ["saving without a snapshot", { saveState: "saving", draft }, "Saving..."],
    [
      "an unconfirmed creation over a delete notice",
      { saveState: "failed", deleteNotice: "Note deleted. No notes left." },
      "Could not confirm creation. Your text is preserved. The note may already exist. Save again to recover the same creation without duplicating it.",
    ],
    [
      "a failed update of a saved note",
      { saveState: "failed", hasSaved: true },
      "Save failed. Your changes are still here. Try again.",
    ],
    [
      "a delete notice over unsaved changes",
      { deleteNotice: "Note deleted. No notes left.", dirty: true },
      "Note deleted. No notes left.",
    ],
    ["unsaved changes over a new note", { dirty: true, draft }, "Unsaved changes"],
    ["a new note", { draft }, "New note"],
    ["a saved note", { draft, hasSaved: true }, "Saved"],
    [
      "a saved preview note",
      { draft, hasSaved: true, example: true },
      "Saved for this preview session",
    ],
    ["no selection", {}, "Select a note or create a new one."],
  ])("shows %s", (_name, overrides, expected) => {
    expect(statusMessage({ ...idle, ...overrides })).toBe(expected);
  });
});
