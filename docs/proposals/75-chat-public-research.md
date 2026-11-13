# Proposal: public research during a conversation (#75)

Status: implementation proposal in the #75 feature PR; pending Efe review. The accepted #71
session-separation decision remains the baseline until this proposal is accepted.

## Proposed boundary

Reuse the current OpenRouter research helper and web-search path from a `chat` session. The
helper receives only one outbound question. It never receives a full note, transcript, account
identity, or connector data. The question is reviewed against the current turn's user inputs,
recent history, summary, and version-bound note sources before the helper can run.

The backend deterministically removes matched private identifiers, named terms, exact numbers,
and distinctive copied phrases from autonomous queries. A query that becomes too vague, private
context that is stale or too large to inspect, or the model's advisory `requiresPrivateDisclosure`
flag creates an approval request instead. The flag can only escalate; it never grants permission.
This is a conservative lexical screen, not semantic entity recognition. It can require approval
for some public proper nouns and cannot promise detection of every alias or paraphrase. A failed
or uncertain scan never permits the unsanitized query.

## Approval lifecycle

- The backend persists the exact proposed query, its SHA-256 hash, the owner-bound conversation
  and turn, a digest of the current private context, and a two-minute expiry.
- `GET /api/conversations/:id/research-requests` returns the exact query and hash only to the
  authenticated conversation owner. The approve and deny endpoints require that hash.
- Approval is accepted only for the same pending request, owner, live turn, query hash, and
  unchanged context digest. A different account receives the same `404` as a missing request.
- Denial, expiry, Stop, changed context, account mismatch, or a stale/mismatched request results
  in no provider call. The private payload is cleared on those terminal decisions and when an
  approved request is claimed for execution. Conversation deletion cascades the remaining
  content-free outcome record.
- The chat tool waits on the durable request. It rechecks the decision and context immediately
  before research. A Stop while approval is pending cancels the request; an in-flight provider
  request is aborted when possible but cannot be recalled after network transmission.

The endpoints provide a presentation contract, not a chat screen. There is no conversation UI in
the current scaffold. Adding a visible approval dialog should follow the team's existing UI
direction rather than inventing a new surface in this backend-focused PR.

## Evidence and citations

Note passage sources remain their existing block/Markdown types. Web evidence is a separate
`kind: "web"` record containing only a provider-returned HTTP(S) URL, title, and retrieval time.
The API recomputes its evidence ID from the tool result, validates exact excerpts, and persists
web citations separately from note dependencies. Deleting a note redacts only note citations;
it does not turn a URL into a note source or remove public evidence. This records provenance, not
claim-to-page attribution quality.

The existing OpenRouter server tool generates its own search query from the helper prompt and may
search more than once. The exact approved payload is the question sent to the helper; the helper
receives no additional private context and is instructed not to add identifying details. If Efe
requires the exact downstream search string to be shown and approved too, the provider contract
must change before that can be guaranteed with the current server-tool interface.

## Verification boundary and decisions for review

Synthetic tests cover generalized queries, private-detail approval/denial, stale context, account
change, cancellation, mixed note/web citations, tool failure and malicious page text. No private
fixture or live provider call is used here. Live attribution quality remains a separate, explicitly
authorized #76 evaluation; mocks do not establish it.

Efe review is requested for the change to #71's same-session boundary, the lexical disclosure
screen, the two-minute approval window and payload retention, whether API-only presentation is
sufficient before a chat UI exists, and the helper-to-provider query boundary above. No new crawler,
page archive, authenticated website, PDF/OCR, connector, or external action is introduced.
