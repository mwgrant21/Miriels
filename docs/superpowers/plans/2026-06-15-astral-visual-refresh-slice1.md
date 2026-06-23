# Astral Visual Refresh — Slice 1 (Foundation + Home + Reading) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish the astral design language (tokens + shared atmosphere layer + sanctuary panels) and apply it end-to-end to the home and reading surfaces of Miriel's Readings.

**Architecture:** Pure front-end re-skin. All visual tokens live as CSS custom properties in `public/style.css`. A new fixed background-layer system (cosmos sky + starfield + nebula + moon + forest horizon + vignette) replaces the flat `body` background image. Reading/text surfaces get a reusable "sanctuary" frosted-panel treatment so long text stays legible over the atmosphere. A small amount of JS in `public/app.js` wires the backdrop moon to the existing `moonPhaseInfo()` data. No features, flows, layout, or behavior change.

**Tech Stack:** Plain HTML/CSS/JS served by Express (`server.js`, `npm start` → http://localhost:3000), packaged in Electron. Existing tests run with `node --test tests/`.

**Verification note:** This is visual CSS work, which does not lend itself to unit-test TDD. Each visual task is verified by running the app and inspecting the screen (a screenshot via `powershell -File snap.ps1` is available, saving to `screenshots/01-miriel-home.png`). The existing `node --test tests/` suite is run as a **regression guard** to prove no behavior broke. Where a step has objectively checkable output (e.g. a token exists, reduced-motion disables animation), that is stated explicitly.

**Branch:** `astral-visual-refresh` (already created; spec already committed there).

---

## File Structure

- **Modify** `public/style.css` (~2,900 lines) — add tokens at `:root`, add atmosphere-layer + sanctuary + motion sections, re-skin header/controls/draw-btn/daily-card/meaning-panel/synopsis selectors. New CSS is added in clearly-commented sections; existing selectors are edited in place.
- **Modify** `public/index.html` — add the `#cosmos-bg` layer markup as the first child of `<body>`.
- **Modify** `public/app.js` — add `renderCosmosMoon()` and call it where `renderHeaderMoon()` is already called.
- **Create** `public/images/mirielbg-optimized.jpg` — compressed forest image for the horizon layer (replaces the 11.8 MB original in CSS references).
- **Reference only** `snap.ps1`, `tests/` (regression).

---

## Task 1: Design tokens

**Files:**
- Modify: `public/style.css:1-14` (the `:root` block)

- [ ] **Step 1: Extend the `:root` token block**

Replace the existing `:root { ... }` (lines 1-14) with the version below. All current tokens are kept verbatim; new astral, glow, elevation, and motion tokens are appended.

```css
:root {
  --bg: #0d0d1a;
  --bg2: #13132a;
  --bg3: #1a1a35;
  --gold: #c9a84c;
  --gold-dim: #8a6f30;
  --purple: #7b5ea7;
  --purple-light: #a07fd4;
  --text: #e8e0f0;
  --text-dim: #8a80a0;
  --border: #2a2a4a;
  --card-w: 240px;
  --card-h: 400px;

  /* ── Astral accents ── */
  --void: #06040f;
  --nebula: #5b4aa8;
  --night-blue: #2d3a6e;
  --starlight: #cdbcff;
  --silver: #b8c4e8;
  --moon: #e8e2ff;

  /* ── Glow tokens ── */
  --glow-moon: 0 0 22px rgba(205, 188, 255, 0.45);
  --glow-nebula: 0 0 20px rgba(91, 74, 168, 0.50);
  --glow-gold: 0 0 16px rgba(201, 168, 76, 0.40);

  /* ── Elevation tokens ── */
  --elev-panel: 0 8px 40px rgba(0, 0, 0, 0.50);
  --elev-panel-strong: 0 8px 50px rgba(0, 0, 0, 0.60);
  --hairline-silver: 1px solid rgba(184, 196, 232, 0.22);

  /* ── Sanctuary surface ── */
  --sanctuary-bg: rgba(8, 7, 18, 0.72);
  --sanctuary-blur: 6px;

  /* ── Motion tokens ── */
  --ease-astral: cubic-bezier(0.22, 0.61, 0.36, 1);
  --dur-fast: 0.18s;
  --dur-med: 0.4s;
  --dur-slow: 0.9s;
}
```

- [ ] **Step 2: Verify tokens parse (no visual change expected yet)**

Run: `npm start` then open http://localhost:3000
Expected: App loads exactly as before (tokens are defined but not yet referenced). No console errors.

- [ ] **Step 3: Commit**

```bash
git add public/style.css
git commit -m "feat(visual): add astral design tokens to :root"
```

---

## Task 2: Optimize the forest background image

**Files:**
- Create: `public/images/mirielbg-optimized.jpg`

The current `public/images/mirielbg.jpg` is ~11.8 MB — too heavy for Electron. Produce a compressed version for the horizon layer. `jimp` is already a devDependency.

- [ ] **Step 1: Write a one-off optimize script and run it**

Run this from the project root:

```bash
node -e "const {Jimp}=require('jimp');(async()=>{const img=await Jimp.read('public/images/mirielbg.jpg');img.scaleToFit({w:1920,h:1920});await img.write('public/images/mirielbg-optimized.jpg',{quality:72});console.log('wrote', require('fs').statSync('public/images/mirielbg-optimized.jpg').size, 'bytes');})()"
```

Expected: prints a byte count well under 1,000,000 (target < ~800 KB). If the `jimp` API differs in the installed version, fall back to: `npx jimp input=public/images/mirielbg.jpg output=public/images/mirielbg-optimized.jpg resize=1920,auto`.

- [ ] **Step 2: Verify the file exists and is small**

Run: `ls -la public/images/mirielbg-optimized.jpg`
Expected: file exists, size < ~1 MB.

- [ ] **Step 3: Commit**

```bash
git add public/images/mirielbg-optimized.jpg
git commit -m "perf(visual): add optimized forest image for atmosphere layer"
```

---

## Task 3: The atmosphere layer (background system)

**Files:**
- Modify: `public/index.html` (add markup after `<body>` open tag, before `<header>`)
- Modify: `public/style.css` (remove `background-image` from `body`; add new atmosphere section)

- [ ] **Step 1: Add the cosmos background markup**

In `public/index.html`, immediately after the `<body>` tag (currently line 9) and before `<header>` (line 10), insert:

```html
  <div id="cosmos-bg" aria-hidden="true">
    <div class="cosmos-stars"></div>
    <div class="cosmos-nebula"></div>
    <div class="cosmos-moon" id="cosmos-moon"></div>
    <div class="cosmos-forest"></div>
    <div class="cosmos-vignette"></div>
  </div>
```

- [ ] **Step 2: Remove the old body background image**

In `public/style.css`, edit the `body` rule (lines 18-31). Replace the `background-color` + `background-image` + related lines so `body` no longer paints the forest itself:

```css
body {
  background-color: var(--void);
  color: var(--text);
  font-family: 'Georgia', serif;
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}
```

- [ ] **Step 3: Add the atmosphere-layer CSS**

Append this new section to the end of `public/style.css`:

```css
/* ════════════════════════════════════════════════════════════
   ASTRAL ATMOSPHERE LAYER
   ════════════════════════════════════════════════════════════ */
#cosmos-bg {
  position: fixed;
  inset: 0;
  z-index: -1;
  overflow: hidden;
  background: radial-gradient(circle at 72% 8%, #2a2456 0%, #0f0d22 42%, var(--void) 100%);
}

.cosmos-stars {
  position: absolute;
  inset: -10%;
  background-image:
    radial-gradient(1px 1px at 20% 18%, #fff, transparent),
    radial-gradient(1px 1px at 60% 10%, var(--starlight), transparent),
    radial-gradient(1px 1px at 82% 22%, #fff, transparent),
    radial-gradient(1px 1px at 40% 30%, var(--silver), transparent),
    radial-gradient(1px 1px at 90% 14%, #fff, transparent),
    radial-gradient(1px 1px at 12% 60%, #fff, transparent),
    radial-gradient(1px 1px at 70% 52%, var(--starlight), transparent),
    radial-gradient(1px 1px at 33% 78%, var(--silver), transparent);
  background-repeat: repeat;
  background-size: 600px 600px;
  animation: cosmos-drift 180s linear infinite, cosmos-twinkle 6s ease-in-out infinite alternate;
}

.cosmos-nebula {
  position: absolute;
  top: 0; left: 0; right: 0; height: 70%;
  background: radial-gradient(ellipse at 30% 30%, rgba(91, 74, 168, 0.30), transparent 60%);
  animation: cosmos-breathe 14s ease-in-out infinite alternate;
}

.cosmos-moon {
  position: absolute;
  top: 5vh; right: 8vw;
  width: 70px; height: 70px;
  border-radius: 50%;
  background: radial-gradient(circle at 38% 35%, #fff, var(--moon) 55%, #a89fd0);
  box-shadow: 0 0 60px rgba(205, 188, 255, 0.65);
  animation: cosmos-breathe 9s ease-in-out infinite alternate;
}

.cosmos-forest {
  position: absolute;
  bottom: 0; left: 0; right: 0; height: 46%;
  background-image:
    radial-gradient(ellipse at 68% 100%, rgba(201, 168, 76, 0.18), transparent 60%),
    linear-gradient(180deg, transparent, rgba(7, 13, 9, 0.4) 30%, var(--void)),
    url('images/mirielbg-optimized.jpg');
  background-size: cover, cover, cover;
  background-position: center bottom;
  -webkit-mask: linear-gradient(180deg, transparent, #000 45%);
  mask: linear-gradient(180deg, transparent, #000 45%);
}

.cosmos-vignette {
  position: absolute;
  inset: 0;
  box-shadow: inset 0 0 160px rgba(0, 0, 0, 0.70);
  pointer-events: none;
}

@keyframes cosmos-drift {
  from { transform: translateY(0); }
  to   { transform: translateY(-300px); }
}
@keyframes cosmos-twinkle {
  from { opacity: 0.65; }
  to   { opacity: 1; }
}
@keyframes cosmos-breathe {
  from { opacity: 0.75; }
  to   { opacity: 1; }
}

@media (prefers-reduced-motion: reduce) {
  .cosmos-stars, .cosmos-nebula, .cosmos-moon { animation: none; }
}
```

- [ ] **Step 4: Verify the atmosphere renders**

Run: `npm start`, open http://localhost:3000
Expected: Dark cosmic backdrop with a faint drifting starfield, a glowing moon top-right, nebula glow upper-left, and the forest treeline grounded at the bottom fading up into the night. Existing content sits on top, readable.

- [ ] **Step 5: Verify reduced-motion**

In the browser devtools, emulate `prefers-reduced-motion: reduce` (Rendering tab) and reload.
Expected: stars/moon/nebula are static (no animation).

- [ ] **Step 6: Commit**

```bash
git add public/index.html public/style.css
git commit -m "feat(visual): add layered astral atmosphere background"
```

---

## Task 4: Sanctuary panel + helper classes

**Files:**
- Modify: `public/style.css` (append new section)

- [ ] **Step 1: Add reusable sanctuary + glow utility CSS**

Append to `public/style.css`:

```css
/* ════════════════════════════════════════════════════════════
   SANCTUARY PANELS & ASTRAL HELPERS  (reusable across surfaces)
   ════════════════════════════════════════════════════════════ */
.sanctuary {
  background: var(--sanctuary-bg);
  backdrop-filter: blur(var(--sanctuary-blur));
  -webkit-backdrop-filter: blur(var(--sanctuary-blur));
  border: var(--hairline-silver);
  border-radius: 12px;
  box-shadow: var(--elev-panel), inset 0 0 30px rgba(91, 74, 168, 0.08);
}

.astral-eyebrow {
  font-family: 'Georgia', serif;
  color: var(--gold);
  letter-spacing: 0.2em;
  font-size: 0.62rem;
  text-transform: uppercase;
}

.astral-heading {
  font-family: 'Georgia', serif;
  color: var(--moon);
  letter-spacing: 0.04em;
  text-shadow: var(--glow-moon);
}

.astral-glow-chip {
  background: var(--sanctuary-bg);
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
  border: var(--hairline-silver);
  color: var(--text);
  border-radius: 7px;
}
```

- [ ] **Step 2: Verify (no visual change yet — classes unused)**

Run: `npm start`, open http://localhost:3000
Expected: No change; no console errors. (These classes are applied in later tasks.)

- [ ] **Step 3: Commit**

```bash
git add public/style.css
git commit -m "feat(visual): add reusable sanctuary panel and astral helper classes"
```

---

## Task 5: Wire the backdrop moon to real moon-phase

**Files:**
- Modify: `public/app.js` (add function near `renderHeaderMoon`, ~line 1434; call it where `renderHeaderMoon()` is invoked)

- [ ] **Step 1: Add `renderCosmosMoon()`**

In `public/app.js`, immediately after the `renderHeaderMoon()` function (ends ~line 1440), add:

```javascript
function renderCosmosMoon() {
  const el = document.getElementById('cosmos-moon');
  if (!el) return;
  const { age, name } = moonPhaseInfo();
  // Illumination 0 (new) .. 1 (full) .. 0 (new) across the 29.53-day cycle.
  const illum = (1 - Math.cos((age / 29.53058867) * 2 * Math.PI)) / 2;
  // Dim the glow toward new moon, brighten toward full.
  el.style.opacity = String(0.45 + illum * 0.55);
  el.style.boxShadow = `0 0 ${30 + illum * 50}px rgba(205, 188, 255, ${0.35 + illum * 0.4})`;
  el.title = name;
}
```

- [ ] **Step 2: Call it where `renderHeaderMoon()` is called**

Find the call site of `renderHeaderMoon()` (grep: `renderHeaderMoon()` — it is called during init). Immediately after that call, add `renderCosmosMoon();`.

Run: `grep -n "renderHeaderMoon()" public/app.js`
Expected: at least one call site (besides the definition). Add `renderCosmosMoon();` right after it.

- [ ] **Step 3: Verify**

Run: `npm start`, open http://localhost:3000
Expected: backdrop moon's brightness reflects the current real moon phase; hovering shows the phase name. No console errors.

- [ ] **Step 4: Commit**

```bash
git add public/app.js
git commit -m "feat(visual): tie backdrop moon glow to real moon phase"
```

---

## Task 6: Home — header treatment

**Files:**
- Modify: `public/style.css` (`header`, `header h1`, header ornament/tagline selectors ~lines 33-46)

- [ ] **Step 1: Re-skin the header**

In `public/style.css`, update the `header` and `header h1` rules so the header is transparent (atmosphere shows through) and the title is luminous. Replace lines 33-46:

```css
header {
  background: linear-gradient(180deg, rgba(22, 14, 42, 0.55) 0%, rgba(15, 13, 34, 0.0) 100%);
  border-bottom: 1px solid rgba(184, 196, 232, 0.12);
  padding: 0.9rem 2rem 0;
}

header h1 {
  font-size: 1.35rem;
  color: var(--moon);
  letter-spacing: 0.24em;
  font-weight: normal;
  text-transform: uppercase;
  margin-bottom: 0.2rem;
  text-shadow: var(--glow-moon);
}
```

- [ ] **Step 2: Re-skin ornament + tagline**

Find `.header-ornament` and `.header-tagline` (grep them). Set the ornament color to `var(--gold)` with `letter-spacing: 0.3em`, and the tagline to `color: var(--text-dim); letter-spacing: 0.18em`. Apply via edits to those existing rules.

Run: `grep -n "header-ornament\|header-tagline" public/style.css`

- [ ] **Step 3: Verify**

Run: `npm start`, open http://localhost:3000
Expected: Title glows softly against the cosmos; header no longer has a hard opaque band; ornament is gold, tagline muted.

- [ ] **Step 4: Commit**

```bash
git add public/style.css
git commit -m "feat(visual): astral header treatment on home"
```

---

## Task 7: Home — controls as frosted chips + glowing Lay the Cards

**Files:**
- Modify: `public/style.css` (`.deck-select` ~906, `.draw-btn` ~748, `.settings-btn` ~49)

- [ ] **Step 1: Frost the deck select**

Update `.deck-select` (line 906 block): set `background: var(--sanctuary-bg)`, `backdrop-filter: blur(4px)`, `border: var(--hairline-silver)`, `color: var(--text)`, keep existing sizing. Keep `.deck-select option { background: var(--bg2); }`.

- [ ] **Step 2: Give Lay the Cards the nebula glow**

Replace the `.draw-btn` rule (lines 748-761) with:

```css
.draw-btn {
  background: linear-gradient(135deg, rgba(91, 74, 168, 0.35), rgba(91, 74, 168, 0.20));
  color: var(--moon);
  border: 1px solid var(--nebula);
  padding: 0.5rem 1.5rem;
  font-size: 0.9rem;
  font-family: 'Georgia', serif;
  letter-spacing: 0.08em;
  border-radius: 8px;
  cursor: pointer;
  font-weight: bold;
  box-shadow: var(--glow-nebula);
  transition: box-shadow var(--dur-med) var(--ease-astral),
              transform var(--dur-fast) var(--ease-astral);
  margin-left: auto;
}

.draw-btn:hover {
  box-shadow: 0 0 30px rgba(91, 74, 168, 0.7);
  transform: translateY(-1px);
}
.draw-btn:active { transform: translateY(0); }
```

- [ ] **Step 3: Verify**

Run: `npm start`, open http://localhost:3000
Expected: Deck dropdown is a frosted chip; "Lay the Cards" glows with nebula light and brightens on hover. Other control buttons still legible.

- [ ] **Step 4: Commit**

```bash
git add public/style.css
git commit -m "feat(visual): frosted controls and glowing Lay the Cards"
```

---

## Task 8: Home — Card of the Day frosted panel

**Files:**
- Modify: `public/style.css` (`.daily-card-bar` ~2538, `.daily-card-panel` ~2560, `.daily-card-name` ~2607)

- [ ] **Step 1: Re-skin the daily-card panel**

Update `.daily-card-bar` / `.daily-card-panel` to use the sanctuary surface: `background: var(--sanctuary-bg)`, `backdrop-filter: blur(var(--sanctuary-blur))`, `border: var(--hairline-silver)`, `border-radius: 12px`, `box-shadow: var(--elev-panel), inset 0 0 30px rgba(91,74,168,0.08)`. Update `.daily-card-name` to `color: var(--moon); text-shadow: var(--glow-moon)`.

- [ ] **Step 2: Verify**

Run: `npm start`, open http://localhost:3000 (Card of the Day shows on load if available)
Expected: Card of the Day sits in a glowing frosted panel; the card name glows softly.

- [ ] **Step 3: Commit**

```bash
git add public/style.css
git commit -m "feat(visual): Card of the Day sanctuary panel"
```

---

## Task 9: Reading — meaning panel as sanctuary

**Files:**
- Modify: `public/style.css` (`.meaning-panel` ~1446, `.col-eyebrow` ~1475)

- [ ] **Step 1: Convert the meaning panel to the sanctuary surface**

Replace the `.meaning-panel` rule (lines 1446-1457):

```css
.meaning-panel {
  width: 100%;
  max-width: 900px;
  background: var(--sanctuary-bg);
  backdrop-filter: blur(var(--sanctuary-blur));
  -webkit-backdrop-filter: blur(var(--sanctuary-blur));
  border: var(--hairline-silver);
  border-radius: 12px;
  padding: 1.5rem;
  display: flex;
  flex-direction: row;
  gap: 1.5rem;
  align-items: flex-start;
  box-shadow: var(--elev-panel-strong), inset 0 0 30px rgba(91, 74, 168, 0.08);
}
```

- [ ] **Step 2: Brighten the column eyebrows**

Update `.col-eyebrow` (line 1475 block): change `color: var(--text-dim);` to `color: var(--gold);` and keep the rest.

- [ ] **Step 3: Verify legibility over atmosphere**

Run: `npm start`, do a reading (Settings needs an API key for the full AI reading; if none, the card-meanings column still renders and is the key check).
Expected: The two-column panel is a frosted sanctuary; body text is crisp and easy to read over the cosmic backdrop; eyebrows are gold.

- [ ] **Step 4: Commit**

```bash
git add public/style.css
git commit -m "feat(visual): reading meaning panel as sanctuary surface"
```

---

## Task 10: Reading — synopsis block treatment

**Files:**
- Modify: `public/style.css` (`.synopsis-header` ~1612, `.synopsis-label` ~1624; `.synopsis-icon` if present)

- [ ] **Step 1: Re-skin the synopsis header**

Update `.synopsis-header` to center its content with a glowing divider feel, and `.synopsis-label` to use the astral heading style. Concretely, edit `.synopsis-label` to `color: var(--moon); text-shadow: var(--glow-moon); letter-spacing: 0.18em;` and set the `.synopsis-icon` color (grep it) to `var(--gold)` with `text-shadow: var(--glow-gold)`.

- [ ] **Step 2: Add a breathing glow to the synopsis divider**

Append to `public/style.css`:

```css
.synopsis-header {
  position: relative;
}
.synopsis-header::after {
  content: '';
  display: block;
  height: 1px;
  margin-top: 0.6rem;
  background: linear-gradient(90deg, transparent, rgba(205, 188, 255, 0.5), transparent);
  animation: cosmos-breathe 7s ease-in-out infinite alternate;
}
@media (prefers-reduced-motion: reduce) {
  .synopsis-header::after { animation: none; }
}
```

- [ ] **Step 3: Verify**

Run: `npm start`, open a reading with a synopsis ("The Reading" block).
Expected: "The Reading" label glows; flanking ornaments are gold; a soft luminous divider breathes beneath the header.

- [ ] **Step 4: Commit**

```bash
git add public/style.css
git commit -m "feat(visual): astral synopsis header with breathing divider"
```

---

## Task 11: Reading — per-card framing + gentle reveal motion

**Files:**
- Modify: `public/style.css` (`.meaning-card` ~1492; the spread card element — grep `.spread-area` and the card image class)

- [ ] **Step 1: Refine per-card reflection framing**

Update `.meaning-card` (line 1492 block): change `border-bottom: 1px solid var(--border);` to `border-bottom: 1px solid rgba(184, 196, 232, 0.15);` so dividers read as starlight hairlines.

- [ ] **Step 2: Add a gentle card reveal animation**

Append to `public/style.css`:

```css
@keyframes card-reveal {
  from { opacity: 0; transform: translateY(8px) scale(0.98); }
  to   { opacity: 1; transform: translateY(0) scale(1); }
}
.spread-area .card,
#spread-area .card {
  animation: card-reveal var(--dur-slow) var(--ease-astral) both;
}
@media (prefers-reduced-motion: reduce) {
  .spread-area .card,
  #spread-area .card { animation: none; }
}
```

Note: confirm the actual card element selector with `grep -n "spread-area" public/style.css` and `grep -n "class=\"card" public/app.js`; adjust the selector above to match the real card class if it is not `.card`.

- [ ] **Step 3: Verify**

Run: `npm start`, lay a spread.
Expected: cards fade/rise in gently on reveal; reversed/highlight states still clear; reflection dividers are subtle starlight lines. With reduced-motion, cards appear instantly.

- [ ] **Step 4: Commit**

```bash
git add public/style.css
git commit -m "feat(visual): starlight card framing and gentle reveal motion"
```

---

## Task 12: Regression check + first-slice screenshot

**Files:**
- Reference only: `tests/`, `snap.ps1`

- [ ] **Step 1: Run the existing test suite (regression guard)**

Run: `node --test tests/`
Expected: All existing tests pass (no behavior changed). If the runner differs, use the project's established command.

- [ ] **Step 2: Capture a home screenshot for the record**

Run: with `npm start` running and the app open at http://localhost:3000 in the foreground browser: `powershell -ExecutionPolicy Bypass -File snap.ps1`
Expected: `screenshots/01-miriel-home.png` updated showing the astral home.

- [ ] **Step 3: Visual acceptance pass**

Confirm against the spec's success criteria:
- Tokens drive all new colors/glow/motion.
- Home + reading read as one cohesive, premium astral experience.
- Long reading text is crisp over the atmosphere (sanctuary working).
- Ambient motion is alive but not distracting; reduced-motion honored.
- Forest remains present and grounding; cosmos crowns it.

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "chore(visual): slice 1 regression check and home screenshot"
```

---

## Self-Review

**Spec coverage:**
- Design language / tokens → Task 1 ✓ (color, type via helpers, glow, elevation, motion)
- Optimize 11.8 MB image → Task 2 ✓
- Shared atmosphere layer (forest grounds / cosmos crowns, gentle motion, reduced-motion) → Task 3 ✓
- Moon-phase reuse → Task 5 ✓
- Sanctuary panels (reusable) → Task 4, applied in Tasks 8/9 ✓
- Home re-skin (title, controls, Lay the Cards, Card of the Day, backdrop) → Tasks 3,6,7,8 ✓
- Reading re-skin (sanctuary columns, synopsis, per-card framing, reveal motion) → Tasks 9,10,11 ✓
- No feature/behavior change; regression guard → Task 12 ✓
- Surfaces 3–7 (deal, summary, cards-everywhere, ritual overlays, reference overlays): **deferred to Slice 2 plan** per the spec's "validate, then propagate" strategy. Not a gap — intentional sequencing.

**Placeholder scan:** No TBD/TODO. Two steps (Task 5 Step 2, Task 11 Step 2) instruct a grep to confirm a real selector/call site before editing — this is verification of existing code, not a placeholder; the edit content is fully specified.

**Type/name consistency:** Tokens (`--void`, `--nebula`, `--starlight`, `--silver`, `--moon`, `--glow-moon`, `--glow-nebula`, `--sanctuary-bg`, `--hairline-silver`, `--ease-astral`, `--dur-*`) defined in Task 1 and referenced consistently throughout. Classes `.sanctuary`, `.astral-eyebrow`, `.astral-heading` defined in Task 4. `#cosmos-moon` defined in Task 3 markup, referenced in Task 5 JS. Consistent.
