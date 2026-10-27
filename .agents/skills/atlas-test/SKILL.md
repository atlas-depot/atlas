---
name: atlas-test
description: Design or assess Atlas tests, investigate flakes, or establish regression-test sensitivity. Use for test-value and verification decisions, not automatically for every edit.
---

# Atlas test

Turn the changed contract into falsifiable evidence. Read relevant product/security decisions and discover actual commands in `docs/development.md` and manifests. This skill grants no permission to add tooling, change CI policy, call live providers or run paid models.

## Choose the failure and boundary

Start with the request, diff, affected callers and existing coverage. Name the failure being prevented and the observable result. Choose the smallest boundary that exercises it: a pure-rule unit test, real-storage integration test or focused user-flow test as appropriate. Layer proportions and coverage percentages are signals, not proof of correctness.

Use [boundary cases](references/boundary-matrix.md) only when source grounding, account isolation, credential disclosure, approval or action lifecycles are affected. The cases do not decide product policy. Ask for the missing contract when correction, retention or ambiguous-outcome behavior is unspecified rather than embedding a new decision in an assertion.

Derive expected results from agreed requirements and independently worked examples before reading implementation details where practical. If the contract is unclear, ask rather than copying the current output. Then inspect the code for boundary cases; code-aware testing is useful, but its classifier, serializer or round-trip helper must not supply its own expected answer. Keep expectation review separate from implementation review. A second agent or model can share the author's assumptions and is not independent proof.

Use unit tests for meaningful rules, not every helper. Use real-boundary integration tests for routing, persistence, account isolation and concurrent writes when those features exist. Assert exact strings and call counts only when they express the contract. Similar inputs or passing remaining tests do not establish redundancy; before removing a test, identify the lost failure mode and where it remains or why it is obsolete.

## Execute or identify the missing evidence

With no harness, provide proposed cases with trigger, expected result, enforcement point, test layer and unknowns; do not report them as passed. With a harness, run focused cases and applicable required checks. State which storage/provider/model boundaries are mocked. Injecting an identity or a null authentication result tests downstream handling, not cookie/JWT verification. Schema tests do not establish HTTP enforcement or database isolation. A mocked model tests orchestration, not live answer quality.

For an important regression, show failure without the fix and success with it where feasible. Use a targeted mutation only when critical logic or uncertain test value justifies it:

1. Work in an isolated copy of the exact candidate, including relevant uncommitted files and excluding live credentials.
2. Verify the intended fault in the diff, rebuild the mutated artifact if needed, and confirm the test ran. A harness setup failure is not detection; failure of a build/startup command being tested can be the expected regression.
3. Restore the candidate in that isolated copy and verify green. Never use broad restore/reset commands in the user's working tree.

Distinguish a real defect found by an existing test, a review finding subsequently covered by a regression test, and a deliberately injected fault. Mutation establishes sensitivity to that fault, not overall correctness or real-bug discovery. An equivalent mutation or runtime normalization may survive. Report the limit; do not manufacture proof, delete a test solely on that result, or change product semantics to bless a bug.

## Diagnose flakes and report

Inspect fixture leakage, time, randomness, environment and product races. Use isolated resources and bounded condition waits. Diagnostic repetition is useful; retry-until-green is not acceptance. Quarantine requires an owner, deadline and visible coverage gap. Preserve a reliable critical check or expose its absence instead of silently weakening a gate.

Return the contract checked, selected evidence, candidate revision, actual commands/results and remaining uncertainty. Separate designed cases, executed tests, real provider checks and model evals. Stop when the requested risks and applicable checks are covered; do not expand into an unrelated suite rewrite.
