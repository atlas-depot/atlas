# Private note organizer

Implements [#50](https://github.com/atlas-depot/atlas/issues/50). Hono derives the owner from its verified session and calls this private eve service as `api` through the [Organize HTTP contract](../../docs/api.md#organize). #51 owns note CRUD; #53 owns the editable draft handoff, Save and Discard. No browser receives the service credential or raw eve session identifiers.

Install the root workspace with `pnpm install --frozen-lockfile`. Copy `.env.example` here to `.env.local` and supply development credentials. Run `pnpm --dir agents/organizer dev`. The local service binds to `127.0.0.1:2027`. Model quality trials use synthetic notes and an explicitly budgeted provider key; routine tests never call paid models.

## Durable execution and delivery

Create `createOrganizerBackend` from `backend.ts` with a pooled PostgreSQL `connectionString`, an immutable eve deployment URL, the private service token and `resultRetentionMs` (development default: 900,000 ms). The backend owns a separate two-connection pool with a five-second row-lock wait limit; call `backend.close()` during shutdown. Never share the normal notes API pool with runtime transport calls. Use a pooled Neon URL for requests and a direct URL for reviewed migrations. Apply the versioned migration with the root `db:migrate` command, never at request startup.

Neon stores owner-bound run handles, the exact source revision, a temporary input snapshot, runtime identity and delivery state. eve on Vercel Workflow owns execution. API shutdown does not cancel accepted work. There is no process-local run registry or second agent loop.

| Operation                           | Behavior                                                                                                                                                           |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `await start(ownerId, noteId)`      | Claims or reuses one active run per note, with at most three active runs per owner; returns `cleanup_pending` with its run ID while retirement is unfinished       |
| `await read(ownerId, runId)`        | Inspects existing work or returns the same temporary draft; never replaces an expired known session                                                                |
| `await work(ownerId)`               | Lists the owner's active run handles and unexpired temporary drafts for reconnect; a run that already has a draft is listed only as the draft                      |
| `await handoff(ownerId, runId)`     | Copies a completed result into a 24-hour owner-bound draft and records cleanup intent in one transaction, then retires eve history; a retry returns the same draft |
| `drafts`                            | Temporary draft store: `read`, `list`, `handoff`, `update`, `discard`, `save` and `purgeExpired`                                                                   |
| `await acknowledge(ownerId, runId)` | Legacy. Retires a completed result that was not handed off, without saving it, and retires eve history; the editor uses `handoff`                                  |
| `await cancel(ownerId, runId)`      | Records cancellation, clears content and retires any known session without starting a replacement                                                                  |
| `await sweep(limit)`                | Reconciles abandoned readers, expires completed results, retries cleanup and purges expired drafts                                                                 |

Dispatch has two committed phases: allocate an empty session using Atlas's stable operation ID, persist that session ID, then send the immutable note to that fixed session using an idempotency key. A lost send response retries the same delivery. Allocation retries can leave empty idle sessions, but cannot submit a note or start a model. The installed eve 0.91 HTTP protocol supports these keys; its client serializer does not, so the small submission adapter uses validated HTTP responses.

Runtime URLs are pinned before allocation, so an API redeploy cannot redirect an existing run to another deployment. Keep old deployments and the matching service credential available while their runs remain active. Short database row locks in the dedicated organizer pool serialize dispatch (allocate, submit) and cleanup (usage inspection, retire) across API instances; no lock spans model generation, and polling reads inspect the runtime outside the lock and re-check run identity, state and usage before saving. Holding the lock across the short dispatch and cleanup transport calls is deliberate: it prevents a second allocation or a second note submission without an extra pending state. The cost is that two concurrent dispatches fill the two-connection pool and a third caller waits the five-second lock limit, then gets a 503 logged as `storage_failure` with `code: "55P03"`. If that code appears on organize start routes in production logs, move dispatch to a lease (write a pending marker under a short lock, call the runtime unlocked, re-enter and compare) as `read()` already does. Source reads share that transaction's connection. Every delivery rechecks source access and revision, including after runtime inspection. The original note is never written.

Disconnecting a browser stops only that reader. Reconnect reads the existing handle. An unknown or expired handle must not automatically call `start`. A new explicit Organize action can create a new run after the previous one retires. Duplicate-run handling does not promise exactly-once provider billing when a provider completed a request before a runtime step's result was recorded.

## Cleanup and runtime bounds

Handoff, cancellation, legacy acknowledgement, failed output and expiry first persist cleanup intent and remove the run's draft/input content, then end the remote session. An uncertain end response leaves a retryable cleanup reference; it never authorizes another generation. Successful retirement releases the active-note slot and leaves only content-free metadata for 48 hours, including available token/cost totals. The sweep deletes expired terminal metadata after that 48-hour window. This is separate from the 15-minute undelivered-result window. Handoff moves the result into a temporary draft that expires 24 hours after handoff; cancellation and acknowledgement remove the result immediately. Deleting a source note does not cascade away its cleanup reference.

The `reconcile` schedule runs each minute when `ORGANIZER_MAINTENANCE_ENABLED=true`. It processes five oldest active records, rotating failed attempts so they cannot starve later work. Enable it only in the deployment responsible for that database environment. Previews leave it disabled. Without a running sweep, do not claim unattended Atlas cleanup; eve's idle timeout is only a fallback. Expiry is measured from the recorded generation completion, not the first reconnect.

Usage is captured from durable model/research events before remote retirement, including cancellation without an attached reader. Replayed snapshots replace totals instead of adding them twice. Missing provider cost stays absent; `complete: false` identifies incomplete reported metrics. The installed eve version may omit OpenRouter outer-model cost, so these totals are not an invoice or a billing guarantee. Accounting unavailability does not postpone private-content cleanup.

Running views expose durable `phaseStartedAt`/`lastProgressAt` when available. Polling does not reset them. `stalled` uses the existing 180-second research and 600-second model silence bounds; it signals the UI without restarting work. While `start` returns `cleanup_pending`, keep the returned handle and poll `read` to finish/retry cleanup. Only a later explicit Organize action after a terminal result starts a new run. A bounded database lock timeout is retryable and must not be displayed as a successful cancellation.

The only model tool is `research`. Its `question` input is trimmed and must be 1 to 500 characters (`researchInputSchema` in `agent/tools/research.ts`). It uses OpenRouter and returns provider source records, which remain separate from model prose. Research retries 429/502/503/504 at most three attempts with full jitter and `Retry-After`; broken streams and uncertain network failures are not blindly replayed. An opaque research call has a 180-second runtime deadline. A durable eve hook rejects the seventeenth model request. The installed eve model caller has a native 600-second first/chunk silence timeout. These runtime safeguards work without an attached browser; polling does not own cancellation timers.

Outer/research output limits are 16,384/8,192 tokens. Truncation or invalid output is rejected. Markdown must fit the 100,000-character note contract. The session token backstop pauses at 1,000,000 input or 65,536 output tokens; paused work is not a completed draft. No per-note dollar cutoff is imposed. Sonnet 5.5 is the evaluated model candidate, not an accuracy guarantee.

Session titles are fixed and content tracing is disabled. Ending requests zero Workflow retention. A verified ended/expired session is not proof of immediate physical deletion, deletion from database backups, or deletion by model/search providers. Vercel documents physical copies can remain up to 36 days. Verify hosted access and retention before sending real private notes.

## Note indexing

Apply `0006_note-index` using the [write-paused cutover](../../docs/development.md#note-index-migration-cutover). Old note writers must be stopped and drained before its one-time backfill.

The same private runtime executes note indexing for #67. `POST /internal/note-index/start`
accepts only a note ID and requires the existing service Basic credential. It claims the
current database intent and starts one Workflow. The single step reads, projects, embeds
and publishes the note. Workflow arguments and results contain identifiers and an outcome,
never note text or vectors. `GET /internal/note-index/runs/:runId` returns only run status.

The existing maintenance schedule also reconciles index work when
`ORGANIZER_MAINTENANCE_ENABLED=true`. Runs retain their immutable runtime URL. Unknown
runtime status leaves a claim untouched. Confirmed terminal runs release their claim,
and transient failures retry with full jitter from 30 seconds up to 15 minutes.
Unsupported projections remain failed until the note changes. No public retry endpoint
or retry button is required. Keep old deployments and their service credentials available
until their work finishes. An expired allocation token fences a late Workflow before it
can call the provider.

## Question answering

Implements [#71](https://github.com/atlas-depot/atlas/issues/71); the decisions are in the
[proposal](../../docs/proposals/71-grounded-chat-turn.md). The same agent answers questions
over the user's notes. The service username fixes the job: `api` runs Organize and indexing,
`chat` runs answers. `job.ts` holds the rule. A chat session gets `instructions/answer.ts`
and the `search_notes` tool only; `research` and the Organize instructions are withheld.
A session touched by both principals gets neither tool.

`search_notes` accepts a query and a limit. It finds the owner through the running attempt
bound to its own session ID, embeds the query with the index profile and returns current
owned passages with a server-computed ID. It needs `DATABASE_URL` and `OPENROUTER_API_KEY`
in the runtime. `answer-client.ts` sends inputs with an idempotency key and the reply schema,
uses `turnPolicy: "steer"` only for an explicit steer, and reads results from bounded
snapshots. `eve-transport.ts` carries the request code both clients share.

The `reconcile` schedule also continues answers no reader is polling and retires finished,
stopped or deleted answer sessions.

Follow-ups reconstruct separate answer runtimes using the [#72 context contract](../../docs/proposals/72-conversation-context.md).
The private `context` principal performs bounded conversation summarization without note or web
tools. The API persists its operation and cleanup intent before allocation; reconnect uses the
same delivery. The provider middleware rechecks live source authorization for every chat/summary
model request, including automatic compaction and retries. Organize keeps its existing model path.
Unknown history, invalid summaries, oversized context and confirmed runtime expiry return explicit
recovery instead of unbounded history or a blind replacement. Routine tests use scripted summaries.

## Build and verification

Use `pnpm --dir agents/organizer build` for the standalone eve service. A Vercel project rooted at `agents/organizer` must include workspace files outside that directory and install the root workspace. Use Node 26, normal `eve build`, the private service token and provider settings. Hosted builds supply Vercel OIDC for eve's default sandbox preparation. A local build with `--skip-sandbox-prewarm` only checks generated structure; it is not proof of a deployable artifact. No sandbox tool is exposed to this agent.

Set the database and maintenance settings only for the intended environment. `VERCEL_URL` supplies the schedule's immutable current deployment URL when `ORGANIZER_RUNTIME_URL` is omitted. Hono must use the same immutable URL. Deployment Protection, if enabled, also needs supported server-to-server access before the service can be reached. A cron definition in build output is not proof that the hosted scheduler ran.

Run root checks, `pnpm test:db` against isolated local PostgreSQL, and organizer `check`/`test`. Database regressions cover cross-owner rejection, concurrent coalescing, actual process replacement, uncertain submission, source changes/deletion, cancelled/expired sessions and retryable cleanup. Adapter tests cover finite snapshots, citations and incomplete output. Real local eve with mocked model HTTP and live Neon development checks are reported separately from deployed Workflow and live model evidence.

#51 owns note CRUD. #53 owns the editable draft, handoff, explicit Save and source rendering. Organize transport and its owner-scoped database operations belong to #50; HTTP/database tests are separate from live provider and browser verification.

References: [eve transport](https://eve.dev/docs/channels/eve), [Vercel deployment](https://eve.dev/docs/guides/deployment/vercel), [OpenRouter search](https://openrouter.ai/docs/guides/features/server-tools/web-search), [Workflow retention](https://vercel.com/docs/workflows/retention).
