# Proposal: one source-grounded chat turn for #71

Status: Efe decided the four choices below on 11 November 2026. The storage contract is
[#70](70-conversation-persistence.md); the search contract is [#68](68-search-contract.md).

This records the accepted #71 baseline. Issue [#75](https://github.com/atlas-depot/atlas/issues/75)
proposes a bounded public-research exception in a chat session; see the separate
[#75 proposal](75-chat-public-research.md). The #71 decision remains authoritative until Efe
accepts that change.

## Decisions

| Choice | Decision |
| --- | --- |
| Retrieval | The model calls a `search_notes` tool in the private runtime. Hono does not prefetch passages. |
| Agent | The existing organizer agent answers questions. Tools and instructions are selected per job. |
| Steer | Both policies ship. `queue` is the default; `steer` is honored only when the caller sends it. |
| Admission | 20 accepted sends per owner in 60 seconds and at most 3 running answers per owner. |

One runtime session serves one answer attempt. Follow-up and session reconstruction stay out
of scope, so no earlier answer is sent back to the model.

## Why a compromised model cannot widen access

The design assumes a note can talk the model into anything. Authority stays outside it.

- **Job.** The API authenticates to the runtime as `api` for Organize and indexing, and as
  `chat` for answers. Under this accepted baseline, a chat session sees only `search_notes` and
  the reply tool, and an Organize session sees only `research`. Public web research and private
  note search never share a session, so a note cannot ask for its content to be searched on the
  web. The [#75 proposal](75-chat-public-research.md) would add the existing research tool to the
  chat session behind a fail-closed disclosure screen and exact-disclosure approval; that change
  is not accepted until Efe reviews it.
- **Owner.** `search_notes` takes a query and a limit. The owner comes from the running
  attempt that Atlas bound to the runtime session before any input was sent.
- **Evidence.** The evidence set is the search output the runtime recorded for Atlas's own
  deliveries, not what the model says it read. Passage identity is recomputed from the
  recorded source.
- **Citations.** Every citation must name a passage in that set and quote it exactly. The
  stored source record is the server's, never the model's. #70 then rechecks note access
  under locks before publication.
- **Policy.** Queue, steer, Stop and resume live in PostgreSQL. No tool can change them.

Source validation proves identity and provenance only. Whether the cited text supports the
claim, and how conflicting notes are handled, is a model-quality question and needs a live
evaluation that is reported separately.

## Delivery

```text
POST /api/conversations/:id/messages
  admission -> accept input (idempotent by key)
  queue: start an attempt over the next 100 unconsumed inputs at most when none is running
  steer: join the running attempt, then forward to its session
attempt: prepare runtime -> allocate session -> bind -> submit
GET /api/conversations/:id
  inspect the session -> checkpoint, or validate and publish
```

Every runtime call is keyed by the attempt or message identity and no database lock spans
one, so a repeated send, a second API process or the maintenance sweep continues the same
work. A steering input that reaches the session after its turn settled is answered by a new
runtime turn in the same session; Atlas reads the answer from the last turn that took one of
its inputs and records every consumed input on that one answer.

## Known limits

- The reply is one structured result, so no partial answer text streams while it is written.
  A stopped or failed attempt usually keeps an empty incomplete message.
- A paid provider call can repeat when a runtime step is replayed. Atlas publishes one answer.
- Retirement of a session is confirmed from its history. An unconfirmed end stays a
  retryable cleanup intent.
