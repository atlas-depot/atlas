# UI System

## Design direction

Atlas should feel like a quiet editorial operating desk.
The product should combine Linear and Vercel's operational clarity with Notion and OpenAI's calm reading and writing surfaces.

Do not copy any one product.

Current status: the static prototype in `docs/prototypes/atlas-ui-system/index.html` is rejected as an accepted visual direction.
It can be used only as a record of constraints and failure modes until a new design direction is approved.
Do not treat its palette, typography, spacing, or screen composition as production guidance.

The interface must be dense enough for daily knowledge work, but it must not feel like a dashboard made of cards.
Rows, dividers, alignment, and field lists are preferred before boxes.
Cards are allowed for repeated object previews, modals, and genuinely framed tools only.
Nested cards are forbidden.
Pills are forbidden as default status decoration.
Use status text, row state, selected object fields, or a single approval banner instead.

## Main layout

- Left sidebar: workspace, Today, Inbox, Search, Graph, Projects, People, Documents, Shared Spaces, Settings.
- Center surface: current route, with Today as default.
- Right context panel: object inspector, citations, source preview, related items, suggestions, and action approvals.
- Global command palette: capture, ask, search, create, jump, act.
- Persistent AI composer: available broadly but never replaces structured product surfaces.

## Layout contract

The first implementation must treat these measurements as acceptance criteria, not suggestions.
Change them only through a design-system decision.

| Area | Desktop contract | Tablet contract | Mobile contract |
| --- | --- | --- | --- |
| Product shell | `100vh` minimum height, no floating page card, no centered dashboard island. | Same. | Same. |
| Prototype or app chrome left rail | `232px` in the static prototype. | Keep visible if there is space. | Collapse into top or sheet navigation. |
| In-app left navigation | `216px` desktop. | `190px` until the inspector disappears. | Full-width top section or sheet. |
| Main content | `minmax(0, 1fr)` and always `min-width: 0`. | Same. | Same. |
| Right inspector | `326px` desktop. | Hide below `1160px`, then expose as route-addressable sheet or drawer in the real app. | Sheet or full route only. |
| Topline | `72px` minimum height. | `72px` minimum height. | Content can wrap, but padding stays `16px`. |
| Composer | `42px` minimum input height inside a `14px 24px` footer. | Same. | `42px` input height with `16px` horizontal padding. |
| Page padding | `26px` around prototype shell. | `20px` allowed if cramped. | `16px`. |
| Content padding | `24px` desktop. | `20px` allowed. | `16px`. |
| Inspector padding | `22px 18px`. | Hidden. | Sheet uses `20px 16px`. |
| Buttons | `36px` minimum height. | Same. | `38px` minimum touch target if primary. |
| Navigation rows | `32px` minimum height. | Same. | `36px` if touch-first. |
| Data rows | `54px` minimum height, `11px 0` vertical padding. | Same. | Single-column rows, `12px 0`, state text wraps below title. |
| Field rows | Two columns: `92px` label and flexible value. | Same inside sheets. | One column only if the value becomes unreadable. |
| Graph stage | `600px` minimum height. | `560px` allowed. | Separate graph route, no cramped miniature graph. |

## Spacing contract

Use a restrained 4px base grid.
Default rhythm should come from `8`, `12`, `16`, `18`, `22`, `24`, `26`, `32`, and `42px`.
Do not use the same padding everywhere.
Small repeated controls should use tight spacing.
Reading and decision areas should breathe.

Required spacing rules:

- Shell padding is larger than content padding.
- Section separation uses a divider plus `26px` top margin on desktop.
- Section headers use `12px` bottom margin.
- Row title and row metadata use `3px` vertical separation.
- Focus areas use `28px` horizontal separation between text and actions.
- Inspector field rows use `12px` vertical padding and a divider.
- No layout may rely on `<br>` for spacing or wrapping.

## Height and overflow contract

Atlas must be boringly correct about overflow.
Text clipping, accidental overlap, and hidden source/risk state are product bugs.

Required overflow rules:

- Every grid child that can contain text must set `min-width: 0`.
- Long object titles, source names, email subjects, file names, and URLs must use `overflow-wrap: anywhere`.
- Row state text may use `white-space: nowrap` on desktop only.
- Row state text must wrap on mobile.
- Main content and right inspector scroll independently.
- The left navigation should not scroll until the viewport is genuinely too short.
- The composer must stay attached to the bottom of the main pane when the main pane scrolls.
- The right inspector must never overlap the center surface.
- The source preview can scroll internally only when it is showing real document content.
- Do not create nested scroll containers unless the nested container is a document preview, code block, graph canvas, or command palette result list.

Responsive overflow checks are mandatory at these viewports:

- `1440x1200` for full desktop.
- `1280x800` for cramped laptop desktop.
- `1024x768` for tablet landscape.
- `390x844` for mobile.

The screenshot review must reject any screen where:

- Text overlaps another element.
- A button label wraps awkwardly.
- A right-panel field pushes outside its column.
- A row state hides important action or risk information.
- A source/citation/visibility label is only visible after horizontal scroll.
- The primary action loses visual priority because every row has a competing badge or pill.

## Core screens

- Today Command Center
- Capture Inbox
- Chat
- Search
- Memory Graph
- Object Inspector
- Document Library
- People
- Projects
- Shared Spaces
- Privacy Center

## UI invariants

- Never show AI-generated claims without source affordance when memory-grounded.
- Always show visibility state on memory objects.
- Always show review state for AI-extracted objects.
- Always show risk level and approval state for actions.
- Never hide errors behind vague toast messages.
- Every important state must be linkable or recoverable.

## Design source of truth

Use Storybook and code-backed mock surfaces as the implementation source of truth for the design system.
Paper, Pencil, Figma, or standalone HTML explorations are allowed during early design exploration, but they are references until translated into tokens, reusable components, Storybook stories, route mockups, and screenshot acceptance criteria.

Storybook must cover:

- Core tokens.
- Buttons, inputs, dialogs, sheets, tabs, command palette, cards, object previews, source/citation components, action approval components, and permission-redacted states.
- Mock screens for Today, Inbox, Object Inspector, Search, Graph, and Shared Spaces.
- Loading, empty, error, unauthorized, offline, low-confidence, and action-approval states.

Before the real app scaffold exists, do not use the rejected static prototype as visual source of truth.
Use it only for lessons learned and layout-contract reminders.
The next accepted design artifact must pass `docs/architecture/ui-quality-bar.md`.
Current reset artifacts are `docs/design/atlas-ui-reference-audit.md` and `docs/design/atlas-ui-directions.md`.
After Phase 0, migrate it into `packages/ui` tokens, Storybook stories, typed fixtures, and route mock screens.
