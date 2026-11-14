import { expectEditorContent, paragraphDocument, serveNotes, toListRow } from "./notes-editor.ts";
import { readFile, readdir } from "node:fs/promises";
import { createNoteSchema, updateNoteSchema, type Note, type CreateNote } from "../shared/notes.ts";
import { formatConversationLabel } from "../src/notes/conversation-store.ts";
import { expect, test } from "@playwright/test";

const browserUser = {
  id: "user_alice",
  email: "alice@example.test",
  firstName: "Alice",
  lastName: null,
};

const firstId = "fa100001-1234-4000-8000-000000000001";
const secondId = "fa100001-1234-4000-8000-000000000002";
const serverNote = {
  id: firstId,
  title: "A",
  content: "Original text",
  createdAt: "2026-10-28T09:00:00.000Z",
  updatedAt: "2026-10-28T09:00:00.000Z",
};

test.beforeEach(async ({ page }) => {
  await page.route("**/api/organize-work", (route) =>
    route.fulfill({ json: { runs: [], drafts: [] } }),
  );
  await page.route("**/api/conversations*", (route) =>
    route.fulfill({ json: { conversations: [], nextCursor: null } }),
  );
  await page.route("**/api/auth/session", (route) =>
    route.fulfill({ json: { user: browserUser } }),
  );
});

test.describe("loading and selection", () => {
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
    await expect(page.getByRole("alert")).toBeEmpty();
    await expect(page.getByRole("button", { name: /Retry/ })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "New note", exact: true })).toBeDisabled();
    await expect(page.getByText(/Development preview with synthetic/)).toHaveCount(0);
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

  test("a forbidden read does not block the current draft or another allowed note", async ({
    page,
  }) => {
    const other = { ...serverNote, id: secondId, title: "Forbidden" };
    await serveNotes(page, [[serverNote, '"v1"'], [other]]);
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

  test("initial missing read removes the entry and gives recovery that exists", async ({
    page,
  }) => {
    await serveNotes(page, [[serverNote]]);
    await page.route(`**/api/notes/${firstId}`, (route) =>
      route.fulfill({ status: 404, json: { error: { code: "NOT_FOUND", message: "Missing" } } }),
    );
    await page.goto("/");
    await expect(page.getByRole("alert")).toContainText(
      "Refresh the notes list or choose another note.",
    );
    await expect(page.getByRole("alert")).not.toContainText("keep your text as a new note");
    await expect(page.getByRole("navigation", { name: "Notes" }).getByRole("button")).toHaveCount(
      0,
    );
    await page.getByRole("button", { name: "New note", exact: true }).click();
    await expect(page.getByRole("textbox", { name: "Title", exact: true })).toHaveValue("");
  });

  test("a missing different note preserves the current draft and offers only applicable recovery", async ({
    page,
  }) => {
    const missing = { ...serverNote, id: secondId, title: "Deleted elsewhere" };
    await serveNotes(page, [[serverNote, '"v1"'], [missing]]);
    await page.route(`**/api/notes/${secondId}`, (route) =>
      route.fulfill({ status: 404, json: { error: { code: "NOT_FOUND", message: "Missing" } } }),
    );
    await page.goto("/");
    const source = page.getByRole("textbox", { name: /^(Markdown source|Note content)$/ });
    await expectEditorContent(source, "Original text");
    await page.getByRole("button", { name: "Deleted elsewhere", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("Your current text is unchanged.");
    await expectEditorContent(source, "Original text");
    await expect(page.getByRole("button", { name: "Deleted elsewhere", exact: true })).toHaveCount(
      0,
    );
    await expect(page.getByRole("button", { name: "Keep as new note", exact: true })).toHaveCount(
      0,
    );
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
    await serveNotes(page, [
      [serverNote, '"a1"'],
      [other, '"b1"'],
    ]);
    await page.route(`**/api/notes/${secondId}`, (route) => {
      otherReads++;
      return otherReads === 1
        ? route.fulfill({
            status: 500,
            json: { error: { code: "INTERNAL_ERROR", message: "Read failed" } },
          })
        : route.fallback();
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

  test("legacy import preserves remote media and raw HTML as inert source", async ({ page }) => {
    const content =
      '# Legacy\n\n![remote](https://untrusted.example.test/tracker.png)\n\n<script>window.atlasInjected = true</script>\n\n<div onclick="alert(1)">Custom HTML</div>';
    const note = { ...serverNote, content };
    let remoteRequests = 0;
    await page.route("https://untrusted.example.test/**", (route) => {
      remoteRequests++;
      return route.abort();
    });
    await serveNotes(page, [[note, '"legacy"']]);
    await page.goto("/");
    await expect(page.getByRole("textbox", { name: "Markdown source", exact: true })).toHaveValue(
      content,
    );
    await expect(page.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
    expect(remoteRequests).toBe(0);
    expect(await page.evaluate("window.atlasInjected")).toBeUndefined();
    await expect(page.locator(".markdown-preview img, .markdown-preview script")).toHaveCount(0);
  });
});

test.describe("saving and conflicts", () => {
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
      route.fulfill({ json: { notes: [{ ...toListRow(note), title: "Old list title" }] } }),
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

  test("adopting a conflict version synchronizes its changed title in the sidebar", async ({
    page,
  }) => {
    let reads = 0;
    await serveNotes(page, [[serverNote]]);
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
    await page
      .getByRole("textbox", { name: /^(Markdown source|Note content)$/ })
      .fill("Local edit");
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
    await expect(
      page.getByRole("alert").filter({ hasText: "unsupported characters" }),
    ).toBeVisible();
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
    await expect(page.getByRole("alert")).toBeEmpty();
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
    await page.route("**/api/notes", (route) =>
      route.fulfill({ json: { notes: [toListRow(note)] } }),
    );
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
});

test.describe("create and delete", () => {
  test("a lost create response offers list reconciliation without automatically creating again", async ({
    page,
  }) => {
    let creates = 0;
    await page.route("**/api/notes", (route) => {
      if (route.request().method() === "POST") {
        creates++;
        return route.abort("failed");
      }
      return route.fulfill({ json: { notes: creates ? [toListRow(serverNote)] : [] } });
    });
    await page.goto("/");
    await page.getByRole("button", { name: "New note", exact: true }).click();
    const title = page.getByRole("textbox", { name: "Title", exact: true });
    await title.fill("A");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("note may already exist");
    await page.getByRole("button", { name: "Refresh notes", exact: true }).click();
    await expect(
      page
        .getByRole("navigation", { name: "Notes" })
        .getByRole("button", { name: "A", exact: true }),
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
    await serveNotes(page, [[serverNote, '"v1"']]);
    await page.route(`**/api/notes/${firstId}`, (route) =>
      route.request().method() === "DELETE"
        ? route.fulfill({
            status: 401,
            json: { error: { code: "UNAUTHENTICATED", message: "Session ended" } },
          })
        : route.fallback(),
    );
    await page.goto("/");
    const source = page.getByRole("textbox", { name: /^(Markdown source|Note content)$/ });
    await expectEditorContent(source, "Original text");
    await source.fill("Unsaved delete draft");
    await page.getByRole("button", { name: "Delete note", exact: true }).click();
    await page.getByRole("button", { name: "Delete permanently", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("Your session has ended.");
    await expect(page.getByRole("link", { name: "Sign in again", exact: true })).toBeFocused();
    await expect(page.getByRole("navigation", { name: "Notes" }).getByRole("button")).toHaveCount(
      0,
    );
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
    await page.route("**/api/notes", (route) =>
      route.fulfill({ json: { notes: notes.map(toListRow) } }),
    );
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
    await serveNotes(page, [[serverNote]]);
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
    await expect(page.getByRole("textbox", { name: "Title", exact: true })).toHaveValue(
      "A renamed",
    );
    await expect(page.getByRole("button", { name: "Delete note", exact: true })).toBeEnabled();

    await page.getByRole("button", { name: "Delete note", exact: true }).click();
    await page.getByRole("button", { name: "Delete permanently", exact: true }).click();
    await expect(page.getByText("No notes yet. Create a new note to get started.")).toBeVisible();
    expect(deletes).toBe(2);
  });

  test("deleting an already missing note keeps the draft and offers recovery", async ({ page }) => {
    await serveNotes(page, [[serverNote, '"v1"']]);
    await page.route(`**/api/notes/${firstId}`, (route) =>
      route.request().method() === "DELETE"
        ? route.fulfill({ status: 404, json: { error: { code: "NOT_FOUND", message: "Missing" } } })
        : route.fallback(),
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
    await page.route("**/api/notes", (route) =>
      route.fulfill({ json: { notes: notes.map(toListRow) } }),
    );
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
          return route.fulfill({ json: { notes: committed ? [toListRow(committed)] : [] } });
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

  test("creation replay conflict retains text and blocks a fresh creation key", async ({
    page,
  }) => {
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
});

test.describe("recovery and auth", () => {
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
    await serveNotes(page, [[privateNote, '"private-v1"']]);
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
    await serveNotes(page, [[privateNote, '"private-v1"']]);
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
          notes: (account === "alice" ? [aliceFirst, aliceSecond] : [bobNote]).map(toListRow),
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

  for (const operation of ["list", "read", "save"] as const) {
    test(`hung ${operation} releases controls after the request deadline`, async ({ page }) => {
      await page.clock.install();
      let stalled = false;
      await serveNotes(page, [[serverNote, '"v1"']]);
      await page.route("**/api/notes", (route) => {
        if (operation === "list") {
          stalled = true;
          return;
        }
        return route.fallback();
      });
      await page.route(`**/api/notes/${firstId}`, (route) => {
        if (operation === "read" || route.request().method() === "PUT") {
          stalled = true;
          return;
        }
        return route.fallback();
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
      const expectedAlert =
        operation === "list"
          ? "Could not load"
          : operation === "read"
            ? "Could not open"
            : "Save failed";
      // The chat workspace publishes its own alert, and the forwarded clock can time
      // out its pending list request, so match the note alert by its message.
      await expect(page.getByRole("alert").filter({ hasText: expectedAlert })).toBeVisible();
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

  test("a 401 list refresh overrides a stale read failure and blocks writes", async ({ page }) => {
    const other = { ...serverNote, id: secondId, title: "B", content: "Original B" };
    let refreshBlocked = false;
    await serveNotes(page, [[serverNote, '"a1"'], [other]]);
    await page.route("**/api/notes", (route) => {
      if (route.request().method() === "GET" && refreshBlocked)
        return route.fulfill({
          status: 401,
          json: { error: { code: "UNAUTHENTICATED", message: "Session ended" } },
        });
      return route.fallback();
    });
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
});

test.describe("search and source opening", () => {
  test("disables source opening during a save without erasing the search", async ({ page }) => {
    await serveNotes(page, [[serverNote, `"${firstId}:1"`]]);
    let releaseSave!: () => void;
    const saved = new Promise<void>((resolve) => {
      releaseSave = resolve;
    });
    await page.route(`**/api/notes/${firstId}`, async (route) => {
      if (route.request().method() !== "PUT") return route.fallback();
      await saved;
      return route.fulfill({
        json: { ...serverNote, ...updateNoteSchema.parse(route.request().postDataJSON()) },
        headers: { ETag: `"${firstId}:2"` },
      });
    });
    await page.route("**/api/note-search", (route) =>
      route.fulfill({
        json: {
          candidates: [
            {
              text: "Original text",
              score: 0.9,
              source: {
                kind: "markdown",
                noteId: firstId,
                version: `"${firstId}:1"`,
                startOffset: 0,
                endOffset: 13,
                headingPath: [],
              },
            },
          ],
          coverage: { ready: 1, pending: 0, failed: 0 },
        },
      }),
    );
    await page.goto("/");
    const search = page.getByRole("region", { name: "Search notes" });
    const query = search.getByLabel("Search saved notes");
    await query.fill("saved evidence");
    await query.press("Enter");
    const open = search.getByRole("button", { name: "Open source", exact: true });
    await expect(open).toBeEnabled();
    await page
      .getByRole("textbox", { name: /^(Markdown source|Note content)$/ })
      .fill("Updated text");
    const request = page.waitForRequest((request) => request.method() === "PUT");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await request;
    await expect(open).toBeDisabled();
    await expect(query).toHaveValue("saved evidence");
    releaseSave();
    await expect(page.getByRole("status")).toHaveText("Saved");
    await expect(open).toBeEnabled();
    await expect(query).toHaveValue("saved evidence");
  });

  test("retains a missing source title and clears stale source errors on dismiss or another failure", async ({
    page,
  }) => {
    const thirdId = "fa100001-1234-4000-8000-000000000003";
    const missing = { ...serverNote, id: secondId, title: "Missing evidence" };
    const denied = { ...serverNote, id: thirdId, title: "Other evidence" };
    await serveNotes(page, [[serverNote, `"${firstId}:1"`], [missing], [denied]]);
    await page.route(`**/api/notes/${secondId}`, (route) =>
      route.fulfill({ status: 404, json: { error: { code: "NOT_FOUND", message: "Missing" } } }),
    );
    let failureStatus = 403;
    await page.route(`**/api/notes/${thirdId}`, (route) =>
      route.fulfill({
        status: failureStatus,
        json: { error: { code: "FORBIDDEN", message: "Denied" } },
      }),
    );
    await page.route("**/api/note-search", (route) =>
      route.fulfill({
        json: {
          candidates: [missing, denied].map((note) => ({
            text: "Original text",
            score: 0.9,
            source: {
              kind: "markdown",
              noteId: note.id,
              version: `"${note.id}:1"`,
              startOffset: 0,
              endOffset: 13,
              headingPath: [],
            },
          })),
          coverage: { ready: 3, pending: 0, failed: 0 },
        },
      }),
    );
    await page.goto("/");
    const search = page.getByRole("region", { name: "Search notes" });
    await search.getByLabel("Search saved notes").fill("evidence");
    await search.getByLabel("Search saved notes").press("Enter");
    const openMissing = search
      .locator(".note-search-card")
      .filter({ hasText: "Missing evidence" })
      .getByRole("button", { name: "Open source", exact: true });
    const openOther = search
      .locator(".note-search-card")
      .filter({ hasText: "Other evidence" })
      .getByRole("button", { name: "Open source", exact: true });
    const panel = page.getByRole("region", { name: "Opened source" });
    await openMissing.click();
    await expect(panel).toContainText("Missing evidence");
    await expect(openMissing).toBeEnabled();
    await page.getByRole("button", { name: "Dismiss source", exact: true }).click();
    await expect(panel).toHaveCount(0);
    await expect(page.getByRole("alert")).toBeEmpty();
    await expect(page.getByRole("button", { name: "Refresh notes", exact: true })).toHaveCount(0);
    for (const status of [403, 500]) {
      failureStatus = status;
      await openMissing.click();
      await expect(panel).toContainText("Missing evidence");
      await openOther.click();
      await expect(page.getByRole("alert")).not.toBeEmpty();
      await expect(panel).toHaveCount(0);
      await expect(page.getByRole("textbox", { name: "Title", exact: true })).toHaveValue("A");
      await expectEditorContent(
        page.getByRole("textbox", { name: /^(Markdown source|Note content)$/ }),
        "Original text",
      );
    }
  });

  test("never displays a delayed search from the previous account", async ({ page }) => {
    let bob = false;
    let releaseAlice!: () => void;
    const aliceResponse = new Promise<void>((resolve) => {
      releaseAlice = resolve;
    });
    await page.route("**/api/auth/session", (route) =>
      route.fulfill({
        json: {
          user: bob ? { ...browserUser, id: "user_bob", email: "bob@example.test" } : browserUser,
        },
      }),
    );
    await serveNotes(page, [[serverNote, `"${firstId}:1"`]]);
    await page.route("**/api/notes", (route) =>
      route.fulfill({ json: { notes: bob ? [] : [toListRow(serverNote)] } }),
    );
    await page.route("**/api/note-search", async (route) => {
      const alice = route.request().postDataJSON().query === "Alice private query";
      if (alice) await aliceResponse;
      return route.fulfill({
        json: {
          candidates: [
            {
              text: alice ? "Alice private search evidence" : "Bob separate search evidence",
              score: 0.9,
              source: {
                kind: "markdown",
                noteId: alice ? firstId : secondId,
                version: `"${alice ? firstId : secondId}:1"`,
                startOffset: 0,
                endOffset: 13,
                headingPath: [],
              },
            },
          ],
          coverage: { ready: 1, pending: 0, failed: 0 },
        },
      });
    });
    await page.goto("/");
    const search = page.getByRole("region", { name: "Search notes" });
    const query = search.getByLabel("Search saved notes");
    await query.fill("Alice private query");
    const started = page.waitForRequest((request) => request.url().endsWith("/api/note-search"));
    await query.press("Enter");
    await started;
    bob = true;
    await page.evaluate("window.dispatchEvent(new Event('focus'))");
    await expect(page.getByText("Signed in as bob@example.test")).toBeVisible();
    await expect(query).toHaveValue("");
    await query.fill("Bob query");
    await query.press("Enter");
    await expect(search.getByText("Bob separate search evidence")).toBeVisible();
    const completed = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/note-search") &&
        response.request().postDataJSON().query === "Alice private query",
    );
    releaseAlice();
    await (await completed).finished();
    await page.evaluate(
      "new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))",
    );
    await expect(page.getByText("Alice private search evidence")).toHaveCount(0);
    await expect(search.getByText("Bob separate search evidence")).toBeVisible();
    await expect(query).toHaveValue("Bob query");
  });

  for (const width of [375, 1280]) {
    for (const syntax of ["plain", "source-only"]) {
      test(`reveals the exact ${syntax} Markdown match at ${width}px without reselecting edits`, async ({
        page,
      }, testInfo) => {
        const prefix = (
          syntax === "plain" ? "A saved paragraph.\n\n" : "<aside>Keep exact HTML.</aside>\n\n"
        ).repeat(80);
        const evidence = "Matched 🧭 evidence near the end.";
        const content = `${prefix}${evidence}\n\nTrailing context.`;
        const note = { ...serverNote, content };
        await serveNotes(page, [[note, `"${firstId}:1"`]]);
        await page.route("**/api/note-search", (route) =>
          route.fulfill({
            json: {
              candidates: [
                {
                  text: evidence,
                  score: 0.9,
                  source: {
                    kind: "markdown",
                    noteId: firstId,
                    version: `"${firstId}:1"`,
                    headingPath: [],
                    startOffset: prefix.length,
                    endOffset: prefix.length + evidence.length,
                  },
                },
              ],
              coverage: { ready: 1, pending: 0, failed: 0 },
            },
          }),
        );
        await page.setViewportSize({ width, height: 812 });
        await page.goto("/");
        const search = page.getByRole("region", { name: "Search notes" });
        await search.getByLabel("Search saved notes").fill("matched evidence");
        await search.getByLabel("Search saved notes").press("Enter");
        await search.getByRole("button", { name: "Open source", exact: true }).press("Enter");
        const source = page.getByRole("textbox", { name: "Markdown source", exact: true });
        if (syntax === "plain") {
          await expect(source).toHaveCount(0);
          const block = page.locator('[data-cited-block="true"]');
          await expect(block).toContainText(evidence);
          await expect(block).toBeFocused();
          await expect(block).toBeInViewport();
        } else {
          await expect(source).toBeFocused();
          await expect
            .poll(() =>
              source.evaluate((element: { selectionStart: number; selectionEnd: number }) => ({
                start: element.selectionStart,
                end: element.selectionEnd,
              })),
            )
            .toEqual({ start: prefix.length, end: prefix.length + evidence.length });
          expect(await source.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
          await expect(source).toBeInViewport();
        }
        await expect(page.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
        expect(
          await page.evaluate("document.documentElement.scrollWidth <= window.innerWidth"),
        ).toBe(true);
        await page.screenshot({
          path: testInfo.outputPath(`markdown-source-${syntax}-${width}.png`),
        });
        if (syntax === "plain") {
          await page
            .getByRole("textbox", { name: "Note content", exact: true })
            .fill("Locally rewritten evidence");
          await expect(page.locator('[data-cited-block="true"]')).toHaveCount(0);
        } else {
          await source.press("ArrowRight");
          await source.pressSequentially(" More context");
          await expect(source).toHaveValue(
            `${prefix}${evidence} More context\n\nTrailing context.`,
          );
        }
        await expect(page.locator("[data-cited-range]")).toHaveCount(0);
        await expect(page.getByRole("region", { name: "Opened source" })).toContainText(
          "unsaved changes",
        );
        await expect(page.getByRole("button", { name: "Save", exact: true })).toBeEnabled();
      });
    }
  }

  test("opens a matching block source, warns when the note revision changed, and reports missing blocks explicitly", async ({
    page,
  }) => {
    const firstBlockNote: Note = {
      ...serverNote,
      id: firstId,
      title: "Incident Overview",
      content: "First note overview",
    };
    let secondEtag = `"${secondId}:2"`;
    let secondBlockNote: Note = {
      ...serverNote,
      id: secondId,
      title: "Database Runbook",
      content: {
        format: "blocknote",
        schemaVersion: 1,
        blocks: [
          {
            id: "heading-storage",
            type: "heading",
            props: {
              backgroundColor: "default",
              textColor: "default",
              textAlignment: "left",
              level: 2,
            },
            content: [{ type: "text", text: "Storage Recovery", styles: {} }],
            children: [],
          },
          {
            id: "block-pgvector",
            type: "paragraph",
            props: {
              backgroundColor: "default",
              textColor: "default",
              textAlignment: "left",
            },
            content: [
              {
                type: "text",
                text: "Verify pgvector index coverage after failover.",
                styles: {},
              },
            ],
            children: [],
          },
        ],
      },
    };

    await page.route("**/api/notes", (route) =>
      route.fulfill({ json: { notes: [toListRow(firstBlockNote), toListRow(secondBlockNote)] } }),
    );
    await page.route(`**/api/notes/${firstId}`, (route) =>
      route.fulfill({ json: firstBlockNote, headers: { ETag: `"${firstId}:1"` } }),
    );
    await page.route(`**/api/notes/${secondId}`, (route) =>
      route.fulfill({ json: secondBlockNote, headers: { ETag: secondEtag } }),
    );
    await page.route("**/api/note-search", (route) =>
      route.fulfill({
        json: {
          candidates: [
            {
              text: "Verify pgvector index coverage after failover.",
              score: 0.94,
              source: {
                kind: "block",
                noteId: secondId,
                version: `"${secondId}:2"`,
                blockId: "block-pgvector",
                headingPath: ["Storage Recovery"],
              },
            },
          ],
          coverage: { ready: 2, pending: 0, failed: 0 },
        },
      }),
    );

    await page.goto("/");
    const searchRegion = page.getByRole("region", { name: "Search notes" });
    await searchRegion.getByLabel("Search saved notes").fill("pgvector failover");
    await searchRegion.getByRole("button", { name: "Search", exact: true }).click();

    await expect(searchRegion.getByText('Query: "pgvector failover"')).toBeVisible();
    await expect(searchRegion.getByText("Database Runbook")).toBeVisible();
    await expect(
      searchRegion.getByText("Storage Recovery - Block block-pgvector - Revision 2"),
    ).toBeVisible();
    await expect(
      searchRegion.getByText("Verify pgvector index coverage after failover."),
    ).toBeVisible();

    await searchRegion.getByRole("button", { name: "Open source", exact: true }).click();
    const openedSource = page.getByRole("region", { name: "Opened source" });
    await expect(openedSource).toContainText("Database Runbook");
    await expect(openedSource).toContainText("Revision 2");
    await expect(openedSource).toContainText("Block block-pgvector");
    await expect(
      page.locator('[data-node-type="blockContainer"][data-id="block-pgvector"]'),
    ).toHaveAttribute("data-cited-block", "true");

    await page
      .getByRole("textbox", { name: "Note content", exact: true })
      .fill("Locally replaced evidence");
    await expect(page.locator("[data-cited-block='true']")).toHaveCount(0);
    await expect(openedSource).toContainText("unsaved changes");

    secondEtag = `"${secondId}:3"`;
    await searchRegion.getByRole("button", { name: "Open source", exact: true }).click();
    await page.getByRole("button", { name: "Discard changes", exact: true }).click();
    await expect(openedSource).toContainText(
      "This note changed since Revision 2 (now Revision 3).",
    );

    secondEtag = `"${secondId}:4"`;
    secondBlockNote = {
      ...secondBlockNote,
      content: {
        format: "blocknote",
        schemaVersion: 1,
        blocks: [
          {
            id: "different-block",
            type: "paragraph",
            props: {
              backgroundColor: "default",
              textColor: "default",
              textAlignment: "left",
            },
            content: [{ type: "text", text: "Replacement paragraph only.", styles: {} }],
            children: [],
          },
        ],
      },
    };
    await searchRegion.getByRole("button", { name: "Open source", exact: true }).click();
    await expect(openedSource).toContainText(
      "Cited block block-pgvector from Revision 2 no longer exists in the current note (Revision 4).",
    );
    await expect(page.locator("[data-cited-block='true']")).toHaveCount(0);
  });

  test("preserves unsaved-edit safeguards, never applies stale Markdown UTF-16 ranges, and reports unavailable sources", async ({
    page,
  }) => {
    const markdownContent = "| Col |\n| --- |\n| UTF-16 exact evidence |";
    let secondMissing = false;
    let secondEtag = `"${secondId}:1"`;
    const firstNote: Note = { ...serverNote, id: firstId, title: "Draft Note", content: "Initial" };
    const legacyNote: Note = {
      ...serverNote,
      id: secondId,
      title: "Legacy Table Note",
      content: markdownContent,
    };

    await page.route("**/api/notes", (route) =>
      route.fulfill({ json: { notes: [toListRow(firstNote), toListRow(legacyNote)] } }),
    );
    await page.route(`**/api/notes/${firstId}`, (route) =>
      route.fulfill({ json: firstNote, headers: { ETag: `"${firstId}:1"` } }),
    );
    await page.route(`**/api/notes/${secondId}`, (route) => {
      if (secondMissing) {
        return route.fulfill({
          status: 404,
          json: { error: { code: "NOT_FOUND", message: "Missing" } },
        });
      }
      return route.fulfill({ json: legacyNote, headers: { ETag: secondEtag } });
    });
    await page.route("**/api/note-search", (route) =>
      route.fulfill({
        json: {
          candidates: [
            {
              text: "UTF-16 exact evidence",
              score: 0.89,
              source: {
                kind: "markdown",
                noteId: secondId,
                version: `"${secondId}:1"`,
                headingPath: [],
                startOffset: 18,
                endOffset: 39,
              },
            },
          ],
          coverage: { ready: 2, pending: 0, failed: 0 },
        },
      }),
    );

    await page.goto("/");
    const editor = page.getByRole("textbox", { name: /^(Markdown source|Note content)$/ });
    await expectEditorContent(editor, "Initial");
    await editor.fill("Unsaved local edit");

    const searchRegion = page.getByRole("region", { name: "Search notes" });
    await searchRegion.getByLabel("Search saved notes").fill("UTF-16");
    await searchRegion.getByRole("button", { name: "Search", exact: true }).click();

    secondEtag = `"${secondId}:2"`;
    await searchRegion.getByRole("button", { name: "Open source", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Discard unsaved changes?", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Keep editing", exact: true }).click();
    await expectEditorContent(editor, "Unsaved local edit");

    await searchRegion.getByRole("button", { name: "Open source", exact: true }).click();
    await page.getByRole("button", { name: "Discard changes", exact: true }).click();

    const openedSource = page.getByRole("region", { name: "Opened source" });
    await expect(openedSource).toContainText(
      "Legacy Markdown UTF-16 range 18-39 cannot be applied to the modified note.",
    );
    await expect(page.locator("[data-cited-range]")).toHaveCount(0);

    secondMissing = true;
    await searchRegion.getByRole("button", { name: "Open source", exact: true }).click();
    await expect(openedSource).toContainText("This source note is no longer available.");
  });

  test("distinguishes no-match, index-updating, index-failed, and request failure with retry and race protection", async ({
    page,
  }) => {
    await serveNotes(page, [[serverNote, '"v1"']]);

    let mode: "updating" | "index-failed" | "request-error" | "no-match" | "race" = "updating";
    let resolveSlowQuery!: () => void;
    const slowQueryGate = new Promise<void>((resolve) => {
      resolveSlowQuery = resolve;
    });

    await page.route("**/api/note-search", async (route) => {
      const body = route.request().postDataJSON() as { query: string };
      if (mode === "updating") {
        return route.fulfill({
          json: {
            candidates: [],
            coverage: { ready: 0, pending: 2, failed: 0 },
          },
        });
      }
      if (mode === "index-failed") {
        return route.fulfill({
          json: {
            candidates: [],
            coverage: { ready: 1, pending: 0, failed: 1 },
          },
        });
      }
      if (mode === "request-error") {
        return route.fulfill({
          status: 503,
          json: {
            error: {
              code: "SERVICE_UNAVAILABLE",
              message: "Search temporarily unavailable",
            },
          },
        });
      }
      if (mode === "no-match") {
        return route.fulfill({
          json: {
            candidates: [],
            coverage: { ready: 2, pending: 0, failed: 0 },
          },
        });
      }
      if (body.query === "older query") {
        await slowQueryGate;
        return route.fulfill({
          json: {
            candidates: [
              {
                text: "Stale older query passage that must never replace newer results.",
                score: 0.95,
                source: {
                  kind: "block",
                  noteId: firstId,
                  version: '"v1"',
                  blockId: "old-block",
                  headingPath: [],
                },
              },
            ],
            coverage: { ready: 1, pending: 0, failed: 0 },
          },
        });
      }
      return route.fulfill({
        json: {
          candidates: [
            {
              text: "Current query passage wins over older in-flight response.",
              score: 0.91,
              source: {
                kind: "block",
                noteId: firstId,
                version: '"v1"',
                blockId: "current-block",
                headingPath: [],
              },
            },
          ],
          coverage: { ready: 1, pending: 0, failed: 0 },
        },
      });
    });

    await page.goto("/");
    const searchRegion = page.getByRole("region", { name: "Search notes" });
    const searchInput = searchRegion.getByLabel("Search saved notes");

    await searchInput.fill("preserved query");
    await searchRegion.getByRole("button", { name: "Search", exact: true }).click();
    await expect(
      searchRegion.getByText("Search index is still updating (2 notes pending)."),
    ).toBeVisible();
    await expect(searchInput).toHaveValue("preserved query");

    mode = "index-failed";
    await searchRegion.getByRole("button", { name: "Retry search", exact: true }).click();
    await expect(searchRegion.getByText(/Search index failed for 1 note/)).toBeVisible();
    await expect(searchInput).toHaveValue("preserved query");

    mode = "request-error";
    await searchRegion.getByRole("button", { name: "Retry search", exact: true }).click();
    await expect(searchRegion.getByRole("alert")).toContainText(
      "Search could not be completed. Your query is preserved so you can retry.",
    );
    await expect(searchInput).toHaveValue("preserved query");

    mode = "no-match";
    await searchRegion.getByRole("button", { name: "Retry search", exact: true }).click();
    await expect(searchRegion.getByText('No saved notes matched "preserved query".')).toBeVisible();

    mode = "race";
    await searchInput.fill("older query");
    await searchRegion.getByRole("button", { name: "Search", exact: true }).click();
    await searchInput.fill("newer query");
    await searchRegion.getByRole("button", { name: "Search", exact: true }).click();
    await expect(
      searchRegion.getByText("Current query passage wins over older in-flight response."),
    ).toBeVisible();
    const oldResponse = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/note-search") &&
        response.request().postDataJSON().query === "older query",
    );
    resolveSlowQuery();
    await (await oldResponse).finished();
    await page.evaluate(
      "new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))",
    );
    await expect(
      searchRegion.getByText("Current query passage wins over older in-flight response."),
    ).toBeVisible();
    await expect(
      searchRegion.getByText("Stale older query passage that must never replace newer results."),
    ).toHaveCount(0);
  });
});

test.describe("saved conversations and chat history", () => {
  const convOneId = "ca100001-1234-4000-8000-000000000001";
  const convTwoId = "ca100001-1234-4000-8000-000000000002";
  const convOlderId = "ca100001-1234-4000-8000-000000000003";
  const deletedNoteId = "fa100001-1234-4000-8000-000000000099";

  /** Mirrors the label ChatWorkspace renders, so list controls are selected by role name. */
  function conversationLabel(id: string, createdAt: string) {
    return formatConversationLabel({ id, queuePaused: false, createdAt, updatedAt: createdAt });
  }

  const convOneLabel = conversationLabel(convOneId, "2026-10-28T10:00:00.000Z");
  const convTwoLabel = conversationLabel(convTwoId, "2026-10-28T09:00:00.000Z");
  const convOlderLabel = conversationLabel(convOlderId, "2026-10-27T08:00:00.000Z");

  /** Anchors the label so the row's "Delete ..." control cannot also match. */
  function conversationName(label: string) {
    return new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`);
  }

  test("loads bounded conversation list, reopens persisted history, cites sources, and preserves deleted-source, incomplete-answer, and paused-queue states", async ({
    page,
  }) => {
    const richNote: Note = {
      id: firstId,
      title: "Architecture Runbook",
      content: {
        format: "blocknote",
        schemaVersion: 1,
        blocks: [
          {
            id: "heading-1",
            type: "heading",
            props: {
              backgroundColor: "default",
              textColor: "default",
              textAlignment: "left",
              level: 2,
            },
            content: [{ type: "text", text: "Storage Guarantees", styles: {} }],
            children: [],
          },
          {
            id: "cited-block",
            type: "paragraph",
            props: {
              backgroundColor: "default",
              textColor: "default",
              textAlignment: "left",
            },
            content: [
              {
                type: "text",
                text: "All conversation turns persist in PostgreSQL with revision-bound citations.",
                styles: {},
              },
            ],
            children: [],
          },
        ],
      },
      createdAt: "2026-10-28T09:00:00.000Z",
      updatedAt: "2026-10-28T09:00:00.000Z",
    };

    await serveNotes(page, [[richNote, '"1"']]);

    let listMode: "fail" | "ready" = "fail";
    let resumeCalls = 0;
    let queuePaused = true;

    await page.route(
      (url) => url.pathname.startsWith("/api/conversations"),
      async (route) => {
        const url = new URL(route.request().url());
        if (url.pathname === "/api/conversations" && route.request().method() === "GET") {
          expect(url.searchParams.get("limit")).toBe("50");
          if (listMode === "fail") {
            return route.fulfill({
              status: 503,
              json: { error: { code: "UNAVAILABLE", message: "Database unavailable" } },
            });
          }
          if (url.searchParams.get("cursor") === "cursor_page_2") {
            return route.fulfill({
              json: {
                conversations: [
                  {
                    id: convOlderId,
                    queuePaused: false,
                    createdAt: "2026-10-27T08:00:00.000Z",
                    updatedAt: "2026-10-27T08:05:00.000Z",
                  },
                ],
                nextCursor: null,
              },
            });
          }
          return route.fulfill({
            json: {
              conversations: [
                {
                  id: convOneId,
                  queuePaused,
                  createdAt: "2026-10-28T10:00:00.000Z",
                  updatedAt: "2026-10-28T10:05:00.000Z",
                },
              ],
              nextCursor: "cursor_page_2",
            },
          });
        }

        if (
          url.pathname === `/api/conversations/${convOneId}` &&
          route.request().method() === "GET"
        ) {
          return route.fulfill({
            json: {
              conversation: {
                id: convOneId,
                queuePaused,
                createdAt: "2026-10-28T10:00:00.000Z",
                updatedAt: "2026-10-28T10:05:00.000Z",
              },
              activeTurn: null,
              recovery: queuePaused
                ? {
                    turnId: "ca200001-1234-4000-8000-000000000004",
                    reason: "history_unavailable",
                  }
                : null,
            },
          });
        }

        if (
          url.pathname === `/api/conversations/${convOneId}/messages` &&
          route.request().method() === "GET"
        ) {
          return route.fulfill({
            json: {
              messages: [
                {
                  id: "ca200001-1234-4000-8000-000000000001",
                  sequence: 1,
                  role: "user",
                  text: "How are conversation citations stored?",
                  deliveryPolicy: "queue",
                  createdAt: "2026-10-28T10:00:00.000Z",
                },
                {
                  id: "ca200001-1234-4000-8000-000000000002",
                  sequence: 2,
                  role: "assistant",
                  turnId: "ca300001-1234-4000-8000-000000000001",
                  text: "Turns persist in PostgreSQL with revision-bound citations.",
                  status: "completed",
                  reason: null,
                  inputIds: ["ca200001-1234-4000-8000-000000000001"],
                  citations: [
                    {
                      source: {
                        kind: "block",
                        noteId: firstId,
                        version: '"1"',
                        blockId: "cited-block",
                        headingPath: ["Storage Guarantees"],
                      },
                      excerpt:
                        "All conversation turns persist in PostgreSQL with revision-bound citations.",
                      stale: false,
                      deleted: false,
                    },
                    {
                      source: {
                        kind: "block",
                        noteId: deletedNoteId,
                        version: '"1"',
                        blockId: "deleted-block",
                        headingPath: ["Legacy Appendix"],
                      },
                      excerpt: null,
                      stale: false,
                      deleted: true,
                    },
                  ],
                  createdAt: "2026-10-28T10:01:00.000Z",
                },
                {
                  id: "ca200001-1234-4000-8000-000000000003",
                  sequence: 3,
                  role: "assistant",
                  turnId: "ca300001-1234-4000-8000-000000000002",
                  text: "Partial cancelled draft that was stopped early.",
                  status: "incomplete",
                  reason: "cancelled",
                  inputIds: ["ca200001-1234-4000-8000-000000000001"],
                  citations: [],
                  createdAt: "2026-10-28T10:02:00.000Z",
                },
                {
                  id: "ca200001-1234-4000-8000-000000000004",
                  sequence: 4,
                  role: "assistant",
                  turnId: "ca300001-1234-4000-8000-000000000003",
                  text: "",
                  status: "incomplete",
                  reason: "failed",
                  inputIds: ["ca200001-1234-4000-8000-000000000001"],
                  citations: [],
                  createdAt: "2026-10-28T10:03:00.000Z",
                },
                {
                  id: "ca200001-1234-4000-8000-000000000005",
                  sequence: 5,
                  role: "user",
                  text: "Pending follow-up question while queue is paused",
                  deliveryPolicy: "queue",
                  createdAt: "2026-10-28T10:04:00.000Z",
                },
              ],
              nextCursor: null,
            },
          });
        }

        if (
          url.pathname === `/api/conversations/${convOneId}/resume` &&
          route.request().method() === "POST"
        ) {
          resumeCalls += 1;
          queuePaused = false;
          return route.fulfill({
            json: {
              conversation: {
                id: convOneId,
                queuePaused: false,
                createdAt: "2026-10-28T10:00:00.000Z",
                updatedAt: "2026-10-28T10:06:00.000Z",
              },
              activeTurn: null,
              recovery: null,
            },
          });
        }

        return route.fallback();
      },
    );

    await page.goto("/");
    const chatRegion = page.getByRole("region", { name: "Chat workspace" });
    await expect(chatRegion.getByRole("alert")).toContainText(
      "Could not load saved conversations. Check your connection and try again.",
    );

    listMode = "ready";
    await chatRegion
      .getByRole("button", { name: "Retry loading conversations", exact: true })
      .click();
    await expect(
      chatRegion.getByRole("button", { name: conversationName(convOneLabel) }),
    ).toBeVisible();

    await chatRegion.getByRole("button", { name: "Load older conversations", exact: true }).click();
    await expect(
      chatRegion.getByRole("button", { name: conversationName(convOlderLabel) }),
    ).toBeVisible();

    await chatRegion.getByRole("button", { name: conversationName(convOneLabel) }).click();
    await expect(
      chatRegion.getByText("Turns persist in PostgreSQL with revision-bound citations.", {
        exact: true,
      }),
    ).toBeVisible();
    expect(resumeCalls).toBe(0);

    await expect(chatRegion.getByText("Supported answer")).toBeVisible();
    await expect(chatRegion.getByText("Incomplete (cancelled)")).toBeVisible();
    await expect(chatRegion.getByText("Incomplete (failed)")).toBeVisible();
    await expect(chatRegion.getByText("Deleted source")).toBeVisible();
    await expect(
      chatRegion.getByText("Source note was deleted; stored excerpt was removed."),
    ).toBeVisible();

    // Toggle full-screen and sidebar chat without losing conversation state or unsent input.
    const messageInput = chatRegion.getByRole("textbox", { name: "Message", exact: true });
    await messageInput.fill("Draft question kept across layout toggle");
    await chatRegion.getByRole("button", { name: "Full screen chat", exact: true }).click();
    await expect(chatRegion).toHaveAttribute("data-chat-presentation", "fullscreen");
    await expect(messageInput).toHaveValue("Draft question kept across layout toggle");
    await chatRegion.getByRole("button", { name: "Sidebar chat", exact: true }).click();
    await expect(chatRegion).toHaveAttribute("data-chat-presentation", "sidebar");
    await expect(messageInput).toHaveValue("Draft question kept across layout toggle");
    await messageInput.fill("");

    // Open live citation source and verify cited block is highlighted and visible.
    const openSourceButtons = chatRegion.getByRole("button", { name: "Open source", exact: true });
    await openSourceButtons.first().click();
    const citedBlock = page.locator('[data-node-type="blockContainer"][data-id="cited-block"]');
    await expect(citedBlock).toHaveAttribute("data-cited-block", "true");
    await expect(citedBlock).toBeInViewport();

    // Open deleted citation source and verify deleted source panel is shown.
    await openSourceButtons.nth(1).click();
    const openedSource = page.getByRole("region", { name: "Opened source" });
    await expect(openedSource.getByText("This cited note was deleted")).toBeVisible();

    // Explicit Resume queue action resumes the paused queue.
    await chatRegion.getByRole("button", { name: "Resume queue", exact: true }).click();
    expect(resumeCalls).toBe(1);
    await expect(chatRegion.getByRole("button", { name: "Resume queue", exact: true })).toHaveCount(
      0,
    );
  });

  test("loads the newest page when a running answer completes in a long conversation", async ({
    page,
  }) => {
    await serveNotes(page, [[serverNote]]);

    const history = Array.from({ length: 50 }, (_, index) => ({
      id: `ca200001-1234-4000-8000-${String(index + 1).padStart(12, "0")}`,
      sequence: index + 1,
      role: "user" as const,
      text: `Question ${index + 1}`,
      deliveryPolicy: "queue" as const,
      createdAt: "2026-10-28T10:00:00.000Z",
    }));
    const answer = {
      id: "ca200001-1234-4000-8000-000000000051",
      sequence: 51,
      role: "assistant" as const,
      turnId: "ca300001-1234-4000-8000-000000000051",
      text: "Final grounded answer.",
      status: "completed" as const,
      reason: null,
      inputIds: [history[0].id],
      citations: [],
      createdAt: "2026-10-28T10:06:00.000Z",
    };
    let turnRunning = true;

    await page.route(
      (url) => url.pathname.startsWith("/api/conversations"),
      async (route) => {
        const url = new URL(route.request().url());
        if (url.pathname === "/api/conversations" && route.request().method() === "GET") {
          return route.fulfill({
            json: {
              conversations: [
                {
                  id: convOneId,
                  queuePaused: false,
                  createdAt: "2026-10-28T10:00:00.000Z",
                  updatedAt: "2026-10-28T10:05:00.000Z",
                },
              ],
              nextCursor: null,
            },
          });
        }
        if (
          url.pathname === `/api/conversations/${convOneId}` &&
          route.request().method() === "GET"
        ) {
          return route.fulfill({
            json: {
              conversation: {
                id: convOneId,
                queuePaused: false,
                createdAt: "2026-10-28T10:00:00.000Z",
                updatedAt: "2026-10-28T10:05:00.000Z",
              },
              activeTurn: turnRunning
                ? {
                    id: "ca300001-1234-4000-8000-000000000051",
                    status: "running",
                    text: "Searching notes and preparing a grounded answer...",
                    checkpointVersion: 1,
                    inputIds: [history[0].id],
                  }
                : null,
              recovery: null,
            },
          });
        }
        if (
          url.pathname === `/api/conversations/${convOneId}/messages` &&
          route.request().method() === "GET"
        ) {
          const cursor = url.searchParams.get("cursor");
          if (cursor === "50") {
            return route.fulfill({ json: { messages: [answer], nextCursor: null } });
          }
          return route.fulfill({ json: { messages: history, nextCursor: "50" } });
        }
        return route.fallback();
      },
    );

    await page.goto("/");
    const chatRegion = page.getByRole("region", { name: "Chat workspace" });
    await chatRegion.getByRole("button", { name: conversationName(convOneLabel) }).click();
    await expect(chatRegion.getByText("Question 50")).toBeVisible();
    await expect(
      chatRegion.getByRole("button", { name: "Load more messages", exact: true }),
    ).toBeVisible();
    await expect(
      chatRegion.getByRole("button", { name: "Stop answer", exact: true }),
    ).toBeVisible();

    // The answer is published after the first page, so the terminal refresh has to
    // page forward past the loaded history before it can display it.
    turnRunning = false;
    await expect(chatRegion.getByText("Final grounded answer.")).toBeVisible({ timeout: 10_000 });
    await expect(chatRegion.getByRole("button", { name: "Stop answer", exact: true })).toHaveCount(
      0,
    );
    await expect(
      chatRegion.getByRole("button", { name: "Load more messages", exact: true }),
    ).toHaveCount(0);
  });

  test("protects unsent messages when switching conversations and prevents stale or missing reads from displaying cached messages", async ({
    page,
  }) => {
    await serveNotes(page, [[serverNote]]);

    let resolveSlowFirstRead: () => void = () => {};
    let markSlowFirstStarted: () => void = () => {};
    let slowFirstMode = false;
    let missingSecondMode = false;

    await page.route(
      (url) => url.pathname.startsWith("/api/conversations"),
      async (route) => {
        const url = new URL(route.request().url());
        if (url.pathname === "/api/conversations" && route.request().method() === "GET") {
          return route.fulfill({
            json: {
              conversations: [
                {
                  id: convOneId,
                  queuePaused: false,
                  createdAt: "2026-10-28T10:00:00.000Z",
                  updatedAt: "2026-10-28T10:05:00.000Z",
                },
                {
                  id: convTwoId,
                  queuePaused: false,
                  createdAt: "2026-10-28T09:00:00.000Z",
                  updatedAt: "2026-10-28T09:05:00.000Z",
                },
              ],
              nextCursor: null,
            },
          });
        }

        if (
          url.pathname === `/api/conversations/${convOneId}` &&
          route.request().method() === "GET"
        ) {
          if (slowFirstMode) {
            const gate = new Promise<void>((resolve) => {
              resolveSlowFirstRead = resolve;
            });
            markSlowFirstStarted();
            await gate;
          }
          return route.fulfill({
            json: {
              conversation: {
                id: convOneId,
                queuePaused: false,
                createdAt: "2026-10-28T10:00:00.000Z",
                updatedAt: "2026-10-28T10:05:00.000Z",
              },
              activeTurn: null,
              recovery: null,
            },
          });
        }

        if (
          url.pathname === `/api/conversations/${convOneId}/messages` &&
          route.request().method() === "GET"
        ) {
          return route.fulfill({
            json: {
              messages: [
                {
                  id: "ca200001-1234-4000-8000-000000000011",
                  sequence: 1,
                  role: "user",
                  text: "Unique message from First thread",
                  deliveryPolicy: "queue",
                  createdAt: "2026-10-28T10:00:00.000Z",
                },
              ],
              nextCursor: null,
            },
          });
        }

        if (
          url.pathname === `/api/conversations/${convTwoId}` &&
          route.request().method() === "GET"
        ) {
          if (missingSecondMode) {
            return route.fulfill({
              status: 404,
              json: { error: { code: "NOT_FOUND", message: "Conversation not found" } },
            });
          }
          return route.fulfill({
            json: {
              conversation: {
                id: convTwoId,
                queuePaused: false,
                createdAt: "2026-10-28T09:00:00.000Z",
                updatedAt: "2026-10-28T09:05:00.000Z",
              },
              activeTurn: null,
              recovery: null,
            },
          });
        }

        if (
          url.pathname === `/api/conversations/${convTwoId}/messages` &&
          route.request().method() === "GET"
        ) {
          if (missingSecondMode) {
            return route.fulfill({
              status: 404,
              json: { error: { code: "NOT_FOUND", message: "Conversation not found" } },
            });
          }
          return route.fulfill({
            json: {
              messages: [
                {
                  id: "ca200001-1234-4000-8000-000000000022",
                  sequence: 1,
                  role: "user",
                  text: "Unique message from Second thread",
                  deliveryPolicy: "queue",
                  createdAt: "2026-10-28T09:00:00.000Z",
                },
              ],
              nextCursor: null,
            },
          });
        }

        return route.fallback();
      },
    );

    await page.goto("/");
    const chatRegion = page.getByRole("region", { name: "Chat workspace" });
    await chatRegion.getByRole("button", { name: conversationName(convOneLabel) }).click();
    await expect(chatRegion.getByText("Unique message from First thread")).toBeVisible();

    // Type an unsent message and attempt to switch to Second thread.
    const messageInput = chatRegion.getByRole("textbox", { name: "Message", exact: true });
    await messageInput.fill("Unsent draft for First thread");
    await chatRegion.getByRole("button", { name: conversationName(convTwoLabel) }).click();

    const discardDialog = page.getByRole("alertdialog", { name: "Discard unsent message?" });
    await expect(discardDialog).toBeVisible();
    await discardDialog.getByRole("button", { name: "Keep message", exact: true }).click();
    await expect(messageInput).toHaveValue("Unsent draft for First thread");
    await expect(chatRegion.getByText("Unique message from First thread")).toBeVisible();

    // Explicitly discard unsent message to switch to Second thread.
    await chatRegion.getByRole("button", { name: conversationName(convTwoLabel) }).click();
    await discardDialog.getByRole("button", { name: "Discard message", exact: true }).click();
    await expect(messageInput).toHaveValue("");
    await expect(chatRegion.getByText("Unique message from Second thread")).toBeVisible();
    await expect(chatRegion.getByText("Unique message from First thread")).toHaveCount(0);

    // A slow read keeps the workspace busy: no other conversation can be selected
    // while it is pending, so its late response cannot replace a newer selection.
    slowFirstMode = true;
    const slowFirstStarted = new Promise<void>((resolve) => {
      markSlowFirstStarted = resolve;
    });
    await chatRegion.getByRole("button", { name: conversationName(convOneLabel) }).click();
    await slowFirstStarted;
    await expect(
      chatRegion.getByRole("button", { name: conversationName(convTwoLabel) }),
    ).toBeDisabled();
    resolveSlowFirstRead();
    await expect(chatRegion.getByText("Unique message from First thread")).toBeVisible();
    slowFirstMode = false;

    // Now make Second thread missing (404) and click it: First thread's messages must clear immediately.
    missingSecondMode = true;
    await chatRegion.getByRole("button", { name: conversationName(convTwoLabel) }).click();
    await expect(chatRegion.getByRole("alert")).toContainText(
      "This conversation is no longer available.",
    );
    await expect(chatRegion.getByText("Unique message from First thread")).toHaveCount(0);
    await expect(
      chatRegion.getByRole("button", { name: conversationName(convTwoLabel) }),
    ).toHaveCount(0);
  });

  test("confirms conversation deletion, retains failed deletions for retry, fences active conversation deletion, and clears private history on account switch", async ({
    page,
  }) => {
    await serveNotes(page, [[serverNote]]);

    let currentSessionUser = browserUser;
    let failDeleteOnce = true;
    let deletedIds = new Set<string>();
    let holdAliceDetail = false;
    let releaseAliceDetail: () => void = () => {};
    let markAliceDetailStarted: () => void = () => {};

    await page.route("**/api/auth/session", (route) =>
      route.fulfill({ json: { user: currentSessionUser } }),
    );

    await page.route(
      (url) => url.pathname.startsWith("/api/conversations"),
      async (route) => {
        const url = new URL(route.request().url());
        if (url.pathname === "/api/conversations" && route.request().method() === "GET") {
          if (currentSessionUser.id !== "user_alice") {
            return route.fulfill({ json: { conversations: [], nextCursor: null } });
          }
          const all = [
            {
              id: convOneId,
              queuePaused: false,
              createdAt: "2026-10-28T10:00:00.000Z",
              updatedAt: "2026-10-28T10:05:00.000Z",
            },
            {
              id: convTwoId,
              queuePaused: false,
              createdAt: "2026-10-28T09:00:00.000Z",
              updatedAt: "2026-10-28T09:05:00.000Z",
            },
          ].filter((item) => !deletedIds.has(item.id));
          return route.fulfill({ json: { conversations: all, nextCursor: null } });
        }

        if (
          url.pathname === `/api/conversations/${convTwoId}` &&
          route.request().method() === "GET"
        ) {
          return route.fulfill({
            json: {
              conversation: {
                id: convTwoId,
                queuePaused: false,
                createdAt: "2026-10-28T09:00:00.000Z",
                updatedAt: "2026-10-28T09:05:00.000Z",
              },
              activeTurn: null,
              recovery: null,
            },
          });
        }

        if (
          url.pathname === `/api/conversations/${convTwoId}/messages` &&
          route.request().method() === "GET"
        ) {
          return route.fulfill({
            json: {
              messages: [
                {
                  id: "ca200001-1234-4000-8000-000000000099",
                  sequence: 1,
                  role: "user",
                  text: "Message inside Thread to delete",
                  deliveryPolicy: "queue",
                  createdAt: "2026-10-28T09:00:00.000Z",
                },
              ],
              nextCursor: null,
            },
          });
        }

        if (
          url.pathname === `/api/conversations/${convTwoId}` &&
          route.request().method() === "DELETE"
        ) {
          if (failDeleteOnce) {
            failDeleteOnce = false;
            return route.fulfill({
              status: 503,
              json: { error: { code: "UNAVAILABLE", message: "Delete failed" } },
            });
          }
          deletedIds.add(convTwoId);
          return route.fulfill({ status: 204 });
        }

        if (
          url.pathname === `/api/conversations/${convOneId}` &&
          route.request().method() === "GET"
        ) {
          if (holdAliceDetail) {
            holdAliceDetail = false;
            const gate = new Promise<void>((resolve) => {
              releaseAliceDetail = resolve;
            });
            markAliceDetailStarted();
            await gate;
          }
          return route.fulfill({
            json: {
              conversation: {
                id: convOneId,
                queuePaused: false,
                createdAt: "2026-10-28T10:00:00.000Z",
                updatedAt: "2026-10-28T10:05:00.000Z",
              },
              activeTurn: null,
              recovery: null,
            },
          });
        }

        if (
          url.pathname === `/api/conversations/${convOneId}/messages` &&
          route.request().method() === "GET"
        ) {
          return route.fulfill({
            json: {
              messages: [
                {
                  id: "ca200001-1234-4000-8000-000000000088",
                  sequence: 1,
                  role: "user",
                  text: "Secret Alice message",
                  deliveryPolicy: "queue",
                  createdAt: "2026-10-28T10:00:00.000Z",
                },
              ],
              nextCursor: null,
            },
          });
        }

        return route.fallback();
      },
    );

    await page.goto("/");
    const chatRegion = page.getByRole("region", { name: "Chat workspace" });
    await chatRegion.getByRole("button", { name: conversationName(convTwoLabel) }).click();
    await expect(chatRegion.getByText("Message inside Thread to delete")).toBeVisible();

    // Open delete confirmation and cancel first.
    await chatRegion.getByRole("button", { name: `Delete ${convTwoLabel}` }).click();
    const deleteDialog = page.getByRole("alertdialog", { name: "Delete conversation?" });
    await expect(deleteDialog).toBeVisible();
    await deleteDialog.getByRole("button", { name: "Keep conversation", exact: true }).click();
    await expect(
      chatRegion.getByRole("button", { name: conversationName(convTwoLabel) }),
    ).toBeVisible();

    // Confirm deletion; first attempt fails with 503, retaining the item and exposing Retry delete.
    await chatRegion.getByRole("button", { name: `Delete ${convTwoLabel}` }).click();
    await deleteDialog.getByRole("button", { name: "Delete permanently", exact: true }).click();
    await expect(chatRegion.getByRole("alert")).toContainText(
      "Could not delete conversation. The conversation was retained so you can retry.",
    );
    await expect(
      chatRegion.getByRole("button", { name: conversationName(convTwoLabel) }),
    ).toBeVisible();
    await expect(chatRegion.getByText("Message inside Thread to delete")).toBeVisible();

    // Retry delete succeeds (204) and clears the active conversation view.
    await chatRegion.getByRole("button", { name: "Retry delete", exact: true }).click();
    await expect(chatRegion.getByText("Conversation deleted.")).toBeVisible();
    await expect(
      chatRegion.getByRole("button", { name: conversationName(convTwoLabel) }),
    ).toHaveCount(0);
    await expect(chatRegion.getByText("Message inside Thread to delete")).toHaveCount(0);

    // Start a slow read of Alice's thread, then switch accounts while the read is held.
    // Wait for the intercepted request so the gate is armed before the account changes.
    holdAliceDetail = true;
    const aliceDetailStarted = new Promise<void>((resolve) => {
      markAliceDetailStarted = resolve;
    });
    await chatRegion.getByRole("button", { name: conversationName(convOneLabel) }).click();
    await aliceDetailStarted;
    currentSessionUser = {
      id: "user_bob",
      email: "bob@example.test",
      firstName: "Bob",
      lastName: null,
    };
    await page.evaluate("window.dispatchEvent(new Event('focus'))");
    await expect(page.getByText("Signed in as bob@example.test")).toBeVisible();
    releaseAliceDetail();
    await page.evaluate(
      "new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))",
    );
    await expect(
      chatRegion.getByText(
        "No saved conversations yet. Start a new conversation to ask about your notes.",
      ),
    ).toBeVisible();
    await expect(chatRegion.getByText("Secret Alice message")).toHaveCount(0);
    await expect(
      chatRegion.getByRole("button", { name: conversationName(convOneLabel) }),
    ).toHaveCount(0);
  });
});
