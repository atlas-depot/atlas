# Atlas UI Directions

Status: Direction A approved by Efe on 2026-07-01  
Depends on: `docs/design/atlas-ui-reference-audit.md`  
Approved direction: Direction A

## Scope

This document records the three visual directions considered for the first accepted Atlas UI slice.
The slice is Today plus right inspector plus persistent composer.
It is not the full app.

Efe initially approved Direction A, Quiet Ledger Desk, as a working hypothesis.
The first execution at `docs/prototypes/atlas-today-slice/index.html` was rejected.
Do not patch that artifact.
The next visual design should start from the principles and reference audit, not from the failed HTML.

## Shared constraints

All directions must obey these constraints:

- Dark-first.
- No nested cards.
- No decorative pills.
- No generic AI gradients.
- No decorative orbs.
- No visible shortcut/counter flood.
- One primary attention target per screen.
- Backend-enforced privacy remains visible in the UI.
- Source, citation, visibility, risk, and rollback are visible without becoming decorative clutter.
- Main content and inspector scroll independently.
- Long source names, URLs, file names, and object titles wrap cleanly.
- Screenshot checks target `1440x1200`, `1280x800`, `1024x768`, and `390x844`.

## Direction A: Quiet Ledger Desk

Recommendation: strongest fit.

### Product feel

Quiet Ledger Desk is a serious operating surface for memory and action.
It feels closer to Linear plus Superhuman plus a private research desk.
It is calm, dense, and exact.

The screen is built around a prioritized ledger, not cards.
The selected row opens a calm evidence inspector.
The composer sits as a precise input rail, not a chatbot takeover.

### Visual language

Palette:

- Page: near-black with a warm olive cast.
- Surface: slightly raised graphite-brown.
- Line: low-contrast warm gray.
- Text: warm ivory.
- Muted text: desaturated taupe.
- Accent: restrained moss or mineral green.
- Warning: muted amber.
- Danger: clay red.
- Success: quiet sage.

Typography:

- Primary UI: Instrument Sans or a comparable humanist sans.
- Numeric/data fields: tabular figures in the same family.
- Optional long-form reading accent: Newsreader only inside document/source preview, never for controls.

Spatial rhythm:

- Left rail: `244px`.
- Center content: `minmax(560px, 1fr)`.
- Inspector: `360px`.
- Topline: `64px`.
- Composer: `56px` outer height with `42px` input.
- Content padding: `28px` desktop, `20px` laptop, `16px` mobile.
- Ledger row minimum: `58px`.
- Inspector field row: `12px 0`.

### Today composition

Topline:
Left side shows `Today`.
Supporting line is one sentence: "3 decisions, 2 waiting items, 1 draft needs review."
Right side has a quiet workspace/source scope control.

Primary focus:
A single text-led focus block appears at the top of center content.
It has one action button and one text inspection action.
No surrounding card unless the whole block needs one subtle boundary.

Ledger:
Rows are grouped by semantic bands:

- Needs review.
- Waiting on.
- Due soon.
- Recent memory changes.

Rows use title, source sentence, and a restrained state text.
They do not use pills.

Inspector:
The inspector is a field list with sections:

- Object.
- Source basis.
- Visibility.
- Confidence.
- Action risk.
- Rollback.
- Related memory.

Composer:
The composer reads as a command line for capture, ask, search, and act.
It can show source scope in text, not chips.

### Why this is likely right

It best protects the Atlas trust model.
It supports dense knowledge work without card noise.
It naturally supports auditability, source grounding, and permission explanation.

### Risk

It can become too austere if typography and spacing are not excellent.
The first slice must therefore be judged visually, not only by the contract.

## Direction B: Editorial Memory Workspace

Recommendation: strong for object pages, weaker for Today.

### Product feel

Editorial Memory Workspace feels like a private document room.
It leans into reading, reflection, and source inspection.
It is closer to Notion plus OpenAI plus a research notebook.

### Visual language

Palette:

- Page: charcoal.
- Surface: dark paper.
- Source preview: warm off-white.
- Line: ink wash gray.
- Accent: muted blue-gray or soft green.
- Warning and danger stay desaturated.

Typography:

- UI: Source Sans 3 or Instrument Sans.
- Reading/source preview: Newsreader or a similar editorial serif.
- Avoid large display type in the app shell.

Spatial rhythm:

- More generous vertical spacing than Direction A.
- Center content has a readable measure for prose.
- Inspector is wider when source preview is active.

### Today composition

Today opens with a concise editorial brief.
Below it, memory rows are grouped as an annotated reading list.
The inspector emphasizes citations and source preview more than action throughput.

### Why it may work

Atlas must help users understand where things came from.
This direction makes source grounding feel natural and premium.

### Risk

It may feel too slow for daily command-center work.
It may under-serve founders, freelancers, and operators who need rapid triage.

## Direction C: Precision Console

Recommendation: safest engineering translation, weakest distinctiveness.

### Product feel

Precision Console is a sharp operational interface.
It is closest to Vercel plus Linear plus developer-tool clarity.
It is fast, consistent, and strongly componentized.

### Visual language

Palette:

- Page: neutral black graphite.
- Surface: layered charcoal.
- Line: high-precision gray.
- Accent: cool blue-white or neutral green.
- Semantic colors are minimal and rare.

Typography:

- Geist Sans or a similar precision sans.
- Geist Mono only for IDs, traces, and developer-facing eval output.

Spatial rhythm:

- Strict grid.
- Tight row density.
- Strong keyboard and command menu affordances.
- Inspector fields align to a rigid baseline.

### Today composition

Today looks like a mission control ledger.
It has compact rows, inline source state, precise filters, and a strong command menu.

### Why it may work

It is easiest to convert into Storybook, tokens, and reusable components.
It will age well if implemented carefully.

### Risk

It may feel derivative and cold.
It may also recreate the first failure if agents translate "precision" into generic dark UI with labels everywhere.

## Decision

Chosen direction: Direction A, Quiet Ledger Desk.

Direction A gives Atlas a real product point of view without making the UI decorative.
It is operational enough for Today, calm enough for source grounding, and strict enough for safe actions.
Direction B should influence object pages and document/source preview.
Direction C should influence component discipline and interaction details, but not the brand feel.

## Direction A Today Slice Contract

### Viewports

Desktop target: `1440x1200`.
Laptop target: `1280x800`.
Tablet target: `1024x768`.
Mobile target: `390x844`.

### Desktop grid

Use a three-column app shell:

```text
244px left rail | minmax(560px, 1fr) center | 360px inspector
```

The shell fills the viewport height.
The page is not wrapped in a centered card.
The center and inspector scroll independently.

### Laptop behavior

At `1280x800`, keep three columns if content remains readable.
If the inspector creates center-content squeeze, reduce left rail to `216px` and inspector to `336px`.
Do not reduce row typography below `14px`.

### Tablet behavior

At `1024x768`, hide the persistent inspector.
Expose the selected object through a route-addressable sheet.
Keep the Today ledger visible as the primary surface.

### Mobile behavior

At `390x844`, use a single-column surface.
Show Today, primary focus, and ledger first.
Open inspector as a full route or bottom sheet.
Do not hide source, visibility, or action risk.

### Typography

Use a fixed product UI scale:

- `12px` metadata.
- `14px` row metadata and quiet controls.
- `15px` base app text.
- `17px` section heading.
- `24px` page heading.
- `30px` primary focus title.

Line heights:

- Metadata: `1.35`.
- Rows: `1.42`.
- Prose/source summaries: `1.58`.
- Primary focus: `1.18`.

Do not use viewport-scaled font sizes in the app shell.

### Layout measurements

Left rail:

- Width: `244px`.
- Padding: `18px 14px`.
- Nav row: `34px`.

Center:

- Topline height: `64px`.
- Content padding: `28px`.
- Section gap: `30px`.
- Section heading bottom gap: `12px`.
- Ledger row minimum height: `58px`.
- Row vertical padding: `12px`.
- Row grid: `minmax(0, 1fr) 132px`.

Inspector:

- Width: `360px`.
- Padding: `22px 20px`.
- Section gap: `24px`.
- Field label width: `104px`.
- Field row vertical padding: `12px`.

Composer:

- Footer padding: `12px 28px`.
- Input minimum height: `42px`.
- Send/action button height: `34px`.

### Content rules

Primary focus:

- One primary focus only.
- Maximum two actions.
- Source basis appears as a sentence under the focus title.
- Risk appears only if an action is proposed.

Ledger rows:

- Title wraps to two lines before row height grows.
- Source sentence uses muted text.
- State text is plain text, not a pill.
- State column is fixed on desktop and wraps below title on mobile.

Inspector:

- Use field lists and dividers.
- Show exact labels: Type, Visibility, Source basis, Confidence, Risk, Approval, Rollback, Related.
- Long values wrap.
- Private/redacted relation text is explicit but calm.

Composer:

- Placeholder should be action-capable, for example "Ask, capture, search, or draft from selected sources".
- It should not display shortcut hints by default.

### First fixture data

Use fixture objects that force hard layout cases:

- Long PDF file name from the CTIS411 proposal.
- Advisor follow-up draft requiring Level 2 approval.
- Waiting-on relation connected to a private email source.
- Low-confidence project relation needing review.
- Recent memory change with four cited chunks.
- A source that is visible to the owner but hidden from shared-space preview.

### Screenshot acceptance

Reject the slice if:

- It still looks like a card dashboard.
- It uses decorative pills.
- The right inspector competes with the primary focus.
- Source basis is louder than the action.
- Risk is hidden or over-amplified.
- Long source names overlap, clip, or force horizontal scroll.
- Mobile hides provenance, visibility, or action risk.
- The screen would feel embarrassing if shown as an OpenAI, Linear, Vercel, Notion, or Cursor-level product surface.

## Next Work Item

Build a fresh visual-only Today slice after rereading the principles and reference audit.
Do not reuse the rejected `atlas-today-slice` composition.
Use static HTML only if Storybook is still unavailable.
If static HTML is used, it must be treated as a throwaway design artifact until translated into `packages/ui` and Storybook.
