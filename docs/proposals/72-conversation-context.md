# Conversation context and recovery for #72

Implementation contract on top of #71. Onat confirmed the working agreement to proceed to
a PR without another pre-implementation approval round. This does not assert a separate
Efe review of this concrete implementation. The prior [persistence](70-conversation-persistence.md)
and [delivery](71-grounded-chat-turn.md) decisions remain unchanged.

## History is not model context

Atlas retains the ordered, immutable UI messages independently of runtime retention. Every
answer attempt gets a separate eve session, reconstructed from a validated summary and recent
eligible messages. A reconnect continues that same attempt and operation keys; it does not
resend a new user message. Confirmed expiry creates an incomplete outcome and explicit recovery.
An explicit retry may allocate a replacement attempt over the original input identities.
Unknown transport outcomes only retry the existing fixed operation.

Per-attempt prompt snapshots are removed on terminal publication. Only source-lineage metadata
stays with the turn; the replaceable conversation summary is independent of transient prompts.

Historical messages resolve follow-up references, but cannot supply citations for a new answer.
The model must search current authorized notes on every turn. Failed/cancelled assistant text
is not eligible historical evidence. User-authored inputs remain user content, not inferred note
provenance; Atlas does not guess whether a user independently copied a fact from a deleted note.

## Source dependency and invalidation rule

The server unions the dependencies of every supplied historical answer/summary with **all**
passages actually returned by `search_notes`, including uncited passages. The tool records these
dependencies before returning evidence. A summary never chooses or narrows its own dependencies.
Dependencies propagate transitively through subsequent answers, including no-support prose.
Legacy answers with unknown provenance are never model context: final citations are not trusted
as a complete lineage record, and the follow-up runs without that answer instead of failing.
Inherited lineage is capped at 500 sources per context so an attempt can still record its own
retrieval under the 1,000 limit; an answer that would exceed the cap is left out whole.

Note deletion locks the note, then affected conversations in deterministic order. It invalidates
the whole affected context, removes its recent/summary/compaction-input text, deletes affected
checkpoints and persists cleanup for live answer/summary sessions. Delivered answer text remains
in UI history; the existing citation-excerpt redaction still applies. New context excludes whole
answers derived from unavailable sources. Rebuilding from safe material is bounded; missing
history requires recovery, not an unsafe fallback. Deletion matches note IDs case-insensitively.

The model provider boundary rechecks authorization before every chat/summary request, including
eve automatic compaction, streaming and retries. A previously authorized request already in flight
cannot be recalled from a provider. Publication rechecks source access under note locks and rejects
invalidated context, so its result cannot become a completed answer. No later attempt reuses that
runtime's hidden messages or tool history. Remote physical erasure is not claimed: cleanup remains
durable until retirement is independently confirmed, and provider/backup retention is separate.

Editing a source during generation preserves #71's used-revision/stale-citation policy. For a
future turn, old-version-derived context is excluded or its checkpoint reconstructed; fresh
retrieval supplies the current version.

## Bounded compaction

The context store reads the newest 500 history records after the checkpoint, retaining at most
8,000 UTF-8 bytes of whole recent messages. The compaction input holds the prior checkpoint and
the newest older messages that fit 48,000 bytes. Whole earlier messages, and any single message
above 40,000 bytes, are left out of model context and stay in UI history. Nothing is cut inside
a message. This keeps a long conversation answerable after it loses its checkpoint; summarizing
such material in several passes is future work. The summary is nonempty, schema-validated and at most
4,000 bytes when JSON-encoded (the runtime schema allows 1,300 characters, which always fits); the final context/question envelope is at most 24,000 bytes.
Queued inputs combine up to 10,000 bytes, leaving space for history and framing. An oversized
single accepted input is retained but may require recovery. Retrieved tool output
is separately capped at 48,000 bytes per answer, with at most 1,000 source dependencies.

The existing model's configured context window also gates the complete provider prompt, tool
schemas and response schema, with 16,384 output-token and 4,096 framing reserves. The input
admission guard uses UTF-8 bytes conservatively, not character counts or an exact tokenizer.
eve retains its own context-window checks. Oversized input is not silently sliced: the full
accepted message remains saved and the attempt reports recovery.

Compaction uses the existing eve harness with a private `context` job principal. That job has
neither note retrieval nor public research tools. PostgreSQL records its fixed operation before
allocation; the same key/session survives lost receipts and API replacement. A durable cleanup
intent exists before dispatch, with a ten-minute execution window. Stop/deletion expedites cleanup;
the window's expiry prevents further summary provider calls, and a failed retirement that
reschedules cleanup does not reopen it. Only a validated, authorized result
may publish a checkpoint. There is no second agent loop or background memory extractor.

A checkpoint records its sequence boundary and deferred input identities. A queued input may
precede an older answer in UI order; deferral prevents that accepted input from disappearing
behind a summary boundary before it can become historical context.

## Recovery and verification boundary

Conversation reads and send/action responses include nullable `recovery: { turnId, reason }`.
Reasons distinguish missing/unknown history, context budget, failed summary, removed sources
and confirmed runtime expiry. The full history endpoint is unchanged. The #73 shell owns visible
rendering and explicit retry/resume controls; #74 owns saved-history navigation. Reconnect and
replacement never unpause a stopped queue. Recovery pauses the queue like Stop, so queued inputs
wait for an explicit resume and the recovery stays the latest outcome. A retry is refused while
paused and spends the same per-owner send budget as a new message.

Tests use controlled runtime/model boundaries and real PostgreSQL for ordering, concurrent
resume/retry, source changes, forced compaction, deletion, late summary publication, unknown
provenance and cleanup. A source sentinel must remain in the old answer but disappear from
future prompts and persisted summaries/context. Scripted summaries establish orchestration and
invalidation, not real-model summary fidelity or hosted Workflow durability. Those remain
separate, explicitly authorized acceptance checks; no paid evaluation or deployment is implied.
