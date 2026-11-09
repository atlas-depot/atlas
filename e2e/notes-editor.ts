import { expect, type Locator, type Page } from "@playwright/test";
import type { Note, NoteSummary } from "../shared/notes.ts";

/** Assert actual editable content for both preserved source and structured notes. */
export async function expectEditorContent(editor: Locator, expected: string | RegExp) {
  await expect(editor).toBeVisible();
  // Read type and value from the same node: note selection can remount the
  // editor between separate locator calls (source textarea -> rich textbox).
  const actual = () =>
    editor.evaluate((element) => {
      if (element.tagName === "TEXTAREA" && "value" in element) return String(element.value);
      return "innerText" in element ? String(element.innerText) : element.textContent;
    });
  if (typeof expected === "string") await expect.poll(actual).toBe(expected);
  else await expect.poll(actual).toMatch(expected);
}

/** Exact visible text plus the versioned JSON envelope, independent of generated block IDs. */
export function paragraphDocument(text: string) {
  return expect.objectContaining({
    format: "blocknote",
    schemaVersion: 1,
    blocks: [
      expect.objectContaining({
        type: "paragraph",
        content: [{ type: "text", text, styles: {} }],
        children: [],
      }),
    ],
  });
}

/** GET /api/notes rows carry metadata only. The strict list schema rejects `content`. */
export function toListRow(note: Note): NoteSummary {
  const { content: _content, ...row } = note;
  return row;
}

/**
 * Serve GET /api/notes as list rows and each note with its ETag at /api/notes/:id.
 * Leave out an ETag to list a note without serving it. Routes registered later run
 * first, so a test can override one note or method and call `route.fallback()` for the rest.
 */
export async function serveNotes(
  page: Page,
  notes: readonly (readonly [note: Note, etag?: string])[],
) {
  await page.route("**/api/notes", (route) =>
    route.fulfill({ json: { notes: notes.map(([note]) => toListRow(note)) } }),
  );
  for (const [note, etag] of notes)
    if (etag !== undefined)
      await page.route(`**/api/notes/${note.id}`, (route) =>
        route.fulfill({ json: note, headers: { ETag: etag } }),
      );
}
