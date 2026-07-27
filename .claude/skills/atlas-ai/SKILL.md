---
name: atlas-ai
description: Design, implement, or review Atlas AI workflows and evals: Eve acting agent, ingestion, extraction, soft citations, memory writes, suggestions, action risk levels, prompt versioning, and provider abstraction. Use when building or reviewing AI pipelines, Eve tools/schedules, designing or reviewing retrieval/extraction/privacy/action-safety evals, or setting eval datasets and pass gates.
---

# Atlas AI Skill

Use this skill for AI architecture, implementation, and review.

## Required Reading

Read:

- `AGENTS.md`
- `docs/process/agent-alignment.md`
- `docs/architecture/ai.md`
- `docs/architecture/security.md`
- `docs/architecture/privacy-redaction-policy.md`
- `docs/architecture/db.md`
- `docs/architecture/atlas-production-spec-and-plan.md`
- `docs/process/provider-and-env-setup.md`

If the work changes external providers, verify current official docs before implementation.
If the work needs real model/OCR/crawler credentials, use the provider request protocol in `docs/process/provider-and-env-setup.md` instead of assuming local secrets exist.

## Required AI rules

- Prefer soft source links on answers/actions (G1).
- Say uncertainty plainly when nothing relevant was retrieved; do not invent private memory facts.
- Use structured outputs for extraction.
- Validate outputs before writes.
- Gate real external writes with P1 short confirmation; auto-run internal writes and drafts.
- Fake model/OCR/crawler adapters must exist for local tests and ordinary development.
- Eve in `apps/agent` is the acting runtime; tools call Atlas domain services only.
- No sandbox/code-mode default in MVP (S0).
- Workflow SDK for durable ingestion and Eve sessions; not Temporal by default.
- OCR is a day-one ingestion capability behind `OCRPort`.
- Choose the production OCR provider only after a fixture bakeoff covering Turkish, English, screenshots, PDFs, invoices, and noisy images.
- Disclosure and redaction before external provider calls: see /atlas-security.

## Ingestion pipeline

Capture, parse, OCR, normalize, chunk, embed, extract entities, extract relations, classify, summarize, detect tasks, link objects, persist, create review cards, create suggestions.

## RAG Pipeline

1. Resolve user/workspace access.
2. Apply permission filter first.
3. Apply structured filters.
4. Run full-text and vector retrieval.
5. Merge/dedupe/rerank if configured.
6. Select citation chunks.
7. Generate grounded answer.
8. Prefer soft source links when useful. If nothing relevant was retrieved, say so plainly.
9. Persist retrieval trace for eval/debugging.

## Action Risk Rules

- Level 0: read-only retrieval.
- Level 1: internal safe write.
- Level 2: draft external action.
- Level 3: external write requiring short confirmation (P1).
- Level 4: destructive/irreversible external action, forbidden in MVP.

Never let model output execute an external action directly.

## Evals

Design or review evals whenever AI behavior changes. Read `docs/architecture/ai.md` and `docs/architecture/security.md` for eval context.

Eval categories:

- Retrieval top-3 accuracy.
- Entity extraction usefulness.
- Relation extraction usefulness.
- Task/date/decision detection.
- Dashboard suggestion usefulness.
- Action risk classification.
- Citation coverage.
- Soft citation usefulness and invented-memory failures.
- Private/shared leakage.

Required dataset minimums:

- 100 mixed items.
- 50 retrieval questions.
- 30 extraction examples.
- 20 relation examples.
- 20 today-dashboard scenarios.
- 10 privacy adversarial cases.
- 10 insufficient-evidence cases.

Eval workflow:

1. State the behavior under test.
2. Define fixture input and expected output.
3. Include permission context.
4. Include source/citation expectations.
5. Define metric and pass threshold.
6. Add deterministic smoke test when possible.
7. Store failures as regression cases.

Gates:

- Memory-based answers require 100% citation coverage.
- Private/shared leakage tests must be zero known leakage.
- Retrieval MVP target is at least 85% top-3 on labeled questions.
- Extraction target is at least 80% useful entity/relation extraction on test items.

Eval output: dataset shape, metrics, pass/fail thresholds, test command, regression strategy, known blind spots.

## Output

Include schemas, prompts or prompt requirements, failure modes, eval plan, and observability.

Also include:

- Permission filtering point.
- Citation contract.
- Memory write/versioning behavior.
- Rollback or correction path.
- Disclosure policy, redaction mode, and privacy eval coverage.
