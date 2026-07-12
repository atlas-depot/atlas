# Definition of Done

A task is done when all items below are true.

## Product

- Acceptance criteria are met.
- Edge cases are handled.
- Empty, loading, error, and permission states are considered.

## Engineering

- Code is typed.
- Inputs are validated.
- Tests exist for core behavior.
- CI passes.
- Engineering standards in `docs/process/engineering-standards.md` are followed.
- No em dash character is introduced.
- No unrelated changes are included.
- No new dependency is added without justification.
- Generated files and `CHANGELOG.md` are not manually edited.
- Backend/API/worker/DB behavior changes include reproducible evidence snapshots when practical.
- New provider/env requirements update `.env.example`, `docs/process/provider-and-env-setup.md`, and `mise run doctor`/`env:check` behavior.
- User-visible bug fixes include an end-user-aligned reproduction when practical.
- Lint, type, test, and flaky-test failures are fixed or explicitly tracked with evidence.

## AI

- AI behavior is grounded in sources where required.
- Structured outputs are schema-validated.
- Failure mode is safe.
- Eval or smoke test is added for non-trivial AI behavior.

## Privacy

- Permission checks are server-side.
- Private/shared leakage is tested when relevant.
- Logs do not expose secrets or sensitive content.
- Secrets are not added to env files, fixtures, screenshots, PR bodies, or CI logs.

## Senior project

- The author can explain what changed, why, and how.
- PR contains a learning summary.
- Screenshots or demo notes are attached for UI changes.
- UI/frontend changes use `agent-browser` screenshots/snapshots when available; if it is missing, install it or document why the task is blocked.
- Rendered UI is inspected for clear visual defects when the task touches user-visible surfaces.
- Backend changes include request/response, DB/query, audit/event, workflow/job, log/trace, or schema evidence when behavior changes.
