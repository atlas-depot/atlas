---
name: atlas-plan
description: Produce a read-only Atlas implementation plan grounded in project docs, source-of-truth decisions, and current repo state. Use for features, refactors, architecture changes, issue breakdowns, ADR/RFC direction, or when deciding what to build next. Do not use for coding.
---

# Atlas Plan Skill

Use this skill to plan work before editing files. It should behave like grill-with-docs when requirements are vague: read the docs, ask only blocking questions, and protect Atlas invariants.

Mode: read-only. Do not edit application code while using this skill. If the user explicitly asks to save the plan into docs/issues, only write planning artifacts.

## Required Reading

Always read:

- `AGENTS.md`
- `docs/process/agent-alignment.md`
- `docs/architecture/atlas-production-spec-and-plan.md`
- `docs/architecture/technical-decisions.md`
- `docs/architecture/repository-structure.md`
- `docs/process/engineering-standards.md`
- `docs/process/solo-to-team-workflow.md`
- `docs/process/owner-onboarding.md`
- `docs/process/provider-and-env-setup.md`
- `docs/process/skill-taxonomy.md`

Then read domain docs for the requested area.

## Planning Workflow

1. Restate the goal and current phase: project knowledge pack or application scaffold.
2. Inspect current repo shape and `git status` if this is a git repo.
3. Identify relevant Atlas invariants.
4. Identify Efe-owned decision gates.
5. Read the nearest source-of-truth docs.
6. Decide whether the request is implementable without more input.
7. If not, ask the smallest set of blocking questions.
8. If yes, produce a scoped implementation plan.
9. Split oversized scope into issues.
10. Name verification and acceptance criteria.

## Ask Questions Only When They Matter

Ask when:

- User intent changes product behavior.
- Provider/account/compliance/secret/brand decision is needed.
- The plan needs real provider credentials and fake/local mode is not enough.
- Permission, auth, action safety, AI grounding, or data model invariant is ambiguous.
- Multiple approaches have materially different risk.

Do not ask when:

- The answer is in docs or code.
- A conservative default exists.
- The question is only implementation preference with low blast radius.

## Output

Produce a plan with:

1. Problem summary.
2. Scope and non-scope.
3. Architecture impact.
4. Data model impact.
5. API impact.
6. UI impact.
7. AI impact.
8. Security and privacy impact.
9. Files likely touched.
10. Implementation steps.
11. Test plan.
12. Risks and rollback.
13. Questions that still block implementation.
14. First issue or branch suggestion.

## Rules

- Do not start implementation during planning.
- Do not modify code, migrations, CI, or provider config during planning.
- Reject architecture shortcuts that weaken Atlas invariants.
- If the work affects database schema, permissions, AI pipeline, actions, or deployment, require ADR or RFC.
- Split work into smaller issues if the plan is too large.
- Prefer reducing feature scope over weakening architecture.
- Do not give much weight to development cost when making technical decisions.
- Prefer quality, simplicity, robustness, scalability, security, and long-term maintainability.
- Use current official docs before recommending new external integrations.
