# Atlas App Shell Spec

Status: frontend owner draft.
Audience: UI Design Owner, Frontend Owner, Efe, and coding agents.
This file details `docs/architecture/ui-system.md` and `docs/design/atlas-design-tokens.md` for implementation.
If this file conflicts with those sources, those sources win until a design-system decision updates them.

## References

Atlas sources: `docs/architecture/ui-system.md`, `docs/design/atlas-design-tokens.md`, `docs/design/ui-rulebook.md`, `docs/architecture/frontend.md`, `docs/architecture/repository-structure.md`, `docs/process/evidence-bundles.md`, `docs/design/frontend-pages.md`, `docs/design/component-map.md`.
Shadcn sources: [sidebar](https://ui.shadcn.com/docs/components/base/sidebar), [resizable](https://ui.shadcn.com/docs/components/base/resizable), [command](https://ui.shadcn.com/docs/components/base/command), [tabs](https://ui.shadcn.com/docs/components/base/tabs), [dialog](https://ui.shadcn.com/docs/components/base/dialog), [sheet](https://ui.shadcn.com/docs/components/base/sheet), [drawer](https://ui.shadcn.com/docs/components/base/drawer), [scroll area](https://ui.shadcn.com/docs/components/base/scroll-area), [separator](https://ui.shadcn.com/docs/components/base/separator), [breadcrumb](https://ui.shadcn.com/docs/components/base/breadcrumb), [kbd](https://ui.shadcn.com/docs/components/base/kbd), [theming](https://ui.shadcn.com/docs/theming), [dark mode](https://ui.shadcn.com/docs/dark-mode), [monorepo](https://ui.shadcn.com/docs/monorepo), [CLI](https://ui.shadcn.com/docs/cli).

## Mirror note

Numbers below mirror the locked contract for implementation convenience.
Canonical owners are `docs/architecture/ui-system.md` (§Main layout, §Layout contract, §Spacing contract, §Height and overflow contract) and `docs/design/atlas-design-tokens.md` (palette, type, spacing, radii).
If this file conflicts with those sources, those sources win.
When an owner changes, this mirror is updated in the same PR and every restated number is re-verified.
This rule exists because a restated measurements block drifted before (216px stated vs 252px locked) and the fix was a pointer, not a corrected copy.

## Shell composition

The product shell is a floating rounded card with radius 22 on a warm ground.
The shell contains left navigation, center surface, and an optional right context panel.
The command palette floats above the shell.
The AI composer is pinned to the bottom of the main pane.
Shadows apply only to the shell, floating panels, floating menus, and the composer.
Cards inside the shell stay flat with hairline borders.

## Width contract

Owner: `docs/architecture/ui-system.md` §Layout contract.
Left in-app navigation is 252px on desktop.
Left navigation is 190px on tablet until the inspector disappears.
Mobile uses a full-width top section or sheet navigation and never a squeezed 252px rail.
Right inspector is 344px on desktop.
Tablet hides the inspector below 1160px and exposes it as a route-addressable sheet or drawer.
Mobile uses sheet or full route only for inspector content.
Main content uses `minmax(0, 1fr)` and always sets `min-width: 0`.
Every grid child that can contain text sets `min-width: 0`.

## Height and padding contract

Owner: `docs/architecture/ui-system.md` §Layout contract.
Topline has 72px minimum height on desktop and tablet.
Mobile topline content may wrap but keeps 16px padding.
Composer input has 42px minimum height inside a `14px 24px` footer.
Mobile composer keeps 42px input height with 16px horizontal padding.
Page padding around the shell is 26px on desktop, 20px when cramped on tablet, and 16px on mobile.
Content padding is 24px on desktop, 20px when cramped on tablet, and 16px on mobile.
Inspector padding is `22px 18px` on desktop and `20px 16px` in sheets.
Buttons have 36px minimum height on desktop and tablet.
Primary buttons use a 38px minimum touch target on mobile.
Navigation rows have 32px minimum height on desktop and 36px when touch-first on mobile.
Data rows have 54px minimum height with `11px 0` vertical padding on desktop.
Mobile data rows use single-column layout with `12px 0` padding and wrapped state text.
Field rows use two columns with a 92px label and flexible value on desktop.
Mobile field rows collapse to one column only when the value becomes unreadable.
Graph stage has 600px minimum height on desktop and 560px allowed on tablet.
Mobile graph uses a separate graph route and never a cramped miniature.

## Spacing rhythm

Owner: `docs/architecture/ui-system.md` §Spacing contract.
The base grid is 4px.
Default rhythm uses 8, 12, 16, 18, 22, 24, 26, 32, and 42px.
Shell padding stays larger than content padding.
Section separation uses a divider plus 26px top margin on desktop.
Section headers use 12px bottom margin.
Row title and row metadata use 3px vertical separation.
Focus areas use 28px horizontal separation between text and actions.
Inspector field rows use 12px vertical padding plus a divider.
No layout relies on `br` for spacing or wrapping.

## Overflow contract

Owner: `docs/architecture/ui-system.md` §Height and overflow contract.
Main content and right inspector scroll independently.
Left navigation does not scroll until the viewport is genuinely too short.
The composer stays attached to the bottom of the main pane while the main pane scrolls.
The right inspector never overlaps the center surface.
Source preview scrolls internally only for real document content.
Nested scroll containers are forbidden except for document preview, code blocks, graph canvas, and command palette result lists.
Long object titles, source names, email subjects, file names, and URLs use `overflow-wrap: anywhere`.
Row state text may use `white-space: nowrap` on desktop only.
Row state text wraps on mobile.
A source, citation, visibility, risk, or approval label is never visible only after horizontal scroll.

## Responsive verification

Owner: `docs/architecture/ui-system.md` §Height and overflow contract and `docs/process/evidence-bundles.md` §Frontend Evidence.
Mandatory viewports are 1440x1200 for full desktop, 1280x800 for cramped laptop, 1024x768 for tablet landscape, and 390x844 for mobile.
Screenshot review rejects overlap between text and other elements.
Screenshot review rejects awkward button label wrapping.
Screenshot review rejects right-panel fields pushed outside their column.
Screenshot review rejects hidden action or risk information in rows.
Screenshot review rejects competing badges or pills that remove primary action priority.
Screenshot review rejects source, citation, or visibility labels that require horizontal scrolling.

## Keyboard and accessibility

Sidebar toggles with command or control plus B.
Command palette opens with command or control plus K.
All interactive surfaces work with keyboard-first flows.
Icon-only controls carry accessible labels.
Status uses color plus shape and never color alone.
Focus rings stay visible.
Hit targets meet 32 to 40px.
Contrast meets body 4.5 to 1 and large text 3 to 1.
Reduced motion preferences are honored.
Motion stays motivated with 150 to 250ms ease-out and no decorative loops.

## Visual discipline

Rows, dividers, alignment, and field lists come before boxes.
Cards are allowed only for repeated object previews, modals, and genuinely framed tools.
Nested cards are forbidden.
Soft status tint-pills are permitted.
Loud solid-block pills are avoided as default decoration.
There is exactly one accent moment and one primary action per view.
Selection uses a soft filled warm-neutral pill.
Hard highlights, left-border selection bars, and heavy focus rings are avoided.
Texture is limited to one hand-made signature per surface on eligible cover strips, empty states, and panel top edges.
Texture never sits behind body text and never covers a full page background.

## Implementation notes for frontend

Sidebar uses the [shadcn sidebar](https://ui.shadcn.com/docs/components/base/sidebar) primitive with the Atlas width tokens.
Center and inspector use a [resizable](https://ui.shadcn.com/docs/components/base/resizable) split on desktop and stacked sheet behavior on smaller widths.
Command palette uses the [command](https://ui.shadcn.com/docs/components/base/command) primitive.
Inspector tabs use the [tabs](https://ui.shadcn.com/docs/components/base/tabs) primitive.
Overlays use [dialog](https://ui.shadcn.com/docs/components/base/dialog), [sheet](https://ui.shadcn.com/docs/components/base/sheet), and [drawer](https://ui.shadcn.com/docs/components/base/drawer) per breakpoint.
Scrolling uses [scroll area](https://ui.shadcn.com/docs/components/base/scroll-area) and dividers use [separator](https://ui.shadcn.com/docs/components/base/separator).
Field rows use label plus value components and not ad hoc divs.
Data surfaces use tabular figures with the value as hero and muted labels.
Telemetry and provenance use monospace in tightly scoped places.
Human temporal labels stay in Space Grotesk.
State coverage includes loading, empty, error, unauthorized, offline, low-confidence, and action-approval.
Evidence uses agent-browser screenshots and snapshots at desktop and mobile widths.
