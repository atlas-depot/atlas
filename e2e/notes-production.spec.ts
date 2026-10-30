import { readFile, readdir } from "node:fs/promises";
import { expect, test } from "@playwright/test";

test("normal production has a neutral unavailable state and ignores fixture query switches", async ({
  page,
}) => {
  await page.route("**/api/notes", (route) =>
    route.fulfill({
      status: 501,
      json: { error: { code: "NOT_IMPLEMENTED", message: "Storage unavailable" } },
    }),
  );
  await page.goto("/?notesExample=empty&example=briefing");
  await expect(page.getByRole("heading", { name: "Atlas notes", exact: true })).toBeVisible();
  await expect(page.getByRole("status")).toHaveText(
    "Your notes are not available yet. Please try again later.",
  );
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Retry/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "New note", exact: true })).toBeDisabled();
  await expect(page.getByText(/Development preview with synthetic/)).toHaveCount(0);
});

test("normal production offers authentication recovery for 401", async ({ page }) => {
  await page.route("**/api/notes", (route) =>
    route.fulfill({
      status: 401,
      json: { error: { code: "UNAUTHENTICATED", message: "No session" } },
    }),
  );
  await page.goto("/");
  await expect(page.getByRole("alert")).toContainText("Your session has ended.");
  await expect(page.getByRole("link", { name: "Sign in again" })).toHaveAttribute(
    "href",
    "/api/auth/login",
  );
  await expect(page.getByRole("button", { name: "Retry loading" })).toHaveCount(0);
});

test("production editor opens and updates through actual HTTP requests with If-Match", async ({
  page,
}) => {
  const id = "fa100001-1234-4000-8000-000000000001";
  const note = {
    id,
    title: "HTTP contract",
    content: "Individual HTTP source",
    createdAt: "2026-10-28T09:00:00.000Z",
    updatedAt: "2026-10-28T09:00:00.000Z",
  };
  let updates = 0;
  await page.route("**/api/notes", (route) =>
    route.fulfill({
      json: { notes: [{ ...note, content: "List summary must not become editor input" }] },
    }),
  );
  await page.route(`**/api/notes/${id}`, async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({ json: note, headers: { ETag: '"http-v1"' } });
      return;
    }
    expect(route.request().method()).toBe("PUT");
    expect(route.request().headers()["if-match"]).toBe(updates === 0 ? '"http-v1"' : '"http-v2"');
    const payload: unknown = route.request().postDataJSON();
    expect(payload).toEqual({
      title: "HTTP contract",
      content: updates === 0 ? "First HTTP edit" : "Second HTTP edit",
    });
    updates++;
    await route.fulfill({
      json: { ...note, content: updates === 1 ? "First HTTP edit" : "Second HTTP edit" },
      headers: { ETag: updates === 1 ? '"http-v2"' : '"http-v3"' },
    });
  });
  await page.goto("/");
  const source = page.getByRole("textbox", { name: "Markdown source" });
  await expect(source).toHaveValue("Individual HTTP source");
  for (const content of ["First HTTP edit", "Second HTTP edit"]) {
    await source.fill(content);
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByRole("status")).toHaveText("Saved");
  }
  expect(updates).toBe(2);
});

test("normal production assets exclude synthetic note data", async () => {
  const assets = ".cache/production-build/assets";
  const scripts = (await readdir(assets)).filter((name) => name.endsWith(".js"));
  expect(scripts.length).toBeGreaterThan(0);
  const content = (
    await Promise.all(scripts.map((name) => readFile(`${assets}/${name}`, "utf8")))
  ).join("\n");
  for (const fixtureText of [
    "Prepare the **budget summary**",
    "Synthetic request failure.",
    "Deniz (synthetic)",
    "Fixed synthetic example data.",
  ])
    expect(content).not.toContain(fixtureText);
});
