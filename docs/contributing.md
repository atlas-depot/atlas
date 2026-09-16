# Contributing

Use the branch flow below. GitHub checks and human review are separate gates; Vercel deployments require their own setup.

## Branches and releases

- Open normal feature branches from `dev` and target PRs at `dev`.
- Review individual changes in PR previews; validate combined behavior in the `dev` staging environment.
- Release through a `dev` to `main` PR. Preserve branch ancestry for this release merge.
- A production hotfix must also be brought back into `dev`.
- Protect `dev` and `main` against direct pushes with checks appropriate to the current repository. The owner chooses a backup release maintainer.

Both branches require the automated `verify` check and one teammate approval. Admin bypass remains available to the owner. CODEOWNER approval is not mandatory until domain owners and backups are assigned at the team meeting. Keep the owner, domain owner, and backup on the same CODEOWNERS pattern; any one eligible owner can satisfy GitHub's owner-review requirement.

Do not claim a deployment unless its actual result is verified.

## Issues

Use issues only for task assignment. Raise newly noticed bugs in the team WhatsApp group or open a direct PR for an understood fix. Turn work into an assigned issue when the team needs to coordinate ownership. The owner curates the backlog; Discussions stay disabled.

## Pull requests

Keep one reviewable change per PR. Use atomic Conventional Commits without AI co-author or generated-by footers. Never commit secrets or unrelated local edits.

The normal body should fit within 100 words:

```text
Why: The user-visible problem.
What: The resulting behavior.
How: The important implementation choice.
Test: What actually ran and what remains unverified.
```

Add a brief migration, risk, or rollback note only when needed. For visual changes, attach before/after screenshots; use a short recording for behavior that still images cannot show. Browser evidence can be captured with agent-browser. Check mobile width and keyboard interaction. Do not demand screenshots for nonvisual changes.

Do not repeat the diff as a file list, paste command logs, or add a long academic reflection to every PR. Record school evidence in [project-log.md](project-log.md).

## Review and completion

Check the actual failure mode, authorization boundaries, and affected callers. Run checks relevant to the change; separate executed tests from proposed tests and live provider results from mocks. Never call an untested path complete. Avoid speculative architecture changes disguised as cleanup.

A contributor should be able to explain the data flow, key decision, and evidence for their change. For team-level UI/backend choices, present a small proposal before implementation. Framework tutorials and generic coding advice do not belong in every PR or skill.
