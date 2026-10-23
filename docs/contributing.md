# Contributing

## Branches and merge authority

Start independent feature branches from `main`. All integration merges target `main`; there is no shared `dev` integration or release step. Existing branches are not deleted by this policy.

Name PR source branches `<type>/<description>` or `<type>/<issue-number>-<description>`. Use a lowercase kebab-case description starting with a letter. Allowed types match the commit types: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`, `adr`. Include the issue number when the work belongs to an issue, for example `feat/23-source-viewer` or `ci/19-pr-checks`; a small fix without an issue can use `fix/source-selection`. Do not add a username prefix or create an issue just to name a branch.

Dependent work may start before its parent PR merges when the contributors agree on the needed contract. Give each branch an owner and each concurrent local task a separate worktree. A dependent PR temporarily targets its parent branch, with the parent PR and incorporated revision recorded in its body. Once its own scope is complete and verified, it may be ready for review before the parent merges. Merge the parent first, then move only the child's changes onto current `main`, retarget its PR, and reverify the final diff, checks and approval before Efe's merge decision. Follow [parallel work](process/parallel-work.md) for commands and squash/rebase handling. A worktree isolates files, not ports, credentials or shared services.

All five teammates are intended members of the human `atlas-reviewers` CODEOWNER team. Each PR needs approval from an eligible teammate other than its author. Efe makes the final merge decision, including for Efe-authored PRs after another teammate approves. Bot approvals never replace the required human CODEOWNER.

Keep merge authority separate from review and CI requirements. Only the Efe-only `atlas-merge` team may bypass the update restriction, and only through a PR. Efe has no review/CI bypass. Organization owners can still administer these settings; ordinary merge restrictions do not remove organization administration rights.

Protection setup must follow the base branch: enable mandatory CODEOWNER approval after this team ownership file lands on `main`, not while Efe is the sole owner. Verify active team access before claiming everyone can review. Once `.github/workflows/ci.yml` has run on a real pull request, its `verify` check is the CI status to require; do not require a check name before a workflow produces it. CI success, review approval and deployment are separate facts.

## Issues

Use GitHub Task issues for work requiring assignment and coordination, with a linked ClickUp task when available. Only explicitly mapped task statuses synchronize on issue close/reopen; see [ClickUp status sync](process/clickup-sync.md) for setup and limits. Other fields remain manual. Small understood fixes may use a direct PR; raise newly noticed bugs in the team WhatsApp group. The owner curates the backlog; Discussions stay disabled.

Before starting, read the issue, relevant comments and linked decisions. Confirm the owner, observable acceptance conditions and dependencies. Separate what can be prepared now from what needs an agreed contract or an upstream implementation. A dependency marked open does not forbid parallel work, and an open PR does not mean its contract is accepted.

Keep decisions and scope changes in the issue, with links to the implementing PR and evidence. Preserve earlier decisions unless the team changes them explicitly. Use `Refs #N` while a dependent PR targets a non-default branch; once it targets `main`, use a closing reference only if it completes the issue. Verify the issue's final state after merge. A pushed branch, passing check or ready PR is not task completion; record any remaining acceptance work instead of closing it prematurely.

## Pull requests

Keep one reviewable change per PR. Use atomic Conventional Commits without AI co-author or generated-by footers. Never commit secrets or unrelated local edits.

Use three short fields, normally about 100 words rather than a hard word limit:

```text
Why: The concrete problem and task link when one exists.
Change: The resulting behavior and important design choice, if any.
Evidence: What actually ran, its result, and relevant verification gaps.
```

Add a migration, risk or rollback note only when material. For visible UI changes, verify desktop, mobile width and keyboard behavior; attach before/after screenshots or a short recording when still images cannot show the behavior. For backend changes, use a sanitized request/result or persisted-state example when useful. Screenshots alone do not verify backend behavior.

Do not repeat the diff as a file list, paste logs, or require an academic reflection in every PR. Contribution notes may stay local; no committed log entry or separate log PR is required. When a team or school report is needed, summarize existing PR, review and verification links. A merge identity alone does not prove authorship.

## Design before implementation

When a product, API, data or architecture choice is unresolved, put a short proposal in the task: specific decision, viable options, recommendation with evidence, and the smallest experiment that could disprove it. Preserve decisions already made. Small choices do not require a separate design PR or ADR; record durable decisions in the relevant canonical document.

A contributor should be able to explain the changed data flow, key decision and verification. Generic tutorials and reading summaries are not required PR deliverables.

## Review

Inspect the actual head/base, changed behavior and affected callers. Validate bot findings independently. Keep demonstrated defects separate from uncertain risks and preferences; unmet agreed acceptance criteria or missing mandatory checks may block readiness without being code defects.

Use a concise finding when a material defect blocks the change:

```text
Blocking: <file:line> <reachable trigger> causes <observable impact>.
Evidence: <reproduction, failing assertion or concrete code trace>.
```

Add Questions or Suggestions only when useful. A clean review can say: "No blocking findings in <scope> at <head>. Verified: <actual checks>. Gap: <material unverified behavior, if any>."

Approve means the scoped change is fit to merge, not perfect or bug-free. Do not block on style, optional documentation or a bot verdict alone. After a fix, re-review the finding and affected behavior; broaden only when new evidence warrants it. Separate executed checks from proposed cases and mocked behavior from live provider results.

Address review threads with a verified fix and evidence, or a reasoned response against the current code and accepted decisions. Do not mark a disputed or unanswered concern resolved just to clear the conversation list. Resolving a thread does not supply human approval or prove that checks passed on the current revision.

Keep intentionally unfinished work draft even when checks pass. Ready status never grants permission to merge.

## AI review configuration

CodeRabbit is configured for automatic reviews of non-draft PRs, but this OSS repository currently requires a manual trigger, and PRs targeting a non-default branch may also be skipped. Request a review with `@coderabbitai full review` and read the actual review result; a successful status can report a skipped review. cubic is a second opinion requested with `@cubic-dev-ai review this PR`; automatic reviews and approvals are disabled. Both are configured to preserve the author-written PR description.

The configuration files do not install the GitHub Apps. cubic reads `cubic.yaml` only from the default branch, so dashboard settings must match until this change lands. Greptile uses `.greptile/config.json` for manual reviews via `@greptileai`, with automatic events and approvals disabled and Base effort selected. Match the Atlas dashboard setting to Never without changing other repositories. Installation and free-plan eligibility must be verified before claiming it is active. Bot reviews are advisory and do not replace human approval or grant merge permission.

Configuration references: [CodeRabbit](https://docs.coderabbit.ai/reference/configuration), [cubic](https://docs.cubic.dev/configure/cubic-yaml), [Greptile](https://www.greptile.com/docs/quickstart).
