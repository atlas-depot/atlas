# Development setup

Status: the repository contains a minimal React/TypeScript web scaffold. It renders an Atlas heading and introduction, with no backend, credentials or external services required. Report the actual result of each check. A build is not a deployment and a no-tests run is not passing test evidence.

## Tooling

Use Node `24.22.0` LTS and pnpm `11.23.0`. `.node-version` records the runtime and `package.json#packageManager` pins pnpm. Select that Node version with your existing runtime manager before installing. The project does not install or change a global runtime manager. Commit only `pnpm-lock.yaml` as the dependency lockfile.

If `pnpm` is not on your `PATH`, enable it through Corepack, which ships with Node and installs the version pinned in `package.json#packageManager`:

```sh
corepack enable pnpm
pnpm --version
```

`corepack enable` writes shims next to the Node binary, so a system-wide Node installation may need elevated permissions. Otherwise run one-off commands as `corepack pnpm <command>`, which uses the same pinned version without changing `PATH`. Check that any existing pnpm installation reports `11.23.0`.

A local Node other than `24.22.0` may make project commands report an `[WARN] Unsupported engine` warning; `pnpm --version` alone does not. That warning does not fail the install, but activate the version from `.node-version` before recording setup or check results, because CI runs on the pinned runtime.

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
| `pnpm format:check` | Oxfmt formatting validation without writing files |
| `pnpm lint` | Oxlint rules and full type checking with the enabled options |
| `pnpm typecheck` | Vite+ type checks through its TypeScript Go toolchain |
| `pnpm test` | `vp test run`, using bundled Vitest 5.0.5 |
| `pnpm coverage` | `vp test run --coverage`, V8 coverage with the scope below |
| `pnpm test:e2e` | Playwright Test against the built bundle, see [browser regression](#browser-regression) |
| `pnpm build` | Production bundle in `dist/`. Run `pnpm check` separately |
| `pnpm preview --host 127.0.0.1 --port 4177 --strictPort` | Serve the built bundle locally |

The first install that creates or intentionally updates the lockfile uses `pnpm install`. Subsequent clean installs use `--frozen-lockfile` so mismatches fail instead of rewriting it. No secrets, database, seed process or paid account is needed for this scaffold.

The isolated [eve experiment](../experiments/eve-openrouter/README.md) has its own
workspace and lockfile. Before root `check`, `lint`, or the opt-in pre-push hook,
also run `pnpm --dir experiments/eve-openrouter install --frozen-lockfile` so the
repository-wide linter can resolve its types. CI performs this install too.
Installing and type-checking the experiment need no API key and make no model calls;
its live smoke command remains a separate, explicitly budgeted action.

Vite+ `1.3.0` owns the frontend toolchain. `vite` resolves to its matching core alias, and the workspace overrides keep Vite and Vitest aligned with the bundled versions. The Vite peer-version exception accommodates the core alias's `1.3.0` version versus the React plugin's ordinary Vite `^8.0.0` peer range; the override still pins the resolved package. The `pnpm-workspace.yaml` explicitly includes only the root package, so local scratch and evidence folders are not discovered as applications. Both `lint.options.typeAware` and `typeCheck` are enabled in `vite.config.ts`. The app and tooling tsconfigs explicitly enable strict mode. Formatting excludes `docs/**`, `.agents/**`, `.claude/**` and `commitlint.config.cjs`; root `AGENTS.md` and `CLAUDE.md` remain included.

### Static-check verification

`pnpm check`, `pnpm format:check`, `pnpm lint` and `pnpm typecheck` validate without auto-fixing files. Keep `--fix` out of CI-facing commands. Use `pnpm exec vp fmt` deliberately when you want to write formatting fixes locally.

Oxfmt checks layout, such as spacing and quotes; it does not detect incorrect types. Oxlint enforces configured rules, such as `typescript/no-explicit-any`; an explicit `any` is legal TypeScript but violates this rule. Type checking rejects incompatible assignments; it cannot prove a correctly typed calculation produces the right business result. `typeAware` enables rules needing type information, while `typeCheck` enables full type checking. Keep both enabled. With this configuration, `pnpm lint` also reports type errors; `pnpm typecheck` isolates the compiler diagnostics.

To reproduce the #18 failure checks, use a disposable copy of the current candidate with its own frozen-lockfile install. Add only one of the following variants as `src/check-probe.ts` at a time. Leave it unimported to verify checks include source outside the application's import graph. Run all four commands after each variant, then remove the file and rerun them.

| Variant (one-line file) | `format:check` | `lint` | `typecheck` | `check` |
| --- | --- | --- | --- | --- |
| `export const checkProbe="Atlas";` | Fail | Pass | Pass | Fail |
| `export const checkProbe: any = "Atlas";` | Pass | Fail | Pass | Fail |
| `export const checkProbe: number = "Atlas";` | Pass | Fail | Fail | Fail |
| Probe removed | Pass | Pass | Pass | Pass |

Failure means a nonzero exit with the intended formatting, lint or type diagnostic, not an install/configuration error. Compare source and config contents before and after the commands to confirm they do not write fixes. Never commit the deliberate faults. These probes verify static-check enforcement, not application behavior tests. Formatting covers supported non-ignored repository files; lint covers supported code files, and type checking follows `tsconfig.app.json` (`src`) and `tsconfig.node.json` (`vite.config.ts`).

### Optional pre-push hook

The repository includes `.githooks/pre-push`, but it is not active by default. To run `pnpm check`, the ClickUp sync tests and `pnpm build` before every push in this clone:

```sh
git config --local core.hooksPath .githooks
```

This changes the hook path only for the current clone and replaces any existing `core.hooksPath` value. If you already use another hook manager, keep it and merge this check manually instead. Disable the hook with:

```sh
git config --local --unset core.hooksPath
```

The hook runs `pnpm check`, `pnpm --dir experiments/eve-openrouter test`, `pnpm exec vp test run scripts/clickup-sync.test.ts`, and `pnpm build`. It does not run the separate coverage job; use `pnpm coverage` for that. The experiment tests use fake keys and mocked HTTP, never a paid model. It does not install dependencies. Run the root and experiment frozen installs described above first. Use `git push --no-verify` only for an intentional bypass.

### Dependency consumers

Dependencies have concrete consumers:

- `react` and `react-dom` render the page through `src/main.tsx` and the named `App` component.
- `@vitejs/plugin-react` supplies React development transforms and refresh support.
- `vite-plus` supplies dev, static checks, tests and production builds. The direct `vite` alias provides the matching plugin and client types.
- `typescript` and `@types/node`, `@types/react`, `@types/react-dom` provide compiler/editor tooling and types for the code and config.
- `zod` validates the briefing fixture examples in `src/fixtures/parse-fixtures.ts`, the runtime boundary for fixture data.

### Test runner boundary

Test settings live in `vite.config.ts`: Node environment, `src/**/*.test.ts` and `scripts/**/*.test.ts`, and `passWithNoTests: false`. DOM component tests would need a matching file include and browser-like environment; neither is configured yet. Import test APIs from `vite-plus/test`. Do not add a second Vitest installation or a separate `vitest.config.ts` by habit.

The fixture parser tests in `src/fixtures/parse-fixtures.test.ts` ([#22](https://github.com/atlas-depot/atlas/issues/22)) read the synthetic examples in `fixtures/briefing/` from disk. Each invalid case must produce exactly one issue at its expected field path. A run that finds no test files is not passing evidence, so keep `passWithNoTests` disabled. A disposable runner self-check verifies harness execution only and does not provide application behavior coverage.

### Coverage

`pnpm coverage` runs the full Vitest suite with V8 coverage. Coverage includes `src/**/*.{ts,tsx}` and `scripts/**/*.ts`; it excludes test and spec files, `e2e/`, `experiments/`, config files, declarations and generated output. The `text` reporter prints file-level coverage to the job log, and `text-summary` writes line, statement, function and branch totals to `coverage/summary.txt`. The `coverage` CI job appends those totals to the Actions run summary with the tested revision; it uploads no artifact and keeps no baseline. The job fails when tests fail or the summary is missing or empty.

The coverage job is separate from the required `verify` check. It runs on pull requests and pushes to `main`, and reviewers inspect its summary and logs before merging. Percentages are informational: there is no percentage threshold, and executed lines do not prove useful assertions. Line coverage counts executed lines; branch coverage counts decision outcomes. `coverage/` is ignored. When the coverage job is introduced or changes materially, record its actual step duration in the pull request.

Before review, verify the clean install, static checks, production build and accessible Atlas heading in a real browser at mobile and desktop widths. Keep browser evidence separate from runner setup evidence.

### Browser regression

`pnpm test:e2e` runs Playwright Test (declared in `playwright.config.ts`) against the production bundle, which the config builds and serves on `127.0.0.1:4177` before the first test. `pnpm exec playwright install chromium` installs the browser once per machine. Specs live in `e2e/`, so the Vitest include patterns stay unchanged. The `browser regression` CI job is separate from the required `verify` check, and a failure keeps a trace under `test-results/` that CI uploads.

### Scaffold provenance

The initial config came from `create-vite-plus@1.3.0` with `create-vite@9.2.1 --template react-ts`, generated in a separate scratch directory with agent/editor/git/hook setup disabled. Only application/config files were transferred. Existing README, ignore rules and repository instructions were preserved and updated deliberately. Direct dependencies were pinned, strict mode was made explicit and template branding was replaced. The minimal page uses system fonts and semantic HTML. Product typography, component libraries and motion remain future design choices.

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

`.github/workflows/ci.yml` runs on pull requests and pushes to `main`. Its `format`, `lint and typecheck`, `coverage` and `build` jobs run `vp fmt --check`, `vp lint`, `vp test run --coverage` and `vp build` after `vp install --frozen-lockfile`. `vp lint` also type-checks because `typeCheck` is enabled in `vite.config.ts`. The required check name is `verify`, which passes only when `format`, `lint and typecheck` and `build` succeed. The `coverage` job runs the full Vitest suite with coverage as a separate check; reviewers inspect its summary and logs, but it is not part of `verify` and is not a required merge check. CI reads the Node version from `.node-version`, so local and CI runtimes stay aligned. Efe configures required checks after reviewing a real run. Add relevant deterministic eve evals when agent code exists. Paid live-model evals should be separately limited.

The agreed flow is feature branch preview and `main` production. Efe or configured Vercel automation handles deployment. Configure Vercel Git integration for branch-triggered deployments or a Vercel CLI/API path for CI; branches and CI do not configure deployments by themselves: project linkage, team access, credentials, and environment separation require separate configuration and verification. See [contributing](contributing.md).

After an authorized deployment, verify the deployed revision and affected live flow. A successful build is not a live smoke test, and application rollback does not imply database rollback.

## Budget checks

Track model, sandbox, workflow, storage, and connector costs together. Credits are finite and service-specific. Set execution time and resource limits, stop idle sandbox compute, and record actual spend during the first integration test. Do not claim that a model-token limit caps the whole product bill.

References: [Vercel Git integration](https://vercel.com/docs/git), [Vercel env CLI](https://vercel.com/docs/cli/env), [Vite environment variables](https://vite.dev/guide/env-and-mode).
