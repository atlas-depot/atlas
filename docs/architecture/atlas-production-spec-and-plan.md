# Atlas Production Specification and Implementation Plan

Status: v0.2 architecture baseline (acting-first + Eve)  
Date: 2026-07-27 Europe/Istanbul  
Owner: principal architecture draft  
Canonical ADR: `docs/architecture/adr-001-acting-first-eve.md`

## 0. Evidence Check

This spec was checked against the current project docs in `docs/architecture/*` and the external docs/specs below. The current repository folder is an Atlas agent operating system / project knowledge pack: it contains architecture, process, skills, rules, templates, and GitHub scaffolding before the application codebase is generated.

Official docs checked:

- Next.js App Router: https://nextjs.org/docs/app
- Vercel AI SDK: https://ai-sdk.dev/docs/introduction
- Eve: https://eve.dev/ and https://vercel.com/docs/eve
- Eve + Chat SDK: https://vercel.com/kb/guide/chat-sdk-and-eve
- Workflow SDK / Vercel Workflows: https://workflow-sdk.dev/ and https://vercel.com/docs/workflows
- Vercel WebSockets: https://vercel.com/docs/functions/websockets
- Vercel Services: https://vercel.com/docs/services
- Neon pgvector: https://neon.com/docs/extensions/pgvector
- Google OAuth 2.0: https://developers.google.com/identity/protocols/oauth2
- OKF v0.1 Draft: https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md

Evidence-driven adjustments:

- Next.js App Router remains the right web framework because the official docs position it around React Server Components, Suspense, Server Functions, layouts, and route handlers.
- Eve is the acting-agent runtime. AI SDK remains underneath Eve for model I/O. Web composer uses `useEveAgent`, not a separate Chat SDK or AI SDK UI stack as the brain.
- Chat SDK is a transport/card layer and an optional Eve channel bridge for surfaces without first-class Eve channels (for example WhatsApp). It is not Atlas’s memory backend or primary web composer.
- Vercel Functions now document WebSocket support, but Next.js still requires an `experimental_upgradeWebSocket()` workaround for upgrade handling. Atlas must keep realtime behind a transport adapter and be ready to use Ably, Liveblocks, PartyKit, Pusher, Supabase Realtime, or a small dedicated WebSocket service.
- Vercel WebSocket docs explicitly warn that reconnects may land on different function instances and state must be reloaded. This confirms the invariant: WebSockets are transport only; durable state lives in Postgres/Redis/Workflow SDK.
- Vercel Services is beta and uses the `services` field in `vercel.json`. Useful for packaging `apps/web` and `apps/agent`, not for splitting domain ownership into microservices.
- Neon pgvector docs support pgvector in Neon Postgres and document HNSW/IVFFlat choices. Use pgvector for MVP; introduce a separate vector DB only after measured retrieval or scale failure.
- Google OAuth docs emphasize scopes, granted-scope comparison, refreshing tokens when needed, and incremental authorization. OAuth must be treated as a lifecycle subsystem, not a login checkbox.
- Workflow SDK (Vercel Workflow in prod; `@workflow/world-postgres` local/self-host) is the durability default for Eve sessions and deterministic ingestion. Temporal is not the default.
- OKF v0.1 Draft remains export/import only, not canonical storage.
- Product posture is acting-first: outcomes over proof theater. Soft citations (G1). P1 approvals. M1 auto memory writes. R0 single-user MVP. S0 no sandbox default. D3 year-1 Vercel with Hetzner exit.

## 1. Product and Scope Clarification

Atlas is an acting second brain for messy digital context. It ingests files, links, notes, screenshots, emails, calendar items, reminders, messages, and documents; turns them into typed memory objects and typed relations; retrieves them with soft citations when useful; surfaces proactive next actions; and executes useful work through Eve tools on that memory.

MVP scope:

- Responsive web app and PWA.
- Auth and single-user workspace (sharing post-MVP).
- Capture for files, PDFs, images, screenshots, links, notes, tasks, reminders, Gmail import, and Calendar import.
- Async Workflow SDK ingestion pipeline with parsing, OCR fallback, chunking, embeddings, extraction, relation linking, summaries, rare low-confidence review, and suggestions.
- Object-based memory, typed relation graph, object inspector, document library, search, Eve-powered chat with soft citations, and Today dashboard.
- Acting agent in `apps/agent` (Eve): internal tasks/reminders and external drafts auto; real external writes confirm once (P1).
- Web-first Eve client; channel expand later via Eve first-class channels and Chat SDK bridge when needed.
- OKF export/import as a portable snapshot format.
- Golden eval dataset focused on useful acting, tool correctness, and secret non-leakage.

Post-MVP:

- Shared spaces and selective sharing.
- Native iOS/Android clients through public REST/OpenAPI.
- Full local-first sync or CRDT memory.
- Browser extension, desktop wrapper, richer team workflows, public links, write-capable Gmail/Calendar automation at higher autonomy, local/private model mode, specialized OCR/document intelligence, graph analytics.
- Broader external chat adapters and optional P2 classifier-style auto-review.
- Optional S1 code-mode / sandbox.

Rejected ideas:

- Proof/receipt/policy-hash product surfaces: rejected; users verify outcomes in the real world (mailbox, calendar), not JSONL.
- Chat-only product with no durable memory model: rejected.
- Convex as primary database: rejected.
- Separate vector database in MVP: rejected until pgvector fails measured targets.
- GraphQL-first: rejected.
- Native mobile in MVP: rejected.
- Full local-first CRDT sync in MVP: rejected.
- Automatic destructive external actions: rejected.
- OKF as canonical storage: rejected.
- Separate memory systems per chat platform: rejected.
- Temporal as default durability: superseded by Workflow SDK / Eve (ADR-001).
- Standalone `apps/bot` Chat-SDK-only brain: superseded by `apps/agent` Eve channels.
- Consumer iMessage bot promise: rejected until Apple Messages for Business/provider path is validated.
- Cloudflare Workers as Eve host: rejected; Eve self-host is Node/Nitro/container (for example Hetzner).

## 2. Architecture Decision Record

Platform: responsive web + PWA first, desktop-friendly web primary. Native clients later through REST/OpenAPI.

Frontend: Next.js App Router, React, TypeScript, Tailwind, Radix primitives, shadcn-style components, React Hook Form, Zod, URL state, React state, TanStack Query for client-side server state, and typed API clients. Web AI composer uses Eve (`useEveAgent`) against `apps/agent`. Server Components are preferred for data-heavy read screens; Client Components own interaction-heavy surfaces. Do not add Zustand or Framer Motion by default.

Backend: TypeScript modular monolith. Domain modules define entities, policies, invariants, and ports. Application services orchestrate use cases. Repositories isolate database access. Eve tools are adapters into those services. Other adapters isolate LLMs, OCR, OAuth providers, object storage, realtime, and crawlers.

Database: PostgreSQL is canonical. Default to Drizzle ORM for schema-first TypeScript migrations and typed queries, but gate it with an early database spike covering pgvector, full-text search, typed relation edges, and migration ergonomics. If Drizzle creates friction, switch early to Kysely. Do not use Prisma for Atlas core unless a later ADR proves it.

AI / agent: Eve is the acting brain. Ingestion is a multi-stage deterministic Workflow SDK pipeline with prompt versioning, structured outputs, soft provenance, confidence, rare review states, and eval traces. No single-shot "upload then summarize" architecture. No free-form agent loop for ingestion.

Realtime: transport adapter. Prefer SSE for one-way progress where sufficient; WebSockets only for bidirectional features. Durable state stays in Postgres/Redis/Workflow SDK.

Queue/workflow: Workflow SDK is the default for durable Eve sessions and ingestion. Production year-1: Vercel Workflow. Local/self-host: `@workflow/world-postgres`. BullMQ/Redis may back simple queues behind ports if needed, but must not leak into domain code. Temporal is not the default.

Deployment: Vercel for `apps/web` and year-1 `apps/agent` (D3) with Spend Management; Neon for Postgres; S3/R2 for object storage; managed Redis when needed; GitHub Actions CI; Vercel previews; documented Hetzner/VPS exit for agent (D2a). Optional Vercel Services packaging must not weaken the modular monolith or canonical Postgres model.

Security: connector secrets and OAuth tokens never go to models or logs. Encrypt tokens at application level with envelope encryption. Payment credentials and raw card data must not be stored in Atlas Postgres. MVP does not ship shared spaces; when sharing returns, enforce visibility in services/repositories.

Convex: optional prototype/realtime experiment only. It must not own durable memory, graph, audit, migrations, OAuth state, or canonical data.

OKF: export/import baseline only.

Mobile: PWA first. Native apps are out of MVP.

External chat surfaces: Eve channels in `apps/agent`. Prefer first-class Eve channels; use Chat SDK channel bridge when needed. Expand after web.

Developer onboarding: use `mise` for exact runtime/tool pins and repo tasks. Phase 0 must add `.mise.toml`, `packageManager: pnpm@11.9.0`, Node `24.18.0` LTS, a `doctor` command, `.env.example`, and `docs/process/onboarding.md`. Missing optional tools must be reported as optional, not block local development.

Billing and payments: Atlas should be payment-architecture-ready through `BillingPort` and `PaymentPort`, but live payments stay feature-flagged and out of the core memory MVP. Provider-specific PSPs such as Stripe, Polar, Lemon Squeezy, Adyen, Basis Theory, BNPL, and regional providers must not leak into domain logic. Basis Theory is a research candidate for multi-PSP vaulting, not an automatic dependency.

## 3. System Architecture

```text
Browser/PWA
  -> Next.js apps/web (useEveAgent + product UI)
  -> rewrite/proxy to apps/agent Eve routes
  -> Eve tools -> Atlas application services
  -> Domain modules
  -> Repositories
  -> Postgres/pgvector + object storage + Redis

External chat clients (post web-first expand)
  -> Eve first-class channels and/or Chat SDK channel bridge in apps/agent
  -> Same Eve tools -> Atlas application services

apps/agent (Eve)
  -> Durable sessions (Vercel Workflow year-1; @workflow/world-postgres local/exit)
  -> Tools, skills, schedules
  -> Soft citations + P1 approvals

apps/worker
  -> Workflow SDK deterministic ingestion pipeline
  -> OCR, embeddings, extraction, linking, suggestion materialization
  -> AI/OCR/crawler/storage/provider adapters
  -> Postgres + object storage

Realtime adapter
  -> SSE/WebSocket/provider transport
  -> Redis pub/sub or persisted event stream
  -> Clients reload durable state from APIs

External systems
  -> Google OAuth/Gmail/Calendar
  -> Chat platform webhooks and OAuth installs
  -> LLM providers
  -> OCR providers
  -> Crawler/parser providers
  -> S3/R2
```

Chat lifecycle:

1. User asks from Eve-powered composer with workspace and optional object context.
2. Eve session turns run durably; tools call Atlas application services.
3. Retrieval/search tools return memory candidates; UI may show soft source links (G1).
4. Disclosure policy still minimizes what leaves Atlas toward model providers.
5. Eve streams the answer; operator traces may store tool/model metadata for evals (not a user-facing proof product).
6. Follow-up actions run as typed tools under P1 approval rules.

Ingestion lifecycle:

1. Capture API stores source, file metadata, raw object storage reference, idempotency key.
2. Workflow SDK pipeline starts or resumes by capture id.
3. Parser extracts text and metadata; OCR runs when needed.
4. Normalizer creates canonical text, chunks, embeddings, entity/relation/object candidates, summaries, tasks, dates, decisions, waiting items, and follow-ups.
5. Linker matches people/projects/objects with confidence; only low-confidence or conflicts create Inbox review items (M1).
6. Memory writer persists objects, versions, chunks, embeddings, relation edges, and suggestions.
7. Realtime emits progress; clients reload final state from APIs. Proactive Eve schedules may refresh Today.

Action lifecycle:

1. Eve tool or user proposes an action with source basis and risk level.
2. Atlas action service classifies risk.
3. Level 0–2 auto-run (read, internal write, external draft). Level 3 parks for short confirm. Level 4 forbidden.
4. External provider adapter executes only through typed tools after P1 rules pass.
5. Operator-facing run metadata may be stored for debugging/evals; do not productize receipts.

Sharing lifecycle:

MVP: single-user only (R0). Post-MVP sharing returns with server-side visibility enforcement.

Realtime lifecycle:

1. Domain event is persisted or published after commit.
2. Redis/pub-sub or provider adapter broadcasts lightweight event envelope.
3. Client receives event and refetches authoritative state.
4. Reconnects resubscribe and reload missed state using cursors; no durable state is kept in the socket process.

External chat lifecycle:

1. Platform webhook reaches `apps/agent` Eve channel (first-class or Chat SDK bridge).
2. Channel normalizes the message into an Eve session turn.
3. Identity maps to the Atlas user/workspace connection.
4. Same Eve tools and Atlas services as web.
5. Reply renders through the channel’s native UI (including P1 confirm controls when needed).

## 4. UI Specification

Main navigation:

- Left sidebar: workspace switcher, Today, Inbox, Search, Graph, Projects, People, Documents, Shared Spaces, Settings.
- Center surface: route-specific primary view.
- Right context panel: object inspector, citations, source preview, related items, memory changes, suggested actions, approvals.
- Global command palette: capture, ask, search, create task, create reminder, open object, jump to project/person, start action.
- Persistent AI composer: available across major screens, never replaces dashboard/search/graph/object surfaces.

Today dashboard:

- Cards: Today, Waiting On, Deadlines, Suggested Actions, Recent Changes, Forgotten Follow-ups, Active Projects, People to Reply To, Documents Needed, Shared Updates.
- Every card item shows source, visibility, confidence, status, and action affordance.

Capture inbox:

- Queue of captures with raw preview, extracted objects, relation candidates, confidence, errors, and review state.
- Actions: accept all, edit, reject, split, merge, choose among 2-3 alternatives when confidence is low.

Chat surface:

- Threaded memory-grounded assistant with source cards, chunk citations, retrieval trace toggle for dev/admin, and action proposal cards.
- Ungrounded answers must be explicitly labeled ungrounded.

Search surface:

- Hybrid result list with facets for type, project, person, source, date, status, visibility, confidence.
- Result cards show title, summary, matched chunks, citations, relation hints, and open-in-inspector action.

Graph surface:

- Nodes are memory objects. Edges are typed relations.
- Required filters: person, project, date, source, visibility, relation type, confidence.
- Clicking a node opens inspector; clicking edge opens relation detail and correction controls.

Object inspector:

- Universal side sheet for any object type.
- Shows title, summary, payload, source, citations, relations, versions, visibility, confidence, audit history, suggestions, and actions.
- Full object routes exist for deep links and shared spaces.

Shared spaces:

- Explicit selected memory only.
- Shared view shows included objects, visible relation graph, updates, members, role, and redaction indicators when relations/private sources are hidden.

Settings and privacy center:

- Account, workspaces, members, OAuth connections, scopes, sync status, token revocation, private mode, exports, deletion, audit log, AI data controls, feature flags.

Empty states:

- Empty Today: quick capture, connect Gmail/Calendar, upload PDF, create task.
- Empty Search: suggest filters and capture.
- Empty Graph: explain that graph appears after relations are extracted.
- Empty Shared Space: add selected objects, never broad share.

Error states:

- No vague toasts for important failures. Show recoverable action, retry, audit id, source/provider error category, and privacy-safe details.

## 5. Database Schema

Global fields:

- Multi-tenant tables include `workspace_id`, `created_at`, `updated_at`, and when relevant `deleted_at`.
- User-authored and AI-authored records include `created_by`, `created_by_kind`.
- Public APIs expose stable ids, not raw internal assumptions.

Core tables and key fields:

- `users`: id, email, name, avatar_url, timezone, locale, created_at.
- `accounts`, `sessions`: Better Auth candidate-compatible auth records after security spike.
- `oauth_connections`: id, user_id, workspace_id, provider, scopes_granted, scopes_requested, access_token_ciphertext, refresh_token_ciphertext, token_expires_at, revoked_at, last_refresh_at, sync_cursor, status.
- `workspaces`: id, name, slug, owner_user_id, default_visibility, created_at.
- `workspace_members`: workspace_id, user_id, role, status, invited_by, joined_at.
- `sources`: id, workspace_id, type, provider, external_id, uri, title, captured_at, provenance, metadata.
- `file_blobs`: id, storage_provider, bucket, key, size, content_type, sha256, encryption_key_ref, created_at.
- `files`: id, workspace_id, source_id, file_blob_id, filename, content_type, page_count, status, metadata.
- `memory_objects`: id, stable_id, workspace_id, owner_user_id, type, title, summary, body, payload_json, source_id, visibility, confidence, status, schema_version, metadata, archived_at, deleted_at, created_at, updated_at.
- `memory_object_versions`: id, object_id, version, changed_by, changed_by_kind, change_reason, snapshot_json, diff_json, created_at.
- `chunks`: id, workspace_id, source_id, object_id, ordinal, text, token_count, page_number, start_offset, end_offset, visibility, metadata.
- `embeddings`: id, workspace_id, chunk_id, object_id, model, dimensions, embedding vector, created_at.
- `entity_mentions`: id, workspace_id, chunk_id, object_id, entity_type, canonical_text, span, confidence, linked_object_id.
- `relation_edges`: id, workspace_id, from_object_id, to_object_id, relation_type, confidence, created_by, created_by_kind, source_id, evidence_chunk_ids, visibility, metadata, created_at, deleted_at.
- `tags`, `object_tags`: workspace-scoped tags and joins.
- `tasks`, `events`, `reminders`, `decisions`, `projects`, `people`, `conversations`, `messages`: typed extension tables keyed by `object_id` when object-specific fields are needed.
- `ai_runs`: id, workspace_id, run_type, prompt_version, model, provider, input_source_ids, output_json, validation_errors, confidence, redaction_policy, token_count, cost, created_objects, created_relations, created_at.
- `suggestions`: id, workspace_id, type, title, rationale, source_object_ids, evidence_chunk_ids, risk_level, status, confidence, expires_at.
- `actions`: id, workspace_id, type, risk_level, status, source_object_ids, evidence_chunk_ids, proposed_payload, required_approval, rollback_path, created_by.
- `action_runs`: id, action_id, provider, status, request_metadata, response_metadata, error_code, started_at, completed_at.
- `approvals`: id, action_id, requested_by, approved_by, status, approval_text, decided_at.
- `shared_spaces`: id, workspace_id, name, owner_user_id, status, created_at.
- `shared_space_items`: shared_space_id, object_id, added_by, added_at, permission_snapshot.
- `audit_logs`: id, workspace_id, actor_id, actor_kind, event_type, target_type, target_id, source_ip_hash, metadata_redacted, created_at.
- `okf_exports`: id, workspace_id, requested_by, scope, status, file_blob_id, manifest_json, created_at, completed_at.
- `eval_datasets`, `eval_runs`: golden item manifests, expected outputs, metric results, model/prompt versions.

Indexes:

- B-tree: workspace_id, owner_user_id, type, status, visibility, created_at, updated_at, source_id.
- Composite: `(workspace_id, type, status)`, `(workspace_id, visibility)`, `(workspace_id, source_id)`, `(workspace_id, from_object_id)`, `(workspace_id, to_object_id)`.
- Full-text: generated `search_vector` on memory object title/summary/body and chunk text with GIN.
- Trigram: optional `pg_trgm` for fuzzy title/person/project search.
- Vector: start exact scan for small datasets; add HNSW on `embeddings.embedding` by model/dimension when measured chunk count and latency justify it.
- Partial: active/non-deleted objects and active relation edges.

Permission model:

- Repository APIs accept an explicit `AccessScope` derived from user, workspace membership, role, shared space, and item visibility.
- Queries must filter objects, chunks, embeddings, relations, suggestions, chat sources, exports, graph nodes, and shared space items through the same scope.
- Relation visibility requires both endpoints visible to the viewer.
- Shared-space summaries cannot derive from hidden objects.

Audit model:

- Audit every auth event, OAuth connection/scope change, capture, AI extraction, memory write/version, relation write, share/unshare, export, deletion, action approval, provider action run, and admin/dev data access.

## 6. API Specification

Internal typed APIs:

- `auth.me`, `workspace.list/create/update`, `member.list/update`.
- `capture.create/upload/commit/listReview/updateReview`.
- `object.list/get/update/archive/delete/versions`.
- `relation.create/update/delete/listGraph`.
- `search.query`, `chat.stream`, `today.get`, `suggestion.list/update`.
- `action.propose/approve/reject/run`, `integration.connect/list/revoke/sync`.
- `sharedSpace.create/update/addItem/removeItem/list/get`.
- `okf.export/request/download/import/validate`.

Public REST `/api/v1`:

- `GET /me`
- `GET/POST /workspaces`
- `GET /workspaces/{workspaceId}/objects`
- `POST /workspaces/{workspaceId}/captures`
- `GET /workspaces/{workspaceId}/objects/{objectId}`
- `PATCH /workspaces/{workspaceId}/objects/{objectId}`
- `GET /workspaces/{workspaceId}/relations`
- `POST /workspaces/{workspaceId}/search`
- `POST /workspaces/{workspaceId}/chat`
- `GET/POST /workspaces/{workspaceId}/shared-spaces`
- `POST /workspaces/{workspaceId}/actions`
- `POST /workspaces/{workspaceId}/actions/{actionId}/approvals`
- `POST /workspaces/{workspaceId}/exports/okf`
- `GET /workspaces/{workspaceId}/audit-logs`

External chat/bot routes:

- `POST /bot/slack/events`
- `GET /bot/slack/oauth/callback`
- `POST /bot/whatsapp/events` when a supported WhatsApp provider is selected.
- `POST /bot/telegram/events`, `POST /bot/discord/events`, `POST /bot/gchat/events`, `POST /bot/teams/events` only after the adapter is enabled.
- Bot routes are not public Atlas APIs. They are provider webhook endpoints and must validate signatures/secrets before dispatching to application services.

WebSocket/SSE event envelope:

```ts
type AtlasRealtimeEvent = {
  id: string;
  workspaceId: string;
  type:
    | "capture.created"
    | "ingestion.started"
    | "ingestion.progress"
    | "ingestion.completed"
    | "ingestion.failed"
    | "memory.object.created"
    | "memory.object.updated"
    | "relation.created"
    | "relation.removed"
    | "suggestion.created"
    | "action.approval_required"
    | "action.started"
    | "action.completed"
    | "action.failed"
    | "shared_space.updated";
  subjectId: string;
  sequence: number;
  occurredAt: string;
  payload: Record<string, unknown>;
};
```

Error model:

- Use `problem+json` for REST: `type`, `title`, `status`, `code`, `detail`, `request_id`, `audit_id`, `retryable`, `field_errors`.
- Never return provider secrets or raw LLM prompts in errors.

Auth model:

- Session cookies for web.
- Authentication through Better Auth candidate or equivalent after security spike.
- Atlas owns workspace RBAC, item visibility, OAuth connector token lifecycle, and audit events.
- Provider import tokens stored in `oauth_connections`, separate from login accounts.
- Public API later uses scoped API tokens or OAuth app model; not in MVP unless needed.
- External chat installs use provider-specific OAuth/webhook secrets and must map platform users/channels to Atlas workspaces before any memory access.

Rate limiting:

- Per user/workspace/IP for capture, chat, search, action approval, export, and WebSocket upgrade requests.
- Lower limits for expensive AI/OCR endpoints.

## 7. AI Specification

Provider abstraction:

- `LanguageModelPort`, `EmbeddingPort`, `StructuredExtractionPort`, `OCRPort`, `RerankPort`, `CrawlerPort`, `RedactionPort`.
- Provider implementations live in adapters; domain code depends only on ports.

Prompt versioning:

- Prompt ids: `ingest.object-classify.v1`, `ingest.entity-extract.v1`, `ingest.relation-extract.v1`, `rag.answer.v1`, `suggest.today.v1`, `action.propose.v1`.
- Store prompt version, model, provider, source ids, redaction policy, output, validation errors, created object ids, created relation ids, and confidence in `ai_runs`.

Structured output schemas:

- `ObjectCandidate`: type, title, summary, body, payload, source_id, evidence_chunk_ids, confidence, alternatives.
- `RelationCandidate`: from_ref, to_ref, relation_type, evidence_chunk_ids, confidence, direction_rationale.
- `TaskCandidate`: title, due_at, assignee_ref, waiting_on_ref, project_ref, evidence_chunk_ids, confidence.
- `SuggestionCandidate`: title, type, rationale, source_object_ids, evidence_chunk_ids, urgency, confidence.
- `ActionProposal`: action_type, risk_level, proposed_payload, source_object_ids, evidence_chunk_ids, required_approval, rollback_path.

Extraction pipeline:

- Parse/OCR -> normalize -> chunk -> embed -> classify -> extract entities -> extract relations -> detect task/date/decision/waiting/follow-up -> link to existing objects -> confidence -> review card or write -> suggestions.

RAG pipeline:

- Permission filter first.
- Structured filters.
- Full-text search.
- Vector similarity.
- Optional rerank.
- Citation selection.
- Answer generation constrained to evidence.
- Store retrieval trace.

Citation rules:

- Every memory-grounded claim needs at least one source object/chunk.
- Soft citations (G1): prefer tappable source links. If nothing relevant was retrieved, say so plainly; do not invent private memory facts.
- UI must render citations next to claims or in a visible source panel.

Memory write rules:

- High-confidence extracted facts can auto-create memory objects.
- Low-confidence, conflicting, or privacy-sensitive writes go to review.
- User corrections create versions and audit logs.
- AI cannot silently overwrite user-edited fields.

Action risk rules:

- Level 0: read-only retrieval.
- Level 1: internal safe write.
- Level 2: external draft.
- Level 3: external write requiring explicit confirmation.
- Level 4: destructive or irreversible external action, forbidden in MVP.

Evaluation strategy:

- Golden dataset: 100 mixed items, 50 retrieval questions, 30 extraction examples, 20 relation examples, 20 Today scenarios, 10 private-sharing adversarial tests, 10 unknown-answer tests.
- Required metrics: >=85% top-3 retrieval, >=80% useful entity/relation extraction, 100% citation coverage for grounded answers, zero known private-to-shared leakage.

## 8. Security and Privacy Specification

Threat model:

- Private memory leakage through search/chat/graph/suggestions/shared spaces.
- Relation edge revealing hidden private object.
- AI summary leaking private source into shared context.
- OAuth token theft, over-scoped tokens, refresh failures, revoked tokens.
- Prompt/log leakage to providers.
- Provider webhook/API spoofing.
- Unauthorized action approval or external write.
- Forged chat-platform webhook events or replayed bot actions.
- Chat adapter identity mismatch causing one workspace's memory to appear in another platform channel.
- Ingestion replay or duplicate writes.
- Export exposing hidden/shared-ineligible memory.

Permission invariants:

- Private objects visible only to owner unless explicitly shared.
- Shared spaces expose only selected objects and visible endpoint relations.
- Search, chat, graph, suggestions, exports, notifications, and realtime payloads use the same access scope.
- Admin/dev-only visibility must not exist in production data paths.

OAuth token handling:

- Least privilege and incremental scopes.
- Store granted scopes and compare against required scopes before every sync.
- Encrypt refresh/access tokens with app-level envelope encryption.
- Store token expiry, refresh attempts, revoked status, sync cursors, and audit events.
- Revoke and delete tokens on user request.
- Chat platform tokens and signing secrets follow the same envelope encryption, least privilege, rotation, revocation, and audit requirements as Google OAuth connections.

Redaction and disclosure:

- Follow `docs/architecture/privacy-redaction-policy.md`.
- Keep full authorized memory in canonical Postgres records.
- Apply deterministic purpose-bound disclosure before cloud LLM, OCR, crawler, bot, log, screenshot, fixture, PR, export, or shared-space artifacts.
- No model decides what is unnecessary or safe to disclose.
- Redact or withhold secrets, tokens, credentials, financial account numbers, raw card data, CVV, and session material before logs and cloud LLM calls.
- Prefer derived values and stable pseudonyms when exact values are not required.
- Private mode disables or minimizes cloud AI for selected objects.

Encryption:

- OAuth tokens/secrets: application-level envelope encryption.
- Raw files: encrypted object storage.
- Searchable memory text: secured Postgres access controls, audit, optional private mode; do not app-encrypt all text if it breaks search.
- Sensitive extracted fields: encrypted or redacted by field classification.

Export/delete:

- User export from day one through OKF snapshots.
- Deletion must cover Postgres objects, relation edges, embeddings, chunks, files, cached local data, exports, and provider tokens where applicable.
- Deletion workflow is auditable and idempotent.

## 9. Implementation Roadmap

Phase 0: repo setup and CI  
Acceptance: pnpm workspace, Turborepo, Next app, worker app, packages, `.mise.toml`, exact Node/pnpm pins, `doctor` command, `.env.example`, onboarding doc, lint/typecheck/test/build scripts, GitHub Actions scaffold, no secret leaks.

Phase 1: auth, workspace, DB schema  
Acceptance: Better Auth candidate login or selected equivalent, workspace membership, Drizzle schema/migrations, permission service, seed data, unit tests for RBAC and visibility.

Phase 2: capture and file storage  
Acceptance: note/link/file capture, S3/R2 adapter, file metadata, idempotency, upload flow, audit events, local offline capture queue.

Phase 2.5: external chat proof surface  
Acceptance: `apps/agent` Eve shell, web `useEveAgent` client, optional Vercel Services packaging for web+agent, first-class or Chat SDK bridge channel path documented for later Slack/WhatsApp expand, webhook signature validation when channels ship, identity mapping, P1 tool approvals. Apple Messages/iMessage remains research-only.

Phase 3: ingestion pipeline  
Acceptance: Workflow SDK adapter, parse/OCR/chunk/embed/extract/link pipeline, resumable jobs, retry policy, progress events, M1 rare review.

Phase 4: memory objects and graph  
Acceptance: object CRUD, versioning, relation CRUD, graph query, relation visibility tests, inspector data contract.

Phase 5: search and RAG  
Acceptance: permission-first hybrid retrieval, citations, chat stream, "I do not know" behavior, retrieval traces, top-3 eval harness.

Phase 6: dashboard and suggestions  
Acceptance: Today dashboard cards, suggestion generation, status updates, source basis, confidence, no private leakage.

Phase 7: safe actions  
Acceptance: action registry, risk classifier, approval UI, internal tasks/reminders, email/calendar drafts, audit logs, Level 4 forbidden.

Phase 8: shared spaces  
Acceptance: create shared space, add selected objects, role-based view, redacted relation handling, second-user private-source leakage E2E.

Phase 9: evals, hardening, deployment  
Acceptance: golden dataset, eval smoke command, security tests, migration checks, Vercel preview, optional Vercel Services prototype for web+agent, staging config, observability, Spend Management notes, incident/debug docs.

## 10. First 26 GitHub Issues

1. `chore(repo): initialize pnpm monorepo and Turborepo`  
Goal: create executable repo baseline. Files: `package.json`, `pnpm-workspace.yaml`, `turbo.json`, `apps/web`, `apps/agent`, `apps/worker`, `packages/*`. Acceptance: listed commands exist. Tests: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` run against minimal compilable package skeletons.

2. `chore(dx): add mise tool pins and onboarding doctor`  
Goal: make team onboarding one-command and version-stable. Files: `.mise.toml`, `package.json`, `.env.example`, `scripts/doctor.ts`, `docs/process/onboarding.md`. Acceptance: Node `24.18.0`, pnpm `11.9.0`, `mise run setup`, `mise run doctor`, `mise run dev`, and `mise run ci` are defined; required and optional missing tools are reported separately. Tests: run `mise run doctor` on a clean machine profile or mocked shell environment.

3. `chore(ci): add baseline GitHub Actions pipeline`  
Goal: deterministic CI. Files: `.github/workflows/ci.yml`, `docs/process/*`. Acceptance: install, lint, typecheck, test, build, migration check, and dependency audit jobs are defined. Tests: run workflow locally where possible or validate YAML.

4. `feat(config): add typed environment configuration`  
Goal: typed env loading and secret boundaries. Files: `packages/config`. Acceptance: Zod env schemas for local/preview/staging/prod. Tests: missing/invalid env unit tests.

5. `spike(db): validate Drizzle against Atlas retrieval invariants`  
Goal: prove Drizzle works for pgvector, full-text search, typed relations, permission-filtered retrieval, and migrations before committing the ORM. Files: `packages/db/spikes/*`, `docs/architecture/technical-decisions.md`. Acceptance: Drizzle and Kysely comparison includes real SQL for embeddings, HNSW/IVFFlat index, FTS, relation endpoint visibility, and migration rollback notes. Tests: run the spike queries against local Postgres with pgvector.

6. `feat(db): add selected schema foundation`  
Goal: create core schema and migrations after the ORM spike. Files: `packages/db/src/schema/*`, ORM config. Acceptance: users, workspaces, members, objects, sources, files, chunks, embeddings, relations, audit logs. Tests: migration generate/check.

7. `feat(auth): implement web authentication baseline`  
Goal: session auth with Google sign-in. Files: `packages/auth`, `apps/web/src/app/api/auth/*`. Acceptance: login/logout/session/me. Tests: auth route and session tests.

8. `feat(workspaces): add workspace membership and RBAC policies`  
Goal: owner/admin/member/viewer access. Files: `packages/domain/workspaces`, `packages/api/workspaces`. Acceptance: role checks and membership APIs. Tests: unit tests for every role.

9. `feat(permissions): add repository access scope layer`  
Goal: one permission path for objects/search/chat/graph/share. Files: `packages/domain/permissions`, `packages/db/repositories`. Acceptance: private/shared/workspace filters. Tests: leakage unit tests.

10. `feat(storage): add object storage adapter`  
Goal: S3/R2-compatible file blob storage. Files: `packages/ingestion/storage`, `packages/domain/storage`. Acceptance: put/get/signed upload/delete metadata. Tests: local fake adapter tests.

11. `feat(capture): create capture API and inbox model`  
Goal: note/link/file captures with idempotency. Files: `packages/api/capture`, `packages/domain/capture`, `apps/web/src/features/capture`. Acceptance: create/list/review captures. Tests: duplicate idempotency and validation tests.

12. `chore(deploy): prototype Vercel Services for web and agent`  
Goal: validate `apps/web` and `apps/agent` under one Vercel project without changing domain boundaries. Files: `vercel.json`, `apps/web`, `apps/agent`, `docs/process/deployment-policy.md`. Acceptance: uses current `services` configuration when useful, web UI + Eve routes, local rewrite/proxy documented, Spend Management noted, no memory state outside Postgres/Redis. Tests: `vercel dev` smoke or documented fallback.

13. `feat(agent): add Eve acting shell`
Goal: create Eve agent app with tools calling Atlas services. Files: `apps/agent`, Eve `agent/` tree, `packages/domain` tool ports. Acceptance: local Eve session works with fake model, web can attach via rewrite/proxy, tools cannot bypass domain services, sandbox off (S0). Tests: fake-provider agent smoke and tool unit tests.

14. `feat(agent): add Slack channel expand`  
Goal: optional post-web Slack channel expand via Eve. Files: `apps/agent/agent/channels`, Atlas identity mapping. Acceptance: Slack turn can capture/ask/act through the same tools as web; soft source links when useful; P1 confirms for external writes. Tests: signed webhook fixture and tool-path tests.

15. `spike(agent): evaluate WhatsApp and Apple Messages pathways`  
Goal: decide which consumer messaging surfaces are real near-term targets. Files: `docs/research/messaging-platforms.md`, `packages/domain/integrations`. Acceptance: compare Eve/Chat SDK support, WhatsApp provider requirements, Apple Messages for Business requirements, approval/compliance gates, webhook/security model, and demo feasibility. Tests: no code required; evidence links and go/no-go decision required.

16. `feat(worker): add Workflow SDK port with Vercel Workflow and @workflow/world-postgres adapters`  
Goal: durable workflow abstraction. Files: `apps/worker`, `packages/ingestion/workflows`. Acceptance: start/resume/retry ingestion job through port. Tests: fake workflow adapter unit tests.

17. `feat(ingestion): add parse, normalize, and chunk stages`  
Goal: deterministic text pipeline. Files: `packages/ingestion/parsing`, `packages/ingestion/chunking`. Acceptance: PDFs/text/images route to parser/OCR fallback. Tests: fixture chunking and parser tests.

18. `feat(ai): add model, embedding, OCR, and extraction ports`  
Goal: AI adapter boundaries. Files: `packages/ai/src/ports`, `packages/ai/src/adapters`. Acceptance: no domain imports provider SDKs directly. Tests: contract tests with fake providers.

19. `feat(ai): implement structured extraction schemas`  
Goal: Zod schemas for object/relation/task/suggestion/action candidates. Files: `packages/ai/src/schemas`, `packages/domain/memory`. Acceptance: validation errors captured. Tests: valid/invalid fixtures.

20. `feat(memory): implement memory object CRUD and versioning`  
Goal: route-addressable memory objects. Files: `packages/domain/memory`, `packages/api/objects`, `apps/web/src/features/objects`. Acceptance: create/update/version/archive. Tests: version creation tests.

21. `feat(graph): implement typed relation edges`  
Goal: graph persistence and queries. Files: `packages/domain/graph`, `packages/api/relations`, `apps/web/src/features/graph`. Acceptance: relation CRUD and visible graph query. Tests: hidden endpoint relation redaction.

22. `feat(search): implement Postgres full-text and pgvector retrieval`  
Goal: permission-first hybrid retrieval. Files: `packages/domain/search`, `packages/db/repositories/search`. Acceptance: structured filters, FTS, vector similarity, trace storage. Tests: fixture retrieval tests.

23. `feat(chat): add grounded chat streaming`  
Goal: cited memory answers. Files: `packages/api/chat`, `packages/ai/rag`, `apps/web/src/features/chat`. Acceptance: stream answer with citations or unknown response. Tests: no-evidence test and citation coverage test.

24. `feat(today): implement proactive dashboard suggestions`  
Goal: Today Command Center. Files: `packages/domain/suggestions`, `packages/api/today`, `apps/web/src/features/today`. Acceptance: waiting/deadline/follow-up/action cards. Tests: fixture scenario produces expected cards.

25. `feat(actions): add risk classification and approval flow`  
Goal: safe internal actions and external drafts. Files: `packages/domain/actions`, `packages/api/actions`, `apps/web/src/features/actions`. Acceptance: Levels 0-3 enforced, Level 4 forbidden. Tests: risk classifier and approval tests.

26. `feat(sharing): implement shared spaces without private leakage`  
Goal: explicit object sharing. Files: `packages/domain/sharing`, `packages/api/shared-spaces`, `apps/web/src/features/shared-spaces`. Acceptance: selected object sharing, relation redaction, member roles. Tests: second-user cannot see private source E2E/integration test.

## Critical Risks and Follow-ups

- OKF needs an Atlas mapping RFC before implementation because the verified OKF v0.1 Draft is intentionally minimal and does not define Atlas-specific object types, typed relation metadata, permission snapshots, or reversible import semantics.
- Realtime provider must be decided by prototype and deployment test, not preference. Vercel WebSockets can be tried, but adapter/fallback is mandatory.
- Gmail/Calendar import scope can easily become overbroad. Start with read-only minimal scopes and incremental authorization.
- Chat SDK is useful for proof, but every adapter adds provider secrets, webhook validation, identity mapping, and rate-limit behavior. Add only enabled adapters to dependencies.
- Vercel Services is beta. Use it for `apps/web` + `apps/agent` only if the prototype validates local dev, preview deploys, env/service bindings, Spend Management, and rollback behavior. Hetzner + `@workflow/world-postgres` remains the documented agent exit.
- Apple Messages/iMessage support is not a committed capability. Treat it as Apple Messages for Business/provider research until validated.
- OCR quality is product-critical for Turkish and English. Do not cheap out here; evaluate provider quality with fixtures before committing.
- Permission tests are release blockers. A single known private-to-shared leakage bug blocks MVP.
- The graph UI must not ship as decoration. It must support inspection, filtering, and correction of typed relations.
