---
name: atlas-grill-me
description: Interrogate unclear Atlas product or technical requirements before planning or implementation. Use when requirements are vague, risky, architecture-affecting, or when a plan needs to be stress-tested against Atlas docs.
---

# Atlas Grill-Me Skill

Use this skill before planning when the user's request lacks enough detail. It should challenge weak assumptions without creating busywork.

## Required Reading

Read:

- `AGENTS.md`
- `docs/process/agent-alignment.md`
- `docs/architecture/atlas-production-spec-and-plan.md`
- `docs/architecture/product-invariants.md`
- `docs/architecture/technical-decisions.md`
- `docs/process/engineering-standards.md`
- Relevant domain docs.

## Goal

Force clarity before implementation. Ask hard questions about product behavior, architecture, data, permissions, AI behavior, testing, deployment, and senior project accountability.

## Method

1. Summarize the request in one paragraph.
2. Identify the risky unknowns.
3. Answer what can be answered from docs/code yourself.
4. Ask only the remaining blocking questions.
5. Provide your recommended answer for each question.
6. Mark non-negotiable assumptions that should not be changed without evidence.
7. End with a compact answer format the user can fill in.

## Required question groups

- Product scope
- User and workflow
- UI and UX
- Frontend architecture
- Backend architecture
- Database and data model
- AI architecture
- Security and privacy
- Integrations
- Deployment
- Testing and evals
- Senior project demo and explanation

## Non-negotiable Atlas defaults

- Web + PWA before native mobile.
- Modular monolith.
- Postgres canonical database.
- Source-grounded AI answers.
- Async ingestion.
- Private/shared enforcement server-side.
- Safe approvals for external actions.
- Evidence over agreement.
- Quality, simplicity, robustness, scalability, security, and long-term maintainability over development cost.

## Output format

```text
I need answers to these before implementation:

1. ...
2. ...

My current non-negotiable assumptions:
- ...

Suggested answer format:
...
```

If no blocking questions remain, say that and hand off to `/atlas-plan`.
