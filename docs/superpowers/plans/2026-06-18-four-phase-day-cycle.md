# Four-Phase Day Cycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the shipped day/night background theme into a four-phase cycle (dawn/day/dusk/night), each with its own forest image and accent treatment, plus a 5-state toggle.

**Architecture:** Pure front-end. The theme already works via `body.dataset.time` + CSS `body[data-time="…"]` token-override blocks (night = `:root` default, day = an override block). This adds two more values (`dawn`, `dusk`) with their own token blocks and per-phase atmosphere layers, generalizes the few *literal* warm element overrides to apply to all non-night phases via `:is()`, and grows the JS theme logic from 2 to 4 phases.

**Tech Stack:** Plain HTML/CSS/JS served by Express (`npm start` → http://localhost:3000), Electron. Tests: `node --test tests/*.test.js`.

**Verification:** Visual CSS — verify each phase in the browser by forcing it (`document.body.dataset.time='dawn'|'day'|'dusk'|'night'` in the console, or cycling the theme button). Existing tests are the regression guard.

**Branch:** `four-phase-day-cycle` (created; spec committed there).

---

## File Structure
- **Modify** `public/style.css` — generalize shared warm element overrides; add `body[data-time="dawn"]` and `body[data-time="dusk"]` token blocks + atmosphere overrides.
- **Modify** `public/app.js` — `THEME_MODES`, `resolveThemeTime`, `updateThemeButton` (2 → 4 phases, 5-state toggle).
- **Create** `public/images/mirielsunrise-optimized.jpg`, `public/images/mirieldusk-optimized.jpg`.

---

## Task 1: Optimize the two new images

**Files:** Create `public/images/mirielsunrise-optimized.jpg`, `public/images/mirieldusk-optimized.jpg`

- [ ] **Step 1: Optimize both PNGs to JPGs**

Run from project root:
```
node -e "const {Jimp}=require('jimp');(async()=>{for (const n of ['mirielsunrise','mirieldusk']){const img=await Jimp.read('public/images/'+n+'.png');img.scaleToFit({w:1920,h:1920});await img.write('public/images/'+n+'-optimized.jpg',{quality:73});console.log(n, require('fs').statSync('public/images/'+n+'-optimized.jpg').size);}})()"
```
Expected: both files written, each well under ~800,000 bytes.

- [ ] **Step 2: Verify**

Run: `ls -la public/images/mirielsunrise-optimized.jpg public/images/mirieldusk-optimized.jpg`
Expected: both exist, < ~800 KB.

- [ ] **Step 3: Commit**
```bash
git add public/images/mirielsunrise-optimized.jpg public/images/mirieldusk-optimized.jpg
git commit -m "perf(visual): add optimized sunrise + dusk images"
```

---

## Task 2: Four-phase theme logic (app.js)

**Files:** Modify `public/app.js` (the theme block at ~lines 359-388)

- [ ] **Step 1: Replace `THEME_MODES`, `resolveThemeTime`, `updateThemeButton`**

FIND:
```javascript
const THEME_MODES = ['auto', 'day', 'night'];

function getThemeMode() {
  const m = localStorage.getItem('themeMode');
  return THEME_MODES.includes(m) ? m : 'auto';
}

function resolveThemeTime(mode, date = new Date()) {
  if (mode === 'day' || mode === 'night') return mode;
  const h = date.getHours();
  return (h >= 19 || h < 6) ? 'night' : 'day';
}

function applyTimeOfDayTheme() {
  const mode = getThemeMode();
  document.body.dataset.time = resolveThemeTime(mode);
  updateThemeButton(mode);
}

function updateThemeButton(mode) {
  const btn = document.getElementById('theme-btn');
  if (!btn) return;
  // sun / crescent moon / half-circle (auto)
  btn.textContent = mode === 'day' ? '☀' : mode === 'night' ? '☾' : '◑';
  const label = mode.charAt(0).toUpperCase() + mode.slice(1);
  btn.title = `Theme: ${label}${mode === 'auto' ? ' (follows the clock)' : ''}`;
}
```
REPLACE WITH:
```javascript
const THEME_MODES = ['auto', 'dawn', 'day', 'dusk', 'night'];
const PHASE_GLYPHS = { auto: '◑', dawn: '🌅', day: '☀', dusk: '🌆', night: '🌙' };

function getThemeMode() {
  const m = localStorage.getItem('themeMode');
  return THEME_MODES.includes(m) ? m : 'auto';
}

// Clock windows: dawn 05-08, day 08-17, dusk 17-20, night 20-05.
function resolveThemeTime(mode, date = new Date()) {
  if (mode !== 'auto') return mode;
  const h = date.getHours();
  if (h >= 5 && h < 8) return 'dawn';
  if (h >= 8 && h < 17) return 'day';
  if (h >= 17 && h < 20) return 'dusk';
  return 'night';
}

function applyTimeOfDayTheme() {
  const mode = getThemeMode();
  document.body.dataset.time = resolveThemeTime(mode);
  updateThemeButton(mode);
}

function updateThemeButton(mode) {
  const btn = document.getElementById('theme-btn');
  if (!btn) return;
  btn.textContent = PHASE_GLYPHS[mode] || PHASE_GLYPHS.auto;
  const label = mode.charAt(0).toUpperCase() + mode.slice(1);
  btn.title = `Theme: ${label}${mode === 'auto' ? ' (follows the clock)' : ''}`;
}
```
(`cycleTheme` is unchanged — it already cycles `THEME_MODES` generically.)

- [ ] **Step 2: Verify**

Run: `node --check public/app.js` → expect no output (valid).
Then `npm start`, open http://localhost:3000, click the theme button repeatedly — it should cycle Auto → Dawn → Day → Dusk → Night → Auto with changing glyph/tooltip. (Dawn/dusk visuals come in Tasks 4-5; for now confirm `body[data-time]` changes via devtools.)

- [ ] **Step 3: Commit**
```bash
git add public/app.js
git commit -m "feat(visual): four-phase theme logic + 5-state toggle"
```

---

## Task 3: Generalize shared warm element overrides to all non-night phases

**Files:** Modify `public/style.css` (the `.spread-select-dropdown` base rule, and the `body[data-time="day"]` element overrides)

The day block has literal warm overrides for `.draw-btn`, `.question-bar`, `#question-input`, `header`, `.reader-note`, and `.spread-select-dropdown`. These should apply to dawn and dusk too (all warm phases), so generalize their selectors. Night keeps the cool base.

- [ ] **Step 1: Tokenize the base spread-dropdown border (so it themes for every phase)**

FIND:
```css
.spread-select-dropdown {
  background: var(--bg3);
  border: 1px solid #3a2a6a;
```
REPLACE WITH:
```css
.spread-select-dropdown {
  background: var(--bg3);
  border: 1px solid var(--border);
```
Then DELETE this now-redundant line (search for it):
```css
/* spread dropdown has a hardcoded purple border — warm it in day */
body[data-time="day"] .spread-select-dropdown { border-color: #4a3a1e; }
```

- [ ] **Step 2: Generalize the `.draw-btn` overrides**

FIND:
```css
body[data-time="day"] .draw-btn {
```
REPLACE WITH:
```css
body:is([data-time="day"], [data-time="dawn"], [data-time="dusk"]) .draw-btn {
```
FIND:
```css
body[data-time="day"] .draw-btn:hover {
```
REPLACE WITH:
```css
body:is([data-time="day"], [data-time="dawn"], [data-time="dusk"]) .draw-btn:hover {
```

- [ ] **Step 3: Generalize question-bar, input, header, reader-note**

FIND:
```css
body[data-time="day"] .question-bar {
```
REPLACE WITH:
```css
body:is([data-time="day"], [data-time="dawn"], [data-time="dusk"]) .question-bar {
```
FIND:
```css
body[data-time="day"] #question-input {
```
REPLACE WITH:
```css
body:is([data-time="day"], [data-time="dawn"], [data-time="dusk"]) #question-input {
```
FIND:
```css
body[data-time="day"] header {
```
REPLACE WITH:
```css
body:is([data-time="day"], [data-time="dawn"], [data-time="dusk"]) header {
```
FIND:
```css
body[data-time="day"] .reader-note {
```
REPLACE WITH:
```css
body:is([data-time="day"], [data-time="dawn"], [data-time="dusk"]) .reader-note {
```

- [ ] **Step 4: Verify**

Run: `npm start`; in console set `document.body.dataset.time='day'` — home should look exactly as before (the `:is()` selector still matches day). No visual regression.

- [ ] **Step 5: Commit**
```bash
git add public/style.css
git commit -m "refactor(visual): share warm element overrides across non-night phases"
```

---

## Task 4: Dawn token block + atmosphere

**Files:** Modify `public/style.css` (add after the `body[data-time="night"]` atmosphere overrides / near the day block)

- [ ] **Step 1: Add the dawn token block**

Append to the END of `public/style.css`:
```css
/* ── Dawn theme (body[data-time="dawn"]) — bright golden sunrise, rosy-warm ── */
body[data-time="dawn"] {
  --purple: #a06a4a;          /* warm rose-bronze active fill */
  --purple-light: #e0a878;    /* peachy rose */
  --nebula: #e8b86a;          /* warm gold */
  --moon: #ffe8d0;            /* warm cream-rose heading */
  --glow-moon: 0 0 18px rgba(255, 224, 200, 0.45);
  --glow-nebula: 0 0 18px rgba(232, 168, 100, 0.45);
  --takeover-pulse: 232, 168, 100;
  --sanctuary-bg: rgba(28, 18, 12, 0.68);
  --panel-fade-end: rgba(24, 16, 10, 0.96);
  --ink-lavender: #e0a878;
  --ink-muted: #bf9a7a;
  --ink-faint: #93785f;
  --ink-soft: #d8b89a;
  --placeholder-bg: linear-gradient(160deg, #2e1f14, #1c130a);
  --overlay-veil: rgba(26, 16, 10, 0.60);
  --card-ring: rgba(150, 100, 55, 0.55);
  --bg: #140d08;
  --bg2: #20150d;
  --bg3: #2a1c10;
  --border: #523c24;
}
body[data-time="dawn"] .cosmos-forest {
  background-image:
    linear-gradient(180deg, rgba(20, 12, 6, 0.45) 0%, rgba(16, 10, 6, 0.30) 45%, rgba(12, 8, 4, 0.55) 100%),
    url('../images/mirielsunrise-optimized.jpg');
}
body[data-time="dawn"] .cosmos-nebula {
  background:
    linear-gradient(180deg, rgba(60, 40, 16, 0.32) 0%, rgba(60, 40, 16, 0.10) 30%, transparent 55%),
    radial-gradient(ellipse at 50% 8%, rgba(232, 180, 110, 0.22), transparent 55%);
}
body[data-time="dawn"] .cosmos-stars { display: none; } /* daylight */
body[data-time="dawn"] .cosmos-moon  { display: none; } /* sun is in the image */
```

- [ ] **Step 2: Verify**

Run: `npm start`; console `document.body.dataset.time='dawn'`. Expect: sunrise image, warm rosy-gold chrome, no stars/moon, golden haze at top. Open Journal/reading — warm, legible.

- [ ] **Step 3: Commit**
```bash
git add public/style.css
git commit -m "feat(visual): dawn theme (sunrise image + rosy-gold accents)"
```

---

## Task 5: Dusk token block + atmosphere (amber + creeping violet)

**Files:** Modify `public/style.css` (append after the dawn block)

- [ ] **Step 1: Add the dusk token block**

Append to the END of `public/style.css`:
```css
/* ── Dusk theme (body[data-time="dusk"]) — sunset amber bridging to violet ── */
body[data-time="dusk"] {
  --purple: #8a5a8a;          /* plum-rose active fill (violet creeping in) */
  --purple-light: #d99a9a;    /* dusty rose */
  --nebula: #e0975a;          /* sunset amber */
  --moon: #f6d9c0;            /* warm rose-cream heading */
  --glow-moon: 0 0 18px rgba(246, 217, 192, 0.45);
  --glow-nebula: 0 0 18px rgba(224, 151, 90, 0.45);
  --takeover-pulse: 224, 151, 90;
  --sanctuary-bg: rgba(26, 16, 24, 0.70);
  --panel-fade-end: rgba(22, 14, 22, 0.96);
  --ink-lavender: #c98aa8;
  --ink-muted: #ad8a9a;
  --ink-faint: #836578;
  --ink-soft: #c4a4b4;
  --placeholder-bg: linear-gradient(160deg, #2a1a28, #1a1018);
  --overlay-veil: rgba(22, 12, 20, 0.62);
  --card-ring: rgba(138, 90, 110, 0.55);
  --bg: #150d12;
  --bg2: #1f1420;
  --bg3: #271a2a;
  --border: #4a3248;
}
body[data-time="dusk"] .cosmos-forest {
  background-image:
    linear-gradient(180deg, rgba(28, 16, 36, 0.45) 0%, rgba(22, 14, 26, 0.28) 45%, rgba(14, 9, 14, 0.55) 100%),
    url('../images/mirieldusk-optimized.jpg');
}
/* warm amber glow rising from the horizon + violet deepening at the very top */
body[data-time="dusk"] .cosmos-nebula {
  background:
    linear-gradient(180deg, rgba(40, 22, 60, 0.38) 0%, rgba(40, 22, 60, 0.12) 28%, transparent 52%),
    radial-gradient(ellipse at 50% 4%, rgba(120, 80, 150, 0.22), transparent 50%),
    radial-gradient(ellipse at 50% 118%, rgba(224, 140, 80, 0.26), transparent 55%);
}
/* a few faint early stars high up — fainter than night */
body[data-time="dusk"] .cosmos-stars {
  display: block;
  opacity: 0.28;
}
body[data-time="dusk"] .cosmos-moon { display: none; } /* dusk sky is in the image */
```

- [ ] **Step 2: Verify (both look + legibility)**

Run: `npm start`; console `document.body.dataset.time='dusk'`. Expect: dusk image, amber chrome with violet ink/accents, warm glow low + violet up top, faint stars high. Confirm reading/overlay text legible. Then cycle the theme button through all five and confirm each phase looks right.

- [ ] **Step 3: Commit**
```bash
git add public/style.css
git commit -m "feat(visual): dusk theme (sunset image + amber/violet blend)"
```

---

## Task 6: Wrap — four-phase pass + regression + version bump

**Files:** Modify `package.json`; reference `tests/`

- [ ] **Step 1: Regression tests**

Run: `node --test tests/*.test.js`
Expected: 105/105 pass.

- [ ] **Step 2: Full four-phase visual pass**

With `npm start` running, force each phase (`document.body.dataset.time='dawn'|'day'|'dusk'|'night'`) and confirm on home + a reading + Journal/Grimoire:
- correct image per phase; accents match (dawn rosy-gold, day gold, dusk amber/violet, night violet); no cool chrome leaks into dawn/day/dusk; text legible everywhere; toggle cycles all five and persists across reload.

- [ ] **Step 3: Bump version to 1.4.0**

In `package.json`, FIND `"version": "1.3.0",` REPLACE `"version": "1.4.0",`

- [ ] **Step 4: Commit**
```bash
git add package.json
git commit -m "chore: bump version to 1.4.0 (four-phase day cycle)"
```

Note: the packaged Electron rebuild happens during branch finishing (stop the dev server first to release the better-sqlite3 lock; `npm rebuild better-sqlite3` afterward to restore the Node ABI).

---

## Self-Review

**Spec coverage:**
- Four phases each with dedicated image → Tasks 1, 4, 5 (day/night already shipped) ✓
- Clock windows (dawn 5-8/day 8-17/dusk 17-20/night 20-5) → Task 2 ✓
- Accent palettes (dawn rosy-gold, dusk amber+violet) → Tasks 4, 5 ✓
- 5-state toggle with glyphs → Task 2 ✓
- Per-phase atmosphere (dawn no stars/moon; dusk faint stars + warm horizon/violet top) → Tasks 4, 5 ✓
- Overlays/cards/etc. theme automatically via tokens → covered by the dawn/dusk token blocks (verified in Tasks 4/5/6) ✓
- Reduced-motion already globally handled; no new uncovered animation ✓
- Image optimization, regression, version bump → Tasks 1, 6 ✓

**Placeholder scan:** none — every step has concrete code/values/commands.

**Type/name consistency:** `THEME_MODES`/`PHASE_GLYPHS`/`resolveThemeTime`/`updateThemeButton` consistent with `applyTimeOfDayTheme`/`cycleTheme` (unchanged). New `data-time` values `dawn`/`dusk` match between JS (`resolveThemeTime`) and CSS (`body[data-time="dawn"|"dusk"]`). All token names mirror the existing day block exactly (`--purple`, `--purple-light`, `--nebula`, `--moon`, `--glow-moon`, `--glow-nebula`, `--takeover-pulse`, `--sanctuary-bg`, `--panel-fade-end`, `--ink-*`, `--placeholder-bg`, `--overlay-veil`, `--card-ring`, `--bg/--bg2/--bg3/--border`).
