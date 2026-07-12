---
name: atlas-ai
description: Design, implement, or review Atlas AI workflows for ingestion, extraction, RAG, citations, memory writes, suggestions, action risk levels, prompt versioning, provider abstraction, and evals.
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
- `.claude/skills/atlas-eval/SKILL.md`

If the work changes external providers, verify current official docs before implementation.
If the work needs real model/OCR/crawler credentials, use the provider request protocol in `docs/process/provider-and-env-setup.md` instead of assuming local secrets exist.

## Required AI rules

- Permission-filter before retrieval.
- Ground memory answers in sources.
- Say “I do not know based on your Atlas memory” when evidence is insufficient.
- Use structured outputs for extraction.
- Validate outputs before writes.
- Store AI run metadata.
- Make memory writes auditable and reversible where possible.
- Gate external actions by risk level.
- Store prompt version, model, input source IDs, output JSON, validation errors, created objects, and created relations for extraction runs.
- Separate user-visible answers from internal traces.
- Fake model/OCR/crawler adapters must exist for local tests and ordinary development.
- OCR is a day-one ingestion capability behind `OCRPort`.
- Choose the production OCR provider only after a fixture bakeoff covering Turkish, English, screenshots, PDFs, invoices, and noisy images.
- Apply deterministic disclosure policy before sending chunks, prompts, screenshots, fixtures, or raw source excerpts to external providers.
- Do not let a model decide what is unnecessary or safe to disclose.
- Prefer structured facts, source IDs, derived values, and stable pseudonyms before exact raw text when the task permits it.

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
8. If evidence is insufficient, answer exactly: `I do not know based on your Atlas memory.`
9. Persist retrieval trace for eval/debugging.

## Action Risk Rules

- Level 0: read-only retrieval.
- Level 1: internal safe write.
- Level 2: draft external action.
- Level 3: external write requiring explicit confirmation.
- Level 4: destructive/irreversible external action, forbidden in MVP.

Never let model output execute an external action directly.

## Eval requirements

- Golden retrieval questions.
- Extraction examples.
- Relation examples.
- “What should I do today?” scenarios.
- Private/shared adversarial tests.
- “I do not know” tests.

## Output

Include schemas, prompts or prompt requirements, failure modes, eval plan, and observability.

Also include:

- Permission filtering point.
- Citation contract.
- Memory write/versioning behavior.
- Rollback or correction path.
- Disclosure policy, redaction mode, and privacy eval coverage.
