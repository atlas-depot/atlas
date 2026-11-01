# Architecture

Atlas has a React/TypeScript notes editor development preview and a local Hono API. Health, the public authentication routes and the protected API boundary run. WorkOS browser sign-in uses a short-lived sealed `atlas_login_transaction` cookie during login and stores only the sealed HttpOnly `atlas_session` cookie after the callback; note persistence and the agent-backed product flow are not connected yet.

## Accepted decisions

The [agreed sprint scope](https://github.com/atlas-depot/atlas/issues/45) records these choices.

| Area | Decision |
| --- | --- |
| Client | React/TypeScript with Vite+. Web/PWA first; PWA setup remains unimplemented |
| UI components | shadcn components built on Base UI; react-markdown with remark-gfm for safe note preview |
| API | Hono on Node 24, REST and shared Zod schemas |
| Authentication | WorkOS AuthKit with hosted Google and email/password sign-in, server callback and HttpOnly session cookie; the API also accepts verified WorkOS Bearer access tokens |
| Database | Neon PostgreSQL with Drizzle, one remote branch per developer, shared staging and separate production |
| Agent runtime | eve on Vercel Workflow; Neon stores Atlas ownership and delivery records, without a second agent loop |
| Hosting | Vercel direction; production routing, deployment and team access need setup and verification |

File storage, connector adapters, memory storage and the product model remain open. A vector database, graph service or extra package needs a concrete consumer before it is added.

## Current delivery scope

The notes sprint covers online personal notes, explicit Save, Markdown source and preview, followed by a user-triggered AI draft kept separate from the original. In #50, the agent may choose to restructure, shorten, expand or research the note without asking for approval for each public web search. Offline synchronization, live collaboration, PDF import, account connectors, workspace-wide search and richer generated views remain outside this batch.

The executable provides public health and authentication routes plus a protected API boundary. Protected API requests without a verified Bearer token or browser session are rejected. Tests inject a trusted identity; authenticated note operations return `501` until persistence is connected. Terminal invalid or expired sessions return `401`; a successful browser refresh returns `200` with a resealed cookie. Rejected cookie-origin checks return `403`. Provider outages during verification or refresh return `500`; logout falls back to clearing the local cookie and redirecting to `APP_ORIGIN` when WorkOS cannot confirm the session.

`server/browser-auth.ts` owns hosted AuthKit PKCE, the sealed `atlas_session` cookie, refresh and WorkOS logout. `server/workos.ts` verifies Bearer signatures locally against the client JWKS fetched and cached over HTTPS; a JWKS outage is a server failure. `server/auth.ts` keeps one protected boundary and enforces Bearer-versus-cookie precedence; an `Authorization` header never falls back to the cookie. Browser tokens stay inside the HttpOnly cookie and are never returned by the session route.

Deterministic tests use a synthetic provider and a local fake WorkOS API; they cover state, PKCE, refresh outcomes, logout, account replacement, CSRF and Bearer precedence. Live Google and email/password verification, five-person dashboard access, failed/cancelled login and provider recovery succeeded against WorkOS Staging. The #48 editor uses shadcn/Base UI, safe Markdown preview and explicit Save. Its HTTP client follows the accepted REST/Zod contract, including individual-note reads and exact ETag/If-Match handling. Development fixtures use that same client and screen. Actual note persistence, authentication UI and account lifecycle integration remain in #52 and its dependencies.

The [note schemas](../shared/notes.ts) own the payload and timestamp contract. [HTTP schemas](../shared/http.ts) own errors and conditional-write headers. [Session schemas](../shared/auth.ts) own the browser-safe identity returned by `GET /api/auth/session`.

## Responsibility boundaries

```text
src/            React notes workspace and development-only source viewer
server/         HTTP routing, authentication and backend operations
shared/         Browser-safe schemas and types
agents/         Private agent runtimes called by the backend
experiments/    Isolated experiments with separate setup
```

- Authenticate requests at the shared API boundary. Resource operations still enforce ownership from that trusted identity; a supplied note ID never grants access.
- Keep note operations independent of Hono so that future agent tools can use the same authorized operations.
- Keep user-authored notes, external source records and AI-generated content distinguishable. Preserve provenance and correction paths.
- Keep server configuration, credentials and provider tokens out of browser imports, shared contracts and model context.
- Use Neon branches to isolate development data and resets. Review migration conflicts in Git before applying migrations to shared staging.

Atlas owns user authorization, source provenance and external-action outcomes. eve may handle agent execution, but it does not replace those policies. External actions require the agreed user approval, and retries must handle uncertain provider outcomes. See [security boundaries](security.md).

The [organizer](../agents/organizer/README.md) prepares #50 independently of #51 HTTP wiring. Hono owns note access and calls a private eve service on Vercel Workflow. A standard eve research tool uses OpenRouter and returns source records through tool results. Neon stores the owner-bound run, exact source revision, temporary input/result and pinned runtime identity. An empty eve session is committed before the note is sent to its fixed identity with an idempotency key. Reconnect inspects that work across API processes instead of starting a second generation.

Browser acknowledgement first records cleanup and clears temporary Atlas content, then ends the eve session with zero retention requested. Failed cleanup is retryable after process replacement. An explicitly enabled maintenance schedule reconciles abandoned readers and expires results. Hosted Workflow access, resumption and retention still require live deployment verification. Explicit derivative Save and source rendering remain in #53.

Use disposable sandboxes only for bounded work, and persist important outputs outside them. Do not create a second agent loop, approval journal, heartbeat or workflow system until a verified gap requires it.

## Experiments and deferred choices

The [eve/OpenRouter experiment](../experiments/eve-openrouter/README.md) verified a local synthetic request through a real eve session and provider call; it did not establish authorization, durability, retrieval quality or production readiness. Its setup, pinned versions and budget guard live with the experiment.

A connector tool is not necessarily a sync service. Before selecting one, verify scopes, event delivery, backfill, refresh, disconnection and provider limits. Gmail and Calendar are the initial connector direction, not part of the current notes sprint.

[Open Knowledge Format](https://github.com/GoogleCloudPlatform/open-knowledge-format) remains a possible export/import format, not a live database or required first-release subsystem. Evaluate provenance, permissions and conflict handling before promising a lossless round trip.

## Verification boundaries

Use deterministic tests for access, data integrity and action safety, then separately evaluate real model behavior. A passing provider smoke does not prove either category. Before extending the scaffold, verify the affected user flow, cross-account access, source traceability and recovery behavior described in [security](security.md) and [development](development.md).

## References

- [Hono on Node.js](https://hono.dev/docs/getting-started/nodejs)
- [eve documentation](https://eve.dev/docs) and [source](https://github.com/vercel/eve)
- [Vite+](https://viteplus.dev/guide/)
