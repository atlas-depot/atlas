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
      json: {
        notes: [
          {
            ...note,
            title: "Old list title",
            content: "List summary must not become editor input",
          },
        ],
      },
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
  await expect(
    page
      .getByRole("navigation", { name: "Notes" })
      .getByRole("button", { name: "HTTP contract", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Old list title", exact: true })).toHaveCount(0);
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

const firstId = "fa100001-1234-4000-8000-000000000001";
const secondId = "fa100001-1234-4000-8000-000000000002";
const serverNote = {
  id: firstId,
  title: "A",
  content: "Original text",
  createdAt: "2026-10-28T09:00:00.000Z",
  updatedAt: "2026-10-28T09:00:00.000Z",
};

test("a forbidden read does not block the current draft or another allowed note", async ({
  page,
}) => {
  const other = { ...serverNote, id: secondId, title: "Forbidden" };
  await page.route("**/api/notes", (route) =>
    route.fulfill({ json: { notes: [serverNote, other] } }),
  );
  await page.route(`**/api/notes/${firstId}`, (route) =>
    route.fulfill({ json: serverNote, headers: { ETag: '"v1"' } }),
  );
  await page.route(`**/api/notes/${secondId}`, (route) =>
    route.fulfill({ status: 403, json: { error: { code: "FORBIDDEN", message: "Denied" } } }),
  );
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/");
  const source = page.getByRole("textbox", { name: "Markdown source" });
  await expect(source).toHaveValue("Original text");
  const shortButton = page.getByRole("button", { name: "A", exact: true });
  expect((await shortButton.boundingBox())?.width).toBeGreaterThanOrEqual(44);
  await page.getByRole("button", { name: "Forbidden", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("This request was blocked.");
  await source.fill("Still editable");
  await expect(page.getByRole("button", { name: "Save", exact: true })).toBeEnabled();
  await expect(shortButton).toBeEnabled();
  await page.getByRole("button", { name: "New note", exact: true }).click();
  await page.getByRole("button", { name: "Discard changes", exact: true }).click();
  await shortButton.click();
  await expect(source).toHaveValue("Original text");
});

test("initial missing read removes the entry and gives recovery that exists", async ({ page }) => {
  await page.route("**/api/notes", (route) => route.fulfill({ json: { notes: [serverNote] } }));
  await page.route(`**/api/notes/${firstId}`, (route) =>
    route.fulfill({ status: 404, json: { error: { code: "NOT_FOUND", message: "Missing" } } }),
  );
  await page.goto("/");
  await expect(page.getByRole("alert")).toContainText(
    "Refresh the notes list or choose another note.",
  );
  await expect(page.getByRole("alert")).not.toContainText("keep your text as a new note");
  await expect(page.getByRole("navigation", { name: "Notes" }).getByRole("button")).toHaveCount(0);
  await page.getByRole("button", { name: "New note", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Title", exact: true })).toHaveValue("");
});

test("adopting a conflict version synchronizes its changed title in the sidebar", async ({
  page,
}) => {
  let reads = 0;
  await page.route("**/api/notes", (route) => route.fulfill({ json: { notes: [serverNote] } }));
  await page.route(`**/api/notes/${firstId}`, (route) => {
    if (route.request().method() === "PUT")
      return route.fulfill({
        status: 412,
        json: { error: { code: "PRECONDITION_FAILED", message: "Changed" } },
      });
    reads++;
    if (reads === 2)
      return route.fulfill({
        status: 500,
        json: { error: { code: "INTERNAL_ERROR", message: "Comparison failed" } },
      });
    return route.fulfill({
      json: { ...serverNote, title: reads === 1 ? "A" : "Authoritative renamed note" },
      headers: { ETag: reads === 1 ? '"v1"' : '"v2"' },
    });
  });
  await page.goto("/");
  await page.getByRole("textbox", { name: "Markdown source" }).fill("Local edit");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByRole("button", { name: "Compare latest" }).click();
  await page.getByRole("button", { name: "Retry opening", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Markdown source" })).toHaveValue("Local edit");
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  await page.getByRole("button", { name: "Use latest version" }).click();
  await page.getByRole("button", { name: "Discard changes", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Title", exact: true })).toHaveValue(
    "Authoritative renamed note",
  );
  await expect(
    page
      .getByRole("navigation", { name: "Notes" })
      .getByRole("button", { name: "Authoritative renamed note", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "A", exact: true })).toHaveCount(0);
});

for (const operation of ["list", "read", "save"] as const) {
  test(`hung ${operation} releases controls after the request deadline`, async ({ page }) => {
    await page.clock.install();
    let stalled = false;
    await page.route("**/api/notes", (route) => {
      if (operation === "list") {
        stalled = true;
        return;
      }
      return route.fulfill({ json: { notes: [serverNote] } });
    });
    await page.route(`**/api/notes/${firstId}`, (route) => {
      if (operation === "read" || route.request().method() === "PUT") {
        stalled = true;
        return;
      }
      return route.fulfill({ json: serverNote, headers: { ETag: '"v1"' } });
    });
    await page.goto("/");
    if (operation === "save") {
      await page.getByRole("textbox", { name: "Markdown source" }).fill("Preserve stalled edit");
      await page.getByRole("button", { name: "Save", exact: true }).click();
    }
    await expect.poll(() => stalled).toBe(true);
    await page.clock.fastForward(30_001);
    await expect(page.getByRole("alert")).toContainText(
      operation === "list"
        ? "Could not load"
        : operation === "read"
          ? "Could not open"
          : "Save failed",
    );
    if (operation === "list")
      await expect(page.getByRole("button", { name: "Retry loading" })).toBeEnabled();
    else await expect(page.getByRole("button", { name: "New note", exact: true })).toBeEnabled();
    if (operation === "save")
      await expect(page.getByRole("textbox", { name: "Markdown source" })).toHaveValue(
        "Preserve stalled edit",
      );
  });
}

test("a missing different note preserves the current draft and offers only applicable recovery", async ({
  page,
}) => {
  const missing = { ...serverNote, id: secondId, title: "Deleted elsewhere" };
  await page.route("**/api/notes", (route) =>
    route.fulfill({ json: { notes: [serverNote, missing] } }),
  );
  await page.route(`**/api/notes/${firstId}`, (route) =>
    route.fulfill({ json: serverNote, headers: { ETag: '"v1"' } }),
  );
  await page.route(`**/api/notes/${secondId}`, (route) =>
    route.fulfill({ status: 404, json: { error: { code: "NOT_FOUND", message: "Missing" } } }),
  );
  await page.goto("/");
  const source = page.getByRole("textbox", { name: "Markdown source" });
  await expect(source).toHaveValue("Original text");
  await page.getByRole("button", { name: "Deleted elsewhere", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Your current text is unchanged.");
  await expect(source).toHaveValue("Original text");
  await expect(page.getByRole("button", { name: "Deleted elsewhere", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Keep as new note", exact: true })).toHaveCount(0);
  await source.fill("Edit the still-existing note");
  await expect(page.getByRole("button", { name: "Save", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "New note", exact: true }).click();
  await page.getByRole("button", { name: "Keep editing" }).click();
  await expect(source).toHaveValue("Edit the still-existing note");
});

test("a forbidden list describes loading access rather than a save failure", async ({ page }) => {
  await page.route("**/api/notes", (route) =>
    route.fulfill({ status: 403, json: { error: { code: "FORBIDDEN", message: "Blocked" } } }),
  );
  await page.goto("/");
  await expect(page.getByRole("alert")).toHaveText(
    "The notes list request was blocked. Restore request access, then reload the page. Your current text is preserved.",
  );
  await expect(page.getByRole("alert")).not.toContainText("Saving");
  await expect(page.getByRole("button", { name: "Save", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "New note", exact: true })).toBeDisabled();
});

test("retrying a failed different-note read requires confirmation before replacing a dirty draft", async ({
  page,
}) => {
  const other = { ...serverNote, id: secondId, title: "B", content: "Original B" };
  let otherReads = 0;
  await page.route("**/api/notes", (route) =>
    route.fulfill({ json: { notes: [serverNote, other] } }),
  );
  await page.route(`**/api/notes/${firstId}`, (route) =>
    route.fulfill({ json: serverNote, headers: { ETag: '"a1"' } }),
  );
  await page.route(`**/api/notes/${secondId}`, (route) => {
    otherReads++;
    return otherReads === 1
      ? route.fulfill({
          status: 500,
          json: { error: { code: "INTERNAL_ERROR", message: "Read failed" } },
        })
      : route.fulfill({ json: other, headers: { ETag: '"b1"' } });
  });
  await page.goto("/");
  const source = page.getByRole("textbox", { name: "Markdown source" });
  await expect(source).toHaveValue("Original text");
  await page.getByRole("button", { name: "B", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Could not open note");
  await source.fill("Unsaved A must survive");
  await expect(page.getByRole("status")).toHaveText("Unsaved changes");
  await page.getByRole("button", { name: "Retry opening", exact: true }).click();
  await expect(page.getByRole("alertdialog")).toBeVisible();
  expect(otherReads).toBe(1);
  await page.getByRole("button", { name: "Keep editing", exact: true }).click();
  await expect(source).toHaveValue("Unsaved A must survive");
  await expect(page.getByRole("textbox", { name: "Title", exact: true })).toHaveValue("A");
  await page.getByRole("button", { name: "Retry opening", exact: true }).click();
  await page.getByRole("button", { name: "Discard changes", exact: true }).click();
  await expect(source).toHaveValue("Original B");
  expect(otherReads).toBe(2);
});

test("a lost create response offers list reconciliation without automatically creating again", async ({
  page,
}) => {
  let creates = 0;
  await page.route("**/api/notes", (route) => {
    if (route.request().method() === "POST") {
      creates++;
      return route.abort("failed");
    }
    return route.fulfill({ json: { notes: creates ? [serverNote] : [] } });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "New note", exact: true }).click();
  const title = page.getByRole("textbox", { name: "Title", exact: true });
  await title.fill("A");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("the note may already exist");
  await page.getByRole("button", { name: "Refresh notes", exact: true }).click();
  await expect(
    page.getByRole("navigation", { name: "Notes" }).getByRole("button", { name: "A", exact: true }),
  ).toBeVisible();
  await expect(title).toHaveValue("A");
  await page.route(`**/api/notes/${firstId}`, (route) =>
    route.fulfill({ status: 404, json: { error: { code: "NOT_FOUND", message: "Missing" } } }),
  );
  await page
    .getByRole("navigation", { name: "Notes" })
    .getByRole("button", { name: "A", exact: true })
    .click();
  await page.getByRole("button", { name: "Discard changes", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("This note is no longer available");
  const refresh = page.getByRole("button", { name: "Refresh notes", exact: true });
  await expect(refresh).toHaveCount(1);
  await refresh.click();
  await expect(title).toHaveValue("A");
  expect(creates).toBe(1);
});
