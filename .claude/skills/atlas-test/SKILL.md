---
name: atlas-test
description: Run or design Atlas verification across lint, typecheck, unit tests, integration tests, e2e tests, eval smoke tests, migration checks, screenshots, preview smoke tests, and CI evidence. Use when the user asks to test, verify, lint, run checks, produce screenshots, or prove a PR works.
---

# Atlas Test Skill

Use this skill to produce evidence, not just confidence.

## Required Reading

Read:

- `AGENTS.md`
- `docs/process/agent-alignment.md`
- `docs/process/definition-of-done.md`
- `docs/process/engineering-standards.md`
- `docs/process/pr-review-rubric.md`
- `docs/process/deployment-policy.md`
- `docs/process/provider-and-env-setup.md`
- `docs/process/evidence-bundles.md`
- Relevant domain skill for changed files.

## Test Ladder

Pick the strongest practical checks for the change:

1. Static: `pnpm lint`, `pnpm typecheck`, format check if available.
2. Unit: package/domain tests.
3. Integration: DB/API/workflow/provider-adapter tests.
4. E2E: user flows through browser.
5. AI eval: `pnpm eval:smoke` and targeted evals.
6. DB: migration generate/check, leakage fixtures.
7. UI evidence: screenshots at desktop/mobile, responsive checks, accessibility smoke.
8. Backend evidence: request/response snapshots, DB snapshots, audit/event snapshots, logs/traces, workflow/job state, schema/contract diff.
9. Deployment evidence: preview URL smoke-test.
10. Env/provider evidence: `.env.example` coverage and `mise run doctor`/`env:check` output when provider config changed.
11. CI evidence: `gh pr checks --json name,bucket,state,workflow,link`.

## Command Baseline

Use when scripts exist:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm eval:smoke
mise run env:check
```

For PR checks:

```bash
gh pr checks --json name,bucket,state,workflow,link
```

For failing GitHub Actions:

```bash
gh run view <run-id> --log-failed
```

## Screenshot And E2E Rules

For UI changes:

- Use `agent-browser`.
- If `agent-browser` is missing, install the pinned CLI before claiming screenshot/preview verification is complete.
- Capture desktop and mobile screenshots.
- Verify loading, empty, error, unauthorized, low-confidence AI, and action approval states when touched.
- Confirm text does not overlap or overflow.
- Include preview URL once previews exist.

Agent-browser baseline:

```bash
command -v agent-browser || npm install -g agent-browser@0.31.1
agent-browser --help
agent-browser open http://localhost:3000
agent-browser wait --load networkidle
agent-browser screenshot --full
agent-browser snapshot -i
```

Preferred Phase 0 repo-local install once `package.json` exists:

```bash
pnpm add -D agent-browser@0.31.1
pnpm exec agent-browser --help
```

For PR evidence, prefer named screenshots:

```bash
agent-browser screenshot artifacts/screenshots/<route>-desktop.png --full
agent-browser screenshot artifacts/screenshots/<route>-annotated.png --annotate
```

If the page changes after a click, form submit, route transition, modal open, or dynamic load, run `agent-browser snapshot -i` again before using refs.

If installation fails, mark screenshot/preview verification as blocked and include the install error. Do not silently replace it with a weaker manual claim for UI/frontend PRs.

## Backend Snapshot Rules

For backend/API/worker/DB changes:

- Capture the smallest reproducible behavior surface.
- Prefer before/after snapshots when changing existing behavior.
- Use sanitized request/response JSON, DB query output, audit log rows, domain events, job/workflow state, trace/log excerpts, or schema diffs.
- Redact secrets, OAuth tokens, private user data, and sensitive memory.
- Store safe artifacts under `artifacts/backend/` or summarize sanitized excerpts in the PR.

Backend snapshot examples:

```bash
curl -sS http://localhost:3000/api/v1/health | jq '.' > artifacts/backend/health-after.json
psql "$DATABASE_URL" -c "select action,resource_type,created_at from audit_logs order by created_at desc limit 10;" > artifacts/backend/audit-after.txt
pnpm db:migrate --dry-run > artifacts/backend/migration-plan.txt
```

If the repo lacks real commands yet, document the intended snapshot command in the issue/PR acceptance criteria.

## Output

```text
Test verdict: Pass | Fail | Partial | Not run

Commands run:
- ...

Evidence:
- CI:
- Preview:
- Screenshots:
- Backend snapshots:
- E2E:
- Eval:

Failures:
- ...

Unverified risk:
- ...
```

Do not mark work complete if relevant checks were skipped without explanation.
Do not ignore unrelated lint, type, test, flaky-test, or clear UI failures.
Fix small safe failures or create a tracked issue with evidence.
