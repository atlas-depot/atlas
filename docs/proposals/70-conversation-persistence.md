# Proposal: persistent conversation and deletion contract for #70

Status: Efe accepted the decisions below, including create-receipt retention, in issue #70 on
10 November 2026. The synthetic example is in
[`fixtures/conversations/owner-replay-deletion.json`](../../fixtures/conversations/owner-replay-deletion.json).

## Fixed behavior from #70 and related issues

- Hard-delete conversation content and retain a separate content-free cleanup intent until
  remote cleanup is verified. No conversation-content tombstone remains.
- Network retries and reconnects reuse one operation. An explicit retry creates a new answer
  attempt linked to the original input IDs. Running text belongs to the attempt; finalization
  writes one immutable history message. Late completion cannot finalize a cancelled attempt.
- An answer may have multiple typed citations. Exact note excerpts are at most 1,000 characters;
  detailed web-source support belongs to #75.
- Cursor pages default to 50 and have at most 100 records. Message cursors use immutable sequence
  numbers. Payload sizes are bounded.
- Creation accepts `{}` with a UUID `Idempotency-Key` header and a server-generated ID. No title
  or rename operation is included. Message text is bounded to 100,000 UTF-16 code units and
  citation excerpts to 1,000, matching JavaScript string and existing note limits.

- Every list, read, append and delete derives the owner from verified authentication. A direct
  conversation ID never grants access. Limit both conversation lists and message pages.
- Keep every accepted user input in order, including queued inputs. A combined answer records
  exactly which input identities it addresses. Stop leaves the queue paused across reconnect
  until explicit resume.
- Persist completed, no-support and failed/cancelled incomplete outcomes distinctly. Partial
  assistant text stays visible but is not completed evidence for later context.
- A note citation retains a short exact excerpt and the #66 source reference (note ID, version,
  block ID or revision-bound Markdown UTF-16 range). It does not retain a full note version.
  Deleting the source note removes the excerpt copy but keeps the delivered answer and a
  deleted-source reference. A late citation write cannot restore the excerpt.
- Conversation deletion immediately denies access, fences in-flight writes and durably records
  any required remote runtime cleanup. A local deletion is not proof of remote retirement.

## Storage shape for implementation

| Record | Purpose and invariant |
| --- | --- |
| Conversation | Random ID, verified owner, creation/update times, queue-paused state and next sequence. All writes lock this row before assigning a sequence. |
| Message | One immutable accepted user input or finalized assistant output, role, sequence, text and stable operation ID with a payload fingerprint. Unique operation ID within the conversation returns the current record on an identical replay and rejects a changed payload. |
| Turn | One answer attempt with queued/running/completed/no-support/incomplete state, running text and a separate failure/cancellation reason. An explicit retry has a new attempt identity but references the same user inputs. Finalization creates at most one immutable assistant message. |
| Turn input | Ordered relation from a turn to every user message it consumed. Queued inputs retain their own identities until a turn actually consumes them. |
| Citation | Ordered typed source identities attached to an answer, exact note excerpts of at most 1,000 characters and deleted-source markers. Note references keep their #66 location after excerpt redaction. Detailed web-source fields belong to #75. |
| Cleanup intent | Content-free runtime identity and retry state retained independently of deleted conversation content until remote retirement is verified. It does not claim exactly-once external cleanup. |

The deletion transaction locks the conversation,
records any required cleanup intent, and deletes the conversation and dependent content. A
message append must find and lock an existing owned conversation; it must never upsert one.
The foreign key from message to conversation then prevents a late completion from recreating
history. A failed cleanup-intent write makes the deletion transaction fail rather than claiming
success without a durable cleanup path. Efe accepted hard deletion and the separate cleanup
intent, together with the create-replay record below.

For source-note deletion, citation insertion first checks and locks the owned live note, then
locks the conversation for append. Note deletion locks the note, redacts every excerpt tied to
its ID in the same transaction, then removes the note. The citation row has no cascading note
foreign key because its deleted-source reference must survive. The redaction marker forbids a
non-null excerpt. The real PostgreSQL tests exercise this lock order and the
conversation-delete interaction.

## Accepted create replay contract

Use a separate creation receipt keyed by verified owner and client-generated UUID operation ID.
Store only a validated-payload fingerprint and original conversation UUID, with no title,
messages or runtime data. Insert it atomically with a new conversation. Retain it after deletion
until account deletion, matching the existing note-create receipt lifetime. An identical replay
while the conversation exists returns the current conversation; after deletion it returns a
`409` conflict without recreating it. A changed payload also returns `409`. A shorter TTL would
let an old request recreate a deleted conversation after expiry.

## PostgreSQL verification contract

| Trigger | Expected observation |
| --- | --- |
| Alex creates a conversation; Sam lists or reads by its exact ID | No Alex content or existence detail is returned. |
| Same message operation ID and payload arrive twice, including concurrently | One row and one sequence; both accepted responses identify the same message. |
| Same operation ID arrives with changed payload | Conflict without a second row. |
| Old create operation arrives after its conversation was deleted | No new conversation is created; the content-free receipt remains. |
| Two queued inputs are grouped into one answer | Both inputs remain separate and ordered; the answer records both IDs. |
| Input arrives while an answer runs | It is queued with its own stable identity and survives reload. |
| Stop cancels active output while another input is queued | Partial output remains incomplete; queued input survives reload and remains paused until explicit resume. |
| Explicit retry of a cancelled attempt | Original incomplete answer remains; one new attempt points to the same input IDs. |
| Late completion of a cancelled attempt | It cannot finalize or replace the incomplete history message. |
| Completed answer cites two notes and one note is deleted | Only the deleted note's excerpt is redacted. |
| Identical answer replay after excerpt redaction | Current redacted record is returned, never a historical excerpt snapshot. |
| Failed and no-support outcomes | Both differ from a completed sourced answer; failed partial text stays incomplete. |
| Markdown source reference | Its revision-bound UTF-16 range survives excerpt redaction. |
| Source note is edited during generation | A delivered answer may retain its exact old-revision citation and gets a stale warning; it is never presented as current note content. |
| Source note is deleted before answer delivery | The unpublished answer is suppressed; no new excerpt is stored. |
| Source deletion races with citation insertion | Either insertion commits first and deletion redacts it, or deletion wins and insertion fails. No committed excerpt survives. |
| Conversation deletion races with an assistant write | If the write wins, deletion removes it; if deletion wins, the write fails. No late recreation. |
| Storage transaction fails before commit | Caller does not acknowledge a saved message, sequence or deletion. |
| Cleanup provider outcome is unknown | Durable intent remains retryable/inspectable without claiming remote success. |

The executable regressions live in `server/db/conversation-*.integration.ts` and
`server/db/conversations.integration.ts`. The JSON example remains illustrative, not an
executable test. Run the database suite against an isolated local PostgreSQL instance.
No shared staging migration is part of this verification.
