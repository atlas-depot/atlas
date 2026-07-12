# Contributing

## Required contribution flow

Use `docs/process/solo-to-team-workflow.md` to decide whether the current phase allows a lighter solo path. Once CI and previews exist, use the normal PR flow below.

1. Pick or create an issue.
2. Clarify acceptance criteria.
3. Create a branch from `main`.
4. Commit atomically.
5. Open a draft PR early if the work is complex.
6. Keep the PR small.
7. Fill the PR template fully.
8. Pass CI.
9. Request review.
10. Merge only after approval.

## Every PR must explain

- What changed.
- Why it changed.
- How it was implemented.
- How it was tested.
- What risks remain.
- What the author learned and can explain in the senior project defense.

## No silent architecture drift

Changes to stack, architecture, database schema, permission model, AI pipeline, action safety model, or deployment must include an ADR or RFC.

Provider/env changes must update `.env.example`, `docs/process/provider-and-env-setup.md`, fake/local provider behavior, and doctor/env checks. Ordinary local development must not require production credentials.

All contributions must follow `docs/process/engineering-standards.md`.
Prefer quality, simplicity, robustness, scalability, security, and long-term maintainability over development cost.
Do not manually edit generated files or `CHANGELOG.md`.
Do not add agent co-authors to commit messages.
Do not ignore lint, type, test, flaky-test, or clear UI failures.

## Bootstrap leadership

Efe Baran Durmaz is the bootstrap lead and product owner. Provider accounts, production secrets, compliance-sensitive setup, real eval data, production domain, and final visual identity are Efe-owned gates unless explicitly delegated. Contributors and agents should bring options and recommendations, not make those choices silently. Do not request or share Efe's personal provider passwords, 2FA, or broad production dashboard access.
