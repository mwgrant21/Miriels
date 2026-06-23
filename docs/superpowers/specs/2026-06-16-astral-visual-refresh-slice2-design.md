# Astral Visual Refresh — Slice 2 Design Spec

**Date:** 2026-06-16
**Status:** Approved (design), pending implementation plan
**App:** Miriel's Readings (web/Electron tarot app at `C:\Users\Matt\projects\tarot`)
**Builds on:** `2026-06-15-astral-visual-refresh-design.md` (Slice 1, merged to master)

## Summary

Roll the proven astral design language — and the day/night theme — to the five
remaining surfaces, completing the visual refresh. This is primarily *applying
established patterns*, not inventing new ones: Slice 1 already defined the token
system, the sanctuary panel, the atmosphere layer, and the day/night mechanism
(`body[data-time="day"|"night"]` with token overrides). Slice 2 reuses all of it.

No new features or behavior changes. Visual only. Everything respects the
Auto/Day/Night theme and `prefers-reduced-motion`.

## Decisions (locked during brainstorming)

- **Scope:** all five surfaces in one slice.
- **Overlays:** themed *sanctuary rooms* — overlays adopt the sanctuary glass +
  astral language, accents/glass follow day/night, and the themed background is
  subtly visible behind them (vs the current near-opaque dark backdrops).
- **Deal/shuffle:** retheme + light enhancement — keep existing motion; theme
  colors and add gentle starlight touches. No timing/structure changes.

## Foundation already in place (from Slice 1)

These mean most Slice 2 work is re-pointing hardcoded-cool values at existing
tokens, not writing new theme logic:

- Accent tokens (`--purple`, `--purple-light`, `--nebula`, `--moon`, glow tokens)
  and base surface tokens (`--bg`, `--bg2`, `--bg3`, `--border`, `--sanctuary-bg`)
  are already day/night-aware via the `body[data-time="day"]` override block.
- `.sanctuary` panel class, `--takeover-pulse`, and the atmosphere layer exist.

**Principle:** anything that already consumes these tokens themes automatically.
The Slice 2 effort targets the spots that still hardcode cool colors.

## Surfaces

### 1. Ritual overlays — Threshold + curiosity

- **Backdrop:** the Threshold reuses `.miriel-takeover` (`rgba(4,2,14,0.93)`,
  near-opaque). Lighten toward a frosted veil so the themed background is subtly
  visible, keeping text legible. The pulse glow already themes via
  `--takeover-pulse`.
- **Curiosity panel:** currently a hardcoded cool radial bg
  (`#241a33`/`#150f20`). Re-point to the sanctuary surface / tokens so it warms by
  day and goes purple by night. Accents (gold eyebrow, gold buttons) already fit;
  ensure they ride the day/night accent tokens.

### 2. Reference overlays — Journal, Grimoire, "Your Story So Far"

- **Backdrop:** `.notebook-backdrop` is a solid cool radial gradient
  (`#1c1428 → #0a0810`). Convert to a frosted/translucent veil so the themed
  background shows through — the "sanctuary room" feel — while keeping enough
  dimming for long-form legibility.
- **Inner content surfaces:** re-point hardcoded cool fills to `--sanctuary-bg`
  and accent tokens so they theme:
  - `.journal-entry` (`linear-gradient(165deg, rgba(30,22,46,...) ...)`)
  - `.journal-search` (`rgba(20,14,32,0.85)`)
  - `.grimoire-detail` (`linear-gradient(165deg, rgba(30,22,46,...) ...)`)
  - journal "read more" fade gradient (`rgba(18,13,28,0.95)`)
  - any `notebook-*` cool accents (e.g. close-button hover, ornaments) → accent
    tokens.
- Keep text comfortably legible; these are content-heavy surfaces.

### 3. Atmospheric summary ("the whole of it")

- Use the **themed background** (sunlit forest by day, moonlit woods by night)
  rather than a fixed forest — it should honor the active theme.
- The passage sits in a calm sanctuary treatment; accents are gold by day /
  starlight by night (via tokens). Gentle, legible, immersive.

### 4. Cards everywhere

- Consistent card framing across all decks and spreads: starlight hairline +
  glow by night, warm-gold by day (token-driven).
- Clearer **reversed** and **highlighted/focus** states.
- Reuse the Slice 1 gentle card-reveal (already scoped to non-dealt cards).
- Respect existing per-deck face treatments (e.g. `rune-stone`, `iching-hex`,
  `has-image`) — retheme their borders/glows via tokens, don't restructure them.

### 5. Deal/shuffle + Miriel's Choice takeover

- **Keep existing motion** (`dealSlideIn`, deal-from-pile, takeover fade/pulse).
- Retheme the pile, takeover ornaments, and glows to astral + day/night.
- Add gentle enhancements only: a starlight shimmer on deal and a soft glow
  trail. No animation timing or structural changes.
- Honor `prefers-reduced-motion` for any new motion added.

## Technical Notes & Constraints

- **Files:** `public/style.css` (token overrides + selector retheming), with small
  `public/app.js` / `public/index.html` touches only if a surface needs a markup
  hook (prefer CSS-only).
- **Day/night:** extend the existing `body[data-time="day"]` override block and
  ensure newly-themed overlay/summary/card selectors consume tokens so both themes
  work without bespoke logic.
- **Reduced motion:** every animation added in this slice gets a
  `prefers-reduced-motion: reduce` guard.
- **No behavior changes:** purely visual; layout, flows, and functionality
  unchanged.
- **Regression guard:** `node --test tests/*.test.js` must stay green (105/105).

## Out of Scope

- New features, flows, or copy changes.
- A `dusk` golden-hour theme state (still deferred).
- The separate Android app.
- Restructuring existing animation/markup beyond retheming.

## Success Criteria

- All five surfaces visibly belong to the same astral system as home/reading.
- Day and night themes both look correct on every Slice 2 surface (no cool chrome
  leaking into day, no warm chrome leaking into night).
- Overlays read as themed "sanctuary rooms" with the background subtly present, yet
  long-form text stays comfortably legible.
- Deal/shuffle keeps its current feel, retimed by nothing, but now themed and
  gently enhanced.
- `prefers-reduced-motion` honored; 105/105 tests still pass.
