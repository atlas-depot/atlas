# Proposal: persistent conversation and deletion contract for #70

Status: preparation for Efe's review before a migration. This is not an accepted schema or API
contract. The synthetic example is in
[`fixtures/conversations/owner-replay-deletion.json`](../../fixtures/conversations/owner-replay-deletion.json).

## Fixed behavior from #70 and related issues

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

## Proposed storage shape

| Record | Purpose and invariant |
| --- | --- |
| Conversation | Random ID, verified owner, creation/update times, queue-paused state and next sequence. All writes lock this row before assigning a sequence. |
| Message | One immutable accepted user input or assistant output, role, sequence, text and stable operation ID with a payload fingerprint. Unique operation ID within the conversation returns the same record on an identical replay and rejects a changed payload. |
| Turn | One logical answer attempt with queued/running/completed/no-support/incomplete state and a separate failure/cancellation reason. A turn may produce one assistant message; an incomplete message cannot be marked completed by a replay. |
| Turn input | Ordered relation from a turn to every user message it consumed. Queued inputs retain their own identities until a turn actually consumes them. |
| Citation | Typed source identity attached to a completed answer, exact bounded excerpt, and deleted-source marker. Note references keep their #66 location after excerpt redaction. Other source kinds need their own explicit fields; do not coerce a web URL into a note reference. |
| Cleanup intent | Content-free runtime identity and retry state retained independently of deleted conversation content until remote retirement is verified. It does not claim exactly-once external cleanup. |

The smallest deletion implementation appears to be a transaction that locks the conversation,
records any required cleanup intent, and deletes the conversation and dependent content. A
message append must find and lock an existing owned conversation; it must never upsert one.
The foreign key from message to conversation then prevents a late completion from recreating
history. A failed cleanup-intent write makes the deletion transaction fail rather than claiming
success without a durable cleanup path. This choice needs Efe's retention and failure-policy
review; a content-free tombstone is an alternative if replay semantics require one.

For source-note deletion, citation insertion first checks and locks the owned live note, then
locks the conversation for append. Note deletion locks the note, redacts every excerpt tied to
its ID in the same transaction, then removes the note. The citation row has no cascading note
foreign key because its deleted-source reference must survive. The redaction marker forbids a
non-null excerpt. This lock order and the conversation-delete interaction need a real
PostgreSQL race test before adoption, not an assumption based on single-threaded fixtures.

## Choices for Efe

1. Confirm hard deletion of conversation content plus a separate content-free cleanup intent,
   or require a content-free tombstone and define its retention period. Either way, direct-ID
   reads and writes must fail immediately after deletion.
2. Confirm the minimal turn states and replay key scope/lifetime. In particular, whether a
   failed/cancelled turn may be retried under a new operation ID or must retain the original
   logical turn identity.
3. Confirm the exact maximum stored citation excerpt length and whether non-note source kinds
   enter #70 now or through their owning later issue. The excerpt must be exact, never an
   AI-generated paraphrase.
4. Confirm bounded list/message page sizes and pagination shape before a public API is fixed.

## PostgreSQL verification prepared for implementation

| Trigger | Expected observation |
| --- | --- |
| Alex creates a conversation; Sam lists or reads by its exact ID | No Alex content or existence detail is returned. |
| Same message operation ID and payload arrive twice, including concurrently | One row and one sequence; both accepted responses identify the same message. |
| Same operation ID arrives with changed payload | Conflict without a second row. |
| Two queued inputs are grouped into one answer | Both inputs remain separate and ordered; the answer records both IDs. |
| Stop cancels active output while another input is queued | Partial output remains incomplete; queued input survives reload and remains paused until explicit resume. |
| Source note is edited during generation | A delivered answer may retain its exact old-revision citation and gets a stale warning; it is never presented as current note content. |
| Source note is deleted before answer delivery | The unpublished answer is suppressed; no new excerpt is stored. |
| Source deletion races with citation insertion | Either insertion commits first and deletion redacts it, or deletion wins and insertion fails. No committed excerpt survives. |
| Conversation deletion races with an assistant write | If the write wins, deletion removes it; if deletion wins, the write fails. No late recreation. |
| Storage transaction fails before commit | Caller does not acknowledge a saved message, sequence or deletion. |
| Cleanup provider outcome is unknown | Durable intent remains retryable/inspectable without claiming remote success. |

The first experiment after approval should migrate an isolated PostgreSQL/pgvector test
database, replay the JSON fixture through two independent pools, and force the deletion races
with real row locks. Do not apply a migration to shared staging as part of this preparation.
