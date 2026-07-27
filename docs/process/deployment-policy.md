# Deployment Policy

## Environments

- local
- preview
- staging
- production

## Rules

- Every PR gets a preview deployment when possible.
- PRs touching `apps/web`, `apps/agent`, API routes, or deployment config must include a preview URL or explain why preview was unavailable.
- UI/frontend preview PRs must include `agent-browser` screenshot or snapshot evidence. If `agent-browser` is missing, install it before marking preview smoke complete.
- Production deploys only from `main`.
- `main` must remain deployable.
- Database migrations must be reviewed.
- Destructive migrations require explicit approval and rollback plan.
- Live payment enablement requires explicit Efe approval, webhook verification, audit events, rollback plan, and PCI-boundary review.
- Environment variables must be documented but never committed with secret values.
- Efe owns production domain, production env/secrets, provider account setup, and final production deployment approval unless delegated.
- Provider/env setup follows `docs/process/provider-and-env-setup.md`.
- Personal provider accounts may be used during bootstrap only as an explicit Efe-owned constraint. Do not share personal passwords, 2FA, or unscoped production access.

## Vercel Services

Vercel Services may be used to package `apps/web` and `apps/agent` under one Vercel project if the prototype validates local development, preview deployments, environment binding, Spend Management, rollback behavior, and webhook routing for channels. It must not create independent memory services or bypass the shared Postgres and domain layers. Hetzner + `@workflow/world-postgres` remains the documented agent exit.

## Environment Policy

Local development must not require production provider secrets. Use fake/local providers by default, and use scoped `local-integration` secrets only when an issue proves fake providers are insufficient.

Preview, staging, and production secrets must live in the deployment/provider env store, not in committed files or PR bodies.

Shared dev vault access is allowed for active teammates. Production vault access is not part of normal onboarding. Teammates may test production through normal user/test-user sessions and public APIs when an approved test plan requires it, but local machines should not hold production DB, storage, OAuth, webhook, provider admin, or deployment runtime secrets by default.

If a PR is blocked by missing provider env, record:

```text
Missing env:
Environment:
Why it is needed:
Owner:
Fallback/fake path:
```

Do not deploy to production from a personal machine using ad hoc `.env.local` values.

## Production readiness checklist

- CI passed.
- Required reviews completed.
- Preview smoke-tested.
- Migration plan reviewed.
- Error monitoring active.
- Rollback path known.
