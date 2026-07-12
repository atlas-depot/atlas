# Claude Project Memory

Follow `AGENTS.md` as the project-wide source of truth.

Use Atlas skills in `.claude/skills/` when the task matches a repeatable workflow:

- `/atlas-plan` for read-only planning, including grilling vague or risky requirements before the plan.
- `/atlas-owner-onboarding` when a teammate or agent needs role-specific first steps.
- `/atlas-implement` for executing an approved issue or plan.
- `/atlas-review` for extensive PR/diff review.
- `/atlas-pr` for opening/updating reviewable PRs and babysitting them until CI, preview, and reviews are ready.
- `/atlas-create-skills` for skill/hook creation and improvement.
- `/atlas-bootstrap` for the Phase 0 runnable app scaffold.
- `/atlas-issue` for issue drafting.
- `/atlas-test` for lint/typecheck/tests/e2e/evals/screenshots and evidence.
- `/atlas-handoff` for transferring work to another teammate or agent.
- `/atlas-db`, `/atlas-backend`, `/atlas-frontend`, `/atlas-design`, `/atlas-ai`, `/atlas-security`, `/atlas-api` for domain-specific implementation. `/atlas-ai` also owns retrieval/extraction/privacy/action-safety eval design and review. `/atlas-api` owns HTTP contract and versioning discipline.
- `/atlas-backfill` for bulk or one-off data changes (re-embedding, recomputing derived data). Migrations change schema; backfills move data.
- `/atlas-deploy` for deployment checks.
- `/atlas-weekly-report` for senior project summaries.

Project-local hooks may suggest relevant Atlas skills on prompt submit. Treat them as advisory; still read the named `SKILL.md` before using a skill.

For provider accounts, env vars, fake/local providers, and secret handoff, read `docs/process/provider-and-env-setup.md`.
For writing, quality, bug-fix, UI, CI, generated-file, and commit-message rules, read `docs/process/engineering-standards.md`.

Important constraints:

- Be evidence-driven, not agreement-driven.
- Do not optimize architecture for implementation speed or development cost.
- Cut feature scope before weakening core architecture.
- Do not make destructive changes without explicit approval.
- Do not hide uncertainty.
- Always produce small, reviewable changes.
- Do not use the em dash character.
- Do not add agent co-authors to commit messages.
