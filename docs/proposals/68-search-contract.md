# Proposal: note search result contract for #68

Status: Efe approved the contract, rolling rate limit and a synthetic live evaluation capped
at $1 on 10 November 2026. The measured results belong in the implementing PR's evidence.

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

A successful response has `{ "candidates": [{ "text", "source", "score" }], "coverage":
{ "ready", "pending", "failed" } }`. Array order supplies rank; `score` is cosine similarity,
not confidence that the question was answered. Counts include only the authenticated user's
current note revisions. A matching ready publication counts as ready even if it has zero
passages. A current intent with a failure code counts as failed; all other current notes without
a matching ready publication count as pending, including processing and missing intents.
Empty candidates do not establish semantic no-support. The answer layer verifies support in
#71. Search overfetches at most ten times the requested limit and revalidates live ownership,
revision, passage text and source reference before delivery. Fewer than `limit` safe candidates
may be returned. Provider and storage failures are sanitized, distinct 503 errors.

## Approved per-user request limit

The existing three-active-Organize-run guard limits concurrent long jobs, not search requests
across API processes. Search instead uses one PostgreSQL row per owner with at most 20 admission
timestamps. The database clock and a row lock enforce at most 20 admitted requests in the
preceding 60 seconds. Rejections return sanitized `429 RATE_LIMITED` with `Retry-After` before
embedding. Failed provider attempts consume admission. Missing or failed admission storage
returns `503`. Each request first commits a separate bounded cleanup of expired rows, without
waiting on active owner locks. Expired rows can remain until later traffic performs cleanup.

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

The frozen live set adds two same-topic distractors: G describes a Monday meeting in room C,
and H describes a Friday review checklist without recording its meeting location. H deliberately
does not repeat B's location, which would make B an incorrectly exclusive relevance label.
Add a long synthetic note I with several passages about unrelated project tasks and one passage
stating `The accessibility review is at 16:30 in room D4.` The question `Where is the
accessibility review?` expects I's D4 passage, not merely note I.

Report top-1 hit rate, expected-source rank and top-k source recall separately from whether a
downstream answer can safely say "no supporting source". Compare top scores for supported and
unsupported questions without assuming a reliable cutoff. The earlier #67 cutoff observation
comes from the 8 November model-selection sample: Qwen's calibration cutoff of
`0.7487874586479794` rejected all 12 held-out answerable questions, as well as both held-out
unsupported questions. This was a whole-note screening experiment, not a production passage
search threshold. A no-support question must not be reported as answered merely because
search returns a ranked candidate. Test ownership, stale revision and deletion with
deterministic vectors and real PostgreSQL. Separately report any live Qwen quality sample, its
configuration and cost; mocked vectors establish only data flow. If the candidate contract
makes no-support handling impractical, revise it with Efe using those examples before adding
a cutoff.

Run `node scripts/evaluate-note-search.ts` only after live-call authorization, with
`OPENROUTER_API_KEY` set to a non-resetting key capped at $1 including BYOK. The runner checks
that budget before each bounded batch, makes no automatic retries, and reports response-supplied
cost in credits or `null` when unavailable. It does not infer actual cost from a listed price.
