# Atlas

A personal assistant for scattered context: notes, connected sources and useful memory.

Atlas currently has a React/TypeScript notes editor built with shadcn/Base UI and a local Hono API. The editor and development fixtures follow the REST/Zod note contract with separate create/update and ETag/If-Match handling. Development saves are session-only; actual note persistence and account lifecycle integration remain pending. The WorkOS browser sign-in routes and protected API boundary were verified live against WorkOS Staging. The [architecture](docs/architecture.md) separates accepted decisions from implemented behavior.

## Start development

Use Node `24.22.0` and pnpm `11.23.0`:

```sh
pnpm install --frozen-lockfile
pnpm --dir experiments/eve-openrouter install --frozen-lockfile
pnpm dev
```

For the API, run `cp -n .env.example .env` once and `pnpm dev:api` in another terminal. See [local API setup](docs/development.md#local-api) for ports and authentication status.

Run `pnpm check`, `pnpm test` and `pnpm build` before review. See [development](docs/development.md) for browser tests, coverage and CI boundaries. Independent PRs target `main`, need human review and require Efe's merge decision under [contributing](docs/contributing.md).

## Project references

- [Product](docs/product.md): intended use and open product decisions.
- [Architecture](docs/architecture.md): stack, responsibilities and current scope.
- [Note schemas](shared/notes.ts): field contracts and API semantics.
- [Security](docs/security.md): identity, sources, credentials and action policy.

Older UI prototypes are historical references, not the selected design. Agents start with [AGENTS.md](AGENTS.md).
