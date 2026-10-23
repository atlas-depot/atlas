# ClickUp issue status sync

GitHub owns technical scope and completion. ClickUp holds assigned planning tasks. The sync updates only existing tasks explicitly listed in `.github/clickup-tasks.json`; it never creates tasks or changes titles, descriptions, assignments or dates.

| Current GitHub state | ClickUp status |
| --- | --- |
| Closed as completed | SHIPPED |
| Closed as not planned | CANCELLED |
| Open and ClickUp task is done/closed | BACKLOG |
| Open and ClickUp task is already active | Keep its current status |

Reopening returns a finished task to triage, not automatically to ready for development. Unknown closing reasons fail visibly rather than claiming completion. Every run rereads the current issue, so an older event or rerun does not restore stale state. Per-issue concurrency serializes writes. Repeating a successful run does not write again; a failure after a possibly accepted write can be rerun safely because the next run reads the current task first.

## Enable and operate

1. Add a personal ClickUp API token as the repository Actions secret `CLICKUP_API_TOKEN`. Use an account with access to the Atlas list. Never put the token in an issue, task, commit or workflow input. GitHub supplies its own read-only token.
2. Merge the workflow through normal review. `issues: closed/reopened` runs only after the workflow exists on `main`. No GitHub webhook server or paid ClickUp automation plan is needed.
3. In Actions, run **Sync issue status to ClickUp** on `main` with one mapped issue number. Verify the resulting task status before relying on the integration. This is also the recovery path for missed events or configuration/token repairs.

New issues do not create tasks. When Efe assigns work and requests a ClickUp task, create or reuse that task, link it to the issue, and add its issue number and native task ID to the map in a small PR. Mapping changes and secrets are reviewed separately from untrusted issue content. The script checks the returned task ID, workspace and list before writing, uses fixed API origins, refuses redirects, and logs no provider bodies. Moving a task to another list intentionally stops its sync until the map/config is reviewed.

The workflow listens only to closed/reopened events and explicit manual reconciliation. It does not poll, synchronize arbitrary field edits, or close a task merely because a partial PR merged. GitHub events generated using a workflow's `GITHUB_TOKEN` generally do not trigger another workflow; use manual reconciliation if an automated action closes an issue without a sync run.

Failures appear in GitHub Actions. Check the failed run and rerun after resolving access, rate limits or configuration. The sync is not a required PR status check. Its mocked behavior tests run in the existing CI lint job; they do not prove live ClickUp credentials, task IDs or delivery. Disable the workflow to stop synchronization without changing tasks.

Sources: [ClickUp authentication](https://developer.clickup.com/docs/authentication), [Get Task](https://developer.clickup.com/reference/gettask), [Update Task](https://developer.clickup.com/reference/updatetask), [GitHub issue events](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#issues), [concurrency](https://docs.github.com/en/actions/concepts/workflows-and-actions/concurrency).
