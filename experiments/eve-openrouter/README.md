# eve + OpenRouter experiment

This isolated experiment addresses [#26](https://github.com/atlas-depot/atlas/issues/26):
synthetic input -> an actual eve session -> OpenRouter -> an observable answer.
It is outside the Atlas web application and its root workspace.
Repository-wide lint/type checks still inspect its TypeScript files. CI installs
this directory's frozen dependencies before those checks, without a model key or
live invocation.

## Run locally

Use Node 24.22.0 and pnpm 11.23.0. From this directory:

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm test
EVE_TELEMETRY_DISABLED=1 pnpm run info
cp -n .env.example .env.local
```

Create a dedicated OpenRouter key with a **non-resetting total limit of at most $1**.
Set `OPENROUTER_API_KEY` in `.env.local`, never a `VITE_*` variable. Do not overwrite
an existing local env file. The file is ignored by Git. eve loads it locally.

Start the loopback-only server, then run the smoke in another terminal:

```sh
pnpm dev
# In a second terminal, in this same directory:
pnpm smoke
```

The server checks its own key's provider-enforced cap before every model request
and explicitly uses that same key for the request. Exported server environment
variables take precedence over `.env.local`; a stale high-limit key is rejected.
The smoke needs no credential. It sends one fixed synthetic note and requires a
completed answer containing `14:00`. It prints the synthetic input/answer, session
ID and per-step usage. It does not measure dollar spend: a separate client's key
may differ from the server's. Check spending for the server's key in OpenRouter.
The request has a 60-second client deadline; on failure it attempts to cancel the
turn. Stop the server after the experiment. Cancellation does not undo charges
for a request that already reached the provider.

## Boundaries

- `eve@0.83.0`, `ai@7.0.152`, and `@openrouter/ai-sdk-provider@3.1.0` are pinned.
- The provider model object routes through OpenRouter. A plain model ID string
  in eve would instead select Vercel AI Gateway.
- `openai/gpt-4.1-mini` is a low-cost connectivity probe, not Atlas's product model choice.
- Output is capped at 256 tokens. Optional built-in tools and development
  extensions are disabled. No tools, connectors, deployment, or private data.
- eve's `sessionUsage` stops further calls after output has been reported. Its
  `costUsd` is not a reliable OpenRouter spending cap; the key limit enforces the budget.
- Key usage can settle after the response, and a shared key would make the delta
  ambiguous. Use a dedicated key. Do not interpret a zero delta as a free call.
- `pnpm test` exercises the actual provider with fake keys and mocked HTTP,
  including unsafe limits and credential mismatch. CI runs these tests without
  credentials. They do not replace live smoke or teammate reproduction.
- This verifies the runtime/provider path, not durability, authorization,
  retrieval quality, tool reliability, or production readiness.

Sources: [eve configuration](https://eve.dev/docs/agent-config),
[eve client](https://eve.dev/docs/guides/client/overview),
[OpenRouter provider](https://github.com/OpenRouterTeam/ai-sdk-provider/tree/3.1.0),
[OpenRouter key limits](https://openrouter.ai/docs/api/reference/limits).
