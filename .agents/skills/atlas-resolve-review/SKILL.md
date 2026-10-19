---
name: atlas-resolve-review
description: Triage and address feedback on an Atlas PR, verify fixes, and report or resolve review conversations when authorized. Use for author-side feedback handling, not an independent initial review.
---

# Address PR review feedback

Read [contribution policy](../../../docs/contributing.md). A request to inspect feedback is read-only; use the user's existing authorization for fixes, pushes, replies and thread resolution. Do not infer permission to merge or change protection settings.

## Recover the conversation and candidate

Record the current pushed head and base. Fetch review threads with replies, resolution state, review decisions and current check results; paginate if necessary. Read prior human decisions before acting on a bot summary. An outdated line location does not prove the concern is fixed, and an earlier green run does not cover a new commit.

Group duplicate reports by underlying concern. For each actionable concern, identify its claim and classify it as a defect, unmet acceptance/verification requirement, question, optional suggestion, or disproved/stale report. Keep a small working ledger of thread link, disposition and evidence so no conversation disappears between iterations.

## Decide from evidence, then change

Inspect the current code and affected callers; reproduce or trace the claimed behavior. Check whether the requested change would reverse an accepted contract. For example, a bot calling Zod premature does not supersede a recorded team decision to use it. If the evidence leaves a product or policy choice unresolved, ask the owner instead of quietly accepting the suggestion.

Fix valid in-scope defects at their cause. Use focused verification that distinguishes the original failure from the fix, plus applicable required checks. Test design cases are not executed results. Keep optional unrelated cleanup out of the repair. For uncertain test sensitivity or flakes, use `atlas-test`.

## Close the loop without hiding uncertainty

After an authorized push, verify the remote head and associate the checks with that revision. When replies are authorized, answer the affected thread with the disposition, relevant commit and concrete evidence or remaining question. Do not post repeated acknowledgments while a check is unchanged.

Resolve a conversation only when resolution is authorized and its concern is demonstrably addressed, or the reviewer has accepted the evidence that it is inapplicable. Leave unanswered questions and contested conclusions open. A resolved thread is not human approval, successful CI or permission to merge.

Recheck the original failure and new delta; fix further actionable in-scope findings. Stop when the requested scope is handled, or report the specific human decision, credential or unavailable check that prevents progress. Use bounded waits for external checks; do not retry failures until green or keep polling unchanged state indefinitely.

Return the current revision, disposition of remaining concerns, actual verification and required human action. Do not describe the PR as merge-ready while a required gate is missing.
