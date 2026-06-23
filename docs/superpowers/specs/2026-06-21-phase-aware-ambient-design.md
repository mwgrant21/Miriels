# Phase-Aware Ambient Design Spec

**Date:** 2026-06-21
**Status:** Approved (design), pending implementation plan
**App:** Miriel's Readings (web/Electron tarot app at `C:\Users\Matt\projects\tarot`)
**Builds on:** the four-phase day cycle (dawn/day/dusk/night, `body[data-time]`) and the
just-shipped cross-fade phase transitions (`applyTimeOfDayTheme()` in `public/app.js`,
`public/theme-transition.js`).

## Summary

Make the time-of-day phase felt in language, two ways:

- **A. Atmospheric scene line** — a small, always-present line under the header that
  changes with the phase (deterministic client-side copy, no LLM), pairing with the
  background cross-fade.
- **B. Miriel's greeting reflects the hour** — the Threshold reunion greeting may
  acknowledge the time of day, deepening her presence.

## Single source of truth

Both surfaces use the **resolved visual phase** = `document.body.dataset.time`
(`dawn|day|dusk|night`), which already honors the Auto clock and the manual toggle.
In Auto (the default) this equals the real local clock, so Miriel reads as accurate;
if the user forces a phase via the toggle, both the scene line and her greeting match
the mood they chose. No second time source, no dissonance between scene and voice.

(Note: `/api/interpret`'s existing "tonight" guard uses the server clock via
`partOfDay()` and is intentionally left unchanged. That endpoint guards against a
factual error mid-reading; this feature is ambient flavor. They do not conflict.)

---

## A. Atmospheric scene line

### A1. `public/ambient-lines.js` (new) — data + pure helper

UMD-style (browser global + node `require`), matching `public/theme-transition.js`.

```javascript
(function (root) {
  'use strict';

  var AMBIENT_LINES = {
    dawn: [
      'First light filters through the trees.',
      'The forest wakes in pale gold.',
      'Morning mist lifts from the clearing.',
      'Dawn settles soft over the woods.',
    ],
    day: [
      'Sunlight rests on the clearing.',
      'The woods are bright and still.',
      'Light pools warm among the leaves.',
      'The day holds steady over the trees.',
    ],
    dusk: [
      'The woods turn gold, then violet.',
      'Long shadows gather between the trees.',
      'The last light slips below the branches.',
      'Evening settles amber over the clearing.',
    ],
    night: [
      'All is quiet under the moon.',
      'Starlight threads the canopy.',
      'The forest rests in moonlit hush.',
      'The woods keep their secrets in the dark.',
    ],
  };

  // Pure: returns one scene line for the phase. Unknown/missing phase falls back to
  // night. rng is injectable for deterministic tests.
  function ambientLineFor(phase, rng) {
    var pool = AMBIENT_LINES[phase] || AMBIENT_LINES.night;
    var r = typeof rng === 'function' ? rng() : Math.random();
    var i = Math.floor(r * pool.length) % pool.length;
    return pool[i];
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { ambientLineFor: ambientLineFor, AMBIENT_LINES: AMBIENT_LINES };
  } else {
    root.ambientLineFor = ambientLineFor;
    root.AMBIENT_LINES = AMBIENT_LINES;
  }
})(typeof window !== 'undefined' ? window : globalThis);
```

### A2. `public/index.html`

- Under `.header-tagline` (the "Tarot &middot; Oracle &middot; Runes" line) add:
  ```html
  <div class="header-ambient" id="header-ambient"></div>
  ```
- Add `<script src="ambient-lines.js"></script>` before `<script src="app.js"></script>`
  (after `theme-transition.js`).

### A3. `public/style.css`

A subtle, faint italic line that can fade when it changes:

```css
.header-ambient {
  margin-top: 4px;
  font-size: 0.82rem;
  font-style: italic;
  letter-spacing: 0.02em;
  color: var(--ink-faint);
  opacity: 1;
  transition: opacity 0.5s ease-in-out;
  min-height: 1.1em; /* reserve space so the header does not jump when empty */
}
@media (prefers-reduced-motion: reduce) {
  .header-ambient { transition: none; }
}
```

`--ink-faint` is already token-themed per phase (warm day / cool night), so the line
recolors with the theme automatically.

### A4. `public/app.js` — update in `applyTimeOfDayTheme()`

The function already computes `prev` and `next` phases for the cross-fade. Add ambient
handling alongside it:

- **First paint** (`prev` is null): set `#header-ambient` text content to
  `ambientLineFor(next)` immediately, no fade.
- **Phase change** (`prev` and `next` differ): gently fade-swap. Set the element
  opacity to `0`; after a short timeout (~250ms, comfortably inside the 0.5s CSS
  transition) set its `textContent = ambientLineFor(next)` and opacity back to `1`.
- **No change:** do nothing (the function still runs every 60s).

Guard with `typeof ambientLineFor === 'function'` and a null-check on the element so a
missing script never breaks theming. The fade timeout is independent of the
background cross-fade (no coupling); both just happen to fire on the same phase change.

---

## B. Miriel's greeting reflects the hour

### B1. `data/memory-engine.js` — `buildGreetingPrompt`

Current signature:
`buildGreetingPrompt(mode, threads, gapDays, predictions = [], temporalCallbacks = [])`.

Add a trailing optional param `timeOfDay = ''`. When it is a non-empty string, append
one soft, optional instruction to the prompt:

> `\n\nIt is currently ${timeOfDay} where they are. You may let the hour gently color your greeting (a passing nod to the light or the time), but only if it feels natural; never force it and never make it the focus.`

When `timeOfDay` is empty, append nothing (backward-compatible — existing callers and
tests unaffected).

### B2. `server.js` — `GET /api/threshold`

- Read `req.query.phase`. Validate against the allowed set
  `['dawn','day','dusk','night']`; if not one of these, treat as empty string.
- Pass the validated phase as the new `timeOfDay` argument to `buildGreetingPrompt`
  at the existing call site (server.js ~1059).

### B3. `public/app.js` — `checkThreshold`

Append the phase to the existing fetch URL:

```javascript
const phase = document.body.dataset.time || '';
const r = await fetch(`/api/threshold?reader=${encodeURIComponent(currentReader.slug)}&phase=${encodeURIComponent(phase)}`);
```

The greeting still only renders on reunion/gentle modes (unchanged); this only tints
its voice when it does appear.

---

## Data flow

```
applyTimeOfDayTheme() (init / 60s / visibility / toggle)
  next = resolveThemeTime(mode); prev = body.dataset.time
  [cross-fade scene if changed]                      (already shipped)
  ambient line: first paint -> set; changed -> fade-swap; same -> no-op
  body.dataset.time = next

app open -> checkThreshold()
  GET /api/threshold?reader=<slug>&phase=<body.dataset.time>
  server validates phase -> buildGreetingPrompt(..., timeOfDay=phase)
  Sonnet greeting may nod to the hour -> shown in #threshold-greeting
```

## Error handling

- Missing `ambient-lines.js` / `#header-ambient`: guarded; theming proceeds, no line.
- Invalid/absent `phase` query: server uses empty `timeOfDay`; greeting behaves as
  today (no time reference). No error.
- `buildGreetingPrompt` with no `timeOfDay`: identical to current output.

## Testing

- **Unit (node:test):**
  - `tests/ambient-lines.test.js`: `ambientLineFor('dawn', () => 0)` returns the first
    dawn line; an unknown phase falls back to a night line; the returned line is always
    a member of the phase's pool; `rng` near 1 stays in bounds (no overflow).
  - `tests/memory-engine.test.js` (append): `buildGreetingPrompt(..., 'dusk')` includes
    the phase word and the soft "may let the hour" framing; called without `timeOfDay`
    it contains no such time reference (backward-compat).
- **Live (manual):** toggle phases and confirm the header line changes with a gentle
  ~0.5s fade in step with the cross-fade, and recolors with the theme; trigger a
  reunion greeting (clear `last_visit` or wait out the gap) at dawn vs night and
  confirm Miriel may nod to the hour without forcing it.
- **Regression:** `node --test tests/*.test.js` stays green.

## Success Criteria

- A phase-appropriate scene line is always visible under the header and changes
  (gently) with the phase, recoloring per theme.
- The Threshold greeting can acknowledge the hour, softly and optionally, when it
  appears.
- Both follow the single visual-phase source of truth.
- Unknown/missing phase degrades gracefully; full suite green; no new LLM call for the
  scene line.

## Out of Scope (YAGNI)

- Changing `/api/interpret`'s existing time handling.
- Phase-aware tagline or input placeholders.
- Any LLM call for the scene line (static data only).
- Animating the line's text beyond a simple opacity fade.
- Persisting which line was last shown (a fresh pick per phase change is fine).
