# Security boundaries

These are implementation requirements, not a claim that controls already exist. Apply them to the first real account integration and test them with synthetic fixtures.

## User and source access

Authenticate every backend operation and derive user scope from the trusted session, not a model-supplied user ID. Personal workspaces still need cross-user isolation when several people use Atlas. Enforce access before retrieval and again before action execution.

Apply the same scope to notes, files, memory, search, source links, relations, notifications, exports, and tool results. A relation must not reveal an inaccessible endpoint. Shared workspaces and public links require explicit design before introduction.

Keep user-authored content, source facts, and AI inferences distinguishable. Preserve relevant source IDs and timestamps. Corrections, deletion, and account disconnection must define what happens to derived summaries and memory; removing a connector is not automatically deletion of every imported record.

## Actions and approvals

Backend policy authorizes execution. Tool names, a prompt, or an LLM classifier are not permission controls. Treat external content as data, never as instructions granting access.

- Analysis and local drafts may run within the user's granted scope.
- Sends, calendar changes, destructive or binding operations require confirmation of their exact target and content.
- Bind approval to the user, account, operation, and arguments. Changed arguments or expired authority require a new decision.
- Check permissions again after an approval wait; credentials or access may have changed.
- Use stable attempt identities and provider idempotency where supported. On a timeout, reconcile the provider outcome before retrying a write.
- Record requested, approved, attempted, succeeded, failed, and unknown outcomes honestly. An accepted API request is not proof of delivery.

## Credentials and disclosure

Use least-privilege OAuth scopes and protected token storage with encryption and restricted backend access. Implement revocation and refresh through the chosen connector. Never expose access/refresh tokens, passwords, API keys, session cookies, or recovery secrets to model context, browser bundles, logs, screenshots, fixtures, or exports.

Send providers only the content needed for the requested task. Enforce disclosure rules in backend code; a model's sensitivity classification is advisory. Review provider retention and routing settings before sending real private data. Do not promise private/local processing while calling a cloud model.

Use synthetic fixtures by default. Redact real artifacts before sharing; keep stable pseudonyms when relationships matter to a test. Avoid raw provider-response logging. Audit records should identify actions and outcomes without duplicating secrets or unnecessary private content.

## Sandbox

Run scripts, conversion, and analysis in an isolated environment with explicit time, memory, and cost bounds. Give it only the files needed for the task. Do not transfer connector credentials, production secrets, or authenticated personal browser sessions.

Enforce network policy outside the model. If the selected adapter cannot restrict egress, do not use it for confidential source files until that limitation is resolved. Keep external connector actions behind the normal authorization/approval path. Persist intended output files before disposing of compute; the sandbox filesystem is not authoritative memory.

## Minimum behavioral checks

- One user cannot retrieve another user's source, memory, or action result.
- Rejected or mismatched approvals cannot execute writes.
- Interrupted/replayed operations cannot silently duplicate external effects.
- Connector secrets do not appear in prompts or observable artifacts.
- Disconnect/revocation prevents new unauthorized calls.
- Source deletion has tested behavior for derived content and exports.

Use eve evals where appropriate, plus backend tests for controls that must hold independently of model behavior.
