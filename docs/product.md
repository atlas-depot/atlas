# Atlas product

Status: team discussion baseline, September 2026. This describes intent, not shipped functionality.

Atlas helps people recover scattered context and move work forward from a chat surface. Users can write notes, ask AI to prepare notes, connect work accounts, and receive useful suggestions or briefings grounded in their sources.

## Agreed direction

- Cloud-backed web/PWA first. PWA is sufficient for the school delivery; native mobile and desktop are later options.
- Gmail and Calendar are the first connector priorities. Slack is a candidate.
- Agents should remember relevant context across conversations and continue long tasks when the browser disconnects.
- Analysis and drafts can run automatically within granted access. External sends, calendar changes, destructive or binding actions require approval.
- Sandboxes may run scripts, file conversion, analysis, and artifact generation on demand.
- UI direction and backend provider choices go to the team before implementation is locked.

## Constraints

| Constraint | Current understanding |
| --- | --- |
| Team | Five people |
| Delivery | End of April 2027 |
| AI assistance | Some use permitted; confirm the school's exact rules and retain contribution evidence |
| Additional monthly spend | Aim below USD 20 beyond the owner's existing Vercel Pro subscription |
| Credits | Owner reports USD 500 OpenRouter credit plus GCloud/AWS credits; validate expiry and eligible services before budgeting |

## First flow to validate

Proposed: a Gmail event arrives, Atlas finds a related note, prepares a reply, waits for approval, performs the approved action, and shows its actual outcome after reconnecting. Use synthetic fixtures before real accounts.

This is a thin validation slice, not a commitment to build the entire connector catalog first.

## Team decisions still open

| Question | Why it matters |
| --- | --- |
| What merits an immediate notification rather than a briefing? | Avoid replacing scattered attention with notification noise |
| Can AI edit a handwritten note, or only propose a revision? | Preserve authorship and user control |
| What should be saved as long-term memory? | Keep useful preferences separate from source documents and inferred facts |
| How should conflicting or stale sources be presented? | Do not silently convert an inference into a fact |
| Does the first release include shared workspaces? | Personal accounts still require isolation even without collaboration |
| Is offline editing required? | Durable reconnect is different from syncing conflicting offline edits |

No day-one commitment to billing, a graph visualization, OCR for every format, a vector database, or universal application connectivity.

## UI boundary

Use existing component libraries; do not author custom UI primitives. Composing product screens from library components is expected. Do not make custom SVG icons, use emoji as UI icons, or use lucide-react. Hugeicons, Phosphor, Base UI, and shadcn are candidates, not a requirement to install all of them.

Colors, tokens, panel widths, navigation, typography, and motion remain team decisions. See [historical references](design/references.md); none is a binding production design.
