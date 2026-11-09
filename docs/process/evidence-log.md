# Evidence log

Dated verification records moved out of [development](../development.md). Each entry describes what was checked on that date, not the current state of the code or the hosted services. Record new run results in the issue or implementing PR, as [contributing](../contributing.md) describes.

## 2026-10-28: WorkOS Staging smoke

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

Recorded on 2026-10-29: all five teammates accepted their WorkOS dashboard accounts in Staging; no paid seat requirement appeared.

## 2026-11-01: Neon development verification

On 2026-11-01, code at `4181a9b` was verified on `atlas-dev` / `dev-efe`, Neon PostgreSQL 18 in AWS Frankfurt, using Node 24.22.0. The direct connection used verified TLS. With `NODE_ENV=development`, the actual setup command applied the committed migration and inserted two synthetic notes; a second run inserted zero. Pooled CRUD verified owner isolation, concurrent updates with one winner, stale update/delete rejection, and committed creation/edit recovery in fresh Node processes after the writers exited. Only the generated smoke note was deleted; the two synthetic seed notes remain. Staging was not modified. This verifies storage and process restart, not WorkOS, HTTP/UI integration or a Neon compute restart.

The Atlas organization is on Free. Its five development branches (`dev-efe`, `dev-talha`, `dev-onat`, `dev-iklim`, `dev-ali`) have distinct endpoints separate from `staging`; all six computes are fixed at 0.25 CU. The [current Free allowance](https://neon.com/blog/neon-free-plan-1-gb-per-project) is 10 branches, 100 CU-hours per project/month and 1 GB storage per project. The compute allowance is shared across this project's branches. Four active project members were verified; Ali's invitation is still pending, so #46's five-member access condition remains open. Current members are organization admins: branch data is separate, but per-branch console access isolation is not enforced.

## 2026-11-05: Notes increment acceptance (#54)

[#54](https://github.com/atlas-depot/atlas/issues/54) tracks acceptance of the connected notes and AI-draft flow. [Ali's preparation evidence](https://github.com/atlas-depot/atlas/issues/54#issuecomment-6597588207) covers `95e6bc0`; it is historical local evidence, not acceptance of later revisions or a staging deployment. Keep run results, revision, deployment URL and remaining gaps in the issue or implementing PR rather than committing another run log.

Use the pinned clean-setup and check commands in [development](../development.md#tooling). `pnpm test:e2e:db` additionally exercises reconnect, temporary edits, derivative save, source deletion and account-scoped discard through the real browser, Hono and isolated PostgreSQL with synthetic identity/provider seams. It needs a loopback `TEST_DATABASE_URL`, not WorkOS or model credentials. Run browser suites sequentially within a worktree because they build bundles and bind local ports.

Final acceptance needs the integrated #53 candidate and an authorized staging deployment. Verify its deployed revision before exercising this matrix with synthetic notes and two test accounts:

| Boundary | Required observation |
| --- | --- |
| WorkOS | Google and email/password sign-in, cancelled or failed login, recovery, refresh, terminal expiry, logout and account switching behave as documented in [development](../development.md#local-api). Record each method separately. |
| Notes | Create, read, edit, explicit Save and Ctrl/Cmd+S, delete and reload preserve the intended content. Another account cannot read or modify it. |
| Recovery | A failed save keeps local edits. A competing write produces a conflict without overwriting either version. Reloading or discarding local work is explicit. |
| Organize | Save & organize processes the saved revision. Repeated clicks do not duplicate a run. Loading, reconnect, failure/retry and an editable result are observable; the source remains unchanged. |
| Draft lifecycle | Edited temporary content survives reload for the agreed 24-hour lifetime. Discard removes it. Save creates one separate permanent note with its source ID/revision and sources; a repeated Save cannot duplicate it. |
| Source changes | A newer source marks the result stale. A source deleted after result handoff is identified, while Save can preserve the draft separately. Resolve an existing draft before starting another. |
| Rendering and input | Check the integrated editor at desktop and narrow mobile width, keyboard operation, literal HTML/code, safe links and no unintended remote image requests. Confirm structured content and block IDs survive save/reload. |

The draft rows describe the accepted #53 target, not a claim that the current deployment implements it. Exercise expiry using the deterministic clock-controlled tests rather than shortening a shared staging retention setting.

Live AI acceptance is a separate, explicitly authorized run with synthetic input and an agreed cap. Record model/provider, input facts, returned sources, whether the original changed, and content-free usage/cost. A mocked provider cannot establish factual preservation or research quality. Do not put credentials, session cookies or private note content into evidence. Keep #54 open while an integrated or live-provider row is unverified; do not infer a missing provider environment from absent local `.env` files.
