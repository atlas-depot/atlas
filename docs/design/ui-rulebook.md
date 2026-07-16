# Efe UI Rulebook

A cross-project rule set for interfaces that look **hand-crafted, human, and calm** - as if a person with taste built them by hand and left them clear. Extracted from the Atlas design system.

Two layers:
- **Strict** rules - the same in every project (typography, spacing, layout discipline, iconography, states, motion, accessibility, and the *method* for choosing color/type).
- **Variable** per project - the actual color palette and font families. These change; the rules for choosing them do not.

---

## 0. The one principle

Every choice serves one test: **would a person with taste have made this by hand, and does it feel calm?** Restraint over decoration. Clarity over cleverness. When unsure, remove. Warmth comes from care and small human touches, never from noise (gratuitous gradients, icon soup, pill-cards, confetti).

---

## 1. Workflow (strict)

1. **Design in a design tool first** (Paper MCP or Figma MCP), never freehand CSS. Tokens before pixels.
2. **Define the token set per project** (section 2), then compose screens from a small component vocabulary. Never hardcode a value that should be a token.
3. **Build incrementally** - one visual group per write. Screenshot after each meaningful group and run the taste test (section 11).
4. **Trace vertical lanes** after every 3 repeated rows; fix alignment before moving on.
5. **Reuse** - generators/recipes for repeated structure, clone over rewrite. The second identical block is a signal to make a component.

---

## 2. Tokens - the contract (structure strict, values variable)

Define once, in Tailwind v4 namespaces. Everything references a token.

```
--font-*         family names
--color-*        ground, neutrals ramp, primary accent, semantic set
--text-*         font sizes
--font-weight-*  400 / 500 / 600
--tracking-*     letter spacing (em)
--leading-*      line heights (px)
--radius-*       chip / control / card / shell
--space-*        4 6 8 10 12 16 20 24
--shadow-*       one elevation recipe, reused
```

A minimal token set covers all namespaces even if unused at first. Tokens are the foundation; get them right and the screens fall out.

---

## 3. Typography (STRICT)

- **One family does ~90%** of the UI - a neutral humanist sans. Add a second family only for a specific job (a display face, or a serif for long-form/source text), never for decoration.
- **Scale (px):** 11-12 labels/meta · 13-14 body & UI · 15-16 section titles · 22-24 page headlines · 30+ hero. About 6 steps, ratio ~1.2-1.25. No more steps than you need.
- **Weight:** 400 body · 500 UI labels & list titles · 600 headings/emphasis. 700 rarely. **Create hierarchy with weight contrast, not just size.**
- **Line-height:** ~1.5 for body (e.g. 22px on 14px), tight for large (e.g. 30px on 24px). Prefer px.
- **Tracking:** slightly negative on large type (−0.01 to −0.02em); 0 on body; slightly positive (+0.05-0.06em) on all-caps micro-labels.
- **All-caps** only for tiny section labels (10.5-11px, muted, tracked). Never for sentences.
- **Numbers** in tables/metrics use **tabular figures**.
- **Floors:** never below 11px except all-caps micro-labels. Text contrast is non-negotiable; muted color is a hierarchy tool used sparingly, never for anything that must be read.

---

## 4. Color (METHOD strict, palette variable)

**Palette shape** (every project): 1 ground · a 5-6 step neutral ramp · **1 primary accent** · a muted semantic set (success/warning/error/info) · at most 1 secondary accent.

**How to choose a harmonious palette:**
1. **Commit to a mood word first** (a physical register: mineral, maritime, bookish, editorial, candlelit…). Derive every color from **one real scene** so they belong together. If you can't name the scene, the palette is glued together and will read as such.
2. **Ground:** default **pure white** for product/SaaS/dashboards. Tinted off-white (cream/bone) only when the mood specifically calls for it.
3. **Neutrals:** one hue family, evenly stepped (e.g. `#FAFAFA → #ECECEC → #9A9A9A → #5A5A5A → #1C1C1C`). Do not mix cool and warm grays. Tinted gray without a scene reason reads as indecision.
4. **One accent carries the brand.** High-chroma reads well on white; use it sparingly. **One intense, beautiful color moment beats five.**
5. **Semantic colors muted, not neon**, pulled from the same scene. Status must also carry a shape (icon/dot), never color alone.
6. **Contrast:** body ≥ 4.5:1, large text ≥ 3:1, UI/icons clearly legible.
7. **Avoid the clichés:** warm off-white × red/terracotta; dark navy/charcoal × electric purple/lime/teal (2019-2024 SaaS); pure white × muted earth tone; tinted warm ground × high-chroma accent.

**Surface discipline (strict, any palette):** cards are **flat with a hairline border**, not shadowed boxes. **Shadows only for true elevation** - the app shell, floating panels/menus, the composer. One shadow recipe, reused. This single rule is most of what makes a UI read "crafted" instead of "template."

---

## 5. Layout & shell (strict patterns)

- **Shell:** a floating app card on a soft ground; **left nav rail (~252px) / center / optional right context panel (~344px)**. The right panel is a field-list inspector or a contextual panel, not a second nav.
- **Spacing rhythm:** 4 / 6 / 8 / 10 / 12 / 16 / 20 / 24. Row padding 8-12 vertical; card padding 12-18; section gaps 20-24. Vary deliberately - tighter to group, generous to let hero content breathe.
- **Vertical lanes:** fixed-width slots (with `flex-shrink:0`) for icons (~20px) and trailing actions, even when empty in a row. Never align columns with `gap` alone.
- **Density matches the domain.** Data-heavy tools → dense rows + hairline tables. Marketing/landing → airy. Decide density on purpose; don't default airy onto dense data.
- **Radius scale:** chips 5-6 · controls/rows 8-10 · cards 12-16 · shell 22.
- **One primary action per view** (dark solid). Everything else ghost/outline. One CTA.

---

## 6. Iconography (strict)

- **One icon set**, monochrome line, ~1.7-1.9 stroke on a 24 grid, rendered 15-18px in UI. Never mix sets. (Hugeicons is the default; avoid lucide unless a project requires it.)
- Icons ride a **fixed slot**; the **label carries meaning**, the icon supports it.
- **Status = color + shape** (check / clock / alert / filled dot), never color alone.

---

## 7. Component vocabulary (build once, reuse)

Buttons (primary / ghost / outline) · badges & chips (count / status / semantic) · list-or-table card (hairline-divided rows) · key-value rows (label lane + value) · section micro-labels · toggles & checkboxes · the inspector (a **field list, not cards**) · empty states · timeline · confidence/meter bar. Compose screens from these; don't reinvent per screen.

---

## 8. Empty & edge states (doctrine)

**Never a blank. Never blanket celebration. Earned, contextual, forward-looking.** Key the tone to a signal the product actually has:

- **Cold** (new or inactive) → onboarding nudge, one CTA, reassurance that it's intentional. Do **not** celebrate.
- **Quiet** (idle but an active user) → calm + **forward-looking** (what's coming next); no praise, offer a light next step, avoid the dead-end.
- **Earned clear** (the user did real work) → a calm reward **plus a concrete receipt** of what was handled ("4 reviewed · 2 drafted · 1 closed"). **Praise proportional to effort; concrete beats confetti.**

Rationale: a blank screen reads as broken and triggers mild anxiety (Zeigarnik); hollow, unearned praise causes badge fatigue and feels manipulative; a real "you're done" moment, kept calm, is a genuine reward (the Superhuman inbox-zero effect). Calm confidence, not dopamine.

- **Error:** reassure it isn't broken, give a recoverable action + retry, an audit id, privacy-safe detail, and **never** secrets or raw prompts.
- **Loading:** skeletons that match the final layout, not spinners on blank.
- **Unauthorized:** no leakage - don't reveal whether the hidden thing even exists.

---

## 9. Motion (restraint)

Motion is **motivated** - enter/exit, state change, spatial continuity. 150-250ms, ease-out. No decorative loops, no confetti. Always honor `prefers-reduced-motion`.

---

## 10. Accessibility (non-negotiable, every project)

Contrast minimums (section 4) · visible focus rings · full keyboard paths · hit targets ≥ 32-40px · labels on icon-only controls · semantic structure and landmarks · verify at **mobile width**. Never trade accessibility for style; if they conflict, the style is wrong.

---

## 11. The taste test (run before shipping any screen)

- Would a person with taste have made this **by hand**?
- What can I **remove**?
- Do the **vertical lanes** line up?
- Is there **exactly one** accent moment and **one** primary action?
- Are cards **flat with hairlines**, shadows only where something truly floats?
- Does it feel **calm**?
- Does it hold up at **mobile width**?

---

## Per-project setup checklist

1. Pick a **mood word** and the scene it comes from.
2. Derive the **palette** (section 4) and choose **font families** (section 3).
3. Generate the **token set** (section 2) in the design tool.
4. Build the **shell** and the **component vocabulary** once.
5. Compose screens; screenshot-QA each; run the taste test.

Strict rules travel unchanged. Only the palette and fonts are yours to set per project.

---

# Addendum: Warm minimalism (from the 31-image inspiration audit)

The single biggest finding: **your taste is warm minimalism, not cool.** Every reference floats pure-white cards on a warm off-white *paper* ground, builds elevation from **temperature and value steps** (not borders or shadows), rations **one** saturated accent to a single live/action element, and carries **one** hand-made analog texture per surface against otherwise ruthless monochrome. Cool-neutral grays + an electric accent on clinical white is the "cold cousin" that felt disharmonious - the cure is warmth as the harmonizing agent, not more color.

## Warm laws (strict - override the cool defaults above)
- **Never ship a pure `#FFFFFF` or `#000000` ground.** Light ground is warm paper `#F0EEE9`; dark ground is warm off-black `#0A0A0B`. White is only for floating surfaces.
- **Elevation is temperature + ~2% value steps, not borders/shadows:** paper ground < rail (white-minus) < card (white) < inspector. In dark, a `#0A0A0B → #141416 → #1C1C1F` tone ladder does the separation.
- **Re-derive the whole neutral ramp from the ground's warm hue** so grays read warm, never blue-gray. Ink is `#1A1A1A` (never `#000`); dark-mode text is `#F2F2F3` (never `#FFF`).
- **One accent per view**, spent only on the single live/active/committing element. If the accent stays cool, the warm ground is what integrates it.
- **Selection is a soft filled warm-neutral pill.** Ban hard highlights, left-border selection bars, heavy focus rings. Chrome is failure.
- **Colors appear as soft pastel tint-pills** (tint bg + friendly same-hue fg), never as loud solid blocks.
- **One hand-made texture per surface, product-wide** (a dithered/halftone bloom OR film-grain-over-gradient OR a dot-grid at panel edges) - pick exactly one signature and repeat it. Texture lives only on card-header cover strips, empty states, and panel/section top edges; never behind body text, never a full-page background. The analog grain IS the "made by a person" signal; a clean CSS mesh reads templated. One craft move per surface - never stack texture + shadow + gradient.
- **Left-anchor content with a deliberate large right margin;** never center-fill or stretch to the panel edge. Crop off the edge to imply "more" instead of adding chrome.
- **Group related rows into one hairline-divided container;** reserve the floating-card treatment for genuinely distinct objects. Hang a card's title + relative timestamp *outside and below* it; keep the card face clean (icon + preview only).
- **Give each object type a single-hue identity** (text + ~10% fill + ~30% border, or a glossy 3D gem) so a dense app is scannable by color while the chrome stays neutral.

## Typography (strict - his fingerprint)
- Sans-only, absolute. **Space Grotesk** for headers, eyebrows, and all human temporal/metadata; content sans (Geist/Inter) for body. **Never a serif** - translate any "editorial signature" instinct into Space Grotesk. (Atlas currently ships Inter; introduce Space Grotesk on headers when adopting this addendum.)
- Hierarchy from **three text colors + two weights (400/500/600, never 700) + the sans/mono split**, not bold. Never bold a description.
- **Sentence case everywhere.** UPPERCASE + ~0.08em tracking only for 11-12px muted rail section labels and tiny badges.
- **The value is the hero** on any data surface: largest, darkest, most isolated, tabular figures; label tiny and muted.
- Optional **monospace** (tightly scoped) for telemetry/provenance only - IDs, source URLs, "edited 14s ago", token/source counts - so they read *instrumented*. Human temporal labels (today, 2d, Fri) stay in Space Grotesk.
- Empty state = one warm sentence-case question at ~28-32px medium, on a mark → question → input vertical rhythm.

## Locked Atlas palette (warm-pastel)
- **Ground/surface:** Paper `#F0EEE9` · Surface `#FFFFFF` · Raised `#FBFAF7`
- **Warm neutrals:** Fill `#F1EFEA` · Border `#E7E3DA` · Divider `#D8D3C8` · Muted `#A8A399` · Secondary `#6E6A62` · Body `#3B3833` · Heading `#1A1917`
- **Cobalt accent (one, softened):** Primary `#3E68E6` · Deep `#2C4FC4` · Tint `#EAF0FC`
- **Semantic tint-pills:** Completed `#2E9E63`/`#E7F5EC` · Warning `#C07E33`/`#FAF0DE` · Error `#CD5B49`/`#F9EAE6` · Info `#3E68E6`/`#EAF0FC` · New `#DE5C8C`/`#FBE8F0`
- **Object identity / data (Gantt, graph, tags):** Cobalt `#6E8CEF` · Coral `#E5836F` · Green `#57B184` · Amber `#DFA24F` · Teal `#54B7B0` · Violet `#A98AEF` (each on a ~12% tint)

## Three shipped directions (pick per surface)
- **Paper & Ink** (default, keeps the cobalt fingerprint): warm paper + white shell + warm neutrals + the one cobalt spark; a dithered warm halftone bloom on capture/collection card headers, a dot-grid at the inspector's top edge, a mascot only on empty states.
- **Paper & Clay** (bolder, most hand-crafted): swap the accent to clay/terracotta `#C96442` (darken to ~`#A9502F` for 4.5:1 on paper) so accent and ground share temperature; blue demoted to links; film-grain card covers + glossy identity gems.
- **Warm Slate** (dark-first working shell): warm off-black `#0A0A0B` tone-ladder, soft-white ink, a single burnt-orange live/now dot `#F0531C`, mono for all data, an anchored glass hover-preview inspector, a dawn/dusk dither felt only at the bleed edges.

## Data visualization & dither (locked)
- Charts and data fills use a real **ordered (Bayer 4×4) dither**, not a halftone dot-screen: dense pixels on the value, sparser on the remainder, so a bar / area reads as a **dithered gradient** - the 1-bit, made-by-a-person character. A smooth CSS gradient reads templated.
- Chart labels and all telemetry/data (values, counts, percents, IDs, timestamps) set in **monospace** (Geist Mono in design; **Geist Pixel** for display moments in code). The number is the hero; the label muted.
- One hue per series from the Data palette; dither pixels light on a saturated fill, the series hue on the light-tint remainder. Unchanged in light and dark.
- In code, `dither-kit` (tripwire.sh/dither-kit) is a candidate but NOT dependency-free (needs shadcn + Tailwind + motion + d3 + a canvas runtime) - vet before adopting; a static SVG `<pattern>` Bayer fill is the zero-dependency alternative.

## Light + dark is one toggle
Author once; derive dark from the same source by remapping tokens (ground/surface invert to a warm off-black ladder, ink to soft-white, the one accent brightens, semantics shift to dark tints). Never hand-maintain two sets. Dark ground is warm off-black `#0A0A0B` (never `#000`); dark ink `#F2F2F3` (never `#FFF`).

> **Atlas reference implementation** (locked palette light+dark, type, spacing, dither, Tailwind `@theme`): `docs/design/atlas-design-tokens.md`.
