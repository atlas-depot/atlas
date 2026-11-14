import { expect, test, type Page, type Route } from "@playwright/test";
import type {
  Conversation,
  ConversationMessage,
  ConversationRead,
  ConversationSend,
} from "../shared/conversations.ts";
import { formatConversationLabel } from "../src/notes/conversation-store.ts";
import { serveNotes } from "./notes-editor.ts";

const conversation: Conversation = {
  id: "ca100001-1234-4000-8000-000000000001",
  queuePaused: false,
  createdAt: "2026-10-28T10:00:00.000Z",
  updatedAt: "2026-10-28T10:00:00.000Z",
};
const label = formatConversationLabel(conversation);
const note = {
  id: "fa100001-1234-4000-8000-000000000001",
  title: "Runbook",
  content: "Original note text",
  createdAt: conversation.createdAt,
  updatedAt: conversation.updatedAt,
};

function gate() {
  let release = () => {};
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

function question(sequence: number, text = `Question ${sequence}`): ConversationMessage {
  return {
    id: `ca200001-1234-4000-8000-${String(sequence).padStart(12, "0")}`,
    sequence,
    role: "user",
    text,
    deliveryPolicy: "queue",
    createdAt: conversation.createdAt,
  };
}

function answer(sequence: number, text: string): ConversationMessage {
  return {
    id: `ca200001-1234-4000-8000-${String(sequence).padStart(12, "0")}`,
    sequence,
    role: "assistant",
    text,
    turnId: `ca300001-1234-4000-8000-${String(sequence).padStart(12, "0")}`,
    status: "completed",
    reason: null,
    inputIds: [question(1).id],
    citations: [],
    createdAt: conversation.createdAt,
  };
}

function running(sequence: number): NonNullable<ConversationRead["activeTurn"]> {
  return {
    id: `ca300001-1234-4000-8000-${String(sequence).padStart(12, "0")}`,
    status: "running",
    text: `Working on turn ${sequence}`,
    checkpointVersion: 1,
    inputIds: [question(1).id],
  };
}

async function setupChat(page: Page) {
  await serveNotes(page, [[note, '"v1"']]);
  await page.route("**/api/auth/session", (route) =>
    route.fulfill({
      json: {
        user: {
          id: "user_alice",
          email: "alice@example.test",
          firstName: "Alice",
          lastName: null,
        },
      },
    }),
  );
  await page.route("**/api/organize-work", (route) =>
    route.fulfill({ json: { runs: [], drafts: [] } }),
  );
  const api: {
    history: ConversationMessage[];
    activeTurn: ConversationRead["activeTurn"];
    pageSize: number;
    deleted: boolean;
    sendKeys: string[];
    createKeys: string[];
    historyCursors: Array<string | null>;
    intercept?: (route: Route) => Promise<boolean>;
    afterSend?: (route: Route, sent: ConversationSend) => Promise<boolean>;
  } = {
    history: [],
    activeTurn: null,
    pageSize: 50,
    deleted: false,
    sendKeys: [],
    createKeys: [],
    historyCursors: [],
  };
  const receipts = new Map<string, ConversationSend>();
  await page.route(
    (url) => url.pathname.startsWith("/api/conversations"),
    async (route) => {
      if (await api.intercept?.(route)) return;
      const request = route.request();
      const url = new URL(request.url());
      const path = url.pathname;
      const method = request.method();
      const read = () => ({ conversation, activeTurn: api.activeTurn, recovery: null });
      if (path === "/api/conversations") {
        if (method === "POST") {
          api.createKeys.push(request.headers()["idempotency-key"]);
          return route.fulfill({ status: 201, json: conversation });
        }
        return route.fulfill({
          json: { conversations: api.deleted ? [] : [conversation], nextCursor: null },
        });
      }
      if (path === `/api/conversations/${conversation.id}`) {
        if (api.deleted) return route.fulfill({ status: 404, json: {} });
        if (method === "DELETE") {
          api.deleted = true;
          return route.fulfill({ status: 204 });
        }
        return route.fulfill({ json: read() });
      }
      if (path === `/api/conversations/${conversation.id}/messages`) {
        if (method === "POST") {
          const key = request.headers()["idempotency-key"];
          api.sendKeys.push(key);
          let sent = receipts.get(key);
          if (!sent) {
            const message = question(
              (api.history.at(-1)?.sequence ?? 0) + 1,
              request.postDataJSON().text,
            );
            api.history.push(message);
            sent = { ...read(), message };
            receipts.set(key, sent);
          }
          if (await api.afterSend?.(route, sent)) return;
          return route.fulfill({ status: 202, json: sent });
        }
        const cursor = url.searchParams.get("cursor");
        api.historyCursors.push(cursor);
        const remaining = api.history.filter((message) => message.sequence > Number(cursor ?? 0));
        const messages = remaining.slice(0, api.pageSize);
        return route.fulfill({
          json: {
            messages,
            nextCursor:
              remaining.length > messages.length ? messages.at(-1)!.sequence.toString() : null,
          },
        });
      }
      if (path.endsWith("/stop") || path.endsWith("/resume")) {
        api.activeTurn = null;
        return route.fulfill({ json: read() });
      }
      throw new Error(`Unexpected conversation request: ${method} ${path}`);
    },
  );
  return api;
}

const chat = (page: Page) => page.getByRole("region", { name: "Chat workspace" });
async function openChat(page: Page) {
  await page.goto("/");
  await chat(page).getByRole("button", { name: label, exact: true }).click();
  await expect(chat(page).getByText(label, { exact: true })).toHaveCount(2);
}

test("a stale send after focus verification retains the same key through a lost retry response", async ({
  page,
}) => {
  const api = await setupChat(page);
  const first = gate();
  const second = gate();
  const firstStarted = gate();
  const secondStarted = gate();
  api.afterSend = async (route) => {
    if (api.sendKeys.length === 1) {
      firstStarted.release();
      await first.promise;
    } else if (api.sendKeys.length === 2) {
      secondStarted.release();
      await second.promise;
      await route.abort("failed");
      return true;
    }
    return false;
  };
  await openChat(page);
  const input = chat(page).getByLabel("Message", { exact: true });
  await input.fill("Send exactly once");
  await chat(page).getByRole("button", { name: "Send message", exact: true }).click();
  await firstStarted.promise;

  const session = gate();
  const sessionStarted = gate();
  await page.route("**/api/auth/session", async (route) => {
    sessionStarted.release();
    await session.promise;
    await route.fallback();
  });
  await page.evaluate("window.dispatchEvent(new Event('focus'))");
  await sessionStarted.promise;
  await expect(input).toBeDisabled();
  session.release();
  await expect(chat(page).getByRole("button", { name: "Send message", exact: true })).toBeEnabled();
  await chat(page).getByRole("button", { name: "Send message", exact: true }).click();
  await secondStarted.promise;
  const originalResponse = page.waitForResponse(
    (response) => response.request().method() === "POST" && response.url().endsWith("/messages"),
  );
  first.release();
  await originalResponse;
  await expect(input).toHaveValue("Send exactly once");
  second.release();
  await expect(chat(page).getByRole("alert")).toContainText("Your unsent message is preserved");
  await chat(page).getByRole("button", { name: "Send message", exact: true }).click();
  await expect(input).toBeEmpty();
  await expect(chat(page).getByText("Send exactly once", { exact: true })).toHaveCount(1);
  expect(api.sendKeys).toHaveLength(3);
  expect(new Set(api.sendKeys).size).toBe(1);
  expect(api.history).toHaveLength(1);
});

/** Runs one session re-check, as a window focus does, and waits for it to finish. */
async function recheckSession(page: Page) {
  const session = gate();
  const sessionStarted = gate();
  await page.route("**/api/auth/session", async (route) => {
    sessionStarted.release();
    await session.promise;
    await route.fallback();
  });
  await page.evaluate("window.dispatchEvent(new Event('focus'))");
  await sessionStarted.promise;
  await expect(chat(page).getByLabel("Message", { exact: true })).toBeDisabled();
  session.release();
  await expect(chat(page).getByLabel("Message", { exact: true })).toBeEnabled();
  await page.unroute("**/api/auth/session");
}

test("an open dropped by focus verification shows a retry instead of a hidden selection", async ({
  page,
}) => {
  const api = await setupChat(page);
  api.history.push(question(1));
  const read = gate();
  const readStarted = gate();
  let reads = 0;
  api.intercept = async (route) => {
    const request = route.request();
    if (request.method() !== "GET" || !request.url().endsWith(`/${conversation.id}`)) return false;
    reads += 1;
    if (reads === 1) {
      readStarted.release();
      await read.promise;
    }
    return false;
  };
  await page.goto("/");
  await chat(page).getByRole("button", { name: label, exact: true }).click();
  await readStarted.promise;
  await recheckSession(page);
  const dropped = page.waitForResponse(
    (response) => response.request().method() === "GET" && response.url().endsWith(conversation.id),
  );
  read.release();
  await dropped;

  await expect(chat(page).getByRole("alert")).toContainText(
    "Opening this conversation was interrupted",
  );
  await expect(chat(page).getByText("Select a saved conversation")).toHaveCount(0);
  await chat(page).getByRole("button", { name: "Retry opening conversation", exact: true }).click();
  await expect(chat(page).getByText("Question 1", { exact: true })).toBeVisible();
  await expect(chat(page).getByRole("alert")).toHaveCount(0);
});

test("a replayed create key never adopts a conversation that was used since", async ({ page }) => {
  const api = await setupChat(page);
  const create = gate();
  const createStarted = gate();
  api.intercept = async (route) => {
    if (route.request().method() === "POST" && api.createKeys.length === 0) {
      api.createKeys.push(route.request().headers()["idempotency-key"]);
      createStarted.release();
      await create.promise;
      await route.fulfill({ status: 201, json: conversation });
      return true;
    }
    return false;
  };
  await page.goto("/");
  const newConversation = chat(page).getByRole("button", { name: "New conversation", exact: true });
  await newConversation.click();
  await createStarted.promise;
  await recheckSession(page);
  const dropped = page.waitForResponse(
    (response) => response.request().method() === "POST" && response.status() === 201,
  );
  create.release();
  await dropped;

  // The conversation that dropped create made has been written to in the meantime.
  api.history.push(question(1, "Earlier context"));
  await newConversation.click();
  await expect(chat(page).getByLabel("Message", { exact: true })).toBeFocused();
  expect(api.createKeys).toHaveLength(3);
  expect(api.createKeys[1]).toBe(api.createKeys[0]);
  expect(api.createKeys[2]).not.toBe(api.createKeys[0]);
  await expect(chat(page).getByText("Earlier context", { exact: true })).toHaveCount(0);
});

test("opening reads before history and catches up to a newly published answer past page one", async ({
  page,
}) => {
  const api = await setupChat(page);
  api.history = Array.from({ length: 60 }, (_, i) => question(i + 1));
  const read = gate();
  const started = gate();
  api.intercept = async (route) => {
    if (new URL(route.request().url()).pathname === `/api/conversations/${conversation.id}`) {
      started.release();
      await read.promise;
      api.history.push(answer(61, "Published by the read"));
    }
    return false;
  };
  await page.goto("/");
  await chat(page).getByRole("button", { name: label, exact: true }).click();
  await started.promise;
  expect(api.historyCursors).toEqual([]);
  read.release();
  await expect(chat(page).getByText("Published by the read", { exact: true })).toBeVisible();
  await expect(
    chat(page)
      .getByRole("list", { name: "Conversation messages", exact: true })
      .getByRole("listitem"),
  ).toHaveCount(61);
  expect(api.historyCursors).toEqual([null, "50"]);
});

test("polling loads finished queued turns and retains running state until terminal history succeeds", async ({
  page,
}) => {
  const api = await setupChat(page);
  api.history = [question(1)];
  api.activeTurn = running(1);
  await openChat(page);
  api.history.push(answer(2, "First queued answer"));
  api.activeTurn = running(2);
  await expect(chat(page).getByText("First queued answer", { exact: true })).toBeVisible({
    timeout: 10_000,
  });
  await expect(chat(page).getByRole("button", { name: "Stop answer", exact: true })).toBeVisible();

  const failed = gate();
  let failHistory = true;
  api.intercept = async (route) => {
    if (route.request().url().includes("/messages") && failHistory) {
      await route.fulfill({ status: 503, json: {} });
      failed.release();
      return true;
    }
    return false;
  };
  api.activeTurn = null;
  api.history.push(answer(3, "Final queued answer"));
  await failed.promise;
  await expect(chat(page).getByRole("button", { name: "Stop answer", exact: true })).toBeVisible();
  failHistory = false;
  await expect(chat(page).getByText("Final queued answer", { exact: true })).toBeVisible({
    timeout: 10_000,
  });
  await expect(chat(page).getByRole("button", { name: "Stop answer", exact: true })).toHaveCount(0);
});

test("a terminal poll waiting on history cannot overwrite a newer send", async ({ page }) => {
  const api = await setupChat(page);
  api.history = [question(1)];
  api.activeTurn = running(1);
  await openChat(page);
  api.activeTurn = null;
  const history = gate();
  const started = gate();
  let hold = true;
  api.intercept = async (route) => {
    if (route.request().method() === "GET" && route.request().url().includes("/messages") && hold) {
      hold = false;
      const snapshot = { messages: [...api.history], nextCursor: null };
      started.release();
      await history.promise;
      await route.fulfill({ json: snapshot });
      return true;
    }
    return false;
  };
  await started.promise;
  api.activeTurn = running(2);
  await chat(page).getByLabel("Message", { exact: true }).fill("New running input");
  await chat(page)
    .getByRole("button", { name: /^(Send|Queue) message$/ })
    .click();
  await expect(chat(page).getByText("Working on turn 2", { exact: true })).toBeVisible();
  const response = page.waitForResponse(
    (result) => result.request().method() === "GET" && result.url().includes("/messages"),
  );
  history.release();
  await response;
  await expect(chat(page).getByRole("button", { name: "Stop answer", exact: true })).toBeVisible();
  await expect(chat(page).getByText("New running input", { exact: true })).toBeVisible();
});

test("a poll 404 releases busy controls while a send is still pending", async ({ page }) => {
  const api = await setupChat(page);
  api.history = [question(1)];
  api.activeTurn = running(1);
  const sending = gate();
  const started = gate();
  api.afterSend = async () => {
    started.release();
    await sending.promise;
    return false;
  };
  await openChat(page);
  const input = chat(page).getByLabel("Message", { exact: true });
  await input.fill("Keep this unsent input");
  await chat(page).getByRole("button", { name: "Queue message", exact: true }).click();
  await started.promise;
  api.deleted = true;
  await expect(chat(page).getByRole("alert")).toContainText(
    "This conversation is no longer available",
    { timeout: 10_000 },
  );
  await expect(
    chat(page).getByRole("button", { name: "New conversation", exact: true }),
  ).toBeEnabled();
  await expect(input).toBeEnabled();
  sending.release();
  await expect(input).toHaveValue("Keep this unsent input");
});

for (const operation of ["new", "send"] as const) {
  test(`a 409 during ${operation} creation clears the conflicting create key`, async ({ page }) => {
    const api = await setupChat(page);
    const createKeys: string[] = [];
    api.intercept = async (route) => {
      if (
        route.request().method() === "POST" &&
        new URL(route.request().url()).pathname === "/api/conversations"
      ) {
        createKeys.push(route.request().headers()["idempotency-key"]);
        if (createKeys.length === 1) {
          await route.fulfill({ status: 409, json: {} });
          return true;
        }
      }
      return false;
    };
    await page.goto("/");
    if (operation === "send")
      await chat(page).getByLabel("Message", { exact: true }).fill("Draft after create conflict");
    const button = chat(page).getByRole("button", {
      name: operation === "new" ? "New conversation" : "Send message",
      exact: true,
    });
    await button.click();
    await expect(chat(page).getByRole("alert")).toBeVisible();
    await button.click();
    await expect(chat(page).getByRole("alert")).toHaveCount(0);
    if (operation === "new")
      await expect(chat(page).getByText(label, { exact: true })).toHaveCount(2);
    else await expect(chat(page).getByLabel("Message", { exact: true })).toBeEmpty();
    expect(createKeys).toHaveLength(2);
    expect(createKeys[1]).not.toBe(createKeys[0]);
  });
}

test("a 401 clears private history without remounting or losing the composer", async ({ page }) => {
  const api = await setupChat(page);
  api.history = [question(1, "Private saved message")];
  await openChat(page);
  const input = chat(page).getByLabel("Message", { exact: true });
  await input.fill("Unsent text must survive a 401");
  api.intercept = async (route) => {
    if (route.request().method() === "POST") {
      await route.fulfill({ status: 401, json: {} });
      return true;
    }
    return false;
  };
  await chat(page).getByRole("button", { name: "Send message", exact: true }).click();
  await expect(input).toHaveValue("Unsent text must survive a 401");
  await expect(input).toBeDisabled();
  await expect(chat(page).getByText("Private saved message", { exact: true })).toHaveCount(0);
  await expect(chat(page).getByRole("navigation", { name: "Saved conversations" })).toHaveCount(0);
});

test("forbidden note writes also disable chat writes while preserving its draft", async ({
  page,
}) => {
  await setupChat(page);
  await openChat(page);
  const input = chat(page).getByLabel("Message", { exact: true });
  await input.fill("Keep when writes are forbidden");
  await page.route(`**/api/notes/${note.id}`, async (route) => {
    if (route.request().method() === "PUT") return route.fulfill({ status: 403, json: {} });
    return route.fallback();
  });
  await page.getByRole("textbox", { name: "Title", exact: true }).fill("Changed title");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(input).toBeDisabled();
  await expect(input).toHaveValue("Keep when writes are forbidden");
  await expect(
    chat(page).getByRole("button", { name: "Send message", exact: true }),
  ).toBeDisabled();
});

test("an accepted send with failed catch-up preserves the contiguous history cursor and provides a history-only retry", async ({
  page,
}) => {
  const api = await setupChat(page);
  api.pageSize = 10;
  api.history = Array.from({ length: 250 }, (_, i) => question(i + 1));
  await openChat(page);
  await expect(
    chat(page)
      .getByRole("list", { name: "Conversation messages", exact: true })
      .getByRole("listitem"),
  ).toHaveCount(200);
  let failHistory = true;
  api.intercept = async (route) => {
    if (
      route.request().method() === "GET" &&
      route.request().url().includes("/messages") &&
      failHistory
    ) {
      await route.fulfill({ status: 503, json: {} });
      return true;
    }
    return false;
  };
  const input = chat(page).getByLabel("Message", { exact: true });
  await input.fill("Accepted message 251");
  await chat(page).getByRole("button", { name: "Send message", exact: true }).click();
  await expect(chat(page).getByRole("alert")).toContainText("Your action was accepted");
  await expect(input).toBeEmpty();
  await expect(chat(page).getByText("Accepted message 251", { exact: true })).toBeVisible();
  failHistory = false;
  await chat(page).getByRole("button", { name: "Load more messages", exact: true }).click();
  await expect(chat(page).getByText("Question 201", { exact: true })).toBeVisible();
  await expect(chat(page).getByText("Question 210", { exact: true })).toBeVisible();
  // The automatic retry (or explicit retry) must never post the accepted input again.
  await expect(chat(page).getByText("Question 250", { exact: true })).toBeVisible({
    timeout: 10_000,
  });
  const texts = await chat(page).locator(".chat-message-text").allTextContents();
  expect(texts).toEqual([
    ...Array.from({ length: 250 }, (_, i) => `Question ${i + 1}`),
    "Accepted message 251",
  ]);
  expect(api.sendKeys).toHaveLength(1);
});

test("a post-send history error offers a retry that never re-sends the message", async ({
  page,
}) => {
  const api = await setupChat(page);
  await openChat(page);
  let failHistory = true;
  api.intercept = async (route) => {
    if (
      route.request().method() === "GET" &&
      route.request().url().includes("/messages") &&
      failHistory
    ) {
      await route.fulfill({ status: 503, json: {} });
      return true;
    }
    return false;
  };
  await chat(page).getByLabel("Message", { exact: true }).fill("Already accepted");
  await chat(page).getByRole("button", { name: "Send message", exact: true }).click();
  await expect(chat(page).getByRole("alert")).toContainText("Your action was accepted");
  failHistory = false;
  await chat(page).getByRole("button", { name: "Retry loading messages", exact: true }).click();
  await expect(chat(page).getByRole("alert")).toHaveCount(0);
  await expect(chat(page).getByText("Already accepted", { exact: true })).toHaveCount(1);
  expect(api.sendKeys).toHaveLength(1);
});

test("focus verification preserves older list pages and their next cursor", async ({ page }) => {
  const api = await setupChat(page);
  const older = {
    ...conversation,
    id: "ca100001-1234-4000-8000-000000000002",
    createdAt: "2026-10-28T09:00:00.000Z",
  };
  const oldest = {
    ...conversation,
    id: "ca100001-1234-4000-8000-000000000003",
    createdAt: "2026-10-28T08:00:00.000Z",
  };
  api.intercept = async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname !== "/api/conversations" || route.request().method() !== "GET") return false;
    const cursor = url.searchParams.get("cursor");
    await route.fulfill({
      json: {
        conversations: [cursor === "oldest" ? oldest : cursor === "older" ? older : conversation],
        nextCursor: cursor === "oldest" ? null : cursor === "older" ? "oldest" : "older",
      },
    });
    return true;
  };
  await page.goto("/");
  await chat(page).getByRole("button", { name: "Load older conversations", exact: true }).click();
  await expect(
    chat(page).getByRole("button", { name: formatConversationLabel(older), exact: true }),
  ).toBeVisible();
  const listResponse = page.waitForResponse(
    (response) => new URL(response.url()).pathname === "/api/conversations",
  );
  await page.evaluate("window.dispatchEvent(new Event('focus'))");
  await listResponse;
  await expect(
    chat(page).getByRole("button", { name: formatConversationLabel(older), exact: true }),
  ).toBeVisible();
  await chat(page).getByRole("button", { name: "Load older conversations", exact: true }).click();
  await expect(
    chat(page).getByRole("button", { name: formatConversationLabel(oldest), exact: true }),
  ).toBeVisible();
});

for (const width of [1280, 375]) {
  test(`chat layout and dialog keyboard focus work at ${width}px with an open conversation`, async ({
    page,
  }, testInfo) => {
    const api = await setupChat(page);
    api.history = [question(1, "A saved message in the open conversation")];
    await page.setViewportSize({ width, height: 900 });
    await openChat(page);
    const input = chat(page).getByLabel("Message", { exact: true });
    await input.focus();
    await page.keyboard.type("Draft kept across layouts");
    await page.screenshot({
      path: testInfo.outputPath(`chat-sidebar-${width}.png`),
      fullPage: true,
    });
    await chat(page).getByRole("button", { name: "Full screen chat", exact: true }).focus();
    await page.keyboard.press("Enter");
    await expect(chat(page)).toHaveAttribute("data-chat-presentation", "fullscreen");
    await expect(page.locator(".workspace-content")).toBeHidden();
    await expect(page.locator(".workspace-sidebar")).toBeHidden();
    expect((await chat(page).boundingBox())!.width).toBeGreaterThan(width - 50);
    await expect(input).toHaveValue("Draft kept across layouts");
    expect(await page.evaluate("document.documentElement.scrollWidth <= window.innerWidth")).toBe(
      true,
    );
    await expect(
      chat(page).locator(".chat-history-column[aria-live], .chat-thread-column[aria-live]"),
    ).toHaveCount(0);
    await page.screenshot({
      path: testInfo.outputPath(`chat-fullscreen-${width}.png`),
      fullPage: true,
    });

    const newButton = chat(page).getByRole("button", { name: "New conversation", exact: true });
    await newButton.focus();
    await page.keyboard.press("Enter");
    const discard = page.getByRole("alertdialog", { name: "Discard unsent message?" });
    await expect(discard.getByRole("button", { name: "Keep message", exact: true })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(discard).toBeHidden();
    await expect(input).toBeFocused();
    const trigger = chat(page).getByRole("button", { name: "Delete conversation", exact: true });
    await trigger.focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("alertdialog", { name: "Delete conversation?" });
    await expect(
      dialog.getByRole("button", { name: "Keep conversation", exact: true }),
    ).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(dialog).toBeVisible();
    // Visibility precedes the dialog's initial-focus effect. Send Tab only once
    // the safe action owns focus, otherwise Enter can activate Keep instead.
    await expect(
      dialog.getByRole("button", { name: "Keep conversation", exact: true }),
    ).toBeFocused();
    const deleting = gate();
    let deleteStarted = false;
    api.intercept = async (route) => {
      if (route.request().method() === "DELETE") {
        deleteStarted = true;
        await deleting.promise;
      }
      return false;
    };
    await page.keyboard.press("Tab");
    await expect(
      dialog.getByRole("button", { name: "Delete permanently", exact: true }),
    ).toBeFocused();
    await page.keyboard.press("Enter");
    await expect.poll(() => deleteStarted).toBe(true);
    await expect(dialog).toBeHidden();
    await expect(
      chat(page).getByRole("heading", { name: "Saved conversations", exact: true }),
    ).toBeFocused();
    deleting.release();
    await expect(newButton).toBeFocused();
    await expect(input).toBeEmpty();
    await chat(page).getByRole("button", { name: "Sidebar chat", exact: true }).focus();
    await page.keyboard.press("Enter");
    await expect(page.locator(".workspace-content")).toBeVisible();
  });
}
