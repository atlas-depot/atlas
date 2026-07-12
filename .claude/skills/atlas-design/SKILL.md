---
name: atlas-design
description: Design or critique Atlas product UI, design system, tokens, reference imagery, interaction patterns, dashboard, inbox, graph, chat, object inspector, shared spaces, privacy center, and action approval surfaces. Use for visual direction, component specs, screenshots, design QA, or frontend design ownership.
---

# Atlas Design Skill

Use this skill for design specs, design-system work, UI review, screenshot review, and frontend design ownership.

## Required Reading

Read:

- `AGENTS.md`
- `docs/process/agent-alignment.md`
- `docs/architecture/ui-system.md`
- `docs/architecture/ui-quality-bar.md`
- `docs/design/atlas-ui-reference-audit.md`
- `docs/design/atlas-ui-directions.md`
- `docs/architecture/frontend.md`
- `docs/architecture/privacy-redaction-policy.md`
- `docs/architecture/product-invariants.md`
- `docs/process/owner-onboarding.md`

## Design principles

- Dark-first, high-taste, consumer-grade SaaS.
- Command-center feel.
- Calm but powerful.
- Every AI claim has source affordance when grounded.
- Every object has visibility and provenance cues.
- Every action has risk and approval cues.
- Keyboard-first command workflows.
- Structured surfaces first; chat is persistent but never the whole product.
- Dense but calm. Avoid generic AI gradients, noisy animations, excessive icons, and repetitive pill cards.
- Do not copy Linear, Obsidian, Notion, Superhuman, or ChatGPT. Use them as reference categories only.

## Quality Gate

The current static prototype is rejected.
Do not treat `docs/prototypes/atlas-ui-system/index.html` as accepted visual direction.
Use it only for lessons learned, layout constraints, and overflow failure modes.

If a generated UI does not feel publishable by a top-tier product company, stop.
Do not keep patching colors and margins.
Mark the artifact as rejected, explain why, and restart from references and principles.

Before making another high-fidelity UI artifact:

- Build a reference audit.
- Extract typography, spacing, density, hierarchy, navigation, inspector, and action-state principles.
- Propose three substantially different directions.
- Get Efe's approval on the direction.
- Build only Today plus right inspector plus composer first.
- Screenshot-test the accepted slice before expanding to other screens.

Current reset artifacts:

- `docs/design/atlas-ui-reference-audit.md`
- `docs/design/atlas-ui-directions.md`

## Design System Contract

Define or review:

- Color tokens: background, surface, border, text, muted text, accent, danger, warning, success, focus.
- Typography tokens: font family, sizes, weights, line heights. Do not scale font size with viewport width.
- Spacing tokens: compact knowledge-work density, consistent 4/8px rhythm.
- Layout tokens: shell rail width, app rail width, inspector width, topline height, composer height, content padding, row height, field row grid, graph canvas minimum height, responsive breakpoints.
- Radius tokens: cards and controls should stay restrained; default card radius 8px or less unless design system changes.
- Elevation/border tokens: dark-first depth through subtle borders and contrast, not glow-heavy decoration.
- Motion tokens: only meaningful interaction feedback; no decorative motion by default.
- Icon policy: use library icons where possible; do not replace standard icons with text buttons.
- Component states: default, hover, active, focus, disabled, loading, error, selected, permission-redacted.

If tokens do not exist yet, propose a minimal token set before component work.

## Layout Precision Requirements

Do not produce UI work that only describes mood, colors, or general inspiration.
Every Atlas design spec or implementation must define concrete margin, padding, height, width, wrapping, and overflow behavior.

Required layout details:

- Desktop, tablet, and mobile column behavior.
- Exact left navigation width, right inspector width, content padding, topline height, composer height, row minimum height, button height, and field-list column sizes.
- Which surfaces scroll and which surfaces stay pinned.
- How long titles, URLs, file names, source names, email subjects, and action labels wrap.
- What happens when the right inspector is hidden.
- What happens when the graph, source preview, command palette, or document preview overflows.
- Which viewport sizes must be screenshot-tested.

Default Atlas measurements until changed by a design-system decision:

- Product shell: `100vh` minimum height.
- Prototype shell rail: `232px`.
- App left navigation: `216px` desktop and `190px` tablet.
- Right inspector: `326px` desktop, hidden below `1160px`.
- Topline: `72px` minimum height.
- Content padding: `24px` desktop and `16px` mobile.
- Page padding: `26px` desktop and `16px` mobile.
- Inspector padding: `22px 18px`.
- Button height: `36px` minimum.
- Navigation row height: `32px` minimum.
- Data row height: `54px` minimum.
- Composer input height: `42px` minimum.
- Graph canvas height: `600px` minimum desktop.

Overflow rules:

- Every text-bearing grid child must have `min-width: 0`.
- Long memory text must use `overflow-wrap: anywhere`.
- Row states can be `nowrap` only on desktop.
- Mobile row states must wrap under the title.
- Main content and inspector scroll independently.
- Nested scroll containers are allowed only for document previews, code blocks, graph canvases, command palette result lists, or explicit source previews.
- Any overlap, clipped label, accidental horizontal scroll, or hidden source/risk state is a design bug.

## Tools And Evidence

Use available tools appropriately:

- Figma if a design file exists or the user asks for visual design artifacts.
- Storybook for source-of-truth UI components, states, design tokens, and mock surfaces.
- Paper, Pencil, Figma, or standalone HTML explorations only as references until translated into code-backed stories and route mockups.
- `agent-browser` for implemented UI screenshots, annotated screenshots, snapshots, and responsive smoke checks. Install it if missing before claiming screenshot evidence.
- Playwright or browser tooling for responsive checks.
- Image generation or image search only when a real visual asset is needed and the source/licensing path is acceptable.

Agent-browser screenshot baseline:

```bash
command -v agent-browser || npm install -g agent-browser@0.31.1
agent-browser open http://localhost:3000
agent-browser wait --load networkidle
agent-browser screenshot --full
agent-browser screenshot --annotate
agent-browser snapshot -i
```

Use annotated screenshots when reviewing interaction density, command palette, right panel affordances, graph controls, forms, or action approval surfaces.

Reference images:

- Store durable references in docs or design files, not scattered chat context.
- Cite source/usage if using external images.
- Do not use reference images as a substitute for inspecting the implemented UI.

## Surfaces

- Today dashboard
- Capture inbox
- Chat
- Search
- Graph
- Object inspector
- Document library
- People
- Projects
- Shared spaces
- Privacy center

## Spec Requirements

For each surface include:

- Primary user job.
- Layout.
- States: loading, empty, error, unauthorized, offline, low-confidence AI, action approval.
- Components.
- Data needed.
- Keyboard interactions.
- Permission/provenance/citation affordances.
- Screenshot/preview acceptance criteria.
- Token/component impact.
- Reference examples or mood direction when useful.

## Review checklist

- Is the primary action obvious?
- Is the user protected from AI mistakes?
- Are confidence and provenance visible?
- Can the user correct memory quickly?
- Are keyboard flows considered?
- Are empty/error states useful?
- Is visual density appropriate for knowledge work?
- Are margins, paddings, heights, and overflow behavior specified rather than implied?
- Has the screen been checked at `1440x1200`, `1280x800`, `1024x768`, and `390x844` when UI changed?
- Does text fit on mobile and desktop?
- Does any UI imply an action happened before approval?
- Are source/citation/visibility/risk states visible without clutter?
- Does the design still work in empty, low-data, and error-heavy states?
- Does the right context panel work for every object type?

## Output

Give a design spec with layout, tokens, components, states, interactions, copy, reference direction, screenshot requirements, and acceptance criteria.
