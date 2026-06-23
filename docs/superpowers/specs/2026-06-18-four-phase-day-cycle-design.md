# Four-Phase Day Cycle (Dawn / Day / Dusk / Night) Design Spec

**Date:** 2026-06-18
**Status:** Approved (design), pending implementation plan
**App:** Miriel's Readings (web/Electron tarot app at `C:\Users\Matt\projects\tarot`)
**Builds on:** the day/night theming shipped in `2026-06-15-astral-visual-refresh-design.md`

## Summary

Extend the existing two-phase day/night background theme into a **four-phase day
cycle** — dawn, day, dusk, night — each with its own forest image and accent
treatment. This is a direct extension of the shipped `body[data-time="day"|"night"]`
token-override system, not new architecture: add two more `data-time` values
(`dawn`, `dusk`), their token blocks and per-phase atmosphere layers, and grow the
theme toggle and clock logic from two phases to four.

No new features or behavior changes beyond theming. Visual only.

## Decisions (locked during brainstorming)

- **Four phases, each with a dedicated image** the user already created:
  - dawn → `mirielsunrise.png` (bright golden sunrise, green, warm)
  - day → existing `mirielbg.jpg` (sunlit forest)
  - dusk → `mirieldusk.png` (sunset glow deepening to violet)
  - night → existing `mirielnightbg.png` (moonlit, violet)
- **Clock windows (Auto mode):** Dawn 05:00–08:00 · Day 08:00–17:00 ·
  Dusk 17:00–20:00 · Night 20:00–05:00.
- **Accent palettes:**
  - **Dawn** — rosy-gold + soft green lift; warm cream headings; gold glow;
    golden-haze veil; no stars, no decorative moon (sun is in the image).
  - **Day** — gold / bronze / honey (unchanged from shipped).
  - **Dusk** — amber-gold + rose primary with **creeping violet** secondary;
    warm horizon glow at the bottom, violet veil deepening at the top, a few
    faint early stars high up; no decorative moon disc (sky is in the image).
  - **Night** — violet / starlight + full starfield (unchanged from shipped).
- **Toggle:** 5-state cycle — Auto → Dawn → Day → Dusk → Night → Auto — one
  button, per-phase glyph + tooltip, persisted in `localStorage` (`themeMode`).

## Architecture (reuse of the shipped system)

The shipped theme works by setting `body.dataset.time` to `day` or `night`; CSS
`body[data-time="day"] { … }` overrides design tokens (accent colors,
`--sanctuary-bg`, `--overlay-veil`, `--ink-*`, `--card-ring`, `--takeover-pulse`,
base `--bg/--bg2/--bg3/--border`) and per-phase atmosphere selectors
(`.cosmos-forest` image, `.cosmos-nebula` veil, `.cosmos-stars`/`.cosmos-moon`
visibility). Night is the `:root` default; day is the override block.

Four phases generalize this:

- `:root` keeps the **night** values as the base default (unchanged).
- Three override blocks: `body[data-time="day"]` (exists), and new
  `body[data-time="dawn"]` and `body[data-time="dusk"]`.
- Per-phase `.cosmos-forest` background image, `.cosmos-nebula` veil, and
  `.cosmos-stars` visibility for dawn and dusk (mirroring how day/night already
  override these).

### JS (`public/app.js`)

- `THEME_MODES` grows from `['auto','day','night']` to
  `['auto','dawn','day','dusk','night']`.
- `resolveThemeTime(mode)` returns the forced phase if not `auto`; otherwise maps
  the local hour to a phase using the windows above.
- `applyTimeOfDayTheme()` sets `body.dataset.time` to one of the four phases.
- `updateThemeButton(mode)` shows a per-mode glyph (🌗 auto / 🌅 dawn / ☀ day /
  🌆 dusk / 🌙 night) and a tooltip.
- `cycleTheme()` cycles through the 5 `THEME_MODES`.

## Atmosphere per phase

- **Dawn:** `cosmos-forest` = sunrise image with a gentle dim; `cosmos-nebula` =
  warm golden haze (no violet); `cosmos-stars` hidden; `cosmos-moon` hidden.
- **Day:** unchanged (sunlit image, golden-haze veil, stars/moon hidden).
- **Dusk:** `cosmos-forest` = dusk image; `cosmos-nebula` = warm amber glow at the
  bottom + violet deepening at the top (a true blend); `cosmos-stars` shown but
  **faint** (lower opacity than night) high in the sky; `cosmos-moon` hidden
  (the dusk sky is in the image).
- **Night:** unchanged (moonlit image, violet wash, full starfield; image's own
  moon, decorative disc hidden).

## Token coverage per new phase

Each of `dawn` and `dusk` defines the same token set the `day` block already
overrides, with phase-appropriate values:
`--purple`, `--purple-light`, `--nebula`, `--moon`, `--glow-moon`, `--glow-nebula`,
`--takeover-pulse`, `--sanctuary-bg`, `--panel-fade-end`, `--overlay-veil`,
`--card-ring`, `--ink-lavender`, `--ink-muted`, `--ink-faint`, `--ink-soft`,
`--placeholder-bg`, and base `--bg/--bg2/--bg3/--border`.

- **Dawn** values: warm (gold/rose family), close to day but slightly rosier;
  warm sanctuary glass and overlay veil; warm inks.
- **Dusk** values: amber/rose primary with violet accents — e.g. `--purple`
  (active-fill) a muted plum-bronze, `--nebula`/glows amber, `--moon` a warm
  rose-cream, `--takeover-pulse` amber, sanctuary/veil a warm-violet-tinted dark.

## Assets

`mirielsunrise.png` (~2.9 MB) and `mirieldusk.png` (~2.6 MB) are optimized to
`mirielsunrise-optimized.jpg` and `mirieldusk-optimized.jpg` via jimp
(`scaleToFit({w:1920,h:1920})`, quality ~72–74), targeting < ~800 KB each, matching
the existing optimized day/night images. The source PNGs are not shipped.

## Technical Notes & Constraints

- **Files:** `public/style.css` (token blocks + per-phase atmosphere), `public/app.js`
  (theme functions), `public/images/` (two optimized JPGs). `index.html` unchanged.
- **No behavior changes;** layout, flows, functionality unchanged.
- **Reduced motion:** the global `prefers-reduced-motion` net already covers all
  animations; any new faint-star animation for dusk is covered by it.
- **Packaging:** after merge, bump version and rebuild the Electron package
  (stop the dev server first to release the `better-sqlite3` lock; run
  `npm rebuild better-sqlite3` afterward to restore the Node ABI — see
  `tarot-native-module-packaging`).
- **Regression guard:** `node --test tests/*.test.js` stays green (105/105).

## Out of Scope

- New features, flows, or copy.
- Smooth animated *transitions* between phases (phases switch on load/toggle, not
  cross-fade in real time).
- The separate Android app.

## Success Criteria

- All four phases render their correct image + accent treatment, in Auto (by clock)
  and when forced via the toggle.
- Dawn and dusk read as distinct, natural phases that bridge day and night; no cool
  chrome leaks into dawn, and dusk's warm/violet blend looks intentional.
- The 5-state toggle cycles and persists correctly with clear glyphs.
- Overlays, cards, deal, and reading surfaces all theme correctly in dawn and dusk
  (they consume the same tokens, so this should follow automatically — verify).
- 105/105 tests pass; packaged build rebuilt at v1.4.0.
