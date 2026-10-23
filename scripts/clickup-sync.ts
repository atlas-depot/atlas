import { readFile } from "node:fs/promises";
import { z } from "zod";

const repository = "atlas-depot/atlas";
const configSchema = z.object({
  workspaceId: z.string().regex(/^\d+$/),
  listId: z.string().regex(/^\d+$/),
  statuses: z.object({
    open: z.string().min(1),
    completed: z.string().min(1),
    not_planned: z.string().min(1),
  }),
  tasks: z.record(z.string().regex(/^[1-9]\d*$/), z.string().regex(/^[a-zA-Z0-9_-]+$/)),
});
const issueSchema = z.object({
  number: z.number().int().positive(),
  state: z.enum(["open", "closed"]),
  state_reason: z.enum(["completed", "not_planned", "reopened"]).nullable(),
  pull_request: z.unknown().optional(),
});
const taskSchema = z.object({
  id: z.string(),
  team_id: z.string(),
  list: z.object({ id: z.string() }),
  status: z.object({ status: z.string(), type: z.string() }),
});

type Options = {
  issueNumber: number;
  repository: string;
  config: unknown;
  githubToken?: string;
  clickupToken?: string;
  fetch?: typeof fetch;
};

// Requests use fixed provider origins, never URLs from issue text or API responses.
export async function syncIssue(options: Options): Promise<string> {
  if (options.repository !== repository) throw new Error("Unexpected repository");
  const issueNumber = z.number().int().positive().parse(options.issueNumber);
  const config = configSchema.parse(options.config);
  const taskId = config.tasks[String(issueNumber)];
  if (!taskId) return `Issue #${issueNumber}: unmapped, skipped`;
  if (!options.githubToken || !options.clickupToken)
    throw new Error("Missing GitHub or ClickUp token");
  const request = options.fetch ?? fetch;
  async function api(
    provider: "github" | "clickup",
    path: string,
    status?: string,
  ): Promise<unknown> {
    const origin =
      provider === "github" ? "https://api.github.com" : "https://api.clickup.com/api/v2";
    let response: Response;
    try {
      response = await request(`${origin}${path}`, {
        method: status === undefined ? "GET" : "PUT",
        headers: {
          Authorization:
            provider === "github" ? `Bearer ${options.githubToken}` : options.clickupToken!,
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: status === undefined ? undefined : JSON.stringify({ status }),
        redirect: "error",
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      // Provider/network errors may contain credentials or private response data.
      throw new Error(`${provider} request failed; rerun to reconcile current state`);
    }
    if (!response.ok)
      throw new Error(
        `${provider} returned HTTP ${response.status}; rerun after resolving the error`,
      );
    try {
      return await response.json();
    } catch {
      throw new Error(`${provider} returned invalid JSON`);
    }
  }
  function parseTask(value: unknown) {
    const result = taskSchema.safeParse(value);
    if (!result.success) throw new Error("Invalid ClickUp task response");
    const task = result.data;
    if (
      task.id !== taskId ||
      task.team_id !== config.workspaceId ||
      task.list.id !== config.listId
    ) {
      throw new Error("ClickUp task is outside the configured task/workspace/list");
    }
    return task;
  }
  const path = `/task/${encodeURIComponent(taskId)}`;
  const task = parseTask(await api("clickup", path));
  // Read live state after queued runs start. Old events/reruns must not undo a later reopen.
  const issueResult = issueSchema.safeParse(
    await api("github", `/repos/${repository}/issues/${issueNumber}`),
  );
  if (
    !issueResult.success ||
    issueResult.data.number !== issueNumber ||
    issueResult.data.pull_request !== undefined
  ) {
    throw new Error("Invalid GitHub issue response");
  }
  const issue = issueResult.data;
  const reason = issue.state === "open" ? "open" : issue.state_reason;
  if (reason !== "open" && reason !== "completed" && reason !== "not_planned") {
    throw new Error("Closed issue has no supported resolution; inspect it before syncing");
  }
  if (reason === "open" && !["done", "closed"].includes(task.status.type)) {
    return `Issue #${issueNumber}: already open, keeping ${task.status.status}`;
  }
  const desired = config.statuses[reason];
  if (task.status.status.toLowerCase() === desired.toLowerCase())
    return `Issue #${issueNumber}: already ${desired}`;
  await api("clickup", path, desired);
  const updated = parseTask(await api("clickup", path));
  if (updated.status.status.toLowerCase() !== desired.toLowerCase())
    throw new Error("ClickUp status update was not confirmed");
  return `Issue #${issueNumber}: synced to ${desired}`;
}

if (import.meta.main) {
  try {
    const config: unknown = JSON.parse(
      await readFile(new URL("../.github/clickup-tasks.json", import.meta.url), "utf8"),
    );
    console.log(
      await syncIssue({
        issueNumber: Number(process.env.ISSUE_NUMBER),
        repository: process.env.GITHUB_REPOSITORY ?? "",
        config,
        githubToken: process.env.GITHUB_TOKEN,
        clickupToken: process.env.CLICKUP_API_TOKEN,
      }),
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : "ClickUp sync failed");
    process.exitCode = 1;
  }
}
