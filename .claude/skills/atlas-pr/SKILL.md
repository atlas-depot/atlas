---
name: atlas-pr
description: Prepare or update an Atlas pull request, validate review feedback, and assess readiness against the latest revision when requested.
---

# Atlas PR

Read `docs/contributing.md` for current branch, review and merge policy. This skill does not authorize publication, commenting, settings changes or merging.

## Prepare reviewable evidence

Inspect the working tree, actual base/head diff and any existing PR. Preserve unrelated work; do not describe a local edit as pushed or an older check as evidence for a newer commit. If a product or architecture choice is unresolved, surface the choice before implementing it.

Write the body around the resulting behavior, not a file inventory:

- **Why:** Concrete problem and existing task link. Do not create an issue merely to fill this field.
- **Change:** Resulting behavior and material design choice.
- **Evidence:** Checks actually run, their results and meaningful gaps.

A few sentences usually suffice. Include migration/risk notes only when material. For visible UI changes use desktop/mobile evidence; for backend changes use a sanitized request/result or persisted transition where useful. Neither proves the other. Do not invent commands or successful tests when no harness exists.

## Follow feedback and checks

1. Record the current pushed head. Inspect required checks, relevant CI failures and unresolved review feedback; distinguish optional/informational checks from required gates.
2. Verify each bot finding against the changed code and callers. Fix an in-scope defect, explain a disproved finding with evidence when commenting is authorized, or expose an unresolved decision. A bot verdict alone is not proof.
3. Run focused verification after fixes, push only within authorization, then reread the head and check results. Old success does not clear new commits; absent, pending or unavailable required results are not green.
4. Preserve an intentional draft. Technical readiness, human approval and permission to merge are separate. Do not mark ready just because no checks exist, or create placeholder CI to manufacture readiness.

When asked to follow a PR, continue through actionable in-scope failures. Stop and report when further progress needs credentials, a human decision or work outside scope. Do not implement a draft/ready controller or change protection rules merely to prepare a PR.

## Return control

Return the PR link, verified revision, actual verification and remaining decisions. Required review comes from another eligible human CODEOWNER; bot approval cannot substitute for it. Efe retains the final merge decision. Green checks or a review request never authorize an agent to merge.
