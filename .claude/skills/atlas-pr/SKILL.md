---
name: atlas-pr
description: Prepare or update an Atlas pull request and follow its checks and review threads when requested.
---

# Atlas Pr

Read `docs/contributing.md` for branch and PR policy.

## Prepare

1. Inspect the actual branch diff, base, working tree, and existing PR before drafting.
2. Use Why, What, How, Test. Aim for at most 100 words; add only material risk or migration details.
3. Link an issue when one exists; small direct PRs do not require an issue.
4. Attach before/after evidence for changed UI, or a short recording for changed interaction.
5. For backend behavior, attach a small sanitized request/result or workflow-state example when useful.
6. Report checks actually run. Do not invent package commands, previews, or successful results.

## Follow through

When asked to make a PR ready, inspect attached checks and unresolved review threads, not only Actions.
Validate bot findings against the diff before applying fixes.
Use `gh pr checks` and `gh run view <run-id> --log-failed` when available.
Fix in-scope defects, run focused checks, and recheck the latest pushed revision.
Stop for missing authorization, unavailable credentials, or an unrelated blocker that cannot safely be fixed in scope.
Do not resolve human review decisions or merge merely because checks pass.

Opening, commenting, pushing, and merging follow the user's authorization; this skill grants none.
Return the PR link, verified checks, and any remaining blocker.
