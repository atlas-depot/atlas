# Atlas Product Invariants

These invariants must survive all implementation decisions.

## Core loop

1. Capture anything.
2. Organize automatically.
3. Review low-confidence organization.
4. Ask, search, browse, or inspect memory.
5. Act safely.
6. Corrections improve future memory.

## Product promises

- Users know what matters today.
- Users can find where something came from.
- Users can see who, what, when, and why across memory.
- Users can share selected context without leaking private context.
- AI actions are safe, auditable, reversible where possible, and never silently destructive.

## Hard trust rules

- A memory answer without sufficient source evidence must say it does not know.
- Every AI-created memory object must have provenance.
- Every AI-created relation must have evidence or a confidence score.
- Every external write must pass action risk classification.
- Private memory is never exposed through shared spaces, relation edges, summaries, search, or chat retrieval.
