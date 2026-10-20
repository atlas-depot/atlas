# Parallel work and dependent PRs

Use this procedure when tasks need separate local workspaces or a child needs code from an unmerged parent. [Contribution policy](../contributing.md) defines draft status, review and merge authority. Agree on the shared contract first; do not use a stack to settle an unresolved product decision implicitly.

The branch names below are examples, not existing Atlas branches. Substitute the agreed names and run commands one at a time, stopping on unexpected output or failure. Inspect `git status --short --branch`, `git remote -v` and `git worktree list` first. Preserve existing work; do not force checkout or remove a worktree containing uncommitted or unpushed changes.

## Start a workspace

Independent work starts from fetched `main`:

```sh
git fetch origin
git worktree add -b feat/task-21 ../atlas-task-21 origin/main
```

For a child of an agreed parent branch, record the exact parent boundary locally and in the child PR body. This boundary must be retained even if the parent branch is later deleted or rewritten:

```sh
git fetch origin
parent_sha=$(git rev-parse origin/feat/task-17)
git worktree add -b feat/task-22 ../atlas-task-22 "$parent_sha"
git -C ../atlas-task-22 update-ref refs/atlas-bases/task-22 "$parent_sha"
```

Work in the new directory, commit only the child's changes, and publish within the requested scope. Open the child PR against `feat/task-17`, with its parent PR link, `parent_sha`, agreed interface and outstanding dependency. Review that incremental diff while the parent is still open. Do not merge the child into the parent branch.

Each branch has one owner. Coordinate before changing a shared branch's history. Worktrees share Git objects and refs; changing a ref can affect another worktree. Give concurrently running apps separate ports and test resources, and obtain development configuration through the documented setup rather than copying secrets between directories.

## Update the parent boundary or move to main

Do this from the child's clean worktree after publishing its current commits. For an unpublished child, omit the remote lease steps and retain a local backup instead. If the child contains merge commits or unrelated commits, inspect its history and choose a reviewed transplant plan rather than applying this linear example blindly.

Fetch and compare the local child with its remote. The equality check below must succeed; otherwise reconcile the difference with its owner before rewriting. Keep the expected remote SHA fixed throughout the operation:

```sh
git fetch origin
old_parent=$(git rev-parse refs/atlas-bases/task-22)
old_child=$(git rev-parse HEAD)
expected_remote=$(git rev-parse origin/feat/task-22)
test "$old_child" = "$expected_remote"
git merge-base --is-ancestor "$old_parent" "$old_child"
git log --oneline "$old_parent..$old_child"
git branch backup/task-22-before-restack "$old_child"
```

Choose a new backup name if that one already exists; do not overwrite it. Confirm that the displayed range contains only the child's work. If the boundary ref is missing, recover the recorded SHA from the PR and verify it against the child history; do not substitute the parent's current tip.

After confirming that the parent PR merged, use fetched `main` as the new base. To incorporate a parent update before merge, use `origin/feat/task-17` instead and retain the child PR's parent base and reassess review readiness against the updated contract:

```sh
new_base=$(git rev-parse origin/main)
git rebase --onto "$new_base" "$old_parent"
git range-diff "$old_parent..$old_child" "$new_base..HEAD"
git diff "$new_base...HEAD"
```

Resolve conflicts against the agreed behavior, then `git rebase --continue`; use `git rebase --abort` if the resolution is unclear. A squash or rebase merge can replace the parent's commit identities. The recorded boundary excludes those old parent commits from the replay; a plain rebase or merely changing the PR base may include them again.

Inspect the comparison, run the child's relevant checks against the resulting candidate, and record actual results. Publish only after verification, using the previously captured SHA so a concurrent push makes the operation fail instead of being overwritten:

```sh
git push --force-with-lease="refs/heads/feat/task-22:$expected_remote" origin HEAD:refs/heads/feat/task-22
git update-ref refs/atlas-bases/task-22 "$new_base" "$old_parent"
```

If the lease fails, inspect the remote update with the owner. Do not refresh the expected SHA merely to force the push through. After a successful push, verify the remote head and update the recorded boundary in the PR. For a merged parent, retarget the child PR to `main`; inspect its displayed diff, check results and review state again. Resolve stale evidence and verify approval for the final candidate before merging. Keep backup refs and parent boundaries until dependents no longer need them; remove worktrees only after verifying the work is safely retained.

References: [Git worktree](https://git-scm.com/docs/git-worktree), [transplanting commits with rebase](https://git-scm.com/docs/git-rebase#_transplanting_a_topic_branch_with_onto).
