# AGENTS.md

These are project-wide instructions for AI coding agents working on Atlas.

## Project

Atlas is a living second brain for knowledge workers. It captures messy digital inputs, turns them into structured memory objects and typed relationships, retrieves them with grounded AI, surfaces proactive next actions, and supports safe sharing.

Efe Baran Durmaz is the bootstrap lead and product owner. This does not create a day-to-day hierarchy for engineering work, but it does make Efe the decision source for product scope, kickstarting the application scaffold, provider accounts, production secrets, compliance-sensitive setup, final branding, and senior project coordination unless ownership is explicitly delegated.

Before non-trivial work, read `docs/process/agent-alignment.md` and use the relevant `.claude/skills/atlas-*` workflow. The skills and hooks are advisory alignment layers; they do not override the user's latest instruction or these non-negotiables.

Provider and environment setup follows `docs/process/provider-and-env-setup.md`. Local development should work with fake/local providers by default. Do not request or use Efe's personal provider passwords, 2FA, broad dashboard access, or production secrets.

Engineering standards follow `docs/process/engineering-standards.md`.
Prefer quality, simplicity, robustness, scalability, security, and long-term maintainability over development cost.
If scope becomes too large, cut feature scope instead of weakening architecture.

## Non-negotiable architecture

- Use TypeScript full-stack.
- Use a pnpm monorepo.
- Use a modular monolith, not microservices.
- Use PostgreSQL as the canonical system of record.
- Use pgvector for MVP vector search.
- Use OKF only as a portable export/import format.
- Build responsive web + PWA first. Do not build native mobile in MVP.
- Enforce private/shared memory permissions in backend and database access layer, not only in UI.
- Ground AI answers in source memory items and citations.
- Use async workflows for ingestion, extraction, embeddings, OCR, and suggestions.
- Require explicit confirmation for risky external actions.

## Commands

Prefer these commands. Do not invent package managers.

```bash
pnpm install
pnpm dev
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm db:generate
pnpm db:migrate
pnpm db:studio
pnpm db:seed
pnpm eval:smoke
```

If a command is missing, add it to `package.json` in the correct package and document it.

## Project structure

Expected structure:

```text
apps/web
apps/worker
apps/bot
packages/db
packages/domain
packages/api
packages/ai
packages/ingestion
packages/auth
packages/billing
packages/ui
packages/config
packages/evals
packages/okf
docs/architecture
docs/process
docs/templates
docs/research
```

Use domain-oriented modules. Avoid dumping unrelated utilities into generic folders.
See `docs/architecture/repository-structure.md` for package responsibilities, README expectations, CI ownership, and deployment ownership.

## Code style

- Strict TypeScript.
- No `any` unless justified in a comment and localized.
- Runtime validation at API boundaries with Zod or equivalent.
- Prefer named exports.
- Prefer explicit domain names over abbreviations.
- No hidden global state for business logic.
- No secrets in code, logs, fixtures, screenshots, or tests.
- No raw payment credentials or card data in Atlas Postgres.
- No unreviewed production dependencies.
- No em dash character in repo text.
- Do not manually edit generated files or `CHANGELOG.md`; run the generator or document why it cannot be run.

## Git workflow

- Follow `docs/process/solo-to-team-workflow.md`.
- After the application scaffold exists, every meaningful code change must link to an issue.
- Branch names: `type/issue-number-short-slug`, for example `feat/42-capture-inbox`.
- Commits must be atomic and use Conventional Commits.
- Commit messages must not add an agent name as co-author.
- PRs must be small enough to review in one focused sitting.
- Do not mix unrelated changes in one PR.
- Do not commit generated files unless the repo policy explicitly requires them.
- Do not push directly to `main`.

## Definition of done

A task is done only when:

- Implementation matches the issue acceptance criteria.
- Tests cover the main behavior and important failure cases.
- CI passes.
- Lint, type, test, and flaky-test failures are fixed or explicitly tracked with evidence.
- Permissions and privacy implications are checked.
- AI behavior is grounded, logged, and evaluated when applicable.
- UI changes include screenshots or preview link.
- PR explains what changed, why, how, tests run, and what the author learned.

## Boundaries

Never modify these without explicit user approval:

- Production secrets or environment files.
- Database migrations that drop or rewrite user data.
- Auth, permission, or encryption code.
- External action execution code.
- CI deployment gates.
- Files under `.github/` that change repository protections.

When uncertain, stop and ask for the smallest clarifying question.
