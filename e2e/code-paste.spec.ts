import { expect, test, type Page } from "@playwright/test";
import { noteSchema, updateNoteSchema } from "../shared/notes.ts";
import { blockNoteDocumentSchema } from "../shared/document.ts";
import { toListRow } from "./notes-editor.ts";

const noteId = "fa100002-1234-4000-8000-000000000053";
const python = 'def greet(name):\n    return "Hello " + name\n\nprint(greet("Atlas"))';
const text = (value: string) => [{ type: "text", text: value, styles: {} }];

async function openDocument(
  page: Page,
  blocks: unknown[] = [{ id: "target", type: "paragraph", props: {}, content: [], children: [] }],
) {
  let note = noteSchema.parse({
    id: noteId,
    title: "Code paste",
    createdAt: "2026-11-01T09:00:00.000Z",
    updatedAt: "2026-11-01T09:00:00.000Z",
    content: {
      format: "blocknote",
      schemaVersion: 1,
      blocks,
    },
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
  await page.route("**/api/notes", (route) =>
    route.fulfill({ json: { notes: [toListRow(note)] } }),
  );
  await page.route(`**/api/notes/${noteId}`, (route) => {
    if (route.request().method() === "PUT") {
      note = { ...note, ...updateNoteSchema.parse(route.request().postDataJSON()) };
      writes++;
    }
    return route.fulfill({ json: note, headers: { ETag: `"paste-${writes}"` } });
  });
  await page.goto("/");
  await expect(page.getByRole("textbox", { name: "Note content", exact: true })).toBeVisible();
  await page.locator(".bn-inline-content").first().click();
  return { document: () => blockNoteDocumentSchema.parse(note.content), writes: () => writes };
}

async function paste(page: Page, source: string) {
  await page.evaluate(`navigator.clipboard.writeText(${JSON.stringify(source)})`);
  await page.keyboard.press("ControlOrMeta+v");
}

async function save(page: Page, state: { writes: () => number }) {
  const before = state.writes();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect.poll(state.writes).toBe(before + 1);
}

test.beforeEach(async ({ context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
});

test("unlabelled code guesses once, undoes once and respects explicit Plain text on mobile", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  const state = await openDocument(page);
  await page.keyboard.type("```");
  await page.keyboard.press("Enter");
  const code = page.locator("code.bn-inline-content");
  const picker = page.getByRole("combobox", { name: "Code language", exact: true });
  await expect(code).toBeVisible();
  await paste(page, python);
  await expect(picker).toHaveText("Python");
  await expect(code).toHaveText(python);
  await page.keyboard.press("ControlOrMeta+z");
  await expect(code).toHaveText("");
  await expect(picker).toHaveText("Plain text");
  await picker.click();
  await page.getByRole("combobox", { name: "Search code languages" }).fill("plain");
  await page.getByRole("option", { name: "Plain text", exact: true }).click();
  await code.click();
  await paste(page, python);
  await expect(picker).toHaveText("Plain text");
  await expect(code).toHaveText(python);
  await save(page, state);
  expect(state.document().blocks[0]).toMatchObject({
    type: "codeBlock",
    props: { language: "text" },
    content: text(python),
  });
  await page.reload();
  await expect(picker).toHaveText("Plain text");
  await expect(code).toHaveText(python);
  expect(await page.evaluate("document.documentElement.scrollWidth <= innerWidth")).toBe(true);
});

test("explicit fenced language survives a different heuristic guess and JSON reload", async ({
  page,
}) => {
  const state = await openDocument(page);
  await paste(page, "```sql\n" + python + "\n```");
  const picker = page.getByRole("combobox", { name: "Code language", exact: true });
  await expect(picker).toHaveText("SQL");
  await expect(page.locator("code.bn-inline-content")).toHaveText(python);
  await save(page, state);
  expect(state.document().blocks.find((block) => block.type === "codeBlock")).toMatchObject({
    props: { language: "sql" },
    content: text(python),
  });
  await page.reload();
  await expect(picker).toHaveText("SQL");
  await expect(page.locator("code.bn-inline-content")).toHaveText(python);
});

test("VS Code clipboard preserves literal code, malformed metadata and selection undo", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  for (const metadata of [
    JSON.stringify({ mode: "javascript" }),
    JSON.stringify({ mode: 'bad"<tag>' }),
    "{invalid",
  ]) {
    await page.unrouteAll({ behavior: "wait" });
    const crossing = metadata !== JSON.stringify({ mode: "javascript" });
    const state = await openDocument(
      page,
      crossing
        ? [
            {
              id: "code-start",
              type: "codeBlock",
              props: { language: "text" },
              content: text("before CODE"),
              children: [],
            },
            {
              id: "prose-end",
              type: "paragraph",
              props: {},
              content: text("replace after"),
              children: [],
            },
          ]
        : undefined,
    );
    if (!crossing) await page.keyboard.insertText("before replace after");
    // Move the actual editor selection with keyboard events. A DOM Range plus
    // synthetic arrow adjustments can leave ProseMirror one character behind.
    // Nonzero key durations let native selectionchange run between keystrokes.
    for (let step = 0; step < 32; step++) await page.keyboard.press("ArrowLeft", { delay: 20 });
    const prefixAtCaret = () =>
      page.evaluate(`(() => {
      const block = document.querySelector('.bn-inline-content');
      const selection = window.getSelection();
      if (!selection?.focusNode || !block?.contains(selection.focusNode)) return null;
      const prefix = document.createRange();
      prefix.selectNodeContents(block);
      prefix.setEnd(selection.focusNode, selection.focusOffset);
      return prefix.toString();
    })()`);
    for (let step = 0; step < 16 && (await prefixAtCaret()) !== "before "; step++)
      await page.keyboard.press("ArrowRight", { delay: 20 });
    expect(await prefixAtCaret()).toBe("before ");
    const selectedText = () =>
      page.evaluate("window.getSelection()?.toString().replace(/\\n/g, '') ?? ''");
    const expectedSelection = crossing ? "CODEreplace" : "replace";
    for (let step = 0; step < 20 && (await selectedText()) !== expectedSelection; step++) {
      await page.keyboard.press("Shift+ArrowRight", { delay: 20 });
    }
    expect(await selectedText()).toBe(expectedSelection);
    const source = 'const template = "<div>hello</div>";\nconst entity = "a &lt; b";';
    // ClipboardItem cannot write VS Code's custom MIME type. Add that metadata
    // to a real keyboard paste so the browser synchronizes its selection first.
    await page.evaluate(`(async () => {
      const input = ${JSON.stringify({ source, metadata })};
      const clipboardData = new DataTransfer();
      clipboardData.setData('text/plain', input.source);
      clipboardData.setData('vscode-editor-data', input.metadata);
      await navigator.clipboard.writeText(input.source);
      document.querySelector('.bn-editor').addEventListener('paste', (event) => {
        Object.defineProperty(event, 'clipboardData', { value: clipboardData });
      }, { capture: true, once: true });
    })()`);
    await page.keyboard.press("ControlOrMeta+v");
    await save(page, state);
    const blocks = state.document().blocks;
    const allText = blocks
      .map((block) =>
        Array.isArray(block.content)
          ? block.content.map((part) => (part.type === "text" ? part.text : "")).join("")
          : "",
      )
      .join("");
    expect(allText).toBe("before " + source + " after");
    if (metadata !== "{invalid")
      expect(
        blocks.some(
          (block) =>
            block.type === "codeBlock" &&
            JSON.stringify(block.content) === JSON.stringify(text(source)),
        ),
      ).toBe(true);
    // Saving moves focus to the button; return to the document before undoing.
    await page.getByRole("textbox", { name: "Note content", exact: true }).focus();
    await page.keyboard.press("ControlOrMeta+z");
    await expect(page.locator(".bn-inline-content")).toHaveText(
      crossing ? ["before CODE", "replace after"] : ["before replace after"],
    );
    expect(errors).toEqual([]);
  }
});

test("invalid VS Code language metadata stays plain and saveable while unknown valid labels persist", async ({
  page,
}) => {
  const source = 'const template = "<div>hello</div> &lt;";';
  for (const scenario of [
    { metadata: "{invalid", language: undefined },
    { metadata: JSON.stringify({ mode: "bad\0language" }), language: undefined },
    { metadata: JSON.stringify({ mode: "bad\ud800language" }), language: undefined },
    { metadata: JSON.stringify({ mode: "bad\udfff" }), language: undefined },
    { metadata: JSON.stringify({ mode: "x".repeat(129) }), language: undefined },
    { metadata: JSON.stringify({ mode: "atlas-dsl" }), language: "atlas-dsl" },
  ]) {
    await page.unrouteAll({ behavior: "wait" });
    const state = await openDocument(page);
    await page.evaluate(`(async () => {
      const input = ${JSON.stringify({ source, metadata: scenario.metadata })};
      const clipboardData = new DataTransfer();
      clipboardData.setData('text/plain', input.source);
      clipboardData.setData('vscode-editor-data', input.metadata);
      await navigator.clipboard.writeText(input.source);
      document.querySelector('.bn-editor').addEventListener('paste', event => {
        Object.defineProperty(event, 'clipboardData', { value: clipboardData });
      }, { capture: true, once: true });
    })()`);
    await page.keyboard.press("ControlOrMeta+v");
    if (scenario.language) {
      await expect(page.getByRole("combobox", { name: "Code language", exact: true })).toHaveText(
        scenario.language,
      );
    } else {
      await expect(page.locator('[data-content-type="codeBlock"]')).toHaveCount(0);
      await expect(page.locator('[data-content-type="paragraph"] .bn-inline-content')).toHaveText(
        source,
      );
    }
    await expect(page.getByRole("button", { name: "Save", exact: true })).toBeEnabled();
    await save(page, state);
    const saved = state.document().blocks;
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({
      type: scenario.language ? "codeBlock" : "paragraph",
      content: text(source),
      ...(scenario.language ? { props: { language: scenario.language } } : {}),
    });
    await page.reload();
    await expect(page.locator(".bn-inline-content")).toHaveText(source);
    if (!scenario.language)
      await expect(page.locator('[data-content-type="codeBlock"]')).toHaveCount(0);
  }
});

test("rich HTML clipboard keeps its formatting when its plain-text fallback contains a fence", async ({
  page,
}) => {
  const state = await openDocument(page);
  const plain = "Keep this title Reference\n\n```\n" + python + "\n```";
  const html =
    '<p><strong>Keep this title</strong> <a href="https://example.test/reference">Reference</a></p><pre><code>' +
    python +
    "</code></pre>";
  await page.evaluate(`(async () => {
    const input = ${JSON.stringify({ plain, html })};
    await navigator.clipboard.write([new ClipboardItem({
      'text/plain': new Blob([input.plain], { type: 'text/plain' }),
      'text/html': new Blob([input.html], { type: 'text/html' }),
    })]);
  })()`);
  await page.keyboard.press("ControlOrMeta+v");
  await save(page, state);
  expect(state.document().blocks.map(({ id: _id, ...block }) => block)).toEqual([
    {
      type: "paragraph",
      props: { backgroundColor: "default", textColor: "default", textAlignment: "left" },
      content: [
        { type: "text", text: "Keep this title", styles: { bold: true } },
        { type: "text", text: " ", styles: {} },
        {
          type: "link",
          href: "https://example.test/reference",
          content: [{ type: "text", text: "Reference", styles: {} }],
        },
      ],
      children: [],
    },
    { type: "codeBlock", props: { language: "text" }, content: text(python), children: [] },
  ]);
  await page.reload();
  await expect(page.locator(".bn-inline-content strong")).toHaveText("Keep this title");
  await expect(page.getByRole("link", { name: "Reference", exact: true })).toHaveAttribute(
    "href",
    "https://example.test/reference",
  );
  await expect(page.locator("code.bn-inline-content")).toHaveText(python);
});
