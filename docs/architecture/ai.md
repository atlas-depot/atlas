# AI Architecture

## Provider abstraction

Use a provider interface for LLMs, embeddings, OCR, reranking, web extraction, and structured extraction.
Use Vercel AI SDK with OpenAI-compatible real providers behind adapters.
Keep deterministic fake providers for tests, CI, eval fixtures, and local development without paid secrets.
OCR is a day-one port.
Choose the production OCR provider only after a Turkish/English fixture bakeoff covering PDFs, screenshots, invoices, and noisy images.

## Disclosure policy

AI workflows must use `docs/architecture/privacy-redaction-policy.md`.
The model does not decide what is safe or unnecessary to disclose.
The backend disclosure policy decides what exact values, derived values, pseudonyms, or markers can be sent for a given purpose and destination.

The canonical memory object may contain exact values.
The prompt sent to a model should contain the minimum sufficient representation for the task.
Planner and suggestion workflows should operate on structured objects, dates, relations, statuses, citations, and stable object IDs before asking a model to read raw chunks.

## Ingestion pipeline

1. Capture received.
2. Store raw source.
3. Parse text and metadata.
4. OCR when needed.
5. Normalize content.
6. Chunk content.
7. Create embeddings.
8. Extract entities.
9. Extract relation candidates.
10. Classify object types.
11. Generate summaries.
12. Detect tasks, decisions, dates, waiting items, and follow-ups.
13. Link to existing objects.
14. Compute confidence.
15. Persist objects and relations.
16. Create review cards when confidence is low.
17. Generate dashboard suggestions.
18. Emit realtime events.

## RAG rules

- Always permission-filter before retrieval.
- Use hybrid search: filters, full-text, vectors, reranking when available.
- Cite source memory objects and chunks.
- If evidence is insufficient, say so.
- Store retrieval traces for evals.
- Apply disclosure policy before sending retrieved chunks to a model.

## Action risk levels

- Level 0: read-only.
- Level 1: internal safe write.
- Level 2: external draft.
- Level 3: external write requiring explicit confirmation.
- Level 4: destructive or irreversible external action. Forbidden in MVP.

## Evaluation

Every AI feature needs a test set, expected behavior, failure cases, and regression checks.

Synthetic unredacted fixtures are preferred.
Real user-derived fixtures must be redacted before committing to the repo unless Efe approves an encrypted local-only development bundle.
Redaction must preserve the capability being tested through stable pseudonyms or derived values where needed.
