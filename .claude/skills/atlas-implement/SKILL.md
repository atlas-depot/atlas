---
name: atlas-implement
description: Execute an approved Atlas issue or plan with code/docs changes, tests, and verification. Use when coding, fixing, scaffolding, or applying planned work. Do not use for broad planning; if no approved plan/issue exists, route to /atlas-plan first.
---

# Atlas Implement Skill

Use this skill only when coding after an issue or plan exists. If no issue/plan exists and the work is non-trivial, stop and route to `/atlas-plan`.

Mode: write/execution. Keep scope narrow and verifiable.

## Required Reading

Read:

- `AGENTS.md`
- `docs/process/agent-alignment.md`
- The linked issue/plan.
- `docs/process/definition-of-done.md`
- `docs/process/engineering-standards.md`
- `docs/process/solo-to-team-workflow.md`
- `docs/process/provider-and-env-setup.md`
- `docs/process/skill-taxonomy.md`
- Relevant architecture docs.
- Relevant domain skill.

## Before Editing

1. Run `git status --short` if this is a git repo.
2. Identify uncommitted user work and avoid overwriting it.
3. Confirm the task has acceptance criteria. If not, stop and request `/atlas-plan` or `/atlas-issue`.
4. Identify files/packages likely touched.
5. Identify tests to add/update.
6. Identify whether the work touches an Efe-owned gate.
7. If the work requires a new dependency/integration, stop unless the approved plan includes current official-doc evidence.

## Implementation rules

- Keep the change minimal and atomic.
- Do not invent new product scope.
- Do not create an architecture decision while implementing; pause and route back to `/atlas-plan` if one appears.
- Prefer quality, simplicity, robustness, scalability, security, and long-term maintainability over development cost.
- Standards: see AGENTS.md.
- Use strict TypeScript.
- Validate API inputs with schemas.
- Keep domain logic out of UI components.
- Use repositories/services/ports instead of direct provider calls.
- Enforce permissions server-side.
- Add meaningful tests.
- Update docs when behavior changes.
- Do not add GraphQL, Convex primary storage, a separate vector DB, native mobile, or chat-only UI.
- Do not add Zustand, Framer Motion, or other DX dependencies unless a concrete need is documented.
- Do not use production credentials for local development.
- If the change adds or requires a provider/env var, update `.env.example`, `docs/process/provider-and-env-setup.md`, and `doctor`/`env:check` behavior.
- Prefer fake/local provider adapters for normal development; request scoped Efe-owned secrets only when fake providers are insufficient.
- For bug fixes, reproduce the bug as close to the end-user experience as practical before changing code.
- If unrelated lint, type, test, flaky-test, or clear UI quality failures appear, fix them when small and safe; otherwise create a tracked issue and call it out.

## Verification

Run or recommend:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Also run targeted commands for the changed package when available. For UI, provide `agent-browser` screenshots or preview URL once previews exist; install `agent-browser@0.31.1` if missing before claiming UI verification. For backend/API/worker/DB changes, provide backend evidence snapshots as defined in `docs/process/evidence-bundles.md`. For AI, run eval smoke or cite why it is not available yet. For DB, run migration generation/check and leakage tests when applicable.

If commands fail, summarize failures and fix only relevant issues.

## Output

End with:

- Files changed.
- Behavior implemented.
- Tests added or run.
- Risks.
- What remains.
- Whether any Efe-owned gate is blocked.
