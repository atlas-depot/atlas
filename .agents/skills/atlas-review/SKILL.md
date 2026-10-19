---
name: atlas-review
description: Independently investigate an Atlas diff or PR for actionable defects, or re-review a specific fix. Use atlas-resolve-review when acting as the author responding to feedback.
---

# Review an Atlas change

Read [contribution policy](../../../docs/contributing.md) for finding formats, evidence and approval criteria. Consult product/architecture decisions when the changed contract needs them, and security guidance for identity, credentials, data access or external effects. Reading a PR does not authorize posting a review.

## Establish scope before judging

Record actual base/head SHAs and the issue's agreed behavior. Inspect the diff and nearby implementation, then trace affected callers and tests. For a stacked PR, assess its child delta against the parent and identify assumptions inherited from that parent; final integration needs verification against main.

Use the diff to select risk paths rather than applying every checklist to every change. Trace an input through validation, state changes and outputs. At changed boundaries, ask which invariant a caller relies on and where it is enforced. Include failure/retry paths when they can alter the result. Read the existing test's assertions, not just its name or passing status.

## Try to disprove each concern

For a suspected defect, identify a reachable trigger and observable consequence. Check callers, guards and accepted decisions for evidence that invalidates it. Use a focused reproduction when it would resolve uncertainty; a concrete code trace can suffice when execution is unavailable. A bot comment is a lead, not independent evidence.

Verify affected UI at desktop/mobile widths and with keyboard interaction under the policy. For backend changes, inspect the request, persisted effect or transition; screenshots do not establish those properties. Distinguish inspection from execution, and mocks from actual storage/provider evidence.

Separate material demonstrated defects, unmet required acceptance/verification, questions and optional improvements. Use the canonical finding format only for material blockers; a real but minor defect does not automatically block merging. Identify the smallest relevant location and explain the trigger and impact instead of prescribing a broad rewrite. Do not manufacture findings to fill a quota.

## Re-review the result

If the head changes, inspect the new delta before clearing the current PR. After a fix, rerun or retrace the original failure and affected behavior. Expand scope only for new changes or evidence of regression; do not repeat an unrelated audit.

Return findings with evidence, reviewed revision, checks actually performed and material gaps. Use the clean-review format from the policy when appropriate. Stop once the scoped review is complete; posting or approval still follows the user's authorization and human-review policy.
