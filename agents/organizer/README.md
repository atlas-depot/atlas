# Private note organizer

Preparation for [#50](https://github.com/atlas-depot/atlas/issues/50). Public HTTP wiring follows #51. Hono derives the owner from the verified session and calls this private service. Never expose the service token or raw eve session access to the browser.

Install the root workspace with `pnpm install --frozen-lockfile`. Copy `.env.example` here to `.env.local`, supply the OpenRouter credential and an independent random service token, then run `pnpm --dir agents/organizer dev`. The runtime binds to `127.0.0.1:2027`. Remote service traffic requires HTTPS and private deployment access. Sonnet 5.5 is the selected OpenRouter candidate, with its catalogued 1,000,000-token context. Synthetic live trials covered shortening, expansion and research. They are not a general accuracy guarantee.

The only authored capability is `research`. The outer agent chooses when to call it. It returns text, actual provider source records and available usage. Research HTTP failures 429/502/503/504 get at most three attempts with exponential full jitter and `Retry-After`. SDK retries are disabled for that call; network exceptions and broken streams are not replayed. Main-model calls retain eve/AI SDK retry behavior. Source annotations establish provenance, not factual correctness.

## Backend composition and delivery

Create one `createOrganizerBackend` from `backend.ts` per API process, injecting a privately authenticated eve `Client` and the owner-scoped note store's `read` function. It composes note access, runtime delivery and the temporary run registry. Pass explicit `timeouts` and `resultRetentionMs`; for development, start with 30,000 ms startup, 90,000 ms model silence, 180,000 ms per research call and 900,000 ms undelivered-result retention. These are operational defaults to evaluate, not a total generation deadline.

| Operation                     | Behavior                                                                                                |
| ----------------------------- | ------------------------------------------------------------------------------------------------------- |
| `start(ownerId, noteId)`      | Returns an opaque `runId`; repeated starts reuse an active or undelivered run for that owner/note       |
| `read(ownerId, runId)`        | Returns progress or the draft with source revision; no eve IDs or lifecycle callbacks                   |
| `acknowledge(ownerId, runId)` | Call only after the browser confirms receipt; retires eve history and clears the transient server draft |
| `cancel(ownerId, runId)`      | Explicitly cancels accepted work or discards an undelivered result                                      |
| `dispose()`                   | Cancels work at process shutdown and reports unresolved cleanup                                         |

A browser disconnect does not cancel the run. Reconnect reads the same `runId`; it must never automatically call `start` after a failed read. This registry is process-local, suitable for the current single Node process. Restart loses unsaved run handles, and an unknown ID returns `not_found`. Multiple API replicas or restart recovery need shared, owner-bound run storage before deployment. It does not promise exactly-once generation after an uncertain initial POST.

The original note is never written. If it changes while generation runs, the draft retains the original revision and is marked stale. If ownership/read access is lost before delivery, discard the result and retire its session. Cleanup failure remains visible and retryable, including failures before a draft handle exists. Unresolved cleanup retains only its callback and run metadata until explicit retry or shutdown; it can outlive normal result retention. Never label that state successful cleanup.

## Execution and retention bounds

Meaningful model output resets the silence timer; heartbeats and metadata do not. Each opaque research call has its own deadline, unaffected by another call's activity. The observer stops a research loop after 16 model settlements unless the final answer completes at that boundary. Provider outputs are bounded at 16,384 tokens for the outer model and 8,192 for research; truncated output is rejected. Generated Markdown must fit the existing 100,000-character note contract. No per-note dollar cutoff is imposed.

The runtime also pauses before further model calls after 1,000,000 input or 65,536 output tokens, as a backstop if the observer disappears. A paused run is not a completed draft. `ORGANIZER_IDLE_TIMEOUT_MS` expires idle sessions only, not open turns. Shutdown and abandoned active work still require a live observer or deployment recovery.

Session titles are fixed and content tracing is disabled. Ending a session requests zero retention. The local runtime was verified to return `410 session_expired` afterward; a lost end receipt can require an acknowledgement retry and a separate history check. Hosted storage and model/search providers have their own retention. Vercel documents physical copies can remain up to 36 days. Verify the chosen deployment before real private notes are sent.

## Verification and remaining integration

Run `pnpm --dir agents/organizer check`, `pnpm --dir agents/organizer test` and the root checks without credentials. Tests exercise the OpenRouter SDK against mocked HTTP, watchdog/retry behavior, owner checks, duplicate starts, reconnect, cancellation and cleanup. Live synthetic quality evidence belongs in the PR, not routine CI.

Before #50 closes: wire the authenticated HTTP endpoints with #51, connect browser receipt acknowledgement with #53, verify deployed access/retention and the full persisted-note flow. #53 owns explicit derivative Save and source rendering. No unsaved draft is persisted as a note by this runtime.

References: [eve client](https://eve.dev/docs/guides/client/overview), [OpenRouter search](https://openrouter.ai/docs/guides/features/server-tools/web-search), [Sonnet 5.5](https://openrouter.ai/anthropic/claude-sonnet-5.5), [Vercel retention](https://vercel.com/docs/workflows/retention).
