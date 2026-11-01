import { readFile, readdir } from "node:fs/promises";
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
  await expect(page.getByRole("textbox", { name: "Markdown source" })).toHaveValue(
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
  const source = page.getByRole("textbox", { name: "Markdown source" });
  await expect(source).toHaveValue("Private note content");
  await source.fill("Keep this unsaved sign-out draft");
  const warning = page.waitForEvent("dialog");
  const signOut = page.getByRole("button", { name: "Sign out", exact: true }).click();
  const dialog = await warning;
  expect(dialog.type()).toBe("beforeunload");
  await dialog.dismiss();
  await signOut.catch(() => undefined);
  await expect(source).toHaveValue("Keep this unsaved sign-out draft");
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
  const source = page.getByRole("textbox", { name: "Markdown source" });
  await expect(source).toHaveValue("Alice first content");
  await page.getByRole("button", { name: "Alice second", exact: true }).click();
  account = "bob";
  await page.evaluate("window.dispatchEvent(new Event('focus'))");
  await expect(page.getByText("Signed in as bob@example.test")).toBeVisible();
  await expect(source).toHaveValue("Bob content");
  await expect(page.getByRole("button", { name: "Alice second", exact: true })).toHaveCount(0);

  releasePendingRead();
  await expect.poll(() => previousReadFinished).toBe(true);
  await expect(source).toHaveValue("Bob content");
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
  const source = page.getByRole("textbox", { name: "Markdown source" });
  await expect(source).toHaveValue("Original text");
  await source.fill("Unsaved delete draft");
  await page.getByRole("button", { name: "Delete note", exact: true }).click();
  await page.getByRole("button", { name: "Delete permanently", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Your session has ended.");
  await expect(page.getByRole("link", { name: "Sign in again", exact: true })).toBeFocused();
  await expect(page.getByRole("navigation", { name: "Notes" }).getByRole("button")).toHaveCount(0);
  await expect(source).toHaveValue("Unsaved delete draft");
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
  const source = page.getByRole("textbox", { name: "Markdown source" });
  await expect(source).toHaveValue("First content");
  await page.getByRole("button", { name: "Delete note", exact: true }).click();
  await expect(page.getByRole("alertdialog")).toContainText('"A"');
  await page.getByRole("button", { name: "Delete permanently", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Title", exact: true })).toHaveValue("B");
  await expect(source).toHaveValue("Second content");
  await expect(page.getByRole("button", { name: "A", exact: true })).toHaveCount(0);

  await page.getByRole("button", { name: "C", exact: true }).click();
  await expect(source).toHaveValue("Third content");
  await page.getByRole("button", { name: "Delete note", exact: true }).click();
  await page.getByRole("button", { name: "Delete permanently", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Title", exact: true })).toHaveValue("B");
  await expect(source).toHaveValue("Second content");
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
  const source = page.getByRole("textbox", { name: "Markdown source" });
  await expect(source).toHaveValue("Original text");
  await source.fill("Local delete draft");
  await page.getByRole("button", { name: "Delete note", exact: true }).click();
  await page.getByRole("button", { name: "Delete permanently", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText(
    "This note changed on the server. Nothing was deleted.",
  );
  await expect(source).toHaveValue("Local delete draft");
  await expect(page.getByRole("button", { name: "A", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Delete note", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Save", exact: true })).toBeDisabled();

  await page.getByRole("button", { name: "Compare latest", exact: true }).click();
  await expect(page.getByText("A newer server version", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Delete note", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Use latest version", exact: true }).click();
  await page.getByRole("button", { name: "Discard changes", exact: true }).click();
  await expect(source).toHaveValue("A newer server version");
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
  const source = page.getByRole("textbox", { name: "Markdown source" });
  await expect(source).toHaveValue("Original text");
  await page.getByRole("button", { name: "Delete note", exact: true }).click();
  await page.getByRole("button", { name: "Delete permanently", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveText(
    "This note is no longer available. Your unsaved text is preserved. Refresh the notes list or keep your text as a new note.",
  );
  await expect(page.getByRole("button", { name: "A", exact: true })).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "Title", exact: true })).toHaveValue("A");
  await expect(source).toHaveValue("Original text");
  await expect(page.getByRole("button", { name: "Delete note", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Refresh notes", exact: true })).toBeVisible();
  const keepAsNew = page.getByRole("button", { name: "Keep as new note", exact: true });
  await expect(keepAsNew).toBeVisible();
  await keepAsNew.click();
  await expect(page.getByRole("textbox", { name: "Title", exact: true })).toHaveValue("A");
  await expect(page.getByRole("textbox", { name: "Title", exact: true })).toBeFocused();
  await expect(source).toHaveValue("Original text");
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
  const source = page.getByRole("textbox", { name: "Markdown source" });
  await expect(source).toHaveValue("Original text");
  await source.fill("Uncertain delete draft");
  await page.getByRole("button", { name: "Delete note", exact: true }).click();
  await page.getByRole("button", { name: "Delete permanently", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Could not confirm deletion.");
  await expect(source).toHaveValue("Uncertain delete draft");
  await expect(page.getByRole("button", { name: "Delete note", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Save", exact: true })).toBeDisabled();

  await page.getByRole("button", { name: "Refresh notes", exact: true }).click();
  await expect(page.getByRole("button", { name: "A", exact: true })).toHaveCount(0);
  await expect(page.getByRole("alert")).toHaveText(
    "This note is no longer available. Your unsaved text is preserved. Refresh the notes list or keep your text as a new note.",
  );
  await expect(source).toHaveValue("Uncertain delete draft");
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
  const source = page.getByRole("textbox", { name: "Markdown source" });
  await expect(source).toHaveValue("Original text");
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
  await expect(source).toHaveValue("Unsaved A must survive");
});
