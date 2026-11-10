import { expectEditorContent, paragraphDocument } from "./notes-editor.ts";
import { randomUUID } from "node:crypto";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { noteListSchema, noteSchema } from "../shared/notes.ts";

const origin = "http://127.0.0.1:4185";
const newAccount = () => `test_${randomUUID().replaceAll("-", "")}`;

/** Identity only is synthetic; browser requests, production routes and PostgreSQL are real. */
async function signIn(context: BrowserContext, account: string) {
  await context.addCookies([
    { name: "atlas_session", value: account, url: origin, httpOnly: true, sameSite: "Lax" },
  ]);
}
async function listNotes(page: Page) {
  const response = await page.request.get("/api/notes");
  expect(response.status()).toBe(200);
  return noteListSchema.parse(await response.json()).notes;
}
/** List rows carry no content; the individual read is the authoritative document. */
async function readNote(page: Page, id: string) {
  const response = await page.request.get(`/api/notes/${id}`);
  expect(response.status()).toBe(200);
  return noteSchema.parse(await response.json());
}
async function createInEditor(page: Page, title: string, content: string) {
  await page.goto("/");
  await page.getByRole("button", { name: "New note", exact: true }).click();
  await page.getByRole("textbox", { name: "Title", exact: true }).fill(title);
  await page.getByRole("textbox", { name: /^(Markdown source|Note content)$/ }).fill(content);
  await page.keyboard.press("ControlOrMeta+s");
  await expect(page.getByRole("status")).toHaveText("Saved");
}

test.beforeEach(async ({ context }) => signIn(context, newAccount()));

test("mobile keyboard CRUD persists through reload and deletion", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await createInEditor(page, "Persisted browser note", "# First version");
  const [listed] = await listNotes(page);
  expect(listed).toMatchObject({ title: "Persisted browser note" });
  expect(listed).not.toHaveProperty("content");
  const created = await readNote(page, listed.id);
  expect(created).toMatchObject({
    title: "Persisted browser note",
    content: paragraphDocument("# First version"),
  });
  await page.reload();
  const source = page.getByRole("textbox", { name: /^(Markdown source|Note content)$/ });
  await expectEditorContent(source, "# First version");
  await source.fill("# Updated through HTTP");
  await page.keyboard.press("ControlOrMeta+s");
  await expect(page.getByRole("status")).toHaveText("Saved");
  expect(await readNote(page, created.id)).toEqual(
    expect.objectContaining({
      id: created.id,
      content: paragraphDocument("# Updated through HTTP"),
      createdAt: created.createdAt,
    }),
  );
  expect(await page.evaluate("document.documentElement.scrollWidth <= window.innerWidth")).toBe(
    true,
  );
  await page.screenshot({ path: testInfo.outputPath("real-api-mobile.png"), fullPage: true });
  await page.getByRole("button", { name: "Delete note", exact: true }).click();
  await page.getByRole("button", { name: "Delete permanently", exact: true }).click();
  await expect(page.getByText("Note deleted. No notes left.")).toBeVisible();
  expect(await listNotes(page)).toEqual([]);
  await page.reload();
  await expect(page.getByText("No notes yet. Create a new note to get started.")).toBeVisible();
  await expect(page.getByRole("textbox", { name: /^(Markdown source|Note content)$/ })).toHaveCount(
    0,
  );
});

test("a real competing edit returns 412 and preserves the local draft", async ({ page }) => {
  await createInEditor(page, "Shared revision", "Original");
  const [created] = await listNotes(page);
  const read = await page.request.get(`/api/notes/${created.id}`);
  const tag = read.headers().etag;
  expect(tag).toBeTruthy();
  const remote = await page.request.put(`/api/notes/${created.id}`, {
    headers: { Origin: origin, "If-Match": tag },
    data: { title: "Shared revision", content: "Saved by another tab" },
  });
  expect(remote.status()).toBe(200);
  const source = page.getByRole("textbox", { name: /^(Markdown source|Note content)$/ });
  await source.fill("Keep my local work");
  const failure = page.waitForResponse(
    (response) => response.request().method() === "PUT" && response.status() === 412,
  );
  await page.keyboard.press("ControlOrMeta+s");
  await failure;
  await expect(page.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
  await expectEditorContent(source, "Keep my local work");
  expect((await readNote(page, created.id)).content).toBe("Saved by another tab");
  await page.getByRole("button", { name: "Compare latest" }).click();
  await expect(page.getByRole("heading", { name: "Latest saved version" })).toBeVisible();
  await expect(page.getByText("Saved by another tab", { exact: true })).toBeVisible();
  await expectEditorContent(source, "Keep my local work");
});

test("a lost committed POST replays one creation then saves newer local edits", async ({
  page,
}) => {
  const keys: string[] = [];
  const payloads: string[] = [];
  let committedId = "";
  await page.route("**/api/notes", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    keys.push(route.request().headers()["idempotency-key"]);
    payloads.push(route.request().postData() ?? "");
    // Exercise the real database write, then lose only its response to the browser.
    const response = await route.fetch();
    expect(response.status()).toBe(201);
    const note = noteSchema.parse(await response.json());
    if (keys.length === 1) {
      committedId = note.id;
      return route.abort("failed");
    }
    expect(note.id).toBe(committedId);
    return route.fulfill({ response });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "New note", exact: true }).click();
  const source = page.getByRole("textbox", { name: /^(Markdown source|Note content)$/ });
  await source.fill("Original submitted draft");
  await page.keyboard.press("ControlOrMeta+s");
  await expect(page.getByRole("alert")).toContainText("Could not confirm creation");
  expect(await listNotes(page)).toEqual([expect.objectContaining({ id: committedId })]);
  expect((await readNote(page, committedId)).content).toEqual(
    paragraphDocument("Original submitted draft"),
  );
  await source.fill("Newer local draft");
  await page.keyboard.press("ControlOrMeta+s");
  await expect(page.getByRole("status")).toHaveText("Saved");
  expect(keys).toHaveLength(2);
  expect(keys[1]).toBe(keys[0]);
  expect(payloads[1]).toBe(payloads[0]);
  expect((await readNote(page, committedId)).content).toEqual(
    paragraphDocument("Newer local draft"),
  );
  await page.reload();
  await expectEditorContent(source, "Newer local draft");
});

test("switching synthetic accounts clears the editor and cannot read or write another account's note", async ({
  page,
  context,
}) => {
  await createInEditor(page, "Alice private", "Alice private content");
  const [aliceNote] = await listNotes(page);
  const read = await page.request.get(`/api/notes/${aliceNote.id}`);
  const tag = read.headers().etag;
  await page
    .getByRole("textbox", { name: /^(Markdown source|Note content)$/ })
    .fill("Alice unsaved work");
  const bob = newAccount();
  await signIn(context, bob);
  await page.evaluate("window.dispatchEvent(new Event('focus'))");
  await expect(page.getByText(`Signed in as ${bob}@example.test`)).toBeVisible();
  await expect(page.getByRole("textbox", { name: /^(Markdown source|Note content)$/ })).toHaveCount(
    0,
  );
  await expect(page.getByRole("button", { name: "Alice private", exact: true })).toHaveCount(0);
  expect(await listNotes(page)).toEqual([]);
  for (const method of ["GET", "PUT", "DELETE"] as const) {
    const response = await page.request.fetch(`/api/notes/${aliceNote.id}`, {
      method,
      headers: { Origin: origin, "If-Match": tag },
      ...(method === "PUT" ? { data: { title: "Forged", content: "Forged" } } : {}),
    });
    expect(response.status()).toBe(404);
    expect(await response.text()).not.toContain("Alice");
  }
  await createInEditor(page, "Bob private", "Bob content");
  expect(await listNotes(page)).toEqual([expect.objectContaining({ title: "Bob private" })]);
});

test("structured blocks persist IDs, nested lists and tables through save and API reordering", async ({
  page,
}, testInfo) => {
  const content = {
    format: "blocknote",
    schemaVersion: 1,
    blocks: [
      {
        id: "intro",
        type: "paragraph",
        props: {},
        content: [{ type: "text", text: "Structured introduction", styles: { bold: true } }],
        children: [],
      },
      {
        id: "list",
        type: "bulletListItem",
        props: {},
        content: [{ type: "text", text: "Parent", styles: {} }],
        children: [
          {
            id: "child",
            type: "bulletListItem",
            props: {},
            content: [{ type: "text", text: "Nested child", styles: {} }],
            children: [],
          },
        ],
      },
      {
        id: "table",
        type: "table",
        props: {},
        content: {
          type: "tableContent",
          columnWidths: [null],
          headerRows: 1,
          rows: [
            { cells: [[{ type: "text", text: "Column", styles: {} }]] },
            { cells: [[{ type: "text", text: "Cell", styles: {} }]] },
          ],
        },
        children: [],
      },
    ],
  };
  const created = await page.request.post("/api/notes", {
    headers: { Origin: origin, "Idempotency-Key": randomUUID() },
    data: { title: "Structured note", content, createdAt: "2026-11-05T12:00:00.000Z" },
  });
  expect(created.status()).toBe(201);
  const note = noteSchema.parse(await created.json());
  expect(typeof note.content).toBe("object");
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/");
  const editor = page.getByRole("textbox", { name: "Note content", exact: true });
  await expect(editor).toContainText("Structured introduction");
  await expect(editor.locator("table")).toContainText("Cell");
  await expect(editor.locator('[data-node-type="blockContainer"][data-id="child"]')).toContainText(
    "Nested child",
  );
  await page.getByRole("textbox", { name: "Title", exact: true }).fill("Renamed structured note");
  await page.keyboard.press("ControlOrMeta+s");
  await expect(page.getByRole("status")).toHaveText("Saved");
  const saved = await readNote(page, note.id);
  expect(saved.content).toEqual(note.content);
  const current = await page.request.get(`/api/notes/${note.id}`);
  if (typeof saved.content === "string") throw new Error("Expected structured content");
  const reordered = {
    ...saved.content,
    blocks: [saved.content.blocks[2], saved.content.blocks[0], saved.content.blocks[1]],
  };
  const updated = await page.request.put(`/api/notes/${note.id}`, {
    headers: { Origin: origin, "If-Match": current.headers().etag },
    data: { title: saved.title, content: reordered },
  });
  expect(updated.status()).toBe(200);
  await page.reload();
  await expect(editor.locator('[data-node-type="blockContainer"]').first()).toHaveAttribute(
    "data-id",
    "table",
  );
  expect((await readNote(page, note.id)).content).toEqual(reordered);
  expect(await page.evaluate("document.documentElement.scrollWidth <= window.innerWidth")).toBe(
    true,
  );
  await page.screenshot({
    path: testInfo.outputPath("structured-note-mobile.png"),
    fullPage: true,
  });
});

test("keyboard search and source opening work on narrow mobile through the real API path", async ({
  page,
}, testInfo) => {
  const firstResponse = await page.request.post("/api/notes", {
    headers: { Origin: origin, "Idempotency-Key": randomUUID() },
    data: {
      title: "Incident Response",
      content: {
        format: "blocknote",
        schemaVersion: 1,
        blocks: [
          {
            id: "incident-heading",
            type: "heading",
            props: { level: 2 },
            content: [{ type: "text", text: "Escalation", styles: {} }],
            children: [],
          },
          {
            id: "incident-body",
            type: "paragraph",
            props: {},
            content: [
              {
                type: "text",
                text: "Page the primary oncall engineer immediately.",
                styles: {},
              },
            ],
            children: [],
          },
        ],
      },
      createdAt: "2026-11-08T10:00:00.000Z",
    },
  });
  expect(firstResponse.status()).toBe(201);

  const secondResponse = await page.request.post("/api/notes", {
    headers: { Origin: origin, "Idempotency-Key": randomUUID() },
    data: {
      title: "Vector Search Architecture",
      content: {
        format: "blocknote",
        schemaVersion: 1,
        blocks: [
          {
            id: "vector-heading",
            type: "heading",
            props: { level: 2 },
            content: [{ type: "text", text: "Retrieval Pipeline", styles: {} }],
            children: [],
          },
          {
            id: "vector-block",
            type: "paragraph",
            props: {},
            content: [
              {
                type: "text",
                text: "PostgreSQL pgvector ranks passages by cosine similarity.",
                styles: {},
              },
            ],
            children: [],
          },
        ],
      },
      createdAt: "2026-11-08T10:01:00.000Z",
    },
  });
  expect(secondResponse.status()).toBe(201);
  const vectorNote = noteSchema.parse(await secondResponse.json());

  await expect
    .poll(async () => {
      const statusResponse = await page.request.get(`/api/notes/${vectorNote.id}/index`);
      if (statusResponse.status() !== 200) return "pending";
      const body = (await statusResponse.json()) as { status: string };
      return body.status;
    })
    .toBe("ready");

  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/");

  const searchRegion = page.getByRole("region", { name: "Search notes" });
  const searchInput = searchRegion.getByLabel("Search saved notes");
  await searchInput.focus();
  await page.keyboard.type("pgvector cosine");
  await page.keyboard.press("Enter");

  await expect(searchRegion.getByText('Query: "pgvector cosine"')).toBeVisible();
  await expect(searchRegion.getByText("Vector Search Architecture")).toBeVisible();
  await expect(
    searchRegion.getByText("Retrieval Pipeline - Block vector-block - Revision 1"),
  ).toBeVisible();
  await expect(
    searchRegion.getByText("PostgreSQL pgvector ranks passages by cosine similarity."),
  ).toBeVisible();

  const openSourceButton = searchRegion.getByRole("button", { name: "Open source", exact: true });
  await openSourceButton.focus();
  await page.keyboard.press("Enter");

  const openedSource = page.getByRole("region", { name: "Opened source" });
  await expect(openedSource).toContainText("Vector Search Architecture");
  await expect(openedSource).toContainText("Revision 1");
  await expect(openedSource).toContainText("Block vector-block");
  await expect(
    page.locator('[data-node-type="blockContainer"][data-id="vector-block"]'),
  ).toHaveAttribute("data-cited-block", "true");
  expect(await page.evaluate("document.documentElement.scrollWidth <= window.innerWidth")).toBe(
    true,
  );
  await page.screenshot({
    path: testInfo.outputPath("search-source-mobile-api.png"),
    fullPage: true,
  });
});
