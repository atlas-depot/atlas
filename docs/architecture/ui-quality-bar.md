# Atlas UI Quality Bar

Status: binding design reset  
Audience: Efe, frontend/design owners, and AI agents

## Current decision

The first static UI prototype is rejected.
It is not production-grade.
It must not be used as the Atlas visual source of truth.

The failure was not one isolated color or spacing bug.
The artifact failed at taste, hierarchy, typography, spatial rhythm, density control, and product judgment.
It looked like a wireframe with design paint, not a publishable consumer SaaS surface.

## Invariant

Atlas is a trust product.
If the UI looks careless, users will not trust AI memory, citations, permissions, or action approvals.
Visual quality is therefore not decoration.
It is part of the trust model.

Do not lower this bar for speed.
If quality and scope conflict, reduce scope.
Do not ship a broad UI with mediocre taste.

## Rejected patterns

- Dashboard made from repeated cards.
- Cards inside cards.
- Pill/status flood.
- Random small labels, counters, letters, shortcut hints, or attention markers.
- Decorative orbs, glow, generic AI gradients, or fake sophistication.
- Center-dumped layouts.
- Large panels with weak hierarchy.
- Typography that feels default, cramped, or anonymous.
- Line height that ignores reading comfort.
- UI that depends on `<br>` for layout.
- Right panels that compete with or overlap primary content.
- Source, risk, visibility, and approval states shown as decoration instead of system facts.
- Screens that only look acceptable at one viewport.

## Accepted product feel

Atlas should feel like a private operating desk for memory work.
It should be calm, precise, durable, and editorial.
The user should feel that the product knows what matters and can prove where it came from.

The closest direction is:

- Linear and Vercel for operational clarity.
- Notion for calm document and object surfaces.
- OpenAI for restrained conversational space.
- Superhuman for command speed and density.
- Obsidian for graph/memory inspection.

These are reference categories, not copying targets.

## Required design reset process

Do not jump straight into another full HTML screen.

1. Build a reference audit.
   Collect 20 to 30 concrete screenshots or source links from the reference category.
   Annotate why each one works or fails for Atlas.
   Worked example from the 2026-07-01 pass (historical): `docs/design/atlas-ui-reference-audit.md`.

2. Extract principles.
   For each reference, identify typography, density, margins, hierarchy, navigation, inspector behavior, action states, and empty/error states.

3. Propose three directions.
   Each direction must include palette, typography, spacing rhythm, component density, and a Today screen composition.
   Do not make three slight color variants.
   Worked example from the 2026-07-01 pass (historical): `docs/design/atlas-ui-directions.md`.

4. Select one direction with Efe.
   Efe is the product owner and final gate for visual direction until ownership is delegated.
   Current decision: warm minimalism, approved on 2026-07-16. It supersedes Direction A, Quiet Ledger Desk (2026-07-01).
   Locked tokens: `docs/design/atlas-design-tokens.md`. Rationale: `docs/design/ui-rulebook.md`.

5. Produce a small high-fidelity slice.
   Build only Today plus right inspector plus composer first.
   Do not build Inbox, Graph, Search, or Shared Spaces until Today passes review.
   Rejected artifact: the `atlas-today-slice` prototype (removed from the repo, archived locally).
   Do not resurrect that artifact.
   The next slice must be redesigned from scratch.

6. Verify in browser.
   Capture screenshots at `1440x1200`, `1280x800`, `1024x768`, and `390x844`.
   Reject the slice if text overlaps, clips, floods attention, or loses hierarchy.

7. Only then expand the system.
   Translate the accepted slice into tokens, components, Storybook stories, and route mockups.

## Minimum spec before implementation

Every UI implementation task must specify:

- Exact viewport targets.
- Column widths.
- Page and content padding.
- Row heights.
- Button heights.
- Inspector width and collapse behavior.
- Composer behavior.
- Overflow and wrapping behavior.
- Source/citation/visibility/risk representation.
- Empty, loading, error, offline, and low-confidence states.
- Screenshot acceptance criteria.

## Today screen acceptance bar

The first accepted Today design must prove:

- One primary attention target.
- No card grid.
- No nested cards.
- No decorative pills.
- No visual noise from counters or shortcut hints.
- Right inspector reads as a calm field surface, not a tag cloud.
- Source basis is visible but not louder than the action.
- Draft and approval risk are obvious without screaming.
- Long source names and action titles wrap cleanly.
- The screen feels usable for four hours of daily work.

## Agent rule

If a generated UI does not feel publishable by a top-tier product company, stop.
Do not keep patching colors and margins.
Mark the artifact as rejected, explain the failure, and restart from references and principles.
