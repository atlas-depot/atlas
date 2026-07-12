---
name: atlas-pr
description: Open or update a reviewable Atlas PR, then babysit it to merge-ready. Use when the user asks to open a PR, update the PR, make it easy to review, babysit this PR, get CI green, wait for preview/deploy, address review threads, resolve Greptile/Cursor/Devin/Codex/Bugbot comments, or make a PR merge-ready.
---

# Atlas PR Skill

Two modes. Mode A opens or updates a reviewable PR. Mode B babysits it until merge-ready or concretely blocked.

## Required Reading

Read:

- `AGENTS.md`
- `docs/process/agent-alignment.md`
- `.github/PULL_REQUEST_TEMPLATE.md`
- `docs/process/definition-of-done.md`
- `docs/process/solo-to-team-workflow.md`
- `docs/process/deployment-policy.md`
- `docs/process/provider-and-env-setup.md`
- `docs/process/evidence-bundles.md`
- `docs/process/pr-review-rubric.md`
- `.claude/skills/atlas-review/SKILL.md`
- `.claude/skills/atlas-test/SKILL.md`
- `.claude/skills/atlas-deploy/SKILL.md` for Mode B preview and deploy gates.

Also read architecture docs relevant to changed files.

Standards: see AGENTS.md.

Use `gh` commands only when a git repo and GitHub auth are available. Do not open, update, or comment on a remote PR without approval when the workflow requires approval for remote-changing actions.

## Mode A: Open or update a PR

Inspect the actual diff before writing the PR body.

```bash
git status --short
git diff --stat
git diff
gh pr view --json url,title,body,state,isDraft,headRefName,baseRefName,comments,reviews
gh pr checks --json name,bucket,state,workflow,link
```

1. Confirm branch, issue, and current diff.
2. Run or collect relevant verification using `/atlas-test`.
3. Collect preview URL if available or explain why it is unavailable.
4. UI evidence: capture per /atlas-test's evidence rules (agent-browser screenshots + snapshot).
5. Backend evidence: capture per /atlas-backend and /atlas-test's snapshot rules for API/worker/DB/domain changes.
6. If provider/env config changed, confirm `.env.example`, provider docs, and doctor/env checks are updated.
7. Draft the PR body from the template.
8. Open a draft PR while work is in progress; mark ready only when checks/evidence are ready.
9. Update the existing PR body if one already exists.

```bash
gh pr create --draft --fill
gh pr edit --body-file <file>
```

### Required PR body

```md
## Linked issue
Closes #

## What changed?

## Why?

## How?

## Screenshots or preview

## Tests run

- [ ] `pnpm lint`
- [ ] `pnpm typecheck`
- [ ] `pnpm test`
- [ ] `pnpm build`
- [ ] Other:

## Privacy and security checklist

- [ ] No secrets added.
- [ ] Permission paths checked.
- [ ] Private/shared leakage considered.
- [ ] Logs checked for sensitive data.
- [ ] Provider/env changes update `.env.example`, provider docs, and doctor/env checks.

## AI checklist, if applicable

- [ ] Source grounding preserved.
- [ ] Structured outputs validated.
- [ ] Eval or smoke test added.
- [ ] Failure mode is safe.

## Risk and rollback

## Senior project explanation

What I did:
Why I did it:
How it works:
What I learned:
What I can demo:
```

### Rules

- Do not hide uncertainty.
- Call out missing tests.
- Call out architecture changes.
- Do not claim generated files were manually reviewed if they were only generator output.
- Link screenshots or preview when UI changed.
- Mention Efe-owned gates if the PR is blocked on provider, production, compliance, real data, or final branding.
- Mention whether real provider secrets are required and whether fake/local mode still works.
- Do not claim CI/preview/reviews are green unless verified.
- Make the PR reviewable: summarize risky files, generated/mechanical files, and reviewer entry points.
- For UI/frontend PRs, do not mark review-ready without agent-browser screenshots or a concrete install/tooling blocker.
- For backend/API/worker/DB PRs, capture backend evidence per /atlas-backend and /atlas-test's snapshot rules; before/after snapshots are preferred for changed behavior.

## Mode B: Babysit to merge-ready

Take responsibility for the PR until it is merge-ready or concretely blocked.

Start with:

```bash
git status --short
gh pr view --json number,url,title,headRefName,baseRefName,state,isDraft,mergeStateStatus,reviewDecision
gh pr checks --json name,bucket,state,workflow,link
```

If there is no PR, report that babysitting cannot start until a PR exists.

Evidence gathering and thread classification: follow /atlas-review's rules.

### Loop

Repeat until ready or blocked:

1. Inspect branch status, PR metadata, review decision, and merge state.
2. Inspect all PR-attached checks, not only GitHub Actions.
3. Inspect failed GitHub Actions logs with `gh run view <run-id> --log-failed` when applicable.
4. Inspect review threads and top-level comments.
5. Classify each thread: valid/actionable, already fixed, outdated, unclear, or out-of-scope.
6. Inspect external review signals if present: Greptile, Cursor/Bugbot, Devin, Codex, Claude, Vercel.
7. Apply the smallest safe fix for valid in-scope issues.
8. Run focused local checks.
9. If failures are caused by missing provider/env config, classify whether fake/local fallback, scoped Efe secret, or preview env update is the right fix.
10. Commit/push only when the current user/workflow has approved remote-changing action.
11. Re-check PR checks, preview status, and unresolved review threads.

### Review Thread Commands

Use GitHub GraphQL when possible because top-level comments hide whether a thread is resolved or outdated.

```bash
gh api graphql -f query='
query($owner:String!, $repo:String!, $number:Int!) {
  repository(owner:$owner, name:$repo) {
    pullRequest(number:$number) {
      reviewThreads(first:100) {
        nodes {
          id
          isResolved
          isOutdated
          path
          line
          comments(first:10) {
            nodes {
              author { login }
              body
              url
            }
          }
        }
      }
    }
  }
}' -f owner=OWNER -f repo=REPO -F number=PR_NUMBER
```

Only read the minimum comment body/location needed to act.

### Preview Gate

If the PR touches `apps/web`, `apps/bot`, API routes, deployment config, or user-visible behavior:

- Find the Vercel preview URL from checks, PR comments, or deployment metadata.
- Smoke-test the changed route or webhook surface.
- Capture UI evidence per /atlas-test's evidence rules for UI changes.
- If preview is unavailable, document why and what local verification replaced it.

### Stop Conditions

Ready means:

- Required checks green.
- Preview deployed and smoke-tested when required.
- Valid review findings addressed.
- Review threads resolved, outdated, or answered.
- PR body reflects current behavior, tests, preview, risks, and rollback.

Blocked means:

- Missing credentials/permissions.
- Provider/compliance/production gate needs Efe.
- PR requires Efe personal account password, 2FA, broad dashboard access, or production secret access for ordinary verification.
- A reviewer decision conflicts with Atlas invariants.
- CI failure is unrelated and cannot be safely fixed in PR scope.

### Output

```text
Babysit verdict: Ready | Blocked | Still running

PR:
Checks:
Preview:
Review threads:
External reviews:
Fixes applied:
Replies/resolutions needed:
Remaining blockers:
Next action:
```
