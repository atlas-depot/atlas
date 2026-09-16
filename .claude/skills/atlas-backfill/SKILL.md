---
name: atlas-backfill
description: Plan, implement, or review an Atlas bulk data repair or recomputation with bounded recovery and verification.
---

# Atlas Backfill

Read `docs/architecture.md` for current storage boundaries and `docs/security.md` for access and data handling.
Use this when existing rows or stored artifacts must change, not for ordinary single-record edits.

## Prepare

1. State which records change and why; separate schema migration from data movement where appropriate.
2. Write a selection query and count affected records before running mutations.
3. Provide a limited dry-run or report-only mode.
4. Define restart behavior, batching, rate limits, and idempotency for repeated work.
5. Establish a recovery source or backup before destructive changes.

Use the existing task runner or workflow when suitable; do not build a new queue solely for a small repair.
Preserve per-user access boundaries and avoid loading unrelated private data.
Explicit approval is required for destructive execution; preparation does not authorize the full run.

## Verify

Test a small slice, retry behavior, and interruption recovery before scaling up.
Count remaining eligible records instead of trusting only queued-job totals.
Spot-check stored outcomes and relevant retrieval/eval behavior.
Record filter, counts, duration, failures, and recovery details without private content.
Separate a verified dry-run from an executed full run in the final report.
