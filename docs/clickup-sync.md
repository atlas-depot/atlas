# GitHub to ClickUp

GitHub owns issue titles, full descriptions, assignees and open/closed state. ClickUp owns scheduling, WBS hierarchy, estimates, dependencies and custom fields. Edit mirrored text on GitHub; the next run replaces it on ClickUp. ClickUp-only edits do not trigger a run; the next GitHub event or manual reconciliation restores mirrored fields. ClickUp comments are not synchronized.

The workflow mirrors issues into Atlas Product Backlog (`1100380000082079`). Existing issues #17-#26 use checked-in task IDs; subsequent tasks are discovered by their dedicated `Source: https://github.com/atlas-depot/atlas/issues/N` line. Keep that line intact. Dependency links are not identities. A missing seed, duplicate match or unknown assignee fails the run before writes. Archived cards remain archived and are skipped.

## Enable

1. Store a ClickUp API token with access to the Atlas workspace as repository secret `CLICKUP_TOKEN`. Never paste it into an issue, chat or committed file.
2. Store `CLICKUP_ASSIGNEES_JSON` as a repository secret: a JSON object mapping GitHub logins to ClickUp numeric user IDs or workspace member emails. Example using synthetic IDs: `{"example-developer":12345}`. Every assigned GitHub user must resolve uniquely to a member of workspace `1100380000018105`; pending invitations may not resolve until accepted.
3. Set repository variable `CLICKUP_SYNC_ENABLED` to `true` after this workflow lands on `main`. Run **Sync issues to ClickUp** manually with **dry_run** checked. Fix all missing mappings first, then run with dry_run unchecked.
4. Verify a changed issue title and a close/reopen cycle against its existing card. No live behavior is established by unit tests alone.

Open issues create cards in `backlog`; closed issues move matched cards to the List's closed status. Reopening a closed/done card returns it to backlog. Open cards already in progress keep that status. Unmapped historical closed issues are not imported. GitHub deletion never deletes a ClickUp card. New card URLs appear in the workflow log; this automation does not edit GitHub issues or add comments. Existing reciprocal links remain valid.

Every event reconciles current GitHub state, including pagination, instead of replaying its event payload. One global concurrency group serializes runs; replacement of pending events cannot discard changes because the surviving run reconciles every issue. GitHub API changes made using `GITHUB_TOKEN` may not trigger another workflow; run manual reconciliation after automated bulk edits. There is no scheduled job.

GETs retry bounded transient failures. Writes never retry blindly: a timeout can mean the provider accepted a create. After a transport timeout, rerun reconciliation to discover its source marker before creating again. A source identity or description verification failure requires inspecting the created card before rerunning: the provider may have ignored its identity field, so discovery cannot safely recover it automatically. Check the failed run; do not manually duplicate a card. Status names must contain one `backlog` and one closed status. API failures log no response body or credentials.

## Verification and references

Run `python3 -m unittest discover -s scripts/tests -v`. This repository automation does not add application CI or a dependency.

- [ClickUp Create Task](https://developer.clickup.com/reference/createtask) and [Update Task](https://developer.clickup.com/reference/updatetask): `markdown_content`, assignee deltas.
- [Get Tasks](https://developer.clickup.com/reference/gettasks): paginate, include closed and archived cards.
- [GitHub issue events](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#issues) and [concurrency](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency).
