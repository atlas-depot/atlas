# Security and Privacy Architecture

## Privacy stance

Privacy is an architecture invariant, not a feature toggle.

## Required protections

- Least-privilege OAuth scopes.
- Secure refresh token storage with application-level encryption.
- No secrets in logs.
- No personal provider account passwords, 2FA, broad dashboard access, or production secrets shared through chat, PRs, screenshots, or local files.
- No raw payment credentials, card data, or provider admin tokens stored in Atlas Postgres.
- Audit logs for auth, sharing, AI writes, actions, and exports.
- User data export and deletion.
- Backend-enforced private/shared separation.
- Purpose-bound disclosure before cloud LLM, OCR, crawler, bot, log, screenshot, fixture, and PR artifacts.
- Private mode for sensitive items where cloud AI is restricted.

## Redaction and disclosure

`docs/architecture/privacy-redaction-policy.md` owns this policy in full.
The short version: Atlas keeps full authorized memory in Postgres and never redacts it out of existence, then the deterministic backend `DataDisclosurePolicy` decides the minimum sufficient outbound representation per actor, purpose, destination, and data class. No model decides what is unnecessary, secrets and session material never reach LLMs, and every disclosure is audited without storing the withheld values.

Read it before changing AI, OCR, crawler, fixture, screenshot, export, bot, or provider disclosure behavior.

## Permission invariants

`docs/architecture/product-invariants.md` states the product-level trust rule: private memory is never exposed through shared spaces, relation edges, summaries, search, or chat retrieval.
This file owns the enforceable detail behind it.

- Private objects are visible only to the owner unless explicitly shared.
- Shared spaces expose only selected objects.
- Relations are visible only when both endpoints are visible.
- Summaries generated from private objects cannot appear in shared spaces unless explicitly shared.
- Search, chat, graph, suggestions, exports, and notifications must all use the same permission layer.

## Prohibited

- Sending secrets or OAuth tokens to LLMs.
- Logging raw provider responses that may contain secrets.
- Requiring production provider credentials for ordinary local development.
- Handling payment method collection outside PCI-scoped provider elements or an approved vault.
- Letting AI execute destructive external actions.
- Adding public links without explicit feature design and approval.
