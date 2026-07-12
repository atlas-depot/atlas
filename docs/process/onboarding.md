# Atlas Team Onboarding

Status: Phase 0 contract  
Audience: engineers and AI coding agents joining Atlas

Atlas should be runnable from a clean machine with one setup command and one health check. Until the real application scaffold exists, this document defines the onboarding contract Phase 0 must implement.

Related operating docs:

- `docs/process/solo-to-team-workflow.md`
- `docs/process/owner-onboarding.md`
- `docs/process/provider-and-env-setup.md`
- `docs/architecture/repository-structure.md`
- `docs/process/evidence-bundles.md`

Efe Baran Durmaz is the bootstrap lead and product owner for the first application scaffold. Teammates can own areas later, but provider accounts, production secrets, compliance-sensitive setup, real eval data, production domain, and final visual identity stay Efe-owned unless explicitly delegated.

## Required Tooling

Install `mise` first:

```bash
curl https://mise.run | sh
```

Then from the repo root:

```bash
mise trust
mise install
mise run setup
mise run doctor
```

Phase 0 must pin:

- Node.js: `24.18.0`
- pnpm: `11.9.0`
- package manager field: `pnpm@11.9.0`

## Required Repo Commands

These commands must exist at the root:

```bash
pnpm install
pnpm dev
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm storybook
pnpm db:generate
pnpm db:migrate
pnpm db:studio
pnpm eval:smoke
```

`mise` tasks should wrap the common ones:

```bash
mise run setup
mise run doctor
mise run dev
mise run ci
mise run storybook
mise run env:fake
mise run env:decrypt
mise run env:check
mise run db:migrate
mise run db:seed
mise run eval:smoke
```

Agent-friendly command requirements:

- Every task must be non-interactive by default or have a documented non-interactive path.
- Every task must support useful failure messages with the next command to run.
- Destructive or production-affecting tasks must have a dry-run path or require explicit confirmation outside normal local setup.
- Commands that report environment status should support stable text output and may add `--json` later for agents.
- Re-running `mise run setup` and `mise run doctor` must be safe.

## Doctor Contract

`mise run doctor` must check required tools and optional tools separately.

Required:

- Node version matches `.mise.toml`.
- pnpm version matches `packageManager`.
- `pnpm-lock.yaml` exists after install.
- `.env.local` exists or the command explains how to create it from `.env.example`.
- Required local env vars are present.
- Ports needed by `pnpm dev` are available or the conflict is reported.

Optional:

- `gh` for GitHub issue/PR workflows.
- `vercel` for preview/deploy workflows.
- `agent-browser` for UI screenshot, preview smoke, and visual regression evidence.
- `neonctl` or equivalent for managed Postgres workflows.
- `temporal` for workflow development.
- Docker only if local Postgres/Redis/Temporal containers are used.

Missing optional tools must not block local web development.

`agent-browser` is optional for pure backend/docs work, but required for UI/frontend/preview/PR evidence work. If a task needs screenshots and `agent-browser` is missing, install it before claiming the task is verified.

Preferred Phase 0 repo-local install:

```bash
pnpm add -D agent-browser@0.31.1
pnpm exec agent-browser --help
```

Temporary bootstrap install before `package.json` exists:

```bash
npm install -g agent-browser@0.31.1
agent-browser --help
```

`mise run doctor` must check `agent-browser` and report it as required when the current task or PR needs UI screenshots, preview smoke, or browser interaction evidence.

## Environment Files

Phase 0 must add `.env.example` with non-secret example values. Never commit real credentials.

Local developers create:

```bash
cp .env.example .env.local
mise run doctor
```

Secrets must be loaded through the deployment provider, local secret manager, or a private `.env.local` file ignored by Git.

Use `docs/process/provider-and-env-setup.md` as the source of truth for provider accounts, env modes, `.env` files, fake providers, and secret handoff.

Default local development must work in `local-fake` mode without paid provider credentials. Integration work may use `local-integration` mode only when Efe has approved the exact provider secret or scoped access.

Every teammate must be able to run `pnpm dev` with a generated fake/local `.env.local`. Once more than one teammate is regularly working, enable the shared-dev-secret path for dev/integration secrets so local integration work does not depend on Efe's machine. Prefer SOPS/age before paid vault tooling during the senior-project phase.

Vault access can be active for everyone only at the `dev` scope. Production secrets are not part of teammate local onboarding. Teammates may test production as normal users or approved test users, but they should not receive production DB, storage, OAuth, webhook, provider admin, or runtime deployment secrets by default.

Do not commit `.env.vault` or an encrypted env bundle unless Atlas has explicitly enabled the SOPS/age shared-dev-secret path or chosen another vault workflow. If the team needs recurring shared secret access, evaluate 1Password, Infisical, Doppler, or SOPS/age and record the decision first.

Efe owns provider account setup and real secret distribution unless delegated. Teammates and agents should request provider access with:

```text
Provider access needed:
Issue/PR:
Why fake provider is insufficient:
Provider:
Exact env vars needed:
Requested permission/scope:
Duration:
Local or preview/staging/prod:
Test plan:
Risk if denied:
```

## Local Service Modes

Phase 0 must support two local tracks:

- Minimal local: app plus fake/local providers.
- Full local: app plus Postgres, Redis, Temporal, and object storage emulator or managed dev equivalents.

`pnpm dev` should default to minimal local unless the developer opts into full local or integration mode.

Provider defaults:

- Postgres/pgvector: Docker/local Postgres or Neon dev branch.
- Redis: local Redis or fake cache adapter.
- Temporal: `WorkflowPort` fake adapter early, Docker/local Temporal when ingestion workflows start.
- Object storage: MinIO for local integration, filesystem/in-memory fake adapter only for unit tests.
- AI/OCR/crawler/webhooks: deterministic fake providers and fixtures for tests and CI, real dev providers only through shared dev secrets.
- Vercel/preview/prod env: owned by Efe unless delegated.

Seed defaults:

- `mise run db:seed` must load deterministic local seed data.
- Keep small local seeds separate from larger demo, leakage, and eval fixtures.
- Do not use anonymized production dumps until a privacy process exists.

## Vercel Services Local Contract

If `apps/bot` is in scope, Phase 0 or the Vercel Services spike must document the local workflow.

Expected shape:

```text
apps/web  -> route prefix /
apps/bot  -> route prefix /bot
```

Use current Vercel Services `services` configuration, not `experimentalServices`.

The bot service is an external chat webhook surface. It must call Atlas application services and must not own memory, permissions, actions, or audit logs.

## First-Day Checklist

1. Install `mise`.
2. Run `mise trust`.
3. Run `mise install`.
4. Run `mise run setup`.
5. Copy `.env.example` to `.env.local`.
6. Run `mise run doctor`.
7. Run `pnpm dev`.
8. Open the local web app.
9. Install/verify `agent-browser` before UI/frontend PRs.
10. Run `pnpm lint`, `pnpm typecheck`, and `pnpm test` before opening a PR.

## Efe Bootstrap Checklist

Use this when Efe is kickstarting the application scaffold or onboarding the first teammate:

1. Confirm the teammate's area: frontend, UI design, backend/API, database/permissions, AI/ingestion/evals, security/privacy, DX/deploy, or bot/integrations.
2. Point them to `docs/process/owner-onboarding.md`.
3. Run `mise run doctor` on their machine.
4. Confirm `pnpm dev` starts with fake/local providers before requiring real credentials.
5. Confirm their first issue is small, demoable, and does not require production secrets.
6. Confirm whether the issue can run in `local-fake` mode or needs a scoped integration secret.
7. For UI/API/bot work, confirm the PR includes a preview URL once previews exist.
8. For any Efe-owned gate, ask for options/recommendation/risk instead of letting the teammate guess.

## AI Agent Checklist

Before changing code:

- Read `AGENTS.md`.
- Run `git status`.
- Run `mise run doctor` if the application scaffold exists.
- Use `pnpm`, not npm/yarn/bun, unless the task is explicitly about tool comparison.
- Do not add production dependencies without checking existing packages and documenting why.
- Do not bypass backend/database permission checks for UI or bot surfaces.
- Use `agent-browser` for screenshot/preview evidence when the task touches UI, frontend, or user-visible routes.
