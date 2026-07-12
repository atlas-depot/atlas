---
name: atlas-review
description: Extensively review an Atlas diff or PR for correctness, architecture, privacy, AI safety, tests, CI, previews, and external review signals. Use when the user asks for PR review, code review, approval readiness, Greptile/Cursor/Devin/Codex review status, or whether a branch is safe to merge.
---

# Atlas Review Skill

Use this skill before opening, approving, or merging a PR. Default to a code-review stance: findings first, ordered by severity, with file/line references when available.

## Required Reading

Read first:

- `AGENTS.md`
- `docs/process/agent-alignment.md`
- `docs/process/pr-review-rubric.md`
- `docs/process/definition-of-done.md`
- `docs/process/engineering-standards.md`
- `docs/process/solo-to-team-workflow.md`
- `docs/architecture/product-invariants.md`
- Relevant architecture docs for changed files.

If the PR touches deployment or previews, also read `docs/process/deployment-policy.md`.
If the PR touches provider config, env vars, external accounts, or local services, also read `docs/process/provider-and-env-setup.md`.
If it touches auth/security/privacy, also read `.claude/skills/atlas-security/SKILL.md`.
If it touches AI/retrieval, also read `.claude/skills/atlas-ai/SKILL.md` and `.claude/skills/atlas-eval/SKILL.md`.
If it touches UI/frontend, also read `.claude/skills/atlas-design/SKILL.md` and `.claude/skills/atlas-test/SKILL.md`.
If it touches backend/API/worker/DB behavior, also read `docs/process/evidence-bundles.md` and `.claude/skills/atlas-backend/SKILL.md`.

## Evidence Collection

For a local branch:

```bash
git status --short
git diff --stat
git diff
git log --oneline --decorate -n 12
```

For a PR:

```bash
gh pr view --json number,url,title,body,headRefName,baseRefName,state,isDraft,mergeStateStatus,reviewDecision,comments,reviews
gh pr checks --json name,bucket,state,workflow,link
```

If GitHub is available, inspect review threads with GraphQL so resolved/outdated threads are not treated as active.

Run or verify appropriate evidence. Prefer:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm eval:smoke
```

Do not run all commands blindly if the repo does not have scripts yet; report missing commands as verification gaps.

For UI changes, review screenshots or capture them when tooling exists. Prefer `agent-browser`:

```bash
command -v agent-browser || npm install -g agent-browser@0.31.1
agent-browser open <local-or-preview-url>
agent-browser wait --load networkidle
agent-browser screenshot --full
agent-browser screenshot --annotate
agent-browser snapshot -i
```

Check desktop and mobile when practical. If `agent-browser` installation fails, list screenshot/E2E as blocked, not verified.

For backend changes, require behavior evidence:

- Request/response snapshot.
- DB/query snapshot.
- Audit/event snapshot.
- Job/workflow state snapshot.
- Schema/contract diff.
- Redacted trace/log excerpt.

If none exists, list backend evidence as an unverified risk or blocker depending on blast radius.

Check external review signals only if present:

- Greptile comments/checks.
- Cursor/Bugbot comments/checks.
- Devin comments/checks.
- Codex/Claude comments/checks.
- Vercel preview checks.

Do not claim these were checked unless you inspected them.

## Review Categories

Review:

1. Scope and issue fit.
2. Correctness and regressions.
3. Atlas architecture invariants.
4. Database and migration safety.
5. Permission and private/shared leakage.
6. AI grounding, citations, structured outputs, and evals.
7. Action risk and approval flow.
8. UI quality, accessibility, responsive behavior, and preview evidence.
9. Tests and CI.
10. Deployment, env, rollback, and observability.
11. Senior project explainability.
12. Engineering standards: generated files, commit authorship, em dash usage, bug reproduction, UI quality, and unresolved test failures.

## Severity Levels

- Blocker: must fix before merge.
- Major: should fix before merge unless explicitly deferred.
- Minor: can be follow-up.
- Question: needs clarification.

## Blocker Patterns

- UI-only permission enforcement.
- AI answer over user memory without citations or explicit ungrounded label.
- Private/shared relation leakage.
- Destructive external action without explicit approval.
- OAuth token lifecycle treated as trivial.
- Durable workflow state stored only in memory.
- Migration that can drop/rewrite data without explicit approval and rollback.
- Bot/external chat path bypassing backend memory permissions.
- Missing tests for changed security, permissions, AI behavior, or migrations.
- Provider/env changes without `.env.example`, provider docs, doctor/env check updates, or fake/local fallback.
- PR requires Efe personal account credentials or production secrets for ordinary local review.
- Manual edits to generated files or `CHANGELOG.md`.
- Commit messages that add an agent co-author.
- User-visible bug fix without a reasonable reproduction path.
- Clear UI defects ignored in preview or screenshots.

## Guardrails

- Do not leave GitHub comments unless the user authorizes it.
- Do not summarize a PR as safe without reading the actual diff.
- Do not treat passing CI as sufficient review.
- Do not treat third-party AI review as authoritative; validate findings against code and Atlas docs.
- If no issues are found, say so and name residual test/verification gaps.

## Output

```text
Review verdict: Approve | Request changes | Comment only

Blockers:
- ...

Major:
- ...

Minor:
- ...

Questions:
- ...

Suggested follow-up issues:
- ...

Evidence checked:
- Diff:
- CI:
- Local checks:
- Preview:
- Screenshots/E2E:
- Backend snapshots:
- Env/provider:
- Review threads:
- External review tools:
```
