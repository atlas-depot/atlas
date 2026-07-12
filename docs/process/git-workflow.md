# Git Workflow

Atlas has phased workflow rules. Read `docs/process/solo-to-team-workflow.md` first, then apply this file for branch, commit, and merge mechanics.

## Branch names

Use:

```text
type/issue-number-short-slug
```

Examples:

```text
feat/12-capture-inbox
fix/33-relation-visibility
refactor/44-search-service
chore/51-ci-cache
```

## Commit rules

Use Conventional Commits:

```text
feat(capture): add upload staging model
fix(permissions): hide private relation edges in shared graph
test(search): add top-three retrieval fixtures
docs(adr): record pgvector decision
```

Commits must be atomic. One commit should represent one coherent idea.

Do not add an agent name as co-author in commit messages.

Do not mix:

- Formatting and behavior changes.
- Refactor and feature work.
- UI changes and database migrations.
- Tests for unrelated modules.

## Merge policy

- No direct pushes to `main`.
- Prefer squash merge or rebase merge.
- Keep `main` deployable.
- Revert broken changes fast.

During the first solo bootstrap before a GitHub repo, CI, and previews exist, Efe may use direct local commits for tiny setup/docs changes. Do not extend that exception to database, auth, permissions, AI behavior, external actions, provider choices, deployment gates, or team work.
