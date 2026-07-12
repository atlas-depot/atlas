---
name: atlas-backfill
description: Design, implement, or review bulk or one-off data changes in Atlas: re-embedding after a model swap, recomputing derived fields, reshaping stored data, repairing bad rows. Use when a change touches many existing rows, when someone proposes a one-off script against the database, or when a migration would otherwise contain data manipulation.
---

# Atlas Backfill Skill

Migrations change schema. Backfills move data. Never mix the two, and never run bulk data changes as ad-hoc scripts against a live database. The motivating Atlas case: re-embedding every chunk after an embedding model swap without corrupting retrieval or blowing provider rate limits.

## Required Reading

Read:

- `AGENTS.md`
- `docs/process/agent-alignment.md`
- `docs/architecture/db.md`
- `docs/architecture/technical-decisions.md`

## Non-negotiables

- A backfill is a resumable, batched background job, never a script pasted into a console.
- Each unit of work is idempotent and processes one record: re-running it converges to the same end state, crash and retry included.
- Filter before enqueue. Select only rows that actually need the change so there are no no-op jobs and progress numbers mean something.
- Throttle every external call (embedding provider, OAuth APIs). The backfill must survive rate limits without data loss.
- Dry-run first: every backfill supports a `limit` and a report-only mode, and is tested on a small slice before the full run.
- Backfills respect workspace and visibility boundaries exactly like live code paths. No raw cross-workspace scans.
- Every run is triggered from an operator surface or task runner with an audit record: who ran it, when, with what filter, how many rows.
- Destructive backfills (overwriting or deleting data) require explicit approval and a stated recovery plan, per the same rule as destructive migrations.
- Prefer replay-by-source-id recovery: if derived data is wrong, rebuild it from provenance rather than patching it in place.

## Workflow

1. State the intent: which rows, what change, why now. Confirm the schema part already landed via `/atlas-db` if there is one.
2. Write the selection query and report the expected row count before writing the job.
3. Implement the job: one record per unit, idempotent, batched, throttled, resumable from where it stopped.
4. Add tests: idempotency (run twice, same state), visibility (private rows stay private), and a failure-mid-batch resume case.
5. Dry-run with a small limit. Verify the slice by hand or with a snapshot per `/atlas-test`.
6. Run the full backfill. Track progress by counting remaining unfiltered rows, not by trusting the queue.
7. Verify the end state: remaining-rows query returns zero, spot-check derived data, and confirm retrieval/eval smoke still passes if embeddings changed.
8. Record the run: filter, counts, duration, anomalies.

## Review checklist

- Is the work split correctly between migration (schema) and backfill (data)?
- Is each job idempotent? What happens on crash, retry, or double enqueue?
- Is the enqueue filtered, or will it flood the queue with no-ops?
- Are external calls throttled and failures retried without losing rows?
- Was a limited dry-run performed and its evidence attached?
- Are visibility and workspace boundaries enforced inside the job?
- Is there an audit record and a recovery plan?

## Output

Provide:

- Selection query and expected row count.
- Job design: batching, throttle, idempotency key.
- Dry-run evidence.
- Full-run report: counts, duration, anomalies.
- End-state verification.
- Recovery plan.
