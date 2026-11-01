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

Notes store a verified WorkOS owner ID, Markdown source, timestamps and a positive internal revision counter. Public field limits remain in `shared/notes.ts`; PostgreSQL text lengths do not measure UTF-16 code units. Owner/revision enforcement lives in the note operations, not the schema alone. API storage wiring is not connected yet.

Set server-only `DATABASE_URL` in your ignored `.env` to your isolated development PostgreSQL database, then run `pnpm db:migrate`. This applies pending committed migrations and closes its connection pool on success or failure. Re-running it leaves already recorded migrations alone; it does not reset data. Migration failures exit nonzero without printing driver errors or connection details. The API still starts without a database setting because storage is not wired into its routes yet.

The `pg` driver connects through Drizzle using a pool of at most five connections and a ten-second connection timeout. Use a pooled Neon URL for application traffic and a direct URL with `sslmode=verify-full` for migration commands, supplied through the same `DATABASE_URL` setting. The same driver can use an isolated local PostgreSQL database for credential-free verification. The connection owner must call `close()` when finished. Efe's account is the designated staging migration operator, including an agent acting through that account. Only that operator applies reviewed migrations to staging, one run at a time. This is an operating responsibility, not a restriction on other organization admins; no automatic startup migration or concurrent-runner coordination is implemented.

For synthetic development data, set `DATABASE_URL` in your ignored `.env` to your own isolated local database or Neon development branch, then run:

```sh
NODE_ENV=development pnpm db:init
# Later, add missing sample rows without applying migrations:
NODE_ENV=development pnpm db:seed
```

`db:init` applies the committed migrations and then inserts two sample notes belonging to the fictional owners `synthetic-seed-alex` and `synthetic-seed-sam`. It initializes an existing empty database; it does not create a PostgreSQL database or Neon branch. These owners are not real WorkOS accounts, so their notes do not automatically appear after browser sign-in. Fixtures use fixed UUIDs and UTC timestamps. Reruns skip an existing fixture UUID without changing its content, owner, timestamps or revision, and leave unrelated notes alone. Both samples are inserted in one SQL statement; neither command truncates, resets or deletes data. If seeding fails after migrations succeed, the migrations remain applied and setup can be retried.

Setup uses the same `DATABASE_URL` as note operations and migrations. Both commands require an explicit `NODE_ENV=development`; missing, test, staging and production modes are rejected before opening a database connection. The examples use POSIX shell syntax; in PowerShell, set `$env:NODE_ENV = "development"` for the command and remove it afterward. This opt-in does not prove a remote URL points to development: select your development branch explicitly and never configure staging/production as the setup target. Use `db:migrate` alone from the designated runner for staging. Setup closes its pool and exits nonzero with a sanitized message on failure.

`server/db/notes.ts` provides Hono-independent note operations. Pass the verified server user ID separately from the note payload. Reads and writes always scope by owner; inaccessible and missing notes have the same result. Update/delete lock the owned row inside a transaction before checking the expected revision. Updates replace title/content, set the database server's edit timestamp and increment the internal revision. The returned public note excludes ownership/revision fields; single-note operations carry revision separately for future ETag mapping. Database errors propagate to the caller, which must sanitize them at its public boundary. These operations are not mounted on HTTP routes yet.

Run real-storage tests separately from the credential-free root suite:

```sh
TEST_DATABASE_URL=postgresql://USER@127.0.0.1:55468/postgres pnpm test:db
```

Use an isolated local PostgreSQL server and a test role with database creation permission. The suite requires a loopback host, creates a randomly named database and a second database with the `_setup` suffix, replays committed migrations and drops only those generated databases after closing their pools. Connection URLs require an explicit host and database path; query parameters that override host, hostaddr, port, database or dbname are rejected before connecting. The suite never reads the developer's root `DATABASE_URL` or `.env`; it passes the generated disposable database URL as `DATABASE_URL` to setup subprocesses. Tests cover persistence across connections and application processes, owner isolation, stale writes/deletes, concurrent writes, validation, missing notes, storage failure and repeatable setup/seed. Identity is synthetic; these tests do not verify WorkOS or Neon access. Database tests have a 90-second test timeout for the sequential setup subprocesses and 30-second hook timeouts.

Drizzle Kit uses esbuild's packaged platform executable. `allowBuilds.esbuild: false` disables its dependency install scripts; migration generation must continue to work after a frozen install.

### Live Neon development verification

On 2026-11-01, code at `4181a9b` was verified on `atlas-dev` / `dev-efe`, Neon PostgreSQL 18 in AWS Frankfurt, using Node 24.22.0. The direct connection used verified TLS. With `NODE_ENV=development`, the actual setup command applied the committed migration and inserted two synthetic notes; a second run inserted zero. Pooled CRUD verified owner isolation, concurrent updates with one winner, stale update/delete rejection, and committed creation/edit recovery in fresh Node processes after the writers exited. Only the generated smoke note was deleted; the two synthetic seed notes remain. Staging was not modified. This verifies storage and process restart, not WorkOS, HTTP/UI integration or a Neon compute restart.

The Atlas organization is on Free. Its five development branches (`dev-efe`, `dev-talha`, `dev-onat`, `dev-iklim`, `dev-ali`) have distinct endpoints separate from `staging`; all six computes are fixed at 0.25 CU. The [current Free allowance](https://neon.com/blog/neon-free-plan-1-gb-per-project) is 10 branches, 100 CU-hours per project/month and 1 GB storage per project. The compute allowance is shared across this project's branches. Four active project members were verified; Ali's invitation is still pending, so #46's five-member access condition remains open. Current members are organization admins: branch data is separate, but per-branch console access isolation is not enforced.

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

Install Chromium once with `pnpm exec playwright install chromium`. Playwright builds both the demo and normal production frontend. The demo is served on `127.0.0.1:4177`; the production build is stored under `.cache/production-build` and served on `127.0.0.1:4178`. Neither reuses an existing server. Occupied ports fail the run. CI retains before/after screenshots and failure traces. For visible UI changes, also verify mobile width, desktop and keyboard behavior.

### Notes editor development preview

The notes workspace composes shadcn components built on Base UI, generated with the official shadcn 4.23.0 CLI using the Base Nova preset. `components.json` records the source configuration; `src/components/ui/` contains generated components. Tailwind integrates through the existing Vite+ configuration. System fonts and the preset's neutral styles are used; no custom primitives or icons are authored. Radix Themes is removed. The Markdown preview keeps pinned react-markdown 10.1.0 and remark-gfm 4.0.1, following the [renderer security guidance](https://github.com/remarkjs/react-markdown#security) and [GFM plugin guidance](https://github.com/remarkjs/remark-gfm). Raw HTML is skipped, safe URL defaults remain enabled, and images are omitted to prevent unsolicited remote image requests.

Run `pnpm dev` for synthetic HTTP responses stored only in tab memory. Saves are explicit (Save or Ctrl/Cmd+S); reload resets the examples. The screen labels this limitation. `?notesExample=empty`, `load-failure`, `read-failure`, `save-failure`, `slow-save`, `conflict`, `unavailable`, `unauthenticated`, `expired-save`, `forbidden-save`, `missing-read`, `missing-save`, `delete-failure` and `delete-conflict` provide development/test states. The older source-link example remains at `?example=briefing` only to preserve its existing regression while replacing the main product surface.

A normal production build excludes the fixtures and uses the same editor with the same-origin HTTP client. `NotesStore` in `src/notes/notes-store.ts` matches #45/#56: `list()`, `read(id)`, `create(CreateNote)`, `update(id, UpdateNote, etag)` and `delete(id, etag)`. Opening always reads the individual-note endpoint; list content is never treated as an editable snapshot. The client validates JSON with shared Zod schemas, retains the exact response ETag on read/create/update and sends it as If-Match on PUT and DELETE. New notes have no invented client-side server ID. Delete requires an explicit confirmation naming the note; a dirty draft adds a warning that local changes will also be discarded. A successful 204 removes only that list entry and selects the next note, the previous note, or the last-note empty state. A 404 removes the stale entry but keeps the draft, with Refresh and Keep as new note as the available recovery. A 412 keeps the note, preserves the draft, disables deletion, and requires Compare latest and adoption before a new confirmation. An unconfirmed delete keeps the draft, does not claim the note still exists, and disables deletion and saving until list reconciliation succeeds. A refresh that omits the saved note switches to the missing-note recovery while keeping the draft. The production shell checks `GET /api/auth/session` before mounting the editor, shows the sign-in route on 401, and revalidates when the window regains focus. A changed user ID or a terminal session 401 detected by the shell replaces the workspace, so private cached notes, pending reads and any unsaved draft from the previous account are discarded. User-initiated sign out posts to `/api/auth/logout` as a full navigation and keeps the existing dirty beforeunload guard; the demo shell remains independent of authentication. #52 still needs the real server CRUD/delete routes from #51 and the final API smoke; this slice does not close the issue. Create retries are not idempotent under the current #45/#56 contract. A lost POST response can mean the note was created even though the client reports failure. Before #52 connects persistence, the team must agree on a server-backed idempotency key/reconciliation contract, including key lifetime and replay semantics; the client must not invent an unsupported header or claim exactly-once creation. No automatic write retries are performed. An unconfirmed create offers a list refresh that preserves input and warns that the note may already exist before a manual retry.

Pending #52 proposal, not an implemented or accepted API change: prefer a creation key scoped to the authenticated account and reused for retries of the same submitted snapshot. The server would atomically store the key, payload fingerprint and resulting note identity; matching replays would return that note, while a changed payload under the same key would be rejected. Key lifetime and the replay status/ETag still require team agreement. Manual list reconciliation is an alternative, but matching titles/content cannot prove identity and cannot prevent duplicates after an uncertain outcome. The smallest integration experiment is to commit a create, drop its response, retry with the same key and verify one stored note and the same ID, plus reject mismatched payload and cross-account replay. The current client test simulates a committed create with a lost response and proves that no automatic POST retry occurs; it does not prove server idempotency.

Server ownership enforcement remains mandatory; production notes endpoints still return 501 until persistence is implemented.

Requests time out after 30 seconds, abort the transport and ignore late responses, including stalled response bodies. Failures preserve local text. A 412 conflict leaves the original ETag intact and blocks blind save or delete resubmission. Retrying a failed note selection uses the same unsaved-change confirmation as the sidebar; a comparison retry remains read-only and never replaces the draft. Editing after a read failure also shows the unsaved status without hiding the retry action. Compare latest reads the current server version without replacing edits; adopting it requires explicit discard confirmation. Successful saves advance the server ID/ETag while newer edits typed during the request remain unsaved.

The editor distinguishes 401, 403, 404, 412, 501 and transport/server failures. A 501 is a neutral unavailable state without a retry loop. A 401 clears the list, saved identity and comparison, blocks writes and offers the existing sign-in route; current unsaved text stays visible for copying before full-page sign-in navigation. A 401 from a list refresh also takes priority over a stale read failure, so writes stay blocked and the sign-in link remains available. A 404 removes the missing list entry and offers a list refresh that preserves local text. When the missing identity belongs to the current draft, Keep as new note explicitly removes its server identity before a separate Save. A failed read of another note leaves the current draft unchanged and allows another selection. The accepted API uses 404 for absent or inaccessible notes and 403 for rejected request-origin checks. The UI does not interpret a 403 as proof of note ownership: it describes a blocked request. A failed read leaves navigation and the current draft available; a forbidden write blocks further writes until request access is restored and the page is reloaded. The write block survives note selection and local New note transitions, while reads and navigation remain available with dirty-input confirmation. A forbidden list has its own loading-access message. The production session shell replaces the whole workspace when the verified user ID changes, and a missing browser session never requests notes. These client states do not replace backend ownership checks.

Untouched empty notes do not warn when discarded, while explicit Save can still create an empty draft. During a save the status distinguishes the submitted snapshot from newer unsaved edits. Delete confirmation warns when the same action would discard local changes. Pure state tests cover these rules and failure classification. Browser cases cover recovery and the real production bundle with session and notes HTTP intercepted by Playwright, not a live database or provider. They also cover conditional delete, 401/412 and missing or unconfirmed delete recovery, list reconciliation of a committed but unconfirmed delete, sign-out at mobile width with the dirty guard, account replacement with a pending previous-account read, and the last-note empty state with focus returned to New note. Production asset checks guard against shipping synthetic note data.

Primary controls and discard-dialog actions have at least 44px touch targets. Input text stays at 16px or larger, the sidebar starts at 1024px, and edit/preview panes split from 1200px. Narrow screens use a shorter source pane. Responsive checks cover 1440, 1280, 1024, 768, 767, 375 and 320px; preview headings remain below the app heading's type scale.

Playwright explicitly enables `VITE_NOTES_DEMO=true` for its own build. The fixtures implement POST creation, individual GET with ETag, conditional PUT and DELETE with 412/428/400 errors, and 204 deletion using the same validating client as production. Tests cover list/open recovery, create versus update, successive ETags, conflicts/comparison, delete confirmation and selection, literal Markdown, safe rendering, explicit saves, save failure/retry, edits during save, dirty navigation, beforeunload, desktop and a 375px mobile viewport. The production project intercepts both `/api/auth/session` and notes HTTP; it covers the signed-out gate, mobile sign-out with the dirty beforeunload guard, account replacement with a pending previous-account read, conditional DELETE, 401/stale/missing/unconfirmed deletes, list reconciliation after an unconfirmed delete, and the last-note empty state. CI uploads `playwright-evidence` with before/after screenshots and failure traces from `test-results/`. This is simulated HTTP/storage and synthetic session data, not live API, database or provider evidence.

If the managed Chromium download is unavailable, set `PLAYWRIGHT_CHANNEL=msedge` or `chrome` to test an already-installed browser, then run `pnpm test:e2e`. Leave the variable unset for the default Playwright Chromium and CI. The browser channel is a local verification choice, not a change to the supported product browsers.


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

CI runs on pull requests and pushes to `main`. Required `verify` aggregates format, lint/typecheck, build and database regression. The database job provisions an ephemeral PostgreSQL 17 service, waits for readiness and runs `test:db` through a dynamically assigned loopback port. Tests create clean databases and replay versioned migrations before exercising note operations and setup/seed. The service uses synthetic CI-only credentials; no Neon, staging or production secrets are supplied. Its ten-minute timeout bounds the job, and GitHub disposes of the service after the job. This workflow configuration requires a real Actions run before reporting remote success.

Coverage runs the full root suite separately and publishes its summary; browser regression is also separate. Neither belongs to the `verify` aggregate. The lint job installs the isolated experiment and runs its mocked budget-guard tests without credentials. CI uses `.node-version`.

Feature previews and `main` production remain the deployment direction. Git branches and passing CI do not configure Vercel linkage, routing or credentials. After an authorized deployment, verify the revision and affected live flow. Application rollback does not roll back the database. Follow [contributing](contributing.md) for PR evidence and merge authority.

References: [Vite+ local CLI](https://viteplus.dev/guide/local-cli), [Vite environment variables](https://vite.dev/guide/env-and-mode), [Vercel Git integration](https://vercel.com/docs/git), [Vercel env CLI](https://vercel.com/docs/cli/env).
