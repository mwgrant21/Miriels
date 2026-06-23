# Astral Visual Refresh — Design Spec

**Date:** 2026-06-15
**Status:** Approved (design), pending implementation plan
**App:** Miriel's Readings (web/Electron tarot app at `C:\Users\Matt\projects\tarot`)

## Summary

Enhance the entire visual experience of Miriel's Readings by establishing a single
**astral design language** and applying it across all surfaces. This is an
*evolution* of the current dark-mystical identity — not a reinvention. We keep the
existing indigo/violet/gold bones and extend them toward the cosmic and luminous:
starfields, moon glow, nebula depth, silver-blue accents.

The work both **refines the craft** (spacing, typography, hierarchy, consistency)
and **deepens the atmosphere** (texture, light, gentle motion, ritual feel) — at an
"immersive but balanced" intensity, where rich atmosphere never compromises the
readability of long reading text.

## Direction (decisions locked during brainstorming)

- **Intent:** Polish what exists **and** deepen the atmosphere (both, together).
- **Scope:** All surfaces, unified by one design language.
- **North star:** Astral / Celestial — chosen as the closest evolution of the
  current look.
- **Intensity:** Immersive but balanced. Atmosphere is noticeable (animated
  starfield, moon-phase glow, luminous transitions), but every reading/text surface
  gets a calm, legible "sanctuary" treatment so text never fights the background.
- **Motion:** Living but gentle. Slow ambient drift (stars, breathing glows),
  smooth card flips and fades. No heavy/parallax/particle effects (Electron
  performance).
- **Background:** Keep the forest. Forest grounds it (the horizon), cosmos crowns it
  (the sky). The forest rises more prominently on the atmospheric summary screen as
  the payoff.
- **Delivery strategy:** Vertical slice first — build the complete language
  end-to-end on the **home** and the **reading**, validate, then propagate the
  proven patterns to the remaining surfaces.

## The Design Language

A shared vocabulary expressed as CSS custom properties (design tokens) in
`public/style.css`, so every surface draws from the same source and stays coherent.

### Color

**Kept (current bones, unchanged):**
- `--bg #0d0d1a`, `--bg2 #13132a`, `--bg3 #1a1a35`
- `--gold #c9a84c`, `--gold-dim #8a6f30`
- `--purple #7b5ea7`, `--purple-light #a07fd4`
- `--text #e8e0f0`, `--text-dim #8a80a0`, `--border #2a2a4a`

**New astral accents (added):**
- `--void #06040f` — deepest cosmic base
- `--nebula #5b4aa8` — nebula violet
- `--night-blue #2d3a6e` — cool depth
- `--starlight #cdbcff` — luminous highlight
- `--silver #b8c4e8` — cool structural accent (edges, borders)
- `--moon #e8e2ff` — moon glow / luminous headings

**Role of color:** Gold remains the **warm ritual accent** — Miriel's voice, the
human warmth amid the cold cosmos (eyebrows, ornaments, primary ritual moments).
Starlight and silver are the **cool counterpoint** — structure, edges, glow,
luminous headings.

### Typography & hierarchy

Refined serif scale (Georgia stays). Clear three-step hierarchy:
1. **Gold eyebrow** — small, uppercase, letter-spaced (`--gold`)
2. **Luminous heading** — larger serif with soft moon-glow text-shadow (`--moon`)
3. **Calm body** — readable serif with generous line-height (~1.7–1.75) for long
   passages

### Glow, elevation & motion tokens

Defined once, reused everywhere:
- **Glow tokens** — soft glow around active/ritual elements (e.g. nebula glow on
  primary actions, moon glow on headings).
- **Elevation tokens** — consistent shadow/border treatments for panels.
- **Motion tokens** — one shared easing curve + duration scale so every transition
  (card flips, fades, overlay entrances) feels part of the same system.

## The Shared Atmosphere Layer

One background system used on every surface.

### Layered background (bottom → top)

> **Implementation correction (2026-06-16):** the original draft below assumed the
> background image had a "sky" region to convert into cosmos. It does not — the
> image is a *full-frame warm sunlit forest*. A first pass that put a cosmos
> gradient over the top half produced a jarring day-top/night-bottom seam. The
> built approach keeps the **forest image as the full-screen base** and treats the
> astral atmosphere as a **veil** that only deepens the upper canopy and fades out
> smoothly (no seam). Markup order in `#cosmos-bg`: forest (base) → nebula veil →
> stars → moon → vignette.

1. **Forest base** — the full forest image (`cover`), gently dimmed for legibility
   (lighter than the old flat 0.70 dim so the warm scene still reads).
2. **Cool astral veil** — a top-weighted gradient + nebula glow that deepens the
   upper canopy toward night and fades to transparent by ~halfway. This is what
   makes it read as "astral" without a seam.
3. **Starfield** — fine stars (white/starlight/silver), masked to the upper region
   only, slowly drifting/twinkling.
4. **Moon** — a luminous moon glow, brightness tied to the current moon-phase data
   the app already has (`renderCosmosMoon()` off `moonPhaseInfo()`).
5. **Vignette** — inset darkening to focus the center.

### Behavior

- **Living but gentle:** stars drift/twinkle slowly, moon glow "breathes," nebula
  shifts faintly. Ambient, never distracting. Honors `prefers-reduced-motion`.
- **Sanctuary panels:** all reading/text surfaces sit in a frosted, dimmed card
  (semi-opaque `--void` background, subtle blur, `--silver` hairline border, soft
  shadow). The atmosphere surrounds the words instead of competing with them. This is
  the concrete mechanism behind "immersive but balanced."
- **One system, every surface:** home, reading, summary, and overlays share this
  exact backdrop + panel treatment.
- **Forest earns its place:** on the atmospheric summary screen, the forest rises
  more prominently as the emotional payoff.

## Day/Night Theming (added 2026-06-16)

The background and accent palette shift between a **day** and a **night** theme.
This grew out of the realization that the warm sunlit-forest image suits a *day*
mood, while the astral purple suits *night* — so rather than force one over the
other, the app carries both.

**Mechanism:** `body[data-time="day"|"night"]` drives everything via CSS. Most of the
UI re-themes automatically because it consumes design tokens; the day theme is
largely a block of token overrides (`--purple`, `--purple-light`, `--nebula`,
`--moon`, the glow tokens, `--sanctuary-bg`, and the base `--bg`/`--bg2`/`--bg3`/
`--border`) plus targeted overrides for the few hardcoded-cool spots (header band,
question bar, reader-note, draw button, spread dropdown, the cosmos veil).

**Day theme:** the sunlit-woods image; warm gold/bronze/honey accents; a golden-haze
veil instead of the violet wash; stars and the decorative moon disc hidden (it is
daylight; the scene has its own sun). Frosted "sanctuary" glass gets a warm tint but
stays dark enough to keep text legible.

**Night theme:** a dedicated moonlit-woods image (`mirielnightbg-optimized.jpg`) with
a gentle purple astral wash. The night image contains its own moon, so the decorative
moon disc is hidden. This is the astral identity at full strength.

**Miriel's prompt:** the Threshold/takeover pulse glow is themed via a
`--takeover-pulse` token (purple at night, gold by day) so the prompt frame matches.

**Control:** a theme toggle button cycles **Auto → Day → Night**, persisted in
`localStorage` (`themeMode`). **Auto** (the default) follows the local clock
(night = 19:00–06:00). The theme is applied at the very top of init, before any
`await`, so there is no load-time flip.

**Assets:** both forest images are optimized via jimp (`scaleToFit({w:1920,h:1920})`)
to keep them light for Electron (~410–710 KB).

**Not yet built:** a `dusk` golden-hour in-between state (discussed, deferred). The
journal/grimoire/notebook overlays and the in-reading curiosity panel still use cool
chrome; because they render over their own dark modal backdrops (not the forest),
their day/night theming is folded into the Slice 2 restyle of those surfaces.

## Surfaces

### First slice (build + validate the language here)

**1. The Home**
Same layout, controls, and features — purely a re-skin in the astral language.
- Title gains soft moon-glow; ornaments and tagline refined with the new type scale.
- Controls become frosted sanctuary chips; **Lay the Cards** gets the signature
  nebula glow as the primary ritual action.
- Card of the Day moves into a glowing frosted panel with eyebrow → heading → body
  hierarchy.
- New layered backdrop (stars + moon + forest horizon) replaces the flat dimmed
  image.

**2. The Reading**
- Two-column meanings + reading wrapped in sanctuary panels.
- Synopsis block ("The Reading") gets gold ritual eyebrow + luminous heading +
  breathing-glow divider.
- Per-card reflections get consistent card framing with a soft starlight border;
  reversed/highlighted states read more clearly.
- Card reveal uses gentle shared motion (smooth flip + fade-in).
- Continue/clarifier controls restyled as the same frosted chips and glowing actions
  as the home.

### Remaining surfaces (propagate the proven language, in this order)

3. **The shuffle & deal (ritual motion)** — deal-from-pile and Miriel's Choice
   takeover get nebula glow, gentle starlit motion, moon-phase accents.
4. **The atmospheric summary ("the whole of it")** — forest rises; treeline more
   prominent, gold horizon glow, italic-serif passage floating in starlight.
5. **The cards & spread layout** — consistent starlight framing, clearer
   reversed/highlighted states, gentle reveal motion across all spreads and decks.
6. **The ritual overlays** — Threshold reunion and in-reading curiosity panels get
   full sanctuary + glow treatment (memory-engine signature moments).
7. **The reference overlays** — Journal, Grimoire, "Your Story So Far" notebook
   brought up to the same standard.

## Technical Notes & Constraints

- **Files:** Frontend is `public/index.html`, `public/app.js`, `public/style.css`
  (~2,900 lines). Tokens and the atmosphere layer live in `style.css`. Markup
  changes minimal — mostly re-skinning existing structure.
- **Background image weight:** `public/images/mirielbg.jpg` is ~11.8 MB. For an
  Electron app this is heavy. As part of this work, produce an optimized/compressed
  version (and/or a dedicated horizon-cropped variant for the treeline layer) to keep
  load and memory reasonable.
- **Motion performance:** Prefer CSS animations/transforms over JS where possible;
  keep ambient motion GPU-friendly. Respect `prefers-reduced-motion`.
- **Moon phase:** Reuse the existing moon-phase data already in the app for the
  backdrop moon, so it stays meaningful rather than decorative.
- **No feature/behavior changes:** This is a visual refresh only. Layout, controls,
  and functionality remain as-is unless a change is purely cosmetic.

## Out of Scope

- New features or flows.
- The separate Android app (`C:\Users\Matt\projects\TarotApp`) — it had its own
  visual refresh and is not covered here.
- A fresh/different aesthetic identity (explicitly rejected in favor of evolving the
  current one).

## Success Criteria

- A single documented token system in `style.css` drives all colors, type, glow,
  elevation, and motion.
- Home and reading screens fully reflect the astral language and read as one
  cohesive, premium experience.
- Long reading text remains crisp and effortless to read over the atmosphere
  (sanctuary panels working).
- Ambient motion feels alive but never distracting; performance is smooth in
  Electron; reduced-motion is honored.
- The forest remains present and grounding; cosmos crowns it.
- Remaining five surfaces, once done, visibly belong to the same system.
