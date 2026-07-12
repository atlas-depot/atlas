# Privacy Redaction Policy

## Position

Atlas must not treat redaction as blanket data deletion.
The canonical memory in Postgres keeps the full authorized object, source, chunk, relation, and audit state needed for search, planning, scheduling, sharing, correction, export, and deletion.
Redaction applies to outbound disclosure, logs, screenshots, fixtures, PRs, eval artifacts, and third-party model/provider calls.

The right invariant is minimum sufficient disclosure, not maximum deletion.

## Who decides what is unnecessary

No LLM decides that data is unnecessary or safe to disclose.
The backend decides through deterministic policy code.

The policy engine must live in the domain/security layer and expose a `DataDisclosurePolicy` contract.
It evaluates:

- Actor: user, system, worker, bot, integration, or AI workflow.
- Purpose: ingestion, OCR, extraction, embedding, retrieval, answer generation, planning, suggestion, action draft, external action, export, support/debugging, eval, or screenshot.
- Destination: Atlas database, local fake provider, cloud LLM, OCR provider, crawler provider, bot platform, email/calendar provider, log sink, PR artifact, or shared space.
- Data class: public, workspace, private, sensitive, secret, payment, OAuth, credential, contact, legal, health, location, child/minor, or user-marked private mode.
- Required capability: whether the task needs exact value, derived value, stable pseudonym, relationship only, or no value.
- Provider policy: retention class, training controls, zero-data-retention availability, region, BYOK status, allowlist status, and auditability.
- User control: explicit consent, private mode, item visibility, shared-space membership, and action approval.

AI classifiers may propose sensitivity labels.
They are advisory only.
The final send/withhold decision must be deterministic and testable.

## Disclosure levels

Use a small set of explicit disclosure levels.

| Level | Name | Meaning | Examples |
| --- | --- | --- | --- |
| D0 | No disclosure | Do not send value outside Atlas-controlled storage. | OAuth tokens, refresh tokens, passwords, private keys, API keys, session cookies, card PAN/CVV. |
| D1 | Type marker only | Replace value with a typed marker. | `[API_KEY]`, `[CARD_NUMBER]`, `[PASSWORD]`, `[PRIVATE_KEY]`. |
| D2 | Derived value | Send a normalized derived fact but not the raw source. | Due date, amount bucket, domain, task status, relation type, meeting time. |
| D3 | Stable pseudonym | Send a stable handle that can be rehydrated server-side after approval. | `person_7f3a`, `company_91c2`, `document_483b`. |
| D4 | Exact value allowed | Send exact value because the purpose requires it and policy allows it. | Email recipient in an approved draft, invoice vendor name for extraction, calendar start time for a calendar draft. |
| D5 | User-approved external disclosure | Show the user what will be disclosed before an external action. | Email body, calendar invite, shared-space object, exported bundle. |

## Default data classes

These are deny-by-default for cloud LLM disclosure:

- Secrets: passwords, private keys, API keys, OAuth tokens, refresh tokens, recovery codes, seed phrases.
- Payment credentials: raw card numbers, CVV, payment account credentials, provider admin tokens.
- Auth/session material: session cookies, JWTs, magic links, reset links, 2FA codes.
- Highly sensitive identifiers: national IDs, passport numbers, tax IDs, bank account numbers.
- Private-mode object bodies unless the user explicitly opts into cloud processing for that object.

These are purpose-bound and may be disclosed only when required:

- Names, emails, phone numbers, handles, addresses, calendar details, invoice totals, company names, document titles, file names, message snippets, and location data.

These are usually safe as derived or structured facts:

- Task existence, deadline date, project membership, relation type, object type, confidence score, source type, status, and normalized timestamps.

## How Atlas remains proactive with redaction

Proactivity does not require sending every raw source to a cloud model.
Atlas keeps full canonical memory in Postgres behind permissions.
The proactive planner first operates on structured memory: tasks, reminders, events, waiting-on edges, projects, people, decisions, deadlines, confidence, and source provenance.

When an LLM is useful, the prompt should contain the minimum representation required for the job.
For example:

- Today planning can use task titles, due dates, project names, blockers, confidence, and source citations without sending full email bodies.
- Waiting-on detection can use relation edges and normalized participant handles before revealing exact names.
- Draft email preparation may use pseudonyms and source summaries first, then rehydrate exact recipient/body context only in the approval UI.
- Calendar planning can use availability windows, attendee handles, and constraints before revealing real attendee emails.
- Search and RAG can retrieve exact chunks only after permission filtering, then apply disclosure policy before sending those chunks to a model.

The model should return object IDs, citations, proposed actions, and missing-information questions.
The server rehydrates exact values only when rendering to the authorized user or when an approved action requires them.

## Fixture and eval policy

Use synthetic unredacted fixtures for most tests.
Use real user-derived fixtures only when synthetic data cannot measure the capability.
Real user-derived fixtures must be redacted before committing to the repo.
Unredacted real fixtures may exist only in a local-only path or encrypted development bundle approved by Efe.

Redacted fixtures must preserve utility.
For example, do not replace every person with `[PERSON]` if the relation extraction task requires distinguishing three people.
Use stable pseudonyms instead: `person_alpha`, `person_beta`, `company_delta`.

Every redaction transform used for tests must be deterministic and snapshot-tested.
Each fixture should declare the intended capability it measures.

## Provider policy

Provider privacy promises are not a substitute for data minimization.
Even when a provider does not train on API data, the policy must account for retention, abuse monitoring, routing, subprocessors, logs, legal discovery, and accidental disclosure through prompts or traces.

For sensitive model calls, prefer providers and gateway settings that support zero data retention or equivalent controls.
If no compliant provider is available for the requested model/task, either downgrade capability, ask for explicit approval, or run a private/local fallback.

## Audit requirements

For every AI/provider disclosure, store:

- Disclosure policy version.
- Purpose.
- Destination provider and route.
- Data classes included.
- Data classes withheld.
- Source object IDs and chunk IDs.
- Whether exact values, derived values, or pseudonyms were sent.
- User approval ID when applicable.
- Provider retention mode when known.

Do not store withheld sensitive values in the audit record.

## Required tests

- Secrets are never sent to LLM/OCR/crawler providers.
- Private-mode objects are excluded from cloud processing unless explicitly approved.
- Shared spaces cannot infer private objects through redacted relations.
- Pseudonymized prompts can still produce useful planning outputs.
- Approval UI shows exact external disclosure before Level 2 or Level 3 actions.
- Redaction snapshots are deterministic.
- Evals measure both privacy leakage and task usefulness.
