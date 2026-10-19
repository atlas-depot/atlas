---
name: atlas-pr
description: Prepare, open or update an Atlas PR from an existing change, including verifying its diff, publication and readiness. Use atlas-resolve-review for handling review feedback.
---

# Prepare an Atlas PR

Read [contribution policy](../../../docs/contributing.md) and the repository PR template. Follow existing authorization; preparing a draft body does not authorize publication or merging.

## Identify the candidate

Inspect status, staged and unstaged changes, current branch, remote and existing PRs for that branch. Read the issue and relevant decisions. Record base/head SHAs and inspect the three-dot diff against the actual PR base, plus local changes not yet committed. A branch name alone does not identify the reviewed artifact.

Check that the diff solves the agreed task and contains only intended files. Look for generated churn, credentials, unrelated edits and missing callers. Stage explicit files or hunks. If the change cannot be explained as one reviewable outcome, separate it before publication without discarding local work.

For dependent work, follow [parallel work](../../../docs/process/parallel-work.md) before choosing the base or rewriting history. Do not silently compare a child branch against main while describing only its child delta.

## Build the evidence and description

Find commands in the real manifest and development guide. Select verification from the changed behavior and the policy's evidence requirements, including desktop, mobile and keyboard for visible UI. Record commands, results and the candidate they exercised. No harness means a stated gap, not a green check.

Write the template fields from the final change. Lead with the user's observable problem, then explain the behavior and any material tradeoff. Include only evidence needed to assess this candidate; link detailed artifacts instead of pasting logs. If scope changes, rewrite the title/body rather than appending a conversation history.

## Publish and verify

When publication is authorized, check whether a PR already exists before creating one. Use the exact intended remote, head and base; use a body file or structured argument to preserve Markdown. Keep an incomplete or dependency-blocked candidate draft under the contribution policy.

After pushing, reread the remote SHA and PR base/head. Confirm the published diff and description match the candidate. Local commits, a push and a PR creation are different outcomes. Inspect current required checks and review status; missing, pending or unavailable checks are not successful checks. Re-check the delta if another push changes the head.

Return the PR URL, verified revision, actual evidence and remaining readiness gaps. For review feedback, use `atlas-resolve-review`; do not start a second independent review loop here.
