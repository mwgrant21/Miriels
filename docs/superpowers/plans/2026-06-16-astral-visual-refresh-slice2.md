# Astral Visual Refresh — Slice 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply the astral design language + day/night theme to the five remaining surfaces (ritual overlays, reference overlays, atmospheric summary, cards, deal/shuffle), completing the visual refresh.

**Architecture:** Pure front-end re-skin in `public/style.css`. Slice 1 already made the accent and base tokens (`--purple`, `--purple-light`, `--nebula`, `--moon`, `--sanctuary-bg`, `--bg/--bg2/--bg3/--border`, glow tokens) day/night-aware via the `body[data-time="day"]` override block. Slice 2 mostly re-points remaining hardcoded-cool values at those tokens, applies the sanctuary treatment to overlay backdrops, and lightly enhances the deal/takeover motion. A couple of new theme-aware tokens are added where a hardcoded value must differ by theme.

**Tech Stack:** Plain HTML/CSS/JS served by Express (`npm start` → http://localhost:3000), Electron. Tests: `node --test tests/*.test.js`.

**Verification note:** Visual CSS work — verified by running the app and inspecting **both** day and night themes (toggle via the theme button, or `document.body.dataset.time='day'|'night'` in the console). The existing test suite is the regression guard. Each new animation gets a `prefers-reduced-motion` guard.

**Branch:** `astral-visual-refresh-slice2` (created; spec already committed there).

---

## File Structure

- **Modify** `public/style.css` only. New theme-aware tokens go in `:root` and the `body[data-time="day"]` block; selector retheming is in place. No markup or JS changes expected (CSS-only).

---

## Task 1: Overlay backdrops → themed sanctuary rooms

**Files:** Modify `public/style.css` (`.notebook-backdrop`, `.miriel-takeover`)

Make overlay backdrops translucent + blurred so the themed background shows as a soft wash behind them (the "sanctuary room" feel), instead of solid cool fills.

- [ ] **Step 1: Reskin `.notebook-backdrop`**

FIND:
```css
.notebook-backdrop {
  position: absolute;
  inset: 0;
  background: radial-gradient(ellipse at center, #1c1428 0%, #0a0810 100%);
}
```
REPLACE WITH:
```css
.notebook-backdrop {
  position: absolute;
  inset: 0;
  background: rgba(6, 4, 15, 0.66);
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
}
```

- [ ] **Step 2: Reskin the `.miriel-takeover` backdrop**

FIND (only the `background` line inside the `.miriel-takeover {` rule):
```css
  background: rgba(4, 2, 14, 0.93);
```
REPLACE WITH:
```css
  background: rgba(5, 3, 14, 0.78);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
```

- [ ] **Step 3: Verify (both themes)**

Run `npm start`; open http://localhost:3000. Open the Journal (📖) and trigger Miriel's prompt (clear session or reload). In both Day and Night (toggle button), the overlay should show a soft blurred wash of the themed background behind the content, still dark enough to read. No solid cool panel.

- [ ] **Step 4: Commit**
```bash
git add public/style.css
git commit -m "feat(visual): overlay backdrops as themed sanctuary rooms"
```

---

## Task 2: Reference overlay inner surfaces → sanctuary glass

**Files:** Modify `public/style.css` (`.journal-search`, `.journal-entry`, `.journal-entry-synopsis.collapsed::after`, `.grimoire-detail`; add `--panel-fade-end` token)

Re-point hardcoded cool fills to `--sanctuary-bg` so they theme. Gold borders (`rgba(201,164,92,...)`) are kept — gold reads correctly in both themes.

- [ ] **Step 1: Add a theme-aware fade token**

In `:root` (after `--sanctuary-blur: 6px;`), add:
```css
  --panel-fade-end: rgba(14, 10, 22, 0.96); /* night: collapsed-text fade target */
```
In the `body[data-time="day"] { ... }` block (after `--sanctuary-bg: ...;`), add:
```css
  --panel-fade-end: rgba(20, 15, 8, 0.96); /* day: warm collapsed-text fade target */
```

- [ ] **Step 2: Reskin `.journal-search`**

FIND:
```css
  background: rgba(20, 14, 32, 0.85);
  border: 1px solid rgba(201, 164, 92, 0.3);
```
REPLACE WITH:
```css
  background: var(--sanctuary-bg);
  border: 1px solid rgba(201, 164, 92, 0.3);
```

- [ ] **Step 3: Reskin `.journal-entry`**

FIND:
```css
  background: linear-gradient(165deg, rgba(30, 22, 46, 0.55), rgba(14, 10, 22, 0.7));
```
REPLACE WITH:
```css
  background: var(--sanctuary-bg);
```

- [ ] **Step 4: Reskin the collapsed-synopsis fade**

FIND:
```css
  background: linear-gradient(to bottom, transparent, rgba(18, 13, 28, 0.95));
```
REPLACE WITH:
```css
  background: linear-gradient(to bottom, transparent, var(--panel-fade-end));
```

- [ ] **Step 5: Reskin `.grimoire-detail`**

FIND:
```css
  background: linear-gradient(165deg, rgba(30, 22, 46, 0.65), rgba(14, 10, 22, 0.8));
```
REPLACE WITH:
```css
  background: var(--sanctuary-bg);
```

- [ ] **Step 6: Verify (both themes)**

Open Journal and Grimoire in Day and Night. Entry/detail cards and the search field should be warm-tinted glass by day, cool by night; collapsed-text fade blends to the panel in both. Text stays legible.

- [ ] **Step 7: Commit**
```bash
git add public/style.css
git commit -m "feat(visual): reference overlay surfaces use themed sanctuary glass"
```

---

## Task 3: Curiosity panel → themed sanctuary

**Files:** Modify `public/style.css` (`.curiosity-panel`)

- [ ] **Step 1: Reskin `.curiosity-panel` background**

FIND:
```css
  background: radial-gradient(120% 130% at 50% 0%, #241a33 0%, #150f20 70%);
  border: 1px solid rgba(198,166,100,0.4); border-radius: 12px;
```
REPLACE WITH:
```css
  background: var(--sanctuary-bg);
  backdrop-filter: blur(var(--sanctuary-blur));
  -webkit-backdrop-filter: blur(var(--sanctuary-blur));
  border: 1px solid rgba(198,166,100,0.4); border-radius: 12px;
```

- [ ] **Step 2: Verify (both themes)**

Trigger an in-reading curiosity pause (during a reading). The panel should warm by day / go cool by night, frosted, with its gold accents intact.

- [ ] **Step 3: Commit**
```bash
git add public/style.css
git commit -m "feat(visual): curiosity panel uses themed sanctuary surface"
```

---

## Task 4: Card back + states

**Files:** Modify `public/style.css` (`.card-back`)

Card name/arcana/reversed-badge already use tokens (`--gold`, `--text-dim`, `--purple`, `--purple-light`) and theme automatically. The face-down `.card-back` still uses hardcoded cool values — theme it.

- [ ] **Step 1: Reskin `.card-back`**

FIND:
```css
.card-back {
  background: radial-gradient(ellipse at 50% 40%, #1e1040 0%, #0a0818 100%);
  background-size: cover;
  background-position: center;
  background-repeat: no-repeat;
  border-color: #5a4080;
  cursor: pointer;
  animation: card-back-pulse 3s ease-in-out infinite;
}
```
REPLACE WITH:
```css
.card-back {
  background: radial-gradient(ellipse at 50% 40%, rgba(91, 74, 168, 0.55) 0%, var(--void) 100%);
  background-size: cover;
  background-position: center;
  background-repeat: no-repeat;
  border-color: var(--nebula);
  cursor: pointer;
  animation: card-back-pulse 3s ease-in-out infinite;
}
```
(`--nebula` is purple at night and gold by day; the radial inner uses the nebula-purple by night. For day, add the override in the next step.)

- [ ] **Step 2: Add a day override for the card-back inner glow**

Add to the END of `public/style.css`:
```css
/* Card back inner glow warms in day (nebula → gold family) */
body[data-time="day"] .card-back {
  background: radial-gradient(ellipse at 50% 40%, rgba(201, 168, 76, 0.45) 0%, var(--void) 100%);
}
```

- [ ] **Step 3: Verify (both themes)**

Before flipping cards (e.g. start a reading with face-down cards, or "I'll choose"), the card backs should glow purple at night and warm gold by day; border follows. Reversed badge already themes (purple→bronze in day).

- [ ] **Step 4: Commit**
```bash
git add public/style.css
git commit -m "feat(visual): themed card back glow (day/night)"
```

---

## Task 5: Atmospheric summary surface

**Files:** Modify `public/style.css` (`.theme-meaning` / `.theme-card-label` confirmation; add sanctuary wrap if needed)

The theme-card/summary area already uses tokens (`--border`, `--gold-dim`, `--gold`) so it themes. This task ensures the summary passage reads as a calm sanctuary moment on the themed background in both themes.

- [ ] **Step 1: Give the summary meaning block a sanctuary backing**

Locate `.theme-meaning {` (it currently has no background). Add a subtle sanctuary backing so the passage stays legible over the atmosphere. Replace:
```css
.theme-meaning {
  max-width: 480px;
  text-align: center;
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}
```
WITH:
```css
.theme-meaning {
  max-width: 480px;
  text-align: center;
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  background: var(--sanctuary-bg);
  backdrop-filter: blur(var(--sanctuary-blur));
  -webkit-backdrop-filter: blur(var(--sanctuary-blur));
  border: var(--hairline-silver);
  border-radius: 12px;
  padding: 1rem 1.25rem;
}
```

- [ ] **Step 2: Verify (both themes)**

Run a reading that shows the theme card / summary (e.g. a spread with a theme card). The passage sits in calm themed glass over the background, legible in both Day and Night.

- [ ] **Step 3: Commit**
```bash
git add public/style.css
git commit -m "feat(visual): summary passage in themed sanctuary surface"
```

---

## Task 6: Deal/shuffle + takeover — retheme + starlight shimmer

**Files:** Modify `public/style.css` (`.spread-pile-card`, `.miriel-takeover-ornament`; add `card-shimmer` keyframe)

Keep all existing motion (`dealSlideIn`, pile riffle, takeover fade/pulse). Retheme colors to tokens and add a gentle starlight shimmer on dealt cards.

- [ ] **Step 1: Confirm pile + ornament selectors and retheme cool literals**

Run `grep -n "spread-pile-card\|miriel-takeover-ornament" public/style.css`. For `.spread-pile-card`, if its `background`/`border` use hardcoded cool values (e.g. a dark blue/purple), re-point them to `var(--bg3)` / `var(--nebula)` (both theme). For `.miriel-takeover-ornament`, it currently uses `color: var(--gold-dim)` — leave (gold themes fine). Apply only to hardcoded-cool literals you find; show each change in the commit.

- [ ] **Step 2: Add a gentle starlight shimmer on dealt cards**

Add to the END of `public/style.css`:
```css
/* Gentle starlight shimmer as a card lands (rides on top of dealSlideIn) */
@keyframes card-shimmer {
  0%   { box-shadow: 0 0 0 rgba(205, 188, 255, 0.0); }
  40%  { box-shadow: 0 0 26px rgba(205, 188, 255, 0.45); }
  100% { box-shadow: 0 0 0 rgba(205, 188, 255, 0.0); }
}
.card-container.deal-in .card-inner,
.card-container.deal-drop .card-inner {
  animation: card-shimmer 1.1s ease-out 0.15s both;
}
body[data-time="day"] .card-container.deal-in .card-inner,
body[data-time="day"] .card-container.deal-drop .card-inner {
  animation-name: card-shimmer-day;
}
@keyframes card-shimmer-day {
  0%   { box-shadow: 0 0 0 rgba(201, 168, 76, 0.0); }
  40%  { box-shadow: 0 0 26px rgba(201, 168, 76, 0.45); }
  100% { box-shadow: 0 0 0 rgba(201, 168, 76, 0.0); }
}
@media (prefers-reduced-motion: reduce) {
  .card-container.deal-in .card-inner,
  .card-container.deal-drop .card-inner { animation: none; }
}
```
Note: the shimmer is on `.card-inner` (a child) so it does not conflict with the `dealSlideIn` transform animation on `.card-container`.

- [ ] **Step 3: Verify (both themes + reduced motion)**

Do an auto-deal ("Draw for me" → Lay the Cards). Cards keep their existing deal motion plus a brief starlight shimmer (purple by night, gold by day) as they land. With `prefers-reduced-motion` emulated, no shimmer. Miriel's Choice takeover ornaments read correctly in both themes.

- [ ] **Step 4: Commit**
```bash
git add public/style.css
git commit -m "feat(visual): themed deal/takeover with gentle starlight shimmer"
```

---

## Task 7: Wrap — dual-theme pass + regression

**Files:** Reference only (`tests/`)

- [ ] **Step 1: Regression tests**

Run: `node --test tests/*.test.js`
Expected: 105/105 pass.

- [ ] **Step 2: Full dual-theme visual pass**

With `npm start` running, walk every Slice 2 surface in BOTH themes (toggle Day/Night):
- Journal, Grimoire, "Your Story So Far" overlays — sanctuary rooms, legible, themed.
- Threshold + curiosity prompts — themed glass, themed pulse.
- A full reading: card backs, deal shimmer, theme-card/summary, reversed/highlight states.
Confirm: no cool chrome leaking into Day, no warm chrome leaking into Night; reduced-motion honored.

- [ ] **Step 3: Final commit (if any touch-ups were needed)**
```bash
git add -A
git commit -m "chore(visual): slice 2 dual-theme pass"
```

---

## Self-Review

**Spec coverage:**
- Ritual overlays (Threshold backdrop + curiosity) → Tasks 1, 3 ✓
- Reference overlays (notebook backdrop + journal + grimoire) → Tasks 1, 2 ✓
- Atmospheric summary → Task 5 ✓
- Cards everywhere (back + states; name/arcana/badge already token-themed) → Task 4 ✓
- Deal/shuffle + takeover (retheme + light enhancement, motion preserved) → Task 6 ✓
- Day/night correctness + reduced-motion + regression → Tasks 1–7 ✓ (each surface verified in both themes; new animations guarded)

**Placeholder scan:** Task 6 Step 1 instructs a grep-and-retheme of `.spread-pile-card` because its exact current values vary; the target tokens (`--bg3`/`--nebula`) and the rule (retheme only hardcoded-cool literals found) are explicit — this is grounded retheming, not a placeholder.

**Type/name consistency:** New tokens `--panel-fade-end` (Task 2, with day override) and keyframes `card-shimmer` / `card-shimmer-day` (Task 6) are defined where introduced and referenced consistently. All other targets are existing Slice 1 tokens (`--sanctuary-bg`, `--sanctuary-blur`, `--hairline-silver`, `--nebula`, `--void`).
