import { randomUUID } from "node:crypto";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { noteListSchema, noteSchema } from "../shared/notes.ts";
import { organizeWorkSchema } from "../shared/drafts.ts";
import { organizeRunResponseSchema } from "../shared/organize.ts";
import { expectEditorContent } from "./notes-editor.ts";

const origin = "http://127.0.0.1:4185";
const account = () => `test_${randomUUID().replaceAll("-", "")}`;
async function signIn(context: BrowserContext, user = account()) {
  await context.addCookies([
    { name: "atlas_session", value: user, url: origin, httpOnly: true, sameSite: "Lax" },
  ]);
  return user;
}
async function notes(page: Page) {
  const response = await page.request.get("/api/notes");
  expect(response.status()).toBe(200);
  return noteListSchema.parse(await response.json()).notes;
}
async function work(page: Page) {
  const response = await page.request.get("/api/organize-work");
  expect(response.status()).toBe(200);
  return organizeWorkSchema.parse(await response.json());
}
async function createSource(page: Page) {
  const response = await page.request.post("/api/notes", {
    headers: { Origin: origin, "Idempotency-Key": randomUUID() },
    data: {
      title: "Acceptance source",
      content: "Budget: 42 EUR.",
      createdAt: "2026-11-05T12:00:00.000Z",
    },
  });
  expect(response.status()).toBe(201);
  return noteSchema.parse(await response.json());
}

test.beforeEach(async ({ context }) => {
  await signIn(context);
});

test("reload reconnects to the same persisted generation", async ({ page }) => {
  const source = await createSource(page);
  const starts: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().endsWith(`/api/notes/${source.id}/organize`)) {
      starts.push(request.url());
    }
  });
  await page.goto("/");
  const firstPoll = page.waitForResponse(
    (response) =>
      response.request().method() === "GET" && /\/api\/organize-runs\/[^/]+$/.test(response.url()),
  );
  await page.getByRole("button", { name: "Organize", exact: true }).click();
  const observation = organizeRunResponseSchema.parse(await (await firstPoll).json());
  expect(observation.status).toBe("running");
  const active = await work(page);
  expect(active.runs).toEqual([{ runId: observation.runId, noteId: source.id }]);
  await page.reload();
  await expect(
    page
      .getByRole("region", { name: "AI draft", exact: true })
      .getByRole("textbox", { name: "Draft title", exact: true }),
  ).toBeVisible();
  expect(starts).toHaveLength(1);
  const resumed = await work(page);
  expect(resumed.runs).toEqual([]);
  expect(resumed.drafts).toHaveLength(1);
  expect(resumed.drafts[0].source.noteId).toBe(source.id);
  expect(await notes(page)).toEqual([source]);
});

test("Save & organize keeps its source and saves an edited derivative through reload", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 375, height: 812 });
  const source = await createSource(page);
  await page.goto("/");
  await page
    .getByRole("textbox", { name: "Title", exact: true })
    .fill("Saved revision for Organize");
  const saved = page.waitForResponse(
    (response) =>
      response.request().method() === "PUT" && response.url().endsWith(`/api/notes/${source.id}`),
  );
  await page.getByRole("button", { name: "Save & organize", exact: true }).click();
  expect((await saved).status()).toBe(200);
  const panel = page.getByRole("region", { name: "AI draft", exact: true });
  await expect(panel.getByRole("textbox", { name: "Draft title", exact: true })).toBeVisible();
  const draft = (await work(page)).drafts[0];
  expect(draft.source).toMatchObject({
    noteId: source.id,
    revision: 2,
    stale: false,
    deleted: false,
  });
  const original = (await notes(page)).find((note) => note.id === source.id);
  expect(original).toMatchObject({ title: "Saved revision for Organize", content: source.content });

  await panel
    .getByRole("textbox", { name: "Draft title", exact: true })
    .fill("My edited derivative");
  const draftContent = panel.getByRole("textbox", { name: /^(Note content|Markdown source)$/ });
  await draftContent.fill("Budget: 42 EUR.");
  await draftContent.press("End");
  await draftContent.press("Enter");
  await page.keyboard.insertText("Keep this edit after reload.");
  await expectEditorContent(draftContent, /Keep this edit after reload\./);
  await expect(panel.getByText("Draft saved", { exact: true })).toBeVisible();
  const edited = (await work(page)).drafts[0];
  await page.reload();
  await expect(panel.getByRole("textbox", { name: "Draft title", exact: true })).toHaveValue(
    "My edited derivative",
  );
  await expectEditorContent(draftContent, /Keep this edit after reload\./);
  expect((await work(page)).drafts[0].content).toEqual(edited.content);
  await panel.getByRole("button", { name: "Save as new note", exact: true }).click();
  await expect.poll(async () => (await notes(page)).length).toBe(2);
  const after = await notes(page);
  expect(after.find((note) => note.id === source.id)).toEqual(original);
  const derivative = after.find((note) => note.id !== source.id)!;
  expect(derivative).toMatchObject({
    title: "My edited derivative",
    content: edited.content,
    origin: { sourceNoteId: source.id, sourceRevision: 2, sources: edited.sources },
  });
  expect((await work(page)).drafts).toEqual([]);
  await page.reload();
  expect(await notes(page)).toEqual(after);
  await expectEditorContent(
    page.getByRole("textbox", { name: /^(Note content|Markdown source)$/ }),
    /Keep this edit after reload\./,
  );
  expect(await page.evaluate("document.documentElement.scrollWidth <= innerWidth")).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("organized-derivative-mobile.png"),
    fullPage: true,
  });
});

test("a source deleted after handoff still permits a separate save with provenance", async ({
  page,
}) => {
  const source = await createSource(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Organize", exact: true }).click();
  const panel = page.getByRole("region", { name: "AI draft", exact: true });
  await expect(panel.getByRole("textbox", { name: "Draft title", exact: true })).toBeVisible();
  const read = await page.request.get(`/api/notes/${source.id}`);
  const removed = await page.request.delete(`/api/notes/${source.id}`, {
    headers: { Origin: origin, "If-Match": read.headers().etag },
  });
  expect(removed.status()).toBe(204);
  await page.reload();
  await expect(panel).toContainText(/source.*deleted/i);
  await panel.getByRole("button", { name: "Save as new note", exact: true }).click();
  await expect.poll(async () => (await notes(page)).length).toBe(1);
  const [derivative] = await notes(page);
  expect(derivative.id).not.toBe(source.id);
  expect(derivative.origin).toMatchObject({ sourceNoteId: source.id, sourceRevision: 1 });
  expect((await page.request.get(`/api/notes/${source.id}`)).status()).toBe(404);
});

test("temporary drafts stay account-scoped and discard removes them across reload", async ({
  page,
  context,
}) => {
  const owner = await signIn(context);
  const source = await createSource(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Organize", exact: true }).click();
  const panel = page.getByRole("region", { name: "AI draft", exact: true });
  await expect(panel.getByRole("textbox", { name: "Draft title", exact: true })).toBeVisible();
  const draft = (await work(page)).drafts[0];
  await signIn(context);
  await page.reload();
  await expect(panel).toHaveCount(0);
  expect((await work(page)).drafts).toEqual([]);
  expect((await page.request.get(`/api/note-drafts/${draft.id}`)).status()).toBe(404);
  await signIn(context, owner);
  await page.reload();
  await expect(panel.getByRole("textbox", { name: "Draft title", exact: true })).toBeVisible();
  await panel.getByRole("button", { name: "Discard draft", exact: true }).click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Discard permanently", exact: true })
    .click();
  await expect.poll(async () => (await work(page)).drafts.length).toBe(0);
  await page.reload();
  await expect(panel).toHaveCount(0);
  expect(await notes(page)).toEqual([source]);
});
