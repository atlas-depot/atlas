# Backend Architecture

## Pattern

Use a modular monolith with domain modules, application services, repositories, and ports/adapters.

## Modules

- identity
- workspaces
- permissions
- capture
- storage
- ingestion
- parsing
- memory
- graph
- search
- chat
- suggestions
- actions
- integrations
- sharing
- audit
- okf
- evals
- observability

## API layers

- Internal typed API for the web app.
- Public REST/OpenAPI API for future mobile and external integrations.
- WebSocket or realtime adapter for bidirectional realtime events.

## Rules

- Validate every API input.
- Never trust client-provided workspace or visibility state.
- Every write must be attributable to user, AI, system, or integration.
- Every external provider call goes through an adapter.
- Every external provider adapter should have a fake/local implementation unless a tracked issue explicitly defers it.
- Every long-running job must be idempotent.
- Every action workflow must produce audit logs.
