# Architecture

Atlas has an authenticated React/TypeScript notes workspace and a Hono API connected to PostgreSQL and a private eve organizer. WorkOS browser sign-in uses a short-lived sealed `atlas_login_transaction` cookie during login and stores only the sealed HttpOnly session cookie after the callback: `__Host-atlas_session` on HTTPS, `atlas_session` on loopback HTTP. The connected flow supports editable AI drafts saved separately from their source notes.

## Accepted decisions

The [agreed sprint scope](https://github.com/atlas-depot/atlas/issues/45) records these choices.

| Area | Decision |
| --- | --- |
| Client | React/TypeScript with Vite+. Web/PWA first; PWA setup remains unimplemented |
| UI components | BlockNote with its Base UI-backed shadcn adapter for rich note editing; react-markdown with remark-gfm for legacy Markdown preview |
| API | Hono on Node 26, REST and shared Zod schemas |
| Authentication | WorkOS AuthKit with hosted Google and email/password sign-in, server callback and HttpOnly session cookie; the API also accepts verified WorkOS Bearer access tokens |
| Database | Neon PostgreSQL with Drizzle, one remote branch per developer, shared staging and separate production |
| Agent runtime | eve on Vercel Workflow; Neon stores Atlas ownership and delivery records, without a second agent loop |
| Hosting | Vercel direction; production routing, deployment and team access need setup and verification |

File storage, connector adapters, memory storage and the product model remain open. A vector database, graph service or extra package needs a concrete consumer before it is added.

## Current delivery scope

The notes sprint covers online personal notes, explicit Save, rich block editing, followed by a user-triggered AI draft kept separate from the original. New note content uses versioned BlockNote JSON with stable block IDs. Existing Markdown remains a string until an edit and Save converts a losslessly imported note. Markdown that cannot round-trip safely stays in source mode and continues to save as a string. File storage and knowledge exchange formats such as OKF are separate concerns; the editor does not prescribe a universal artifact format. In #50, the agent may choose to restructure, shorten, expand or research the note without asking for approval for each public web search. Offline synchronization, live collaboration, PDF import, account connectors, workspace-wide search and richer generated views remain outside this batch.

The executable provides public health and authentication routes plus a protected API boundary. Protected API requests without a verified Bearer token or browser session are rejected. Authenticated note CRUD and organizer routes enforce ownership against the configured database. Note routes return `503` when persistence is unavailable or not configured. Deterministic tests can inject a trusted identity. Terminal invalid or expired sessions return `401`; a successful browser refresh returns `200` with a resealed cookie. Rejected cookie-origin checks return `403`. Provider outages during verification or refresh return `500`; logout falls back to clearing the local cookie and redirecting to `APP_ORIGIN` when WorkOS cannot confirm the session.

`server/browser-auth.ts` owns hosted AuthKit PKCE, the sealed session cookie, refresh and WorkOS logout. `server/workos.ts` verifies Bearer signatures locally against the client JWKS fetched and cached over HTTPS; a JWKS outage is a server failure. `server/auth.ts` keeps one protected boundary and enforces Bearer-versus-cookie precedence; an `Authorization` header never falls back to the cookie. Browser tokens stay inside the HttpOnly cookie and are never returned by the session route.

Deterministic tests use a synthetic provider and a local fake WorkOS API; they cover state, PKCE, refresh outcomes, logout, account replacement, CSRF and Bearer precedence. Live Google and email/password verification, five-person dashboard access, failed/cancelled login and provider recovery succeeded against WorkOS Staging ([evidence log](process/evidence-log.md#2026-10-28-workos-staging-smoke)). The editor uses BlockNote and Base UI, safe legacy Markdown preview and explicit Save. Its HTTP client uses individual-note reads and exact ETag/If-Match handling. The production authentication gate handles sign-out and account-replacement cleanup. Development fixtures use the same client and screen; separate browser tests exercise the real Hono routes and PostgreSQL persistence.

The [note schemas](../shared/notes.ts) own the payload and timestamp contract. [HTTP schemas](../shared/http.ts) own errors and conditional-write headers. [Session schemas](../shared/auth.ts) own the browser-safe identity returned by `GET /api/auth/session`. The [API contract](api.md) summarizes routes and status codes.

## Responsibility boundaries

```text
src/            React notes workspace and development-only source viewer
src/fixtures/   Synthetic briefing fixtures and their parser for the source viewer
server/         HTTP routing, authentication and backend operations
shared/         Browser-safe schemas and types
drizzle/        Generated SQL migrations, snapshots and journal
agents/         Private agent runtimes called by the backend
experiments/    Isolated experiments with separate setup
e2e/            Playwright browser tests with test-only API and organizer seams
scripts/        Repository automation, currently the ClickUp status sync
public/         Static files served unchanged, currently the code font
```

- Authenticate requests at the shared API boundary. Resource operations still enforce ownership from that trusted identity; a supplied note ID never grants access.
- Keep note operations independent of Hono so that future agent tools can use the same authorized operations.
- Keep user-authored notes, external source records and AI-generated content distinguishable. Preserve provenance and correction paths.
- Keep server configuration, credentials and provider tokens out of browser imports, shared contracts and model context.
- Use Neon branches to isolate development data and resets. Review migration conflicts in Git before applying migrations to shared staging.

Atlas owns user authorization, source provenance and external-action outcomes. eve may handle agent execution, but it does not replace those policies. External actions require the agreed user approval, and retries must handle uncertain provider outcomes. See [security boundaries](security.md).

The [organizer](../agents/organizer/README.md) is integrated through authenticated Hono routes. Hono owns note access and calls a private eve service on Vercel Workflow. A standard eve research tool uses OpenRouter and returns source records through tool results. Neon stores the owner-bound run, exact source revision, temporary input/result and pinned runtime identity. An empty eve session is committed before the note is sent to its fixed identity with an idempotency key. Reconnect inspects that work across API processes instead of starting a second generation.

A completed result is handed off atomically into a 24-hour owner-bound editable draft alongside persisted eve cleanup intent. Only then is the eve session retired with zero retention requested. Failed cleanup is retryable after process replacement. Draft edits do not extend expiration. Save creates a separate note with server-established source provenance and an idempotent receipt; Discard removes the temporary content. A deleted source does not erase an already delivered draft. An explicitly enabled maintenance schedule reconciles abandoned readers, retries cleanup and physically purges expired content. Each retained deployment must verify hosted Workflow access and resumption and enable maintenance for expiry and cleanup reconciliation.

The same private agent answers questions over notes ([#71](proposals/71-grounded-chat-turn.md)). Hono authorizes the conversation, accepts each input idempotently and binds one runtime session per answer attempt. The model retrieves through an owner-bound `search_notes` tool; Hono validates every citation against the search results the runtime recorded and publishes through the #70 store. The service username selects the job, so note search and public web research never share a session.

Use disposable sandboxes only for bounded work, and persist important outputs outside them. Do not create a second agent loop, approval journal, heartbeat or workflow system until a verified gap requires it.

## Experiments and deferred choices

The [eve/OpenRouter experiment](../experiments/eve-openrouter/README.md) verified a local synthetic request through a real eve session and provider call; it did not establish authorization, durability, retrieval quality or production readiness. Its setup, pinned versions and budget guard live with the experiment.

A connector tool is not necessarily a sync service. Before selecting one, verify scopes, event delivery, backfill, refresh, disconnection and provider limits. Gmail and Calendar are the initial connector direction, not part of the current notes sprint.

[Open Knowledge Format](https://github.com/GoogleCloudPlatform/open-knowledge-format) remains a possible export/import format, not a live database or required first-release subsystem. Evaluate provenance, permissions and conflict handling before promising a lossless round trip.

## Verification boundaries

Use deterministic tests for access, data integrity and action safety, then separately evaluate real model behavior. A passing provider smoke does not prove either category. Before extending the app, verify the affected user flow, cross-account access, source traceability and recovery behavior described in [security](security.md) and [development](development.md).

## References

- [Hono on Node.js](https://hono.dev/docs/getting-started/nodejs)
- [eve documentation](https://eve.dev/docs) and [source](https://github.com/vercel/eve)
- [Vite+](https://viteplus.dev/guide/)
