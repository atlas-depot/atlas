import { expectEditorContent, paragraphDocument } from "./notes-editor.ts";
import { readFile, readdir } from "node:fs/promises";
import { createNoteSchema, updateNoteSchema, type Note, type CreateNote } from "../shared/notes.ts";
import { expect, test } from "@playwright/test";

const browserUser = {
  id: "user_alice",
  email: "alice@example.test",
  firstName: "Alice",
  lastName: null,
};

test.beforeEach(async ({ page }) => {
  await page.route("**/api/auth/session", (route) =>
    route.fulfill({ json: { user: browserUser } }),
  );
});

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

test("production requires a browser session before requesting notes", async ({ page }) => {
  let noteRequests = 0;
  await page.route("**/api/auth/session", (route) =>
    route.fulfill({
      status: 401,
      json: { error: { code: "UNAUTHENTICATED", message: "No session" } },
    }),
  );
  await page.route("**/api/notes", (route) => {
    noteRequests++;
    return route.fulfill({ json: { notes: [] } });
  });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Atlas notes", exact: true })).toBeVisible();
  await expect(page.getByText("Sign in to view and edit your notes.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Sign in", exact: true })).toHaveAttribute(
    "href",
    "/api/auth/login",
  );
  expect(noteRequests).toBe(0);
});

test("signing out clears private note content", async ({ page }) => {
  const privateNote = {
    ...serverNote,
    title: "Private note",
    content: "Private note content",
  };
  let signedOut = false;
  await page.route("**/api/auth/session", (route) =>
    signedOut
      ? route.fulfill({
          status: 401,
          json: { error: { code: "UNAUTHENTICATED", message: "No session" } },
        })
      : route.fulfill({ json: { user: browserUser } }),
  );
  await page.route("**/api/notes", (route) => route.fulfill({ json: { notes: [privateNote] } }));
  await page.route(`**/api/notes/${privateNote.id}`, (route) =>
    route.fulfill({ json: privateNote, headers: { ETag: '"private-v1"' } }),
  );
  await page.route("**/api/auth/logout", (route) => {
    expect(route.request().method()).toBe("POST");
    signedOut = true;
    return route.fulfill({ status: 303, headers: { Location: "/" } });
  });
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/");
  await expectEditorContent(
    page.getByRole("textbox", { name: /^(Markdown source|Note content)$/ }),
    "Private note content",
  );
  const signOut = page.getByRole("button", { name: "Sign out", exact: true });
  expect((await signOut.boundingBox())?.height).toBeGreaterThanOrEqual(44);
  expect(await page.evaluate("document.documentElement.scrollWidth <= window.innerWidth")).toBe(
    true,
  );
  await signOut.click();
  await expect(page.getByRole("link", { name: "Sign in", exact: true })).toBeVisible();
  await expect(page.getByText("Private note content")).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "Title", exact: true })).toHaveCount(0);
});

test("signing out keeps the dirty beforeunload guard", async ({ page }) => {
  const privateNote = {
    ...serverNote,
    title: "Dirty sign out",
    content: "Private note content",
  };
  await page.route("**/api/notes", (route) => route.fulfill({ json: { notes: [privateNote] } }));
  await page.route(`**/api/notes/${privateNote.id}`, (route) =>
    route.fulfill({ json: privateNote, headers: { ETag: '"private-v1"' } }),
  );
  await page.goto("/");
  const source = page.getByRole("textbox", { name: /^(Markdown source|Note content)$/ });
  await expectEditorContent(source, "Private note content");
  await source.fill("Keep this unsaved sign-out draft");
  const warning = page.waitForEvent("dialog");
  const signOut = page.getByRole("button", { name: "Sign out", exact: true }).click();
  const dialog = await warning;
  expect(dialog.type()).toBe("beforeunload");
  await dialog.dismiss();
  await signOut.catch(() => undefined);
  await expectEditorContent(source, "Keep this unsaved sign-out draft");
});

test("an account change remounts the workspace and ignores the previous account's pending read", async ({
  page,
}) => {
  const aliceFirst = { ...serverNote, title: "Alice first", content: "Alice first content" };
  const aliceSecond = {
    ...serverNote,
    id: secondId,
    title: "Alice second",
    content: "Alice second content",
  };
  const bob = {
    id: "user_bob",
    email: "bob@example.test",
    firstName: "Bob",
    lastName: null,
  };
  const bobNote = {
    ...serverNote,
    id: "fa100001-1234-4000-8000-000000000003",
    title: "Bob note",
    content: "Bob content",
  };
  let account: "alice" | "bob" = "alice";
  let releasePendingRead!: () => void;
  const pendingRead = new Promise<void>((resolve) => {
    releasePendingRead = resolve;
  });
  let previousReadFinished = false;
  await page.route("**/api/auth/session", (route) =>
    route.fulfill({
      json: { user: account === "alice" ? browserUser : bob },
    }),
  );
  await page.route("**/api/notes", (route) =>
    route.fulfill({
      json: {
        notes: account === "alice" ? [aliceFirst, aliceSecond] : [bobNote],
      },
    }),
  );
  await page.route(`**/api/notes/${aliceFirst.id}`, (route) =>
    route.fulfill({ json: aliceFirst, headers: { ETag: '"alice-first"' } }),
  );
  await page.route(`**/api/notes/${aliceSecond.id}`, async (route) => {
    await pendingRead;
    await route.fulfill({ json: aliceSecond, headers: { ETag: '"alice-second"' } });
    previousReadFinished = true;
  });
  await page.route(`**/api/notes/${bobNote.id}`, (route) =>
    route.fulfill({ json: bobNote, headers: { ETag: '"bob-first"' } }),
  );

  await page.goto("/");
  const source = page.getByRole("textbox", { name: /^(Markdown source|Note content)$/ });
  await expectEditorContent(source, "Alice first content");
  await page.getByRole("button", { name: "Alice second", exact: true }).click();
  account = "bob";
  await page.evaluate("window.dispatchEvent(new Event('focus'))");
  await expect(page.getByText("Signed in as bob@example.test")).toBeVisible();
  await expectEditorContent(source, "Bob content");
  await expect(page.getByRole("button", { name: "Alice second", exact: true })).toHaveCount(0);

  releasePendingRead();
  await expect.poll(() => previousReadFinished).toBe(true);
  await expectEditorContent(source, "Bob content");
  await expect(page.getByText("Signed in as bob@example.test")).toBeVisible();
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
    const payload = updateNoteSchema.parse(route.request().postDataJSON());
    expect(payload).toMatchObject({
      title: "HTTP contract",
      content: paragraphDocument(updates === 0 ? "First HTTP edit" : "Second HTTP edit"),
    });
    updates++;
    await route.fulfill({
      json: { ...note, ...payload },
      headers: { ETag: updates === 1 ? '"http-v2"' : '"http-v3"' },
    });
  });
  await page.goto("/");
  const source = page.getByRole("textbox", { name: /^(Markdown source|Note content)$/ });
  await expectEditorContent(source, "Individual HTTP source");
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
  const source = page.getByRole("textbox", { name: /^(Markdown source|Note content)$/ });
  await expectEditorContent(source, "Original text");
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
  await expectEditorContent(source, "Original text");
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
  await page.getByRole("textbox", { name: /^(Markdown source|Note content)$/ }).fill("Local edit");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByRole("button", { name: "Compare latest" }).click();
  await page.getByRole("button", { name: "Retry opening", exact: true }).click();
  await expectEditorContent(
    page.getByRole("textbox", { name: /^(Markdown source|Note content)$/ }),
    "Local edit",
  );
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
      await page
        .getByRole("textbox", { name: /^(Markdown source|Note content)$/ })
        .fill("Preserve stalled edit");
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
      await expectEditorContent(
        page.getByRole("textbox", { name: /^(Markdown source|Note content)$/ }),
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
  const source = page.getByRole("textbox", { name: /^(Markdown source|Note content)$/ });
  await expectEditorContent(source, "Original text");
  await page.getByRole("button", { name: "Deleted elsewhere", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Your current text is unchanged.");
  await expectEditorContent(source, "Original text");
  await expect(page.getByRole("button", { name: "Deleted elsewhere", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Keep as new note", exact: true })).toHaveCount(0);
  await source.fill("Edit the still-existing note");
  await expect(page.getByRole("button", { name: "Save", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "New note", exact: true }).click();
  await page.getByRole("button", { name: "Keep editing" }).click();
  await expectEditorContent(source, "Edit the still-existing note");
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
  const source = page.getByRole("textbox", { name: /^(Markdown source|Note content)$/ });
  await expectEditorContent(source, "Original text");
  await page.getByRole("button", { name: "B", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Could not open note");
  await source.fill("Unsaved A must survive");
  await expect(page.getByRole("status")).toHaveText("Unsaved changes");
  await page.getByRole("button", { name: "Retry opening", exact: true }).click();
  await expect(page.getByRole("alertdialog")).toBeVisible();
  expect(otherReads).toBe(1);
  await page.getByRole("button", { name: "Keep editing", exact: true }).click();
  await expectEditorContent(source, "Unsaved A must survive");
  await expect(page.getByRole("textbox", { name: "Title", exact: true })).toHaveValue("A");
  await page.getByRole("button", { name: "Retry opening", exact: true }).click();
  await page.getByRole("button", { name: "Discard changes", exact: true }).click();
  await expectEditorContent(source, "Original B");
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
  await expect(page.getByRole("alert")).toContainText("note may already exist");
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

test("a 401 delete blocks writes, keeps the draft and offers sign-in", async ({ page }) => {
  await page.route("**/api/notes", (route) => route.fulfill({ json: { notes: [serverNote] } }));
  await page.route(`**/api/notes/${firstId}`, (route) =>
    route.request().method() === "DELETE"
      ? route.fulfill({
          status: 401,
          json: { error: { code: "UNAUTHENTICATED", message: "Session ended" } },
        })
      : route.fulfill({ json: serverNote, headers: { ETag: '"v1"' } }),
  );
  await page.goto("/");
  const source = page.getByRole("textbox", { name: /^(Markdown source|Note content)$/ });
  await expectEditorContent(source, "Original text");
  await source.fill("Unsaved delete draft");
  await page.getByRole("button", { name: "Delete note", exact: true }).click();
  await page.getByRole("button", { name: "Delete permanently", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Your session has ended.");
  await expect(page.getByRole("link", { name: "Sign in again", exact: true })).toBeFocused();
  await expect(page.getByRole("navigation", { name: "Notes" }).getByRole("button")).toHaveCount(0);
  await expectEditorContent(source, "Unsaved delete draft");
  await expect(page.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
});

test("delete sends the current ETag and selects the next, previous, or empty state", async ({
  page,
}) => {
  const first = { ...serverNote, title: "A", content: "First content" };
  const second = { ...serverNote, id: secondId, title: "B", content: "Second content" };
  const thirdId = "fa100001-1234-4000-8000-000000000003";
  const third = { ...serverNote, id: thirdId, title: "C", content: "Third content" };
  let notes = [first, second, third];
  const deletedEtags: string[] = [];
  await page.route("**/api/notes", (route) => route.fulfill({ json: { notes } }));
  for (const [note, etag] of [
    [first, '"first-v1"'],
    [second, '"second-v1"'],
    [third, '"third-v1"'],
  ] as const) {
    await page.route(`**/api/notes/${note.id}`, (route) => {
      if (route.request().method() === "DELETE") {
        deletedEtags.push(route.request().headers()["if-match"]);
        notes = notes.filter((item) => item.id !== note.id);
        return route.fulfill({ status: 204 });
      }
      return route.fulfill({ json: note, headers: { ETag: etag } });
    });
  }

  await page.goto("/");
  const source = page.getByRole("textbox", { name: /^(Markdown source|Note content)$/ });
  await expectEditorContent(source, "First content");
  await page.getByRole("button", { name: "Delete note", exact: true }).click();
  await expect(page.getByRole("alertdialog")).toContainText('"A"');
  await page.getByRole("button", { name: "Delete permanently", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Title", exact: true })).toHaveValue("B");
  await expectEditorContent(source, "Second content");
  await expect(page.getByRole("button", { name: "A", exact: true })).toHaveCount(0);

  await page.getByRole("button", { name: "C", exact: true }).click();
  await expectEditorContent(source, "Third content");
  await page.getByRole("button", { name: "Delete note", exact: true }).click();
  await page.getByRole("button", { name: "Delete permanently", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Title", exact: true })).toHaveValue("B");
  await expectEditorContent(source, "Second content");
  await expect(page.getByRole("button", { name: "C", exact: true })).toHaveCount(0);

  await page.getByRole("button", { name: "Delete note", exact: true }).click();
  await page.getByRole("button", { name: "Delete permanently", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Title", exact: true })).toHaveCount(0);
  await expect(page.getByText("No notes yet. Create a new note to get started.")).toBeVisible();
  await expect(page.getByRole("status")).toHaveText("Note deleted. No notes left.");
  expect(deletedEtags).toEqual(['"first-v1"', '"third-v1"', '"second-v1"']);
});

test("a stale delete keeps the note and requires a fresh comparison and confirmation", async ({
  page,
}) => {
  let reads = 0;
  let deletes = 0;
  await page.route("**/api/notes", (route) => route.fulfill({ json: { notes: [serverNote] } }));
  await page.route(`**/api/notes/${firstId}`, (route) => {
    if (route.request().method() === "DELETE") {
      deletes++;
      if (deletes === 1)
        return route.fulfill({
          status: 412,
          json: { error: { code: "PRECONDITION_FAILED", message: "Changed" } },
        });
      expect(route.request().headers()["if-match"]).toBe('"v2"');
      return route.fulfill({ status: 204 });
    }
    reads++;
    return route.fulfill({
      json: {
        ...serverNote,
        title: reads === 1 ? "A" : "A renamed",
        content: reads === 1 ? "Original text" : "A newer server version",
      },
      headers: { ETag: reads === 1 ? '"v1"' : '"v2"' },
    });
  });

  await page.goto("/");
  const source = page.getByRole("textbox", { name: /^(Markdown source|Note content)$/ });
  await expectEditorContent(source, "Original text");
  await source.fill("Local delete draft");
  await page.getByRole("button", { name: "Delete note", exact: true }).click();
  await page.getByRole("button", { name: "Delete permanently", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText(
    "This note changed on the server. Nothing was deleted.",
  );
  await expectEditorContent(source, "Local delete draft");
  await expect(page.getByRole("button", { name: "A", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Delete note", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Save", exact: true })).toBeDisabled();

  await page.getByRole("button", { name: "Compare latest", exact: true }).click();
  await expect(page.getByText("A newer server version", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Delete note", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Use latest version", exact: true }).click();
  await page.getByRole("button", { name: "Discard changes", exact: true }).click();
  await expectEditorContent(source, "A newer server version");
  await expect(page.getByRole("textbox", { name: "Title", exact: true })).toHaveValue("A renamed");
  await expect(page.getByRole("button", { name: "Delete note", exact: true })).toBeEnabled();

  await page.getByRole("button", { name: "Delete note", exact: true }).click();
  await page.getByRole("button", { name: "Delete permanently", exact: true }).click();
  await expect(page.getByText("No notes yet. Create a new note to get started.")).toBeVisible();
  expect(deletes).toBe(2);
});

test("deleting an already missing note keeps the draft and offers recovery", async ({ page }) => {
  await page.route("**/api/notes", (route) => route.fulfill({ json: { notes: [serverNote] } }));
  await page.route(`**/api/notes/${firstId}`, (route) =>
    route.request().method() === "DELETE"
      ? route.fulfill({ status: 404, json: { error: { code: "NOT_FOUND", message: "Missing" } } })
      : route.fulfill({ json: serverNote, headers: { ETag: '"v1"' } }),
  );
  await page.goto("/");
  const source = page.getByRole("textbox", { name: /^(Markdown source|Note content)$/ });
  await expectEditorContent(source, "Original text");
  await page.getByRole("button", { name: "Delete note", exact: true }).click();
  await page.getByRole("button", { name: "Delete permanently", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveText(
    "This note is no longer available. Your unsaved text is preserved. Refresh the notes list or keep your text as a new note.",
  );
  await expect(page.getByRole("button", { name: "A", exact: true })).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "Title", exact: true })).toHaveValue("A");
  await expectEditorContent(source, "Original text");
  await expect(page.getByRole("button", { name: "Delete note", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Refresh notes", exact: true })).toBeVisible();
  const keepAsNew = page.getByRole("button", { name: "Keep as new note", exact: true });
  await expect(keepAsNew).toBeVisible();
  await keepAsNew.click();
  await expect(page.getByRole("textbox", { name: "Title", exact: true })).toHaveValue("A");
  await expect(page.getByRole("textbox", { name: "Title", exact: true })).toBeFocused();
  await expectEditorContent(source, "Original text");
  await expect(page.getByRole("button", { name: "Save", exact: true })).toBeEnabled();
});

test("an unconfirmed delete preserves the draft and offers list reconciliation", async ({
  page,
}) => {
  let notes = [serverNote];
  await page.route("**/api/notes", (route) => route.fulfill({ json: { notes } }));
  await page.route(`**/api/notes/${firstId}`, (route) => {
    if (route.request().method() === "DELETE") {
      notes = [];
      return route.abort("failed");
    }
    return route.fulfill({ json: serverNote, headers: { ETag: '"v1"' } });
  });
  await page.goto("/");
  const title = page.getByRole("textbox", { name: "Title", exact: true });
  const source = page.getByRole("textbox", { name: /^(Markdown source|Note content)$/ });
  await expectEditorContent(source, "Original text");
  await source.fill("Uncertain delete draft");
  await page.getByRole("button", { name: "Delete note", exact: true }).click();
  await page.getByRole("button", { name: "Delete permanently", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Could not confirm deletion.");
  await expectEditorContent(source, "Uncertain delete draft");
  await expect(page.getByRole("button", { name: "Delete note", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Save", exact: true })).toBeDisabled();

  await page.getByRole("button", { name: "Refresh notes", exact: true }).click();
  await expect(page.getByRole("button", { name: "A", exact: true })).toHaveCount(0);
  await expect(page.getByRole("alert")).toHaveText(
    "This note is no longer available. Your unsaved text is preserved. Refresh the notes list or keep your text as a new note.",
  );
  await expectEditorContent(source, "Uncertain delete draft");
  await expect(page.getByRole("button", { name: "Delete note", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Keep as new note", exact: true })).toBeVisible();
  await expect(title).toBeFocused();
});

test("a 401 list refresh overrides a stale read failure and blocks writes", async ({ page }) => {
  const other = { ...serverNote, id: secondId, title: "B", content: "Original B" };
  let refreshBlocked = false;
  await page.route("**/api/notes", (route) => {
    if (route.request().method() === "GET" && refreshBlocked)
      return route.fulfill({
        status: 401,
        json: { error: { code: "UNAUTHENTICATED", message: "Session ended" } },
      });
    return route.fulfill({ json: { notes: [serverNote, other] } });
  });
  await page.route(`**/api/notes/${firstId}`, (route) =>
    route.fulfill({ json: serverNote, headers: { ETag: '"a1"' } }),
  );
  await page.route(`**/api/notes/${secondId}`, (route) =>
    route.fulfill({ status: 404, json: { error: { code: "NOT_FOUND", message: "Missing" } } }),
  );
  await page.goto("/");
  const source = page.getByRole("textbox", { name: /^(Markdown source|Note content)$/ });
  await expectEditorContent(source, "Original text");
  await page.getByRole("button", { name: "B", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("This note is no longer available");
  await source.fill("Unsaved A must survive");
  refreshBlocked = true;
  await page.getByRole("button", { name: "Refresh notes", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Your session has ended");
  await expect(page.getByRole("link", { name: "Sign in again" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Refresh notes", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Retry opening", exact: true })).toHaveCount(0);
  await expectEditorContent(source, "Unsaved A must survive");
});

test("session revalidation blocks private requests until the account is confirmed", async ({
  page,
}) => {
  let releaseSession!: () => void;
  const heldSession = new Promise<void>((resolve) => {
    releaseSession = resolve;
  });
  let revalidating = false;
  let privateRequests = 0;
  const creationKeys: string[] = [];
  await page.route("**/api/auth/session", async (route) => {
    if (revalidating) await heldSession;
    await route.fulfill({
      json: {
        user: revalidating
          ? { ...browserUser, id: "user_bob", email: "bob@example.test" }
          : browserUser,
      },
    });
  });
  await page.route("**/api/notes", (route) => {
    if (revalidating) privateRequests++;
    if (route.request().method() === "POST") {
      creationKeys.push(route.request().headers()["idempotency-key"]);
      if (creationKeys.length === 1) return route.abort("failed");
      return route.fulfill({
        status: 201,
        json: { ...serverNote, ...createNoteSchema.parse(route.request().postDataJSON()) },
        headers: { ETag: '"bob-created"' },
      });
    }
    return route.fulfill({ json: { notes: [] } });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "New note", exact: true }).click();
  const source = page.getByRole("textbox", { name: /^(Markdown source|Note content)$/ });
  await source.fill("Alice private draft");
  await page.keyboard.press("ControlOrMeta+s");
  await expect(page.getByRole("alert")).toContainText("Could not confirm creation");
  revalidating = true;
  await page.evaluate(`
    window.dispatchEvent(new Event('focus'));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true, cancelable: true }));
  `);
  const save = page.getByRole("button", { name: "Save", exact: true });
  await expect(save).toBeDisabled();
  await page.keyboard.press("ControlOrMeta+s");
  await expectEditorContent(source, "Alice private draft");
  expect(privateRequests).toBe(0);
  releaseSession();
  await expect(page.getByText("Signed in as bob@example.test")).toBeVisible();
  await expect(source).toHaveCount(0);
  await expect(page.getByRole("button", { name: "New note", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "New note", exact: true }).click();
  await source.fill("Bob separate draft");
  await page.keyboard.press("ControlOrMeta+s");
  await expect(page.getByRole("status")).toHaveText("Saved");
  expect(creationKeys).toHaveLength(2);
  expect(creationKeys[1]).not.toBe(creationKeys[0]);
});

test("failed session revalidation preserves a mobile draft and blocks writes until retry", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  let sessionFails = false;
  let creates = 0;
  await page.route("**/api/auth/session", (route) =>
    route.fulfill(
      sessionFails
        ? { status: 503, json: { error: { code: "INTERNAL_ERROR", message: "Try later" } } }
        : { json: { user: browserUser } },
    ),
  );
  await page.route("**/api/notes", (route) => {
    if (route.request().method() === "POST") {
      creates++;
      const input = route.request().postDataJSON();
      return route.fulfill({
        status: 201,
        json: { ...serverNote, ...input },
        headers: { ETag: '"new"' },
      });
    }
    return route.fulfill({ json: { notes: [] } });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "New note", exact: true }).click();
  const source = page.getByRole("textbox", { name: /^(Markdown source|Note content)$/ });
  await source.fill("Keep my draft while offline");
  sessionFails = true;
  await page.evaluate("window.dispatchEvent(new Event('focus'))");
  const retry = page.getByRole("button", { name: "Retry session check" });
  await expect(retry).toBeVisible();
  await expectEditorContent(source, "Keep my draft while offline");
  await expect(page.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
  await page.keyboard.press("ControlOrMeta+s");
  expect(creates).toBe(0);
  sessionFails = false;
  await retry.click();
  await expect(page.getByRole("button", { name: "Save", exact: true })).toBeEnabled();
  await expectEditorContent(source, "Keep my draft while offline");
  await page.keyboard.press("ControlOrMeta+s");
  await expect(page.getByRole("status")).toHaveText("Saved");
  expect(creates).toBe(1);
  expect(await page.evaluate("document.documentElement.scrollWidth <= window.innerWidth")).toBe(
    true,
  );
});

for (const failFirstUpdate of [false, true]) {
  test(`lost creation recovers its original snapshot and newer edits (update failure: ${failFirstUpdate})`, async ({
    page,
  }) => {
    let committed: Note | null = null;
    let original: CreateNote | null = null;
    const keys: string[] = [];
    let postCount = 0;
    let putCount = 0;
    let releaseReplay!: () => void;
    const replay = new Promise<void>((resolve) => {
      releaseReplay = resolve;
    });
    await page.route("**/api/notes", async (route) => {
      if (route.request().method() !== "POST")
        return route.fulfill({ json: { notes: committed ? [committed] : [] } });
      const input = createNoteSchema.parse(route.request().postDataJSON());
      keys.push(route.request().headers()["idempotency-key"]);
      postCount++;
      if (postCount === 1) {
        original = input;
        committed = { ...serverNote, ...input };
        return route.abort("failed");
      }
      expect(input).toEqual(original);
      expect(keys[1]).toBe(keys[0]);
      await replay;
      return route.fulfill({ status: 201, json: committed, headers: { ETag: '"created"' } });
    });
    await page.route(`**/api/notes/${firstId}`, (route) => {
      if (route.request().method() === "PUT") {
        expect(route.request().headers()["if-match"]).toBe(
          putCount === 0 || failFirstUpdate ? '"created"' : '"updated-1"',
        );
        if (putCount === 0 && failFirstUpdate) {
          putCount++;
          return route.fulfill({
            status: 500,
            json: { error: { code: "INTERNAL_ERROR", message: "Retry" } },
          });
        }
        const input = updateNoteSchema.parse(route.request().postDataJSON());
        committed = { ...serverNote, ...committed, ...input };
        putCount++;
      }
      return route.fulfill({ json: committed, headers: { ETag: `"updated-${putCount}"` } });
    });
    await page.goto("/");
    await page.getByRole("button", { name: "New note", exact: true }).click();
    const source = page.getByRole("textbox", { name: /^(Markdown source|Note content)$/ });
    await source.fill("Original submitted text");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("Could not confirm creation");
    await source.fill("New text before retry");
    await page.keyboard.press("ControlOrMeta+s");
    await expect.poll(() => postCount).toBe(2);
    await source.fill("Even newer text during replay");
    releaseReplay();
    if (failFirstUpdate) await expect(page.getByRole("alert")).toContainText("Save failed");
    else await expect(page.getByRole("status")).toHaveText("Unsaved changes");
    await expectEditorContent(source, "Even newer text during replay");
    expect(committed).toMatchObject({
      content: paragraphDocument(
        failFirstUpdate ? "Original submitted text" : "New text before retry",
      ),
    });
    expect(putCount).toBe(1);
    await page.keyboard.press("ControlOrMeta+s");
    await expect(page.getByRole("status")).toHaveText("Saved");
    expect(postCount).toBe(2);
    expect(putCount).toBe(2);
    await page.reload();
    await expectEditorContent(source, "Even newer text during replay");
  });
}

test("creation replay conflict retains text and blocks a fresh creation key", async ({ page }) => {
  const keys: string[] = [];
  await page.route("**/api/notes", (route) => {
    if (route.request().method() !== "POST") return route.fulfill({ json: { notes: [] } });
    keys.push(route.request().headers()["idempotency-key"]);
    return keys.length === 1
      ? route.abort("failed")
      : route.fulfill({
          status: 409,
          json: { error: { code: "CONFLICT", message: "Replay unavailable" } },
        });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "New note", exact: true }).click();
  const source = page.getByRole("textbox", { name: /^(Markdown source|Note content)$/ });
  await source.fill("Preserve this draft");
  await page.keyboard.press("ControlOrMeta+s");
  await expect(page.getByRole("alert")).toContainText("Could not confirm creation");
  await source.fill("Preserve the newer draft too");
  await page.keyboard.press("ControlOrMeta+s");
  await expect(page.getByRole("alert")).toContainText("Could not reconcile this creation");
  await expectEditorContent(source, "Preserve the newer draft too");
  await expect(page.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
  await page.keyboard.press("ControlOrMeta+s");
  await page.getByRole("button", { name: "Refresh notes", exact: true }).click();
  await expect(page.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
  expect(keys).toHaveLength(2);
  expect(keys[0]).toMatch(/^[0-9a-f-]{36}$/);
  expect(keys[1]).toBe(keys[0]);
});

test("unsupported text stays recoverable on mobile while normal Unicode can be saved", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 375, height: 812 });
  let creates = 0;
  await page.route("**/api/notes", (route) => {
    if (route.request().method() !== "POST") return route.fulfill({ json: { notes: [] } });
    creates++;
    return route.fulfill({
      status: 201,
      json: { ...serverNote, ...createNoteSchema.parse(route.request().postDataJSON()) },
      headers: { ETag: '"unicode-created"' },
    });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "New note", exact: true }).click();
  const source = page.getByRole("textbox", { name: /^(Markdown source|Note content)$/ });
  const unsupported = "Keep this\u0000draft";
  await source.fill(unsupported);
  await expectEditorContent(source, unsupported);
  await expect(page.getByRole("alert")).toContainText("unsupported characters");
  const save = page.getByRole("button", { name: "Save", exact: true });
  await expect(save).toBeDisabled();
  await page.screenshot({
    path: testInfo.outputPath("unsupported-text-mobile.png"),
    fullPage: true,
  });
  await page.keyboard.press("ControlOrMeta+s");
  expect(creates).toBe(0);
  const valid = "İstanbul, café, 中文 👩🏽‍💻";
  await source.fill(valid);
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(save).toBeEnabled();
  await page.keyboard.press("ControlOrMeta+s");
  await expect(page.getByRole("status")).toHaveText("Saved");
  await expectEditorContent(source, valid);
  expect(creates).toBe(1);
});

test("opening and undo preserve the original Markdown until an actual edit is saved", async ({
  page,
}, testInfo) => {
  let note: Note = { ...serverNote, content: "Original text\n\n" };
  let writes = 0;
  await page.route("**/api/notes", (route) => route.fulfill({ json: { notes: [note] } }));
  await page.route(`**/api/notes/${firstId}`, (route) => {
    if (route.request().method() === "PUT") {
      note = { ...note, ...updateNoteSchema.parse(route.request().postDataJSON()) };
      writes++;
    }
    return route.fulfill({ json: note, headers: { ETag: `"v${writes}"` } });
  });
  await page.goto("/");
  const editor = page.getByRole("textbox", { name: "Note content", exact: true });
  const save = page.getByRole("button", { name: "Save", exact: true });
  await expectEditorContent(editor, "Original text");
  await editor.click();
  await page.keyboard.press("ControlOrMeta+z");
  await expectEditorContent(editor, "Original text");
  await expect(save).toBeDisabled();
  await page.keyboard.press("End");
  await page.keyboard.type(" edited");
  await expect(save).toBeEnabled();
  await page.keyboard.press("ControlOrMeta+z");
  await expectEditorContent(editor, "Original text");
  await expect(save).toBeDisabled();
  await page.getByRole("textbox", { name: "Title", exact: true }).fill("Renamed only");
  await save.click();
  await expect(page.getByRole("status")).toHaveText("Saved");
  expect(note.content).toBe("Original text\n\n");
  await editor.fill("Edited in blocks");
  await save.click();
  await expect(page.getByRole("status")).toHaveText("Saved");
  expect(note.content).toEqual(paragraphDocument("Edited in blocks"));
  await page.reload();
  await expectEditorContent(editor, "Edited in blocks");
  await expect(save).toBeDisabled();
  for (const width of [1440, 375, 320]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate("document.documentElement.scrollWidth <= window.innerWidth")).toBe(
      true,
    );
    await expect(page.getByRole("heading", { name: "Preview", exact: true })).toHaveCount(0);
    await page.screenshot({
      path: testInfo.outputPath(`block-editor-${width}.png`),
      fullPage: true,
    });
  }
});

test("legacy import preserves remote media and raw HTML as inert source", async ({ page }) => {
  const content =
    '# Legacy\n\n![remote](https://untrusted.example.test/tracker.png)\n\n<script>window.atlasInjected = true</script>\n\n<div onclick="alert(1)">Custom HTML</div>';
  const note = { ...serverNote, content };
  let remoteRequests = 0;
  await page.route("https://untrusted.example.test/**", (route) => {
    remoteRequests++;
    return route.abort();
  });
  await page.route("**/api/notes", (route) => route.fulfill({ json: { notes: [note] } }));
  await page.route(`**/api/notes/${firstId}`, (route) =>
    route.fulfill({ json: note, headers: { ETag: '"legacy"' } }),
  );
  await page.goto("/");
  await expect(page.getByRole("textbox", { name: "Markdown source", exact: true })).toHaveValue(
    content,
  );
  await expect(page.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
  expect(remoteRequests).toBe(0);
  expect(await page.evaluate("window.atlasInjected")).toBeUndefined();
  await expect(page.locator(".markdown-preview img, .markdown-preview script")).toHaveCount(0);
});
