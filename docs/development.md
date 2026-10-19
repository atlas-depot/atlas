# Development setup

Status: setup contract for the scaffold, not runnable installation instructions. There is currently no application manifest or lockfile. Do not report build, test, or deployment success until those paths exist and run.

## Tooling

Use Vite+ as the primary development toolchain. At scaffold time, pin compatible runtime, package-manager, and tooling versions and commit one lockfile. Verify the Vite+ commands for checking, formatting, linting, testing, and building instead of adding overlapping tools by habit. Retain or add mise only for a demonstrated gap.

Target onboarding: clone, obtain authorized development access, install dependencies, start required services, seed synthetic data, and run one documented development command. Publish the actual commands here when implemented.

## Code conventions

Use strict TypeScript without `any`, named exports, and explicit dependencies instead of hidden business globals. Parse untrusted API/tool input with Zod schemas at boundaries. Keep shared contracts small; do not create abstractions without real callers.

For an API change, specify caller identity, inputs, outputs and errors; inspect affected callers. Update generated contracts through their generator when one exists. Use actual persistence constraints and access filters, not an assumed future ORM.

For UI changes, preserve accessible names and keyboard behavior from existing components. Distinguish optimistic state from persisted data and handle the loading, empty and error states affected by the change. UI verification evidence belongs in the PR as described in [contributing](contributing.md).

## Choosing implementation and test boundaries

Start with the accepted input/output contract and inspect its callers. Separate parsing of untrusted input, domain decisions and side effects when that makes failures independently testable; do not create layers or shared packages without a real consumer. Model meaningful states explicitly, including failure and unknown outcomes when applicable. Prefer a cohesive module that hides a decision over many forwarding wrappers. Refactor behavior-preserving structure separately from a behavior change when that makes review clearer.

For a behavior change, name the failure to prevent before choosing a test. Exercise the smallest public boundary that can expose it; use real storage when persistence constraints are the concern, and a browser when user interaction is the concern. Expected results must be independent of the implementation. A mocked connector cannot establish provider behavior, and a valid citation ID cannot establish factual support.

Build and verify one behavior at a time. For a regression, show failure without the fix and success with it where feasible; do not require test-first ceremony for prose or mechanical edits. Prefer accessible user-facing interactions in UI tests over component internals. Coverage identifies unexamined paths, not a target that proves quality. Use `atlas-test` for test-value, mutation or flake decisions.

Methods: [Google review guidance](https://google.github.io/eng-practices/review/reviewer/looking-for.html), [The Practical Test Pyramid](https://martinfowler.com/articles/practical-test-pyramid.html), [Testing Library principles](https://testing-library.com/docs/guiding-principles/). These inform choices; they do not add dependencies or override an accepted Atlas contract.

## Bulk data repair

For a future bulk data repair, establish selection/counts, a dry run, restart behavior and recovery before execution. Verify a small slice and remaining eligible records; queued-job totals alone do not prove completion. This is not authorization to modify stored data.

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

There is no application CI before the scaffold. Add actual Vite+ lint/typecheck/test/build checks and relevant deterministic eve evals with runnable code; the owner reviews the resulting checks before merging. Paid live-model evals should be separately limited.

The agreed flow is feature branch preview and `main` production. Efe or configured Vercel automation handles deployment. Configure Vercel Git integration for branch-triggered deployments or a Vercel CLI/API path for CI; branches and CI do not configure deployments by themselves: project linkage, team access, credentials, and environment separation require separate configuration and verification. See [contributing](contributing.md).

After an authorized deployment, verify the deployed revision and affected live flow. A successful build is not a live smoke test, and application rollback does not imply database rollback.

## Budget checks

Track model, sandbox, workflow, storage, and connector costs together. Credits are finite and service-specific. Set execution time and resource limits, stop idle sandbox compute, and record actual spend during the first integration test. Do not claim that a model-token limit caps the whole product bill.

References: [Vercel Git integration](https://vercel.com/docs/git), [Vercel env CLI](https://vercel.com/docs/cli/env), [Vite environment variables](https://vite.dev/guide/env-and-mode).
