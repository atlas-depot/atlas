# Development setup

Status: the repository contains a minimal React/TypeScript web scaffold. It renders an Atlas heading and introduction, with no backend, credentials or external services required. Report the actual result of each check; a build is not a deployment and a no-tests run is not passing test evidence.

## Tooling

Use Node `22.23.2` and pnpm `11.23.0`. `.node-version` records the runtime and `package.json#packageManager` pins pnpm. Select that Node version with your existing runtime manager before installing; the project does not install or change a global runtime manager. Commit only `pnpm-lock.yaml` as the dependency lockfile.

From the repository root:

```sh
node --version
pnpm --version
pnpm install --frozen-lockfile
pnpm dev
```

Vite prints the local development URL. To choose an isolated port, use `pnpm dev --host 127.0.0.1 --port 5177 --strictPort`. Stop the server with Ctrl-C.

| Command | What runs |
| --- | --- |
| `pnpm check` | Vite+ format, lint and type checks |
| `pnpm lint` | Vite+ lint checks |
| `pnpm typecheck` | Vite+ type checks through its TypeScript Go toolchain |
| `pnpm test` | `vp test run`, using bundled Vitest 5.0.5 |
| `pnpm build` | Production bundle in `dist/`; run `pnpm check` separately |
| `pnpm preview --host 127.0.0.1 --port 4177 --strictPort` | Serve the built bundle locally |

The first install that creates or intentionally updates the lockfile uses `pnpm install`. Subsequent clean installs use `--frozen-lockfile` so mismatches fail instead of rewriting it. No secrets, database, seed process or paid account is needed for this scaffold.

Vite+ `1.3.0` owns the frontend toolchain. `vite` resolves to its matching core alias, and the workspace overrides keep Vite and Vitest aligned with the bundled versions. The `pnpm-workspace.yaml` contains resolution settings for this one package, not empty monorepo packages. Both `lint.options.typeAware` and `typeCheck` are enabled in `vite.config.ts`; the app and tooling tsconfigs explicitly enable strict mode. Formatting excludes existing planning documents, historical prototypes and agent instructions to preserve those artifacts.

Dependencies have concrete consumers:

- `react` and `react-dom` render the page through `src/main.tsx` and the named `App` component.
- `@vitejs/plugin-react` supplies React development transforms and refresh support.
- `vite-plus` supplies dev, static checks, tests and production builds; the direct `vite` alias provides the matching plugin and client types.
- `typescript` and `@types/node`, `@types/react`, `@types/react-dom` provide compiler/editor tooling and types for the code and config.

### Test runner boundary

Test settings live in `vite.config.ts`: Node environment, `src/**/*.test.ts`, and `passWithNoTests: false`. Import test APIs from `vite-plus/test`; do not add a second Vitest installation or a separate `vitest.config.ts` by habit.

This scaffold has no committed behavior tests. `pnpm test` currently invokes the runner and exits 1 with "No test files found". Record that result explicitly rather than claiming tests pass or enabling `passWithNoTests`. The first fixture/parser behavior tests belong to [#22](https://github.com/atlas-depot/atlas/issues/22). A disposable runner self-check verifies harness execution only and does not provide application behavior coverage.

Before review, verify the clean install, static checks, production build and accessible Atlas heading in a real browser at mobile and desktop widths. Keep browser evidence separate from runner setup evidence.

### Scaffold provenance

The initial config came from `create-vite-plus@1.3.0` with `create-vite@9.2.1 --template react-ts`, generated in a separate scratch directory with agent/editor/git/hook setup disabled. Only application/config files were transferred; existing README, ignore rules and repository instructions were preserved and updated deliberately. Direct dependencies were pinned, strict mode was made explicit and template branding was replaced. The minimal page uses system fonts and semantic HTML; product typography, component libraries and motion remain future design choices.

References: [Vite+ create](https://viteplus.dev/guide/create), [local CLI and version alignment](https://viteplus.dev/guide/local-cli), [check](https://viteplus.dev/guide/check), [test](https://viteplus.dev/guide/test), [published template source](https://github.com/vitejs/vite/tree/create-vite%409.2.1/packages/create-vite/template-react-ts).

## Code conventions

Use strict TypeScript without `any`, named exports, and explicit dependencies instead of hidden business globals. Parse untrusted API/tool input with Zod schemas at boundaries. Keep shared contracts small; do not create abstractions without real callers.

For an API change, specify caller identity, inputs, outputs and errors; inspect affected callers. Update generated contracts through their generator when one exists. Use actual persistence constraints and access filters, not an assumed future ORM.

For UI changes, preserve accessible names and keyboard behavior from existing components. Distinguish optimistic state from persisted data and handle the loading, empty and error states affected by the change. UI verification evidence belongs in the PR as described in [contributing](contributing.md).

## Choosing implementation and test boundaries

Start with the accepted input/output contract and inspect its callers. Separate parsing of untrusted input, domain decisions and side effects when that makes failures independently testable; do not create layers or shared packages without a real consumer. Model meaningful states explicitly, including failure and unknown outcomes when applicable. Prefer a cohesive module that hides a decision over many forwarding wrappers. Refactor behavior-preserving structure separately from a behavior change when that makes review clearer.

Use independent expected results and test observable behavior. Prefer accessible user-facing interactions over component internals in UI tests. Use [atlas-test](../.agents/skills/atlas-test/SKILL.md) to choose test boundaries, prove regression sensitivity and investigate flakes.

Methods: [Google review guidance](https://google.github.io/eng-practices/review/reviewer/looking-for.html), [The Practical Test Pyramid](https://martinfowler.com/articles/practical-test-pyramid.html), [Testing Library principles](https://testing-library.com/docs/guiding-principles/). These inform choices; they do not add dependencies or override an accepted Atlas contract.

## Environments

| Environment | Intended use | Data and side effects |
| --- | --- | --- |
| Local | Fast development and deterministic tests | Seed data, mocks by default; personal test accounts when needed |
| PR preview | Review an isolated code change | Test data and credentials; no production access |
| Production | Published main release | Separate real-user data and credentials |

Different preview URLs do not automatically provide isolated databases. Choose preview data isolation once the database is selected. Keep scheduled/proactive actions and live connector subscriptions off in previews by default; enable deliberately for an integration test.

Local environments need matching versions and migrations, not copies of production data. Do not require every contributor to have paid model keys for routine tests.

## Secrets and account access

Vercel environment variables are the selected starting approach. Team access and any extra seat charges still require verification. Do not add Infisical or a parallel encrypted secret vault without a concrete need.

- Commit only `.env.example` with names and safe placeholders; validate required configuration at startup.
- Ignore real local env files. Never copy production secrets into development.
- Once the project is linked and access granted, use the documented Vercel env workflow to obtain development values.
- Variables exposed to the browser, including `VITE_*`, must contain only public configuration.
- OAuth application credentials are deployment secrets. Each user's OAuth tokens belong in protected connector storage, not a shared `.env`.
- Keep model, connector, and sandbox credentials available only to the backend processes that need them.

## CI and deployment status

There is no application CI in this scaffold. Its local Vite+ commands are available for a separate CI setup; do not hide the current no-tests result to manufacture a green required check. Add relevant deterministic eve evals when agent code exists. Paid live-model evals should be separately limited.

The agreed flow is feature branch preview and `main` production. Efe or configured Vercel automation handles deployment. Configure Vercel Git integration for branch-triggered deployments or a Vercel CLI/API path for CI; branches and CI do not configure deployments by themselves: project linkage, team access, credentials, and environment separation require separate configuration and verification. See [contributing](contributing.md).

After an authorized deployment, verify the deployed revision and affected live flow. A successful build is not a live smoke test, and application rollback does not imply database rollback.

## Budget checks

Track model, sandbox, workflow, storage, and connector costs together. Credits are finite and service-specific. Set execution time and resource limits, stop idle sandbox compute, and record actual spend during the first integration test. Do not claim that a model-token limit caps the whole product bill.

References: [Vercel Git integration](https://vercel.com/docs/git), [Vercel env CLI](https://vercel.com/docs/cli/env), [Vite environment variables](https://vite.dev/guide/env-and-mode).
