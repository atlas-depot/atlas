---
name: atlas-eval
description: Create or review Atlas evals for retrieval, extraction, relation linking, proactive dashboard suggestions, citation coverage, action safety, and private/shared leakage.
---

# Atlas Eval Skill

Use this skill whenever AI behavior changes.

## Required Reading

Read:

- `AGENTS.md`
- `docs/process/agent-alignment.md`
- `docs/architecture/ai.md`
- `docs/architecture/security.md`
- `docs/architecture/atlas-production-spec-and-plan.md`

## Eval categories

- Retrieval top-3 accuracy.
- Entity extraction usefulness.
- Relation extraction usefulness.
- Task/date/decision detection.
- Dashboard suggestion usefulness.
- Action risk classification.
- Citation coverage.
- “I do not know” behavior.
- Private/shared leakage.

## Required dataset minimums

- 100 mixed items.
- 50 retrieval questions.
- 30 extraction examples.
- 20 relation examples.
- 20 today-dashboard scenarios.
- 10 privacy adversarial cases.
- 10 insufficient-evidence cases.

## Workflow

1. State the behavior under test.
2. Define fixture input and expected output.
3. Include permission context.
4. Include source/citation expectations.
5. Define metric and pass threshold.
6. Add deterministic smoke test when possible.
7. Store failures as regression cases.

## Gates

- Memory-based answers require 100% citation coverage.
- Private/shared leakage tests must be zero known leakage.
- Retrieval MVP target is at least 85% top-3 on labeled questions.
- Extraction target is at least 80% useful entity/relation extraction on test items.

## Output

- Dataset shape.
- Metrics.
- Pass/fail thresholds.
- Test command.
- Regression strategy.
- Known blind spots.
