---
name: atlas-deploy
description: Check or perform an authorized Atlas preview or production deployment, including migrations and recovery.
---

# Atlas Deploy

Read `docs/development.md` and `docs/contributing.md` for actual hosting and branch configuration.
Read `docs/security.md` if environment credentials or connector behavior changes.

## Target and readiness

1. Identify the project, branch, revision, and target environment before any mutation.
2. Distinguish feature preview, shared dev staging, and main production.
3. Inspect required checks and migration compatibility for the target revision.
4. Verify environment isolation; previews must not use production data or account tokens.
5. Check background schedules and connector subscriptions so previews do not duplicate real actions.
6. Establish the recovery path before a production change.

A successful build is not a live application smoke test.
After an authorized deploy, inspect its status and exercise the affected route or agent flow.
Check webhook identity/signature handling when a channel or connector changed.
Treat database rollback separately from application rollback.

## Authority and result

The accepted workflow is feature to dev, then a release PR from dev to main.
Do not configure or trigger production outside the user's authorized scope.
Do not request personal passwords or production secrets for local verification.
Report deployed revision, environment, smoke result, and any recovery limitation.
Never claim a deploy happened when only local checks ran.
