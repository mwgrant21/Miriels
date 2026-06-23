# Phase-Aware Ambient Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the time-of-day phase felt in language: a phase-keyed atmospheric scene line under the header, and a Threshold greeting that may softly acknowledge the hour.

**Architecture:** A pure `ambientLineFor(phase, rng)` helper (new `public/ambient-lines.js`, UMD) supplies deterministic scene copy; `applyTimeOfDayTheme()` fade-swaps a header line on phase change. `buildGreetingPrompt` gains an optional `timeOfDay` param; `/api/threshold` validates `&phase=` and passes it; `checkThreshold` sends the visual phase. Single source of truth = `body.dataset.time`.

**Tech Stack:** Vanilla browser JS/CSS/HTML (plain global scripts), Node/Express, `node:test`.

**Spec:** `docs/superpowers/specs/2026-06-21-phase-aware-ambient-design.md`

**Key facts the engineer must know:**
- `public/index.html` loads plain global scripts at the bottom; `theme-transition.js` is already included before `app.js`. Add `ambient-lines.js` alongside it.
- The four phases are `dawn|day|dusk|night`, held in `document.body.dataset.time`.
- `applyTimeOfDayTheme()` in `public/app.js` already computes `prev`/`next` phases (for the cross-fade) and is the single place theme changes are applied; it runs at init, on a 60s interval, on `visibilitychange`, and via the toggle.
- `buildGreetingPrompt(mode, threads, gapDays, predictions = [], temporalCallbacks = [])` lives in `data/memory-engine.js` (~line 129); it builds `material` from `[temporalBlock, threadBlock, predBlock].filter(Boolean).join('\n\n')`.
- `GET /api/threshold` is in `server.js` (~line 1017); it calls `buildGreetingPrompt(mode, shownThreads, gapDays, shownPredictions, temporalCallbacks)` (~line 1059).
- Tests run with `node --test tests/*.test.js`. Current suite: 144 passing.

---

### Task 1: `ambientLineFor` helper + unit tests

**Files:**
- Create: `public/ambient-lines.js`
- Test: `tests/ambient-lines.test.js`

- [ ] **Step 1: Write the failing tests**

Create `tests/ambient-lines.test.js`:

```javascript
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ambientLineFor, AMBIENT_LINES } = require('../public/ambient-lines');

test('returns the first line of a phase when rng is 0', () => {
  assert.equal(ambientLineFor('dawn', () => 0), AMBIENT_LINES.dawn[0]);
  assert.equal(ambientLineFor('night', () => 0), AMBIENT_LINES.night[0]);
});

test('returned line always belongs to the phase pool', () => {
  for (const phase of ['dawn', 'day', 'dusk', 'night']) {
    for (const r of [0, 0.25, 0.5, 0.75, 0.999]) {
      assert.ok(AMBIENT_LINES[phase].includes(ambientLineFor(phase, () => r)));
    }
  }
});

test('unknown or missing phase falls back to a night line', () => {
  assert.ok(AMBIENT_LINES.night.includes(ambientLineFor('teatime', () => 0)));
  assert.ok(AMBIENT_LINES.night.includes(ambientLineFor(undefined, () => 0)));
});

test('rng returning 1 stays in bounds (no overflow)', () => {
  const line = ambientLineFor('day', () => 1);
  assert.ok(AMBIENT_LINES.day.includes(line));
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/ambient-lines.test.js`
Expected: FAIL with `Cannot find module '../public/ambient-lines'`.

- [ ] **Step 3: Implement `public/ambient-lines.js`**

Create it with EXACTLY:

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

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/ambient-lines.test.js`
Expected: PASS (all 4 tests green).

- [ ] **Step 5: Commit**

```bash
git add public/ambient-lines.js tests/ambient-lines.test.js
git commit -m "feat(visual): add pure ambientLineFor phase scene-line helper"
```

---

### Task 2: `buildGreetingPrompt` time-of-day param + unit tests

**Files:**
- Modify: `data/memory-engine.js` (`buildGreetingPrompt` ~lines 129-147)
- Test: `tests/memory-engine.test.js` (append at end)

- [ ] **Step 1: Write the failing tests**

Append to `tests/memory-engine.test.js`:

```javascript
const { buildGreetingPrompt } = require('../data/memory-engine');

test('buildGreetingPrompt weaves in the hour when timeOfDay is given', () => {
  const p = buildGreetingPrompt('reunion', [{ content: 'the move' }], 30, [], [], 'dusk');
  assert.match(p, /dusk/);
  assert.match(p, /let the hour gently color your greeting/i);
});

test('buildGreetingPrompt omits any time reference when timeOfDay is empty', () => {
  const p = buildGreetingPrompt('reunion', [{ content: 'the move' }], 30, [], []);
  assert.doesNotMatch(p, /let the hour gently color your greeting/i);
});
```

Note: `buildGreetingPrompt` is already exported from `data/memory-engine.js`
(`module.exports.buildGreetingPrompt = buildGreetingPrompt;`). If the `const { buildGreetingPrompt } = require('../data/memory-engine');` line is already present earlier in the test file, do NOT duplicate it — reuse the existing import and add only the two `test(...)` blocks.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/memory-engine.test.js`
Expected: FAIL — the first test fails its `/dusk/` / framing assertions (param not yet supported).

- [ ] **Step 3: Add the `timeOfDay` param and time hint**

In `data/memory-engine.js`, change the signature line:

```javascript
function buildGreetingPrompt(mode, threads, gapDays, predictions = [], temporalCallbacks = []) {
```

to:

```javascript
function buildGreetingPrompt(mode, threads, gapDays, predictions = [], temporalCallbacks = [], timeOfDay = '') {
```

Then find this line:

```javascript
  const material = [temporalBlock, threadBlock, predBlock].filter(Boolean).join('\n\n');
```

and replace it with:

```javascript
  const timeHint = timeOfDay
    ? `It is currently ${timeOfDay} where they are. You may let the hour gently color your greeting (a passing nod to the light or the time), but only if it feels natural; never force it and never make it the focus.`
    : '';
  const material = [temporalBlock, threadBlock, predBlock, timeHint].filter(Boolean).join('\n\n');
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/memory-engine.test.js`
Expected: PASS (both new tests green, all existing tests still green).

- [ ] **Step 5: Commit**

```bash
git add data/memory-engine.js tests/memory-engine.test.js
git commit -m "feat(memory): buildGreetingPrompt can softly reflect the hour"
```

---

### Task 3: `/api/threshold` validates and passes the phase

**Files:**
- Modify: `server.js` (`GET /api/threshold` handler — `req` parsing near line 1017, and the `buildGreetingPrompt(...)` call near line 1059)

- [ ] **Step 1: Read the handler region**

Read `server.js` lines 1017-1062 to confirm where `req` is available and the exact
`buildGreetingPrompt(mode, shownThreads, gapDays, shownPredictions, temporalCallbacks)`
call site.

- [ ] **Step 2: Compute the validated phase**

In the `GET /api/threshold` handler, near the top (after the handler opens and `req`
is in scope, e.g. just before or after the existing `slug`/reader lookup), add:

```javascript
  const ALLOWED_PHASES = ['dawn', 'day', 'dusk', 'night'];
  const phase = ALLOWED_PHASES.includes(req.query.phase) ? req.query.phase : '';
```

- [ ] **Step 3: Pass it to `buildGreetingPrompt`**

Find the call (around line 1059):

```javascript
      greeting = await callLLM(persona, buildGreetingPrompt(mode, shownThreads, gapDays, shownPredictions, temporalCallbacks), 700, 'claude-sonnet-4-6');
```

Replace it with:

```javascript
      greeting = await callLLM(persona, buildGreetingPrompt(mode, shownThreads, gapDays, shownPredictions, temporalCallbacks, phase), 700, 'claude-sonnet-4-6');
```

- [ ] **Step 4: Syntax check + full suite**

Run: `node --check server.js`
Expected: no output (exit 0).
Run: `node --test tests/*.test.js`
Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add server.js
git commit -m "feat(threshold): pass validated time-of-day phase into the greeting"
```

---

### Task 4: Front-end wiring (header line element, CSS, app.js)

**Files:**
- Modify: `public/index.html` (header ~line 22; script includes ~line 309-311)
- Modify: `public/style.css` (add `.header-ambient` rule; place near the other header rules or at end of the header section)
- Modify: `public/app.js` (`applyTimeOfDayTheme` ~line 387; new `updateAmbientLine`; `checkThreshold` fetch ~line 1579)

- [ ] **Step 1: Add the header element**

In `public/index.html`, find:

```html
      <div class="header-tagline">Tarot &middot; Oracle &middot; Runes</div>
      <div class="header-moon" id="header-moon"></div>
```

and insert the ambient line between them:

```html
      <div class="header-tagline">Tarot &middot; Oracle &middot; Runes</div>
      <div class="header-ambient" id="header-ambient"></div>
      <div class="header-moon" id="header-moon"></div>
```

- [ ] **Step 2: Include the ambient-lines script**

In `public/index.html`, find:

```html
  <script src="theme-transition.js"></script>
  <script src="app.js"></script>
```

and insert the new script before `app.js`:

```html
  <script src="theme-transition.js"></script>
  <script src="ambient-lines.js"></script>
  <script src="app.js"></script>
```

- [ ] **Step 3: Add the CSS**

In `public/style.css`, add this rule (place it immediately after the
`.header-tagline { ... }` rule; if that rule is hard to locate, appending it at the
end of the file is acceptable):

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

- [ ] **Step 4: Add `updateAmbientLine` and call it from `applyTimeOfDayTheme`**

In `public/app.js`, find the END of `applyTimeOfDayTheme` (the current last two lines
of the function):

```javascript
  if (!faded) document.body.dataset.time = next;
  updateThemeButton(mode);
}
```

Replace with:

```javascript
  if (!faded) document.body.dataset.time = next;
  updateAmbientLine(prev, next);
  updateThemeButton(mode);
}

// Phase-keyed atmospheric scene line under the header. First paint sets it
// immediately; a real phase change fades it out, swaps the copy, and fades it back;
// an unchanged phase leaves it alone. Guarded so a missing script/element never
// breaks theming.
function updateAmbientLine(prev, next) {
  if (typeof ambientLineFor !== 'function') return;
  const el = document.getElementById('header-ambient');
  if (!el) return;
  const reduceMotion = window.matchMedia
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!prev) { el.textContent = ambientLineFor(next); return; }   // first paint
  if (prev === next) return;                                      // no change
  if (reduceMotion) { el.textContent = ambientLineFor(next); return; }
  el.style.opacity = '0';
  setTimeout(() => {
    el.textContent = ambientLineFor(next);
    el.style.opacity = '1';
  }, 250);
}
```

- [ ] **Step 5: Send the phase from `checkThreshold`**

In `public/app.js`, find:

```javascript
    const r = await fetch(`/api/threshold?reader=${encodeURIComponent(currentReader.slug)}`);
```

Replace with:

```javascript
    const phase = document.body.dataset.time || '';
    const r = await fetch(`/api/threshold?reader=${encodeURIComponent(currentReader.slug)}&phase=${encodeURIComponent(phase)}`);
```

- [ ] **Step 6: Syntax check + markup sanity + full suite**

Run: `node --check public/app.js`
Expected: no output (exit 0).
Run: `node -e "const fs=require('fs'); const h=fs.readFileSync('public/index.html','utf8'); if(!h.includes('header-ambient')) throw new Error('no header-ambient'); if(!h.includes('ambient-lines.js')) throw new Error('no ambient script'); console.log('markup OK');"`
Expected: `markup OK`
Run: `node --test tests/*.test.js`
Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add public/index.html public/style.css public/app.js
git commit -m "feat(visual): phase-keyed header scene line; send phase to threshold"
```

---

## Final verification (after all tasks)

- [ ] `node --check server.js public/app.js` (exit 0).
- [ ] `node --test tests/*.test.js` (all green: 144 prior + ambient-lines + greeting tests).
- [ ] **Live (manual):** Start the dev server (`node server.js` / `tarot.bat`), open the app:
  - A phase-appropriate italic line shows under the tagline; toggling phases changes
    it with a gentle ~0.5s fade, in step with the background cross-fade, and it
    recolors with the theme (warm in day, cool in night).
  - Reload at the same phase: the line is present immediately (no fade flash).
  - Trigger a reunion greeting (clear `last_visit:<slug>` from `data/memory.db` meta,
    or use a reader with a real gap) at dawn vs night and confirm Miriel may nod to
    the hour without forcing it.
  - With OS "reduce motion" on, the line swaps instantly.

## Notes for the implementer

- The scene line is pure static data, never an LLM call. Miriel's greeting hour
  reference is soft/optional by design — do not strengthen the wording.
- Keep the single source of truth: the phase sent to `/api/threshold` and used for the
  scene line is `document.body.dataset.time`.
- ASCII only in code/strings (no em dashes), per the repo's prose policy.
- Do NOT touch `/api/interpret`'s existing `partOfDay` time handling.
