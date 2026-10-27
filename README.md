# Atlas

A personal assistant for scattered context: user-written notes, connected sources, useful memory, and approved actions through chat.

## Current status

Atlas has a React/TypeScript source viewer and a local Hono API scaffold.
The API serves health requests and rejects unauthenticated notes requests. Real
WorkOS sign-in and Neon persistence are separate tasks, not working features yet.
Vite+ provides development tooling. Hono, REST/Zod, WorkOS, Neon and Drizzle are
approved choices; eve remains the agent-runtime direction.

## Read what you need

- [Product](docs/product.md): intended use, scope, and decisions still open.
- [Architecture](docs/architecture.md): accepted decisions, responsibility boundaries and remaining work.
- [Notes API](docs/notes-api.md): payloads, errors and conditional writes for the notes sprint.
- [Development](docs/development.md): local setup, environments, and current infrastructure gaps.
- [Contributing](docs/contributing.md): small PRs, human review, and parallel work that integrates into main.
- [Security](docs/security.md): identity, connected accounts, memory, and external actions.
- [Project log](docs/project-log.md): optional template for contribution and academic evidence.

Older design prototypes under `docs/prototypes/` are historical experiments, not the selected UI.
Use Git history for superseded plans rather than treating them as current requirements.

## Start development

Use Node `24.22.0` LTS and pnpm `11.23.0`, pinned in `.node-version` and `package.json`.

```sh
pnpm install --frozen-lockfile
pnpm dev
```

For the local API, run `cp .env.example .env` once, then `pnpm dev:api` in a second terminal. Vite forwards `/api` to Hono. See [local API setup](docs/development.md#local-api) for ports and the current authentication boundary.

Run `pnpm check` for formatting, lint and type checks, and `pnpm build` for the production bundle. See [development setup](docs/development.md) for all commands and dependency notes.

`pnpm test` runs the fixture, automation, backend and shared-contract tests with Vite+'s bundled Vitest runner. A run that finds no test files is not passing evidence.

CI runs format, lint, typecheck and build checks on pull requests through the `verify` check in `.github/workflows/ci.yml`. The separate coverage job runs the unit and integration suite, and browser regression checks the built frontend. Deployment setup remains separate work.
Independent PRs target `main`. Dependent PRs can target their parent branch for development and review. Follow [the parallel-work procedure](docs/process/parallel-work.md) before integrating each PR into `main`. A human teammate reviews and Efe decides whether to merge. Vercel project linkage and deployments still need separate configuration and verification.

Agents start with [AGENTS.md](AGENTS.md).
