# Private note organizer

Preparation for [#50](https://github.com/atlas-depot/atlas/issues/50). This runtime is not connected to the notes HTTP API yet. Hono must verify note ownership before calling it. The browser must not receive its service credential or raw eve session access.

Install the root workspace with `pnpm install --frozen-lockfile`. Copy this directory's `.env.example` to `.env.local`, choose the model and its documented context size, and set an independent random service token. Then run `pnpm --dir agents/organizer dev`. The local runtime binds to `127.0.0.1:2027`. Remote service traffic requires HTTPS and private deployment access.

The only authored capability is `research`. It makes one OpenRouter request with the provider's web-search tool and returns the answer, provider source records and available usage. The outer agent chooses whether to call it. Research HTTP failures 429/502/503/504 get at most three attempts with exponential full jitter and `Retry-After`; SDK retries are disabled for that call. Network exceptions and broken response streams are not replayed. The main agent retains eve/AI SDK's own retry behavior; the custom retry wrapper is not stacked onto it. Source annotations establish provenance, not factual correctness. The old experiment's GPT-4.1-mini is not a selected product model.

`client.ts` reads a complete draft and returns an explicit `acknowledge()` handle. Call it only after Atlas accepts the result. Acknowledgement ends that isolated session and requests zero retention. Failure remains visible and retryable. The caller must associate handles with their owners, handle abandoned runs, prevent duplicate submissions and supply operation/cleanup cancellation signals. The adapter does not implement public HTTP routes or durable run tracking. `ORGANIZER_IDLE_TIMEOUT_MS` is the required abandonment fallback, not a total generation deadline.

Session titles are fixed and content tracing is disabled. Zero retention applies after session termination and depends on the Workflow World. It does not erase model/search-provider copies or guarantee immediate physical deletion on hosted storage. Vercel documents that physical copies can remain up to 36 days. Verify the selected deployment's retention before real private notes are used.

Run `pnpm --dir agents/organizer check` and `pnpm --dir agents/organizer test` without credentials. The tests cover real OpenRouter SDK parsing against mocked HTTP, retry behavior and the client lifecycle. They do not establish live answer quality. The owner-scoped note service and its tests live in `server/organize-note.ts` and `server/organize-note.test.ts`.

Before #50 can close: integrate #51 and define the delivery/acknowledgement contract for #53, select and evaluate the product model, finalize active-run limits and duplicate recovery, verify deployed access/retention, and run the full owned-note API flow. Saving a derivative remains explicit and belongs to #53.

References: [eve client](https://eve.dev/docs/guides/client/overview), [OpenRouter search](https://openrouter.ai/docs/guides/features/server-tools/web-search), [Vercel retention](https://vercel.com/docs/workflows/retention).
