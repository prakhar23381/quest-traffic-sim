# Junction Lab — Design System

> A dark observatory for traffic. The road network glows on a black canvas, vehicles carry the
> colour, and the single white button is always the next thing to do.

**Status:** applied to `web/` (§11 records what changed). Decisions taken while building it are
marked *Built:*.

**Where this comes from.** Adapted from a style reference of Basedash's marketing site (a dark
data-tool landing page). We take its *visual language* — black canvas, near-black recessed
cards, white type at tight tracking, white primary buttons, a display serif used sparingly, violet
and green reserved for data, no shadows — and **not** its brand: no Basedash name, logo, imagery
or copy. Junction Lab is a dense working tool (a map, an editor, results tables), not a landing
page, so several rules are adapted below and the marketing components (hero, testimonials, logo
grid, decorative gradients) are dropped. Every adaptation says why.

---

## 1. Principles

1. **The map is the product.** Chrome stays black, grey and quiet so the network, the vehicles
   and the results colours carry all the attention — the way the dashboard is the hero in the
   reference.
2. **One bright action per view.** The white filled button is the next step: *Play* on the live
   view, *Run full simulation* in the editor. Everything else is ghost or outlined.
3. **Colour means data.** Hue is spent only on things that have a meaning: speed, change between
   runs, the two compared runs, signal states, status. Never decoration.
4. **Recessed, not raised.** Surfaces are near-identical darks separated by hairlines. No drop
   shadows on UI. (Shadows on the *map* are data: they show that a flyover is higher.)
5. **Honest numbers.** Tabular figures, units on every value, a legend for every colour, and a
   text equivalent (label, ▲/▼, table) for anything shown by colour alone.
6. **Few words on screen, detail on demand.** Labels are one or two self-explanatory words
   ("Trips done", "Seed", "Waiting"); every explanation lives in a tooltip — on the control itself
   (`data-tip`) or on a small ⓘ marker beside its label. No paragraphs in the editor, the run box
   or the results tiles. Long prose belongs only on the About page.

## 2. Themes

| | Dark (default) | Light (variant) |
|---|---|---|
| When | Default for everyone, as in the reference | Only when the visitor asks, with the ☀/☾ header toggle (remembered per browser) |
| Why keep light at all | — | Daylight projectors and printed screenshots; the reference is dark-only, but a lab tool shown in seminar rooms needs a readable light mode |
| Rule | Designed first; light is derived from the same roles, not an automatic inversion | Same roles, own values (§3), each checked for contrast |

## 3. Colour tokens

Token names are the **semantic names already used in `web/src/index.css`**, so adopting this spec
is a value change, not a rename. Reference names are kept in the "From" column.

### 3.1 UI colours

| Token | Dark | Light | From | Role in Junction Lab |
|---|---|---|---|---|
| `--bg` | `#000000` | `#f6f7f9` | Void Black | App canvas: header, sidebar background, results page |
| `--surface` | `#050607` | `#ffffff` | Carbon Card | Cards: KPI tiles, chart cards, road cross-section panel, signal groups |
| `--surface-2` | `#111316` | `#eef0f3` | (added) | Input wells, hover and selected rows, active tab. *Added:* `#050607` on black is invisible for an input you must find and click |
| `--border` | `#333333` | `#dfe2e7` | Graphite | Hairlines between sections, card edges, table rules |
| `--border-strong` | `#808080` | `#9aa0a8` | Steel Gray | Outlined buttons, input borders, chart axis lines |
| `--text` | `#ffffff` | `#0b0c0e` | Ghost White | Headings, values, labels the user must read |
| `--text-2` | `#b3b3b3` | `#4a4f57` | Ash Gray | Body copy, table content, field labels |
| `--text-3` | `#808080` | `#666b74` | Steel Gray | Hints, captions, axis ticks, disabled text (≥ 4.5:1 on both canvases) |
| `--primary` | `#ffffff` | `#0b0c0e` | Ghost White | Filled primary button background (inverted in light mode) |
| `--primary-ink` | `#000000` | `#ffffff` | Void Black | Text on the primary button |
| `--focus` | `#9984d8` | `#6b55c4` | Lavender Pulse | Focus rings, the selected road outline on the map, the active tab underline |
| `--overlay` | `rgba(5,6,7,0.72)` | `rgba(255,255,255,0.78)` | (added) | Frosted panels floating on the map (§7) |

The reference's **Bone White** (`#e8eaee`) tonal wash is not used: the app has no light sections
inside the dark theme.

### 3.2 Status colours (reserved, always with an icon or word)

| Token | Dark | Light | Used for |
|---|---|---|---|
| `--good` | `#3fcb7f` (Mint Signal) | `#15803d` | "better" in Compare (with ▲), the *Live* dot while the simulation plays |
| `--bad` | `#e66767` | `#c03535` | "worse" in Compare (with ▼), errors |
| `--warn` | `#fab219` | `#a16207` | Gridlock flag, broken-link banner, run notes |
| `--warn-bg` / `--error-bg` | status colour at 8 % alpha | status colour at 8 % alpha | Banner and notice fills, with a 1 px border of the status colour at 35 % |

The reference has no "worse" colour; a comparison tool needs one. Red is taken from the dataviz
status palette, not invented.

### 3.3 Data colours

All palettes below were run through the dataviz validator (`validate_palette.js`), dark against
`#050607` and light against `#ffffff`.

**Two compared runs (categorical).** The reference's violet and green, as the baseline and the
alternative in every Compare chart and legend.

| Token | Dark | Light | Validator |
|---|---|---|---|
| `--series-1` (baseline) | `#9984d8` (Lavender Pulse) | `#6b55c4` | pass |
| `--series-2` (alternative) | `#2fa866` | `#1f8a50` | pass |

*Adaptation:* Mint Signal `#3fcb7f` itself **fails** the dark lightness band (L 0.75 > 0.67) as
a series colour — it glows too much next to violet. `#2fa866` is the nearest same-hue step that
passes every check (CVD ΔE 16.4, normal-vision ΔE 25.2, ≥ 3:1). Mint stays the *status* green.

**Vehicle and road speed (sequential status scale)** — kept as the traffic convention people
know from navigation apps; the one deliberate exception to "violet and mint only", because speed
already has a meaning in red-amber-green. Always shown with the km/h legend.

| Bin | < 5 | 5–15 | 15–30 | 30–45 | 45+ km/h |
|---|---|---|---|---|---|
| Dark | `#ef4444` | `#fb923c` | `#facc15` | `#a3e635` | `#4ade80` |
| Light | `#dc2626` | `#f97316` | `#eab308` | `#65a30d` | `#15803d` |

**Change between runs (diverging)** — red slower ↔ grey ↔ blue faster, neutral midpoint, equal
steps per arm (dataviz rule: never a hue at the midpoint).

| Bin | 15+ slower | 5–15 slower | within 5 | 5–15 faster | 15+ faster |
|---|---|---|---|---|---|
| Dark | `#e66767` | `#9a4b4b` | `#55554f` | `#3d6aa3` | `#5b9bea` |
| Light | `#d03b3b` | `#ec9a96` | `#c9c8c2` | `#8fb6e8` | `#2a78d6` |

**Signals on the map:** green `#22c55e`, amber `#f59e0b`, red `#ef4444` stop bars — the real-world
meaning wins over the system palette.

**Closed road:** neutral, never red, so it cannot be read as "slow": dark `#c4c4cc`, light `#3f3f46`.

## 4. Typography

| Family | Use | Source |
|---|---|---|
| **Inter** 400 / 500 / 600 | Everything functional: labels, values, tables, buttons, the wordmark | Google Fonts (`Inter`), fallback `ui-sans-serif, system-ui` |
| **Display serif** 400 | One editorial line per page (see below) | The reference's Alpha Lyrae is proprietary; substitute **EB Garamond** (Google Fonts, OFL) with `font-feature-settings: "ss01" on` where available |

The reference's Iowan Old Style (testimonial quotes) has no counterpart here and is dropped.

**Where the serif appears** — and nowhere else:
- The About page title ("About the model") — 48 px.
- Empty-state headings ("No runs yet", "Compare two scenarios") — 48 px.
- The run title at the top of Results ("Run 2: Silk Board Flyover closed") — 34 px.

*Adaptation:* the reference sets the serif at exactly 48 px for hero headlines. A working tool has
no hero, and a 48 px title above every results page would push the numbers below the fold, so the
results title uses the reference's `heading` size (34 px). On screens narrower than 600 px all
serif headings drop to 34 px.

### Type scale (app density)

The reference is a marketing page with 16 px body text. Junction Lab is dense, so **14 px is the
base** and 16 px is used for reading prose.

| Role | Size / line height | Weight | Tracking | Used for |
|---|---|---|---|---|
| caption | 12 / 1.5 | 400–500 | −0.01em | Hints, axis ticks, legend labels, attribution |
| label | 13 / 1.45 | 500 | −0.015em | Field labels, table headers, sidebar section titles, badges |
| body-sm (base) | 14 / 1.43 | 400 | −0.03em | Controls, tables, sidebar text |
| body | 16 / 1.5 | 400 | −0.03em | About page prose, empty-state text |
| value | 24 / 1.25 | 600 | −0.03em | KPI numbers, HUD numbers (18 px in the HUD) |
| heading | 34 / 1.2 | 400 serif | 0 | Results run title |
| display | 48 / 1.0 | 400 serif | 0 | About title, empty states |

*Adaptations:*
- **Tracking.** The reference tracks all Inter at −0.03em. At 12–13 px that crowds digits like
  "1,598" and hurts legibility, so captions and labels are tracked lighter.
- **KPI numbers.** The reference's metric cards use 34 px numbers. Ten KPI tiles in a half-width
  column would wrap ("2,177 veh/h"), so they use 24 px.
- **Numbers.** All numbers use `font-variant-numeric: tabular-nums` so columns and live counters
  do not jitter.
- **Section titles.** Sidebar section titles change from uppercase to sentence case, 13 px, 500,
  `--text-2`: the reference's voice is calm, not shouty.

## 5. Space, shape and elevation

- **Base unit 4 px**; use the reference scale (4, 8, 12, 16, 20, 24, 32, 40, 48). App gaps: 8 px
  between controls, 12 px between elements, 16 px card padding (20 px on wide cards), 24 px
  between sidebar sections. The reference's 80–120 px section gaps are for scrolling marketing
  pages and apply only to the About page.
- **Radius — never interpolated:**

  | Element | Radius |
  |---|---|
  | Cards, chart cards, KPI tiles, map overlay panels, the cross-section panel | 16 px |
  | Buttons, inputs, selects, zoom buttons, table row highlights | 6 px |
  | Badges, the Live pill, the progress bar | 999 px |

- **No UI shadows.** Cards separate by value (`--surface` on `--bg`) plus a 1 px `--border`.
  Panels over the map use the **frosted overlay** instead of a shadow:
  `background: var(--overlay); backdrop-filter: blur(12px) saturate(1.2); border: 1px solid var(--border)`.
  (The reference's tagline promises "frosted type"; this is where it lives.)
- **Map shadows are data.** Flyover decks keep their drop shadow on the canvas because it encodes
  height.
- **Motion.** 120–200 ms ease-out on hover and state changes; the progress bar animates its width.
  Nothing moves for decoration; respect `prefers-reduced-motion` (no width transition).

## 6. Layout

| Region | Spec |
|---|---|
| App shell | CSS grid: header (56 px) · optional banner row · sidebar 340 px + main. Full-bleed: the reference's 1200 px max width does **not** apply to the map |
| Header | Transparent on `--bg`, 1 px `--border` bottom (the reference has none; the app needs the edge because the sidebar starts below it). Left: 20 px mark + "Junction Lab" Inter 16/500. Centre: tabs. Right: *Share* (outlined) |
| Sidebar | `--bg`, sections separated by `--border` hairlines, 16 px side padding. Sticky footer holds the one primary button (*Run full simulation*) and *Run on* |
| Live tab | Map fills the main area. Overlays: control bar top-left, stats beside it, zoom stack top-right, legend bottom-left, attribution bottom-right |
| Results | Two columns (results left, speed map right) ≥ 900 px; stacked below |
| Compare, About, empty states | Centred column, max width 1100 px (Compare) / 720 px (About, empty) |
| Phone (< 900 px) | Header wraps tabs to a second row; sidebar becomes a bottom sheet (max 75 vh) opened by *Edit scenario*; 16 px gutters; no horizontal scroll |

## 7. Components

**Primary button.** `--primary` fill, `--primary-ink` text, Inter 14/500, 6 px radius,
10 × 20 px padding, no border, no shadow. Hover: 90 % opacity. **Exactly one on screen:**
*Run simulation* in the sidebar footer (it is visible on every tab). *Built:* Play/Pause on the
map is outlined, because the sidebar's button is always on screen too.

**Tooltip.** One fixed-position layer (`components/Tooltip.tsx`) for every element with
`data-tip`: inverted colours (`--text` on `--bg`), 6 px radius, 12 px text, max 260 px wide,
below the element or above it near the bottom edge, clamped to the viewport so the sidebar
cannot clip it. Shows on hover and keyboard focus; closes on click, scroll or Escape. The ⓘ
marker is a 15 px outlined circle button whose `aria-label` is the tip; a tap focuses it, so
tips work on touch screens too.

**Outlined button.** Transparent, 1 px `--border-strong`, `--text`, 6 px radius. Hover: border
turns `--text`. Used for *Share*, *Restart*, *+10 s*, *Edit scenario*.

**Ghost button / link.** No fill or border, `--text`, underline on hover. Used for *undo*,
*Dismiss*, *Cancel*, *Reset to the original plan*, deselect ✕.

**Tabs.** Inter 14/400 `--text-2`; active: `--text`, weight 500, 2 px `--focus` underline (the
reference's violet used as a "focused UI edge"). No filled tab background.

**Inputs.** `--surface-2` well, 1 px `--border`, 6 px radius, Inter 14. Focus: 2 px `--focus`
ring. Range sliders and checkboxes use `accent-color: var(--text)` (white in dark), not a hue.

**Switch rows** (flyover open/closed, road open/closed, retime signals). Label 14/500 `--text`,
state word in `--text-2`, explanation 12 px `--text-3`.

**Sidebar section.** Title (label style), content, 24 px vertical padding, `--border` hairline
below.

**Road cross-section.** A `--surface` card (16 px radius): road slab `#6b7280`, white lane marks,
cars in `--series-1` drawn to scale (1.8 m), deck and pillar in neutral greys when elevated, one
dimension label ("11.0 m = 4 × 2.75 m"). Below: lane stepper (outlined 28 px buttons), lane-width
slider, the stated driver effect in caption style.

**Map overlay panel** (control bar, stats, legend, selected-road card, tooltip). Frosted overlay
(§5), 16 px radius (tooltip 6 px), 8–12 px padding. Stats: caption label in `--text-3` over an
18 px/600 value in `--text`.

**Live pill.** While the simulation plays, a 999 px pill in the stats panel: 8 px `--good` dot
with a soft glow (`box-shadow: 0 0 8px var(--good)` — the one glow in the system, as in the
reference's live indicator) and "Live · 20×" in label style. Paused: dot in `--text-3`, "Paused".

**Badges** (999 px, 1 px `--border-strong`, label style): *OpenStreetMap* on real networks, run
source *server* / *browser* on results, *closed* on edited roads.

**KPI tile** (the reference's metric card). `--surface`, 16 px radius, 16 px padding, 1 px
`--border`. Title caption in `--text-2`; value 24/600 `--text` with its unit; in Compare a delta
line: `--good` "▲ +12 %" or `--bad` "▼ −27 %" (symbol always present), absolute change in `--text-3`.

**Charts.** On `--surface` cards. 2 px lines, `--border` gridlines, `--text-3` ticks, one y-axis,
crosshair tooltip on hover. Legend only when there are two series (baseline violet, alternative
green), plus direct labels. Never a dual axis.

**Tables.** No outer border; `--border` rules between rows; header in label style `--text-3`;
numbers right-aligned and tabular; hover row `--surface-2`; selected row `--surface-2` with a 2 px
`--focus` left edge.

**Banner / notice.** Full-width row under the header (banner) or inline block (notice): status
fill and border (§3.2), 13 px text, a ghost *Dismiss*. Error notices use `role="alert"`.

**Progress.** 4 px track in `--surface-2`, fill `--text` (white), 999 px radius, with "Running in
your browser… 42 %" in caption style and a ghost *Cancel*.

**Empty state.** Centred, display serif heading 48 px, one 16 px paragraph in `--text-2`, and,
where useful, one outlined button pointing at the next step.

**About page.** Display serif title, 16 px prose in `--text-2` at max 720 px, tables in the table
style, links in `--text` with underline. The 80–120 px section gaps of the reference apply here.

## 8. The map canvas (`web/src/lib/scene.ts`)

| Element | Dark | Light |
|---|---|---|
| Canvas ground | `#050607` | `#eceee8` |
| Basemap (OSM tiles) | greyscale, inverted, 55 % | greyscale, 50 % |
| Ground road | `#2a2d33` | `#9aa0a8` |
| Junction area | `#30343a` | `#a3a9b1` |
| Flyover deck | `#474c55` with a shadow growing with height | `#b6bcc4` with shadow |
| Lane dividers / edges | `rgba(232,234,238,0.4)` / `0.22` | white 90 % / 55 % |
| Selected road | `--focus` outline at 55 % | `--focus` |
| Hovered road | `--focus` at 35 % | same |
| Vehicles | speed scale (§3.3) | speed scale |

Roads stay grey so the only saturated pixels on the map are vehicles, signals and results — the
reference's "colour means data" rule applied to the canvas.

## 9. Do and don't

**Do**
- Keep exactly one white filled button visible per view.
- Use violet and green only for the two compared runs, and mint only for "live" and "better".
- Put a unit on every number and a legend next to every colour scale.
- Use 16 px radius for containers and 6 px for controls, nothing in between.
- Use the frosted overlay for anything floating on the map.

**Don't**
- Don't fill buttons with violet, green or blue — the primary action is white on black (black on
  white in light mode).
- Don't add box-shadows to cards or panels; don't use glows except the Live dot.
- Don't use the display serif for labels, numbers or anything smaller than 34 px.
- Don't use pure white for body copy; `--text` is for values and headings, `--text-2` for prose.
- Don't colour a closed road red, or use red-green as the *only* encoding (always ▲/▼, labels or
  a legend).
- Don't use warm greys; every neutral in this spec is cool or true grey.
- Don't bring in the reference's marketing pieces (hero, testimonials, logo grid, gradient washes).

## 10. Accessibility

- Text contrast (computed, WCAG): `--text-2` is 7.2–10.0:1 and `--text-3` 4.7–5.4:1 on `--bg`,
  `--surface` and `--surface-2` in both themes; status colours 4.9–11:1 on their surface. Data
  colours meet 3:1 against their surface (validator).
- Every colour encoding has a second channel: legend text, ▲/▼, hover values, or a table.
- Focus is always visible (2 px `--focus` ring); every map control is a real `<button>` with an
  `aria-label`; the canvas has an `aria-label` describing the view.
- Touch targets ≥ 32 px (28 px only for the lane stepper inside a card).
- `prefers-reduced-motion`: no progress-bar animation; the simulation itself only runs when the
  user presses Play.

## 11. Current UI vs this spec

Applied on 15 Nov 2026. What changed from the pre-spec UI:

| Area | Today | Spec | Files |
|---|---|---|---|
| Default theme | Follows the OS (light for most visitors) | Dark by default, ☀/☾ toggle | `index.css`, `useDarkMode.ts`, `index.html` |
| Dark palette | Cool greys `#101114` / `#18191d` | Black `#000000` / `#050607`, Graphite borders | `index.css` |
| Primary buttons | Blue fill | White fill, black text | `index.css` |
| Map overlays | Translucent panels with shadows, 8 px radius | Frosted, no shadow, 16 px radius | `index.css` |
| Cards / KPI tiles | 8 px radius | 16 px | `index.css` |
| Compare series | Blue `#3987e5` / orange `#d95926` | Violet `#9984d8` / green `#2fa866` | `index.css`, `Compare.tsx` |
| Display serif | None | EB Garamond on About, empty states, run title | `index.html` (font link), `index.css`, `About.tsx`, `Results.tsx` |
| Tabs | Filled active tab | Underlined in `--focus` | `index.css` |
| Sidebar titles | Uppercase 12 px | Sentence case 13 px | `index.css` |
| Live pill | None | Mint dot + "Live · 20×" | `App.tsx`, `index.css` |
| Badges | None | OSM on real networks, Server / Browser on results, "What changed" in Compare | `Editor.tsx`, `Results.tsx`, `Compare.tsx` |
| Text | Hint paragraphs under most controls, long KPI names | One- or two-word labels; explanations in tooltips and ⓘ markers | all components, `Tooltip.tsx` |
| Map palette (dark) | `#14171c` ground, `#353b45` roads | `#050607` ground, `#2a2d33` roads | `scene.ts` |
| Focus and selection | Blue | Lavender `--focus` | `index.css`, `scene.ts` |

**Suggested order** (about 2 hours in all, each step shippable on its own):
1. Tokens and themes — the values in §3.1–3.2, dark by default (~30 min; most of the visual change).
2. Buttons, tabs, inputs, radii, frosted overlays (~30 min).
3. Compare series colours and the map palette (~20 min).
4. Display serif, Live pill, badges (~40 min).

## 12. Quick start (the values to paste into `index.css`)

```css
:root {
  color-scheme: dark;
  --bg: #000000;
  --surface: #050607;
  --surface-2: #111316;
  --border: #333333;
  --border-strong: #808080;
  --text: #ffffff;
  --text-2: #b3b3b3;
  --text-3: #808080;
  --primary: #ffffff;
  --primary-ink: #000000;
  --focus: #9984d8;
  --good: #3fcb7f;
  --bad: #e66767;
  --warn: #fab219;
  --series-1: #9984d8;
  --series-2: #2fa866;
  --overlay: rgba(5, 6, 7, 0.72);
  --radius-card: 16px;
  --radius-control: 6px;
  --radius-pill: 999px;
  --font-sans: "Inter", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  --font-display: "EB Garamond", "Cormorant Garamond", Georgia, serif;
}

@media (prefers-color-scheme: light) {
  :root:not([data-theme="dark"]) {
    color-scheme: light;
    --bg: #f6f7f9;
    --surface: #ffffff;
    --surface-2: #eef0f3;
    --border: #dfe2e7;
    --border-strong: #9aa0a8;
    --text: #0b0c0e;
    --text-2: #4a4f57;
    --text-3: #666b74;
    --primary: #0b0c0e;
    --primary-ink: #ffffff;
    --focus: #6b55c4;
    --good: #15803d;
    --bad: #c03535;
    --warn: #a16207;
    --series-1: #6b55c4;
    --series-2: #1f8a50;
    --overlay: rgba(255, 255, 255, 0.78);
  }
}
```
