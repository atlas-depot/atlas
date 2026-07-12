---
name: atlas-api
description: Design, implement, or review Atlas HTTP API contracts and versioning. Use when adding or changing an endpoint, updating the OpenAPI contract or generated client, deciding whether a change is additive or breaking, versioning a breaking change, or reviewing API surface changes for contract drift.
---

# Atlas API Skill

An endpoint is not done when it returns 200. It is done when every downstream artifact reflects it. This skill owns that checklist and the versioning discipline that keeps clients from breaking as the team grows.

## Required Reading

Read:

- `AGENTS.md`
- `docs/process/agent-alignment.md`
- `docs/architecture/repository-structure.md`
- `docs/architecture/technical-decisions.md`

## Non-negotiables

- Every route has a typed contract. Zod schemas at the boundary are the source of the OpenAPI document, not a hand-maintained copy.
- The contract, the generated TypeScript client, and any published API docs are required artifacts of an endpoint change, not follow-ups.
- A guard test keeps the route table and the contract in sync in both directions: a route without a contract entry fails CI, and a contract entry without a route fails CI.
- Additive vs breaking is decided before implementation, in the plan or issue, not discovered in review.
- Breaking changes never edit an existing behavior in place. They ship as a new dated version unit.
- Version units are append-only and reversible: a small request-upgrade transform on the way in and a response-downgrade transform on the way out, pinned by a version header.
- Callers that do not send a version header are frozen at the base version forever. Internal clients pin explicitly.
- Auth and permission checks live in the handler/service layer per `/atlas-security`; the contract documents them but never replaces them.

## Endpoint Change Workflow

1. State the intent: new endpoint, additive change, or breaking change. If breaking, justify why an additive shape cannot work.
2. Define or update the Zod request/response schemas first. Types flow from the schema.
3. Implement the handler through the service layer per `/atlas-backend`.
4. Regenerate the OpenAPI document and the TypeScript client. Commit the regenerated artifacts in the same PR.
5. Update API docs if the surface is documented.
6. Run the contract guard test and the affected request tests.
7. Evidence per `/atlas-test`: request/response snapshots and the schema/contract diff.

## Breaking Change Workflow

1. Write the new behavior as the current implementation.
2. Add a dated version unit that upgrades old-shaped requests and downgrades new-shaped responses so existing pinned callers see no change.
3. Never modify an existing version unit; stack a new one.
4. List affected callers (web app, worker, integrations) and confirm each is pinned or migrated in the same change or a linked issue.
5. Document the change in the contract changelog section of the API docs.

## Review checklist

- Does every changed route have an updated schema, regenerated client, and doc entry in this PR?
- Does the guard test still pass, and does it actually cover the changed routes?
- Is the additive/breaking call correct? Would an old client break against this diff?
- Are version units small, dated, append-only, and reversible?
- Do error responses follow the shared error shape?
- Are permissions enforced in the handler, not assumed from the contract?

## Output

Provide:

- Contract diff (schemas and OpenAPI).
- Regenerated client status.
- Additive/breaking verdict with reasoning.
- Version unit added, if breaking.
- Affected callers and their migration state.
- Guard test and request test evidence.
