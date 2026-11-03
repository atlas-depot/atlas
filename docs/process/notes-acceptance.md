# Notes increment acceptance record

Status: preparation evidence. Final acceptance still depends on #53 and a staging environment.

This record covers the integrated notes increment on `main`. It is point-in-time evidence, not a deployment claim. Update it after #53 lands and again after the WorkOS staging matrix runs.

## Candidate and environment

- Tested revision: `95e6bc0` (merge of #61 on `main`).
- Toolchain: Node `24.22.0`, pnpm `11.23.0`.
- Host: macOS 27.0.1 arm64.
- Database: local PostgreSQL 17.11 on loopback.
- No `.env`, no provider keys and no paid calls were used for routine verification.

## Clean setup

A fresh worktree at `95e6bc0` was used for setup checks.

| Check | Result |
| --- | --- |
| Root frozen install | Passed |
| `experiments/eve-openrouter` frozen install | Passed |
| `pnpm check` | 142 files formatted; 104 files with no lint or type errors |
| `pnpm test` | 18 files, 339 tests passed |
| `pnpm build` | `dist/index.html` plus hashed CSS and JS assets |

A disposable database verified the documented data setup:

- `pnpm db:init` applied committed migrations and inserted two synthetic notes.
- `pnpm db:seed` inserted zero additional notes.
- `pnpm db:migrate` replayed without changing the two notes.

The production bundle contained no synthetic example notes, `notesExample` switch or server-only environment names. It did keep the expected Vite warning for a JavaScript chunk above 500 kB.

## Regression suites

| Suite | Result |
| --- | --- |
| `pnpm test` | 339 tests passed |
| `pnpm test:db` | 84 tests passed |
| `pnpm test:e2e` | 52 tests passed |
| `pnpm test:e2e:db` | 4 tests passed |
| ClickUp sync | 18 tests passed |
| Organizer unit | 56 tests passed |
| Isolated experiment | 16 tests passed |

The database and real API suites used loopback PostgreSQL. The browser suites used synthetic identity; they did not call WorkOS or a live model.

## Demo walkthrough

The development preview was run with `pnpm dev`. Ten local acceptance cases covered:

- Create, edit, explicit save with Cmd/Ctrl+S, delete confirmation, cancel and confirmed delete.
- Keyboard-only navigation to `New note`, typing, save and Escape to cancel deletion.
- Failed save with the draft preserved and a successful retry.
- A 412 revision conflict with the local draft preserved, comparison and explicit adoption.
- Load and read failures with retry.
- Slow save progress.
- Unavailable, expired-session and blocked-write states with separate recovery.
- Missing note on read and on save, including `Keep as new note`.
- Delete failure and delete conflict recovery.
- Empty and unauthenticated states.

Safe Markdown was checked with `<script>`, a remote `<img>` and a `javascript:` link. The preview created no script node, no image request and no unsafe href.

Layout and input measurements:

| Viewport | Horizontal overflow | Minimum button height | Input font size | Sidebar beside editor |
| --- | --- | --- | --- | --- |
| 1440 | 0 | 44px | 16px | Yes |
| 1280 | 0 | 44px | 16px | Yes |
| 1024 | 0 | 44px | 16px | Yes |
| 768 | 0 | 44px | 16px | No |
| 375 | 0 | 44px | 16px | No |
| 320 | 0 | 44px | 16px | No |

The editor was ready in about 1.0 seconds on the local development server.

A single-evaluator heuristic review scored the demo 4.7/5: task completion 5, error recovery 5, mobile 4.5, keyboard 4.5, first-run clarity 4 and safety 5. This is not user research.

One clarity observation: opening an existing note immediately shows "Saved for this preview session". It reads like a save event rather than a persistent preview-only banner. This is not blocking.

## Real API, PostgreSQL and Organize

The real API browser suite verified:

- Mobile keyboard create, reload, edit and delete.
- A real 412 competing edit with the local draft preserved.
- A lost committed POST replayed under the same idempotency key, followed by newer edits.
- Account switching that cannot read or write the previous account's note.

Organize HTTP and persistence passed ten deterministic integration cases plus the route suite. They cover a separate Markdown draft, sources with source revision and staleness, no source overwrite, authentication and origin boundaries, reconnect and cleanup. The organizer runtime was mocked, so this is deterministic provider evidence only.

The real Node API entrypoint also returned `200` for health and `401` with a Bearer challenge for notes and Organize routes when no credentials were configured.

## Known limits

- #53 is open and the browser has no Organize control or editable draft. The backend draft contract is verified; the editable draft UI, explicit derivative save across reload and source preservation in the UI are not.
- No WorkOS `.env` values and no staging deployment or URL exist yet. Google and email/password sign-in, expired-session behavior and the staging acceptance matrix are blocked.
- No live model call was made. AI draft evidence is limited to deterministic tests with a mocked provider.
- No performance, capacity or provider claim is made beyond the local observations above.

## Reproduction

```sh
pnpm install --frozen-lockfile
pnpm --dir experiments/eve-openrouter install --frozen-lockfile
pnpm check
pnpm test
pnpm build
pnpm dev
```

Open `http://localhost:5173`. Create and edit a note, save with Cmd/Ctrl+S, then delete it. Development states are available at `?notesExample=save-failure`, `?notesExample=conflict`, `?notesExample=empty` and `?notesExample=unauthenticated`.

```sh
TEST_DATABASE_URL=postgresql://USER@127.0.0.1:55468/postgres pnpm test:db
TEST_DATABASE_URL=postgresql://USER@127.0.0.1:55468/postgres pnpm test:e2e:db
pnpm test:e2e
```

See [development](../development.md) for the full setup, environment and test contract. See #54 for the current status and follow-up acceptance work.
