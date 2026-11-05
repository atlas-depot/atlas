import { expect, test, type Page } from "@playwright/test";
import { noteContentSchema, type Note } from "../shared/notes.ts";
import { noteDraftSchema, type NoteDraft } from "../shared/drafts.ts";
import { blockNoteDocumentSchema } from "../shared/document.ts";
import { expectEditorContent } from "./notes-editor.ts";

const sourceId = "00000000-0000-4000-8000-000000000001";
const runId = "00000000-0000-4000-8000-000000000002";
const draftId = "00000000-0000-4000-8000-000000000003";
const savedId = "00000000-0000-4000-8000-000000000004";
const date = "2026-11-05T12:00:00.000Z";

/** Intercepted HTTP state machine; real API/storage coverage lives in notes-organize-api. */
async function fixture(page: Page) {
  let source: Note = {
    id: sourceId,
    title: "Original",
    content: "Original note",
    createdAt: date,
    updatedAt: date,
  };
  let sourceRevision = 1;
  let draftRevision = 1;
  let storedDraft: NoteDraft | null = null;
  let saved: Note | null = null;
  let run = false;
  let failGeneration = false;
  let failSourceSave = false;
  let conflictDraftSave = false;
  let loseFinalSave = false;
  let loseDraftSave = false;
  let loseDiscard = false;
  let loseHandoff = false;
  let conflictFinalSave = false;
  const starts: string[] = [];
  const sourceWrites: unknown[] = [];
  let handoffs = 0;
  let saves = 0;
  const makeDraft = () =>
    noteDraftSchema.parse({
      id: draftId,
      title: "Organized note",
      content: "Generated note",
      etag: `"draft-${draftRevision}"`,
      source: { noteId: sourceId, revision: sourceRevision, stale: false, deleted: false },
      sources: [{ id: "ref-1", title: "Reference", url: "https://example.com/reference" }],
      expiresAt: "2099-11-06T12:00:00.000Z",
      updatedAt: date,
    });
  await page.route("**/api/auth/session", (route) =>
    route.fulfill({
      json: {
        user: { id: "user_alice", email: "alice@example.test", firstName: "Alice", lastName: null },
      },
    }),
  );
  await page.route("**/api/notes", (route) =>
    route.fulfill({ json: { notes: [source, ...(saved ? [saved] : [])] } }),
  );
  await page.route(`**/api/notes/${sourceId}`, (route) => {
    if (route.request().method() === "PUT") {
      sourceWrites.push(route.request().postDataJSON());
      if (failSourceSave)
        return route.fulfill({
          status: 412,
          json: { error: { code: "PRECONDITION_FAILED", message: "Changed" } },
        });
      source = { ...source, ...noteContentSchema.parse(route.request().postDataJSON()) };
      sourceRevision++;
    }
    return route.fulfill({ json: source, headers: { ETag: `"source-${sourceRevision}"` } });
  });
  await page.route("**/api/organize-work", (route) =>
    route.fulfill({
      json: {
        runs: run ? [{ runId, noteId: sourceId }] : [],
        drafts: storedDraft ? [storedDraft] : [],
      },
    }),
  );
  await page.route(`**/api/notes/${sourceId}/organize`, (route) => {
    starts.push(route.request().headers()["if-match"]);
    run = true;
    return route.fulfill({ status: 202, json: { runId, status: "accepted" } });
  });
  await page.route(`**/api/organize-runs/${runId}`, (route) =>
    route.fulfill({
      json: failGeneration
        ? { runId, status: "failed", reason: "generation_failed" }
        : {
            runId,
            status: "draft",
            draft: { markdown: "Generated note", sources: [] },
            source: { noteId: sourceId, revision: sourceRevision, stale: false },
          },
    }),
  );
  await page.route(`**/api/organize-runs/${runId}/handoff`, (route) => {
    handoffs++;
    run = false;
    storedDraft ??= makeDraft();
    if (loseHandoff) {
      loseHandoff = false;
      return route.abort("failed");
    }
    return route.fulfill({ json: storedDraft, headers: { ETag: storedDraft.etag } });
  });
  await page.route(`**/api/note-drafts/${draftId}`, (route) => {
    if (!storedDraft)
      return route.fulfill({
        status: 404,
        json: { error: { code: "NOT_FOUND", message: "Missing" } },
      });
    if (route.request().method() === "DELETE") {
      storedDraft = null;
      if (loseDiscard) {
        loseDiscard = false;
        return route.abort("failed");
      }
      return route.fulfill({ status: 204 });
    }
    if (route.request().method() === "PUT") {
      if (conflictDraftSave)
        return route.fulfill({
          status: 412,
          json: { error: { code: "PRECONDITION_FAILED", message: "Changed" } },
        });
      storedDraft = {
        ...storedDraft,
        ...noteContentSchema.parse(route.request().postDataJSON()),
        etag: `"draft-${++draftRevision}"`,
      };
      if (loseDraftSave) {
        loseDraftSave = false;
        return route.abort("failed");
      }
    }
    return route.fulfill({ json: storedDraft, headers: { ETag: storedDraft.etag } });
  });
  await page.route(`**/api/note-drafts/${draftId}/save`, async (route) => {
    saves++;
    if (conflictFinalSave) {
      conflictFinalSave = false;
      if (storedDraft)
        storedDraft = {
          ...storedDraft,
          title: "Other tab draft",
          etag: `"draft-${++draftRevision}"`,
        };
      return route.fulfill({
        status: 412,
        json: { error: { code: "PRECONDITION_FAILED", message: "Changed" } },
      });
    }
    if (storedDraft && route.request().headers()["if-match"] !== storedDraft.etag) {
      return route.fulfill({
        status: 412,
        json: { error: { code: "PRECONDITION_FAILED", message: "Stale revision" } },
      });
    }
    saved ??= {
      id: savedId,
      ...noteContentSchema.parse(route.request().postDataJSON()),
      createdAt: date,
      updatedAt: date,
      origin: { sourceNoteId: sourceId, sourceRevision, sources: storedDraft?.sources ?? [] },
    };
    storedDraft = null;
    if (loseFinalSave) {
      loseFinalSave = false;
      return route.abort("failed");
    }
    return route.fulfill({ status: 201, json: saved, headers: { ETag: '"saved-1"' } });
  });
  return {
    starts,
    sourceWrites,
    get source() {
      return source;
    },
    get draft() {
      return storedDraft;
    },
    get saved() {
      return saved;
    },
    get handoffs() {
      return handoffs;
    },
    get saves() {
      return saves;
    },
    failSourceSave() {
      failSourceSave = true;
    },
    failGeneration(value: boolean) {
      failGeneration = value;
    },
    conflictDraftSave() {
      conflictDraftSave = true;
    },
    loseDraftSave() {
      loseDraftSave = true;
    },
    loseDiscard() {
      loseDiscard = true;
    },
    loseHandoff() {
      loseHandoff = true;
    },
    conflictFinalSave() {
      conflictFinalSave = true;
    },
    loseFinalSave() {
      loseFinalSave = true;
    },
    resumeDraft(options: { deleted?: boolean; stale?: boolean } = {}) {
      storedDraft = makeDraft();
      storedDraft.source = { ...storedDraft.source, ...options };
    },
    resumeRun() {
      run = true;
    },
  };
}
const panel = (page: Page) => page.getByRole("region", { name: "AI draft", exact: true });
const draftEditor = (page: Page) =>
  panel(page).getByRole("textbox", { name: /^(Note content|Markdown source)$/ });

test("Save & organize binds the saved revision and preserves source while draft edits survive reload", async ({
  page,
}, testInfo) => {
  const state = await fixture(page);
  await page.goto("/");
  await page.getByRole("textbox", { name: "Title", exact: true }).fill("Saved source revision");
  await page.getByRole("button", { name: "Save & organize", exact: true }).click();
  await expect(panel(page)).toBeVisible();
  expect(state.starts).toEqual(['"source-2"']);
  expect(state.sourceWrites).toHaveLength(1);
  expect(state.handoffs).toBe(1);
  await expect(page.getByRole("button", { name: "Organize", exact: true })).toBeDisabled();
  await expectEditorContent(draftEditor(page), "Generated note");
  await draftEditor(page).fill("My revised generated note");
  await expect(panel(page).getByRole("status")).toHaveText("Draft saved");
  await page.reload();
  await expectEditorContent(draftEditor(page), "My revised generated note");
  await expect(panel(page).getByRole("link", { name: "Reference" })).toHaveAttribute(
    "href",
    "https://example.com/reference",
  );
  await expect(
    page.locator("main > header").getByRole("button", { name: "Save", exact: true }),
  ).toBeVisible();
  await expect(
    panel(page).locator("header").getByRole("button", { name: "Save as new note", exact: true }),
  ).toBeVisible();
  const originalBox = await page
    .getByRole("region", { name: "Original note", exact: true })
    .boundingBox();
  const aiBox = await panel(page).boundingBox();
  expect(originalBox).not.toBeNull();
  expect(aiBox).not.toBeNull();
  if (originalBox && aiBox)
    expect(aiBox.x).toBeGreaterThanOrEqual(originalBox.x + originalBox.width);
  await page.screenshot({ path: testInfo.outputPath("ai-draft-desktop.png"), fullPage: true });
  await page.setViewportSize({ width: 375, height: 812 });
  expect(await page.evaluate("document.documentElement.scrollWidth <= innerWidth")).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("ai-draft-mobile.png"), fullPage: true });
  await panel(page).getByRole("button", { name: "Save as new note", exact: true }).click();
  await expect(panel(page)).toHaveCount(0);
  expect(state.source.content).toBe("Original note");
  expect(state.saved?.id).toBe(savedId);
  expect(state.saved?.origin?.sourceNoteId).toBe(sourceId);
});

test("a source save conflict never starts generation", async ({ page }) => {
  const state = await fixture(page);
  state.failSourceSave();
  await page.goto("/");
  await page.getByRole("textbox", { name: "Title", exact: true }).fill("Keep my text");
  await page.getByRole("button", { name: "Save & organize", exact: true }).click();
  await expect(page.getByRole("button", { name: "Compare latest", exact: true })).toBeVisible();
  expect(state.starts).toEqual([]);
  await expect(page.getByRole("textbox", { name: "Title", exact: true })).toHaveValue(
    "Keep my text",
  );
});

test("existing work reconnects without another start and a deleted-source draft can be discarded", async ({
  page,
}) => {
  const state = await fixture(page);
  state.resumeRun();
  await page.goto("/");
  await expect(draftEditor(page)).toBeVisible();
  expect(state.starts).toEqual([]);
  state.resumeDraft({ deleted: true });
  await page.reload();
  await expect(panel(page)).toContainText("The source note was deleted.");
  await panel(page).getByRole("button", { name: "Discard draft", exact: true }).click();
  await page.getByRole("button", { name: "Keep editing", exact: true }).click();
  await expect(panel(page)).toBeVisible();
  await panel(page).getByRole("button", { name: "Discard draft", exact: true }).click();
  await page.getByRole("button", { name: "Discard permanently", exact: true }).click();
  await expect(panel(page)).toHaveCount(0);
  expect(state.source.content).toBe("Original note");
});

test("failed generation offers an explicit retry and a lost final save recovers one note", async ({
  page,
}) => {
  const state = await fixture(page);
  state.failGeneration(true);
  await page.goto("/");
  await page.getByRole("button", { name: "Organize", exact: true }).click();
  await expect(page.getByRole("region", { name: "Organize progress" })).toContainText(
    "Generation failed",
  );
  state.failGeneration(false);
  await page.getByRole("button", { name: "Retry generation", exact: true }).click();
  await expect(draftEditor(page)).toBeVisible();
  await page.clock.install();
  state.loseFinalSave();
  await panel(page).getByRole("button", { name: "Save as new note", exact: true }).click();
  await expect(panel(page)).toContainText("Could not confirm the new note was saved.");
  await page.clock.fastForward(11_000);
  await panel(page).getByRole("button", { name: "Retry saving note", exact: true }).click();
  await expect(panel(page)).toHaveCount(0);
  expect(state.saves).toBe(2);
  expect(state.saved?.id).toBe(savedId);
});

test("a conflicting draft autosave retains local edits until explicit reload confirmation", async ({
  page,
}) => {
  const state = await fixture(page);
  state.resumeDraft({ stale: true });
  state.conflictDraftSave();
  await page.goto("/");
  await expect(panel(page)).toContainText("This draft belongs to an older version.");
  await draftEditor(page).fill("Keep my unsaved draft");
  await expect(panel(page).getByRole("alert")).toContainText("This draft changed elsewhere.");
  await expectEditorContent(draftEditor(page), "Keep my unsaved draft");
  await panel(page).getByRole("button", { name: "Reload saved draft" }).click();
  await page.getByRole("button", { name: "Keep editing", exact: true }).click();
  await expectEditorContent(draftEditor(page), "Keep my unsaved draft");
  await panel(page).getByRole("button", { name: "Reload saved draft" }).click();
  await page.getByRole("button", { name: "Reload draft", exact: true }).click();
  await expectEditorContent(draftEditor(page), "Generated note");
});

test("lost handoff, autosave and discard responses reconcile committed state", async ({ page }) => {
  const state = await fixture(page);
  state.loseHandoff();
  await page.goto("/");
  await page.getByRole("button", { name: "Organize", exact: true }).click();
  await expect(draftEditor(page)).toBeVisible();
  expect(state.handoffs).toBe(1);
  state.loseDraftSave();
  await draftEditor(page).fill("Recovered draft edits");
  await expect(panel(page).getByRole("status")).toHaveText("Draft saved");
  await expect(panel(page).getByRole("alert")).toHaveCount(0);
  await page.reload();
  await expectEditorContent(draftEditor(page), "Recovered draft edits");
  state.loseDiscard();
  await panel(page).getByRole("button", { name: "Discard draft", exact: true }).click();
  await page.getByRole("button", { name: "Discard permanently", exact: true }).click();
  await expect(panel(page)).toHaveCount(0);
  expect(state.draft).toBeNull();
});

test("running work reconnects and cancellation never creates a note", async ({ page }) => {
  const state = await fixture(page);
  state.resumeRun();
  let cancelled = false;
  let interrupted = true;
  await page.route(`**/api/organize-runs/${runId}`, (route) => {
    if (interrupted) return route.abort("failed");
    return route.fulfill({
      json: cancelled
        ? { runId, status: "cancelled" }
        : { runId, status: "running", phase: "researching", stalled: true },
    });
  });
  await page.route(`**/api/organize-runs/${runId}/cancel`, (route) => {
    cancelled = true;
    return route.fulfill({ json: { runId, status: "cancelled" } });
  });
  await page.goto("/");
  await expect(page.getByRole("region", { name: "Organize progress" })).toContainText(
    "Connection interrupted.",
  );
  interrupted = false;
  await page.getByRole("button", { name: "Reconnect generation", exact: true }).click();
  await expect(page.getByRole("region", { name: "Organize progress" })).toContainText(
    "Researching sources...",
  );
  await expect(page.getByRole("region", { name: "Organize progress" })).toContainText(
    "No recent progress.",
  );
  await page.getByRole("button", { name: "Cancel generation", exact: true }).click();
  await expect(page.getByRole("region", { name: "Organize progress" })).toContainText(
    "Generation cancelled.",
  );
  expect(state.starts).toEqual([]);
  expect(state.handoffs).toBe(0);
  expect(state.saved).toBeNull();
});

test("a rejected final save can reload the current draft and save with its new revision", async ({
  page,
}) => {
  const state = await fixture(page);
  state.resumeDraft();
  state.conflictFinalSave();
  await page.goto("/");
  await expect(draftEditor(page)).toBeVisible();
  await panel(page).getByRole("button", { name: "Save as new note", exact: true }).click();
  await expect(panel(page).getByRole("alert")).toContainText("This draft changed elsewhere.");
  await panel(page).getByRole("button", { name: "Reload saved draft" }).click();
  await page.getByRole("button", { name: "Reload draft", exact: true }).click();
  await expect(
    panel(page).getByRole("textbox", { name: "Draft title", exact: true }),
  ).toBeEnabled();
  await expect(panel(page).getByRole("textbox", { name: "Draft title", exact: true })).toHaveValue(
    "Other tab draft",
  );
  await panel(page)
    .getByRole("textbox", { name: "Draft title", exact: true })
    .fill("Recovered current revision");
  await panel(page).getByRole("button", { name: "Save as new note", exact: true }).click();
  await expect(panel(page)).toHaveCount(0);
  expect(state.saved?.title).toBe("Recovered current revision");
  expect(state.saves).toBe(2);
});

test("reconnecting other work does not erase local edits to a remotely removed draft", async ({
  page,
}) => {
  const state = await fixture(page);
  state.resumeDraft();
  if (state.draft) state.draft.source.noteId = savedId;
  await page.goto("/");
  await expect(draftEditor(page)).toBeVisible();
  await page.route("**/api/organize-work", (route) =>
    route.fulfill({ json: { runs: [], drafts: [] } }),
  );
  await page.route(`**/api/notes/${sourceId}/organize`, (route) => route.abort("failed"));
  await draftEditor(page).fill("Do not lose these local edits");
  await page.getByRole("button", { name: "Organize", exact: true }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "Could not confirm Organize started" }),
  ).toBeVisible();
  await expectEditorContent(draftEditor(page), "Do not lose these local edits");
});

test("session revalidation pauses draft autosave and account switching clears private draft state", async ({
  page,
}) => {
  const state = await fixture(page);
  state.resumeDraft();
  await page.goto("/");
  await expect(draftEditor(page)).toBeVisible();
  await page.clock.install();
  let finishSession: (() => void) | undefined;
  const sessionReady = new Promise<void>((resolve) => {
    finishSession = resolve;
  });
  await page.route("**/api/auth/session", async (route) => {
    await sessionReady;
    return route.fulfill({
      json: {
        user: { id: "user_bob", email: "bob@example.test", firstName: "Bob", lastName: null },
      },
    });
  });
  let writes = 0;
  page.on("request", (request) => {
    if (request.url().includes("/api/note-drafts/") && request.method() === "PUT") writes++;
  });
  await draftEditor(page).fill("Private Alice draft");
  await page.evaluate("window.dispatchEvent(new Event('focus'))");
  await expect(page.getByText("Checking your session. Note requests are paused.")).toBeVisible();
  await page.clock.fastForward(1_000);
  expect(writes).toBe(0);
  await page.route("**/api/organize-work", (route) =>
    route.fulfill({ json: { runs: [], drafts: [] } }),
  );
  await page.route("**/api/notes", (route) => route.fulfill({ json: { notes: [] } }));
  finishSession?.();
  await expect(page.getByText("Signed in as bob@example.test")).toBeVisible();
  await expect(panel(page)).toHaveCount(0);
  await expect(page.getByText("Private Alice draft")).toHaveCount(0);
});

test("generated Markdown imports into rich blocks and persists JSON before any manual edit", async ({
  page,
}, testInfo) => {
  const state = await fixture(page);
  state.resumeDraft();
  const code = 'const symbol = "<tag> &lt;";\nconsole.log(symbol);';
  const markdown =
    "# Synthetic acceptance picnic\n\n## Checklist\n\n- [ ] Plan a fictional picnic\n- [ ] Bring apples\n- [ ] Bring bread\n- [ ] Bring water\n\n[Reference](https://example.com/literal?x=1&y=2)\n\n```typescript\n" +
    code +
    "\n```\n";
  if (state.draft) state.draft.content = markdown;
  await page.goto("/");
  await expect(
    panel(page).getByRole("textbox", { name: "Note content", exact: true }),
  ).toBeVisible();
  await expect(
    panel(page).getByRole("textbox", { name: "Markdown source", exact: true }),
  ).toHaveCount(0);
  await expect(
    panel(page).getByRole("heading", { name: "Synthetic acceptance picnic", exact: true }),
  ).toBeVisible();
  await expect(panel(page).locator("code.bn-inline-content")).toHaveText(code);
  await expect(
    panel(page).locator('.bn-editor a[href="https://example.com/literal?x=1&y=2"]'),
  ).toHaveText("Reference");
  await expect.poll(() => typeof state.draft?.content).toBe("object");
  const persisted = blockNoteDocumentSchema.parse(state.draft?.content);
  expect(persisted.blocks.filter((block) => block.type === "checkListItem")).toHaveLength(4);
  expect(persisted.blocks.find((block) => block.type === "codeBlock")?.content).toEqual([
    { type: "text", text: code, styles: {} },
  ]);
  await page.reload();
  await expect(
    panel(page).getByRole("textbox", { name: "Note content", exact: true }),
  ).toBeVisible();
  await expect(panel(page).locator("code.bn-inline-content")).toHaveText(code);
  await page.screenshot({
    path: testInfo.outputPath("generated-rich-desktop.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 375, height: 812 });
  expect(await page.evaluate("document.documentElement.scrollWidth <= innerWidth")).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("generated-rich-mobile.png"), fullPage: true });
  await panel(page).getByRole("button", { name: "Save as new note", exact: true }).click();
  await expect(panel(page)).toHaveCount(0);
  expect(state.saved?.content).toEqual(persisted);
  expect(state.source.content).toBe("Original note");
});

test("unsupported generated Markdown stays exact editable source with no remote image loading", async ({
  page,
}) => {
  const state = await fixture(page);
  state.resumeDraft();
  const markdown =
    "<div>Keep literal HTML</div>\n\n![Private diagram](https://untrusted.example.test/private.png)";
  if (state.draft) state.draft.content = markdown;
  const remoteRequests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("untrusted.example.test")) remoteRequests.push(request.url());
  });
  await page.goto("/");
  await expect(
    panel(page).getByRole("textbox", { name: "Markdown source", exact: true }),
  ).toHaveValue(markdown);
  await expect(panel(page).getByRole("textbox", { name: "Note content", exact: true })).toHaveCount(
    0,
  );
  await panel(page).getByRole("button", { name: "Save as new note", exact: true }).click();
  await expect(panel(page)).toHaveCount(0);
  expect(state.saved?.content).toBe(markdown);
  expect(remoteRequests).toEqual([]);
});

test("remote draft refresh preserves visible oversized edits until explicit confirmation", async ({
  page,
}) => {
  const state = await fixture(page);
  state.resumeDraft();
  await page.clock.install();
  await page.goto("/");
  await expect(draftEditor(page)).toBeVisible();
  await page.clock.runFor(1_000);
  await expect.poll(() => typeof state.draft?.content).toBe("object");
  await expect(panel(page).getByRole("status")).toHaveText("Draft saved");
  const oversized = "x".repeat(100_001);
  await draftEditor(page).fill(oversized);
  await expect(panel(page).getByRole("alert")).toContainText("This content cannot be saved yet.");
  if (state.draft) {
    state.draft.content = "Remote valid draft";
    state.draft.etag = '"draft-remote"';
  }
  const refreshed = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/api/note-drafts/${draftId}`) &&
      response.request().method() === "GET",
  );
  await page.clock.fastForward(10_001);
  await refreshed;
  await expect(
    panel(page).getByRole("alert").filter({ hasText: "This draft changed elsewhere." }),
  ).toBeVisible();
  expect(await draftEditor(page).evaluate((element) => element.textContent?.length)).toBe(
    oversized.length,
  );
  await expect(
    panel(page).getByRole("button", { name: "Save as new note", exact: true }),
  ).toBeDisabled();
  await panel(page).getByRole("button", { name: "Reload saved draft", exact: true }).click();
  await page.getByRole("button", { name: "Keep editing", exact: true }).click();
  expect(await draftEditor(page).evaluate((element) => element.textContent?.length)).toBe(
    oversized.length,
  );
  await expect(
    panel(page).getByRole("alert").filter({ hasText: "This content cannot be saved yet." }),
  ).toBeVisible();
});

test("a confirmed missing run can be dismissed without stranding Organize", async ({ page }) => {
  const state = await fixture(page);
  state.resumeRun();
  await page.route(`**/api/organize-runs/${runId}`, (route) =>
    route.fulfill({ status: 404, json: { error: { code: "NOT_FOUND", message: "Missing" } } }),
  );
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Dismiss generation", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Cancel generation", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Organize", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Dismiss generation", exact: true }).click();
  await expect(page.getByRole("region", { name: "Organize progress", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Organize", exact: true })).toBeEnabled();
  expect(state.starts).toEqual([]);
});

test("a missing run recovers an already delivered draft before offering dismissal", async ({
  page,
}) => {
  const state = await fixture(page);
  state.resumeRun();
  state.resumeDraft();
  let reads = 0;
  await page.route("**/api/organize-work", (route) =>
    route.fulfill({
      json: { runs: [{ runId, noteId: sourceId }], drafts: reads++ === 0 ? [] : [state.draft] },
    }),
  );
  await page.route(`**/api/organize-runs/${runId}`, (route) =>
    route.fulfill({ status: 404, json: { error: { code: "NOT_FOUND", message: "Missing" } } }),
  );
  await page.goto("/");
  await expect(draftEditor(page)).toBeVisible();
  await expect(page.getByRole("region", { name: "Organize progress", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Dismiss generation", exact: true })).toHaveCount(
    0,
  );
  expect(state.starts).toEqual([]);
});

test("missing run recovery stays retryable while the delivered-draft check is unavailable", async ({
  page,
}) => {
  const state = await fixture(page);
  state.resumeRun();
  let reads = 0;
  await page.route("**/api/organize-work", (route) =>
    reads++ === 0
      ? route.fulfill({ json: { runs: [{ runId, noteId: sourceId }], drafts: [] } })
      : route.abort("failed"),
  );
  await page.route(`**/api/organize-runs/${runId}`, (route) =>
    route.fulfill({ status: 404, json: { error: { code: "NOT_FOUND", message: "Missing" } } }),
  );
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "Reconnect generation", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Dismiss generation", exact: true })).toHaveCount(
    0,
  );
});

test("invalid source-mode draft edits show validation and recover after correction", async ({
  page,
}) => {
  const state = await fixture(page);
  state.resumeDraft();
  const original = "<div>Keep this source</div>";
  if (state.draft) state.draft.content = original;
  await page.goto("/");
  const editor = panel(page).getByRole("textbox", { name: "Markdown source", exact: true });
  await expect(editor).toHaveValue(original);
  await editor.fill(original + "\u0000");
  await expect(panel(page).getByRole("alert")).toContainText("This content cannot be saved yet.");
  await expect(
    panel(page).getByRole("button", { name: "Save as new note", exact: true }),
  ).toBeDisabled();
  expect(state.draft?.content).toBe(original);
  await editor.fill(original + " corrected");
  await expect(panel(page).getByRole("alert")).toHaveCount(0);
  await expect(
    panel(page).getByRole("button", { name: "Save as new note", exact: true }),
  ).toBeEnabled();
  await expect.poll(() => state.draft?.content).toBe(original + " corrected");
  await panel(page)
    .getByRole("textbox", { name: "Draft title", exact: true })
    .fill("Bad\u0000title");
  await expect(panel(page).getByRole("alert")).toContainText("This content cannot be saved yet.");
  await expect(
    panel(page).getByRole("button", { name: "Save as new note", exact: true }),
  ).toBeDisabled();
  await panel(page)
    .getByRole("textbox", { name: "Draft title", exact: true })
    .fill("Corrected title");
  await expect(panel(page).getByRole("alert")).toHaveCount(0);
  await panel(page).getByRole("button", { name: "Save as new note", exact: true }).click();
  await expect(panel(page)).toHaveCount(0);
  expect(state.saved?.content).toBe(original + " corrected");
  expect(state.saved?.title).toBe("Corrected title");
});
