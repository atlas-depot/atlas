---
name: atlas-deploy
description: Check Atlas deployment readiness, preview deployment quality, CI status, Vercel Services, migrations, env vars, observability, and rollback. Use before preview/staging/production deploys or when deployment checks fail.
---

# Atlas Deploy Skill

Use this skill before preview, staging, or production deployment.

## Required Reading

Read:

- `AGENTS.md`
- `docs/process/agent-alignment.md`
- `docs/process/deployment-policy.md`
- `docs/process/provider-and-env-setup.md`
- `docs/process/branch-protection-recommended.md`
- `docs/process/solo-to-team-workflow.md`
- `docs/architecture/technical-decisions.md`
- `docs/architecture/repository-structure.md`

## Checklist

- CI passed.
- Preview deployment exists and was smoke-tested.
- Environment variables are present and documented.
- No secret values are committed.
- New provider/env requirements are reflected in `.env.example`, `mise run doctor`/`env:check`, and `docs/process/provider-and-env-setup.md`.
- Local development still works without production provider credentials.
- Database migrations are reviewed.
- Migration rollback plan exists.
- External provider credentials are scoped.
- Owner gates: see docs/process/agent-alignment.md, section Efe-Owned Gates.
- Error monitoring is active.
- Logs do not expose sensitive data.
- Feature flags are configured for risky features.
- Rollback path is clear.
- Vercel Services is used only as deployment packaging for `apps/web` and `apps/bot`, not as a domain split.
- Production deploy, domain, env/secrets, and provider accounts have Efe approval unless delegated.

## Commands

Use when available:

```bash
gh pr checks --json name,bucket,state,workflow,link
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm eval:smoke
mise run env:check
vercel ls
```

For previews, inspect the PR checks/comments for Vercel deployment URLs. For production, do not deploy without explicit approval.

UI evidence: capture per /atlas-test's evidence rules (agent-browser screenshots + snapshot).

For UI-affecting previews, capture route-specific screenshots and note any responsive/state gaps.

## Vercel Services Gate

If `apps/bot` is in scope:

- Confirm `vercel.json` uses current `services`, not older `experimentalServices`.
- Confirm `apps/bot` shares Atlas backend services, permissions, audit, and Postgres model.
- Confirm webhook signatures are tested.
- Confirm local dev and preview route behavior are documented.

## Output

```text
Deployment verdict: Ready | Not ready

Blocking issues:
- ...

Checks completed:
- ...

Manual smoke test:
- ...

Rollback plan:
- ...

Efe approvals needed:
- ...
```
