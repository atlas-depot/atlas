---
name: atlas-babysit
description: Keep an Atlas PR merge-ready by looping on CI, previews, review threads, and external review tools. Use when the user asks to babysit a PR, get CI green, wait for preview/deploy, address Greptile/Cursor/Devin/Codex/Bugbot comments, resolve reviews, or make a PR 5/5 and approve-ready.
---

# Atlas Babysit

Use this skill to take responsibility for a PR until it is merge-ready or concretely blocked.

## Required Reading

Read first:

- `AGENTS.md`
- `docs/process/agent-alignment.md`
- `docs/process/solo-to-team-workflow.md`
- `docs/process/pr-review-rubric.md`
- `docs/process/deployment-policy.md`
- `docs/process/provider-and-env-setup.md`
- `.claude/skills/atlas-review/SKILL.md`
- `.claude/skills/atlas-deploy/SKILL.md`

Also read architecture docs relevant to changed files.

## Resolve The PR

Start with:

```bash
git status --short
gh pr view --json number,url,title,headRefName,baseRefName,state,isDraft,mergeStateStatus,reviewDecision
gh pr checks --json name,bucket,state,workflow,link
```

If there is no PR, report that babysitting cannot start until a PR exists.

## Loop

Repeat until ready or blocked:

1. Inspect branch status, PR metadata, review decision, and merge state.
2. Inspect all PR-attached checks with `gh pr checks`, not only GitHub Actions.
3. Inspect failed GitHub Actions logs with `gh run view <run-id> --log-failed` when applicable.
4. Inspect review threads and top-level comments.
5. Classify each thread: valid/actionable, already fixed, outdated, unclear, or out-of-scope.
6. Inspect external review signals if present in checks/comments: Greptile, Cursor/Bugbot, Devin, Codex, Claude, Vercel.
7. Apply the smallest safe fix for valid in-scope issues.
8. Run focused local checks.
9. If failures are caused by missing provider/env config, classify whether fake/local fallback, scoped Efe secret, or preview env update is the right fix.
10. Commit/push only when the current user/workflow has approved remote-changing action.
11. Re-check PR checks, preview status, and unresolved review threads.

## Review Thread Commands

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

## Preview Gate

If the PR touches `apps/web`, `apps/bot`, API routes, deployment config, or user-visible behavior:

- Find the Vercel preview URL from checks, PR comments, or deployment metadata.
- Smoke-test the changed route or webhook surface.
- Capture screenshots or notes for UI changes.
- If preview is unavailable, document why and what local verification replaced it.

## External Review Tools

Do not assume tools exist. Check available PR comments/checks.

If Greptile, Cursor/Bugbot, Devin, Codex, Claude, or other review tools appear:

- Read each active finding.
- Validate it against code and Atlas docs.
- Fix valid in-scope findings.
- Disagree explicitly when a finding is invalid, with one concise reason.
- Resolve or reply only when remote comment actions are approved.

## Stop Conditions

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

## Output

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
