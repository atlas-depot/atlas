# Atlas Skill Taxonomy

Status: operating policy  
Audience: Efe, teammates, and AI coding agents

Atlas skills are lifecycle gates and domain lenses. They should not multiply into one skill per tiny task.

## Rule

Keep a skill only if it changes agent behavior in a meaningful way:

- It changes safety mode.
- It changes required evidence.
- It routes the agent to different source-of-truth docs.
- It defines a repeatable loop.
- It protects an Atlas invariant.

Do not create a skill just because a task exists.

## Lifecycle Skills

These are the main verbs.

| Skill | Mode | Purpose | Writes files? |
| --- | --- | --- | --- |
| `/atlas-owner-onboarding` | orient | Tell a person/agent what to read, own, run, and escalate. | No |
| `/atlas-plan` | read-only | Produce a source-grounded plan, issue split, or ADR/RFC direction. | No, unless the user asks to write planning docs. |
| `/atlas-implement` | write | Execute an already approved issue/plan with tests. | Yes |
| `/atlas-review` | read-mostly | Review a diff/PR with CI, preview, review threads, external reviewers, and Atlas invariants. | No by default |
| `/atlas-deploy` | release gate | Check preview/staging/production readiness, provider/env setup, secrets, previews, and rollback. | No by default |
| `/atlas-bootstrap` | scaffold gate | Create or repair the Phase 0 runnable app scaffold, local infra, env, seeds, CI, and first shells. | Yes |
| `/atlas-create-skills` | meta | Create or improve project skills and hooks. | Yes |

## Artifact Skills

These create or improve project artifacts.

| Skill | Purpose |
| --- | --- |
| `/atlas-issue` | Turn vague work into a scoped issue with acceptance criteria and tests. |
| `/atlas-pr` | Mode A opens/updates reviewable PRs with preview, screenshots, tests, risk, rollback, and senior project evidence. Mode B babysits a PR until checks, previews, comments, and external reviews are resolved or blocked. |
| `/atlas-test` | Produce verification evidence: lint, typecheck, tests, e2e, evals, screenshots, preview smoke, CI. |
| `/atlas-handoff` | Transfer exact state, commands, blockers, and first 30 minutes to another teammate or agent. |
| `/atlas-weekly-report` | Produce artifact-backed senior project progress reports. |

## Domain Lens Skills

These should usually be loaded by lifecycle skills, not used as the whole workflow.

| Skill | Domain |
| --- | --- |
| `/atlas-design` | Product surfaces, design system, tokens, visual references, states, keyboard flows, action/citation affordances. |
| `/atlas-frontend` | Next.js/web/PWA implementation boundaries. |
| `/atlas-backend` | API, services, ports/adapters, workflows, audit. |
| `/atlas-db` | Postgres, migrations, pgvector, relation visibility, indexes. |
| `/atlas-ai` | Ingestion, extraction, RAG, citations, prompt/model metadata, action risk, and retrieval/extraction/privacy/action-safety evals. |
| `/atlas-security` | OAuth, tokens, permissions, privacy, sharing, export/delete, audit. |
| `/atlas-api` | HTTP contract discipline: schema-first endpoints, generated client and docs as required artifacts, contract guard test, dated append-only versioning for breaking changes. |
| `/atlas-backfill` | Bulk/one-off data changes as idempotent, batched, throttled, dry-runnable, audited jobs. Enforces the migration-vs-data split with `/atlas-db`. |

Keep `/atlas-frontend` and `/atlas-backend`. They are not lifecycle skills; they are implementation lenses with different source docs and failure modes. `/atlas-design` owns product/visual/design-system decisions. `/atlas-frontend` owns Next.js implementation boundaries. `/atlas-backend` owns services/API/workflows/adapters.

Screenshot and visual verification should flow through `/atlas-test` and use `agent-browser`. If it is missing, install the pinned CLI before claiming screenshot or preview verification is complete. `/atlas-design`, `/atlas-review`, `/atlas-pr`, and `/atlas-deploy` may call that evidence path instead of inventing separate screenshot rules.

Backend verification also flows through `/atlas-test`: request/response snapshots, DB/query snapshots, audit/event snapshots, workflow/job state, schema/contract diffs, and redacted logs/traces. These are the backend equivalent of screenshots.

Provider/env verification flows through `/atlas-deploy` and `/atlas-test`. New provider requirements must update `.env.example`, `docs/process/provider-and-env-setup.md`, fake/local provider behavior, and doctor/env checks before they are considered done.

## Merged Skills

The set is now 20 skills. Three former skills were merged into existing ones under the Deletion Rule because they shared mode, source docs, and safety behavior with their target:

- `/atlas-babysit` merged into `/atlas-pr` as Mode B (babysit to merge-ready). Opening a PR and shepherding it to green are one lifecycle.
- `/atlas-grill-me` merged into `/atlas-plan` as Phase 0 (grill). Grilling vague requirements is the read-only front of planning, not a separate mode.
- `/atlas-eval` merged into `/atlas-ai` as the Evals section. Eval design changes AI behavior and shares the same source docs.

## Plan vs Implement Boundary

Keep both skills.

`/atlas-plan` is for deciding. It may ask questions, reject weak directions, split issues, and propose architecture.

`/atlas-implement` is for doing. It requires an approved issue or plan. It must not silently invent product scope. If the task has no plan and is non-trivial, it must stop and route to `/atlas-plan`.

The invariant: planning is allowed to be broad and skeptical; implementation must be narrow and verifiable.

## Missing Skills To Add Only If Needed

Do not add these yet unless the workflow appears repeatedly:

- `/atlas-research`: verify current official docs for volatile libraries/providers. Add if external integration research becomes frequent enough that `/atlas-plan` is too broad.
- `/atlas-demo`: prepare senior project demos with preview links, scripts, screenshots, and failure recovery. Add when demo cadence starts.
- `/atlas-migrate`: do not add yet. Use `/atlas-db` for database migrations. Use `/atlas-bootstrap` later for moving from knowledge pack to runnable app scaffold. Add `/atlas-migrate` only if recurring repo/data migration work appears.

Until then, use existing lifecycle/domain skills.

## Deletion Rule

Delete or merge a skill when:

- It has the same mode, same source docs, same output, and same safety behavior as another skill.
- It only repeats generic agent instructions.
- It is not referenced by README, `CLAUDE.md`, `docs/process/agent-alignment.md`, or hooks.

## Added Skills

Two skills were added under the Rule (they change required evidence and protect Atlas invariants):

- `/atlas-api`: an endpoint change is done only when contract, generated client, and docs land together; breaking changes ship as dated append-only version units.
- `/atlas-backfill`: bulk data changes run as idempotent, batched, audited jobs, keeping data movement out of migrations.
