# Atlas Production Specification and Implementation Plan

Status: v0.1 architecture baseline  
Date: 2026-07-01 Europe/Istanbul  
Owner: principal architecture draft

This is a target spec. The Atlas application is NOT yet scaffolded.
Everything below describes what the app should become, not what exists today.
The current repository is the Atlas project knowledge pack: architecture, process, skills, rules, and templates.
This file is not the canonical owner of decisions, invariants, or policy. It points at the files that are.

## 0. Evidence Check

This spec was checked against the current project docs in `docs/architecture/*` and the external docs/specs below. The current repository folder is an Atlas agent operating system / project knowledge pack: it contains architecture, process, skills, rules, templates, and GitHub scaffolding before the application codebase is generated.

Official docs checked:

- Next.js App Router: https://nextjs.org/docs/app
- Vercel AI SDK: https://ai-sdk.dev/docs/introduction
- Vercel WebSockets: https://vercel.com/docs/functions/websockets
- Vercel Services: https://vercel.com/docs/services
- Vercel Chat SDK: https://vercel.com/chat
- Neon pgvector: https://neon.com/docs/extensions/pgvector
- Google OAuth 2.0: https://developers.google.com/identity/protocols/oauth2
- Temporal: https://docs.temporal.io/temporal
- OKF v0.1 Draft: https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md

Evidence-driven adjustments:

- Next.js App Router remains the right web framework because the official docs position it around React Server Components, Suspense, Server Functions, layouts, and route handlers.
- AI SDK is still appropriate, but implementation must follow the current major version docs. The docs now surface AI SDK 7, provider abstraction, Core, UI, structured object generation, tool calling, streaming, and tool approval primitives.
- Vercel Functions now document WebSocket support, but Next.js still requires an `experimental_upgradeWebSocket()` workaround for upgrade handling. Atlas must keep realtime behind a transport adapter and be ready to use Ably, Liveblocks, PartyKit, Pusher, Supabase Realtime, or a small dedicated WebSocket service.
- Vercel WebSocket docs explicitly warn that reconnects may land on different function instances and state must be reloaded. This confirms the invariant: WebSockets are transport only; durable state lives in Postgres/Redis/workflows.
- Vercel Services is now documented as beta and uses the `services` field in `vercel.json`, not the older `experimentalServices` shape. It is useful for deploying multiple surfaces in one Vercel project, but it is a deployment packaging feature, not a reason to split Atlas domain ownership into microservices.
- Vercel Chat SDK is useful for an early omnichannel proof surface across supported chat platforms. Treat it as an adapter layer for external chat clients, not as Atlas's internal web composer or memory backend. Slack and WhatsApp are viable demo targets; Apple Messages/iMessage must not be promised until the Apple Messages for Business path or a supported provider adapter is validated.
- Neon pgvector docs support pgvector in Neon Postgres and document HNSW/IVFFlat choices. Use pgvector for MVP; introduce a separate vector DB only after measured retrieval or scale failure.
- Google OAuth docs emphasize scopes, granted-scope comparison, refreshing tokens when needed, and incremental authorization. OAuth must be treated as a lifecycle subsystem, not a login checkbox.
- Temporal docs explicitly frame durable execution as resumable/recoverable workflow execution backed by event history. Temporal is the correct default for ingestion and action workflows when available.
- OKF v0.1 Draft was verified in GoogleCloudPlatform/knowledge-catalog. It defines a minimal markdown + YAML frontmatter knowledge bundle format, with concepts as markdown documents, bundle-relative links, optional `index.md` and `log.md`, and citation sections. Its stated non-goals include prescribing storage, serving, or query infrastructure, which strengthens the Atlas decision to use OKF only for export/import and agent-readable bundles, not canonical transactional storage.

## 1. Product and Scope Clarification

Atlas is a living second brain for messy digital context. It ingests files, links, notes, screenshots, emails, calendar items, reminders, messages, and documents; turns them into typed memory objects and typed relations; retrieves them with citations; surfaces proactive next actions; and allows safe, audited action drafts and selective sharing.

MVP scope:

- Responsive web app and PWA.
- Auth, workspaces, memberships, personal/private/shared visibility.
- Capture inbox for files, PDFs, images, screenshots, links, notes, tasks, reminders, Gmail import, and Calendar import.
- Async ingestion pipeline with parsing, OCR fallback, chunking, embeddings, extraction, relation linking, summaries, review cards, and suggestions.
- Object-based memory, typed relation graph, object inspector, document library, search, chat with citations, Today dashboard, and shared spaces.
- Safe internal actions and external drafts only: reminders, tasks, email drafts, calendar event drafts, follow-up drafts.
- Early omnichannel proof surface through `apps/bot` using Vercel Chat SDK for capture, ask, retrieve, and draft flows in Slack plus one WhatsApp-compatible path if provider setup is available.
- OKF export/import as a portable snapshot format.
- Golden eval dataset and leakage tests.

Post-MVP:

- Native iOS/Android clients through public REST/OpenAPI.
- Full local-first sync or CRDT memory.
- Browser extension, desktop wrapper, richer team workflows, public links, write-capable Gmail/Calendar automation, local/private model mode, specialized OCR/document intelligence, graph analytics, agent APIs.
- Broader external chat adapters such as Teams, Discord, Google Chat, Telegram, GitHub, Linear, and Apple Messages for Business if the provider path is validated.

Rejected ideas:

- Chat-only product: rejected because it hides the durable memory model and prevents inspection, correction, sharing, and source provenance.
- Convex as primary database: rejected because Postgres must own transactions, graph integrity, pgvector, permissions, audit logs, migrations, and exportability.
- Separate vector database in MVP: rejected until pgvector fails measured recall, latency, or operational targets.
- GraphQL-first: rejected because the internal app can use typed TypeScript APIs and the external surface needs REST/OpenAPI stability.
- Native mobile in MVP: rejected because the domain, permissions, ingestion, and action safety model must stabilize first.
- Full local-first CRDT sync in MVP: rejected because it is a separate distributed systems project. Build offline capture and local cache only.
- Automatic destructive external actions: rejected because Atlas's trust invariant is explicit confirmation, auditability, and reversibility where possible.
- OKF as canonical storage: rejected because markdown files cannot enforce permissions, transactional graph updates, OAuth lifecycle, indexes, and audit trails.
- Separate memory systems per chat platform: rejected because Slack, WhatsApp, Teams, and similar surfaces are clients of Atlas, not independent sources of truth.
- Consumer iMessage bot promise: rejected until Apple Messages for Business or a supported messaging provider path is validated. Do not market normal iMessage support from Chat SDK alone.

## 2. Architecture Decision Record

`docs/architecture/technical-decisions.md` owns every ADR decision and its full rationale. It already carries these, one-line gist each:

- Platform and mobile: responsive web + PWA first, native clients later through REST/OpenAPI.
- Architecture and language: TypeScript modular monolith, because Atlas's memory/permission/action invariants are too coupled to split early.
- Database: Postgres canonical with pgvector, one transactional system for relations, permissions, audit, and vectors.
- AI: async multi-stage ingestion pipeline, no single-shot "upload then summarize".
- Realtime: adapter-based transport, durable state stays outside socket processes.
- Vercel Services: deployment packaging for `apps/web` and `apps/bot` only, never a reason to split domain ownership.
- External chat surfaces: Chat SDK for `apps/bot`, Vercel AI SDK for the internal web composer, bot surfaces are clients of Atlas.
- Developer onboarding: `mise` for exact runtime pins plus a `doctor` check.
- Billing and payments: `BillingPort`/`PaymentPort` from day one, live payments feature-flagged, no PSP in domain logic and no raw card data in Postgres.
- OKF: export/import and agent-readable bundle format only, never canonical permissioned storage.

Frontend stack and its dependency guardrail live in `docs/architecture/frontend.md`: Next.js App Router, React, TypeScript, Tailwind, Radix, shadcn-style components, Zod, TanStack Query for client-side server state, and no Zustand or Framer Motion by default.
Backend module and port layout lives in `docs/architecture/backend.md`: domain modules, application services, repositories, and adapters for every external provider.
Security posture lives in `docs/architecture/security.md`: privacy is an architecture invariant, not a feature toggle.

Decisions this spec still owns, because `technical-decisions.md` does not yet carry them. Promote them there when they are settled:

- SQL layer: default to Drizzle ORM for schema-first TypeScript migrations and typed queries, gated by an early spike covering pgvector, full-text search, typed relation edges, permission-filtered retrieval, and migration ergonomics. Switch early to Kysely if Drizzle creates friction on those invariants. Do not use Prisma for Atlas core unless a later ADR proves it can preserve the required SQL/vector/permission control.
- Queue/workflow: Temporal is the default for durable ingestion and action workflows. BullMQ/Redis may be used behind `WorkflowPort` for local/dev or simpler deployments, but must not leak into domain code.
- Realtime transport choice: prefer SSE for one-way progress where sufficient. Use WebSockets only for bidirectional features such as presence, shared workspace updates, live graph changes, and ingestion progress subscriptions.
- Deployment: Vercel for web, optional Vercel Services for `apps/web` and `apps/bot` under one project, Neon for Postgres, S3/R2 adapter for object storage, managed Redis, Temporal Cloud or separately hosted workers, GitHub Actions CI, Vercel previews, staging, production.
- Permission enforcement placement: enforce checks in services and repositories. Consider RLS for high-risk public API/data access paths after the repository layer is stable. Encrypt OAuth tokens/secrets at application level with envelope encryption.
- Frontend form and rendering split: React Hook Form for forms. Server Components are preferred for data-heavy read screens. Client Components own interaction-heavy surfaces.
- Convex: optional prototype/realtime experiment only. It must not own durable memory, permissions, graph, audit, migrations, OAuth state, or canonical data.
- OKF mapping: memory objects map to OKF concepts, selected relation edges to markdown links plus Atlas relation metadata, citations to `# Citations`, and object/version history to `log.md`.

## 3. System Architecture

```text
Browser/PWA
  -> Next.js App Router web app
  -> Internal typed API/Zod route handlers
  -> Application services in modular monolith
  -> Domain modules and policies
  -> Repositories and permission scopes
  -> Postgres/pgvector + object storage + Redis

External chat clients
  -> Slack / WhatsApp-compatible provider / later Teams, Discord, Google Chat, Telegram, GitHub, Linear
  -> apps/bot via Vercel Chat SDK
  -> Same Atlas application services, permissions, retrieval, actions, audit logs

Worker app
  -> Temporal/BullMQ workflow adapter
  -> Ingestion, OCR, embeddings, extraction, linking, suggestions
  -> AI/OCR/crawler/storage/provider adapters
  -> Postgres + object storage + audit logs

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

1. User asks from composer with workspace and optional object context.
2. API validates auth, workspace membership, visibility scope, and request schema.
3. Retrieval service applies permission filter first, then structured filters, full-text search, vector search, optional rerank, and citation selection.
4. Disclosure policy converts retrieved evidence into the minimum sufficient exact values, derived values, pseudonyms, or markers for the model/provider route.
5. AI orchestration streams answer with citation references and stores `ai_runs`, retrieval trace, prompt version, model, sources, token/cost metadata, disclosure policy version, and redacted logs.
6. UI renders answer, source memory objects, chunks, confidence, and follow-up actions separately.

Insufficient-evidence answers follow the citation rules in section 7.

Ingestion lifecycle:

1. Capture API stores source, file metadata, raw object storage reference, idempotency key, and audit event.
2. Workflow starts or resumes by capture id.
3. Parser extracts text and metadata; OCR runs on images/screenshots/PDFs when text is missing or low quality.
4. Normalizer creates canonical text, chunks, embeddings, entity candidates, relation candidates, object candidates, summaries, tasks, dates, decisions, waiting items, and follow-ups.
5. Linker matches people/projects/objects with confidence and creates review alternatives when ambiguous.
6. Memory writer persists objects, versions, chunks, embeddings, relation edges, review cards, suggestions, and audit logs transactionally.
7. Realtime emits progress; clients reload final state from APIs.

Action lifecycle:

1. AI or user proposes action with source basis, risk level, target integration, rollback path, and required approval.
2. Action service validates permission, classifies risk, creates `actions` and `approvals` records.
3. Level 0 runs read-only. Level 1 can create internal tasks/reminders with audit. Level 2 creates external drafts only. Level 3 requires explicit confirmation. Level 4 is forbidden in MVP.
4. External provider adapter executes only after approval when allowed.
5. `action_runs` and `audit_logs` record every state transition and provider response metadata without secrets.

Sharing lifecycle:

1. User creates shared space and selects explicit objects.
2. Sharing service computes visible object set and relation set.
3. Relations are visible only when both endpoints are visible to the viewer.
4. Derived summaries cannot include private context unless the private source is explicitly shared.
5. Shared viewers use the same repository permission scopes as private users.

Realtime lifecycle:

1. Domain event is persisted or published after commit.
2. Redis/pub-sub or provider adapter broadcasts lightweight event envelope.
3. Client receives event and refetches authoritative state.
4. Reconnects resubscribe and reload missed state using cursors; no durable state is kept in the socket process.

External chat lifecycle:

1. Platform webhook reaches `apps/bot` through Vercel Services or a regular route.
2. Chat SDK verifies the adapter-specific request, deduplicates webhook retries, and normalizes the platform message/thread.
3. Bot service maps the platform identity to an Atlas user/workspace connection.
4. Bot command is classified as capture, ask, retrieve, draft, or approval response.
5. Application services enforce the same permission, source-grounding, action-risk, and audit invariants as the web app.
6. Response is rendered back through Chat SDK cards/text using platform-native formatting.
7. Bot state is stored in Redis/Postgres where needed; memory state remains in Postgres.

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

- `docs/architecture/security.md` owns the permission invariants: private objects stay owner-only unless shared, relations need both endpoints visible, and every read surface uses one permission layer. `docs/architecture/db.md` owns the repository-level rules.
- Schema-specific contract: repository APIs accept an explicit `AccessScope` derived from user, workspace membership, role, shared space, and item visibility. Every query listed above filters through that one scope.

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

- `docs/architecture/ai.md` owns the RAG rules: permission-filter before retrieval, hybrid search across filters/full-text/vectors/rerank, cite the source objects and chunks, apply disclosure policy before sending chunks to a model, and store retrieval traces.
- Atlas order of operations: permission filter, structured filters, full-text, vector similarity, optional rerank, citation selection, answer generation constrained to evidence.

Citation rules:

- Every memory-grounded claim needs at least one source object/chunk.
- If evidence is absent or weak, answer exactly: "I do not know based on your Atlas memory." This is the Atlas wording of the insufficient-evidence rule owned by `docs/architecture/ai.md`.
- UI must render citations next to claims or in a visible source panel.

Memory write rules:

- High-confidence extracted facts can auto-create memory objects.
- Low-confidence, conflicting, or privacy-sensitive writes go to review.
- User corrections create versions and audit logs.
- AI cannot silently overwrite user-edited fields.

Action risk rules:

- `docs/architecture/ai.md` owns the risk levels 0-4: read-only, internal safe write, external draft, external write needing explicit confirmation, and destructive/irreversible which is forbidden in MVP. The Action lifecycle in section 3 shows how they are enforced.

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

- `docs/architecture/security.md` owns them in full: private objects stay owner-only unless explicitly shared, shared spaces expose only selected objects, relations need both endpoints visible, private summaries cannot surface in shared spaces, and every read surface uses one permission layer. `docs/architecture/product-invariants.md` carries the product-level trust rule.
- Spec addition: realtime payloads use the same access scope, and admin/dev-only visibility must not exist in production data paths.

OAuth token handling:

- Least privilege and incremental scopes.
- Store granted scopes and compare against required scopes before every sync.
- Encrypt refresh/access tokens with app-level envelope encryption.
- Store token expiry, refresh attempts, revoked status, sync cursors, and audit events.
- Revoke and delete tokens on user request.
- Chat platform tokens and signing secrets follow the same envelope encryption, least privilege, rotation, revocation, and audit requirements as Google OAuth connections.

Redaction and disclosure:

- `docs/architecture/privacy-redaction-policy.md` owns this policy in full: keep full authorized memory in Postgres, then let the deterministic backend `DataDisclosurePolicy` compute the minimum sufficient outbound representation per actor, purpose, destination, and data class. No model decides what is safe to disclose. Secrets, tokens, credentials, raw card data, and session material never reach LLMs.
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
Acceptance: `apps/bot` service shell, Vercel Services deployment config using `services`, Chat SDK adapter boundary, Slack capture/ask demo, one WhatsApp-compatible provider evaluation, webhook signature validation, platform identity mapping, audit logs, no permission bypass. Apple Messages/iMessage remains research-only until Apple Messages for Business/provider access is validated.

Phase 3: ingestion pipeline  
Acceptance: Temporal/BullMQ adapter, parse/OCR/chunk/embed/extract/link workflow, resumable jobs, retry policy, progress events, review cards.

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
Acceptance: golden dataset, eval smoke command, security tests, migration checks, Vercel preview, Vercel Services prototype if `apps/bot` remains in scope, staging config, observability, incident/debug docs.

## 10. First 26 GitHub Issues

1. `chore(repo): initialize pnpm monorepo and Turborepo`  
Goal: create executable repo baseline. Files: `package.json`, `pnpm-workspace.yaml`, `turbo.json`, `apps/web`, `apps/worker`, `apps/bot`, `packages/*`. Acceptance: listed commands exist. Tests: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` run against minimal compilable package skeletons.

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

12. `chore(deploy): prototype Vercel Services for web and bot`  
Goal: validate `apps/web` and `apps/bot` under one Vercel project without changing domain boundaries. Files: `vercel.json`, `apps/web`, `apps/bot`, `docs/process/deployment-policy.md`. Acceptance: uses current `services` configuration, web route `/`, bot route `/bot`, local dev path documented, no memory state outside Postgres/Redis. Tests: `vercel dev` smoke or documented fallback if Services beta access blocks local validation.

13. `feat(bot): add Chat SDK service shell`  
Goal: create external chat adapter surface without product logic duplication. Files: `apps/bot`, `packages/api/bot`, `packages/domain/integrations`. Acceptance: Chat SDK initialized lazily, Redis state adapter or dev memory adapter behind config, webhook routes validate secrets, bot calls application services only. Tests: fake adapter webhook tests and duplicate delivery tests.

14. `feat(bot): add Slack capture and ask demo`  
Goal: prove Atlas works from Slack without bypassing permissions. Files: `apps/bot/src/adapters/slack`, `packages/api/bot`, `packages/domain/audit`. Acceptance: Slack message can create capture, ask a grounded question, and receive citations/source links; platform user maps to workspace membership. Tests: signed Slack webhook fixture, unauthorized user fixture, citation rendering fixture.

15. `spike(bot): evaluate WhatsApp and Apple Messages pathways`  
Goal: decide which consumer messaging surfaces are real near-term targets. Files: `docs/research/messaging-platforms.md`, `packages/domain/integrations`. Acceptance: compare Chat SDK support, WhatsApp provider requirements, Apple Messages for Business requirements, approval/compliance gates, webhook/security model, and demo feasibility. Tests: no code required; evidence links and go/no-go decision required.

16. `feat(worker): add workflow port with Temporal and local adapter`  
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
- Vercel Services is beta. Use it for `apps/web` + `apps/bot` only if the prototype validates local dev, preview deploys, env/service bindings, and rollback behavior.
- Apple Messages/iMessage support is not a committed capability. Treat it as Apple Messages for Business/provider research until validated.
- OCR quality is product-critical for Turkish and English. Do not cheap out here; evaluate provider quality with fixtures before committing.
- Permission tests are release blockers. A single known private-to-shared leakage bug blocks MVP.
- The graph UI must not ship as decoration. It must support inspection, filtering, and correction of typed relations.
