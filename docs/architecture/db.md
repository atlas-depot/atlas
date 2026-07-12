# Database Architecture

## Canonical database

PostgreSQL is the source of truth.

## Required extensions

- pgvector for embeddings.
- pg_trgm if fuzzy search is needed.
- uuid or native generated IDs depending on chosen schema.

## Core tables

- users
- accounts
- sessions
- oauth_connections
- workspaces
- workspace_members
- memory_objects
- memory_object_versions
- sources
- files
- chunks
- embeddings
- entity_mentions
- relation_edges
- tags
- object_tags
- tasks
- events
- reminders
- decisions
- projects
- people
- conversations
- messages
- ai_runs
- suggestions
- actions
- action_runs
- approvals
- shared_spaces
- shared_space_items
- audit_logs
- okf_exports
- eval_datasets
- eval_runs

## Permission rules

- Every memory object belongs to a workspace and owner.
- Every relation edge must be filtered by endpoint visibility.
- Shared spaces must not reveal private object titles, summaries, source names, relation edges, or derived summaries.
- Permission checks belong in repositories and services, not only controllers.

## Retrieval indexes

- B-tree indexes for workspace, type, status, visibility, timestamps.
- Full-text index for lexical search.
- Vector index for embedding search.
- Composite indexes for frequent filters.

## Migration rules

- No destructive migrations without backup plan and explicit approval.
- Every migration must be reversible or have a written rollback strategy.
- Every schema change must update docs and tests.
