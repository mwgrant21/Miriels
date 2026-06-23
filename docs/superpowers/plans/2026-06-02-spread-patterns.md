# Spread Patterns Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 9 new spread patterns and reorganize the spread selector into category tabs, with Reader's Choice updated to pick from all spreads.

**Architecture:** Data-driven — `SPREADS` is the single source of truth (category, label, slots per spread). HTML spread buttons are generated from `SPREADS` at init. A `SPREAD_LAYOUTS` lookup table replaces the `renderSpread` if/else chain. `activateTab()` is called whenever the active spread changes programmatically so the visible tab always matches.

**Tech Stack:** Vanilla JS (ES6), CSS Grid/Flex, Node.js built-in test runner (`node:test`)

---

## File Map

| File | Changes |
|------|---------|
| `public/app.js` | SPREADS refactor; new spreads; SPREAD_LAYOUTS + renderSpread; initSpreadButtons/activateTab; Reader's Choice tab-switch; resumeReading fixes; spreadLabels dynamic |
| `public/index.html` | Replace spread button group with tab bar + empty `#spread-select` |
| `public/style.css` | 5 new grid layouts; tab bar + tab button styles |
| `server.js` | Updated `spreadMenu` string and `valid` array in `suggest-spread` handler |
| `tests/spreads.test.js` | New — validates SPREADS structure, SPREAD_LAYOUTS coverage, server valid array |

---

### Task 1: Commit current baseline

**Files:** `public/app.js`, `public/index.html`, `public/style.css`, `server.js`

- [ ] **Step 1: Verify app starts cleanly**

```powershell
cd C:\Users\Matt\projects\tarot
node server.js
```
Expected: server starts, no errors. Stop with Ctrl-C.

- [ ] **Step 2: Commit baseline**

```powershell
git init  # if not already a git repo
git add public/app.js public/index.html public/style.css server.js
git commit -m "chore: baseline before spread patterns feature"
```

---

### Task 2: Refactor SPREADS to new format + add 9 new spreads

**Files:**
- Modify: `public/app.js:18-77` (SPREADS object)
- Modify: `public/app.js:223-224` (compat slot label mutation)
- Modify: `public/app.js:747,751` (drawCards uses spreadDef as array)
- Modify: `public/app.js:1070,1077-1078` (resumeReading uses spreadDef as array)

Replace the entire `SPREADS` constant (lines 18–77) with the new format. Every existing spread keeps identical slots; 9 new spreads are added. All `SPREADS[key]` callsites that treat the value as an array must be updated to `.slots`.

- [ ] **Step 1: Replace SPREADS constant**

Replace lines 18–77 in `public/app.js`:

```js
const SPREADS = {
  'single': {
    category: 'general', label: 'Single',
    slots: [{ label: 'Card', position: '' }]
  },
  'three-card': {
    category: 'general', label: 'Three Card',
    slots: [
      { label: 'Past',    position: 'past' },
      { label: 'Present', position: 'present' },
      { label: 'Future',  position: 'future' }
    ]
  },
  'four-card': {
    category: 'general', label: 'Four Card',
    slots: [
      { label: 'Past',    position: 'past' },
      { label: 'Present', position: 'present' },
      { label: 'Future',  position: 'future' },
      { label: 'Advice',  position: 'advice' }
    ]
  },
  'five-card': {
    category: 'general', label: 'Five Card',
    slots: [
      { label: 'Past',    position: 'past' },
      { label: 'Present', position: 'present' },
      { label: 'Hidden',  position: 'hidden' },
      { label: 'Advice',  position: 'advice' },
      { label: 'Outcome', position: 'outcome' }
    ]
  },
  'yes-no': {
    category: 'general', label: 'Yes / No',
    slots: [
      { label: 'The Question',  position: 'question' },
      { label: 'The Challenge', position: 'challenge' },
      { label: 'The Answer',    position: 'answer' }
    ]
  },
  'horseshoe': {
    category: 'general', label: 'Horseshoe',
    slots: [
      { label: 'Past',              position: 'past' },
      { label: 'Present',           position: 'present' },
      { label: 'Hidden Influences', position: 'hidden' },
      { label: 'Obstacles',         position: 'obstacles' },
      { label: 'External Forces',   position: 'external' },
      { label: 'Best Action',       position: 'action' },
      { label: 'Outcome',           position: 'outcome' }
    ]
  },
  'year-ahead': {
    category: 'general', label: 'Year Ahead',
    slots: [
      { label: 'January',   position: 'jan' },
      { label: 'February',  position: 'feb' },
      { label: 'March',     position: 'mar' },
      { label: 'April',     position: 'apr' },
      { label: 'May',       position: 'may' },
      { label: 'June',      position: 'jun' },
      { label: 'July',      position: 'jul' },
      { label: 'August',    position: 'aug' },
      { label: 'September', position: 'sep' },
      { label: 'October',   position: 'oct' },
      { label: 'November',  position: 'nov' },
      { label: 'December',  position: 'dec' }
    ]
  },
  'decision': {
    category: 'general', label: 'Decision',
    slots: [
      { label: 'The Situation',  position: 'situation' },
      { label: 'Path A',         position: 'path-a' },
      { label: 'Path A Energy',  position: 'path-a-energy' },
      { label: 'Path B',         position: 'path-b' },
      { label: 'Path B Energy',  position: 'path-b-energy' },
      { label: 'Outcome',        position: 'outcome' }
    ]
  },
  'celtic': {
    category: 'general', label: 'Celtic Cross',
    slots: [
      { label: 'The Heart',     position: 'heart' },
      { label: 'The Cross',     position: 'cross' },
      { label: 'Above',         position: 'above' },
      { label: 'Below',         position: 'below' },
      { label: 'Behind',        position: 'behind' },
      { label: 'Before',        position: 'before' },
      { label: 'Yourself',      position: 'self' },
      { label: 'Environment',   position: 'environment' },
      { label: 'Hopes / Fears', position: 'hopes' },
      { label: 'Outcome',       position: 'outcome' }
    ]
  },
  'reader-choice': {
    category: 'general', label: '✦ Reader\'s Choice',
    special: 'reader-choice',
    slots: []
  },
  'six-card': {
    category: 'relationship', label: 'Six Card',
    slots: [
      { label: 'A: Intentions', position: 'a-intentions' },
      { label: 'A: Energy',     position: 'a-energy' },
      { label: 'B: Intentions', position: 'b-intentions' },
      { label: 'B: Energy',     position: 'b-energy' },
      { label: 'Shared Energy', position: 'shared' },
      { label: 'Outcome',       position: 'outcome' }
    ]
  },
  'nine-card': {
    category: 'relationship', label: 'Nine Card',
    slots: [
      { label: "Partner's Energy",     position: 'partner-energy' },
      { label: "How Partner Views Me", position: 'partner-view' },
      { label: "Partner's Feelings",   position: 'partner-feelings' },
      { label: "My Energy",            position: 'my-energy' },
      { label: "How I View Partner",   position: 'my-view' },
      { label: "My Feelings",          position: 'my-feelings' },
      { label: 'Strengths',            position: 'strengths' },
      { label: 'Weakness',             position: 'weakness' },
      { label: 'Outcome',              position: 'outcome' }
    ]
  },
  'compatibility': {
    category: 'relationship', label: '♥ Compatibility',
    special: 'modal',
    slots: [
      { label: "Person A's Energy", position: 'a-energy' },
      { label: "Person B's Energy", position: 'b-energy' },
      { label: 'The Connection',    position: 'connection' },
      { label: 'The Tension',       position: 'tension' },
      { label: 'What to Nurture',   position: 'nurture' },
      { label: 'Outcome',           position: 'outcome' }
    ]
  },
  'rel-cross': {
    category: 'relationship', label: 'Relationship Cross',
    slots: [
      { label: 'You',            position: 'you' },
      { label: 'Your Partner',   position: 'partner' },
      { label: 'Dynamics',       position: 'dynamics' },
      { label: 'Challenges',     position: 'challenges' },
      { label: 'Strengths',      position: 'strengths' },
      { label: 'Future Outlook', position: 'future' }
    ]
  },
  'soulmates': {
    category: 'relationship', label: 'Soulmates / Twin Flames',
    slots: [
      { label: 'Soul Connection',     position: 'soul' },
      { label: 'Past Life',           position: 'past-life' },
      { label: 'Present Connection',  position: 'present' },
      { label: 'Purpose & Journey',   position: 'purpose' },
      { label: 'Challenges & Growth', position: 'challenges' },
      { label: 'Divine Union',        position: 'union' }
    ]
  },
  'rel-future': {
    category: 'relationship', label: 'Future of Relationship',
    slots: [
      { label: 'Current Status',  position: 'status' },
      { label: 'Near Future',     position: 'near-future' },
      { label: 'Potential Growth',position: 'growth' },
      { label: 'Communication',   position: 'communication' },
      { label: 'Challenges',      position: 'challenges' },
      { label: 'Path Forward',    position: 'path' }
    ]
  },
  'chakra': {
    category: 'spiritual', label: 'Chakra',
    slots: [
      { label: 'Root',         position: 'root' },
      { label: 'Sacral',       position: 'sacral' },
      { label: 'Solar Plexus', position: 'solar-plexus' },
      { label: 'Heart',        position: 'heart' },
      { label: 'Throat',       position: 'throat' },
      { label: 'Third Eye',    position: 'third-eye' },
      { label: 'Crown',        position: 'crown' }
    ]
  },
  'star': {
    category: 'spiritual', label: 'Star / Pentagram',
    slots: [
      { label: 'Earth',  position: 'earth' },
      { label: 'Air',    position: 'air' },
      { label: 'Fire',   position: 'fire' },
      { label: 'Water',  position: 'water' },
      { label: 'Spirit', position: 'spirit' }
    ]
  }
};
```

- [ ] **Step 2: Update compat slot label mutation (line ~223)**

```js
// Before:
SPREADS['compatibility'][0].label = `${nameA}'s Energy`;
SPREADS['compatibility'][1].label = `${nameB}'s Energy`;

// After:
SPREADS['compatibility'].slots[0].label = `${nameA}'s Energy`;
SPREADS['compatibility'].slots[1].label = `${nameB}'s Energy`;
```

- [ ] **Step 3: Update drawCards (line ~747)**

```js
// Before:
const spreadDef = SPREADS[currentSpread];
// ...
drawnCards = spreadDef.map((slot, i) => ({

// After:
const spreadDef = SPREADS[currentSpread].slots;
// ...
drawnCards = spreadDef.map((slot, i) => ({
```

- [ ] **Step 4: Update resumeReading (line ~1070)**

```js
// Before:
const spreadDef = SPREADS[currentSpread] || [];

// After:
const spreadDef = (SPREADS[currentSpread] && SPREADS[currentSpread].slots) || [];
```

- [ ] **Step 5: Update reader-choice spread validity check (line ~807)**

Find the line `if (data.spread && SPREADS[data.spread])` — this is still valid since `SPREADS[key]` is now an object (truthy). No change needed. Verify this line looks correct after the refactor.

- [ ] **Step 6: Update reader-choice drawn cards (line ~848)**

Find the second `drawnCards = spreadDef.map(...)` inside `drawWithReaderChoice`. The local `spreadDef` assignment nearby should also become `.slots`:

```js
// Before:
const spreadDef = SPREADS[currentSpread];
drawnCards = spreadDef.map((slot, i) => ({

// After:
const spreadDef = SPREADS[currentSpread].slots;
drawnCards = spreadDef.map((slot, i) => ({
```

- [ ] **Step 7: Update manual form spread slots (line ~940)**

```js
// Before:
const spreadSlots = SPREADS[currentSpread] || SPREADS['single'];

// After:
const spreadSlots = (SPREADS[currentSpread] && SPREADS[currentSpread].slots) || SPREADS['single'].slots;
```

- [ ] **Step 8: Verify app still starts**

```powershell
node server.js
```
Open http://localhost:3000 in a browser. Select a spread and draw cards. Verify the draw works for single, three-card, and celtic. Stop server.

- [ ] **Step 9: Commit**

```powershell
git add public/app.js
git commit -m "refactor: SPREADS to {category,label,slots} format, add 9 new spreads"
```

---

### Task 3: Add SPREAD_LAYOUTS + refactor renderSpread

**Files:**
- Modify: `public/app.js:79-95` (add new card class arrays after existing ones)
- Modify: `public/app.js` (add SPREAD_LAYOUTS constant)
- Modify: `public/app.js:1164-1215` (renderSpread function)

- [ ] **Step 1: Add new card class arrays after the existing ones (after line ~93)**

```js
// After NINE_CARD_CLASSES definition, add:

const HORSESHOE_CLASSES = ['hs-1', 'hs-2', 'hs-3', 'hs-4', 'hs-5', 'hs-6', 'hs-7'];

const YEAR_CLASSES = [
  'yr-1', 'yr-2', 'yr-3', 'yr-4',
  'yr-5', 'yr-6', 'yr-7', 'yr-8',
  'yr-9', 'yr-10', 'yr-11', 'yr-12'
];

const CHAKRA_CLASSES = [
  'chakra-root', 'chakra-sacral', 'chakra-solar', 'chakra-heart',
  'chakra-throat', 'chakra-third-eye', 'chakra-crown'
];

// Columns: 1=Situation(span 2 rows), 2=PathA1, 3=PathA2, 4=PathB1, 5=PathB2, 6=Outcome(span 2 rows)
const DECISION_CLASSES = ['dc-situation', 'dc-pa1', 'dc-pa2', 'dc-pb1', 'dc-pb2', 'dc-outcome'];

// Slot order: Earth(lower-left), Air(upper-right), Fire(lower-right), Water(upper-left), Spirit(top)
const STAR_CLASSES = ['star-earth', 'star-air', 'star-fire', 'star-water', 'star-spirit'];
```

- [ ] **Step 2: Add SPREAD_LAYOUTS lookup table (after the card class arrays)**

```js
const SPREAD_LAYOUTS = {
  'celtic':        { gridClass: 'celtic-grid',    cardClasses: CELTIC_CLASSES,    labelClass: null },
  'six-card':      { gridClass: 'six-grid',        cardClasses: SIX_CARD_CLASSES,  labelClass: 'position-label-sm' },
  'compatibility': { gridClass: 'six-grid',        cardClasses: SIX_CARD_CLASSES,  labelClass: 'position-label-sm' },
  'nine-card':     { gridClass: 'nine-grid',       cardClasses: NINE_CARD_CLASSES, labelClass: 'position-label-sm' },
  'horseshoe':     { gridClass: 'horseshoe-grid',  cardClasses: HORSESHOE_CLASSES, labelClass: 'position-label-sm' },
  'year-ahead':    { gridClass: 'year-grid',       cardClasses: YEAR_CLASSES,      labelClass: 'position-label-sm' },
  'chakra':        { gridClass: 'chakra-grid',     cardClasses: CHAKRA_CLASSES,    labelClass: 'position-label-sm' },
  'decision':      { gridClass: 'decision-grid',   cardClasses: DECISION_CLASSES,  labelClass: 'position-label-sm' },
  'star':          { gridClass: 'star-grid',       cardClasses: STAR_CLASSES,      labelClass: 'position-label-sm' },
};
```

- [ ] **Step 3: Replace renderSpread function**

Replace the entire `renderSpread` function (lines ~1164–1215):

```js
function renderSpread() {
  const area = document.getElementById('spread-area');
  area.innerHTML = '';

  const layout = SPREAD_LAYOUTS[currentSpread];

  if (layout) {
    area.className = `spread-area ${layout.gridClass}`;
    drawnCards.forEach((card, i) => {
      const slot = document.createElement('div');
      slot.className = `card-slot ${layout.cardClasses[i] || ''}`.trim();
      if (layout.labelClass && card.positionLabel) {
        const lbl = document.createElement('div');
        lbl.className = layout.labelClass;
        lbl.textContent = card.positionLabel;
        slot.appendChild(lbl);
      }
      slot.appendChild(makeCardEl(card, i));
      area.appendChild(slot);
    });
  } else {
    area.className = 'spread-area';
    drawnCards.forEach((card, i) => {
      const slot = document.createElement('div');
      slot.className = 'card-slot';
      if (card.positionLabel) {
        const lbl = document.createElement('div');
        lbl.className = 'position-label';
        lbl.textContent = card.positionLabel;
        slot.appendChild(lbl);
      }
      slot.appendChild(makeCardEl(card, i));
      area.appendChild(slot);
    });
  }
}
```

- [ ] **Step 4: Verify existing spreads still render**

Start server, open browser, draw cards for: single, three-card, celtic, six-card, nine-card, compatibility. All should render identically to before.

- [ ] **Step 5: Commit**

```powershell
git add public/app.js
git commit -m "refactor: SPREAD_LAYOUTS lookup table replaces renderSpread if/else chain"
```

---

### Task 4: Add CSS for 5 new grid layouts + tab bar

**Files:**
- Modify: `public/style.css` (append new CSS)

- [ ] **Step 1: Append tab bar styles to style.css**

```css
/* ── Spread category tabs ───────────────────────────────────────── */
#spread-tabs {
  display: flex;
  gap: 0;
  border-bottom: 1px solid var(--border, #333);
  margin-bottom: 6px;
}

.tab {
  padding: 6px 16px;
  font-size: 0.78rem;
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  color: var(--text-dim, #888);
  cursor: pointer;
  margin-bottom: -1px;
  transition: color 0.15s, border-color 0.15s;
}

.tab:hover { color: var(--text, #eee); }
.tab.active { border-bottom-color: var(--accent, #9b8dc4); color: var(--text, #eee); font-weight: 600; }
```

- [ ] **Step 2: Append horseshoe-grid styles**

```css
/* ── Horseshoe spread ───────────────────────────────────────────── */
.horseshoe-grid {
  display: flex;
  align-items: flex-end;
  justify-content: center;
  gap: 8px;
  min-height: 240px;
  padding: 1rem 0;
}

.horseshoe-grid .hs-1,
.horseshoe-grid .hs-7 { margin-bottom: 0; }

.horseshoe-grid .hs-2,
.horseshoe-grid .hs-6 { margin-bottom: 24px; }

.horseshoe-grid .hs-3,
.horseshoe-grid .hs-5 { margin-bottom: 44px; }

.horseshoe-grid .hs-4 { margin-bottom: 56px; }
```

- [ ] **Step 3: Append year-grid styles**

```css
/* ── Year Ahead spread ──────────────────────────────────────────── */
.year-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
  max-width: 640px;
  margin: 0 auto;
}
```

- [ ] **Step 4: Append chakra-grid styles**

```css
/* ── Chakra spread ──────────────────────────────────────────────── */
.chakra-grid {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}

.chakra-grid .card-slot {
  width: 100%;
  max-width: 220px;
  border-left: 3px solid transparent;
  padding-left: 4px;
}

.chakra-root      { border-left-color: #c0392b !important; }
.chakra-sacral    { border-left-color: #d35400 !important; }
.chakra-solar     { border-left-color: #d4ac0d !important; }
.chakra-heart     { border-left-color: #1e8449 !important; }
.chakra-throat    { border-left-color: #1a5276 !important; }
.chakra-third-eye { border-left-color: #7d3c98 !important; }
.chakra-crown     { border-left-color: #9b8dc4 !important; }
```

- [ ] **Step 5: Append decision-grid styles**

```css
/* ── Decision spread ────────────────────────────────────────────── */
.decision-grid {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr 1fr;
  grid-template-rows: auto auto;
  gap: 8px;
  align-items: start;
  max-width: 560px;
  margin: 0 auto;
}

.dc-situation { grid-column: 1; grid-row: 1 / 3; align-self: center; }
.dc-pa1       { grid-column: 2; grid-row: 1; }
.dc-pa2       { grid-column: 3; grid-row: 1; }
.dc-pb1       { grid-column: 2; grid-row: 2; opacity: 0.85; }
.dc-pb2       { grid-column: 3; grid-row: 2; opacity: 0.85; }
.dc-outcome   { grid-column: 4; grid-row: 1 / 3; align-self: center; }
```

- [ ] **Step 6: Append star-grid styles**

```css
/* ── Star / Pentagram spread ────────────────────────────────────── */
.star-grid {
  position: relative;
  width: 100%;
  max-width: 380px;
  height: 320px;
  margin: 0 auto;
}

.star-grid .card-slot { position: absolute; transform: translateX(-50%); }

/* Spirit at top, elements at pentagram points clockwise from upper-right */
.star-spirit { left: 50%; top: 0; }
.star-air    { left: 80%; top: 22%; }
.star-fire   { left: 65%; top: 70%; }
.star-earth  { left: 35%; top: 70%; }
.star-water  { left: 20%; top: 22%; }
```

- [ ] **Step 7: Commit**

```powershell
git add public/style.css
git commit -m "feat: CSS for 5 new spread layouts + tab bar styles"
```

---

### Task 5: Update index.html — tab structure

**Files:**
- Modify: `public/index.html:32-40`

- [ ] **Step 1: Replace spread button group with tab bar**

Find this block in `index.html` (approximately lines 32–40):
```html
        <div class="btn-group" id="spread-select">
          <button class="btn active" data-value="single">Single</button>
          <button class="btn" data-value="three-card">Three Card</button>
          <button class="btn" data-value="four-card">Four Card</button>
          <button class="btn" data-value="five-card">Five Card</button>
          <button class="btn" data-value="six-card">Six Card</button>
          <button class="btn" data-value="nine-card">Nine Card</button>
          <button class="btn" data-value="celtic">Celtic Cross</button>
          <button class="btn btn-reader-choice" data-value="reader-choice">&#10022; Reader's Choice</button>
          <button class="btn btn-compat" data-value="compatibility">&#9829; Compatibility</button>
        </div>
```

Replace with:
```html
        <div id="spread-tabs">
          <button class="tab active" data-tab="general">General</button>
          <button class="tab" data-tab="relationship">Relationship</button>
          <button class="tab" data-tab="spiritual">Spiritual</button>
        </div>
        <div class="btn-group" id="spread-select">
          <!-- populated by initSpreadButtons() -->
        </div>
```

- [ ] **Step 2: Commit**

```powershell
git add public/index.html
git commit -m "feat: replace hardcoded spread buttons with tab bar + empty container"
```

---

### Task 6: Add initSpreadButtons() + activateTab() + wire init

**Files:**
- Modify: `public/app.js` (add two new functions near top of Init section; modify init wiring)

- [ ] **Step 1: Add initSpreadButtons() and activateTab() functions**

Add these two functions just before the `// ── Init ─` comment (around line 96):

```js
function initSpreadButtons() {
  const container = document.getElementById('spread-select');
  Object.entries(SPREADS).forEach(([key, spread]) => {
    const btn = document.createElement('button');
    btn.className = 'btn';
    if (key === currentSpread) btn.classList.add('active');
    if (spread.special === 'reader-choice') btn.classList.add('btn-reader-choice');
    if (spread.special === 'modal') btn.classList.add('btn-compat');
    btn.dataset.value = key;
    btn.dataset.category = spread.category;
    btn.textContent = spread.label;
    container.appendChild(btn);
  });
  activateTab('general');
}

function activateTab(category) {
  document.querySelectorAll('#spread-tabs .tab').forEach(t => {
    t.classList.toggle('active', t.dataset.tab === category);
  });
  document.querySelectorAll('#spread-select .btn').forEach(btn => {
    btn.style.display = btn.dataset.category === category ? '' : 'none';
  });
}
```

- [ ] **Step 2: Call initSpreadButtons() inside the init function**

In `async function init()` (line 112 of `public/app.js`), add `initSpreadButtons();` on a new line just before the `document.querySelectorAll('#spread-select .btn')` block (line ~165). The call should come after the card/image fetch at the top of init but before any event wiring that queries spread buttons.

- [ ] **Step 3: Wire tab click handlers (add after initSpreadButtons() call)**

```js
document.querySelectorAll('#spread-tabs .tab').forEach(tab => {
  tab.addEventListener('click', () => activateTab(tab.dataset.tab));
});
```

The existing `querySelectorAll('#spread-select .btn').forEach(...)` click handler block (lines ~165-171) and the compat button handler (lines ~179-183) need NO changes — they query the DOM at click time and will find the generated buttons correctly.

- [ ] **Step 4: Verify tabs render and filter correctly**

Start server, open browser. Verify:
- General tab is active on load, shows Single, Three Card, etc.
- Clicking Relationship tab shows Six Card, Nine Card, Compatibility, and the 3 new relationship spreads.
- Clicking Spiritual tab shows Chakra and Star / Pentagram.
- Clicking a spread button selects it (active class).

- [ ] **Step 5: Commit**

```powershell
git add public/app.js
git commit -m "feat: initSpreadButtons generates buttons from SPREADS; activateTab filters by category"
```

---

### Task 7: Wire Reader's Choice to activateTab

**Files:**
- Modify: `public/app.js` (~line 822 in the `drawWithReaderChoice` function)

- [ ] **Step 1: Add activateTab call after chosenSpread is set**

Find this block in `drawWithReaderChoice` (approximately line 820–827):
```js
    currentSpread = chosenSpread;

    // Highlight chosen spread + keep Reader's Choice marked
    document.querySelectorAll('#spread-select .btn').forEach(btn => {
      btn.classList.toggle('active',
        btn.dataset.value === chosenSpread || btn.dataset.value === 'reader-choice');
    });
```

Add one line after `currentSpread = chosenSpread;`:
```js
    currentSpread = chosenSpread;
    if (SPREADS[chosenSpread]) activateTab(SPREADS[chosenSpread].category);

    // Highlight chosen spread + keep Reader's Choice marked
    document.querySelectorAll('#spread-select .btn').forEach(btn => {
      btn.classList.toggle('active',
        btn.dataset.value === chosenSpread || btn.dataset.value === 'reader-choice');
    });
```

- [ ] **Step 2: Verify Reader's Choice tab-switch**

Start server, open browser. Select Reader's Choice. Ask a question likely to yield a relationship spread (e.g. "How does my partner feel about me?"). Verify Miriel picks a spread, the tab automatically switches to Relationship (or whichever category), and the chosen spread button is highlighted and visible.

- [ ] **Step 3: Commit**

```powershell
git add public/app.js
git commit -m "feat: Reader's Choice switches to chosen spread's tab automatically"
```

---

### Task 8: Fix resumeReading for new structure

**Files:**
- Modify: `public/app.js:1051-1067` (resumeReading function)

- [ ] **Step 1: Replace spreadKeyByLabel with dynamic generation + add activateTab call**

Replace lines ~1051–1067 in `resumeReading`:

```js
// Before:
  const spreadKeyByLabel = {
    'Single Card': 'single', 'Three-Card': 'three-card',
    'Four-Card': 'four-card', 'Five-Card': 'five-card',
    'Six-Card': 'six-card', 'Nine-Card': 'nine-card',
    'Celtic Cross': 'celtic', 'Compatibility': 'compatibility'
  };

  // Restore settings
  currentDeck     = reading.deck || 'tarot';
  currentSpread   = spreadKeyByLabel[reading.spread] || 'single';
  currentQuestion = reading.question || '';

  document.getElementById('deck-select').value    = currentDeck;
  document.getElementById('question-input').value = currentQuestion;
  document.querySelectorAll('#spread-select .btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.value === currentSpread);
  });

// After:
  const spreadKeyByLabel = Object.fromEntries(
    Object.entries(SPREADS).map(([key, s]) => [s.label, key])
  );
  // Legacy label aliases for readings saved before this refactor
  const legacyAliases = {
    'Single Card': 'single', 'Three-Card': 'three-card',
    'Four-Card': 'four-card', 'Five-Card': 'five-card',
    'Six-Card': 'six-card', 'Nine-Card': 'nine-card',
    'Celtic Cross': 'celtic', 'Compatibility': 'compatibility'
  };

  // Restore settings
  currentDeck     = reading.deck || 'tarot';
  currentSpread   = spreadKeyByLabel[reading.spread] || legacyAliases[reading.spread] || 'single';
  currentQuestion = reading.question || '';

  document.getElementById('deck-select').value    = currentDeck;
  document.getElementById('question-input').value = currentQuestion;
  document.querySelectorAll('#spread-select .btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.value === currentSpread);
  });
  if (SPREADS[currentSpread]) activateTab(SPREADS[currentSpread].category);
```

- [ ] **Step 2: Verify resumed reading restores correct tab**

If you have a saved reading, resume it from the reading history. Verify the correct tab is active and the spread button is highlighted.

- [ ] **Step 3: Commit**

```powershell
git add public/app.js
git commit -m "fix: resumeReading uses dynamic spreadKeyByLabel, activates correct tab on restore"
```

---

### Task 9: Fix spreadLabels to be dynamic

**Files:**
- Modify: `public/app.js:1465-1470` (spreadLabels in saveReading function)

- [ ] **Step 1: Replace hardcoded spreadLabels with dynamic generation**

Find `const spreadLabels = {` (line ~1465). Replace the entire object literal:

```js
// Before:
  const spreadLabels = {
    single: 'Single Card', 'three-card': 'Three-Card',
    'four-card': 'Four-Card', 'five-card': 'Five-Card',
    'six-card': 'Six-Card', 'nine-card': 'Nine-Card',
    celtic: 'Celtic Cross', compatibility: 'Compatibility'
  };

// After:
  const spreadLabels = Object.fromEntries(
    Object.entries(SPREADS).map(([key, s]) => [key, s.label])
  );
```

- [ ] **Step 2: Draw and save a reading with a new spread to verify**

Draw a Horseshoe reading. Click "Ask Miriel" (or whichever action triggers a save). Check the reading history — the spread label should appear as "Horseshoe", not undefined.

- [ ] **Step 3: Commit**

```powershell
git add public/app.js
git commit -m "fix: spreadLabels computed dynamically from SPREADS.label"
```

---

### Task 10: Update server.js suggest-spread endpoint

**Files:**
- Modify: `server.js:333-348` (`spreadMenu` string and `valid` array)

- [ ] **Step 1: Replace spreadMenu string and valid array**

Find `const spreadMenu = \`` (line ~333) and replace through `const valid = [...]` (line ~348):

```js
  const spreadMenu = `single — one card. Best for: direct clarity, a daily pull, a simple yes/no energy check.
three-card — past / present / future. Best for: understanding how a situation developed and where it's heading.
four-card — past / present / future / advice. Best for: situations where the person needs a concrete next step alongside the insight.
five-card — past / present / hidden factor / advice / outcome. Best for: complex or stuck situations where something unseen may be shaping things.
yes-no — three cards. Best for: when someone needs a direct answer and doesn't want the long view.
horseshoe — seven cards. Best for: situations with a clear narrative arc where hidden forces and obstacles matter.
year-ahead — twelve cards, one per month. Best for: January readings, birthdays, or major life transitions — when someone needs the broad shape of a season ahead.
decision — six cards. Best for: genuine crossroads where two real options exist and the person needs to feel both paths before choosing.
celtic — full Celtic Cross, 10 cards. Best for: major life crossroads, big decisions, when someone genuinely needs the whole picture.
six-card — relationship spread (two people: intentions, energy; shared energy; outcome). Best for: questions specifically about the dynamic between two people.
nine-card — deep relationship spread (each person's energy, view, feelings; strengths, weakness, outcome). Best for: a relationship where the person needs to understand both sides fully.
rel-cross — six cards, relationship cross. Best for: understanding the dynamic between two people from both sides, with where it's heading.
soulmates — six cards. Best for: questions about deep connection, soul-level bonds, or past-life resonance.
rel-future — six cards, future of relationship. Best for: a relationship that needs directional clarity — not just what's happening but where it's going.
chakra — seven cards. Best for: questions about the body, energy blocks, or when something physical or emotional feels stuck without explanation.
star — five cards, elemental pentagram. Best for: elemental questions, spiritual grounding, or readings where the person wants to understand which forces are in play.`;

  const valid = [
    'single', 'three-card', 'four-card', 'five-card', 'yes-no',
    'horseshoe', 'year-ahead', 'decision', 'celtic',
    'six-card', 'nine-card', 'rel-cross', 'soulmates', 'rel-future',
    'chakra', 'star'
  ];
```

Note: `compatibility` and `reader-choice` are intentionally excluded from `valid` — they require modals/special flows that the AI cannot trigger from suggest-spread.

- [ ] **Step 2: Verify suggest-spread still returns valid JSON**

```powershell
$body = '{"question":"How does my partner feel about me?"}' 
Invoke-RestMethod -Uri http://localhost:3000/api/suggest-spread -Method Post -Body $body -ContentType "application/json"
```
Expected: JSON with `spread` key matching one of the 16 valid keys and a `reason` string.

- [ ] **Step 3: Commit**

```powershell
git add server.js
git commit -m "feat: suggest-spread updated for 16 spreads with Miriel-voiced descriptions"
```

---

### Task 11: Write and run tests

**Files:**
- Create: `tests/spreads.test.js`

- [ ] **Step 1: Create the test file**

```js
'use strict';
const { test } = require('node:test');
const assert   = require('node:assert/strict');

// SPREADS is a browser module — extract just what we need for testing
// by reading app.js and evaluating the SPREADS constant in isolation
const fs   = require('fs');
const path = require('path');

const appSrc = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');
// Extract the SPREADS object by evaluating up to the closing brace
const spreadsMatch = appSrc.match(/^const SPREADS = \{[\s\S]+?\n\};/m);
assert.ok(spreadsMatch, 'Could not find SPREADS constant in app.js');
const SPREADS = eval(`(${spreadsMatch[0].replace('const SPREADS =', '')})`);

// Expected spread keys
const ALL_KEYS = [
  'single', 'three-card', 'four-card', 'five-card', 'yes-no',
  'horseshoe', 'year-ahead', 'decision', 'celtic', 'reader-choice',
  'six-card', 'nine-card', 'compatibility', 'rel-cross', 'soulmates', 'rel-future',
  'chakra', 'star'
];

const VALID_CATEGORIES = ['general', 'relationship', 'spiritual'];

test('SPREADS has all expected keys', () => {
  for (const key of ALL_KEYS) {
    assert.ok(SPREADS[key], `Missing spread: ${key}`);
  }
  assert.equal(Object.keys(SPREADS).length, ALL_KEYS.length,
    `Expected ${ALL_KEYS.length} spreads, got ${Object.keys(SPREADS).length}`);
});

test('every spread has required fields: category, label, slots', () => {
  for (const [key, spread] of Object.entries(SPREADS)) {
    assert.ok(spread.category, `${key} missing category`);
    assert.ok(VALID_CATEGORIES.includes(spread.category),
      `${key} has unknown category: ${spread.category}`);
    assert.ok(spread.label && spread.label.length > 0, `${key} missing label`);
    assert.ok(Array.isArray(spread.slots), `${key} slots must be an array`);
  }
});

test('every non-special spread has at least one slot', () => {
  for (const [key, spread] of Object.entries(SPREADS)) {
    if (!spread.special) {
      assert.ok(spread.slots.length > 0, `${key} has no slots`);
    }
  }
});

test('every slot has label and position strings', () => {
  for (const [key, spread] of Object.entries(SPREADS)) {
    spread.slots.forEach((slot, i) => {
      assert.equal(typeof slot.label, 'string', `${key} slot[${i}] missing label`);
      assert.equal(typeof slot.position, 'string', `${key} slot[${i}] missing position`);
    });
  }
});

test('category groupings have correct counts', () => {
  const byCategory = {};
  for (const spread of Object.values(SPREADS)) {
    byCategory[spread.category] = (byCategory[spread.category] || 0) + 1;
  }
  assert.equal(byCategory.general,      10, `Expected 10 general spreads`);
  assert.equal(byCategory.relationship,  6, `Expected 6 relationship spreads`);
  assert.equal(byCategory.spiritual,     2, `Expected 2 spiritual spreads`);
});

test('year-ahead has 12 slots', () => {
  assert.equal(SPREADS['year-ahead'].slots.length, 12);
});

test('chakra has 7 slots', () => {
  assert.equal(SPREADS['chakra'].slots.length, 7);
});

test('server valid array matches all non-special spreads', () => {
  const serverSrc = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
  const validMatch = serverSrc.match(/const valid = \[([^\]]+)\]/);
  assert.ok(validMatch, 'Could not find valid array in server.js');
  const validKeys = validMatch[1].match(/'([^']+)'/g).map(s => s.replace(/'/g, ''));
  
  const nonSpecialKeys = Object.entries(SPREADS)
    .filter(([, s]) => !s.special)
    .map(([k]) => k);
  
  for (const key of nonSpecialKeys) {
    assert.ok(validKeys.includes(key), `server.js valid array missing: ${key}`);
  }
});
```

- [ ] **Step 2: Run tests**

```powershell
node --test tests/spreads.test.js
```

Expected output: all tests pass with `✓` marks.

- [ ] **Step 3: Fix any failures, then commit**

```powershell
git add tests/spreads.test.js
git commit -m "test: SPREADS structure validation — all keys, fields, categories, server valid array"
```

---

### Task 12: End-to-end smoke test

- [ ] **Step 1: Start server and exercise all new spreads**

```powershell
node server.js
```

Open http://localhost:3000 and manually draw cards for each new spread. Verify:

| Spread | Tab | Layout | Card count |
|--------|-----|--------|-----------|
| Yes / No | General | Flex row | 3 |
| Horseshoe | General | Arc (cards at varying heights) | 7 |
| Year Ahead | General | 4×3 grid | 12 |
| Decision | General | Fork (situation · two paths · outcome) | 6 |
| Relationship Cross | Relationship | Flex row | 6 |
| Soulmates / Twin Flames | Relationship | Flex row | 6 |
| Future of Relationship | Relationship | Flex row | 6 |
| Chakra | Spiritual | Vertical column with color accents | 7 |
| Star / Pentagram | Spiritual | Star positions | 5 |

- [ ] **Step 2: Verify Reader's Choice tab-switch works**

Ask a few questions (love, career, spiritual) via Reader's Choice and observe the tab switching to match Miriel's chosen spread.

- [ ] **Step 3: Final commit**

```powershell
git add -A
git commit -m "feat: 9 new spreads, tabbed selector, Reader's Choice tab-switch, dynamic spread data"
```
