---
name: atlas-security
description: Review Atlas auth, OAuth, token handling, permissions, privacy, encryption, redaction, audit logs, sharing, external actions, and data export/delete behavior.
---

# Atlas Security Skill

Use this skill for security and privacy review.

## Required Reading

Read:

- `AGENTS.md`
- `docs/process/agent-alignment.md`
- `docs/architecture/security.md`
- `docs/architecture/privacy-redaction-policy.md`
- `docs/architecture/db.md`
- `docs/architecture/product-invariants.md`
- `docs/process/definition-of-done.md`
- `docs/process/provider-and-env-setup.md`

## Required checks

- Least-privilege OAuth scopes.
- Refresh tokens encrypted.
- Secrets not logged.
- Private/shared memory separation enforced server-side.
- Relation visibility checked.
- Search, chat, graph, suggestions, exports, and notifications share permission logic.
- External actions require correct approval level.
- Data export and deletion paths exist or have tracked issues.
- External provider calls use deterministic purpose-bound disclosure.
- No model decides what is unnecessary or safe to disclose.
- Secrets, OAuth tokens, refresh tokens, passwords, private keys, session material, raw card data, and CVV are never sent to LLMs.
- Stable pseudonyms or derived values are preferred when exact values are not required.
- OAuth refresh, revocation, scope changes, and token failure states are handled.
- External actions have risk level, explicit approval when required, rollback path, and audit logs.
- Shared spaces cannot infer private relation endpoints.
- Secrets do not appear in fixtures, screenshots, CI logs, or PR bodies.
- Provider secrets are scoped, Efe-owned gates are respected, and personal account passwords/2FA are never requested.
- Local development can use fake/local providers without production secrets.
- Shared dev vault access is allowed; production vault access is restricted and not part of ordinary local onboarding.
- Production behavior can be tested through normal user/test-user sessions, not production DB/storage/OAuth/provider admin secrets on local machines.
- Payment credentials and raw card data are never stored in Atlas Postgres.
- Live payment enablement requires PCI-boundary review, webhook verification, audit logs, rollback, and Efe approval.
- Real user-derived fixtures are redacted before commit unless Efe approves an encrypted local-only development bundle.

## Threat Review Surfaces

Check:

- Search results.
- Chat/RAG sources.
- Graph edges.
- Suggestions/dashboard cards.
- Shared spaces.
- Exports/OKF bundles.
- Bot/external chat responses.
- Notifications/realtime events.

## Output

```text
Security verdict: Pass | Needs changes | Blocked

Blockers:
- ...

Risks:
- ...

Recommended tests:
- ...

Follow-up issues:
- ...

Evidence checked:
- ...
```
