import { expect, test, type Page } from "@playwright/test";
import { noteSchema, updateNoteSchema, type Note } from "../shared/notes.ts";
import { type BlockNoteDocument } from "../shared/document.ts";

const noteId = "fa100001-1234-4000-8000-000000000053";
const text = (value: string) => [{ type: "text" as const, text: value, styles: {} }];
const paragraph = (value: string) => ({
  id: "paragraph",
  type: "paragraph" as const,
  props: {},
  content: text(value),
  children: [],
});
const code = (language: string, value: string) => ({
  id: "code",
  type: "codeBlock" as const,
  props: { language },
  content: text(value),
  children: [],
});

async function openDocument(page: Page, blocks: unknown[]) {
  let note: Note = noteSchema.parse({
    id: noteId,
    title: "Editor controls",
    content: { format: "blocknote", schemaVersion: 1, blocks },
    createdAt: "2026-11-01T09:00:00.000Z",
    updatedAt: "2026-11-01T09:00:00.000Z",
  });
  let writes = 0;
  await page.route("**/api/auth/session", (route) =>
    route.fulfill({
      json: {
        user: { id: "user_alice", email: "alice@example.test", firstName: "Alice", lastName: null },
      },
    }),
  );
  await page.route("**/api/organize-work", (route) =>
    route.fulfill({ json: { runs: [], drafts: [] } }),
  );
  await page.route("**/api/notes", (route) => route.fulfill({ json: { notes: [note] } }));
  await page.route(`**/api/notes/${noteId}`, (route) => {
    if (route.request().method() === "PUT") {
      const input = updateNoteSchema.parse(route.request().postDataJSON());
      note = { ...note, ...input };
      writes++;
    }
    return route.fulfill({ json: note, headers: { ETag: `"controls-${writes}"` } });
  });
  await page.goto("/");
  await expect(page.getByRole("textbox", { name: "Note content", exact: true })).toBeVisible();
  return { document: () => note.content as BlockNoteDocument, writes: () => writes };
}

async function save(page: Page, state: { writes: () => number }) {
  const before = state.writes();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect.poll(state.writes).toBe(before + 1);
}

test("language grammars stay lazy behind the complete catalog", async () => {
  const { codeLanguageChoices, createNoteCodeHighlighter } =
    await import("../src/notes/code-theme.ts");
  expect(codeLanguageChoices.map((choice) => choice.id)).toEqual(
    expect.arrayContaining(["text", "python", "sql", "c", "rust", "typescript"]),
  );
  const highlighter = await createNoteCodeHighlighter();
  try {
    expect(highlighter.getLoadedLanguages()).toEqual([]);
    await highlighter.loadLanguage("python");
    expect(highlighter.getLoadedLanguages()).toContain("python");
    expect(highlighter.getLoadedLanguages()).not.toContain("sql");
    expect(highlighter.getLoadedThemes()).toEqual(["catppuccin-mocha"]);
  } finally {
    highlighter.dispose();
  }
});

test("unknown code remains readable and catalog alias search saves a deliberate language", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  const source = "let answer: u32 = 42;";
  const state = await openDocument(page, [
    code("atlas-dsl", source),
    { ...code("ts", "const later: number = 42;"), id: "known-code" },
  ]);
  const picker = page.getByRole("combobox", { name: "Code language", exact: true }).first();
  const unknown = page.locator("code.bn-inline-content").first();
  const known = page.locator("code.bn-inline-content").nth(1);
  await expect.poll(() => known.locator("span.shiki").count()).toBeGreaterThan(2);
  await expect(unknown.locator("span.shiki")).toHaveCount(0);
  await expect(picker).toHaveText("atlas-dsl");
  await expect(unknown).toHaveText(source);
  await page.reload();
  await expect(picker).toHaveText("atlas-dsl");
  await picker.click();
  await page.getByRole("combobox", { name: "Search code languages" }).fill("rs");
  await page.getByRole("option", { name: "Rust", exact: true }).click();
  await expect(picker).toHaveText("Rust");
  await expect.poll(() => unknown.locator("span.shiki").count()).toBeGreaterThan(2);
  await save(page, state);
  expect(state.document().blocks[0]).toMatchObject({
    id: "code",
    props: { language: "rust" },
    content: text(source),
  });
  await page.reload();
  await expect(picker).toHaveText("Rust");
  expect(errors).toEqual([]);
});

for (const scenario of [
  {
    language: "typescript",
    label: "TypeScript",
    source: "const answer: number = 42;",
    width: 1280,
  },
  {
    language: "python",
    label: "Python",
    source: 'def greet(name):\n    return "Hello " + name',
    width: 375,
  },
])
  test(`real ${scenario.language} syntax and font survive mobile editing and reload`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: scenario.width, height: 900 });
    const state = await openDocument(page, [code("text", scenario.source)]);
    const picker = page.getByRole("combobox", { name: "Code language", exact: true });
    await picker.click();
    const search = page.getByRole("combobox", { name: "Search code languages" });
    await search.fill(scenario.language === "python" ? "py" : "typescript");
    await expect(page.getByRole("option", { name: scenario.label, exact: true })).toBeVisible();
    if (scenario.language === "python")
      await page.screenshot({
        path: testInfo.outputPath("editor-language-menu-mobile.png"),
        fullPage: true,
      });
    if (scenario.language === "python") await search.press("Enter");
    else await page.getByRole("option", { name: "TypeScript", exact: true }).click();
    await expect(picker).toHaveText(scenario.label);
    const content = page.locator("code.bn-inline-content");
    await expect(content).toHaveCSS("font-family", /Efe Mono/);
    await expect.poll(() => page.evaluate(`document.fonts.check('14px "Efe Mono"')`)).toBe(true);
    await expect.poll(() => content.locator("span.shiki").count()).toBeGreaterThan(2);
    expect(
      await content
        .locator("span.shiki")
        .evaluateAll(
          (spans) =>
            new Set(
              spans.map((span) => span.ownerDocument.defaultView?.getComputedStyle(span).color),
            ).size,
        ),
    ).toBeGreaterThan(2);
    await content.click();
    await content.evaluate((element) => {
      const doc = element.ownerDocument;
      const range = doc.createRange();
      range.selectNodeContents(element);
      range.collapse(false);
      const selection = doc.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      const event = doc.createEvent("Event");
      event.initEvent("selectionchange", false, false);
      doc.dispatchEvent(event);
    });
    await page.keyboard.press("ArrowRight");
    await page.keyboard.insertText(" ");
    await save(page, state);
    expect(state.document().blocks[0]).toMatchObject({
      props: { language: scenario.language },
      content: text(scenario.source + " "),
    });
    await page.reload();
    await expect(picker).toHaveText(scenario.label);
    await expect(content).toHaveText(scenario.source + " ");
    await expect.poll(() => content.locator("span.shiki").count()).toBeGreaterThan(2);
    expect(await page.evaluate("document.documentElement.scrollWidth <= innerWidth")).toBe(true);
    await page.screenshot({
      path: testInfo.outputPath(`editor-${scenario.language}.png`),
      fullPage: true,
    });
  });

test("block color checkmarks update immediately and persist", async ({ page }) => {
  const state = await openDocument(page, [paragraph("Keep this thought")]);
  await page.locator('[data-id="paragraph"]').last().hover();
  await page.getByRole("button", { name: "Open block menu" }).click();
  await page.getByRole("menuitem", { name: "Colors", exact: true }).hover();
  const red = page.locator('[data-test="text-color-red"]');
  await red.click();
  await expect(red).toHaveAttribute("aria-checked", "true");
  await expect(page.locator('[data-test="text-color-default"]')).toHaveAttribute(
    "aria-checked",
    "false",
  );
  const blue = page.locator('[data-test="background-color-blue"]');
  await blue.click();
  await expect(blue).toHaveAttribute("aria-checked", "true");
  await expect(red).toHaveAttribute("aria-checked", "true");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await save(page, state);
  expect(state.document().blocks[0]).toMatchObject({
    props: { textColor: "red", backgroundColor: "blue" },
  });
});

test("quote input shortcut creates a real quote with keyboard undo and redo", async ({ page }) => {
  const state = await openDocument(page, [paragraph("")]);
  const editor = page.getByRole("textbox", { name: "Note content", exact: true });
  await editor.click();
  await page.keyboard.type("> A source worth keeping");
  await expect(page.locator('[data-content-type="quote"]')).toHaveText("A source worth keeping");
  await save(page, state);
  expect(state.document().blocks[0]).toMatchObject({
    type: "quote",
    content: text("A source worth keeping"),
  });
  await page.locator('[data-content-type="quote"] .bn-inline-content').click();
  await page.keyboard.press("ControlOrMeta+z");
  await expect(editor).not.toHaveText("A source worth keeping");
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect(page.locator('[data-content-type="quote"]')).toHaveText("A source worth keeping");
});

test("table cells stay editable and their controls render at mobile width", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 900 });
  const state = await openDocument(page, [
    {
      id: "table",
      type: "table",
      props: {},
      content: {
        type: "tableContent",
        columnWidths: [120, 120],
        rows: [{ cells: [text("One"), text("Two")] }, { cells: [text("Three"), text("Four")] }],
      },
      children: [],
    },
  ]);
  const cell = page.getByRole("cell").first().locator("p");
  await cell.click();
  await page.keyboard.press("End");
  await page.keyboard.insertText(" edited");
  await expect(cell).toContainText("edited");
  await cell.hover();
  await expect(page.locator(".bn-table-handle").first()).toBeVisible();
  await save(page, state);
  await page.reload();
  await expect(cell).toContainText("edited");
  expect(await page.evaluate("document.documentElement.scrollWidth <= innerWidth")).toBe(true);
});

for (const width of [375, 320])
  test(`mobile ${width}px controls have separate touch targets without covering quote or code`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await openDocument(page, [
      { ...paragraph("A quoted thought"), id: "quote", type: "quote" },
      code("python", 'print("A small example")'),
    ]);
    const quote = page.locator('[data-content-type="quote"]');
    await quote.hover();
    const add = page.getByRole("button", { name: "Add block", exact: true });
    const menu = page.getByRole("button", { name: "Open block menu", exact: true });
    await expect(menu).toBeVisible();
    const quoteRect = (await quote.boundingBox())!;
    const addRect = (await add.boundingBox())!;
    const menuRect = (await menu.boundingBox())!;
    for (const rect of [addRect, menuRect]) {
      expect(rect.width).toBeGreaterThanOrEqual(44);
      expect(rect.height).toBeGreaterThanOrEqual(44);
      expect(rect.x).toBeGreaterThanOrEqual(0);
      expect(rect.x + rect.width).toBeLessThanOrEqual(quoteRect.x);
    }
    expect(addRect.x + addRect.width).toBeLessThanOrEqual(menuRect.x);
    await expect(add.locator("svg")).toHaveCSS("width", "14px");
    await expect(menu.locator("svg")).toHaveCSS("height", "14px");
    await page.screenshot({
      path: testInfo.outputPath(`quote-targets-${width}.png`),
      fullPage: true,
    });
    const picker = page.getByRole("combobox", { name: "Code language", exact: true });
    const pickerRect = (await picker.boundingBox())!;
    expect(pickerRect.height).toBeGreaterThanOrEqual(44);
    expect(pickerRect.width).toBeGreaterThanOrEqual(44);
    const codeRect = (await page.locator("code.bn-inline-content").boundingBox())!;
    expect(codeRect.y).toBeGreaterThanOrEqual(pickerRect.y + pickerRect.height);
    await picker.click();
    const search = page.getByRole("combobox", { name: "Search code languages" });
    await expect(search).toHaveCSS("font-size", "16px");
    expect((await search.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await search.fill("sql");
    const option = page.getByRole("option", { name: "SQL", exact: true });
    expect((await option.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    const popup = (await page.getByRole("dialog", { name: "Choose code language" }).boundingBox())!;
    expect(popup.x).toBeGreaterThanOrEqual(0);
    expect(popup.x + popup.width).toBeLessThanOrEqual(width);
    expect(await page.evaluate("document.documentElement.scrollWidth <= innerWidth")).toBe(true);
    await page.screenshot({
      path: testInfo.outputPath(`code-picker-${width}.png`),
      fullPage: true,
    });
  });
