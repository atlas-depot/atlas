# Atlas

A personal assistant for scattered context: notes, connected sources and useful memory.

Atlas has an authenticated React/TypeScript notes workspace and a Hono API that stores notes in PostgreSQL through Drizzle. Browser sign-in uses WorkOS; the API stores only the sealed WorkOS session in an HttpOnly cookie. A private eve organizer turns a saved note into an editable AI draft, which is saved as a separate note. The [architecture](docs/architecture.md) separates accepted decisions from implemented behavior.

## Start development

Use Node `26.13.0` and pnpm `11.23.0`:

```sh
pnpm install --frozen-lockfile
pnpm dev
```

One install covers the web app, the API and the private organizer. `pnpm dev` alone serves the editor with synthetic notes kept in tab memory. The [eve/OpenRouter experiment](experiments/eve-openrouter/README.md) has its own install, needed only to run its tests.

For the API, run `cp -n .env.example .env` once and `pnpm dev:api` in another terminal. See [local API setup](docs/development.md#local-api) for ports and authentication status.

Run `pnpm check`, `pnpm test` and `pnpm build` before review. See [development](docs/development.md) for browser tests, coverage and CI boundaries. Independent PRs target `main`, need human review and require Efe's merge decision under [contributing](docs/contributing.md).

### Database

The API stores notes in PostgreSQL. Set `DATABASE_URL` in `.env` to your own development database, then apply the committed migrations:

```sh
pnpm db:migrate
```

The database tests need a loopback PostgreSQL server. They create and drop their own databases:

```sh
TEST_DATABASE_URL=postgresql://USER@127.0.0.1:55468/postgres pnpm test:db
TEST_DATABASE_URL=postgresql://USER@127.0.0.1:55468/postgres pnpm test:e2e:db
```

See [note schema and migrations](docs/development.md#note-schema-and-migrations) for seeding, Neon branches and the test database rules.

## Project references

- [Product](docs/product.md): intended use and open product decisions.
- [Architecture](docs/architecture.md): stack, responsibilities and current scope.
- [API contract](docs/api.md): routes, status codes and the shared schemas behind them.
- [Note schemas](shared/notes.ts): field contracts and API semantics.
- [Security](docs/security.md): identity, sources, credentials and action policy.

Older UI prototypes are historical references in Git history, not the selected design. Agents start with [AGENTS.md](AGENTS.md).

License: all rights reserved; this is a university project and not yet open for reuse.
