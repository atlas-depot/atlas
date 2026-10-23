import { describe, expect, it } from "vite-plus/test";
import { syncIssue } from "./clickup-sync.ts";

const config = {
  workspaceId: "123",
  listId: "456",
  statuses: { open: "backlog", completed: "shipped", not_planned: "cancelled" },
  tasks: { "23": "task23" },
};
const options = {
  issueNumber: 23,
  repository: "atlas-depot/atlas",
  config,
  githubToken: "synthetic-github-token",
  clickupToken: "synthetic-clickup-token",
};
const task = (status = "backlog", type = "notstarted") => ({
  id: "task23",
  team_id: "123",
  list: { id: "456" },
  status: { status, type },
});
const issue = (state = "closed", state_reason: string | null = "completed") => ({
  number: 23,
  state,
  state_reason,
});

function provider(responses: unknown[]) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetch: typeof globalThis.fetch = async (url, init) => {
    calls.push({
      url: typeof url === "string" ? url : url instanceof URL ? url.href : url.url,
      init,
    });
    const response = responses.shift();
    if (response instanceof Error) throw response;
    if (response instanceof Response) return response;
    if (response === undefined) throw new Error("Unexpected request");
    return Response.json(response);
  };
  return { fetch, calls };
}

describe("existing ClickUp task status sync", () => {
  it("skips unmapped issues without credentials or provider calls", async () => {
    const mock = provider([]);
    await expect(
      syncIssue({
        ...options,
        issueNumber: 99,
        githubToken: undefined,
        clickupToken: undefined,
        fetch: mock.fetch,
      }),
    ).resolves.toContain("unmapped");
    expect(mock.calls).toEqual([]);
  });

  it.each([
    ["completed", "shipped"],
    ["not_planned", "cancelled"],
  ])("maps a closed %s issue to %s and verifies persisted status", async (reason, status) => {
    const mock = provider([task(), issue("closed", reason), {}, task(status, "done")]);
    await expect(syncIssue({ ...options, fetch: mock.fetch })).resolves.toContain(
      `synced to ${status}`,
    );
    expect(mock.calls.map(({ url, init }) => [url, init?.method])).toEqual([
      ["https://api.clickup.com/api/v2/task/task23", "GET"],
      ["https://api.github.com/repos/atlas-depot/atlas/issues/23", "GET"],
      ["https://api.clickup.com/api/v2/task/task23", "PUT"],
      ["https://api.clickup.com/api/v2/task/task23", "GET"],
    ]);
    expect(mock.calls[2]?.init?.body).toBe(JSON.stringify({ status }));
    expect(mock.calls[0]?.init?.headers).toMatchObject({ Authorization: options.clickupToken });
    expect(mock.calls[1]?.init?.headers).toMatchObject({
      Authorization: `Bearer ${options.githubToken}`,
    });
    expect(mock.calls.every(({ init }) => init?.redirect === "error")).toBe(true);
  });

  it("a repeated close does not issue another write", async () => {
    const mock = provider([task("SHIPPED", "done"), issue()]);
    await expect(syncIssue({ ...options, fetch: mock.fetch })).resolves.toContain(
      "already shipped",
    );
    expect(mock.calls).toHaveLength(2);
  });

  it("uses live reopened state instead of an older queued close event", async () => {
    const mock = provider([task("shipped", "done"), issue("open", "reopened"), {}, task()]);
    await expect(syncIssue({ ...options, fetch: mock.fetch })).resolves.toContain(
      "synced to backlog",
    );
    expect(mock.calls[2]?.init?.body).toBe('{"status":"backlog"}');
  });

  it("reconciliation preserves progress on an already open task", async () => {
    const mock = provider([task("in progress", "custom"), issue("open", "reopened")]);
    await expect(syncIssue({ ...options, fetch: mock.fetch })).resolves.toContain(
      "keeping in progress",
    );
    expect(mock.calls).toHaveLength(2);
  });

  it.each([
    { ...task(), team_id: "999" },
    { ...task(), list: { id: "999" } },
    { ...task(), id: "another-task" },
    { unexpected: "response" },
  ])("does not write outside its task/workspace/list boundary", async (response) => {
    const mock = provider([response]);
    await expect(syncIssue({ ...options, fetch: mock.fetch })).rejects.toThrow(/ClickUp task/);
    expect(mock.calls).toHaveLength(1);
  });

  it("rejects another repository before sending credentials", async () => {
    const mock = provider([]);
    await expect(
      syncIssue({ ...options, repository: "other/atlas", fetch: mock.fetch }),
    ).rejects.toThrow("Unexpected repository");
    expect(mock.calls).toHaveLength(0);
  });

  it.each([
    { ...issue(), number: 24 },
    { ...issue(), pull_request: {} },
    issue("closed", null),
    issue("closed", "duplicate"),
  ])("refuses ambiguous or unexpected issue responses", async (response) => {
    const mock = provider([task(), response]);
    await expect(syncIssue({ ...options, fetch: mock.fetch })).rejects.toThrow();
    expect(mock.calls).toHaveLength(2);
  });

  it("reports API failure without echoing provider data or retrying a write", async () => {
    const mock = provider([
      task(),
      issue(),
      new Response("private provider data", { status: 429 }),
    ]);
    await expect(syncIssue({ ...options, fetch: mock.fetch })).rejects.toThrow(
      "clickup returned HTTP 429",
    );
    expect(mock.calls).toHaveLength(3);
  });

  it("does not expose a network error or claim success after an uncertain write", async () => {
    const mock = provider([task(), issue(), new Error("secret value")]);
    await expect(syncIssue({ ...options, fetch: mock.fetch })).rejects.toThrow(
      "clickup request failed; rerun to reconcile current state",
    );
    expect(mock.calls).toHaveLength(3);
  });

  it("fails when the status write was not persisted", async () => {
    const mock = provider([task(), issue(), {}, task()]);
    await expect(syncIssue({ ...options, fetch: mock.fetch })).rejects.toThrow("not confirmed");
  });
});
