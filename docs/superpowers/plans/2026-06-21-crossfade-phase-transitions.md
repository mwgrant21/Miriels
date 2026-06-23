# Cross-Fade Phase Transitions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When the time-of-day phase changes (Auto clock boundary or manual toggle), gently cross-fade the background scene photo over ~1.2s instead of hard-cutting.

**Architecture:** A transient `.cosmos-forest-fade` overlay is painted with the outgoing scene and faded out (opacity 1→0) while the new phase's photo is already live on `.cosmos-forest` underneath. A pure `shouldCrossfade(prev, next)` helper (new `public/theme-transition.js`, browser-global + node-requireable) gates the effect; `applyTimeOfDayTheme()` orchestrates the DOM work. Chrome/token colors still switch instantly. Reduced-motion gets instant swaps.

**Tech Stack:** Vanilla browser JS/CSS/HTML (plain global scripts, no bundler). Unit tests via `node:test` + `node:assert/strict`.

**Spec:** `docs/superpowers/specs/2026-06-21-crossfade-phase-transitions-design.md`

**Key facts the engineer must know:**
- `public/index.html` loads plain global scripts: `<script src="app.js"></script>` at the bottom (currently line ~309), preceded by an html2canvas CDN script. There is no module system.
- The background lives in `#cosmos-bg` (index.html ~lines 10-16): children in order are `.cosmos-forest`, `.cosmos-nebula`, `.cosmos-stars`, `.cosmos-moon#cosmos-moon`, `.cosmos-vignette`. All are `position:absolute; inset:0` (except stars/moon), so DOM order = paint order.
- `.cosmos-forest`'s per-phase photo is set by CSS: base `.cosmos-forest { background-image: linear-gradient(...), url(...) }` plus `body[data-time="night|day|dawn|dusk"] .cosmos-forest { background-image: ... }`.
- `applyTimeOfDayTheme()` (app.js ~387-391) currently just sets `document.body.dataset.time = resolveThemeTime(getThemeMode())` and calls `updateThemeButton(mode)`. It runs at init top, on a 60s `setInterval`, on `visibilitychange`, and via `cycleTheme()` (the toggle).
- Tests run with `node --test tests/*.test.js` (use the glob form). Current suite: 140 passing.

---

### Task 1: Pure `shouldCrossfade` helper + unit tests

The DOM-free decision function, in a new shared file usable by both the browser and node.

**Files:**
- Create: `public/theme-transition.js`
- Test: `tests/theme-transition.test.js`

- [ ] **Step 1: Write the failing tests**

Create `tests/theme-transition.test.js`:

```javascript
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { shouldCrossfade } = require('../public/theme-transition');

test('cross-fades on a real phase change', () => {
  assert.equal(shouldCrossfade('day', 'night'), true);
  assert.equal(shouldCrossfade('dawn', 'dusk'), true);
});

test('does not cross-fade when the phase is unchanged', () => {
  assert.equal(shouldCrossfade('night', 'night'), false);
});

test('does not cross-fade on first paint (no previous phase)', () => {
  assert.equal(shouldCrossfade(null, 'day'), false);
  assert.equal(shouldCrossfade(undefined, 'day'), false);
  assert.equal(shouldCrossfade('', 'day'), false);
});

test('does not cross-fade when next is missing', () => {
  assert.equal(shouldCrossfade('day', ''), false);
  assert.equal(shouldCrossfade('day', null), false);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/theme-transition.test.js`
Expected: FAIL with `Cannot find module '../public/theme-transition'`.

- [ ] **Step 3: Implement `public/theme-transition.js`**

Create `public/theme-transition.js` with EXACTLY:

```javascript
(function (root) {
  'use strict';

  // Cross-fade only on a real phase change: both phases set, and different.
  // Pure and DOM-free so it can be unit-tested in node and reused in the browser.
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

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/theme-transition.test.js`
Expected: PASS (all 4 tests green).

- [ ] **Step 5: Commit**

```bash
git add public/theme-transition.js tests/theme-transition.test.js
git commit -m "feat(visual): add pure shouldCrossfade phase-transition helper"
```

---

### Task 2: Fade layer markup + script include + CSS

Add the transient overlay element, load the helper before `app.js`, and style the fade layer.

**Files:**
- Modify: `public/index.html` (inside `#cosmos-bg` ~line 11; script includes ~line 308-309)
- Modify: `public/style.css` (add a rule near the `.cosmos-forest` / `.cosmos-vignette` block ~line 3086)

- [ ] **Step 1: Add the fade layer element**

In `public/index.html`, find:

```html
  <div id="cosmos-bg" aria-hidden="true">
    <div class="cosmos-forest"></div>
    <div class="cosmos-nebula"></div>
```

and insert the fade layer immediately after `.cosmos-forest`:

```html
  <div id="cosmos-bg" aria-hidden="true">
    <div class="cosmos-forest"></div>
    <div class="cosmos-forest-fade" aria-hidden="true"></div>
    <div class="cosmos-nebula"></div>
```

- [ ] **Step 2: Load the helper before app.js**

In `public/index.html`, find:

```html
  <script src="https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js" crossorigin="anonymous"></script>
  <script src="app.js"></script>
```

and insert the helper script before `app.js`:

```html
  <script src="https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js" crossorigin="anonymous"></script>
  <script src="theme-transition.js"></script>
  <script src="app.js"></script>
```

- [ ] **Step 3: Add the fade-layer CSS**

In `public/style.css`, immediately AFTER the `.cosmos-vignette { ... }` rule (ends ~line 3086, just before the `/* ── Night theme ── */` comment), add:

```css
/* Transient outgoing-scene layer for the phase cross-fade. At transition time JS
   paints it (inline) with the PREVIOUS phase's computed background and fades it out
   while the new phase's photo is already live on .cosmos-forest underneath. It sits
   directly above the scene photo in markup, below the nebula/stars/moon. */
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

- [ ] **Step 4: Sanity check (no test framework for HTML/CSS)**

Run: `node -e "const fs=require('fs'); const h=fs.readFileSync('public/index.html','utf8'); const c=fs.readFileSync('public/style.css','utf8'); if(!h.includes('cosmos-forest-fade')) throw new Error('html missing fade layer'); if(!h.includes('theme-transition.js')) throw new Error('html missing script include'); if(!c.includes('.cosmos-forest-fade')) throw new Error('css missing fade rule'); console.log('markup+css OK');"`
Expected: `markup+css OK`

- [ ] **Step 5: Commit**

```bash
git add public/index.html public/style.css
git commit -m "feat(visual): add cross-fade scene layer markup, script include, and CSS"
```

---

### Task 3: Orchestrate the cross-fade in `applyTimeOfDayTheme()`

Wire the helper + fade layer into the theme application so phase changes dissolve.

**Files:**
- Modify: `public/app.js` (`applyTimeOfDayTheme`, currently lines 387-391)

- [ ] **Step 1: Replace `applyTimeOfDayTheme`**

In `public/app.js`, find EXACTLY:

```javascript
function applyTimeOfDayTheme() {
  const mode = getThemeMode();
  document.body.dataset.time = resolveThemeTime(mode);
  updateThemeButton(mode);
}
```

Replace it with:

```javascript
// Apply the resolved phase to <body data-time>. When the phase genuinely changes
// (and motion is allowed), cross-fade the background scene: paint a transient layer
// with the OUTGOING scene at full opacity, switch the phase so the new photo is live
// underneath, then dissolve the outgoing layer out over ~1.2s. Any failure falls back
// to the instant swap so theming never breaks.
function applyTimeOfDayTheme() {
  const mode = getThemeMode();
  const next = resolveThemeTime(mode);
  const prev = document.body.dataset.time || null;
  const reduceMotion = window.matchMedia
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  let faded = false;
  if (typeof shouldCrossfade === 'function' && shouldCrossfade(prev, next) && !reduceMotion) {
    try {
      const forest = document.querySelector('.cosmos-forest');
      const fade   = document.querySelector('.cosmos-forest-fade');
      if (forest && fade) {
        const cs = getComputedStyle(forest);
        fade.style.backgroundImage    = cs.backgroundImage;
        fade.style.backgroundSize     = cs.backgroundSize;
        fade.style.backgroundPosition = cs.backgroundPosition;
        fade.style.transition = 'none';   // snap to the visible (outgoing) scene
        fade.style.opacity = '1';
        void fade.offsetWidth;             // commit the opacity:1 start point
        fade.style.transition = '';        // restore the CSS 1.2s ease-in-out
        document.body.dataset.time = next; // new photo now live under the fade layer
        fade.addEventListener('transitionend', function onEnd(e) {
          if (e.propertyName !== 'opacity') return;
          fade.style.backgroundImage = '';
        }, { once: true });
        requestAnimationFrame(() => { fade.style.opacity = '0'; });
        faded = true;
      }
    } catch (err) {
      faded = false; // fall through to the instant swap below
    }
  }

  if (!faded) document.body.dataset.time = next;
  updateThemeButton(mode);
}
```

- [ ] **Step 2: Syntax check**

Run: `node --check public/app.js`
Expected: no output (exit 0).

- [ ] **Step 3: Run the full test suite**

Run: `node --test tests/*.test.js`
Expected: PASS, all green (140 prior + 4 new theme-transition tests).

- [ ] **Step 4: Commit**

```bash
git add public/app.js
git commit -m "feat(visual): cross-fade the background scene on phase change"
```

---

## Final verification (after all tasks)

- [ ] `node --check public/app.js` (exit 0).
- [ ] `node --test tests/*.test.js` (all green).
- [ ] **Live (manual):** Start the dev server (`node server.js` / `tarot.bat`), open the app, and press the theme toggle through Dawn -> Day -> Dusk -> Night. Confirm:
  - each background swap **dissolves over ~1.2s** with no flash or hard seam;
  - the UI chrome/accent colors switch (instantly) in the same step;
  - rapidly clicking the toggle never leaves a stuck/half-faded layer (it always lands on the latest phase);
  - reload the page and confirm the **first paint does not fade**;
  - with OS "reduce motion" enabled (or DevTools emulation), confirm swaps are **instant**.

## Notes for the implementer

- Do NOT cross-fade the chrome/token colors — only the scene photo. The instant
  token switch is intended.
- `shouldCrossfade` is a global in the browser (from `theme-transition.js` loaded
  before `app.js`); the `typeof shouldCrossfade === 'function'` guard keeps
  `applyTimeOfDayTheme` safe if that script ever fails to load.
- Keep using `resolveThemeTime`/`getThemeMode`/`updateThemeButton` exactly as they are.
- ASCII only in code/strings (no em dashes), per the repo's prose policy.
