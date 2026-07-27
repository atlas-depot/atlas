# Atlas Project Knowledge Pack

This package gives Atlas a repo-level operating system for AI-assisted senior project development. It is not the application scaffold. It is the knowledge pack that lets Efe, teammates, and coding agents create the real app scaffold without rediscovering architecture, process, ownership, and quality gates.

It includes:

- Always-on agent instructions for Codex, Cursor, Claude Code, and similar coding agents.
- Atlas-specific Agent Skills in `.claude/skills/*/SKILL.md`.
- Cursor project rules in `.cursor/rules/*.mdc`.
- Architecture and process reference files under `docs/`.
- GitHub issue templates, PR template, CI starter workflow, and CODEOWNERS template.

## How to use

Copy the contents of this folder into the root of the future Atlas application repository.

```bash
cp -R atlas-skill-pack/* /path/to/atlas-repo/
cp -R atlas-skill-pack/.github /path/to/atlas-repo/
cp -R atlas-skill-pack/.cursor /path/to/atlas-repo/
cp -R atlas-skill-pack/.claude /path/to/atlas-repo/
```

Then review these files before creating the first application scaffold commit:

- `.github/CODEOWNERS.template`: replace placeholder owners and rename to `.github/CODEOWNERS`.
- `.github/workflows/ci.yml`: ensure scripts match the root `package.json`.
- `commitlint.config.cjs`: install commitlint packages before enforcing it.
- `docs/architecture/*.md`: update only when an ADR or implementation proves a change is needed.
- `docs/architecture/repository-structure.md`: use as the target structure contract for the application scaffold.
- `docs/process/file-map.md`: use to understand every file in this knowledge pack.
- `docs/process/agent-alignment.md`: use to understand source-of-truth order, skills, and hooks.
- `docs/process/skill-taxonomy.md`: use to understand which skill to use, keep, merge, or defer.
- `docs/process/onboarding.md`: implement the `mise` and `doctor` command contract in Phase 0.
- `docs/process/provider-and-env-setup.md`: implement provider accounts, env modes, fake providers, secret handoff, and personal-account bootstrap rules.
- `docs/process/engineering-standards.md`: enforce writing, quality, bug-fix, UI, CI, generated-file, and commit-message standards.
- `docs/process/solo-to-team-workflow.md`: follow the solo-to-team operating model.
- `docs/process/owner-onboarding.md`: use when a teammate takes responsibility for an area.

## Required workflow

Atlas starts solo, then grows into a 5-person team. Follow `docs/process/solo-to-team-workflow.md` for the exact phase rules.

Default sequence once CI and preview deployments exist:

1. Open or select an issue.
2. Create a branch from `main`.
3. Make small atomic commits using Conventional Commits.
4. Open a PR with linked issue, what changed, why, how, tests, screenshots when UI changed, and senior project learning summary.
5. Pass CI.
6. Receive review approval.
7. Squash merge or rebase merge into `main`.

Direct pushes to `main` are not allowed.

During the very first solo bootstrap, tiny local docs/setup edits may happen without an issue or PR, but architecture, auth, permissions, DB, AI behavior, provider, deployment, and feature changes still require tracked work.

## Bootstrap leadership

Efe Baran Durmaz is the bootstrap lead and product owner. This is not a rigid people hierarchy; it is the source-of-truth rule for kickstarting the application scaffold, product scope, provider accounts, production secrets, compliance-sensitive setup, and final brand direction. If a task hits one of those gates, stop guessing and message Efe with options, recommendation, and risk.

## Recommended agent use

Use repo-level instructions for always-on constraints.
Use skills for repeatable workflows:

- `/atlas-plan` for read-only planning before implementation, including grilling vague requirements first.
- `/atlas-owner-onboarding` when a teammate says "I own frontend/backend/AI/etc.; what should I do?"
- `/atlas-implement` only when coding from an approved issue or plan.
- `/atlas-review` for extensive PR/diff review.
- `/atlas-create-skills` when creating or improving Atlas skills/hooks.
- `/atlas-bootstrap` when creating or repairing the Phase 0 runnable app scaffold.
- `/atlas-pr` when opening or updating reviewable PRs (Mode A), or babysitting a PR until CI, preview, reviews, and readiness gates are green or concretely blocked (Mode B).
- `/atlas-issue` when creating issues.
- `/atlas-test` when running lint/typecheck/tests/e2e/evals/screenshots or proving a PR works.
- `/atlas-handoff` when transferring work to another teammate or agent.
- `/atlas-db`, `/atlas-backend`, `/atlas-frontend`, `/atlas-design`, `/atlas-ai`, `/atlas-security` for domain-specific work. `/atlas-ai` also owns AI eval design and review.
- `/atlas-deploy` for preview/staging/production readiness.
- `/atlas-weekly-report` for senior project progress reporting.

## Automatic alignment hooks

Project-local advisory hooks exist for Cursor:

- `.cursor/hooks.json` -> `.cursor/hooks/atlas-skill-suggest.py`

They suggest relevant Atlas skills and source-of-truth docs based on prompt text. They are intentionally non-blocking and must not edit files, push, deploy, post comments, or bypass approvals.

## Non-negotiable Atlas principles

- Modular monolith first.
- TypeScript full-stack.
- Postgres as canonical database.
- pgvector for MVP semantic retrieval.
- OKF as export/import format, not primary storage.
- Responsive web + PWA before native mobile.
- Soft citations and an acting Eve agent on memory.
- Async Workflow SDK ingestion pipeline.
- Single-user MVP; sharing post-MVP.
- P1: confirm real external writes; auto drafts and internal safe writes.
- Architecture decisions must be documented (`docs/architecture/adr-001-acting-first-eve.md`).
