# Provider And Environment Setup

Status: Phase 0 operating runbook  
Audience: Efe, DX/deploy owner, integration owners, and AI coding agents

Atlas must be easy to run locally without turning every teammate into an infrastructure admin. Real provider accounts, paid services, OAuth verification, production secrets, and compliance-sensitive decisions are Efe-owned unless explicitly delegated.

## Decision

Use fake/local providers by default. Use real providers only in targeted integration mode, preview, staging, or production.

Do not require production credentials for normal local development.

Every teammate must have a working local environment. If only Efe's machine works, the onboarding model has failed.

The team-working env decision:

1. Everyone can run Atlas with a generated `local-fake` `.env.local`.
2. Once more than one teammate is regularly working, everyone can use the shared dev secret path if their issue needs it.
3. Shared real credentials are dev/integration-only and never production.
4. Shared dev secrets must come from an approved secret-sharing path, not chat, screenshots, PR comments, or copied plaintext files.
5. Real provider access must remain scoped, revocable, and documented.

Do not commit `.env.vault` or any encrypted env bundle until Atlas has chosen a specific vault workflow. A vault or encrypted bundle is useful only when several teammates need recurring secret access. Before that, the lowest-risk path is:

- committed `.env.example` for the contract
- ignored `.env.local` for local overrides
- fake/local provider defaults for most work
- Vercel environment variables for preview/staging/production
- Efe-owned scoped secrets for integration tasks

## Bootstrap Account Model

Efe may use personal provider accounts during the senior-project/MVP bootstrap to avoid unnecessary team-seat cost. This is acceptable if it is treated as a formal constraint, not an accidental shortcut.

Allowed:

- Efe owns Vercel, Neon, Redis, Workflow/Eve hosting, object storage, OCR, Google OAuth, WhatsApp, Apple Messages, AI provider, and production-domain setup unless delegated.
- Teammates use local fake providers for ordinary frontend/backend work.
- Integration owners request only the specific secret needed for the issue.
- Preview deployments and CI use provider env stores, not local files.
- Service accounts, project tokens, and least-privilege keys are preferred over personal passwords.

Forbidden:

- Sharing Efe's personal account password or 2FA.
- Committing copied `.env.local` files, screenshots with secrets, provider dashboards with secrets, or raw token logs.
- Making production provider changes from a teammate's local machine unless explicitly approved.
- Assuming an integration is ready because it works against a personal sandbox account.

Risk:

- Personal accounts create bus-factor, billing, ToS, audit, ownership-transfer, and OAuth-verification risk.

Mitigation:

- Keep provider choices behind adapters.
- Keep a migration note for each provider that says how to move from Efe personal account to organization/team account.
- Keep teammates productive through local fakes and preview URLs.
- Promote to team/org accounts when production users, external collaborators, paid workloads, or compliance reviews require it.

## Environment Modes

| Mode | Purpose | Secrets | Owner |
| --- | --- | --- | --- |
| `local-fake` | Default local development. | None beyond generated local secrets. | Any developer. |
| `local-integration` | One real provider under test. | Scoped provider secret from Efe. | Integration owner + Efe. |
| `test` | Unit/integration tests. | Fake values only. | Repo. |
| `preview` | PR validation and demos. | Vercel/project env store. | Efe or delegated DX owner. |
| `staging` | Production-like validation. | Provider env store. | Efe. |
| `production` | Real users/data. | Provider env store/KMS. | Efe. |

## Env Files

Committed:

- `.env.example`: complete non-secret contract.
- `.env.test.example` only if test env differs meaningfully from local.

Ignored:

- `.env`
- `.env.local`
- `.env.*.local`
- `.env.integration.local`
- `.env.vercel.local`
- `.vercel/`

Rules:

- Every env var in code must appear in `.env.example` with a safe placeholder.
- Required vars must have a short comment explaining where they come from.
- Optional provider vars must have fake/local fallback behavior where practical.
- `mise run doctor` must report missing required vars and optional provider vars separately.
- `pnpm dev` should default to fake providers if real credentials are missing.

## Secret Vault Policy

Start without a SaaS env vault while Atlas is solo. When the team begins regular development, enable a shared dev secret path so everyone's local environment can run the same integration paths without depending on Efe's machine.

For the senior-project phase, prefer a repo-committed SOPS/age encrypted dev secret bundle over paid team-seat secret tooling:

- `secrets/atlas-dev.sops.yaml` may be committed only if encrypted with SOPS.
- Each teammate contributes an age public key.
- Efe or the delegated DX/security owner encrypts dev/integration secrets to the approved recipients.
- `mise run env:decrypt` decrypts the bundle into ignored `.env.local`.
- `mise run env:check` verifies required vars and reports missing access.
- Production, staging, and payment/compliance-sensitive secrets must not live in this bundle.

This is not free security. It requires key rotation when a teammate leaves, careful recipient review, and a clear rule that encrypted dev secrets are still sensitive.

Introduce a vault when at least two of these are true:

- more than one teammate needs recurring real-provider access
- secrets rotate often
- preview/staging/prod env drift becomes hard to audit
- integration work is blocked by manual secret handoff
- compliance requires auditable secret sharing

Acceptable future options:

- 1Password shared vault for small-team human secret sharing.
- Infisical or Doppler for app/env secret sync if Atlas needs a dedicated developer-secrets platform.
- SOPS/age only if the team wants Git-managed encrypted secrets and accepts the operational overhead.

Do not adopt a vault just to look professional. Adopt it when it removes actual risk or friction.

Decision rule:

- Solo or fake-only team work: no vault, generated `.env.local`.
- Team begins regular shared development: SOPS/age encrypted dev bundle for development/integration secrets.
- Team needs managed access logs, UI, CI sync, or frequent rotation: 1Password, Infisical, or Doppler ADR.
- Production runtime secrets: Vercel/provider env stores or managed secret infrastructure, not SOPS dev bundle.

## Vault Access Model

Vault can be active for everyone, but not with one flat access level.

Recommended scopes:

| Scope | Who can access | Allowed use |
| --- | --- | --- |
| `dev` | All active teammates. | Local development, fake-compatible integrations, localhost OAuth, capped AI/OCR/crawler keys. |
| `integration` | Teammates working on relevant issues. | Real provider tests against sandbox/dev resources. |
| `preview` | Efe or delegated DX/deploy owner. | Vercel preview env values and safe demo data. |
| `staging` | Efe and explicitly delegated owners. | Production-like validation with no real user data unless approved. |
| `production` | Efe by default; delegated only by explicit decision. | Runtime deployment secrets, production DB/storage/OAuth/provider credentials. |

Allowed production interaction for teammates:

- Use the deployed app like a normal user or test user.
- Call public production APIs with a normal user/session token when a test plan requires it.
- Inspect production behavior through approved dashboards/screenshots/log excerpts that do not expose secrets or private user data.

Forbidden by default:

- Local `.env.local` containing production DB URLs, production object-storage write keys, production OAuth client secrets, production provider admin tokens, or production webhook signing secrets.
- Running local scripts directly against production data stores.
- Letting AI agents hold or use production secrets.
- Sharing one production token across the team because it is convenient.

The invariant: shared dev secrets keep the team unblocked; production secrets protect real users, auditability, billing, and reversibility.

## Provider Matrix

| Area | Local default | Real provider path | Env contract | Efe-owned gate |
| --- | --- | --- | --- | --- |
| Postgres + pgvector | Docker Postgres with pgvector or Neon dev branch. | Neon or equivalent managed Postgres. | `DATABASE_URL`, optional `DIRECT_DATABASE_URL`. | Production DB, branch policy, migration safety. |
| Redis | Local Redis or fake cache adapter. | Managed Redis. | `REDIS_URL`. | Managed instance and production sizing. |
| Workflow SDK / Eve | Local Workflow world or `@workflow/world-postgres`; Eve fake/local model. | Vercel Workflow + Eve on Vercel (D3); Hetzner/`eve start` exit (D2a). | `WORKFLOW_WORLD`, Postgres URL for workflow world when used, Eve/AI model vars, optional `AI_GATEWAY_API_KEY`. | Vercel project Spend Management, workflow retention, self-host exit if needed. |
| Object storage | Local file adapter or MinIO. | R2/S3-compatible bucket. | `STORAGE_PROVIDER`, `S3_ENDPOINT`, `S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_FORCE_PATH_STYLE`. | Provider choice, bucket creation, lifecycle, public access policy. |
| Auth/session | Local Better Auth-compatible secret and local database records. | Better Auth candidate after security spike, with Google OAuth connector support. | `AUTH_SECRET`, `AUTH_URL`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`. | Auth provider decision, Google OAuth app, scopes, verification. |
| Gmail/Calendar | Fixture importer. | Google APIs through OAuth connection. | Google OAuth vars plus scope config. | Gmail/Calendar scopes, compliance. |
| AI/LLM | Fake model provider and deterministic fixtures. | OpenAI primary, Vercel AI Gateway optional. | `AI_PROVIDER`, `OPENAI_API_KEY`, optional `AI_GATEWAY_BASE_URL`. | Paid key, model policy, retention policy. |
| OCR/document intelligence | Fake OCR or local fallback for tests. | Cloud OCR selected by Efe. | `OCR_PROVIDER`, provider key vars. | Provider choice, language quality, privacy mode. |
| Link ingestion | Deterministic extractor. | Optional Firecrawl/Exa/browser provider behind adapter. | `CRAWLER_PROVIDER`, provider key vars. | Paid crawler provider. |
| Realtime | No durable in-memory state; local event adapter. | WebSocket provider or Vercel-compatible route after review. | `REALTIME_PROVIDER`, provider key vars. | Provider and production deployment model. |
| Slack/bot | Local signed webhook fixtures. | Slack app/provider integration. | `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET`, `SLACK_SIGNING_SECRET`. | App setup and external workspace access. |
| Billing/payments | Disabled or fixture provider. | PaymentPort/BillingPort with provider-neutral adapters; Basis Theory is a research candidate for multi-PSP vaulting. | `BILLING_PROVIDER`, `PAYMENT_PROVIDER`, provider-specific test keys. | Payment provider selection, PCI scope, billing launch, tax/compliance. |
| WhatsApp | Disabled/fake webhook fixtures. | Provider selected after feasibility. | Provider-specific vars only after ADR. | Provider choice and compliance. |
| Apple Messages | Disabled. | Apple Messages for Business/provider feasibility only. | None until approved. | Feasibility and account approval. |
| Observability | Console logs and local traces. | Sentry/OpenTelemetry collector. | `SENTRY_DSN`, `OTEL_EXPORTER_OTLP_ENDPOINT`. | Production monitoring account. |
| Vercel | Not required for `pnpm dev`. | Vercel project with previews. | Vercel dashboard/CLI env, optional `VERCEL_TOKEN` for automation. | Project, domains, previews, prod deploy. |

## `.env.example` Shape

Phase 0 scaffold should group env vars by service:

```bash
# App
APP_ENV=local
APP_URL=http://localhost:3000

# Auth
AUTH_SECRET=dev-only-change-me
AUTH_URL=http://localhost:3000
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=

# Database
DATABASE_URL=postgres://atlas:atlas@localhost:5432/atlas
DIRECT_DATABASE_URL=

# Redis
REDIS_URL=redis://localhost:6379

# Workflow / Eve
WORKFLOW_WORLD=local
# When using @workflow/world-postgres, point at a Postgres URL (may share Neon).
WORKFLOW_DATABASE_URL=
EVE_AGENT_URL=http://localhost:3001

# Storage
STORAGE_PROVIDER=local
S3_ENDPOINT=
S3_BUCKET=
S3_REGION=auto
S3_ACCESS_KEY_ID=
S3_SECRET_ACCESS_KEY=
S3_FORCE_PATH_STYLE=true

# AI
AI_PROVIDER=fake
OPENAI_API_KEY=
AI_GATEWAY_BASE_URL=

# OCR
OCR_PROVIDER=fake

# Realtime
REALTIME_PROVIDER=local

# Observability
SENTRY_DSN=
OTEL_EXPORTER_OTLP_ENDPOINT=
```

This is a starting contract, not final production config.

## Local Services

Phase 0 should support two local tracks:

1. Minimal local: app + fake providers.
2. Full local: app + Postgres + Redis + Workflow/Eve local world + object storage emulator.
3. Shared dev integration: full local plus decrypted dev/integration secrets when approved.

`mise run setup` may install dependencies and print service instructions. It must not create paid cloud resources.

`mise run setup` should be able to create a usable `.env.local` from `.env.example` with fake providers and generated local-only secrets.

`mise run env:decrypt` should exist only after an encrypted shared dev bundle exists. It must refuse to overwrite `.env.local` unless explicitly confirmed or unless it writes to a temporary file first and validates it.

`mise run doctor` must check:

- pinned Node and pnpm versions
- `.env.local` presence
- required local env vars
- whether fake providers are active
- whether Postgres/Redis/Workflow world are reachable when full local mode is selected
- whether optional tools such as `gh`, `vercel`, `agent-browser`, `neonctl`, `temporal`, and Docker exist
- whether SOPS/age are installed if encrypted shared dev secrets are configured
- who to contact when a missing value is Efe-owned

## Shared Dev Secret Bundle

Use this only when fake/local providers are no longer enough for a teammate's issue.

Allowed contents:

- Development-only Google OAuth client for localhost.
- Development-only OpenAI or AI Gateway key with strict spend limits.
- Development-only OCR/crawler key with strict quota limits.
- Development-only Slack signing secret or webhook fixture secret.
- Development database branch URL if it contains no production data.

Forbidden contents:

- Production database URL.
- Production OAuth client secret.
- Production object storage write keys.
- Personal provider login credentials.
- 2FA backup codes.
- Real user data export links or private datasets.
- Any key without quota/spend limits when the provider supports limits.

Expected future files:

```text
.sops.yaml
secrets/README.md
secrets/atlas-dev.sops.yaml
```

Expected future commands:

```bash
mise run env:fake
mise run env:decrypt
mise run env:check
```

`mise run env:fake` creates or refreshes a fake/local `.env.local`.

`mise run env:decrypt` decrypts shared dev secrets into `.env.local` after confirming the caller has the right recipient key.

`mise run env:check` validates the current `.env.local` and reports whether the app is in `local-fake`, `local-integration`, or invalid mode.

## Provider Request Protocol

When a teammate or agent needs a real provider:

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

Efe should respond with one of:

- approved with scoped secret
- use fake provider for now
- use preview/staging only
- blocked until provider/account/compliance decision

## Preview Env Rules

- Preview env vars live in Vercel/project env store.
- PRs must not require reviewers to have local production-like secrets.
- Preview smoke tests should prove the route works with safe preview data.
- If a preview depends on a missing provider env, the PR must say exactly which env var is missing and whether it is Efe-owned.
- UI preview evidence should use `agent-browser`.
- Backend preview evidence should use request/response, audit/event, workflow, DB/query, or redacted log snapshots.

## Migration To Team Accounts

Move from Efe personal accounts to team/org accounts when:

- production users exist
- billing or quota risk becomes material
- provider terms require organizational ownership
- teammates need durable access
- compliance review begins
- investor/customer demo requires account continuity

Each provider ADR should include:

- current owner account
- resource names
- secrets stored where
- data migration path
- billing migration path
- rollback plan
- risks if Efe is unavailable
