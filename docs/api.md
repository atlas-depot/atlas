# API contract

The Hono API serves JSON under `/api`. The Zod schemas in `shared/` are the source of truth for every payload. This page summarizes them. If it disagrees with the code, the code wins.

- [Note schemas](../shared/notes.ts): note fields, list rows and the REST summary.
- [HTTP schemas](../shared/http.ts): the error body and `If-Match` rules.
- [Organize schemas](../shared/organize.ts): run states, the start response and note provenance.
- [Draft schemas](../shared/drafts.ts): temporary drafts and reconnect state.
- [Session schemas](../shared/auth.ts): the identity returned by `GET /api/auth/session`. The browser sign-in routes are described in [development](development.md#local-api).
- [Conversation schemas](../shared/conversations.ts): persistent conversation, history and citation responses.

## Common rules

- `GET /api/health` is public and returns `200 { status: "ok" }`. It reports process liveness, not database or provider readiness.
- Every other route outside `/api/auth` needs a verified WorkOS Bearer token or browser session. Without one it returns `401` with a Bearer challenge.
- Cookie-authenticated unsafe requests need an exact `Origin` match with `APP_ORIGIN`. A missing or mismatched origin returns `403`. Bearer requests are exempt.
- Errors use `{ error: { code, message } }`. Messages never include provider details, credentials or submitted content.
- IDs are UUIDs. An invalid ID or JSON body returns `400`. Absent and inaccessible resources return the same `404`. Storage and organizer failures return a sanitized `503`.
- ETags are strong and opaque. Copy the exact response `ETag` into `If-Match`. A missing `If-Match` is `428`, a malformed one is `400` and a stale one is `412`. Weak tags, lists and `*` are rejected.
- Every response carries Hono's default `secureHeaders` security headers and `Cache-Control: no-store`.
- JSON bodies are limited to 1 MiB and five seconds of upload time. Organize run requests and `DELETE` requests take no body and reject a non-empty one with `400`.

## Notes

| Request | Response |
| --- | --- |
| `GET /api/notes` | `200 { notes: NoteSummary[] }`, newest edit first. Rows have `id`, `title`, `createdAt`, `updatedAt` and `origin` when present. They have no `content` and no ETag |
| `POST /api/notes`, `{ title, content, createdAt }` plus `Idempotency-Key` | `201` note and ETag |
| `GET /api/notes/:id` | `200` note and ETag |
| `PUT /api/notes/:id`, `{ title, content }` plus `If-Match` | `200` note and new ETag |
| `DELETE /api/notes/:id`, empty body plus `If-Match` | `204` |

The list is not an editable snapshot. Open a note with `GET /api/notes/:id` to get its content and the ETag for later writes.

Titles are at most 256 UTF-16 code units. Content is a legacy Markdown string or a versioned BlockNote document validated by [document schemas](../shared/document.ts). Create and update reject lone UTF-16 surrogates and NUL in title or content with `400`. `createdAt` is a UTC time in year 0001 or later and never changes. `PUT` replaces title and content.

`POST /api/notes` requires a UUID `Idempotency-Key`, normalized to lowercase and scoped to the verified account. A missing or invalid key returns `400`. After an uncertain response, retry with the original key and the exact submitted payload. Creation stores the note and a key/payload-hash/note-ID record atomically. A matching replay returns the same `201` body and ETag while the note is unchanged. A different payload, a later edit or a deletion returns `409 CONFLICT` without creating a second note.

Responses never include the owner ID or the internal revision. `origin` appears only on notes saved from an AI draft. It holds the source note ID, source revision and research sources. Note writes cannot set or replace it.

## Note search

`POST /api/note-search` accepts `{ query, limit? }` for a verified user. After trimming, query
must contain 1-500 characters; limit defaults to 5 and must be 1-10. The server derives note
ownership from authentication and uses the same Qwen query encoding profile as the note index.
Client-supplied owner, note, vector and model fields are rejected.

`200` returns `{ candidates: [{ text, source, score }], coverage: { ready, pending, failed } }`.
Array order is rank. `score` is cosine similarity for ranking, not confidence that a passage
answers the query. `source` is the existing revision-bound block or Markdown passage reference.
Only live owned passages whose revision, text and source still match are returned. A bounded
overfetch can result in fewer than the requested limit. Empty candidates do not prove semantic
no-support. Coverage counts only current revisions of the user's notes: a ready empty note has
zero passages but contributes one ready count; processing/unindexed notes are pending; current
index failures are failed. Embedding and storage failures return distinct sanitized `503` errors.

Before embedding, PostgreSQL atomically admits at most 20 search requests per verified user in
the preceding 60 seconds across API processes. Rejected requests return `429 RATE_LIMITED` with
`Retry-After` and make no provider call. Provider failures consume admission. Missing or failed
admission storage returns `503` rather than allowing an uncounted call. Expired owner counters
are removed in bounded batches as subsequent requests arrive.

## Conversations

| Request | Response |
| --- | --- |
| `POST /api/conversations`, `{}` plus UUID `Idempotency-Key` | `201` server-generated conversation |
| `GET /api/conversations?limit=50&cursor=...` | `200 { conversations, nextCursor }`, newest creation first |
| `GET /api/conversations/:id` | `200 { conversation, activeTurn }`, including the current checkpoint when running |
| `GET /api/conversations/:id/messages?limit=50&cursor=...` | `200 { messages, nextCursor }`, ascending immutable sequence |
| `DELETE /api/conversations/:id`, empty body | `204` after content deletion and durable cleanup-intent recording |
| `POST /api/conversations/:id/messages`, `{ text, policy? }` plus UUID `Idempotency-Key` | `202 { message, conversation, activeTurn }` |
| `POST /api/conversations/:id/stop`, empty body | `200 { conversation, activeTurn }` with the queue paused |
| `POST /api/conversations/:id/resume`, empty body | `200 { conversation, activeTurn }` |
| `POST /api/conversations/:id/turns/:turnId/retry`, empty body plus UUID `Idempotency-Key` | `202 { conversation, activeTurn }` |

Pages default to 50 and allow at most 100 records. Use the returned cursor unchanged.
Creation accepts no owner, ID or title. Identical owner/key replay returns the current
conversation. Replaying creation after deletion returns `409` without recreating content.
The content-free key/hash/ID receipt lasts until account erasure, like note creation receipts.

Message and checkpoint text is bounded to 100,000 UTF-16 code units, with NUL and malformed
Unicode rejected. Accepted inputs remain separate and ordered. Final answers carry the IDs
of all consumed inputs and distinguish `completed`, `no-support`, and `incomplete` with a
`failed` or `cancelled` reason. Partial history is not verified context for later answers.
Each answer may reference at most 100 accepted inputs and 100 citations. Additional queued
inputs stay available for later answers. Citation excerpts are at most 1,000 UTF-16 code units.
Note deletion clears their stored
excerpts, retaining delivered answer text and deleted-source references. Changed source
versions are marked stale. No previous full note revision is archived.

Sending a message accepts one input and returns before the answer exists. `policy` is
`queue` (default) or `steer`. A queued input waits for the running answer. Up to 100 waiting inputs
and 500,000 UTF-8 bytes of their text can be answered together; any beyond that stay queued
for the next answer. The answer lists
every input it consumed. A
steer joins the running answer and redirects it; with no answer running it starts one. A
steer is never turned into a queued message: when the running answer cannot take it the
request returns `409`. Repeat an uncertain send with the same key and body. It returns the
same message and may continue its accepted work. A changed body returns `409`.

Each owner may send 20 new messages in any 60 seconds. New queued attempts wait while three
answers are running for that owner. An explicit retry counts as a running answer too: above the limit it returns `409`.
Above the first limit the request returns `429 RATE_LIMITED` with `Retry-After`; a replay is
not counted. Once a slot opens, a read or the maintenance sweep can start the queued work.

`GET /api/conversations/:id` continues existing work: it reads the private runtime once,
saves progress or publishes the finished answer, and starts the next queued inputs. It never
starts a second run for the same inputs. Runtime trouble does not fail the read.

An answer is `completed` only when every citation names a passage the attempt retrieved from
the owner's notes and quotes it exactly. A malformed result or an unknown source becomes an
`incomplete` answer with reason `failed`. `no-support` means the attempt found no supporting passage; it carries
no citations. It is not proof that no note covers the question: search returns a bounded
set of candidates and some notes may not be indexed yet. If a source is deleted before publication, the generated text is suppressed. History keeps
an empty `incomplete` answer with reason `failed`.
A source edited meanwhile keeps its old-revision citation, marked `stale`. These checks
establish where a quote came from, not that it supports the claim.

Stop cancels the running answer as `incomplete` with reason `cancelled`, ends its runtime
session and pauses the queue. Queued inputs stay until resume. Retry starts a new attempt
over the same inputs and keeps the incomplete answer in history. With no private runtime
configured these four routes return `503`. Runtime identities never appear in a response.

## Organize

All Organize and draft routes use the same authentication and cookie-origin checks. Start requires the saved source ETag in `If-Match`, checked while locking that source revision. With no organizer settings, these routes return `503`.

| Request | Response |
| --- | --- |
| `POST /api/notes/:id/organize`, empty body plus `If-Match` | `202 { runId, status: "accepted" }`, or `cleanup_pending` for existing work awaiting retirement. A note with an active run returns that run |
| `GET /api/organize-runs/:id` | `200 { runId, ...state }`, including progress or a separate Markdown draft, sources and source revision/staleness |
| `POST /api/organize-runs/:id/cancel` | `200` terminal state, or `202` while cleanup is pending |
| `POST /api/organize-runs/:id/handoff` | `200` temporary draft and ETag; retries return the same draft without extending its lifetime. `409` when the run has no draft to deliver |
| `POST /api/organize-runs/:id/acknowledge` | Legacy. `200` terminal state, or `202` while cleanup is pending. `409` while the run is running |
| `GET /api/organize-work` | `200 { runs, drafts }`: owner-scoped active run handles and unexpired drafts for reconnect/reload |
| `GET /api/note-drafts/:id` | `200` draft and ETag, including stale/deleted source flags |
| `PUT /api/note-drafts/:id`, `{ title, content }` plus `If-Match` | `200` full draft and ETag, with expiry unchanged |
| `DELETE /api/note-drafts/:id`, empty body plus `If-Match` | `204` after discarding the temporary draft |
| `POST /api/note-drafts/:id/save`, `{ title, content }` plus `If-Match` | `201` separate permanent note and ETag |

Start returns `412` when the source changed since the supplied ETag and `409` while an unresolved draft or run blocks a new one. An owner can have at most three active runs. A start above that limit returns `429 RATE_LIMITED` with no `Retry-After` header. A run stays active while it is running, while its result waits for handoff and while cleanup is pending.

The browser hands off a completed result before editing it. Handoff records the temporary copy and cleanup intent in one transaction; cleanup failure cannot erase the copy and maintenance retries retirement. A source can have only one unresolved draft. Another Organize returns `409` until Save or Discard resolves it. A changed source is flagged stale; source deletion after handoff does not prevent saving the draft separately.

Save derives provenance from the server-owned draft, not client fields. A draft-ID/payload-hash/note-ID receipt makes concurrent and uncertain-response retries return one unchanged note. Reuse the exact Save payload after a lost response. Changed/deleted saved notes or a changed retry payload return `409`; stale temporary edits return `412`. Content-free receipts survive draft/source/note deletion until account erasure, like note creation receipts.

A lost start response can safely retry the same owned source revision or recover through `organize-work`. `cleanup_pending` must be polled instead of launching another run. The older `acknowledge` endpoint retires a completed result that has not been handed off, without saving it. The editor uses handoff. No raw eve handles, runtime URLs, credentials or accounting records enter these responses.
