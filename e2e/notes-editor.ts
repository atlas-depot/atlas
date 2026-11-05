import { expect, type Locator } from "@playwright/test";

/** Assert actual editable content for both preserved source and structured notes. */
export async function expectEditorContent(editor: Locator, expected: string | RegExp) {
  await expect(editor).toBeVisible();
  const actual = async () =>
    (await editor.evaluate((element) => element.tagName)) === "TEXTAREA"
      ? editor.inputValue()
      : editor.innerText();
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
