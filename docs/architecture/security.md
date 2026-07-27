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
- Backend-enforced single-user/workspace scope in MVP; shared-space separation when sharing ships.
- Purpose-bound disclosure before cloud LLM, OCR, crawler, Eve channel, log, screenshot, fixture, and PR artifacts.
- Private mode for sensitive items where cloud AI is restricted.

## Redaction and disclosure

Read `docs/architecture/privacy-redaction-policy.md` before changing AI, OCR, crawler, fixture, screenshot, export, Eve channel, or provider disclosure behavior.

Atlas does not redact canonical memory out of existence.
Atlas stores the full authorized memory in Postgres, then applies deterministic disclosure policy when data leaves the trusted boundary or appears in artifacts.

No model decides what is unnecessary.
The backend `DataDisclosurePolicy` decides based on actor, purpose, destination, data class, provider retention, user consent, and required capability.

The default rule is:

- Store full memory canonically when the user is authorized and the data belongs in Atlas.
- Never disclose secrets, OAuth tokens, refresh tokens, passwords, private keys, raw card data, CVV, or session material to LLMs.
- Prefer derived values or stable pseudonyms when exact values are not required.
- Rehydrate exact values only in authorized UI, approved external-action drafts, export flows, or provider calls where exact data is required.
- Audit the disclosure decision without storing withheld sensitive values.

## Permission invariants

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
