# Cross-Fade Phase Transitions Design Spec

**Date:** 2026-06-21
**Status:** Approved (design), pending implementation plan
**App:** Miriel's Readings (web/Electron tarot app at `C:\Users\Matt\projects\tarot`)
**Builds on:** the shipped four-phase day cycle (dawn/day/dusk/night) — see
`tarot-astral-refresh` memory and the `body[data-time]` theming in
`public/style.css` + `applyTimeOfDayTheme()` in `public/app.js`.

## Summary

When the resolved time-of-day phase changes (the Auto clock crossing a boundary, or
the user pressing the theme toggle), the background scene photo currently **hard-cuts**
to the next phase's image. This adds a **gentle ~1.2s cross-fade** so one scene
dissolves into the next instead of snapping. Calm, ambient, matching the app's
existing breathe/twinkle pacing.

## Problem (from the current code)

`.cosmos-forest` is a single fixed layer (`#cosmos-bg > .cosmos-forest`) whose
per-phase photo is set entirely by CSS:
`body[data-time="night"] .cosmos-forest { background-image: ... }` (and likewise for
day/dawn/dusk). `applyTimeOfDayTheme()` simply sets `document.body.dataset.time`, so
the photo swaps instantly. CSS cannot transition `background-image`, so smoothing the
cut requires a second layer whose **opacity** is animated.

## Decision (locked during brainstorming)

- **Feel:** gentle ~1.2s `ease-in-out` dissolve.
- **Technique:** a transient "outgoing scene" overlay that fades from opacity 1 to 0
  while the new photo is already live underneath.
- **Both triggers** cross-fade: the 60s Auto re-evaluation and the manual toggle.
- **Scope: the scene photo only.** Chrome/token color changes (`--bg`, accents,
  sanctuary glass, overlay inks) still switch instantly — animating dozens of
  token-driven properties risks regressions and the photo is the dominant visual cut.
- **Respect `prefers-reduced-motion: reduce`** — instant swap, no fade (joins the
  existing global reduced-motion net).
- **No fade on first paint** or when the phase is unchanged.

## Architecture

Three small, well-bounded pieces.

### 1. `public/theme-transition.js` (new) — pure decision helper

A dependency-free, DOM-free function, loaded as a plain global script before
`app.js` and also requireable by node tests (UMD-style export guard).

```javascript
function shouldCrossfade(prev, next) {
  // Fade only on a real phase change: both set, and different.
  return Boolean(prev) && Boolean(next) && prev !== next;
}
```

Export pattern (works in browser and node):

```javascript
(function (root) {
  'use strict';
  function shouldCrossfade(prev, next) {
    return Boolean(prev) && Boolean(next) && prev !== next;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { shouldCrossfade };
  } else {
    root.shouldCrossfade = shouldCrossfade;
  }
})(typeof window !== 'undefined' ? window : globalThis);
```

### 2. `public/index.html` — the fade layer + script include

- Add one element inside `#cosmos-bg`, immediately after `.cosmos-forest` (so it
  stacks directly above the scene photo and below the nebula/stars/moon):
  ```html
  <div class="cosmos-forest-fade" aria-hidden="true"></div>
  ```
- Add `<script src="theme-transition.js"></script>` **before** `<script src="app.js"></script>`.

### 3. `public/style.css` — the fade layer styling

```css
/* Transient outgoing-scene layer for the phase cross-fade. Painted (inline) with
   the previous phase's computed background at transition time, then faded out. */
.cosmos-forest-fade {
  position: absolute;
  inset: 0;
  opacity: 0;
  background-size: cover, cover;
  background-position: center top, center top;
  transition: opacity 1.2s ease-in-out;
  pointer-events: none;
}
@media (prefers-reduced-motion: reduce) {
  .cosmos-forest-fade { transition: none; }
}
```

It sits at the same DOM position as the other `#cosmos-bg` children (which are
`position:absolute; inset:0`), directly above `.cosmos-forest` in paint order.

### 4. `public/app.js` — orchestration in `applyTimeOfDayTheme()`

Refactor so the function:

1. Computes `next = resolveThemeTime(getThemeMode())`.
2. Reads `prev = document.body.dataset.time || null` (the phase currently applied).
3. If `window.shouldCrossfade(prev, next)` AND motion is allowed
   (`!window.matchMedia('(prefers-reduced-motion: reduce)').matches`), run the fade:
   - Grab the live computed style of `.cosmos-forest` and copy `backgroundImage`,
     `backgroundSize`, `backgroundPosition` onto `.cosmos-forest-fade` (inline), set
     its `opacity = '1'` (no transition yet — it is already the visible scene).
   - Force a reflow read (e.g. `void fadeEl.offsetWidth`) so the opacity:1 starting
     point is committed before the transition.
   - Set `document.body.dataset.time = next` (the new photo is now live on
     `.cosmos-forest` underneath the fully-opaque fade layer — no visible change yet).
   - On the next animation frame, set `fadeEl.style.opacity = '0'` to start the
     1.2s dissolve.
   - Attach a `transitionend` listener (`{ once: true }`) guarded on
     `e.propertyName === 'opacity'` that clears the fade layer's inline
     `backgroundImage` so it goes idle.
4. Otherwise (first paint, unchanged phase, reduced motion, or any failure): set
   `document.body.dataset.time = next` directly — today's instant behavior.
5. Always call `updateThemeButton(mode)` as today.

Wrap the fade branch in try/catch; on any error, fall back to the instant swap so
theming never breaks.

**Overlapping transitions** (toggle pressed mid-fade, or a clock tick during a fade):
each invocation re-snapshots the *current* `.cosmos-forest` computed background, resets
the fade layer to opacity 1, and restarts. The latest call always wins. A late
`transitionend` from a superseded run only clears the inline background (idempotent,
harmless) — and since a fresh run immediately repaints + reopaques, no flash results.

## Data flow

```
clock tick (60s) / visibility / toggle
  -> applyTimeOfDayTheme()
       next = resolveThemeTime(mode)
       prev = body.dataset.time
       shouldCrossfade(prev, next) && motion-ok ?
         yes -> paint fade layer with OLD scene @opacity 1
                set body.dataset.time = next   (new scene live underneath)
                rAF -> fade layer opacity -> 0  (1.2s dissolve)
                transitionend(opacity) -> clear fade layer
         no  -> body.dataset.time = next        (instant)
       updateThemeButton(mode)
```

## Error handling

- Missing `.cosmos-forest-fade`, missing `shouldCrossfade`, or a thrown error in the
  fade branch → fall through to the instant swap (`body.dataset.time = next`).
- `transitionend` uses `{ once: true }`; guarded on the `opacity` property so unrelated
  transitions never trigger cleanup.
- Reduced-motion: CSS already forces `transition: none`, and JS skips the fade branch,
  so the swap is instant from both sides.

## Testing

- **Unit (`tests/theme-transition.test.js`, node:test):**
  - `shouldCrossfade('day', 'night')` === true (real change);
  - `shouldCrossfade('night', 'night')` === false (unchanged);
  - `shouldCrossfade(null, 'day')` === false and `shouldCrossfade(undefined, 'day')`
    === false (first paint);
  - `shouldCrossfade('day', '')` === false (no next).
- **Live (manual):** with the dev server running, cycle the toggle Dawn→Day→Dusk→Night
  and confirm each background dissolves over ~1.2s with no flash or seam; confirm the
  chrome/tokens still switch (instantly) in step; enable `prefers-reduced-motion` and
  confirm instant swaps; reload and confirm the initial paint does not fade.
- **Regression:** `node --test tests/*.test.js` stays green (140 + new file).

## Success Criteria

- Phase changes (Auto boundary and manual toggle) dissolve smoothly over ~1.2s.
- No fade on first load; no fade when the phase doesn't change.
- Reduced-motion users get instant swaps.
- Rapid toggling never leaves a stuck or half-faded layer.
- `shouldCrossfade` is covered by unit tests; full suite green.

## Out of Scope (YAGNI)

- Cross-fading chrome/token colors (instant switch retained).
- Separately animating nebula/stars/moon (they switch with the phase under the fade).
- Any change to phase windows, images, or the toggle's state machine.
- Cross-fading transitions anywhere other than the `#cosmos-bg` scene photo.
