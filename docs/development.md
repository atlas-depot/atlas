# Development setup

Use Node `24.22.0` and pnpm `11.23.0`, pinned in `.node-version` and `package.json`. Select the runtime with your existing version manager. Routine setup and tests need no provider credentials or paid accounts.

## Tooling

From the repository root:

```sh
node --version
pnpm --version
pnpm install --frozen-lockfile
pnpm --dir experiments/eve-openrouter install --frozen-lockfile
pnpm dev
```

The isolated experiment has its own workspace and lockfile. Its dependency install is required before repository-wide lint/type checks and the optional pre-push hook, because those checks inspect its TypeScript. Installing it does not make model calls. If Corepack is available, `corepack pnpm <command>` can use the pinned pnpm without changing global shims.

Use `pnpm install` only when intentionally changing dependencies and commit the resulting lockfile. Subsequent installs use `--frozen-lockfile`. Vite+ owns the toolchain; retain its matching Vite alias and Vitest overrides in `pnpm-workspace.yaml`.

| Command | Purpose |
| --- | --- |
| `pnpm dev` | Frontend development server |
| `pnpm dev:api` | Node/Hono API with watch mode |
| `pnpm start:api` | Same API entrypoint without watch mode |
| `pnpm check` | Format, lint and type checks |
| `pnpm format:check` | Formatting check without rewriting files |
| `pnpm lint` | Lint with type-aware rules and full type checking |
| `pnpm typecheck` | Type checks only |
| `pnpm test` | Unit and integration tests |
| `pnpm coverage` | Tests with V8 coverage |
| `pnpm test:e2e` | Playwright against the built frontend |
| `pnpm build` | Frontend bundle in `dist/`, not an API build or deployment |
| `pnpm preview --host 127.0.0.1 --port 4177 --strictPort` | Serve the built frontend locally |

Static checks do not auto-fix files. Run `pnpm exec vp fmt` deliberately when formatting should change. Both TypeScript configs use strict mode; the Node config also includes `server/` and `shared/`.

## Local API

In a second terminal, from the repository root:

```sh
cp -n .env.example .env
pnpm dev:api
```

The development commands read root `.env`. `API_PORT` defaults to `3001` and accepts a decimal integer from 0 to 65535. Use a fixed nonzero port for development; `0` requests an ephemeral port for entrypoint tests. The backend binds to `127.0.0.1`. Invalid configuration fails startup without echoing environment values.

Vite proxies `/api` and `/api/...` to the backend without changing the path. Browser callers use relative URLs such as `fetch('/api/health')`. Health returns `200`; notes return `401` until authentication is connected. Health is process liveness, not database or provider readiness. The Node entrypoint runs TypeScript directly, without a separate transpiler.

For concurrent worktrees, set different `API_PORT` values and frontend ports, for example `pnpm dev --host 127.0.0.1 --port 5177 --strictPort`. Stop both processes with Ctrl-C. Production routing is separate configuration.

## Tests and coverage

Import test APIs from `vite-plus/test`. The existing runner discovers tests under `src/`, `scripts/`, `server/` and `shared/`, with `passWithNoTests: false`. Do not add another Vitest installation. A no-tests run is not passing evidence.

Coverage includes those source directories and excludes tests, declarations, configuration, generated output, `e2e/` and `experiments/`. It prints file-level coverage and writes totals to `coverage/summary.txt`. Percentages are informational, with no threshold; assert behavior rather than aiming only to execute lines.

Test session injection does not prove WorkOS sign-in or database isolation. Keep mocked provider checks separate from live verification, and run paid model tests only with an explicit budget. See [atlas-test](../.agents/skills/atlas-test/SKILL.md) for boundary selection and regression checks.

### Browser regression

Install Chromium once with `pnpm exec playwright install chromium`. Playwright builds the frontend and serves it on `127.0.0.1:4177` without reusing an existing server. An occupied port fails the run. CI retains a trace on failure. For visible UI changes, also verify mobile width, desktop and keyboard behavior.

### Optional pre-push hook

Enable the repository hook with `git config --local core.hooksPath .githooks`. This replaces any existing hook path in the clone; integrate it manually if another hook manager is in use. Disable it with `git config --local --unset core.hooksPath`.

The hook runs `pnpm check`, isolated experiment tests, ClickUp sync tests and `pnpm build`. It does not install dependencies or run coverage/browser tests. Both dependency installs above must already exist.

## Code conventions

- Use strict TypeScript, named exports and explicit dependencies. Name collection routes with plural resources, such as `/api/notes`.
- Keep shared request authentication separate from resource authorization. Authenticate once at the protected boundary, then scope every resource operation to that identity.
- Keep field contracts in Zod schemas. TSDoc explains semantic decisions that types cannot express; avoid duplicate prose, numbered-issue comments and wrappers without a consumer.
- Test observable behavior at the smallest useful boundary with independent expected results. Inspect other callers before changing a shared function.
- Keep UI states accessible and distinguish unsaved, loading, empty and failed operations. Preserve user input when saving fails.

References: [Google review guidance](https://google.github.io/eng-practices/review/reviewer/looking-for.html), [The Practical Test Pyramid](https://martinfowler.com/articles/practical-test-pyramid.html), [Testing Library principles](https://testing-library.com/docs/guiding-principles/).

## Environments and secrets

| Environment | Data and access |
| --- | --- |
| Local | Synthetic data and mocks; isolated remote Neon branch per developer when provisioned |
| PR preview | Test data and credentials, no production access |
| Staging | Shared integration database with reviewed migrations |
| Production | Separate real-user data and credentials |

Preview URLs do not isolate databases. Neon branches isolate data and resets, not migration conflicts. Keep scheduled actions and connector subscriptions off in previews unless enabled for a specific test. Match versions and migrations without copying production data.

Commit only safe `.env.example` values and validate consumed settings at startup. Real env files stay ignored. Server credentials must never enter `VITE_*`, frontend configuration, logs or browser imports. User OAuth tokens belong in protected provider storage, not a shared `.env`.

Vercel environment variables are the selected hosting approach. Project linkage, access and any seat charges still need verification. Track model, sandbox, storage and connector costs together; credits are finite and a token cap does not cap the whole product bill.

## CI and deployment status

CI runs on pull requests and pushes to `main`. Required `verify` aggregates format, lint/typecheck and build. Coverage runs the full root suite separately and publishes its summary; browser regression is also separate. Neither belongs to the `verify` aggregate. The lint job installs the isolated experiment and runs its mocked budget-guard tests without credentials. CI uses `.node-version`.

Feature previews and `main` production remain the deployment direction. Git branches and passing CI do not configure Vercel linkage, routing or credentials. After an authorized deployment, verify the revision and affected live flow. Application rollback does not roll back the database. Follow [contributing](contributing.md) for PR evidence and merge authority.

References: [Vite+ local CLI](https://viteplus.dev/guide/local-cli), [Vite environment variables](https://vite.dev/guide/env-and-mode), [Vercel Git integration](https://vercel.com/docs/git), [Vercel env CLI](https://vercel.com/docs/cli/env).
