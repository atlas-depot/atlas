---
name: atlas-test
description: Design or assess Atlas tests, investigate flakes, or establish regression-test sensitivity. Use for test-value and verification decisions, not automatically for every edit.
---

# Atlas test

Turn the changed contract into falsifiable evidence. Read relevant product/security decisions and discover actual commands in `docs/development.md` and manifests. This skill grants no permission to add tooling, change CI policy, call live providers or run paid models.

## Choose the failure and boundary

Start with the request, diff, affected callers and existing coverage. Name the failure being prevented and the observable result. Choose the smallest boundary that exercises it: a pure-rule unit test, real-storage integration test or focused user-flow test as appropriate. Layer proportions and coverage percentages are signals, not proof of correctness.

Use [boundary cases](references/boundary-matrix.md) only when source grounding, account isolation, approval or action lifecycles are affected. The cases do not decide product policy. Ask for the missing contract when correction, retention or ambiguous-outcome behavior is unspecified rather than embedding a new decision in an assertion.

Expected results must come from the agreed contract and independent fixtures, not the implementation's own classifier, serializer or round-trip helper. Assert exact strings and call counts only when they express the contract. A policy unit test and endpoint integration test may protect different failures. Similar inputs or passing remaining tests do not establish redundancy; before removing a test, identify the lost failure mode and where it remains or why it is obsolete.

## Execute or identify the missing evidence

With no harness, provide proposed cases with trigger, expected result, enforcement point, test layer and unknowns; do not report them as passed. With a harness, run focused cases and applicable required checks. State which storage/provider/model boundaries are mocked. A mocked model tests orchestration, not live answer quality; keep statistical evals separate from deterministic access and state assertions.

For an important regression, show failure without the fix and success with it where feasible. Use a targeted mutation only when critical logic or uncertain test value justifies it:

1. Work in an isolated copy of the exact candidate, including relevant uncommitted files and excluding live credentials.
2. Verify the intended fault in the diff, rebuild the mutated artifact if needed, and confirm the assertion ran. A compile/setup failure is not a detected behavioral fault.
3. Restore the candidate in that isolated copy and verify green. Never use broad restore/reset commands in the user's working tree.

An equivalent mutation or runtime normalization may survive. Report the limit; do not manufacture proof, delete a test solely on that result, or change product semantics to bless a bug.

## Diagnose flakes and report

Inspect fixture leakage, time, randomness, environment and product races. Use isolated resources and bounded condition waits. Diagnostic repetition is useful; retry-until-green is not acceptance. Quarantine requires an owner, deadline and visible coverage gap. Preserve a reliable critical check or expose its absence instead of silently weakening a gate.

Return the contract checked, selected evidence, candidate revision, actual commands/results and remaining uncertainty. Separate designed cases, executed tests, real provider checks and model evals. Stop when the requested risks and applicable checks are covered; do not expand into an unrelated suite rewrite.
