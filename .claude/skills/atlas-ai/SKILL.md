---
name: atlas-ai
description: Develop or evaluate Atlas agent behavior, memory use, connector actions, and sandbox task routing with eve.
---

# Atlas Ai

Read `docs/product.md` for intended behavior and `docs/architecture.md` for runtime and memory boundaries.
Read `docs/security.md` for external-action approval and secret handling.
Consult current eve documentation before changing its integration.

## Behavior changes

1. Define the user-visible outcome and the relevant source/context.
2. Check whether eve already supplies the session, memory, task, approval, or eval capability.
3. Keep user-authored notes, connector source records, and agent working memory distinguishable.
4. Preserve source and freshness information; do not promote a model inference into a user-authored fact.
5. Enforce action permissions in backend execution, not only in prompts or a classifier.
6. For sandbox analysis, scope files and capabilities; keep connector credentials outside it.

Do not add vector storage, extraction pipelines, or a separate eval platform without a demonstrated need.

## Evals

For each changed behavior define fixture, expected outcome, and pass condition.
Start with relevant cases: approval rejection, memory correction, unsupported claims, or interrupted execution.
Use deterministic checks for prohibited actions and required transitions.
Use a model judge only when it adds a meaningful quality signal; make CI thresholds explicit.
Distinguish mocked orchestration from real-model quality and live-provider behavior.
Keep fixtures synthetic or properly redacted and record failures as regression cases.
Report the behavior tested and remaining uncertainty.
