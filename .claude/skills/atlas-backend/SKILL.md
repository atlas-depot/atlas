---
name: atlas-backend
description: Build or review Atlas API, persistence, and backend workflows with explicit access and failure behavior.
---

# Atlas Backend

Read `docs/architecture.md` for accepted boundaries and `docs/security.md` for sensitive paths.
Read `docs/development.md` only for environment or execution details needed by the change.
Backend architecture and behavior remain subject to team review.

## API and services

1. Define inputs, outputs, errors, and the caller's identity before implementing a boundary.
2. Validate untrusted inputs and enforce ownership server-side.
3. Inspect affected callers before changing a contract.
4. Update an existing generated client or contract through its generator when one exists.
5. Do not invent public API version infrastructure for an internal endpoint.
6. Define timeout, retry, and ambiguous-result behavior for external actions.

## Persistence

Use the established ORM and migration workflow once implemented.
Check constraints, transactions, and access filters against the actual query path.
Durable work must not rely on request memory alone; use eve's existing facilities where suitable.
For data rewrites, separate preparation from authorized execution and use the backfill workflow when warranted.
Do not introduce billing, queues, workers, or vector storage merely because older docs listed them.

## Evidence

Verify the changed API result and its persisted or external effect as appropriate.
Include a small sanitized request/result, query outcome, workflow transition, or schema diff.
Show failure and unauthorized cases when the change affects them.
Provide this evidence for teammate review; screenshots alone cannot verify backend behavior.
