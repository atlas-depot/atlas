# Atlas design tokens (LOCKED · 2026-07-16)

The locked Atlas visual system: **warm minimalism**. Warm paper ground in light, warm off-black ("Warm Slate") in dark; white/near-black surfaces float on the ground with elevation built from **temperature + value steps, not borders or shadows**; exactly **one cobalt accent** rationed to the live/primary element; colors appear as soft **pastel tint-pills**; data surfaces use a real **Bayer 4×4 ordered dither** with **Geist Mono** labels. Full rationale + laws: `~/oss/efe-ui-rulebook.md` (Warm minimalism addendum).

Both modes are generated from one source via a theme map (see the Paper build), so light and dark are a true toggle.

## Palette — Light (warm-pastel)

| role | token | hex |
|---|---|---|
| ground | `--bg` | `#F0EEE9` |
| surface | `--surface` | `#FFFFFF` |
| raised | `--raised` | `#FBFAF7` |
| fill | `--fill` | `#F1EFEA` |
| border | `--border` | `#E7E3DA` |
| divider | `--divider` | `#D8D3C8` |
| text-muted | `--muted` | `#A8A399` |
| text-secondary | `--secondary` | `#6E6A62` |
| text-body | `--body` | `#3B3833` |
| text-heading | `--heading` | `#1A1917` |
| accent | `--accent` | `#3E68E6` |
| accent-deep | `--accent-deep` | `#2C4FC4` |
| accent-tint | `--accent-tint` | `#EAF0FC` |

Semantic (fg / tint): success `#2E9E63` / `#E7F5EC` · warning `#C07E33` / `#FAF0DE` · error `#CD5B49` / `#F9EAE6` · info `#3E68E6` / `#EAF0FC` · new `#DE5C8C` / `#FBE8F0`

Data / object-identity (fg, use on a ~12% tint): cobalt `#6E8CEF` · coral `#E5836F` · green `#57B184` · amber `#DFA24F` · teal `#54B7B0` · violet `#A98AEF`

## Palette — Dark (Warm Slate)

| role | token | hex |
|---|---|---|
| ground | `--bg` | `#0A0A0B` |
| rail | `--rail` | `#121214` |
| surface | `--surface` | `#17171A` |
| raised | `--raised` | `#1C1C1F` |
| border | `--border` | `#2A2A2E` |
| divider | `--divider` | `#242427` |
| text-muted | `--muted` | `#8A867E` |
| text-secondary | `--secondary` | `#A6A29A` |
| text-body | `--body` | `#D4D2CD` |
| text-heading | `--heading` | `#F2F2F3` |
| accent | `--accent` | `#6E8CEF` |
| accent-deep | `--accent-deep` | `#4E6FE0` |
| accent-tint | `--accent-tint` | `#1E2740` |

Semantic (fg / tint): success `#4FC08A` / `#14291D` · warning `#E6B24A` / `#2A2113` · error `#E27A63` / `#2E1714` · info `#6E8CEF` / `#1E2740`

Data: cobalt `#6E8CEF` · coral `#E8917C` · green `#5FC896` · amber `#E6B24A` · teal `#5FC8C0` · violet `#B79BF0`

## Typography
- Body & UI: **Inter** (current) or **Geist**. Headers/eyebrows/temporal: **Space Grotesk**. Data/telemetry (IDs, counts, timestamps, chart labels): **Geist Mono**. Display/pixel moments (in code only): **Geist Pixel** (Vercel, OSS). No serif.
- Weights 400 / 500 / 600 (never 700). Hierarchy from three text colors + two weights + the sans/mono split, not bold.
- Sentence case; UPPERCASE + ~0.06em tracking only for 11-12px muted section labels + tiny badges.
- Tabular figures on all data; the value is the hero (largest, darkest, isolated), label muted.

## Spacing / radii / elevation
- Space scale: 4 / 6 / 8 / 10 / 12 / 16 / 20 / 24. Radii: chip 5-6 · control 8-10 · card 12-14 · panel 14 · shell 22 · pill 999.
- Shell: floating rounded card (radius 22) on the ground, equal outer margin; rail ~252 / center / inspector ~344.
- Elevation = ~2% value/temperature steps (ground < rail < surface < raised); **no borders/shadows for elevation**. Shadows only on the app shell + floating panels/menus + composer. Selection = soft filled warm-neutral pill.

## Data visualization (dither-kit style)
- Charts (bar / area / line / donut / sparkline) use a **Bayer 4×4 ordered dither** fill (dense on the value, sparse on the remainder = a dithered gradient), labels in **Geist Mono**, one hue per series from the Data palette.
- In code: the real [`dither-kit`](https://www.tripwire.sh/dither-kit) is an option, but vet its deps first — it needs shadcn + Tailwind + motion + d3 and a `<canvas>` runtime (it is NOT dependency-free). A static SVG `<pattern>` Bayer fill (as used in the Paper design) has zero deps if that is preferred.

## Tailwind v4 `@theme` (drop-in)

```css
:root {
  --bg:#F0EEE9; --surface:#FFFFFF; --raised:#FBFAF7;
  --fill:#F1EFEA; --border:#E7E3DA; --divider:#D8D3C8;
  --muted:#A8A399; --secondary:#6E6A62; --body:#3B3833; --heading:#1A1917;
  --accent:#3E68E6; --accent-deep:#2C4FC4; --accent-tint:#EAF0FC;
  --success:#2E9E63; --warning:#C07E33; --error:#CD5B49; --new:#DE5C8C;
}
:root[data-theme="dark"] {
  --bg:#0A0A0B; --surface:#17171A; --raised:#1C1C1F;
  --fill:#1C1C1F; --border:#2A2A2E; --divider:#242427;
  --muted:#8A867E; --secondary:#A6A29A; --body:#D4D2CD; --heading:#F2F2F3;
  --accent:#6E8CEF; --accent-deep:#4E6FE0; --accent-tint:#1E2740;
  --success:#4FC08A; --warning:#E6B24A; --error:#E27A63; --new:#DE5C8C;
}
```
