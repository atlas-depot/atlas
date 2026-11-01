# Private note organizer

Preparation for [#50](https://github.com/atlas-depot/atlas/issues/50). Hono derives the owner from its verified session and calls this private eve service. Public HTTP wiring follows #51, browser receipt acknowledgement follows #53. No browser receives the service credential or raw eve session identifiers.

Install the root workspace with `pnpm install --frozen-lockfile`. Copy `.env.example` here to `.env.local` and supply development credentials. Run `pnpm --dir agents/organizer dev`. The local service binds to `127.0.0.1:2027`. Model quality trials use synthetic notes and an explicitly budgeted provider key; routine tests never call paid models.

## Durable execution and delivery

Create `createOrganizerBackend` from `backend.ts` with the owned Drizzle connection, an immutable eve deployment URL, the private service token and `resultRetentionMs` (development default: 900,000 ms). The caller owns and closes the connection pool. Use a pooled Neon URL for requests and a direct URL for reviewed migrations. Apply the versioned migration with the root `db:migrate` command, never at request startup.

Neon stores owner-bound run handles, the exact source revision, a temporary input snapshot, runtime identity and delivery state. eve on Vercel Workflow owns execution. API shutdown does not cancel accepted work. There is no process-local run registry or second agent loop.

| Operation                           | Behavior                                                                                            |
| ----------------------------------- | --------------------------------------------------------------------------------------------------- |
| `await start(ownerId, noteId)`      | Claims one active run per owned note across API instances, then dispatches it                       |
| `await read(ownerId, runId)`        | Inspects existing work or returns the same temporary draft; never replaces an expired known session |
| `await acknowledge(ownerId, runId)` | Only after the browser confirms receipt, erases the temporary draft and retires eve history         |
| `await cancel(ownerId, runId)`      | Records cancellation, clears content and retires any known session without starting a replacement   |
| `await sweep(limit)`                | Reconciles abandoned readers, expires completed results and retries cleanup                         |

Dispatch has two committed phases: allocate an empty session using Atlas's stable operation ID, persist that session ID, then send the immutable note to that fixed session using an idempotency key. A lost send response retries the same delivery. Allocation retries can leave empty idle sessions, but cannot submit a note or start a model. The installed eve 0.91 HTTP protocol supports these keys; its client serializer does not, so the small submission adapter uses validated HTTP responses.

Runtime URLs are pinned before allocation, so an API redeploy cannot redirect an existing run to another deployment. Keep old deployments and the matching service credential available while their runs remain active. Short database row locks serialize dispatch, inspection and cleanup across API instances; no lock spans model generation. Source reads share that transaction's connection. Every delivery rechecks source access and revision, including after runtime inspection. The original note is never written.

Disconnecting a browser stops only that reader. Reconnect reads the existing handle. An unknown or expired handle must not automatically call `start`. A new explicit Organize action can create a new run after the previous one retires. Duplicate-run handling does not promise exactly-once provider billing when a provider completed a request before a runtime step's result was recorded.

## Cleanup and runtime bounds

Acknowledgement, cancellation, failed output and expiry first persist cleanup intent and remove draft/input content, then end the remote session. An uncertain end response leaves a retryable cleanup reference; it never authorizes another generation. Successful retirement releases the active-note slot and leaves only a short-lived tombstone. The sweep deletes expired tombstones. Deleting a source note does not cascade away its cleanup reference.

The `reconcile` schedule runs each minute when `ORGANIZER_MAINTENANCE_ENABLED=true`. It processes five oldest active records, rotating failed attempts so they cannot starve later work. Enable it only in the deployment responsible for that database environment. Previews leave it disabled. Without a running sweep, do not claim unattended Atlas cleanup; eve's idle timeout is only a fallback. Expiry is measured from the recorded generation completion, not the first reconnect.

The only model tool is `research`. It uses OpenRouter and returns provider source records, which remain separate from model prose. Research retries 429/502/503/504 at most three attempts with full jitter and `Retry-After`; broken streams and uncertain network failures are not blindly replayed. An opaque research call has a 180-second runtime deadline. A durable eve hook rejects the seventeenth model request. The installed eve model caller has a native 600-second first/chunk silence timeout. These runtime safeguards work without an attached browser; polling does not own cancellation timers.

Outer/research output limits are 16,384/8,192 tokens. Truncation or invalid output is rejected. Markdown must fit the 100,000-character note contract. The session token backstop pauses at 1,000,000 input or 65,536 output tokens; paused work is not a completed draft. No per-note dollar cutoff is imposed. Sonnet 5.5 is the evaluated model candidate, not an accuracy guarantee.

Session titles are fixed and content tracing is disabled. Ending requests zero Workflow retention. A verified ended/expired session is not proof of immediate physical deletion, deletion from database backups, or deletion by model/search providers. Vercel documents physical copies can remain up to 36 days. Verify hosted access and retention before sending real private notes.

## Build and verification

Use `pnpm --dir agents/organizer build` for the standalone eve service. A Vercel project rooted at `agents/organizer` must include workspace files outside that directory and install the root workspace. Use Node 24, normal `eve build`, the private service token and provider settings. Hosted builds supply Vercel OIDC for eve's default sandbox preparation. A local build with `--skip-sandbox-prewarm` only checks generated structure; it is not proof of a deployable artifact. No sandbox tool is exposed to this agent.

Set the database and maintenance settings only for the intended environment. `VERCEL_URL` supplies the schedule's immutable current deployment URL when `ORGANIZER_RUNTIME_URL` is omitted. Hono must use the same immutable URL. Deployment Protection, if enabled, also needs supported server-to-server access before the service can be reached. A cron definition in build output is not proof that the hosted scheduler ran.

Run root checks, `pnpm test:db` against isolated local PostgreSQL, and organizer `check`/`test`. Database regressions cover cross-owner rejection, concurrent coalescing, actual process replacement, uncertain submission, source changes/deletion, cancelled/expired sessions and retryable cleanup. Adapter tests cover finite snapshots, citations and incomplete output. Real local eve with mocked model HTTP and live Neon development checks are reported separately from deployed Workflow and live model evidence.

#51 still owns authenticated HTTP integration. #53 owns the editable draft, receipt acknowledgement, explicit Save and source rendering. #50 remains open until the full integrated and deployed acceptance checks pass.

References: [eve transport](https://eve.dev/docs/channels/eve), [Vercel deployment](https://eve.dev/docs/guides/deployment/vercel), [OpenRouter search](https://openrouter.ai/docs/guides/features/server-tools/web-search), [Workflow retention](https://vercel.com/docs/workflows/retention).
