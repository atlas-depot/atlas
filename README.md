# Atlas

A personal assistant for scattered context: user-written notes, connected sources, useful memory, and approved actions through chat.

## Current status

Atlas has a minimal React/TypeScript web scaffold.
The app currently renders the Atlas heading and introduction. Agent and provider integrations are not implemented.
Vite+ provides development tooling. Eve is the agent-runtime direction to validate.
UI direction and remaining backend choices will be reviewed with the team before they become implementation contracts.

## Read what you need

- [Product](docs/product.md): intended use, scope, and decisions still open.
- [Architecture](docs/architecture.md): responsibility boundaries and candidate implementation.
- [Development](docs/development.md): local setup, environments, and current infrastructure gaps.
- [Contributing](docs/contributing.md): small PRs, human review, and parallel work that integrates into main.
- [Security](docs/security.md): identity, connected accounts, memory, and external actions.
- [Project log](docs/project-log.md): individual contribution and academic evidence.

Older design prototypes under `docs/prototypes/` are historical experiments, not the selected UI.
Use Git history for superseded plans rather than treating them as current requirements.

## Start development

Use Node `22.23.2` and pnpm `11.23.0`, pinned in `.node-version` and `package.json`.

```sh
pnpm install --frozen-lockfile
pnpm dev
```

Run `pnpm check` for formatting, lint and type checks, and `pnpm build` for the production bundle. See [development setup](docs/development.md) for all commands and dependency notes.

`pnpm test` invokes Vite+'s bundled Vitest runner. No behavior tests ship in this scaffold, so it exits with "No test files found" until the first fixture/parser tests in [#22](https://github.com/atlas-depot/atlas/issues/22). This is not passing test evidence.

There is no application CI yet. CI and deployment setup remain separate work.
Independent PRs target `main`. Dependent PRs can target their parent branch for development and review. Follow [the parallel-work procedure](docs/process/parallel-work.md) before integrating each PR into `main`. A human teammate reviews and Efe decides whether to merge. Vercel project linkage and deployments still need separate configuration and verification.

Agents start with [AGENTS.md](AGENTS.md).
