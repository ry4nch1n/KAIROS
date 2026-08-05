---
name: KAIROS GameRadar
description: A dense market-intelligence instrument for indie-game build/no-build decisions.
colors:
  page: "#f4f6fb"
  page-sunken: "#eef2f9"
  surface: "#ffffff"
  surface-2: "#f1f5fb"
  border: "#dbe3ef"
  border-soft: "#e6ecf5"
  ink: "#14213a"
  ink-2: "#4a5b78"
  ink-3: "#5b6b86"
  ink-4: "#8493ad"
  focus-blue: "#1d4ed8"
  focus-blue-deep: "#1e40af"
  attention-umber: "#8a3f07"
  verdict-green: "#047857"
  verdict-red: "#b91c1c"
  route-violet: "#6d28d9"
  spotlight-cyan: "#0e7490"
  on-fill: "#ffffff"
  plate: "#0b0f16"
  plate-edge: "rgba(255, 255, 255, 0.08)"
  chart-context: "#6b7a94"
  chart-context-fill: "#c3cfe2"
typography:
  display:
    fontFamily: "Fira Code, monospace"
    fontSize: "28px"
    fontWeight: 600
    lineHeight: 1.15
    letterSpacing: "-0.5px"
    fontFeature: "tabular-nums"
  headline:
    fontFamily: "Fira Sans, sans-serif"
    fontSize: "20px"
    fontWeight: 600
    lineHeight: 1.3
  title:
    fontFamily: "Fira Sans, sans-serif"
    fontSize: "14px"
    fontWeight: 600
    lineHeight: 1.55
  body:
    fontFamily: "Fira Sans, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.55
  body-dense:
    fontFamily: "Fira Sans, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.5
  caption:
    fontFamily: "Fira Sans, sans-serif"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Fira Code, monospace"
    fontSize: "11px"
    fontWeight: 600
    lineHeight: 1.45
    letterSpacing: "0.6px"
  figure:
    fontFamily: "Fira Code, monospace"
    fontSize: "20px"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "-0.5px"
    fontFeature: "tabular-nums"
rounded:
  sm: "6px"
  md: "10px"
  lg: "14px"
  pill: "999px"
spacing:
  "0": "2px"
  "1": "4px"
  "2": "8px"
  "3": "12px"
  "4": "16px"
  "5": "24px"
  "6": "32px"
  "7": "48px"
components:
  card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    padding: "16px 24px"
  button-primary:
    backgroundColor: "{colors.focus-blue}"
    textColor: "{colors.on-fill}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
    height: "44px"
  button-primary-hover:
    backgroundColor: "{colors.focus-blue-deep}"
  tab:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.ink-2}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
    height: "44px"
  tab-active:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.focus-blue-deep}"
  chip:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink-2}"
    rounded: "{rounded.md}"
    padding: "8px 12px"
    typography: "{typography.caption}"
  chip-hover:
    textColor: "{colors.focus-blue}"
  tag:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.ink-2}"
    rounded: "{rounded.sm}"
    padding: "2px 8px"
    typography: "{typography.label}"
  input-number:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "8px 12px"
    height: "44px"
  nav-item:
    backgroundColor: "transparent"
    textColor: "{colors.ink-2}"
    rounded: "{rounded.md}"
    padding: "8px 12px"
    height: "44px"
  plate:
    backgroundColor: "{colors.plate}"
    rounded: "{rounded.md}"
---

# Design System: KAIROS GameRadar

## Overview

**Creative North Star: "The Analyst's Bench"**

GameRadar is an instrument, not a dashboard. It is read at a working distance by one person deciding whether a game is worth building, so it is dense on purpose: many small figures, ruled and aligned, on cool light chrome. Density is achieved through *padding*, never through shrinking type — the smallest text in the product is 11px and that is a floor, not a starting point.

The world it explicitly refuses is the stock admin template: gradient rails, decorative KPI blobs, six equal hero-metric cards, rainbow categorical charts, and coloured accent stripes on card edges. Where that template puts six competing headlines, this build puts one answer ("this week's read") above its evidence, and the evidence reads as one ruled strip rather than six boxes. Where that template throws twelve hues at a treemap, this build has exactly one focus colour and calls everything else graphite.

Every panel tells a step of one story — find an underserved market, shape a pitch, judge whether it clears an income target — and every panel ends by handing off to the next step rather than signing its own name. Dark mode is a second token set over the same scale, not a second design; only colour tokens move.

**Key Characteristics:**
- Cool light chrome (#f4f6fb page, white surfaces, hairline borders) with a single dark media plate
- Fira Sans for prose, Fira Code with tabular numerals for every figure, label, axis tick and chip
- One focus blue meaning "the series under decision"; all other context is graphite
- Semantic colour reserved for verdicts, never for categories
- Compactness from padding, with an 11px type floor and a 44px touch floor
- Flat-by-default surfaces; two shadow steps, both ambient, no elevation theatre

## Colors

A cool blue-grey chrome that stays out of the way, one saturated blue that carries all decision weight, and a small semantic set that only ever renders a verdict.

### Primary
- **Focus Blue** (#1d4ed8): The single focus colour. It marks the series under decision in a chart, the selected tab/nav state, the primary action, the drawn mark in a card header, and the one focus ring. Nothing contextual is ever blue.
- **Focus Blue Deep** (#1e40af): The pressed/selected text colour and the emphasis weight inside prose (`<b>` in "this week's read" and the anchor strip). Also the hover fill for the primary button.

### Secondary
- **Attention Umber** (#8a3f07): Crowding, estimator disagreement, a closing door, and the "read strip" title. Darkened well past the usual amber because it must clear 4.5:1 on the amber and blue-grey tints it actually sits on, not merely on white. Amber and accent are the same value by design.

### Tertiary
- **Verdict Green** (#047857) / **Verdict Red** (#b91c1c): Outcomes only — up/down deltas, positive/negative bars, in-band verdicts, failure states.
- **Route Violet** (#6d28d9) and **Spotlight Cyan** (#0e7490): Reserved status vocabulary (shipped/building, validated/design-derived). Not general accents.

### Neutral
- **Page** (#f4f6fb) / **Page Sunken** (#eef2f9): The application ground and the recessed row ground inside a card.
- **Surface** (#ffffff) / **Surface 2** (#f1f5fb): Card faces, and the muted fill for inert chips, inputs and disabled-state tags.
- **Border** (#dbe3ef) / **Border Soft** (#e6ecf5): Structural hairlines vs. card outlines and in-list dividers. Cards take the soft one; anything that must read as a division takes the hard one.
- **Ink** (#14213a) → **Ink 2** (#4a5b78) → **Ink 3** (#5b6b86): The three text weights. Ink 3 is the colour of *all* small text including every table header, so it was raised until it clears AA on white, page and surface-2 alike.
- **Ink 4** (#8493ad): Non-text only.
- **Plate** (#0b0f16) with **Plate Edge** (rgba(255,255,255,0.08)): The one dark surface in a light app.
- **Chart Context** (#6b7a94) and **Chart Context Fill** (#c3cfe2): Benchmarks, cohort baselines, AAA — graphite by design.

### Reserved sub-palettes

Three closed sets that sit *outside* the token scale on purpose, because each paints a surface the scale does not describe. Values here are fixed: do not extend these sets, and do not reach into them from ordinary components.

**Rail** — the fixed 64px navigation column, the one always-dark chrome in light mode.
- **Rail Ground Top** (#101a2e) → **Rail Ground Bottom** (#0c1320): the light-scheme column.
- **Rail Ground Top Dark** (#080d15) → **Rail Ground Bottom Dark** (#05080e): stays darker than a dark page, or it stops reading as a rail.
- **Rail Glyph** (#9fb3d4): resting icon colour. **Rail Active** (#60a5fa): the selected marker.
- **Rail Tooltip** (#1a2740) with **Rail Tooltip Ink** (#e6edf7).
- **Rail Focus Ring** (#93b4fb): the standard blue ring disappears into this ground.

**Ink ramp** — ordered magnitude only (heatmap density, treemap area). Never categorical.
- **Ramp 1** (#eef2f8) → **Ramp 2** (#c3cfe2) → **Ramp 3** (#8fa3c0) → **Ramp 4** (#4f6b98) → **Ramp 5** (#1e3a5f).
- Treemap variant, dark-anchored so white tile labels clear AA at every step: **Tree 1** (#5b7099) → **Tree 2** (#4a5f88) → **Tree 3** (#3a4f76) → **Tree 4** (#293d5f) → **Tree 5** (#12233d).

**Plate interior** — what shows when there is no art.
- **Plate Glyph** (#7d8ba4): the fallback initial. **Plate Empty** (#e3e9f5): the empty-state art block.
- **Chart Muted** (#9ca3af): axis furniture on a chart that has no focus series.

### Named Rules

**The Ink-4 Rule.** `--text-4` (#8493ad) is a NON-TEXT token: dividers, disabled glyphs, scrollbar thumbs, decorative rules. It must never carry a word. Text stops at Ink 3.

**The One Focus Rule.** Focus Blue means exactly one thing: the series under decision. If two things in a chart are blue, one of them is wrong. Semantic colour (positive/negative) is reserved for verdicts — never a category, never a series.

**The No-Rainbow Rule.** Categorical colour is never used for ordered data. Magnitude gets a single-hue ink ramp (`#eef2f8 → #1e3a5f`; the treemap's variant starts at `#5b7099` because it prints white labels on its tiles). Scale tiers are one hue at three weights, not three unrelated blues.

**The Mixed-Tint Rule.** Every tinted ground is `color-mix(in srgb, var(--token) N%, var(--surface))` — never a hardcoded pastel. A mixed tint follows the colour scheme; a literal pastel becomes a stain in dark mode. Typical mixes: 5–7% for a full-card ground, 10–14% for a chip or tag.

**The On-Fill Rule.** Text printed on a *solid* semantic fill (badges, counters, section numerals, the primary button) uses `--on-fill`, never `#fff`. Those fills invert between schemes and the text has to invert with them.

**The Plate Rule.** `--plate` does not invert. It is a media mount, not a surface: every Steam capsule, screenshot and generated key art sits on the same dark ground in both colour schemes, which is what keeps Radar and Library consistent. The plate never spreads to chrome.

## Typography

**Display / Figure Font:** Fira Code (monospace), `font-variant-numeric: tabular-nums`
**Body Font:** Fira Sans (with sans-serif fallback)

**Character:** Two voices with a hard division of labour. Fira Sans carries anything you *read* — prose, blurbs, card titles, sidebar footers. Fira Code carries anything you *compare* — figures, deltas, labels, axis ticks, chip and tag text, status lines, codes. Tabular numerals are what make a column of numbers scannable across a dense row; a paragraph set in mono is mono-as-costume and is banned.

### Hierarchy
Seven steps, and line-height belongs to the step (never set independently).

- **Display** (Fira Code, 600, 28px/1.15, -0.5px): The single biggest figure on a panel — the revenue headline, which clamps `clamp(20px, 4.2vw, 28px)` so it never breaks a phone row.
- **Headline** (Fira Sans, 600, 20px/1.3): The panel `<h1>` in the topbar, empty-state headings. Also the size of a KPI figure in mono.
- **Title** (Fira Sans, 600, 14px/1.55): Card headings (`h2`), pitch card names, band headers, verdict lines (700).
- **Body** (Fira Sans, 400, 14px/1.55): The document default.
- **Body Dense** (Fira Sans, 400, 13px/1.5): The working size for analytical prose — insight bodies, table cells, blurbs, the read strip's lines.
- **Caption** (Fira Sans, 400, 12px/1.5): Sidebar footers, hints, notes, tooltip bubbles, secondary field text.
- **Label** (Fira Code, 600–700, 11px/1.45, +0.5–1.4px, usually uppercase): Table headers, section titles, nav group labels, every chip and tag, axis ticks, meta lines, provenance receipts.

### Named Rules

**The 11px Floor Rule.** Nothing renders below 11px (`--fs-1`), ever. The e2e accessibility spec fails the build on any text node under it. Compactness comes from padding, never from point size.

**The Two Voices Rule.** Mono is for figures, labels, axis ticks and chips. Prose sets in Fira Sans regardless of how small it is — including the sidebar footers, which are sentences, not status lines. A status line (the catalog dot + count) is the exception and is scoped to its own class, because applying the flex/mono treatment to a paragraph shatters it into ten-character columns.

**The Step-Down Rule.** When content does not fit, move down the scale (a word-valued KPI takes 16px instead of 20px), never to an off-scale inline value.

## Layout

**Shell.** A CSS grid of `64px 1fr`: a fixed, full-height dark rail plus the active service. Each service is itself `232px 1fr` — a sticky section sidebar and the main column. There is no router; panels are toggled with `hidden`, and `.service[hidden]` collapses the whole grid.

**First viewport.** Rail → sticky sidebar → sticky topbar (title + platform tab list, translucent with a 14px blur) → the answer ("this week's read") → its evidence. The evidence strip comes second, always.

**Rhythm.** An eight-step spacing scale (2 / 4 / 8 / 12 / 16 / 24 / 32 / 48). Page content is `24px 32px` with a 24px gap between blocks; cards are `16px 24px` inside; dense list rows use 12px. `--sp-0` (2px) is a documented exception to the ladder: it is for padding *inside a control only* — chip and badge internals — because rounding those to 4px inflated every dense table row. It is never used for layout.

**Grids.** Two-up layouts are `1.55fr 1fr` (`.g-2`) or `1fr 1.1fr` (`.g-2b`) and collapse to one column at 1080px. Every card grid that can vary in count uses `repeat(auto-fit, minmax(min(100%, N), 1fr))` — never a fixed column count — so a six-tile row does not leave a ragged 4+2.

**Mobile (≤1080px).** The rail becomes a fixed bottom tab bar with `env(safe-area-inset-bottom)` padding and short labels; the section sidebar becomes a left drawer with a scrim; content padding drops to 16px with bottom clearance for the bar. Every grid goes single-column. The segmented platform control is the one place density beats the ladder: its buttons step down to 12px side padding and the group may wrap, bounded to that control.

### Named Rules

**The No-Sideways-Page Rule.** The page never scrolls horizontally at any width. A wide table scrolls inside its own card at *every* width (not conditionally below a breakpoint), and every container that holds one — grid items, flex children, `.card` — carries `min-width: 0`, because the default `min-width: auto` inflates a track to a `max-content` table's full width and defeats `max-width: 100%`. Enforced by `web/e2e/mobile.spec.ts` at 375px.

**The Earned Column Rule.** A column appears only when the data supports it. The Team column renders only when `hasTeamCoverage(rows)` clears its coverage threshold; the capsule column renders only when `anyArt` is true. A column of "—" is a column that should not exist.

**The 44px Rule.** Every control is at least 44px tall at 375px. Block-level controls take `min-height`. Inline controls inside running text (source links, provenance receipts, tip triggers) keep their box and expand the *hit area* with an absolutely-positioned `::after` — growing the box would break paragraph rhythm. The a11y spec measures the pseudo-element, so this is the sanctioned technique.

## Elevation & Depth

Flat by default with tonal layering. Depth comes from a three-value ground stack (page → sunken → surface) and hairline borders; shadows are ambient and near-invisible, present only to lift a card off the page. There is no elevation ladder and no hover-lift on anything that cannot be clicked.

### Shadow Vocabulary
- **Ambient rest** (`0 1px 2px rgba(16,24,40,.04), 0 1px 3px rgba(16,24,40,.07)`): Every card, chip, panel and tile at rest.
- **Ambient raised** (`0 4px 14px rgba(16,24,40,.07), 0 2px 4px rgba(16,24,40,.04)`): Tooltips, the rail's hover label, and the hover state of a card that is genuinely clickable.
- **Dark-mode pair**: the same two steps at `rgba(0,0,0,.3–.45)` — in dark, elevation reads as light, not as a darker shadow.

### Named Rules

**The Honest Affordance Rule.** A hover response is a promise. Cursor changes, hover lifts and raised shadows belong only to elements with a click handler; static evidence rows (`.insight`, `.gap`, `.ref-card`, `.action`) carry none.

**The No-Stripe Rule.** An accent stripe — a coloured left border or a coloured inset shadow on a card edge — is banned as a signal device. It is the most recognisable tell of a generated UI, and it repeats what the card's title, mark or ground already says. Use a tinted ground (`color-mix` at 5–7%) or a coloured *label* instead. Where the colour is the key across a set of tiles, put the colour on the label the reader actually looks at, not on a rule above it.

## Shapes

Four radii and nothing else: 6px for small inline things (tags, code, small buttons), 10px for controls and mid-size cards (buttons, inputs, nav items, chips, the plate), 14px for full cards and panels (`--radius` is the legacy alias for this), and a full pill.

Borders are hairlines, 1px, and carry the structure: `--border-soft` outlines a card, `--border` divides. Cards do not use a coloured border to signal state — a state-bearing card mixes both its ground *and* its border from the same token (`color-mix(… 5–7%)` ground, `color-mix(… 22–30%)` border).

**The Pill Rule.** `--r-pill` is for counts, numeric badges and small status capsules only — never a text chip. A pill-shaped word reads as a different component than a rounded one.

**The Drawn Mark Rule.** Icons are drawn SVG on a 24px viewBox, `fill: none`, `stroke: currentColor`, `stroke-width: 1.7–1.9`, sized 13–21px by context. No emoji as icons, no icon fonts, no raster marks.

## Components

### Buttons
- **Shape:** Softly rounded (10px); small inline actions take 6px.
- **Primary:** Solid Focus Blue with `--on-fill` text, 8px/16px padding, 44px minimum height. Hover deepens to Focus Blue Deep over 0.16s.
- **Ghost / inline:** Transparent with a hairline border and Focus Blue mono label at 11px (`.plink`, `.project-btn`, `.prov-receipt`); hover fills to a 7–14% blue mix and promotes the border to Focus Blue.
- **Focus:** One ring, defined once, for everything: `2px solid var(--primary)` at `2px` offset with a 6px radius. Inside the dark rail the ring switches to #93b4fb, because the blue disappears into that ground.

### Tabs (platform selector)
The topbar's platform selector is a real tab list, not styled buttons: `role="tablist"` with roving tabindex (the group is one tab stop), arrow keys, Home/End, `aria-controls` pointing at a real `role="tabpanel"`, and automatic activation (selection follows focus). When the selector splits into two groups sharing one value, the group not holding the value falls back to making its first tab tabbable so it stays reachable.
- **Shape:** A recessed track (`--surface-2`, hairline border, 10px, 4px inner padding) holding 10px pills.
- **Active:** Lifts to `--surface` with Focus Blue Deep text and the ambient-rest shadow. In dark mode it *recesses* instead — taking `--surface-2` against the lighter surface — because the same lift reads inverted.

### Chips & Tags
- **Style:** 11px Fira Code, 600–700 weight, `2px 8px` padding, 6px radius (pill only for counts/status capsules). The neutral form is `--surface-2` on Ink 2/3.
- **Semantic form:** background `color-mix(in srgb, var(--token) 10–14%, var(--surface))`, text the same token. Green = confirmed/strong, Umber = crowding/deferred/warning, Cyan = validated/spotlight, Violet = shipped, Focus Blue = selected/committed, `--surface-2` + Ink 3 = inert, absent, or "context, not benchmark".
- **Missing data** is a dashed-border chip on `--surface-2`, not a hidden one.

### Cards / Containers
- **Corner:** 14px. **Background:** `--surface`. **Border:** 1px `--border-soft`. **Shadow:** ambient rest. **Padding:** 16px 24px (16px all round on media cards).
- **Header:** `h2` at 14px/600 with a 16px Focus-Blue drawn mark and `flex-wrap` so a header carrying two control groups stacks on a phone instead of pushing the card past the viewport. A right-aligned mono `.sub` carries the sample size or timestamp.
- **State cards** (failure, read strip, focus band) keep the same silhouette and change only the mixed ground and mixed border.

### KPI Strip
Not cards. A single ruled strip inside one bordered container: no per-tile chrome, no shadow, no equal-weight boxes — cells separated by a 1px left border (the first cell carries none). Label is 12px uppercase Ink 3 with a `min-height: 2.4em` reservation so a two-line label cannot push its figure off the shared baseline; the figure is 20px Fira Code with tabular numerals. This exists because six equal icon + caps-label + big-number cards *is* the hero-metric template the product refuses — these are evidence for the answer above them, not six competing headlines.

### Inputs / Fields
- **Style:** `--surface-2` fill, 1px `--border`, 10px radius, 8px/12px padding, 14px Fira Code, 44px minimum height. Range inputs take `accent-color: var(--primary)`.
- **Focus:** border promotes to Focus Blue (plus the global ring on `:focus-visible`). Caret and selection are themed from the palette rather than left at browser default.

### Navigation
- **Rail (desktop):** 64px, dark, sticky full-height; 44×44 buttons with 21px drawn marks. Active state gets a 4px left flag and a mixed-blue fill. Labels are tooltips revealed on hover.
- **Rail (mobile):** the same buttons become a fixed bottom bar; the tooltip pseudo-element becomes the visible 11px label via `data-short`.
- **Section sidebar:** 13px/500 rows, 10px radius, 44px minimum height, active in Focus Blue Deep at 600. These are `<button>` elements with a reset, never hrefless anchors.
- **Drawer (mobile):** the sidebar becomes a `min(84vw, 300px)` slide-in over a 50% scrim, 0.24s ease-out, with a 44px close control.

### Charts (signature)
ECharts with a fixed grammar: axis labels, tick text, legends and tooltips all 11px Fira Code in Ink 3; grid lines `--border-soft`; tooltips are a white card with the `--border` hairline and the raised shadow. Exactly one focus colour per chart — series 0 gets the thick stroke plus a 12% area fill, and the rest recede through the ink family in order. Ordered data gets a single-hue ramp mapped **by value**, never by index. Bars split positive/negative only when the number is a verdict.

### The Plate (signature)
The one dark surface in a light app, and the mount for every piece of game art. The plate is the component and the art is its content: a missing capsule leaves a *plate*, never a broken image — a mono initial in #7d8ba4 as an `aria-hidden` fallback, covering both "no crawled URL" and "URL failed to load". Sizes are fixed to keep the Steam header's ~2:1 crop recognisable: 46×22 (`xs`, table rows), 92×43 (`sm`), and a 16:9 bleed for the pitch card hero. Boxes are reserved with explicit `width`/`height` so rows do not shift as capsules stream in. In dark mode the plate gains a 16% white hairline so it does not read as a hole.

### Hand-off
Every panel ends on a `<nav aria-label="Next step">` of one to three buttons — label, hint, arrow — above a top rule, laid out `auto-fit / minmax(min(100%, 260px), 1fr)`. A panel never closes on its own name or a byline. Hover promotes the border to Focus Blue and the shadow to raised; this one *is* clickable, so the affordance is honest.

### Tip
The definition layer, replacing `title=`. A 13px drawn question mark whose hit area is a full 44px via `inset: -15px`; the bubble is a white 10px card with the raised shadow, `max-width: min(44ch, 78vw)`, set in Fira Sans at 12px (a definition is prose), pinning to the trigger's right edge below 640px so it cannot overflow the viewport.

## Do's and Don'ts

### Do:
- **Do** take every size from the scale. If a component needs a value that is not on it, the component is wrong — adding a token is a design decision, not a convenience.
- **Do** get density from padding. The type floor is 11px and the touch floor is 44px, both machine-checked.
- **Do** build tinted grounds with `color-mix(in srgb, var(--token) N%, var(--surface))` so they follow the colour scheme.
- **Do** use `--on-fill` for text on a solid semantic fill.
- **Do** keep `--text-4` off every word — dividers and disabled glyphs only.
- **Do** give a chart exactly one focus colour and let everything else be graphite.
- **Do** map ordered data to a single-hue ramp by value.
- **Do** let a wide table scroll inside its own card at every width, and give every container that holds one `min-width: 0`.
- **Do** render a column only when the data supports it (`hasTeamCoverage`, `anyArt`).
- **Do** draw icons as SVG on a 24px viewBox at 1.7–1.9 stroke with `currentColor`.
- **Do** end a panel on its hand-off to the next step.
- **Do** run the a11y and mobile e2e specs before pushing — they are the enforced floor, wired into the pre-push hook, and they cover both colour schemes.

### Don't:
- **Don't** put an accent stripe — a coloured border or inset shadow on a card edge — on anything. Use a tinted ground or a coloured label.
- **Don't** hardcode a pastel. A literal `rgba()` tint stops following the colour scheme.
- **Don't** invert `--plate`. It is a media mount, not a surface.
- **Don't** use `--sp-0` (2px) for layout. Control internals only.
- **Don't** use `--r-pill` on a text chip; a pill-shaped word reads as a different component.
- **Don't** set line-height independently of its type step.
- **Don't** set prose in Fira Code, at any size.
- **Don't** use emoji, icon fonts, or raster images as icons.
- **Don't** use categorical colour for ordered data, or semantic green/red for a category.
- **Don't** let a second element in a chart be blue.
- **Don't** attach a cursor, hover lift or raised shadow to an element with no click handler.
- **Don't** ship an hrefless `<a>` as a button — it is keyboard-unreachable and the a11y spec fails on it.
- **Don't** use a fixed column count in a grid whose item count can vary.
