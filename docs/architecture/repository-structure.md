# Repository Structure

Status: Phase 0 target contract  
Audience: Efe, future teammates, and AI coding agents

This is a target structure. The Atlas application is NOT yet scaffolded.
No path below exists yet. Read them as the contract the first scaffold must satisfy, not as a map of the current repository.

This document defines the target Atlas application repository. The current folder is the Atlas project knowledge pack / agent operating system. The future app scaffold should implement this structure without weakening the architecture.

## Root

Expected root files:

```text
AGENTS.md
CLAUDE.md
README.md
package.json
pnpm-workspace.yaml
pnpm-lock.yaml
turbo.json
.mise.toml
.env.example
vercel.json
tsconfig.base.json
eslint.config.*
prettier.config.*
commitlint.config.cjs
```

Responsibilities:

- Pin tools and package manager.
- Define root scripts used by humans, CI, and agents.
- Define workspace package boundaries.
- Keep environment examples non-secret.
- Support fake/local provider defaults before real credentials are available.
- Keep agent instructions short and point to detailed docs.

Root scripts must include:

```bash
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

Phase 0 dev dependencies must include `agent-browser@0.31.1` or a newer explicitly verified version. UI, frontend, preview, and PR screenshot evidence should run through `pnpm exec agent-browser` or the global `agent-browser` command during bootstrap.

`mise` must wrap common flows:

```bash
mise run setup
mise run doctor
mise run dev
mise run ci
mise run env:fake
mise run env:decrypt
mise run env:check
mise run db:seed
mise run eval:smoke
```

`mise run env:fake` creates or refreshes an ignored local `.env.local` that works without paid provider secrets.

`mise run env:decrypt` is required only if Atlas enables an encrypted shared dev secret bundle. It must never decrypt production secrets.

`mise run env:check` may call the same implementation as `mise run doctor`, but it should focus on env files, required vars, optional provider vars, and Efe-owned missing secrets. The source of truth is `docs/process/provider-and-env-setup.md`.

## Dependency Direction

Allowed high-level dependency flow:

```text
apps/web      -> packages/api, packages/auth, packages/billing, packages/ui, packages/config
apps/bot      -> packages/api, packages/auth, packages/config
apps/worker   -> packages/ingestion, packages/ai, packages/api, packages/config

packages/api        -> packages/domain, packages/db, packages/auth, packages/ai
packages/ingestion  -> packages/domain, packages/db, packages/ai, packages/config
packages/ai         -> packages/domain, packages/config
packages/auth       -> packages/domain, packages/db, packages/config
packages/billing    -> packages/domain, packages/db, packages/config
packages/db         -> packages/domain, packages/config
packages/evals      -> packages/api, packages/ai, packages/ingestion
packages/okf        -> packages/domain
packages/ui         -> packages/config optional, no server-only imports
packages/domain     -> no infrastructure imports
packages/config     -> no domain imports
```

Forbidden:

- Browser code importing `packages/db`.
- UI package importing app-specific code.
- Domain package importing database clients, LLM SDKs, storage SDKs, or framework APIs.
- Bot service owning a separate permission or memory model.
- Worker writing memory without using shared domain policies and repositories.

## Apps

### `apps/web`

Purpose: Next.js App Router responsive web app and PWA.

Contains:

- Route groups for Today, Inbox, Search, Graph, Objects, Documents, People, Projects, Shared Spaces, Settings.
- App shell with left nav, center surface, right context panel, command palette, and AI composer.
- Server Components for data-heavy read surfaces where appropriate.
- Client Components for interaction-heavy UI.
- PWA offline capture queue and local cache integration.

Must not contain:

- Direct database client imports.
- Direct LLM/OCR/provider calls.
- Permission truth implemented only in components.
- Long-lived business logic that belongs in domain/application services.

README must document:

- Local dev command.
- Required env vars and fake provider behavior.
- How to run in `local-fake` mode without paid providers.
- Route map.
- API boundary.
- Screenshot/preview smoke test checklist.

CI responsibility:

- Typecheck, lint, unit/component tests, build.
- E2E smoke tests when routes exist.

Deployment:

- Vercel web surface.
- Preview URL required for UI/API-facing PRs once Vercel is configured.

### `apps/worker`

Purpose: Durable background workers for ingestion, OCR, embeddings, extraction, suggestions, actions, exports, and eval jobs.

Contains:

- Temporal worker entrypoint or WorkflowPort adapter implementation.
- Workflow registrations.
- Activity adapters for OCR, embeddings, storage, crawler, email/calendar imports, and action drafts.
- Idempotency and retry handling.

Must not contain:

- UI code.
- Provider-specific logic outside adapters.
- Durable state stored only in process memory.

README must document:

- Local worker start command.
- Workflow list.
- Required local services.
- Temporal local dev or `WorkflowPort` fake adapter setup.
- Retry/idempotency rules.
- Observability hooks.

CI responsibility:

- Typecheck, workflow unit tests, integration tests for fake adapters.

Deployment:

- Separate worker runtime from the Next.js request path.
- Temporal Cloud or hosted worker process when production begins.

### `apps/bot`

Purpose: External chat/webhook surface for Slack and later WhatsApp-compatible providers. It may use Vercel Chat SDK where it improves platform adapter DX.

Contains:

- Signed webhook endpoints.
- Platform identity mapping.
- Chat SDK adapter boundary.
- Slack capture/ask proof flow.
- Provider-specific fixtures.

Must not contain:

- Independent memory store.
- Independent permission checks.
- Auto-send or destructive actions.
- Normal iMessage assumptions. Apple Messages path requires Apple Messages for Business/provider feasibility.

README must document:

- Supported platforms.
- Local webhook testing.
- Signature validation fixtures.
- Permission mapping.
- Audit behavior.

CI responsibility:

- Typecheck, webhook signature tests, permission mapping tests.

Deployment:

- Vercel Services route such as `/bot` if the beta prototype passes.
- Otherwise deploy as a separate small service while preserving shared package boundaries.

## Packages

### `packages/domain`

Purpose: Pure Atlas domain model.

Contains:

- Entities, value objects, policies, relation rules, action risk rules.
- Permission invariants and visibility rules as pure logic.
- Zod/domain schemas that are not framework-bound.

Must not contain:

- Database clients.
- Next.js APIs.
- LLM SDK calls.
- Storage or OAuth provider clients.

README must document core concepts and invariants.

### `packages/db`

Purpose: Postgres schema, migrations, repositories, and query helpers.

Contains:

- Drizzle or selected SQL layer schema.
- Migration files.
- Repository implementations.
- Permission-filtered query helpers.
- pgvector and full-text search indexes.

Must not contain:

- React/UI code.
- LLM prompts.
- Provider token business workflows.

README must document migration commands, local database setup, permission-filter rules, and index strategy.

CI responsibility:

- Migration generation/check.
- Schema typecheck.
- Repository tests with test database when available.

### `packages/api`

Purpose: Internal typed API contracts, application services, public REST/OpenAPI surface.

Contains:

- Zod request/response schemas.
- Internal API routers or typed route handlers.
- Application services orchestrating domain, DB, auth, AI, ingestion, and actions.
- Error model and rate-limit boundary.
- Public `/api/v1` OpenAPI definitions.

Must not contain:

- UI components.
- Provider secrets.
- Direct browser-only code.

README must document API layers, error model, auth expectations, and public API versioning.

### `packages/auth`

Purpose: Identity, sessions, OAuth connections, token lifecycle, and auth policies.

Contains:

- Better Auth candidate integration after security spike.
- OAuth token encryption/decryption adapter.
- Refresh, revocation, scope tracking.
- Session and workspace membership helpers.

Must not contain:

- Product feature business logic.
- Secrets in fixtures.

README must document auth flows, OAuth scopes, token storage, and audit events.

### `packages/billing`

Purpose: provider-neutral billing, payment, subscription, checkout, entitlement, and webhook adapter boundary.

Contains:

- `BillingPort` and `PaymentPort`.
- Fixture billing provider for local development and tests.
- Provider adapter interfaces for Stripe, Polar, Lemon Squeezy, Adyen, Basis Theory, BNPL, and regional PSP research.
- Webhook signature verification contracts.
- Audit event mapping for billing and payment state changes.
- Entitlement mapping into Atlas workspace limits.

Must not contain:

- Raw card data.
- Provider admin secrets in source code or fixtures.
- Direct memory-object permission logic.
- Payment logic that bypasses audit logs.

README must document disabled/local billing mode, provider env vars, webhook fixture testing, PCI boundaries, and feature flags for live payment enablement.

### `packages/ai`

Purpose: Model/provider abstraction, structured outputs, RAG orchestration, prompt registry, and AI run logging.

Contains:

- Vercel AI SDK provider wrapper.
- Prompt versions.
- Structured extraction schemas.
- Retrieval answer contracts.
- Fake model provider for local tests.

Must not contain:

- Direct database writes except through application service interfaces.
- Permission bypasses.

README must document prompt versioning, citation requirements, fake provider usage, and eval hooks.

### `packages/ingestion`

Purpose: Capture-to-memory pipeline.

Contains:

- Workflow definitions.
- Parser/OCR/chunker/embedder/extractor/linker ports.
- Idempotency keys.
- Review-card generation.
- Progress events.

Must not contain:

- UI implementation.
- Provider-specific code outside adapters.

README must document pipeline stages, retry semantics, and failure handling.

### `packages/ui`

Purpose: Shared UI primitives and Atlas design system components.

Contains:

- Radix/shadcn-style primitives.
- Buttons, dialogs, sheets, tabs, menus, command palette primitives, cards, form controls.
- Icons and theme tokens.
- Storybook stories, story/demo fixtures, and typed mock states.

Must not contain:

- Feature-specific business logic.
- API calls.
- Database or server-only imports.

README must document component conventions, Storybook usage, accessibility expectations, and visual review requirements.

### `packages/config`

Purpose: Runtime configuration, environment validation, feature flags, logging configuration, and shared constants.

Contains:

- Zod env schemas.
- Environment mode definitions.
- Feature flag names.
- Redaction helpers.

Must not contain:

- Secret values.
- Product business logic.

README must document every env var and which environments require it.

### `packages/evals`

Purpose: AI, retrieval, extraction, sharing, and action-safety eval harness.

Contains:

- Golden datasets.
- Eval runners.
- Metrics definitions.
- Smoke tests.
- Adversarial privacy tests.

Must not contain:

- Real private user data.
- Unredacted production exports.

README must document dataset format, scoring, and `pnpm eval:smoke`.

### `packages/okf`

Purpose: OKF export/import mapping.

Contains:

- Atlas object to OKF markdown/YAML mapping.
- OKF import parser.
- Validation and round-trip tests.

Must not contain:

- Canonical transactional storage.
- Permission enforcement as the only source of truth.

README must document OKF mapping, limitations, and export privacy rules.

## Docs

### `docs/architecture`

Purpose: Product and technical architecture source of truth.

Must include:

- Production spec and plan.
- Technical decisions.
- Frontend, backend, DB, AI, security, UI system.
- Repository structure.

### `docs/process`

Purpose: Operating model.

Must include:

- Onboarding.
- Solo-to-team workflow.
- Owner onboarding.
- Issue, PR, git, deployment, definition of done, senior project log.

### `docs/templates`

Purpose: Repeatable project artifacts.

Must include:

- ADR/RFC templates.
- PR summary.
- Demo report.
- Weekly report.
- Decision log.

### `docs/research`

Purpose: Evidence and source links for technology/process choices.

Rules:

- Prefer official docs and primary sources.
- Include checked date.
- Do not treat research notes as permanent truth; refresh before implementation if a provider/library is volatile.

## Agent And Tooling Directories

### `.claude/skills`

Purpose: Repeatable workflows for Claude Code and compatible agents.

Rules:

- Keep each skill focused.
- Link to docs instead of duplicating long architecture sections.
- Do not encode secrets or live credentials.

### `.cursor/rules`

Purpose: Cursor project rules for persistent constraints.

Rules:

- Keep rules short.
- Avoid contradictions with `AGENTS.md`.
- Update docs when process rules change.

### `.github`

Purpose: GitHub workflow templates and CI.

Contains:

- Issue forms.
- PR template.
- CI workflow.
- CODEOWNERS template.

Rules:

- Treat branch protection, deployment gates, and CI policy as guarded files.
- Do not change `.github` protections without explicit approval.

## Package README Contract

Every `apps/*` and `packages/*` folder must eventually include a README with:

- Purpose.
- Public interfaces.
- What belongs here.
- What does not belong here.
- Local commands.
- Test commands.
- Env vars if any.
- Ownership notes.
- Links to architecture docs and relevant skills.

## CI Ownership

Root CI must run:

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm eval:smoke
```

As the repo matures, add:

- Migration check.
- Security/dependency audit.
- E2E smoke test.
- Preview deployment check.
- Package boundary check.

CI should fail fast for deterministic errors and avoid requiring production credentials.

## Deployment Ownership

Deployment surfaces:

- `apps/web`: Vercel web app.
- `apps/bot`: Vercel Services beta if validated, otherwise separate service.
- `apps/worker`: Temporal worker runtime outside request path.
- Postgres: Neon or equivalent managed Postgres.
- Object storage: S3-compatible adapter.
- Redis: managed Redis.

Efe owns production account setup, production secrets, domain, provider account decisions, and final production deployment approval unless explicitly delegated.

## First Scaffold Acceptance Criteria

The first application scaffold is acceptable only when:

- `mise run setup`, `mise run doctor`, `pnpm dev`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build` exist.
- `agent-browser` is installed or available through `pnpm exec agent-browser`, and `mise run doctor` reports it clearly for UI/preview workflows.
- Root workspace packages compile.
- `apps/web`, `apps/worker`, and package skeletons exist.
- `apps/bot` exists if the external chat proof is in Phase 0/2.5 scope.
- `.env.example` is complete and contains no secrets.
- Fake/local providers let `pnpm dev` run without production credentials.
- CI runs the same core checks as local.
- Evidence bundle paths exist or are documented for screenshots and backend snapshots.
- README files explain each app/package boundary.
