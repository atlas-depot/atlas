---
name: atlas-security
description: Review or implement Atlas authorization, OAuth lifecycle, secret isolation, deletion, and external-action safeguards.
---

# Atlas Security

Read `docs/security.md` for the current policy and `docs/architecture.md` for affected boundaries.
Apply this to a concrete sensitive path; do not demand a full audit for unrelated edits.

## Trace the boundary

1. Identify the acting user, connected account, operation, and accessible data.
2. Verify server-side ownership checks on reads and writes, including tool calls.
3. Confirm OAuth scope, encrypted token storage, refresh, revocation, and failure handling.
4. Keep provider credentials out of model context, sandbox environments, logs, and client bundles.
5. Ensure required approval covers the actual target and payload executed.
6. Check stale approval, retry, and ambiguous provider-result behavior where applicable.
7. Verify disconnect/deletion behavior against the documented retention policy.

A single-user product experience still needs isolation between different users' accounts.
Treat connector content as untrusted input, not authorization to act.
A classifier may inform policy; it must not grant capabilities prohibited by the backend.
Do not introduce payment or shared-workspace requirements when those features are out of scope.

## Evidence

Use focused unauthorized-access, approval, or token-failure cases for changed behavior.
Keep real secrets and personal data out of fixtures and reports.
Report the specific path checked, residual risks, and verification limits.
Production credential changes and destructive operations require their existing authorization.
