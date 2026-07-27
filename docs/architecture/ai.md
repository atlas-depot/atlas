# AI Architecture

Canonical decision: `docs/architecture/adr-001-acting-first-eve.md`.

## Acting brain

Atlas’s product AI is an **acting agent** on permissioned memory, not a chat wrapper around search.

- Runtime: [Eve](https://eve.dev/) in `apps/agent`.
- Web client: `useEveAgent` from `apps/web` (rewrite/proxy to `apps/agent`).
- Tools: typed TypeScript tools that call Atlas domain services (memory, search, suggestions, actions, integrations).
- Skills: Eve markdown skills for procedures loaded on demand.
- Schedules: Eve schedules for proactive Today / follow-up digests.
- MVP sandbox: off (S0). No code-mode / Vercel Sandbox by default.

Model I/O still uses Vercel AI SDK primitives under Eve. Keep deterministic fake providers for tests, CI, and local development without paid secrets.

## Provider abstraction

Use ports for LLMs, embeddings, OCR, reranking, web extraction, and structured extraction.
OCR is a day-one port.
Choose the production OCR provider only after a Turkish/English fixture bakeoff covering PDFs, screenshots, invoices, and noisy images.

## Disclosure policy

AI workflows must use `docs/architecture/privacy-redaction-policy.md`.
The model does not decide what is safe to send to providers.
The backend disclosure policy decides the minimum sufficient representation for a purpose.
Planner and suggestion flows should prefer structured objects, dates, relations, statuses, soft citation IDs, and stable object IDs before raw chunks.

Do not productize disclosure as a user-facing “proof” surface.

## Ingestion pipeline

Ingestion is a **deterministic Workflow SDK pipeline**, not an Eve agent loop:

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
15. Persist objects and relations (M1: auto-write; review only low confidence / conflicts).
16. Generate dashboard suggestions / enqueue proactive Eve schedule work.
17. Emit realtime events.

Durability substrate: Vercel Workflow in production year-1; `@workflow/world-postgres` for local/self-host exit. Temporal is not the default.

## Retrieval and soft citations (G1)

- Retrieve from Atlas memory through domain services.
- Prefer useful, tappable source links on answers and action rationales.
- Do not require a hard “I do not know based on your Atlas memory” gate for every weak hit.
- Still avoid inventing private facts as if they were stored memory when nothing relevant was retrieved; say uncertainty in plain language.
- Store retrieval/tool traces for evals and debugging (operator concern, not end-user product).

## Action risk levels (P1)

- Level 0: read-only.
- Level 1: internal safe write (auto).
- Level 2: external draft (auto).
- Level 3: external write requiring short confirmation.
- Level 4: destructive or irreversible external action. Forbidden in MVP.

Map Eve tool `approval` helpers to these levels (`never` for 0–2, `always` for 3). P2 classifier-style auto-review is a later upgrade path.

Never let raw model text execute an external provider write outside a typed tool.

## Evaluation

Every AI feature needs a test set, expected behavior, failure cases, and regression checks.

Synthetic unredacted fixtures are preferred.
Real user-derived fixtures must be redacted before committing to the repo unless Efe approves an encrypted local-only development bundle.
Redaction must preserve the capability being tested through stable pseudonyms or derived values where needed.

Eval focus: useful acting, suggestion quality, tool correctness, external-write gating, leakage of connector secrets. Not receipt/proof UX.
