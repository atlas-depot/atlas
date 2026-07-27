# Technical Decisions

## Platform

Decision: responsive web app + PWA first.

Rationale: Atlas must validate memory, permissions, retrieval, and safe actions before multiplying clients. Desktop-friendly web gives most value with less client fragmentation. Native mobile is post-MVP.

## Architecture

Decision: modular monolith.

Rationale: Atlas has tightly coupled domain invariants across memory objects, permissions, relations, actions, and audit logs. Microservices would add distributed consistency risk too early.

## Language

Decision: TypeScript full-stack.

Rationale: shared schemas, typed API contracts, AI structured outputs, frontend/backend consistency, and pnpm monorepo ergonomics.

## Database

Decision: Postgres canonical database with pgvector.

Rationale: Atlas needs relational integrity, permissions, audit logs, source provenance, graph edges, full-text search, and vector retrieval in one transactional system.

## OKF

Decision: OKF is an export/import and agent-readable bundle format.

Rationale: OKF is useful for portability and human-readable memory snapshots, but it is not a transactional permissioned database.

## Product posture

Decision: acting-first second brain. See `docs/architecture/adr-001-acting-first-eve.md`.

Rationale: Atlas is Notion + Obsidian + a proactive cloud agent. Users adopt outcomes (today plan, drafts, follow-ups done), not proof theater (receipts, policy hashes, JSONL audit UIs).

Guardrail: MVP is single-user. Shared spaces are post-MVP. Soft citations are allowed; hard ungrounded gates and approval fatigue are not the product.

## AI

Decision: Eve is the acting brain; async multi-stage ingestion remains a deterministic Workflow SDK pipeline.

Rationale: OCR, parsing, chunking, embedding, extraction, relation linking, and suggestions are long-running, retryable workflows. Conversational and proactive acting need durable agent sessions, tools, schedules, and channels. Eve fits that acting layer. Ingestion should not be a free-form agent loop.

## Agent runtime

Decision: use Eve (`apps/agent`) with web via `useEveAgent`, Workflow SDK durability, P1 tool approvals, S0 no sandbox in MVP.

Rationale: Eve is filesystem-first, TypeScript, Next-friendly, multi-channel, and built on AI SDK + Workflow SDK. Year-1 deploy on Vercel (D3) with Spend Management; documented Hetzner + `@workflow/world-postgres` exit (D2a).

## Durability

Decision: Workflow SDK is the default durability substrate. Temporal is not.

Rationale: Eve and ingestion can share one durability model. Production year-1 uses Vercel Workflow. Local/self-host uses `@workflow/world-postgres`. BullMQ may still back simple queues behind ports if needed, but must not leak into domain code.

## Auth

Decision: own auth and authorization infrastructure with Better Auth as the primary candidate, not Clerk.

Rationale: Atlas needs deep control over user identity, workspace membership, item visibility, OAuth connector tokens, audit logs, export/delete, and private/shared invariants.
Clerk has strong built-in user, organization, session, and billing surfaces, but Atlas should not outsource its core permission model or connector-token lifecycle.
Better Auth is TypeScript-native, framework-agnostic, and plugin-oriented, which better fits a TypeScript modular monolith if the implementation passes a focused security spike.
Auth.js is no longer the preferred default for a new Atlas scaffold because the official Auth.js site now points to Better Auth as the owning project.

Guardrail: Better Auth may handle authentication primitives, but Atlas domain services still own workspace RBAC, item visibility, connector token encryption, audit events, and permission-filtered repositories.

## Billing And Payments

Decision: Atlas should be payment-architecture-ready from day one through `BillingPort` and `PaymentPort`, but live payments remain feature-flagged and outside core memory correctness.

Rationale: Billing should not be retrofitted into identity, workspace limits, or subscription gating later.
Basis Theory is a credible research candidate for PSP independence because its multi-PSP page describes backup PSP routing, agnostic payment vaulting, Elements, proxy access, network tokens, account updater, and 3DS support.
That evidence supports an architecture that avoids hard-coding Stripe, Polar, Lemon Squeezy, Adyen, BNPL, regional PSPs, or Turkey-specific payment providers into Atlas domain logic.

Guardrail: Atlas must not store raw card data or payment credentials in Postgres.
Payment method collection must use PCI-scoped provider elements or a vault provider.
The MVP may ship with billing disabled, but the scaffold should include provider-neutral interfaces, webhook verification patterns, audit events, and test fixtures.

## Realtime

Decision: adapter-based realtime.

Rationale: chat streaming, ingestion progress, shared workspace updates, and presence need realtime transport, but durable state must remain external to WebSocket processes.

## Vercel Services

Decision: evaluate Vercel Services as a deployment packaging layer for `apps/web` and `apps/agent`.

Rationale: Atlas remains a TypeScript modular monolith with one domain model, one canonical Postgres database, and one action authority. Vercel Services may let the web app and Eve agent surface deploy under one Vercel project and domain, but must not create independent memory services. Use the current `services` configuration shape, not the older `experimentalServices` shape.

## External Chat Surfaces

Decision: Eve owns channels. Prefer Eve first-class channels; use Eve’s Chat SDK channel bridge when Eve has no first-class adapter (for example WhatsApp). Web ships first; expand later.

Rationale: Chat SDK answers “how do I talk to this platform?” Eve answers “how do I run the durable agent loop?” Official Vercel guidance: first-class Eve channels by default; Chat SDK channel deliberately. Do not promise normal iMessage support; Apple Messages requires Apple Messages for Business or a validated provider path.

Guardrail: channel adapters must call Atlas domain tools/services. No second memory store. `apps/bot` as a standalone Chat-SDK-only app is superseded by `apps/agent` channels.

## Developer Onboarding

Decision: use `mise` for runtime/tool pinning and team onboarding tasks.

Rationale: Atlas should start professionally with exact Node and pnpm pins, reproducible setup commands, and a `doctor` check that separates required local tools from optional deployment/provider tools. Phase 0 must add `.mise.toml`, `packageManager`, `.env.example`, `scripts/doctor.ts`, and `docs/process/onboarding.md`.

## Provider Accounts And Env

Decision: fake/local providers by default; real providers only through scoped integration, preview, staging, or production env. Efe may use personal provider accounts during bootstrap to control cost, but personal passwords, 2FA, broad dashboard access, and production secrets must not be shared.

Rationale: Atlas needs a consistent dev environment for a solo-to-5-person team without forcing every teammate into paid provider accounts. The architecture should preserve provider adapters, local fake mode, preview evidence, and a migration path to team/org accounts when production, compliance, or access needs justify it. Everyone must be able to run the app with generated fake/local env values. Once the team starts regular development, use a shared dev/integration secret path, preferably a SOPS/age encrypted bundle before paid vault tooling. Do not place production secrets in that bundle, and do not make production runtime credentials part of normal local onboarding.

## Minimal DX Policy

Decision: keep the initial stack narrow and add libraries only when a concrete requirement appears.

Rationale: Start with Next.js, TypeScript, pnpm, Turborepo, Zod, TanStack Query for client server-state, Tailwind, Radix/shadcn-style components, Eve + Vercel AI SDK, Workflow SDK, Postgres, pgvector, and the selected SQL layer.
Do not add GraphQL, tRPC, Zustand, Framer Motion, a separate vector database, Convex primary storage, or Temporal by default.
Minimal means fewer concepts to operate, not cheaper or weaker architecture.

## Frontend Server State

Decision: use TanStack Query from the first scaffold for client-side server-state workflows, while still using Server Components where they clearly reduce client complexity.

Rationale: Atlas has dense interactive surfaces such as inbox review, object inspector, graph filters, search, chat citations, realtime ingestion progress, and shared spaces.
Introducing TanStack Query later would force a second data-fetching migration after these workflows exist.
Using it from the start gives a consistent cache, invalidation, optimistic update, retry, and loading/error-state model.

Guardrail: TanStack Query is for server state.
Do not use Zustand or a global client store for server state.
Do not push business permissions into frontend caches.

## Design Foundation

Decision: add Storybook and code-backed mock surfaces from the first scaffold.

Rationale: Atlas has a dense product UI and will soon move from one founder to a five-person team.
Design decisions must be visible, reusable, and testable rather than trapped in chat or static mockups.
Storybook gives agents and teammates a stable place for tokens, component states, empty/error/loading states, permission-redacted states, action approval states, and screenshot evidence.

Guardrail: Figma, Pencil, paper, or standalone HTML explorations are allowed for early thinking, but they are not source of truth.
The source of truth is the app shell, `packages/ui`, Storybook stories, typed fixtures, and screenshot acceptance criteria.

## Privacy Disclosure

Decision: use deterministic purpose-bound disclosure instead of blanket redaction or unconditional cloud disclosure.

Rationale: Atlas cannot be useful if it destroys or hides the facts needed for memory, planning, reminders, sharing, and actions.
Atlas also cannot be trustworthy if every raw source, secret, identifier, and private message is sent to third-party providers by default.
The correct architecture keeps full authorized memory in Postgres, then computes the minimum sufficient outbound representation for each task.

Guardrail: no LLM decides what is unnecessary.
The domain/security layer owns `DataDisclosurePolicy`.
Models may propose labels, but policy code decides whether exact values, derived values, stable pseudonyms, type markers, or no value are sent.
Secrets, OAuth tokens, refresh tokens, passwords, private keys, session material, raw card data, and CVV are never sent to LLMs.

## OCR

Decision: OCR is a day-one ingestion capability behind `OCRPort`.
Run a fixture-based bakeoff before committing to one cloud OCR provider.

Rationale: OCR quality is product-critical for screenshots, PDFs, invoices, Turkish, and English.
Google Document AI and Azure Document Intelligence both expose document OCR/layout capabilities, but provider quality, price, privacy, and regional constraints must be measured against Atlas fixtures before lock-in.
The app scaffold should include OCR contracts, fixtures, eval metrics, and provider adapter boundaries immediately.

## Local Infrastructure

Decision: use `mise` for tool versions and tasks, Docker Compose for local infrastructure, deterministic seeds for local/demo/eval data, and no shared `dev1` server as the primary development path.

Rationale: `mise` standardizes Node, pnpm, and repo commands.
Docker Compose standardizes Postgres with pgvector, Redis, MinIO, and local Workflow/Eve needs when required.
Deterministic seeds keep onboarding, demos, leakage tests, and eval fixtures reproducible.
A shared Hetzner `dev1` primary environment would create state drift and team-wide breakage.
If Vercel previews and local Docker are insufficient later, `dev1` may be introduced only as staging, demo, worker, or integration sandbox.
