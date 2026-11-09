# Proposal: note search result contract for #68

Status: proposal for Efe, not an accepted API decision.

## Decision

The index ranks evidence candidates. It cannot prove that a passage answers a question. The
small calibration in #67 did not support a public similarity cutoff. Search should therefore
return bounded ranked candidates without calling them verified matches or filtering them by an
unevaluated threshold.

Proposed `POST /api/note-search` takes `{ "query": string, "limit"?: number }` from an
authenticated user. The query is nonempty after trimming and at most 500 characters; limit
defaults to 5 and is at most 10. The server derives ownership from authentication, embeds the
query with the exact #67 profile, and returns only live, revision-checked passages and #66
source references. It does not accept an owner ID, note ID, vector or model from the client.

A successful response has `{ "candidates": [...], "coverage": "complete" | "pending" |
"failed" | "mixed" }`. `candidates: []` with `coverage: "complete"` is an actual empty
searchable corpus; `pending` and `failed` explain why zero candidates may be incomplete.
Nonempty candidates are ranked hints, including for no-support questions. The answer layer must
check whether a candidate actually supports a claim. A source edit or deletion that wins before
delivery suppresses that candidate. Provider and storage failures are sanitized, distinct 503
error codes; they are never an empty-success response.

## Alternatives

- A fixed cosine cutoff would let the endpoint claim no match for no-support questions, but the
  #67 cutoff failed to generalize and could hide valid Turkish/English paraphrases.
- Returning only a candidate array is smaller, but an empty array would conflate a complete
  empty corpus, unfinished indexing and a failed index.

## Evidence and falsification

Agree a frozen synthetic Turkish/English set before tuning. Proposed seed notes and questions:

| Note | Synthetic passage |
| --- | --- |
| A | `Toplantı perşembe saat 14.00'te kütüphanede.` |
| B | `The design review is on Friday at 09:30 in room B12.` |
| C | `Bisikletin arka lastiği patladı; tamir cumartesi yapılacak.` |
| D | `The bike's front brake was replaced on Tuesday.` |
| E | `Kütüphane üyeliği 12 Aralık'ta yenilenecek.` |
| F | `The project budget is 120 dollars for November.` |

| Question | Expected support | Why included |
| --- | --- | --- |
| `Perşembe görüşmesi nerede ve kaçta?` | A | Turkish paraphrase without `toplantı` |
| `Where is the Friday critique?` | B | English paraphrase without `design review` |
| `When will the punctured rear wheel be fixed?` | C | Cross-language semantic match |
| `Ön fren ne zaman değişti?` | D | Cross-language semantic match |
| `Kütüphane üyeliğini ne zaman yenilemeliyim?` | E | Shared word, different event from A |
| `What is the November spending limit?` | F | English paraphrase |
| `Perşembe bisiklet tamiri nerede?` | None | Distractor terms combine A and C |
| `What is the team's April revenue?` | None | No supporting note |

Report top-k source recall separately from whether a downstream answer can safely say "no
supporting source". A no-support question must not be reported as answered merely because
search returns a ranked candidate. Test ownership, stale revision and deletion with
deterministic vectors and real PostgreSQL. Separately report any live Qwen quality sample, its
configuration and cost; mocked vectors establish only data flow. If the candidate contract
makes no-support handling impractical, revise it with Efe using those examples before adding
a cutoff.
