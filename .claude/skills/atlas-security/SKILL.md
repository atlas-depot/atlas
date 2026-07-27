---
name: atlas-security
description: Review Atlas auth, OAuth, token handling, permissions, privacy, encryption, redaction, audit logs, sharing, external actions, and data export/delete behavior. Use when a change touches auth, tokens, permissions, sharing, redaction, external actions, or export and delete paths, and before any release that changes them.
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
- MVP is single-user (R0). When sharing ships, enforce visibility server-side.
- Relation visibility checked when sharing exists.
- Search, chat, graph, suggestions, exports, and notifications share the same access logic when multi-user returns.
- External actions require correct P1 approval level (confirm real external writes; auto drafts/internal).
- Data export and deletion paths exist or have tracked issues.
- External provider calls use deterministic purpose-bound disclosure.
- No model decides what is unnecessary or safe to disclose.
- Secrets, OAuth tokens, refresh tokens, passwords, private keys, session material, raw card data, and CVV are never sent to LLMs.
- Stable pseudonyms or derived values are preferred when exact values are not required.
- OAuth refresh, revocation, scope changes, and token failure states are handled.
- Eve tools cannot bypass Atlas domain services or create a second memory store.
- Shared spaces are post-MVP; do not invent sharing UI as MVP scope.
- Secrets do not appear in fixtures, screenshots, CI logs, or PR bodies.
- Owner gates: see docs/process/agent-alignment.md, section Efe-Owned Gates.
- Local development can use fake/local providers without production secrets.
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
- Bot/external chat responses (Eve channels).
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
