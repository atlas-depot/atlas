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
async function createInEditor(page: Page, title: string, content: string) {
  await page.goto("/");
  await page.getByRole("button", { name: "New note", exact: true }).click();
  await page.getByRole("textbox", { name: "Title", exact: true }).fill(title);
  await page.getByRole("textbox", { name: "Markdown source" }).fill(content);
  await page.keyboard.press("ControlOrMeta+s");
  await expect(page.getByRole("status")).toHaveText("Saved");
}

test.beforeEach(async ({ context }) => signIn(context, newAccount()));

test("mobile keyboard CRUD persists through reload and deletion", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await createInEditor(page, "Persisted browser note", "# First version");
  const [created] = await listNotes(page);
  expect(created).toMatchObject({ title: "Persisted browser note", content: "# First version" });
  await page.reload();
  const source = page.getByRole("textbox", { name: "Markdown source" });
  await expect(source).toHaveValue("# First version");
  await source.fill("# Updated through HTTP");
  await page.keyboard.press("ControlOrMeta+s");
  await expect(page.getByRole("status")).toHaveText("Saved");
  expect(await listNotes(page)).toEqual([
    expect.objectContaining({
      id: created.id,
      content: "# Updated through HTTP",
      createdAt: created.createdAt,
    }),
  ]);
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
  await expect(page.getByRole("textbox", { name: "Markdown source" })).toHaveCount(0);
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
  const source = page.getByRole("textbox", { name: "Markdown source" });
  await source.fill("Keep my local work");
  const failure = page.waitForResponse(
    (response) => response.request().method() === "PUT" && response.status() === 412,
  );
  await page.keyboard.press("ControlOrMeta+s");
  await failure;
  await expect(page.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
  await expect(source).toHaveValue("Keep my local work");
  expect((await listNotes(page))[0].content).toBe("Saved by another tab");
  await page.getByRole("button", { name: "Compare latest" }).click();
  await expect(page.getByRole("heading", { name: "Latest saved version" })).toBeVisible();
  await expect(page.getByText("Saved by another tab", { exact: true })).toBeVisible();
  await expect(source).toHaveValue("Keep my local work");
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
  const source = page.getByRole("textbox", { name: "Markdown source" });
  await source.fill("Original submitted draft");
  await page.keyboard.press("ControlOrMeta+s");
  await expect(page.getByRole("alert")).toContainText("Could not confirm creation");
  expect(await listNotes(page)).toEqual([
    expect.objectContaining({ id: committedId, content: "Original submitted draft" }),
  ]);
  await source.fill("Newer local draft");
  await page.keyboard.press("ControlOrMeta+s");
  await expect(page.getByRole("status")).toHaveText("Saved");
  expect(keys).toHaveLength(2);
  expect(keys[1]).toBe(keys[0]);
  expect(payloads[1]).toBe(payloads[0]);
  expect(await listNotes(page)).toEqual([
    expect.objectContaining({ id: committedId, content: "Newer local draft" }),
  ]);
  await page.reload();
  await expect(source).toHaveValue("Newer local draft");
});

test("switching synthetic accounts clears the editor and cannot read or write another account's note", async ({
  page,
  context,
}) => {
  await createInEditor(page, "Alice private", "Alice private content");
  const [aliceNote] = await listNotes(page);
  const read = await page.request.get(`/api/notes/${aliceNote.id}`);
  const tag = read.headers().etag;
  await page.getByRole("textbox", { name: "Markdown source" }).fill("Alice unsaved work");
  const bob = newAccount();
  await signIn(context, bob);
  await page.evaluate("window.dispatchEvent(new Event('focus'))");
  await expect(page.getByText(`Signed in as ${bob}@example.test`)).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Markdown source" })).toHaveCount(0);
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
