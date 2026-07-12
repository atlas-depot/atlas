# Recommended GitHub Branch Protection

Protect `main` with these settings.

## Required

- Require a pull request before merging.
- Require at least 1 approving review.
- Require review from CODEOWNERS after CODEOWNERS is configured.
- Dismiss stale approvals when new commits are pushed.
- Require status checks before merging.
- Require branches to be up to date before merging.
- Require conversation resolution before merging.
- Require linear history.
- Do not allow force pushes.
- Do not allow deletions.
- Include administrators when the team is ready.

## Required status checks

- `verify`
- Vercel preview deployment check when enabled

## Merge strategy

Use squash merge or rebase merge. Avoid merge commits on `main`.
