# Solo to Team Workflow

Status: operating policy for Atlas startup and team growth  
Audience: Efe, future teammates, and AI coding agents

Atlas starts solo, then grows to a 5-person senior project team:

- Efe Baran Durmaz
- Ali Tarik Sen
- Talha Nalbant
- Elif Iklim Ozbey
- Onat Ozmen

The workflow should be lightweight at the beginning but must not create habits that break when the team joins.

## Phase A: Solo Bootstrap

Use this phase while Efe is creating the first runnable app skeleton.

Allowed:

- Work directly from the local project folder.
- Use a local checklist instead of opening a GitHub issue for tiny setup edits.
- Commit small atomic changes once a Git repo exists.
- Skip PRs only until CI and preview deployments exist.

Still required:

- Keep `main` runnable.
- Use Conventional Commits.
- Keep changes small.
- Run the strongest available local checks.
- Record architecture-affecting decisions in docs.
- Do not commit secrets.

Issue not required for:

- Typos.
- Formatting.
- Local-only notes.
- One-file docs cleanup.
- Mechanical setup while no GitHub repo exists.

Issue required even during solo phase for:

- New product features.
- Database schema.
- Auth, permissions, encryption, or external actions.
- Provider/integration decisions.
- Deployment or CI policy.
- AI behavior changes.
- Anything likely to be handed to another person later.

## Phase B: Solo With Preview Deployments

This begins when Vercel preview deploys are available.

Rules:

- Every UI/API/bot change should go through a branch and PR, even if Efe is the only reviewer.
- Every PR touching `apps/web`, `apps/bot`, API routes, or deployment must include a preview URL or explain why preview was unavailable.
- PR description must include local commands run and preview smoke-test notes.
- Direct pushes to `main` should be limited to emergency docs/process fixes.

Why: preview URLs prevent "works on my machine" drift and create demo evidence for the senior project.

## Phase C: 5-Person Team

This begins when more than one person is regularly committing.

Rules:

- Every feature, bug fix, task, research spike, or architecture decision must have an issue.
- Every code change uses a branch.
- Every branch opens a PR.
- CI must pass before merge.
- Preview URL is required for UI/API/bot changes.
- At least one review is required unless Efe explicitly labels the PR as solo-maintainer fast path.
- CODEOWNERS should be configured when ownership is stable.

## Branch Rules

Preferred branch format:

```text
type/issue-number-short-slug
```

Examples:

```text
feat/12-capture-inbox
fix/33-relation-visibility
spike/41-drizzle-kysely
chore/52-mise-doctor
```

Before GitHub issues exist, use:

```text
type/short-slug
```

Examples:

```text
chore/bootstrap-monorepo
docs/process/owner-onboarding
```

## Commit Rules

Use Conventional Commits:

```text
feat(capture): add upload staging model
fix(permissions): hide private relation edges in shared graph
test(search): add top-three retrieval fixtures
docs(process): define solo-to-team workflow
```

Atomic means one coherent idea, not one file.

Do not mix:

- Formatting and behavior.
- Refactor and feature work.
- UI changes and database migrations.
- Tests for unrelated modules.

## Pull Request Rules

PR required:

- Any UI/API/bot/deployment change after preview deploys exist.
- Any work by a non-Efe teammate.
- Any work by an AI agent that changes code.
- Any change touching permissions, auth, database, AI behavior, integrations, actions, or deployment.

PR optional:

- Solo docs cleanup before GitHub repo setup.
- Tiny typo fixes.
- Local instruction edits that do not change architecture or process.

Every PR must include:

- Linked issue when required.
- What changed.
- Why it changed.
- How it was implemented.
- Tests run.
- Preview URL or local evidence.
- Risks and rollback.
- Senior project explanation target.

## Worktree Rules

Git worktrees are optional for normal solo work.

Use worktrees when:

- Running multiple agents in parallel.
- Working on two independent branches.
- Keeping a risky spike isolated.
- Comparing two implementations.

Do not use worktrees to bypass review or hide messy changes. Each worktree still follows the same branch, commit, test, and PR rules.

## Preview URL Rules

Preview URLs are mandatory evidence for:

- UI changes.
- API route changes.
- Bot/webhook surface changes.
- Deployment config changes.
- Anything that changes user-visible behavior.

PR template entry:

```text
Preview URL:
Smoke test:
Screenshots/video:
Known preview limitations:
```

If preview deploy is unavailable, the PR must say:

```text
Preview unavailable because:
Local verification run:
Follow-up to restore preview:
```

## Consistent Dev Environment

Atlas must avoid "works on my machine" drift.

Required:

- `.mise.toml` pins runtime tools.
- `packageManager` pins pnpm.
- `pnpm-lock.yaml` is committed.
- `mise run doctor` checks required and optional tools separately.
- `.env.example` documents all local env vars without secrets.
- Local fake providers exist for LLM, OCR, object storage, and webhooks where practical.
- `docs/process/provider-and-env-setup.md` defines env modes, provider ownership, fake provider behavior, and secret handoff.

Preferred local service strategy:

- Postgres with pgvector through Docker Compose by default, managed Neon dev branch only when needed.
- Redis through Docker Compose by default.
- Object storage through MinIO for local integration, with filesystem/in-memory fake adapter only for unit tests.
- Temporal through `WorkflowPort` fake adapter early, Docker/local Temporal when ingestion workflow testing starts.
- Deterministic seed data through `mise run db:seed`.

The default `pnpm dev` path should run with fake providers when real credentials are missing. Full integration mode can require provider credentials.

Do not use a shared Hetzner `dev1` server as the primary development path.
Use Vercel previews and local Docker first.
If a shared server becomes necessary, use it only as staging, demo, worker, or integration sandbox after an ADR.

## Provider Account Rules

During solo/bootstrap and early team work, Efe may use personal provider accounts to avoid unnecessary team-seat cost. That is acceptable only if:

- teammates do not need Efe's account password or 2FA
- provider access is handled through scoped env vars, service accounts, preview deployments, or fake providers
- production env/secrets stay Efe-owned unless delegated
- each provider has a documented migration path to a team/org account when needed

Move to team/org accounts when production users, recurring teammate access, compliance review, paid workload scale, or provider terms make personal ownership risky.

## Efe-Owned Decision Gates

When a task reaches one of these, tag/message Efe before continuing:

- Production account setup.
- Provider selection with cost, compliance, or vendor lock-in.
- OAuth scopes or app verification.
- Secrets, encryption keys, KMS, or production env vars.
- Production domain and deployment settings.
- Privacy policy or real user data handling.
- Final brand/logo/visual identity.
- WhatsApp or Apple Messages provider path.
- Real eval dataset source.

Use this message shape:

```text
Decision needed:
Recommended option:
Alternatives:
Risk:
Deadline / blocking work:
```

## Senior Project Evidence

Each team member must have concrete artifacts:

- Issues authored or completed.
- PRs opened or reviewed.
- Preview links or demo screenshots.
- Tests/evals added.
- Decision notes or weekly report entries.

Avoid vague evidence like "helped with frontend." Use linked artifacts.
