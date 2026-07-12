---
name: atlas-db
description: Design, implement, or review Atlas Postgres schema, migrations, pgvector retrieval tables, full-text search, permissions, relation visibility, indexes, and data integrity.
---

# Atlas DB Skill

Use this skill for schema, migrations, queries, permissions, indexes, and retrieval storage.

## Required Reading

Read:

- `AGENTS.md`
- `docs/process/agent-alignment.md`
- `docs/architecture/db.md`
- `docs/architecture/security.md`
- `docs/architecture/repository-structure.md`
- `docs/architecture/technical-decisions.md`

## Non-negotiables

- Postgres is canonical.
- pgvector is MVP vector search.
- Permissions must be enforceable at query/service level.
- Every memory object needs provenance.
- Every relation edge needs visibility logic.
- Destructive migrations require explicit approval.
- OKF is export/import only, not transactional storage.
- pgvector stays MVP vector search unless measured limits prove otherwise.
- Relations use explicit typed directed edges, not opaque graph blobs.
- Deterministic seeds must exist for local development, demos, leakage tests, and eval fixtures.
- Do not use anonymized production dumps until a privacy process exists.

## Migration Workflow

1. State schema intent and tables touched.
2. Check backward compatibility and data preservation.
3. Add indexes for workspace, visibility, type, status, source, timestamps, relation endpoints, tsvector, and vector search as needed.
4. Add repository/query tests.
5. Add private/shared leakage fixtures when visibility changes.
6. Update deterministic seed data when schema changes affect local/demo/eval workflows.
7. Document rollback or forward-fix plan.

Never hide destructive data changes in a feature PR.

## Review checklist

- Is the schema normalized enough for integrity?
- Are JSONB fields used intentionally, not as a lazy schema escape?
- Are workspace and visibility filters indexed?
- Are vector and full-text search strategies compatible?
- Are relation edges typed and auditable?
- Are migrations safe and reversible?
- Are tests covering private/shared leakage?
- Do embeddings/chunks/sources preserve provenance?
- Can export/delete flows find all related data?

## Output

Provide:

- Schema changes.
- Query implications.
- Indexes.
- Migration plan.
- Rollback plan.
- Tests.
- Leakage risk assessment.
