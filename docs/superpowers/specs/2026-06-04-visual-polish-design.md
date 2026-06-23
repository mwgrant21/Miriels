# Visual Polish Design — Miriel's Readings
**Date:** 2026-06-04
**Status:** Approved

## Overview

Full visual polish pass across the Miriel's Readings tarot web app (`public/index.html`, `public/style.css`, `public/app.js`). The goal is a cohesive, immersive upgrade — more atmospheric, more polished, nothing rebuilt from scratch.

---

## 1. Background

**Decision:** Full-page fixed background using `MirielBG.jpg.jpg` (located at `C:\Users\Matt\projects\tarot\MirielBG.jpg.jpg`) with a 70% dark overlay.

**Implementation:**
- Copy image to `public/images/mirielbg.jpg` (rename for cleanliness)
- Apply to `body` as a `background-image` with `background-attachment: fixed; background-size: cover; background-position: center top`
- Overlay via a pseudo-element or layered gradient: `linear-gradient(rgba(9,9,26,0.70), rgba(9,9,26,0.70))`
- Remove the existing `--bg: #0d0d1a` solid background from `body`; keep it as a fallback color
- All panel/card backgrounds should remain opaque or near-opaque so they read clearly over the image

---

## 2. Header — Atmospheric & Centered

**Decision:** Replace the current left-aligned single-row header with a centered, two-row atmospheric header.

**Structure:**

```
✦ · ✦ · ✦
MIRIEL'S READINGS
Tarot · Oracle · Runes

[Row 1] Deck ▾  |  General  Relationship  Spiritual  |  ☽ Lay the Cards
[Row 2] Spread → [dropdown]  |  🎲 Draw for me   ✏ I'll choose
```

**Details:**
- Header background: `linear-gradient(180deg, #160e2a 0%, #0f0d22 100%)` — slightly darker than before to contrast with the image behind it
- Ornament: `✦ · ✦ · ✦` in `#8a6f30`, `letter-spacing: 0.35em`, `font-size: 0.65rem`
- Title: `MIRIEL'S READINGS` — uppercase, `font-size: 1.25rem`, `letter-spacing: 0.18em`, color `#c9a84c`
- Tagline: `Tarot · Oracle · Runes` — `font-size: 0.6rem`, `letter-spacing: 0.22em`, color `#8a6f30`, uppercase
- Row 1: flex, centered, `gap: 6px` — deck `<select>`, pipe separators, category tab badges, draw button
- Row 2: flex, centered, `gap: 6px`, separated from row 1 by a subtle top border — spread dropdown + mode toggle badges
- Category tabs (General / Relationship / Spiritual): styled as pill badges, active state uses `var(--purple)` background
- Spread dropdown: `<select>` element styled with `border-color: #3a2a6a`, `color: var(--gold)` — populated dynamically by `app.js` based on active category
- **Miriel's Choice:** renamed from "Reader's Choice" everywhere in `app.js` and the spread dropdown. Added as the last `<option>` in each category's spread list with label `⋯ Miriel's Choice`
- "Lay the Cards" button: gold gradient, bold, right-aligned in row 1
- Question bar: stays below header as a separate bar; center the input text; slightly more transparent background

---

## 3. Cards — Framed & Antique

**Decision:** Gold border with double-inset frame; moon card back; gold aura glow on hover; face-down cards pulse with a living purple shimmer.

**CSS changes to `.card-face`, `.card-back`, `.card-container`:**

```css
/* Border */
border: 2px solid var(--gold-dim);
box-shadow:
  0 6px 24px rgba(0,0,0,0.7),
  inset 0 0 0 3px var(--bg),
  inset 0 0 0 4px #2a2040;

/* Hover (face) */
.card-face:hover {
  box-shadow:
    0 10px 32px rgba(0,0,0,0.8),
    inset 0 0 0 3px var(--bg),
    inset 0 0 0 4px #2a2040,
    0 0 20px rgba(201,168,76,0.28);
  transform: translateY(-4px);
}

/* Card back — moon motif */
.card-back {
  background: radial-gradient(ellipse at 50% 40%, #1e1040 0%, #0a0818 100%);
  border-color: #5a4080;
}
/* ☽ symbol centered on back (via ::after or existing back element) */

/* Face-down pulse (on .card-back before flip) */
@keyframes card-back-pulse {
  0%, 100% { box-shadow: 0 6px 24px rgba(0,0,0,0.7), inset 0 0 0 3px var(--bg), inset 0 0 0 4px #2a2040, 0 0 6px rgba(123,94,167,0.12); }
  50%       { box-shadow: 0 6px 24px rgba(0,0,0,0.7), inset 0 0 0 3px var(--bg), inset 0 0 0 4px #2a2040, 0 0 20px rgba(123,94,167,0.35); }
}
.card-back { animation: card-back-pulse 3s ease-in-out infinite; }
/* Stop animation once flipped: .card-inner.flipped .card-back { animation: none; } */
```

**Note:** The `inset` double-border trick requires the outer `border` plus two `inset box-shadow` layers — no extra HTML elements needed.

---

## 4. Meaning Panel — Two-Column Split

**Decision:** When the meaning panel is visible, display card meanings in a left column and the AI reading (or the "Open the reading" button pre-click) in a right column. No layout changes while the panel is hidden.

**Layout:**

```
┌─────────────────────┬─────────────────────┐
│   Card Meanings     │    The Reading       │
│                     │                      │
│  [Past]             │  ✦ Miriel Speaks ✦  │
│  The Moon           │                      │
│  Illusion · Fear    │  [AI text or        │
│  ...meaning text... │   "Open" button]    │
│                     │                      │
│  [Present]          │                      │
│  The Star (Rev)     │                      │
│  ...                │                      │
└─────────────────────┴─────────────────────┘
```

**CSS:** `.meaning-panel` becomes `display: flex; gap: 1rem; align-items: flex-start`

**Left column (`.meanings-col`):** `flex: 1` — contains existing `#meaning-content` with per-card entries

**Right column (`.ai-col`):** `flex: 1` — contains `#claude-response` (synopsis + clarifier + continue sections) and the `#ask-claude-btn`

**Keyword pills:** In `.meaning-keywords`, wrap each comma-separated keyword in a `<span class="keyword-pill">`. CSS:
```css
.keyword-pill {
  display: inline-block;
  background: rgba(201,168,76,0.1);
  border: 1px solid rgba(201,168,76,0.18);
  color: var(--gold-dim);
  border-radius: 10px;
  padding: 1px 7px;
  font-size: 0.68rem;
  letter-spacing: 0.05em;
  margin: 1px 2px 3px;
  text-transform: uppercase;
}
```
Reversed-card keywords get the purple pill variant (`border-color: rgba(123,94,167,0.25); color: var(--purple-light); background: rgba(123,94,167,0.12)`).

**Responsive fallback:** Below `768px`, stack columns vertically (revert to single column).

---

## 5. Rename: Reader's Choice → Miriel's Choice

All occurrences of "Reader's Choice" and `reader-choice` display labels in `app.js` and `index.html` are renamed to "Miriel's Choice". The spread dropdown option label is `⋯ Miriel's Choice`.

---

## Key JS Change — Spread Selector

The current `app.js` calls `initSpreadButtons()` which renders spread options as `<button>` elements inside `#spread-select` (a `.btn-group`). This needs to change to populate a `<select>` element instead.

- Replace `#spread-select` in `index.html` with `<select id="spread-select" class="spread-select">`
- Update `initSpreadButtons()` to write `<option>` elements filtered by the active category tab
- Category tab clicks re-populate the `<select>` with that category's spreads and append `<option>⋯ Miriel's Choice</option>` last
- The selected value replaces the previous `data-spread` button active state for spread selection throughout the app

---

## Files Changed

| File | Changes |
|---|---|
| `public/style.css` | Background, header layout, card borders/pulse animation, two-column meaning panel, keyword pills |
| `public/index.html` | Header restructure (title/tagline/ornament, two-row controls), spread dropdown element |
| `public/app.js` | Spread dropdown population per category, Miriel's Choice rename, keyword pill wrapping in meaning render |
| `public/images/mirielbg.jpg` | New file — copy of `MirielBG.jpg.jpg` |

---

## Out of Scope

- No changes to card data, spread logic, AI prompt, or reading flow
- No changes to the settings modal, resume panel, or reading archive
- No mobile-specific redesign (responsive fallback only)
- No font changes (keeping Georgia serif throughout)
