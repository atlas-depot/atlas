---
name: atlas-bootstrap
description: Create or review the Phase 0 Atlas runnable app scaffold, including pnpm monorepo, mise, Docker Compose local infra, env fake/decrypt/check, deterministic seeds, CI, first web shell, worker shell, billing/auth boundaries, and preview readiness. Use when standing up the app scaffold for the first time, or when the monorepo, local infra, env, seeds, or CI setup needs review or repair.
---

# Atlas Bootstrap Skill

Use this skill only for the first real application scaffold or a major scaffold repair.
This is not a generic implementation skill.

## Required Reading

Read:

- `AGENTS.md`
- `docs/process/agent-alignment.md`
- `docs/process/engineering-standards.md`
- `docs/process/onboarding.md`
- `docs/process/provider-and-env-setup.md`
- `docs/process/solo-to-team-workflow.md`
- `docs/architecture/technical-decisions.md`
- `docs/architecture/repository-structure.md`
- `docs/architecture/security.md`
- `docs/architecture/privacy-redaction-policy.md`
- `docs/architecture/frontend.md`

## Scope

Bootstrap creates the minimum correct runnable foundation.
It does not implement full product features.

Must include:

- pnpm workspace and Turborepo.
- `.mise.toml` with pinned Node and pnpm.
- Root commands: `dev`, `lint`, `typecheck`, `test`, `build`, `storybook`, `db:generate`, `db:migrate`, `db:studio`, `eval:smoke`.
- `mise` tasks: `setup`, `doctor`, `dev`, `ci`, `storybook`, `env:fake`, `env:decrypt`, `env:check`, `db:seed`, `eval:smoke`.
- Docker Compose for local Postgres with pgvector, Redis, MinIO, and Temporal when enabled.
- `.env.example` and generated fake/local `.env.local` path.
- Optional SOPS/age shared dev secret path, with no production secrets.
- Deterministic seed data for local, demo, leakage, and eval fixtures.
- `apps/web` shell.
- `apps/worker` shell.
- `apps/bot` shell or spike only.
- `packages/domain`, `packages/db`, `packages/api`, `packages/auth`, `packages/billing`, `packages/ai`, `packages/ingestion`, `packages/ui`, `packages/config`, `packages/evals`, `packages/okf`.
- Better Auth candidate boundary, not final unreviewed auth lock-in.
- TanStack Query setup for client-side server state.
- Storybook setup for `packages/ui`, component states, design tokens, and typed mock screens.
- Vercel AI SDK provider wrapper plus deterministic fake provider for tests and CI.
- OCR port and fixture bakeoff scaffold.
- BillingPort and PaymentPort scaffold with no live payments by default.
- CI workflow for install, lint, typecheck, test, build, migration check, env check, and eval smoke.

## Guardrails

- Do not use a shared `dev1` server as the primary dev path.
- Do not require production secrets for local development.
- Owner gates: see docs/process/agent-alignment.md, section Efe-Owned Gates.
- Do not store raw card data or payment credentials in Postgres.
- Do not bypass backend/database permission enforcement.
- Do not make Clerk, Stripe, Basis Theory, Polar, or any provider a hard dependency without an ADR or spike result.
- Do not optimize for setup speed over correctness.
- Standards: see AGENTS.md.
- Do not treat static Figma/Pencil/paper/HTML explorations as source of truth until translated into Storybook stories and route mockups.
- Do not send secrets or raw sensitive values to external providers while testing the scaffold.

## Workflow

1. Confirm this is the future runnable application scaffold, not only the knowledge pack.
2. Run `git status --short` if this is a git repo.
3. Create the monorepo skeleton and package boundaries.
4. Add tool pinning and root scripts.
5. Add env contract and fake env generator.
6. Add Docker Compose local infra.
7. Add DB schema stub, migration command, and deterministic seed command.
8. Add auth, billing, AI, OCR, storage, workflow, and provider adapter stubs.
9. Add web shell with navigation and placeholder surfaces.
10. Add worker shell and fake workflow path.
11. Add CI and verification commands.
12. Run the strongest available local checks.
13. Produce a bootstrap report with commands, gaps, and first follow-up issues.

## Verification

Run when available:

```bash
mise run setup
mise run env:fake
mise run env:check
mise run dev:infra
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm storybook
pnpm db:generate
pnpm db:seed
pnpm eval:smoke
```

If a command does not exist yet, create it or explain why it is intentionally deferred.

## Output

```text
Bootstrap verdict: Ready | Partial | Blocked

Created:
- ...

Commands available:
- ...

Verification:
- ...

Deferred by design:
- ...

Efe decisions needed:
- ...

First follow-up issues:
- ...
```
