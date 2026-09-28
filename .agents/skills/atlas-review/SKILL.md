---
name: atlas-review
description: Independently review an Atlas diff or PR for actionable defects, or re-review agreed fixes without restarting an unrelated audit.
---

# Atlas review

Read `docs/contributing.md` for agreed requirements. Consult architecture/product decisions when the changed contract needs them, and `docs/security.md` when identity, data access, credentials or external effects change. Posting a review requires authorization; reading a PR does not grant it.

## Establish the reviewed artifact

Identify base and head, inspect the diff and affected callers, then compare behavior with the actual request. A bot comment or CI failure is an investigation lead, not a finding. If the head changes during review, state the reviewed revision and inspect the new delta before claiming the current PR is clear.

Trace each plausible failure through a reachable trigger to an observable consequence. Prioritize unauthorized access, data loss, duplicate effects and broken user flows when those paths change. Read nearby implementation and tests to resolve the concern before reporting it. Distinguish code inspection from executed verification and mocked behavior from real storage/provider evidence.

Use proportionate verification. UI evidence should cover the affected desktop/mobile behavior; backend evidence should reach the affected request, persisted effect or transition. Do not require unrelated audits, optional tooling or a rewrite to approve a small change.

## Report only useful findings

For a demonstrated defect:

```text
Blocking: <file:line> <reachable trigger> causes <observable impact>.
Evidence: <reproduction, failing assertion or concrete code trace>.
```

Keep independently actionable findings separate. A focused remedy is optional; do not prescribe an architectural preference as the only fix. Put unresolved questions and optional suggestions outside blocking findings. Missing mandatory verification or an unmet agreed acceptance condition can block readiness, but must not be mislabeled as a proven runtime defect.

For a clean review:

```text
No blocking findings in <scope> at <head>.
Verified: <actual checks or inspection>.
Gap: <material unverified behavior, if any>.
```

Approval means fit to merge within the assessed scope, not bug-free. Request changes for material demonstrated defects or unmet agreed requirements; taste and speculative risks are not automatic blockers. Agent review supports, but does not replace, the required human CODEOWNER review or Efe's merge decision.

## Re-review and stop

After a fix, check the original failure and directly affected behavior against the new revision. Broaden only for new changes or concrete regression evidence. Once those are addressed, stop rather than reopening unrelated preferences or repeating the full audit.
