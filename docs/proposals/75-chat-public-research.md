# Proposal: public research during a conversation (#75)

Status: implementation proposal in the #75 feature PR; pending Efe review. The accepted #71
session-separation decision remains the baseline until this proposal is accepted. API-only
approval presentation is also pending Efe's confirmation because no conversation UI exists.

## Proposed boundary

Reuse the current OpenRouter research helper and web-search path from a `chat` session. The
helper receives only one outbound question. It never receives a full note, transcript, account
identity, or connector data. The question is screened against the current turn's user inputs,
recent history, summary, and version-bound note sources before the helper can run.

The screen fails closed. After NFKC normalization and Turkish-safe case folding, a query is sent
without approval only when it shares no non-stopword token with that private context and contains
no direct identifier. Any shared distinctive term, direct identifier, explicit private-detail
request, or context that cannot be inspected creates an approval request. The screen does not
redact or rewrite the query; the exact outbound text is what the owner sees and decides on. An
email, UUID, IBAN, phone-like or card-like digit run, non-year number of four or more digits, or
private URL therefore requires approval.

This is a conservative lexical screen, not semantic entity recognition. It will require approval
for some public proper nouns and cannot promise detection of every alias or paraphrase. The
model's advisory `requiresPrivateDisclosure` flag can only escalate to approval; it never grants
permission. A failed or uncertain screen never sends the query autonomously.

## Approval lifecycle

- The backend persists the exact proposed query, its SHA-256 hash, the owner-bound conversation
  and turn, a digest of the current private context, and a two-minute expiry.
- `GET /api/conversations/:id/research-requests` returns the exact query and hash only to the
  authenticated conversation owner. The approve and deny endpoints require that hash.
- Approval is accepted only for the same pending or approved request, owner, live turn, query
  hash, and unchanged context digest. A different account receives the same `404` as a missing
  request. Repeating an approve after a lost response returns the same approved result.
- Denial remains available after approval until execution starts. Denial, expiry, Stop, changed
  context, account mismatch, or a stale/mismatched request results in no provider call. The
  private payload is cleared on those terminal decisions and when an approved request is claimed
  for execution. Conversation deletion cascades the remaining content-free outcome record.
- A terminal research decision in a turn forces every later query in that turn to a new approval
  request, even when the new wording has no private overlap. Every attempt, including denied and
  expired ones, counts toward the per-turn request limit, so a denial cannot be re-asked without
  bound.
- The chat tool waits on the durable request. It rechecks the decision and context immediately
  before research. A Stop while approval is pending cancels the request; an in-flight provider
  request is aborted when possible but cannot be recalled after network transmission.
- The retrieval budget is checked before approval waiting and again before the provider call. A
  budget that cannot fit useful evidence fails visibly instead of spending a call and discarding
  the answer.

The endpoints provide a presentation contract, not a chat screen. There is no conversation UI in
the current scaffold. Adding a visible approval dialog should follow the team's existing UI
direction rather than inventing a new surface in this backend-focused PR.

## Evidence and citations

Note passage sources remain their existing block/Markdown types. Web evidence is a separate
`kind: "web"` record containing only a provider-returned HTTP(S) URL, title, and retrieval time.
Each web record also carries the provider-attributed snippet for that URL, and an answer excerpt
must come from that snippet rather than the research model's summary. The API recomputes the
evidence ID from the tool result, validates exact excerpts, and persists web citations separately
from note dependencies. Deleting a note redacts only note citations; it does not turn a URL into a
note source or remove public evidence. This records provenance, not claim-to-page attribution
quality.

A research failure is optional evidence, not a reason to discard a note-supported answer. An
answer still needs one successful `search_notes` call from the #71 contract; research alone cannot
replace it. An answer that cites a web source whose research call failed has no recorded evidence
and fails server resolution.

The existing OpenRouter server tool generates its own search query from the helper prompt and may
search more than once. The exact approved payload is the question sent to the helper; the helper
receives no additional private context and is instructed not to add identifying details. If Efe
requires the exact downstream search string to be shown and approved too, the provider contract
must change before that can be guaranteed with the current server-tool interface.

## Verification boundary and decisions for review

Synthetic tests cover zero-overlap queries, token overlap across notes and transcript, direct
identifiers, private URLs, lowercase/short/uncased names, approval and denial, stale context,
account change, cancellation, request limits, budget, mixed note/web citations, tool failure,
the note-search guard, and malicious page text. No private fixture or live provider call is used
here. Live attribution quality remains a separate, explicitly authorized #76 evaluation; mocks do
not establish it.

Efe review is requested for the change to #71's same-session boundary, the fail-closed lexical
screen, the two-minute approval window and payload retention, whether API-only presentation is
sufficient before a chat UI exists, and the helper-to-provider query boundary above. No new
crawler, page archive, authenticated website, PDF/OCR, connector, or external action is introduced.
