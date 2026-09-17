# Development setup

Status: setup contract for the scaffold, not runnable installation instructions. There is currently no application manifest or lockfile. Do not report build, test, or deployment success until those paths exist and run.

## Tooling

Use Vite+ as the primary development toolchain. At scaffold time, pin compatible runtime, package-manager, and tooling versions and commit one lockfile. Verify the Vite+ commands for checking, formatting, linting, testing, and building instead of adding overlapping tools by habit. Retain or add mise only for a demonstrated gap.

Target onboarding: clone, obtain authorized development access, install dependencies, start required services, seed synthetic data, and run one documented development command. Publish the actual commands here when implemented.

## Code conventions

Use strict TypeScript without `any`, named exports, and explicit dependencies instead of hidden business globals. Parse untrusted API/tool input with runtime schemas at boundaries. Keep shared contracts small; do not create abstractions without real callers.

## Environments

| Environment | Intended use | Data and side effects |
| --- | --- | --- |
| Local | Fast development and deterministic tests | Seed data, mocks by default; personal test accounts when needed |
| PR preview | Review an isolated code change | Test data and credentials; no production access |
| dev staging | Exercise merged features together | Shared test environment with clearly scoped accounts |
| Production | Published main release | Separate real-user data and credentials |

Different preview URLs do not automatically provide isolated databases. Choose preview data isolation once the database is selected. Keep scheduled/proactive actions off in previews by default; enable deliberately for an integration test.

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

There is no application CI before the scaffold. Add actual Vite+ lint/typecheck/test/build checks and relevant deterministic eve evals with runnable code; then make the resulting check required on `dev` and `main`. Paid live-model evals should be separately limited.

The agreed flow is feature branch preview, `dev` staging, and `main` production. Git branches and CI do not create Vercel deployments: project linkage, team access, credentials, and environment separation require separate configuration and verification. See [contributing](contributing.md).

## Budget checks

Track model, sandbox, workflow, storage, and connector costs together. Credits are finite and service-specific. Set execution time and resource limits, stop idle sandbox compute, and record actual spend during the first integration test. Do not claim that a model-token limit caps the whole product bill.

References: [Vercel Git integration](https://vercel.com/docs/git), [Vercel env CLI](https://vercel.com/docs/cli/env), [Vite environment variables](https://vite.dev/guide/env-and-mode).
