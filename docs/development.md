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

Vite proxies `/api` and `/api/...` to the backend without changing the path. Browser callers use relative URLs such as `fetch('/api/health')`. Health returns `200`; authenticated notes currently return `501` until storage is connected. Health is process liveness, not database or provider readiness. The Node entrypoint runs TypeScript directly, without a separate transpiler.

For WorkOS Bearer authentication, set both `WORKOS_CLIENT_ID` and `WORKOS_ISSUER` to your development environment's values. The issuer must match exactly; do not infer it from the client ID. The SDK verifies signed user access tokens against WorkOS's client-specific JWKS. No API key is needed for verification. Omit both settings to keep private routes denied during scaffold work; partial or malformed configuration prevents startup. Invalid credentials return `401` with a Bearer challenge, while verification-service failures return `500`. Signature verification runs locally against the client JWKS fetched over HTTPS; a JWKS outage is a server failure. Revocation is not detected immediately and takes effect at token expiry.

For browser sign-in, also set `APP_ORIGIN`, `WORKOS_API_KEY` and `WORKOS_COOKIE_PASSWORD` (at least 32 characters). `APP_ORIGIN` is the exact origin opened in the browser, without a trailing slash; local development normally uses `http://localhost:5173`. HTTPS is required except for HTTP on `localhost`, `127.0.0.1` or `[::1]` during local development. Other HTTP origins fail startup. Add `APP_ORIGIN` plus `/api/auth/callback` to the redirect list for the matching WorkOS environment. Use separate WorkOS environments, redirect URIs and cookie passwords for local, staging and production. The API key and cookie password stay server-side and must never enter a `VITE_*` value, browser bundle, log or screenshot.

Use the **environment** client ID returned by `npx workos@latest whoami --json` (`environment.clientId`) as `WORKOS_CLIENT_ID`. The client ID shown under Applications is an application-level ID and can differ; in a live staging check the application ID produced `invalid_client` at the hosted AuthKit page. For the default hosted AuthKit domain, `WORKOS_ISSUER` is `https://api.workos.com/user_management/`, not the `*.authkit.app` OAuth issuer. Verify it against the access token `iss` claim when the environment or auth domain changes.

The public browser routes are `GET /api/auth/login`, `GET /api/auth/callback`, `GET /api/auth/session` and `POST /api/auth/logout`. Login uses hosted AuthKit with PKCE and a short-lived sealed transaction cookie. The callback validates state and expiry, exchanges the code, and stores only the WorkOS sealed session in the `atlas_session` cookie (`HttpOnly`, `SameSite=Lax`, `Secure` on HTTPS). The session route returns `{ user: { id, email, firstName, lastName } }`; names remain `null` when WorkOS has none. Logout clears the local cookie and redirects through WorkOS's session logout flow when the session can be authenticated. If the session is invalid or WorkOS is unreachable, logout still clears the local cookie and redirects to `APP_ORIGIN`. Expired browser sessions refresh once; terminal failures clear the cookie and return `401`, while retryable provider failures return `500` and preserve it.

Cookie-authenticated unsafe requests, including logout, require an exact `Origin` match with `APP_ORIGIN`; a missing or mismatched origin returns `403`. Bearer requests are exempt because they do not use ambient cookie identity, and an `Authorization` header never falls back to the cookie. Do not add credentialed cross-origin CORS for this same-origin application.

Deterministic tests use a synthetic provider and never call WorkOS. A separate live development-provider smoke must record Google and email/password sign-in, signup/email verification as configured, cancelled login, the provider recovery path, session refresh, logout and account switching. Do not record keys, cookies or passwords. All five teammates accepted their WorkOS dashboard accounts in Staging on 2026-10-29; no paid seat requirement appeared.

For concurrent worktrees, set different `API_PORT` values and frontend ports, for example `pnpm dev --host 127.0.0.1 --port 5177 --strictPort`. Stop both processes with Ctrl-C. Production routing is separate configuration.

## Note schema and migrations

The Drizzle PostgreSQL schema lives in `server/db/schema.ts`. Generate a migration after changing it with `pnpm db:generate --name=describe-change`. Generation needs no database credentials and does not apply SQL. Commit the generated SQL, snapshot and journal under `drizzle/` together with the schema. Review the SQL before applying it; never rewrite an applied migration.

Notes store a verified WorkOS owner ID, Markdown source, timestamps and a positive internal revision counter. Public field limits remain in `shared/notes.ts`; PostgreSQL text lengths do not measure UTF-16 code units. The schema alone does not enforce per-user access or atomic revision updates; those must be implemented in the data-access operations. Seeds, CI replay and API storage wiring are not connected yet.

Set server-only `DATABASE_URL` in your ignored `.env` to your isolated development PostgreSQL database, then run `pnpm db:migrate`. This applies pending committed migrations and closes its connection pool on success or failure. Re-running it leaves already recorded migrations alone; it does not reset data. Migration failures exit nonzero without printing driver errors or connection details. The API still starts without a database setting because storage is not wired into its routes yet.

The `pg` driver connects through Drizzle using a pool of at most five connections and a ten-second connection timeout. TLS settings come from the connection URL; use the provider's verified TLS configuration for Neon. The same driver can use an isolated local PostgreSQL database for credential-free verification. The connection owner must call `close()` when finished. Run migrations from one designated runner for shared staging; no automatic startup migration or concurrent-runner coordination is implemented.

`server/db/notes.ts` provides Hono-independent note operations. Pass the verified server user ID separately from the note payload. Reads and writes always scope by owner; inaccessible and missing notes have the same result. Update/delete lock the owned row inside a transaction before checking the expected revision. Updates replace title/content, set the database server's edit timestamp and increment the internal revision. The returned public note excludes ownership/revision fields; single-note operations carry revision separately for future ETag mapping. Database errors propagate to the caller, which must sanitize them at its public boundary. These operations are not mounted on HTTP routes yet.

Run real-storage tests separately from the credential-free root suite:

```sh
TEST_DATABASE_URL=postgresql://USER@127.0.0.1:55468/postgres pnpm test:db
```

Use an isolated local PostgreSQL server and a test role with database creation permission. The suite requires a loopback host, creates a randomly named database, replays committed migrations and drops only that generated database after closing its pools. It never reads `DATABASE_URL` or root `.env`. Tests cover persistence through another connection, owner isolation, stale writes/deletes, concurrent writes, validation, missing notes and storage failure. Identity is synthetic; these tests do not verify WorkOS or Neon access. CI wiring remains pending.

Drizzle Kit uses esbuild's packaged platform executable. `allowBuilds.esbuild: false` disables its dependency install scripts; migration generation must continue to work after a frozen install.

## Tests and coverage

Import test APIs from `vite-plus/test`. The existing runner discovers tests under `src/`, `scripts/`, `server/` and `shared/`, with `passWithNoTests: false`. Do not add another Vitest installation. A no-tests run is not passing evidence.

Coverage includes those source directories and excludes tests, declarations, configuration, generated output, `e2e/` and `experiments/`. It prints file-level coverage and writes totals to `coverage/summary.txt`. Percentages are informational, with no threshold; assert behavior rather than aiming only to execute lines.

Test session injection does not prove WorkOS sign-in or database isolation. Keep mocked provider checks separate from live verification, and run paid model tests only with an explicit budget. See [atlas-test](../.agents/skills/atlas-test/SKILL.md) for boundary selection and regression checks.

### Live development-provider smoke

Run against the WorkOS Staging environment with the environment client ID on 2026-10-28:

- Google sign-in and email/password signup with email verification both completed; each callback set `atlas_session` and `/api/auth/session` returned the matching profile without tokens.
- `document.cookie` did not expose `atlas_session`, confirming the `HttpOnly` boundary in the browser.
- Logout followed the WorkOS logout flow, returned to the application origin, and `/api/auth/session` then returned `401`.
- After the five-minute access token expired, a session request returned `200` with a new `Set-Cookie`, exercising refresh and resealing.
- Account switching replaced the Google session with the email/password session.
- All five teammates accepted the WorkOS dashboard invite and show as active in Staging; no paid seat requirement appeared.
- A wrong password was rejected on the hosted AuthKit page with an invalid-credentials message; no session was created.
- A valid `error=access_denied` callback returned `401` and cleared the transaction. A wrong-state callback returned `403` without clearing it, and the following valid cancellation was processed.
- The hosted reset-password flow accepted the request and the reset email arrived; the link was not used to change the password.
- CSRF rejection and Bearer-versus-cookie precedence remain covered by deterministic tests because a browser cannot set the `Origin` header or a forged Bearer token for a live check.

The live check used the Staging environment, which allows `http://localhost` redirects. Production is a separate environment, requires billing activation and HTTPS redirects, and must use its own client ID, API key and cookie password. Do not copy Staging credentials into Production or vice versa.

Staging configuration recorded on 2026-10-28:

- Redirect URI: `http://localhost:5173/api/auth/callback`
- Initiate login URI: `http://localhost:5173/api/auth/login`
- Sign-out URI: `http://localhost:5173/`
- Methods: Google with WorkOS demo credentials and Email + Password. Passkeys, Magic Auth and Enterprise SSO are disabled.
- Sessions: five-minute access tokens, two-day inactivity timeout, 365-day maximum session length. CORS remains empty because WorkOS is called server-side.
- The environment client ID is in the local `.env` only; the repository contains placeholders.

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
