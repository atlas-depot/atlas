# Atlas Owner Onboarding

Status: early-team operating guide  
Audience: anyone taking ownership of an Atlas area

This document answers: "I am responsible for this area. What should I do first?"

Atlas may start with one person, but ownership language still matters because it prevents agents and contributors from guessing across boundaries.

Efe Baran Durmaz is the bootstrap lead and product owner: he kicks off the application scaffold, owns product direction, and is the default decision point for provider/account/secrets/compliance/brand gates. This is not meant as a rigid hierarchy inside the team. It is a clarity rule: when a decision can create cost, compliance, privacy, deployment, or product-direction risk, do not guess.

Atlas may start on Efe-owned personal provider accounts to control cost. This is allowed during bootstrap, but it does not mean teammates should use Efe's passwords, 2FA, production dashboards, or broad secrets. Normal work should run on fake/local providers, preview URLs, or scoped integration secrets. See `docs/process/provider-and-env-setup.md`.

## Default Owner Gates

Efe Baran Durmaz is the default owner for these decisions unless ownership is explicitly delegated later:

- Vercel, Neon, Redis, Workflow/Eve hosting, and deployment account setup.
- Google OAuth app setup, Gmail/Calendar scopes, verification, and compliance.
- Billing/payment provider selection, PCI scope, payment vault, PSP routing, and live payment enablement.
- Object storage provider selection.
- OCR/document intelligence provider selection.
- WhatsApp provider selection.
- Apple Messages for Business or iMessage feasibility.
- Production domain, production environment variables, and secrets.
- Real eval dataset and privacy policy.
- Final UI brand direction, logo, and visual identity.

When work reaches one of these gates, stop broad implementation and tag/message Efe with:

```text
Decision needed:
Context:
Options:
Recommendation:
Risk if deferred:
Link to issue/PR:
```

Do not invent account setup, production credentials, compliance answers, provider contracts, or brand decisions.

## Universal First Steps

Every owner starts here:

1. Read `AGENTS.md`.
2. Read `docs/architecture/atlas-production-spec-and-plan.md`.
3. Read `docs/process/onboarding.md`.
4. Read `docs/process/provider-and-env-setup.md`.
5. Run `mise run doctor` once the app repo exists.
6. Find or create the smallest issue for the work.
7. Identify whether the work touches permission, AI, database, deployment, external providers, or user data export/delete.
8. If it touches an Efe-owned gate, ask before implementing that part.

## UI Design Owner

Owns:

- Product surface hierarchy.
- Layout, visual system, density, empty/error states, accessibility, keyboard flows.
- Today dashboard, capture inbox, search, graph, object inspector, shared spaces, settings/privacy center.

Does not own:

- Backend permission truth.
- AI extraction correctness.
- Provider credentials.
- Final brand/logo without Efe approval.

Read:

- `docs/architecture/ui-system.md`
- `docs/architecture/frontend.md`
- `.claude/skills/atlas-design/SKILL.md`
- `.cursor/rules/50-ui.mdc`

First useful tasks:

- Produce the app shell layout spec.
- Define reusable UI primitives in `packages/ui`.
- Create route-level empty/error/loading/unauthorized states.
- Define screenshot requirements for PRs.
- Require `agent-browser` screenshots for implemented UI and preview evidence.

Acceptance bar:

- Every memory object shows visibility and provenance.
- Every AI answer has source affordance.
- Every action has risk and approval state.
- UI can be used with keyboard-first workflows.

## Frontend Owner

Owns:

- Next.js app structure.
- Domain feature folders.
- Typed API client usage.
- UI integration with server data.
- PWA/offline capture UX.

Does not own:

- Domain permission policy.
- Direct LLM/provider calls from the browser.
- Auth token storage.

Read:

- `docs/architecture/frontend.md`
- `docs/architecture/ui-system.md`
- `.claude/skills/atlas-frontend/SKILL.md`
- `.cursor/rules/10-frontend.mdc`

First useful tasks:

- Scaffold `apps/web`.
- Add layout shell, navigation, context panel, and command palette skeleton.
- Add capture inbox route and object inspector route skeletons.
- Wire typed API mocks before real backend services exist.

Acceptance bar:

- Loading, empty, error, unauthorized, and offline states exist.
- Business logic is not buried in React components.
- Frontend never acts as the source of permission truth.

## Backend/API Owner

Owns:

- Application services.
- API handlers.
- Domain module boundaries.
- Provider ports/adapters.
- Action and audit orchestration.

Does not own:

- Database schema changes without DB review.
- Secret/account setup without Efe.
- UI-specific state decisions.

Read:

- `docs/architecture/backend.md`
- `docs/architecture/security.md`
- `.claude/skills/atlas-backend/SKILL.md`
- `.cursor/rules/20-backend.mdc`

First useful tasks:

- Define service boundaries for workspaces, capture, memory, graph, search, chat, actions, sharing.
- Add Zod request/response contracts.
- Add typed error model.
- Add audit log service.

Acceptance bar:

- API handlers validate and delegate.
- Services own business rules.
- External providers are behind adapters.
- Every write is attributable.

## Database and Permissions Owner

Owns:

- Postgres schema.
- Migrations.
- Relation visibility.
- pgvector and full-text search storage.
- Repository access scopes.

Does not own:

- Product UI.
- Provider credentials.
- LLM prompt behavior except persistence/eval traces.

Read:

- `docs/architecture/db.md`
- `docs/architecture/security.md`
- `.claude/skills/atlas-db/SKILL.md`
- `.cursor/rules/30-db.mdc`

First useful tasks:

- Run Drizzle vs Kysely spike.
- Create core schema foundation.
- Add relation endpoint visibility tests.
- Add leakage fixtures.

Acceptance bar:

- Permission filters are centralized.
- Private/shared leakage tests exist.
- JSONB is not used as a lazy replacement for relational fields.
- Destructive migrations require Efe approval and rollback plan.

## AI/Ingestion/Eval Owner

Owns:

- AI provider ports.
- Ingestion workflow.
- Structured extraction schemas.
- RAG pipeline.
- Prompt/model metadata.
- Evals.

Does not own:

- Provider account setup without Efe.
- Permission filtering implementation without backend/DB alignment.
- Ungrounded memory answers.

Read:

- `docs/architecture/ai.md`
- `docs/architecture/security.md`
- `.claude/skills/atlas-ai/SKILL.md` (includes the Evals section)
- `.cursor/rules/40-ai.mdc`

First useful tasks:

- Add fake-model provider and structured output schemas.
- Add ingestion workflow skeleton with retry/idempotency.
- Add golden dataset shape.
- Add citation coverage tests.

Acceptance bar:

- Retrieval permission-filters before ranking.
- Insufficient evidence returns the required unknown answer.
- AI writes are validated, auditable, and reversible where practical.
- Non-trivial AI changes add eval/smoke coverage.

## Security and Privacy Owner

Owns:

- Threat model review.
- OAuth/token handling.
- Encryption/redaction/audit requirements.
- Private/shared leakage checks.
- Export/delete safety.

Does not own:

- Weakening product scope to avoid security work.
- Provider compliance answers without Efe.

Read:

- `docs/architecture/security.md`
- `.claude/skills/atlas-security/SKILL.md`
- `.cursor/rules/70-security.mdc`

First useful tasks:

- Define `AccessScope` review checklist.
- Define OAuth token encryption contract.
- Add unauthorized-access adversarial test cases; shared-space cases when sharing ships.
- Add audit event matrix.

Acceptance bar:

- Search, chat, graph, suggestions, exports, and notifications share permission logic.
- Secrets never appear in code, tests, logs, fixtures, screenshots, or PRs.
- Risky external writes require explicit confirmation and audit logs.

## DX/Deploy Owner

Owns:

- `mise` setup.
- `doctor` command.
- CI pipeline.
- Preview deployment workflow.
- Vercel Services prototype.

Does not own:

- Production account credentials unless Efe delegates.
- Provider choice for core paid services unless Efe delegates.

Read:

- `docs/process/onboarding.md`
- `docs/process/provider-and-env-setup.md`
- `docs/process/deployment-policy.md`
- `.claude/skills/atlas-deploy/SKILL.md`

First useful tasks:

- Add `.mise.toml`, `.env.example`, and `scripts/doctor.ts`.
- Make `pnpm dev`, `pnpm ci`, and `pnpm eval:smoke` deterministic.
- Implement `local-fake` and `local-integration` env modes from `docs/process/provider-and-env-setup.md`.
- Ensure every UI/API PR can produce a preview URL.
- Add pinned `agent-browser@0.31.1` or a verified newer version for screenshot/preview evidence.

Acceptance bar:

- Clean machine setup is reproducible.
- Optional tools are reported separately from required tools.
- Local development works without paid provider credentials.
- Missing Efe-owned provider secrets are reported with the exact owner/request protocol.
- Preview URL or documented local evidence exists for every UI/API/agent PR.
- `agent-browser` is available for UI/frontend/preview evidence and checked by `doctor`.

## Agent Channels / Integrations Owner

Owns:

- `apps/agent` Eve channels and tool wiring to Atlas services.
- Eve first-class channels and Chat SDK channel bridge when needed.
- Slack expand after web-first.
- WhatsApp and Apple Messages pathway research.

Does not own:

- Platform account/compliance setup without Efe.
- Independent memory systems outside Atlas Postgres/domain.

Read:

- `docs/architecture/adr-001-acting-first-eve.md`
- `docs/architecture/atlas-production-spec-and-plan.md`
- `docs/architecture/ai.md`
- `docs/process/onboarding.md`
- `.claude/skills/atlas-ai/SKILL.md`
- `.claude/skills/atlas-backend/SKILL.md`

First useful tasks:

- Add `apps/agent` Eve shell with fake model.
- Wire web `useEveAgent` rewrite/proxy.
- Add signed webhook fixture tests when a channel ships.
- Write WhatsApp and Apple Messages feasibility note.

Acceptance bar:

- Bot routes validate provider signatures.
- Bot identity maps to Atlas workspace membership before memory access.
- Bot calls the same application services as web.
- Bot responses preserve citations, risk levels, and audit trails.
