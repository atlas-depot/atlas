---
name: atlas-backend
description: Implement or review Atlas backend services, typed APIs, domain modules, permissions, integrations, workflow orchestration, audit logs, and provider adapters. Use when adding or changing a service, domain module, provider adapter, background workflow, or audit path, or when reviewing backend module boundaries.
---

# Atlas Backend Skill

Use this skill for backend implementation or review.

## Required Reading

Read:

- `AGENTS.md`
- `docs/process/agent-alignment.md`
- `docs/architecture/backend.md`
- `docs/architecture/db.md`
- `docs/architecture/security.md`
- `docs/architecture/repository-structure.md`
- `docs/process/provider-and-env-setup.md`
- `docs/process/evidence-bundles.md`
- Relevant domain docs and issue/plan.

## Architecture rules

- Modular monolith.
- Domain services own business logic.
- API handlers validate and delegate.
- Repositories enforce common filters and permissions.
- External calls go through adapters.
- Long workflows are idempotent.
- Action runs and AI runs are auditable.
- Durable state lives in Postgres/Redis/workflow store, not request memory.
- Bot, web, worker, and public API surfaces call shared application services.
- Billing and payment providers go through `BillingPort` and `PaymentPort`.
- Raw payment credentials and card data never enter Atlas Postgres.

## API rules

- Validate inputs with schemas.
- Return typed errors.
- Do not expose internal provider errors raw.
- Do not trust client-provided workspace membership or visibility.
- Public REST API must be versioned.
- All responses containing memory objects include visibility metadata.
- External action endpoints require risk classification and approval state.

## Implementation Workflow

1. Define domain/application service boundary before route code.
2. Add or reuse Zod contracts.
3. Add repository method with centralized permission filtering.
4. Add audit event for writes, AI runs, actions, sharing, and exports.
5. Add tests for happy path and permission failure.
6. Keep provider-specific code behind adapters.
7. Keep fake/local provider adapters available unless the issue explicitly requires real integration mode.
8. When adding provider config, update `.env.example`, provider/env setup docs, and env checks.
9. If touching billing or payments, verify webhook signatures, audit logs, feature flags, and PCI boundary.
10. Capture backend evidence: request/response snapshot, DB/query snapshot, audit/event snapshot, job/workflow state, or trace/log excerpt.

## Backend Evidence

Backend screenshot equivalent:

- Request/response snapshot for API behavior.
- DB query snapshot for persistence behavior.
- Audit log snapshot for writes, permissions, actions, sharing, OAuth, ingestion, and exports.
- Event/realtime payload snapshot for evented behavior.
- Workflow/job state snapshot for background work.
- Schema/OpenAPI/Zod diff for contract changes.
- Redacted log/trace excerpt for failure modes.

Prefer before/after snapshots when modifying existing behavior. Never include secrets, raw tokens, or unredacted private memory.

## Output

For implementation, include files touched and tests.
For review, classify findings as blocker, major, minor, or question.
Include backend evidence gathered or explain why it is not available yet.

Preferred evidence format:

```text
Backend evidence:
- Request/response:
- DB/query:
- Audit/event:
- Workflow/job:
- Logs/traces:
- Contract/schema:
```
