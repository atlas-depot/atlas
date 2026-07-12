---
name: atlas-issue
description: Create a well-scoped Atlas GitHub issue with goal, scope, architecture impact, acceptance criteria, tests, owner routing, and senior project evidence.
---

# Atlas Issue Skill

Use this skill to turn a vague request into an issue.

## Required Reading

Read:

- `docs/process/issue-policy.md`
- `docs/process/solo-to-team-workflow.md`
- `docs/process/owner-onboarding.md`
- `docs/process/provider-and-env-setup.md`
- `docs/architecture/repository-structure.md`
- Relevant architecture docs.

## Required issue sections

```md
## Goal

## User/system value

## Scope

## Out of scope

## Proposed approach

## Architecture impact

## Data model impact

## API impact

## UI impact

## AI impact

## Security and privacy impact

## Provider/env impact

- Local fake path:
- New env vars:
- Real provider access needed:
- Efe-owned gate:

## Acceptance criteria

- [ ] ...

## Test requirements

## Files or packages likely touched

## Risks

## Senior project explanation target

The assignee should be able to explain:
- What they built.
- Why it matters.
- How it works.
- How they tested it.
```

## Rules

- If the issue is too large, split it.
- If architecture changes are involved, create an ADR task.
- If AI behavior changes, require eval criteria.
- If provider/env behavior changes, require `.env.example`, fake/local provider behavior, provider docs, and doctor/env check criteria.
- If it touches an Efe-owned gate, add an explicit "Needs Efe decision" section.
- If it needs preview evidence, state that in acceptance criteria.
- Keep first issues small enough for a teammate to complete and explain.
