---
name: atlas-pr
description: Open or update a high-quality Atlas pull request with linked issue, reviewable summary, preview URL, screenshots, tests, risks, security/AI checks, rollback, and senior project explanation.
---

# Atlas PR Skill

Use this skill to open or update a PR so it is easy to review.

## Required Reading

Read:

- `.github/PULL_REQUEST_TEMPLATE.md`
- `docs/process/definition-of-done.md`
- `docs/process/engineering-standards.md`
- `docs/process/solo-to-team-workflow.md`
- `docs/process/deployment-policy.md`
- `docs/process/provider-and-env-setup.md`
- `docs/process/evidence-bundles.md`
- `.claude/skills/atlas-test/SKILL.md`

Inspect the actual diff before writing the PR body.

```bash
git diff --stat
git diff
gh pr view --json title,body,url,comments,reviews,headRefName,baseRefName
gh pr checks --json name,bucket,state,workflow,link
```

Use `gh` commands only when a git repo and GitHub auth are available.

## Workflow

1. Confirm branch, issue, and current diff.
2. Run or collect relevant verification using `/atlas-test`.
3. Collect preview URL if available or explain why it is unavailable.
4. Collect screenshots/video for UI changes. Prefer `agent-browser` screenshots.
5. Collect backend evidence for API/worker/DB/domain changes.
6. If provider/env config changed, confirm `.env.example`, provider docs, and doctor/env checks are updated.
7. Draft the PR body from the template.
8. Open a draft PR when work is still in progress; mark ready only when checks/evidence are ready.
9. Update existing PR body if one already exists.

Commands when appropriate:

```bash
git status --short
git diff --stat
gh pr view --json url,title,body,state,isDraft,headRefName,baseRefName
gh pr create --draft --fill
gh pr edit --body-file <file>
```

Screenshot evidence command pattern:

```bash
command -v agent-browser || npm install -g agent-browser@0.31.1
agent-browser open <local-or-preview-url>
agent-browser wait --load networkidle
agent-browser screenshot artifacts/screenshots/<pr-slug>-desktop.png --full
agent-browser screenshot artifacts/screenshots/<pr-slug>-annotated.png --annotate
```

Do not open or update a remote PR without explicit approval if the current workflow requires approval for remote-changing actions.

## Required PR body

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

## Rules

- Do not hide uncertainty.
- Call out missing tests.
- Call out architecture changes.
- Do not add agent co-authors to commit messages.
- Do not claim generated files were manually reviewed if they were only generator output.
- Link screenshots or preview when UI changed.
- Mention Efe-owned gates if the PR is blocked on provider, production, compliance, real data, or final branding.
- Mention whether real provider secrets are required and whether fake/local mode still works.
- Do not claim CI/preview/reviews are green unless verified.
- Make the PR reviewable: summarize risky files, generated/mechanical files, and reviewer entry points.
- Include local verification, CI status, preview smoke, and screenshot links when relevant.
- For UI/frontend PRs, do not mark the PR review-ready without `agent-browser` screenshots or a concrete install/tooling blocker.
- For backend/API/worker/DB PRs, include request/response, DB, audit/event, workflow, log/trace, or schema evidence. Before/after snapshots are preferred for changed behavior.
