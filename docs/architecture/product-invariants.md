# Atlas Product Invariants

These invariants must survive all implementation decisions.

Canonical architecture decision: `docs/architecture/adr-001-acting-first-eve.md`.

## Core loop

1. Capture anything.
2. Organize automatically (mostly auto-write; review only low-confidence or conflicts).
3. Ask, search, browse, or inspect memory.
4. Act: the agent proposes and executes useful work on that memory.
5. Corrections improve future memory.

## Product promises

- Users know what matters today.
- Users can act from Atlas without approval fatigue.
- Users can optionally see soft source links for “why did you suggest this?”
- Users can find where something came from when they care to look.
- MVP is single-user / single workspace. Selective sharing is post-MVP.
- External side effects that actually leave Atlas (send email, create calendar event, destructive ops) ask once before running. Drafts and internal safe writes do not.

## Hard product rules

- Atlas Postgres is the canonical memory store. Eve tools call Atlas domain services; Eve does not own a second memory database.
- Prefer outcomes over proof theater. Do not productize receipts, policy hashes, or cryptographic audit UIs.
- Soft citations (G1): show tappable source links when useful. Do not block answers behind a mandatory ungrounded gate.
- Real external writes and destructive actions require short confirmation (P1). Internal writes and external drafts may auto-run.
- Private connector secrets and OAuth tokens never go to models or logs.
- Level-4 destructive irreversible automation remains forbidden in MVP.
