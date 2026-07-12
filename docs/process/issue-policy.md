# Issue Policy

## Required issue types

- Feature
- Bug
- Task
- Architecture decision
- Research spike
- Eval improvement
- Security/privacy issue

## Good issue checklist

- Clear goal.
- User or system value.
- Acceptance criteria.
- Out-of-scope section.
- Files or modules likely touched.
- Provider/env impact, including fake/local path, new env vars, and Efe-owned gates.
- Risks.
- Test expectations.
- End-user-aligned reproduction path for bug fixes when practical.

## Rules

- Do not start coding from vague issues.
- Split issues that touch too many domains.
- Add an ADR issue for architectural changes.
- Add eval criteria for AI behavior changes.
- Add provider/env criteria when work touches external providers, local services, preview env, secrets, or account setup.
- Do not use development cost as the main reason to weaken architecture. Reduce scope instead.
- During solo bootstrap, tiny local docs/setup edits may skip GitHub issues only if they do not affect architecture, product behavior, auth, permissions, DB, AI, provider, deployment, or external actions.
- Once more than one person is regularly committing, every feature, bug fix, task, research spike, and architecture decision must have an issue.
