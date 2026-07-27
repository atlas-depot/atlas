# Agent Alignment

Status: operating contract  
Audience: all AI coding agents working on Atlas

Atlas uses docs, rules, skills, and hooks to keep agents aligned with the product and architecture. The goal is not to make agents slower. The goal is to prevent silent drift from the source of truth.

## Source Of Truth Order

When sources conflict, use this order:

1. Current user instruction.
2. `AGENTS.md` non-negotiables and protected boundaries.
3. `docs/architecture/atlas-production-spec-and-plan.md`.
4. `docs/architecture/technical-decisions.md`.
5. Relevant domain architecture docs under `docs/architecture`.
6. Process docs under `docs/process`.
7. Skills under `.claude/skills`.
8. Cursor rules under `.cursor/rules`.
9. Older notes, comments, or guesses.

If the user asks for a technically weaker path, protect the invariant and explain the tradeoff.

## Required Agent Start

For any non-trivial task:

1. Read `AGENTS.md`.
2. Run or inspect `git status` if this is a real git repo.
3. Identify whether this is still the project knowledge pack or the future application scaffold.
4. Load the relevant Atlas skill.
5. Read the relevant docs listed by that skill.
6. Read `docs/process/engineering-standards.md` when the task changes code, docs, tests, UI, CI, generated files, commits, or PR process.
7. Check whether the task touches an Efe-owned decision gate.
8. Proceed only inside the smallest safe scope.

## Skills

Use skills as executable playbooks:

- `/atlas-owner-onboarding`: role-specific first steps.
- `/atlas-plan`: read-only planning and Phase 0 grilling of vague/risky requirements (ADR-aligned).
- `/atlas-implement`: execute an approved issue/plan with tests.
- `/atlas-review`: extensive PR/diff review.
- `/atlas-create-skills`: create or improve Atlas skills.
- `/atlas-bootstrap`: create the Phase 0 runnable app scaffold and first reproducible local environment.
- `/atlas-deploy`: deployment readiness.
- `/atlas-pr`: open or update reviewable PRs (Mode A) and babysit them green, reviewed, and ready (Mode B).
- `/atlas-test`: lint, typecheck, tests, e2e, evals, screenshots, preview smoke, and CI evidence.
- `/atlas-handoff`: fresh-agent or teammate handoff.
- `/atlas-issue`: issue drafting.
- Domain skills: `/atlas-design`, `/atlas-frontend`, `/atlas-backend`, `/atlas-db`, `/atlas-ai`, `/atlas-security`. `/atlas-ai` also owns retrieval/extraction/privacy/action-safety evals.

See `docs/process/skill-taxonomy.md` for the canonical skill boundary map and deletion rule.

## Automatic Hooks

Project-local Cursor hooks exist to nudge agents toward the right skill and source-of-truth docs:

- Cursor: `.cursor/hooks.json` runs `.cursor/hooks/atlas-skill-suggest.py` on `beforeSubmitPrompt`.

Hooks should suggest context and skills. They must not silently modify files, post GitHub comments, push branches, deploy, or bypass approvals.

If a hook fails, agent work should fail open. A broken suggestion hook must not block local development.

## Efe-Owned Gates

Message Efe before making or pretending to make decisions about:

- Production accounts, domains, env vars, secrets, KMS, or deployment approval.
- Vercel/Neon/Redis/Workflow/Eve provider setup.
- Google OAuth app, Gmail/Calendar scopes, verification, or compliance.
- Billing/payment provider selection, PCI scope, payment vault, PSP routing, or live payment enablement.
- Object storage provider.
- OCR/document intelligence provider.
- WhatsApp provider.
- Apple Messages for Business or iMessage feasibility.
- Real eval dataset and privacy policy.
- Final UI brand, logo, and visual identity.

Provider/env setup must follow `docs/process/provider-and-env-setup.md`. During bootstrap, personal provider accounts may be Efe-owned to control cost, but agents and teammates must not request or use Efe's personal passwords, 2FA, broad dashboard access, or production secrets. Prefer fake/local providers, preview URLs, and scoped integration secrets.

Engineering work must follow `docs/process/engineering-standards.md`.
Do not give much weight to development cost when making technical decisions.
Prefer quality, simplicity, robustness, scalability, security, and long-term maintainability.
Do not use the em dash character.
Do not add agent co-authors to commit messages.
Do not manually edit generated files or `CHANGELOG.md`.

Use:

```text
Decision needed:
Context:
Options:
Recommendation:
Risk if deferred:
Link to issue/PR:
```

## External Review Tools

When reviewing or babysitting PRs, include available external review signals:

- GitHub review threads.
- GitHub Actions and attached checks.
- Vercel preview deployment checks.
- Greptile comments/checks if present.
- Cursor/Bugbot comments/checks if present.
- Devin comments/checks if present.
- Codex/Claude review comments/checks if present.

Do not claim these tools were checked unless you actually inspected their PR comments, review threads, checks, or linked reports.

## Completion Rule

Do not say a task is done until the requested scope is complete or blocked by a concrete external condition.

For UI, frontend, preview, and PR evidence, use `agent-browser` for screenshots/snapshots. If it is not installed, install the pinned CLI before claiming screenshot or preview verification is complete.

For backend/API/worker/DB evidence, use reproducible snapshots: request/response, DB/query output, audit/event rows, workflow/job state, schema/contract diff, and redacted logs/traces. Prefer before/after snapshots for changed behavior. See `docs/process/evidence-bundles.md`.

For bug fixes, start with an end-user-aligned reproduction when practical.
For UI fixes, inspect the actual rendered UI and be strict about visual defects.
For lint, type, test, and flaky-test failures, fix the failure if it is caused by the current change or small and safe to fix.
If it is pre-existing and larger than scope, create a tracked issue and call it out.

For PR babysitting, "done" means:

- CI/checks are green or a specific non-PR blocker is documented.
- Required preview is deployed and smoke-tested, or unavailable with a documented reason.
- Review threads are resolved, outdated, or have a clear answer.
- Valid external review comments have been addressed.
- PR body reflects the current state.
- Remaining risks are explicit.
