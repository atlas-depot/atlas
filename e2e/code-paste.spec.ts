import { expect, test, type Page } from "@playwright/test";
import { noteSchema, updateNoteSchema } from "../shared/notes.ts";
import { blockNoteDocumentSchema } from "../shared/document.ts";

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
  await page.route("**/api/notes", (route) => route.fulfill({ json: { notes: [note] } }));
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
    await page.evaluate(`(() => {
      const elements = document.querySelectorAll('.bn-inline-content');
      const range = document.createRange();
      const start = document.createTreeWalker(elements[0], NodeFilter.SHOW_TEXT).nextNode();
      const end = document.createTreeWalker(elements[${crossing ? 1 : 0}], NodeFilter.SHOW_TEXT).nextNode();
      range.setStart(start, 7); range.setEnd(end, ${crossing ? 7 : 14});
      const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
    })()`);
    await page.keyboard.press("Shift+ArrowLeft");
    await page.keyboard.press("Shift+ArrowRight");
    const source = 'const template = "<div>hello</div>";\nconst entity = "a &lt; b";';
    // ClipboardItem cannot write VS Code's custom MIME type. Exercise the native
    // paste event with the same DataTransfer payload at the real editor boundary.
    await page.evaluate(`(() => {
      const input = ${JSON.stringify({ source, metadata })};
      const clipboardData = new DataTransfer();
      clipboardData.setData('text/plain', input.source);
      clipboardData.setData('vscode-editor-data', input.metadata);
      document.querySelector('.bn-editor').dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData }));
    })()`);
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
