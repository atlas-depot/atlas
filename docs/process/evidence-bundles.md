# Evidence Bundles

Status: operating standard  
Audience: teammates and AI coding agents

Atlas PRs should preserve proof, not just claims. UI work uses screenshots. Backend work uses snapshots of contracts, requests, database state, events, logs, traces, and workflow state.

## Principle

For meaningful behavior changes, capture before/after evidence when practical.

The goal is not bureaucracy. The goal is to make PRs reviewable, demos repeatable, regressions diagnosable, and senior project work defensible.

## Frontend Evidence

Frontend evidence is visual and interaction-focused.

Use `agent-browser`:

```bash
agent-browser open <local-or-preview-url>
agent-browser wait --load networkidle
agent-browser screenshot artifacts/screenshots/<slug>-before.png --full
agent-browser screenshot artifacts/screenshots/<slug>-after.png --full
agent-browser screenshot artifacts/screenshots/<slug>-annotated.png --annotate
agent-browser snapshot -i
```

Capture:

- Before screenshot when changing existing UI.
- After screenshot.
- Annotated screenshot for interaction-heavy UI.
- Desktop and mobile when layout/responsiveness changes.
- Snapshot text when accessibility/interaction refs matter.

## Backend Evidence

Backend evidence is state and contract-focused.

Use the smallest reproducible surface:

- HTTP request/response snapshot.
- API contract/schema diff.
- Database row/query snapshot.
- Audit log snapshot.
- Domain event/realtime event snapshot.
- Background job/workflow state snapshot.
- Error/log/trace excerpt with secrets redacted.
- Migration before/after schema snapshot.
- Queue or idempotency-key state snapshot.

Do not store secrets, OAuth tokens, raw private user data, or unredacted sensitive memory in evidence artifacts.

## Backend Snapshot Examples

HTTP:

```bash
curl -sS -X POST http://localhost:3000/api/v1/captures \
  -H 'content-type: application/json' \
  --data @fixtures/capture-note.json \
  | jq '.' > artifacts/backend/capture-create-after.json
```

Database:

```bash
psql "$DATABASE_URL" \
  -c "select stable_id,type,visibility,status from memory_objects order by created_at desc limit 5;" \
  > artifacts/backend/memory-objects-after.txt
```

Audit log:

```bash
psql "$DATABASE_URL" \
  -c "select action,actor_user_id,resource_type,created_at from audit_logs order by created_at desc limit 10;" \
  > artifacts/backend/audit-log-after.txt
```

Workflow/job:

```bash
pnpm worker:jobs:list --json > artifacts/backend/jobs-after.json
```

Use actual repo commands once the app scaffold defines them.

## Suggested Layout

Artifacts should be easy to inspect and safe to attach to PRs.

```text
artifacts/
  screenshots/
    <route>-before.png
    <route>-after.png
    <route>-annotated.png
  backend/
    <feature>-request.json
    <feature>-response-before.json
    <feature>-response-after.json
    <feature>-db-before.txt
    <feature>-db-after.txt
    <feature>-audit-after.txt
    <feature>-trace.txt
```

If artifacts contain sensitive data, do not commit them. Summarize sanitized excerpts in the PR instead.

## PR Requirement

For UI/frontend PRs:

- Include screenshots or explain why the UI did not change.
- Use `agent-browser` unless installation/tooling is blocked.

For backend/API/worker/DB PRs:

- Include at least one behavior evidence artifact or command output summary.
- Prefer before/after snapshots for changed behavior.
- Include audit/event evidence when the change writes memory, permissions, actions, sharing, OAuth, ingestion, or exports.
- Include failure-case evidence for permission/security fixes.

## Review Rule

Reviewers should ask:

- What changed?
- What evidence proves it changed?
- What evidence proves it did not leak private data or break an invariant?
- Can the evidence be reproduced from a command?
