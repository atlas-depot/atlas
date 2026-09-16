---
name: atlas-review
description: Review an Atlas diff for actionable correctness, integration, UI, backend, or deployment defects.
---

# Atlas Review

Read `docs/contributing.md`; read `docs/security.md` when authorization, data, tokens, or external actions change.
Use `docs/architecture.md` for actual component boundaries, not obsolete planned packages.

## Review

1. Identify the exact head/base and inspect the diff plus affected callers.
2. Check behavior against the requested scope and current product decisions.
3. Trace authorization and external effects through the backend when affected.
4. Check retry, partial failure, persistence, and migration behavior when affected.
5. Inspect rendered UI at desktop and mobile widths for user-visible changes.
6. Inspect backend evidence as well as UI evidence; neither substitutes for the other.
7. Read CI failures and review comments, but independently validate reported defects.

Distinguish a demonstrated bug from an untested risk or preference.
Prioritize data loss, unauthorized access, duplicate actions, and broken user flows.
Do not turn missing optional docs, a stylistic preference, or a bot verdict into a blocker.
Do not claim runtime verification from static inspection alone.

## Report

Return actionable findings with file/line, trigger, impact, and a focused remedy.
If clean, say so and name meaningful verification gaps.
Human teammates review both UI and backend changes; agent review is supporting evidence.
Post review comments only when authorized.
