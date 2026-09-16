---
name: atlas-test
description: Verify an Atlas change and collect focused UI, backend, or agent-behavior evidence.
---

# Atlas Test

Read `docs/development.md` for the commands that actually exist.
Read `docs/contributing.md` for evidence expected in a PR.
There is no application scaffold yet: do not claim application tests or invent executable scripts.

## Select checks

- Code: run the affected tests and available type/lint checks.
- UI: use agent-browser when available to exercise the changed flow at desktop and mobile widths.
- Backend: verify the affected request, persisted result, or workflow transition.
- Agent behavior: run relevant eve eval scenarios when configured.
- Schema: verify migration behavior against disposable data before user data.
- Deployment: smoke-test the actual preview URL when a deployment exists.

For bugs, reproduce the failure and show the corrected outcome when practical.
Use the smallest check that proves the behavior, then expand only for unresolved concerns.
Mock tests prove orchestration, not live OAuth or provider delivery.

## Evidence

Capture UI before/after screenshots or a short interaction recording when relevant.
For backend changes, prefer a sanitized request/result, query result, or job-state transition.
Exclude tokens and private content from screenshots, logs, fixtures, and PR attachments.
Record what ran, what passed, and what remains unverified.
Missing browser tooling is a verification gap, not evidence of success.
Keep artifacts small enough for a teammate to review.
