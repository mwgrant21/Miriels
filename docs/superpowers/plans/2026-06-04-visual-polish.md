# Visual Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply a cohesive visual polish pass to Miriel's Readings covering background, header, cards, and meaning panel — without changing any reading logic.

**Architecture:** All changes are purely presentational — CSS and HTML structure in `style.css` / `index.html`, plus two small JS changes in `app.js` (spread dropdown conversion and keyword pill wrapping). No server changes. No data changes.

**Tech Stack:** Vanilla HTML/CSS/JS, Express server (`server.js`), launched via `node server.js` from `C:\Users\Matt\projects\tarot\` (or `tarot.bat` from `.local\bin`).

---

## File Map

| File | What changes |
|---|---|
| `public/images/mirielbg.jpg` | New — background image (copy of `MirielBG.jpg.jpg` at project root) |
| `public/style.css` | Background, header layout, card frame/glow/pulse, two-column panel, keyword pills |
| `public/index.html` | Header restructure (ornament + title + tagline, two-row controls, spread `<select>`) |
| `public/app.js` | `initSpreadButtons()` → populate `<select>`, `activateTab()` → re-populate `<select>`, Miriel's Choice rename, keyword pill wrapping |

---

## Task 1: Copy background image

**Files:**
- Create: `public/images/mirielbg.jpg`

- [ ] **Step 1: Copy the image**

```bash
cp "C:/Users/Matt/projects/tarot/MirielBG.jpg.jpg" "C:/Users/Matt/projects/tarot/public/images/mirielbg.jpg"
```

- [ ] **Step 2: Verify it exists**

```bash
ls C:/Users/Matt/projects/tarot/public/images/mirielbg.jpg
```

Expected: file listed, size > 0.

- [ ] **Step 3: Commit**

```bash
cd C:/Users/Matt/projects/tarot
git add public/images/mirielbg.jpg
git commit -m "feat: add Miriel background image"
```

---

## Task 2: Background — full-page forest image with dark overlay

**Files:**
- Modify: `public/style.css` — `body` rule

The body currently has `background: var(--bg)`. Replace it with the image + overlay. Keep `--bg` as a fallback color.

- [ ] **Step 1: Update `body` rule in `style.css`**

Find this block (lines ~18–25):
```css
body {
  background: var(--bg);
  color: var(--text);
  font-family: 'Georgia', serif;
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}
```

Replace with:
```css
body {
  background-color: var(--bg);
  background-image:
    linear-gradient(rgba(9, 9, 26, 0.70), rgba(9, 9, 26, 0.70)),
    url('../images/mirielbg.jpg');
  background-attachment: fixed;
  background-size: cover;
  background-position: center top;
  color: var(--text);
  font-family: 'Georgia', serif;
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}
```

- [ ] **Step 2: Launch and verify in browser**

```bash
cd C:/Users/Matt/projects/tarot && node server.js
```

Open `http://localhost:3000`. The forest image should be visible as a fixed background behind all content, darkened to ~30% brightness. Scrolling should keep the image fixed.

- [ ] **Step 3: Commit**

```bash
git add public/style.css
git commit -m "feat: add fixed forest background image with dark overlay"
```

---

## Task 3: Header — atmospheric centered layout

**Files:**
- Modify: `public/index.html` — `<header>` block
- Modify: `public/style.css` — header rules

This replaces the current left-aligned single-row header with a centered two-row layout: ornament + title + tagline on top, then controls on two rows below.

- [ ] **Step 1: Replace the `<header>` block in `index.html`**

Find the entire `<header>` opening tag through the `</div>` that closes `.controls` and the `<div class="question-bar">`. Replace the header contents (keep the modals — they stay inside `<header>`):

```html
<header>
  <div class="header-title-area">
    <div class="header-ornament">&#10022; &middot; &#10022; &middot; &#10022;</div>
    <h1>MIRIEL'S READINGS</h1>
    <div class="header-tagline">Tarot &middot; Oracle &middot; Runes</div>
  </div>
  <div class="controls">
    <div class="controls-row-1">
      <div class="control-group">
        <label>Deck</label>
        <select id="deck-select" class="deck-select">
          <option value="tarot">Rider-Waite Tarot</option>
          <option value="thoth">Thoth Tarot</option>
          <option value="celtic-dragon">Celtic Dragon Tarot</option>
          <option value="moonology">Moonology Oracle</option>
          <option value="lenormand">Lenormand Oracle</option>
          <option value="runic">Elder Futhark Runes</option>
          <option value="iching">I Ching</option>
          <option value="oracle">My Oracle</option>
          <option value="mixed">All Decks</option>
        </select>
      </div>
      <span class="ctrl-sep">|</span>
      <div class="control-group">
        <div id="spread-tabs">
          <button class="tab active" data-tab="general">General</button>
          <button class="tab" data-tab="relationship">Relationship</button>
          <button class="tab" data-tab="spiritual">Spiritual</button>
        </div>
      </div>
      <span class="ctrl-sep">|</span>
      <button class="draw-btn" id="draw-btn">&#9790; Lay the Cards</button>
      <button class="settings-btn" id="settings-btn" title="Settings">&#9881;</button>
    </div>
    <div class="controls-row-2">
      <span class="ctrl-label">Spread</span>
      <select id="spread-select" class="spread-select-dropdown"></select>
      <span class="ctrl-sep">|</span>
      <div class="mode-toggle-group">
        <button class="mode-btn active" id="mode-random">&#127922; Draw for me</button>
        <button class="mode-btn" id="mode-manual">&#9997; I'll choose</button>
      </div>
    </div>
  </div>
  <div class="question-bar">
    <input type="text" id="question-input" placeholder="What weighs on you? Ask the cards. (optional)" autocomplete="off" />
  </div>

  <!-- Settings modal — unchanged -->
  ...existing settings modal HTML...

  <!-- Compatibility modal — unchanged -->
  ...existing compat modal HTML...
</header>
```

**Precise edit scope:** Replace only the `.header-top` div and the `.controls` div. Leave the `.question-bar`, the settings modal, and the compat modal exactly as they are.

In `index.html`, replace from `<div class="header-top">` through the closing `</div>` of `.controls` (which ends just before `<div class="question-bar">`). The new content for that region:

```html
    <div class="header-title-area">
      <div class="header-ornament">&#10022; &middot; &#10022; &middot; &#10022;</div>
      <h1>MIRIEL'S READINGS</h1>
      <div class="header-tagline">Tarot &middot; Oracle &middot; Runes</div>
    </div>
    <div class="controls">
      <div class="controls-row-1">
        <div class="control-group">
          <label class="sr-only">Deck</label>
          <select id="deck-select" class="deck-select">
            <option value="tarot">Rider-Waite Tarot</option>
            <option value="thoth">Thoth Tarot</option>
            <option value="celtic-dragon">Celtic Dragon Tarot</option>
            <option value="moonology">Moonology Oracle</option>
            <option value="lenormand">Lenormand Oracle</option>
            <option value="runic">Elder Futhark Runes</option>
            <option value="iching">I Ching</option>
            <option value="oracle">My Oracle</option>
            <option value="mixed">All Decks</option>
          </select>
        </div>
        <span class="ctrl-sep">|</span>
        <div class="control-group">
          <div id="spread-tabs">
            <button class="tab active" data-tab="general">General</button>
            <button class="tab" data-tab="relationship">Relationship</button>
            <button class="tab" data-tab="spiritual">Spiritual</button>
          </div>
        </div>
        <span class="ctrl-sep">|</span>
        <button class="draw-btn" id="draw-btn">&#9790; Lay the Cards</button>
        <button class="settings-btn" id="settings-btn" title="Settings">&#9881;</button>
      </div>
      <div class="controls-row-2">
        <span class="ctrl-label">Spread &#8594;</span>
        <select id="spread-select" class="spread-select-dropdown"></select>
        <span class="ctrl-sep">|</span>
        <div class="mode-toggle-group">
          <button class="mode-btn active" id="mode-random">&#127922; Draw for me</button>
          <button class="mode-btn" id="mode-manual">&#9997; I'll choose</button>
        </div>
      </div>
    </div>
```

The `.question-bar`, both modals (`#settings-panel`, `#compat-modal`), and `<datalist id="card-names">` all remain unchanged below this.

- [ ] **Step 2: Add CSS for the new header structure in `style.css`**

Remove or replace the old `.header-top` rule. Add:

```css
/* ── Atmospheric header ── */
header {
  background: linear-gradient(180deg, #160e2a 0%, #0f0d22 100%);
  border-bottom: 1px solid #2a2050;
  padding: 0.9rem 2rem 0;
}

.header-title-area {
  text-align: center;
  margin-bottom: 0.75rem;
}

.header-ornament {
  font-size: 0.65rem;
  letter-spacing: 0.35em;
  color: var(--gold-dim);
  margin-bottom: 0.3rem;
}

header h1 {
  font-size: 1.25rem;
  color: var(--gold);
  letter-spacing: 0.18em;
  font-weight: normal;
  text-transform: uppercase;
  margin-bottom: 0.2rem;
}

.header-tagline {
  font-size: 0.6rem;
  letter-spacing: 0.22em;
  color: var(--gold-dim);
  text-transform: uppercase;
}

.controls {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  align-items: center;
}

.controls-row-1 {
  display: flex;
  flex-wrap: wrap;
  gap: 0.6rem;
  align-items: center;
  justify-content: center;
}

.controls-row-2 {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  align-items: center;
  justify-content: center;
  padding-top: 0.4rem;
  padding-bottom: 0.5rem;
  border-top: 1px solid #1e1e3a;
  width: 100%;
}

.ctrl-sep {
  color: #3a3a5a;
  font-size: 0.8rem;
  padding: 0 0.1rem;
}

.ctrl-label {
  font-size: 0.72rem;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--gold-dim);
}

/* Spread dropdown (row 2) */
.spread-select-dropdown {
  background: var(--bg3);
  border: 1px solid #3a2a6a;
  border-radius: 6px;
  color: var(--gold);
  padding: 0.3rem 0.7rem;
  font-size: 0.8rem;
  font-family: 'Georgia', serif;
  cursor: pointer;
  outline: none;
  min-width: 200px;
}

.spread-select-dropdown:focus { border-color: var(--purple); }
.spread-select-dropdown option { background: var(--bg2); color: var(--text); }

/* sr-only — visually hidden label */
.sr-only {
  position: absolute;
  width: 1px; height: 1px;
  padding: 0; margin: -1px;
  overflow: hidden;
  clip: rect(0,0,0,0);
  white-space: nowrap;
  border: 0;
}
```

- [ ] **Step 3: Center question bar input and soften its background in `style.css`**

Find the `.question-bar` and `#question-input` rules (~lines 580–602):
```css
.question-bar {
  padding: 0.6rem 2rem 0.75rem;
  background: var(--bg2);
  border-bottom: 1px solid var(--border);
}

#question-input {
  width: 100%;
  max-width: 600px;
  background: var(--bg3);
  ...
}
```

Replace with:
```css
.question-bar {
  padding: 0.5rem 2rem 0.6rem;
  background: rgba(13, 13, 26, 0.55);
  border-bottom: 1px solid rgba(42, 42, 74, 0.5);
  display: flex;
  justify-content: center;
}

#question-input {
  width: 100%;
  max-width: 600px;
  background: rgba(26, 26, 53, 0.60);
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 0.45rem 0.75rem;
  font-size: 0.9rem;
  font-family: 'Georgia', serif;
  font-style: italic;
  outline: none;
  transition: border-color 0.2s;
  text-align: center;
}

#question-input:focus { border-color: var(--gold-dim); }
#question-input::placeholder { color: var(--text-dim); }
```

- [ ] **Step 4: Verify header in browser**

Refresh `http://localhost:3000`. The header should show:
- Ornament + "MIRIEL'S READINGS" + tagline, centered
- Row 1: Deck dropdown | General / Relationship / Spiritual tabs | ☽ Lay the Cards | ⚙
- Row 2: Spread → | spread dropdown | Draw/Choose toggle

- [ ] **Step 5: Commit**

```bash
git add public/index.html public/style.css
git commit -m "feat: atmospheric centered header with two-row controls"
```

---

## Task 4: Spread select — convert to `<select>` + Miriel's Choice

**Files:**
- Modify: `public/app.js` — `initSpreadButtons()`, `activateTab()`, spread click listener, compat button wiring

The old `initSpreadButtons()` created `<button>` elements. The new version populates a `<select id="spread-select">`. `activateTab()` must re-populate it per category.

- [ ] **Step 1: Replace `initSpreadButtons()` in `app.js`**

Find lines 260–274:
```javascript
function initSpreadButtons() {
  const container = document.getElementById('spread-select');
  if (container.children.length > 0) return;
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
```

Replace with:
```javascript
function initSpreadButtons() {
  activateTab('general');
}
```

- [ ] **Step 2: Replace `activateTab()` in `app.js`**

Find lines 277–284:
```javascript
function activateTab(category) {
  document.querySelectorAll('#spread-tabs .tab').forEach(t => {
    t.classList.toggle('active', t.dataset.tab === category);
  });
  document.querySelectorAll('#spread-select .btn').forEach(btn => {
    btn.style.display = btn.dataset.category === category ? '' : 'none';
  });
}
```

Replace with:
```javascript
function activateTab(category) {
  document.querySelectorAll('#spread-tabs .tab').forEach(t => {
    t.classList.toggle('active', t.dataset.tab === category);
  });
  const sel = document.getElementById('spread-select');
  sel.innerHTML = '';
  Object.entries(SPREADS)
    .filter(([, s]) => s.category === category && s.special !== 'modal')
    .forEach(([key, spread]) => {
      const opt = document.createElement('option');
      opt.value = key;
      opt.textContent = spread.special === 'reader-choice'
        ? '⋯ Miriel\'s Choice'
        : spread.label;
      if (key === currentSpread) opt.selected = true;
      sel.appendChild(opt);
    });
  // If currentSpread isn't in this category, default to first option
  if (!sel.value || !SPREADS[sel.value] || SPREADS[sel.value].category !== category) {
    sel.selectedIndex = 0;
    currentSpread = sel.value;
  }
}
```

- [ ] **Step 3: Replace the spread click listener in `app.js`**

Find lines 360–366 (inside `init()`):
```javascript
  document.querySelectorAll('#spread-select .btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#spread-select .btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentSpread = btn.dataset.value;
    });
  });
```

Replace with:
```javascript
  document.getElementById('spread-select').addEventListener('change', function () {
    currentSpread = this.value;
    if (SPREADS[currentSpread]?.special === 'modal') {
      showCompatModal();
    }
  });
```

- [ ] **Step 4: Fix compat button wiring (lines ~375–378)**

Find:
```javascript
  const compatBtn = document.querySelector('#spread-select .btn[data-value="compatibility"]');
  if (compatBtn) {
    compatBtn.addEventListener('click', showCompatModal);
  }
```

Delete these lines — the `change` listener above already handles `special === 'modal'` spreads.

- [ ] **Step 5: Fix all remaining `#spread-select .btn` queries in `app.js`**

Search for every remaining `querySelectorAll('#spread-select .btn')` and replace with the equivalent `<select>` logic. Run:

```bash
grep -n "spread-select.*btn\|\.btn.*spread-select" C:/Users/Matt/projects/tarot/public/app.js
```

For each hit — they are used to highlight the active spread (e.g. line 1021–1023 and line 1265). Replace the pattern:

Old (lines ~1020–1023):
```javascript
    document.querySelectorAll('#spread-select .btn').forEach(btn => {
      btn.classList.toggle('active',
        btn.dataset.value === chosenSpread || btn.dataset.value === 'reader-choice');
    });
```

New:
```javascript
    const spreadSel = document.getElementById('spread-select');
    if (spreadSel) {
      spreadSel.value = chosenSpread === 'reader-choice' ? 'reader-choice' : chosenSpread;
      currentSpread = spreadSel.value;
    }
```

Old (line ~1265 — wherever else `#spread-select .btn` appears):
```javascript
    document.querySelectorAll('#spread-select .btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.value === currentSpread);
    });
```

New:
```javascript
    const spreadSel = document.getElementById('spread-select');
    if (spreadSel && spreadSel.value !== currentSpread) spreadSel.value = currentSpread;
```

- [ ] **Step 6: Verify spread selection in browser**

- Refresh `http://localhost:3000`
- Click each category tab — spread dropdown should repopulate
- Select a spread and click "Lay the Cards" — correct spread should render
- "Miriel's Choice" should appear at the bottom of each category's options
- Compatibility option should open the compat modal when selected

- [ ] **Step 7: Commit**

```bash
git add public/app.js public/index.html
git commit -m "feat: convert spread buttons to select dropdown, add Miriel's Choice"
```

---

## Task 5: Cards — framed & antique treatment

**Files:**
- Modify: `public/style.css` — `.card-face`, `.card-back`, `.card-face:hover`, new `@keyframes card-back-pulse`

- [ ] **Step 1: Update card border and shadow in `style.css`**

Find `.card-face, .card-back` (lines ~857–873):
```css
.card-face, .card-back {
  ...
  border: 2px solid var(--border);
  ...
}
```

Change `border: 2px solid var(--border)` to:
```css
  border: 2px solid var(--gold-dim);
  box-shadow:
    0 6px 24px rgba(0, 0, 0, 0.70),
    inset 0 0 0 3px var(--bg),
    inset 0 0 0 4px #2a2040;
```

- [ ] **Step 2: Update `.card-face:hover` in `style.css`**

Find:
```css
.card-face:hover { border-color: var(--gold-dim); }
```

Replace with:
```css
.card-face:hover {
  border-color: var(--gold-dim);
  box-shadow:
    0 10px 32px rgba(0, 0, 0, 0.85),
    inset 0 0 0 3px var(--bg),
    inset 0 0 0 4px #2a2040,
    0 0 22px rgba(201, 168, 76, 0.28);
  transform: translateY(-4px);
}
```

- [ ] **Step 3: Restyle `.card-back` for the moon motif in `style.css`**

Find:
```css
.card-back {
  background: var(--bg2) center / cover no-repeat;
  cursor: pointer;
}

.card-back::before {
  content: '';
}
```

Replace with:
```css
.card-back {
  background: radial-gradient(ellipse at 50% 40%, #1e1040 0%, #0a0818 100%);
  border-color: #5a4080;
  cursor: pointer;
  animation: card-back-pulse 3s ease-in-out infinite;
}

.card-inner.flipped .card-back {
  animation: none;
}

.card-back::before {
  content: '☽';
  font-size: 2rem;
  color: #5a4080;
  line-height: 1;
}

@keyframes card-back-pulse {
  0%, 100% {
    box-shadow:
      0 6px 24px rgba(0, 0, 0, 0.70),
      inset 0 0 0 3px var(--bg),
      inset 0 0 0 4px #2a2040,
      0 0 6px rgba(123, 94, 167, 0.12);
  }
  50% {
    box-shadow:
      0 6px 24px rgba(0, 0, 0, 0.70),
      inset 0 0 0 3px var(--bg),
      inset 0 0 0 4px #2a2040,
      0 0 20px rgba(123, 94, 167, 0.38);
  }
}
```

**Note:** The `::before` moon symbol shows on decks that have no custom card-back image. For decks with `background-image` set via JS, the `::before` content is still rendered but sits beneath the image — harmless.

- [ ] **Step 4: Verify cards in browser**

- Draw a spread — face-down cards should gently pulse with a purple shimmer
- Click a card to flip it — pulsing stops, card face shows with gold border frame
- Hover a flipped card — subtle gold glow lift effect

- [ ] **Step 5: Commit**

```bash
git add public/style.css
git commit -m "feat: framed antique cards with moon back and hover glow"
```

---

## Task 6: Meaning panel — two-column split

**Files:**
- Modify: `public/style.css` — `.meaning-panel`, new `.meanings-col`, `.ai-col`
- Modify: `public/index.html` — restructure `#meaning-panel` into two columns
- Modify: `public/app.js` — keyword pill wrapping in meaning renderer

### Part A — HTML restructure

- [ ] **Step 1: Restructure `#meaning-panel` in `index.html`**

Find the current `#meaning-panel` block:
```html
    <div id="meaning-panel" class="meaning-panel hidden">
      <div id="meaning-content"></div>

      <button class="ask-claude-btn" id="ask-claude-btn">&#10024; Open the reading</button>
      <button class="export-btn hidden" id="export-reading-btn">&#8595; Save this reading</button>
      <button class="export-btn hidden" id="copy-reading-btn">&#128203; Copy text</button>
      <button class="export-btn hidden" id="share-image-btn">&#128247; Save as image</button>

      <div id="claude-response" class="hidden">
        ...everything inside...
      </div>
    </div>
```

Replace with:
```html
    <div id="meaning-panel" class="meaning-panel hidden">
      <div class="meanings-col">
        <div class="col-eyebrow">Card Meanings</div>
        <div id="meaning-content"></div>
      </div>
      <div class="ai-col">
        <div class="col-eyebrow">The Reading</div>
        <button class="ask-claude-btn" id="ask-claude-btn">&#10024; Open the reading</button>
        <button class="export-btn hidden" id="export-reading-btn">&#8595; Save this reading</button>
        <button class="export-btn hidden" id="copy-reading-btn">&#128203; Copy text</button>
        <button class="export-btn hidden" id="share-image-btn">&#128247; Save as image</button>

        <div id="claude-response" class="hidden">
          <!-- Card reflections: individual per-card interpretations -->
          <div id="card-reflections" class="hidden">
            <div class="response-label">What the cards say</div>
            <div id="reflections-text"></div>
          </div>

          <!-- Overall synopsis: the unified reading -->
          <div id="overall-synopsis" class="hidden">
            <div class="synopsis-header">
              <span class="synopsis-icon">&#10022;</span>
              <span class="response-label synopsis-label">The Reading</span>
              <span class="synopsis-icon">&#10022;</span>
            </div>
            <div id="synopsis-text"></div>
          </div>

          <!-- Clarifier suggestion + actions -->
          <div id="clarifier-prompt" class="hidden">
            <div id="clarifier-suggestion"></div>
            <div class="clarifier-actions">
              <button class="clarifier-btn" id="clarifier-draw-btn">&#127183; Draw one for me</button>
              <button class="clarifier-btn clarifier-btn-alt" id="clarifier-choose-btn">&#9997; I'll pick one</button>
            </div>

            <div id="clarifier-chooser" class="hidden">
              <div class="manual-tabs" id="clarifier-tabs">
                <button class="manual-tab active" id="ctab-tarot">Tarot</button>
                <button class="manual-tab" id="ctab-oracle">Oracle</button>
              </div>
              <div class="clarifier-chooser-row">
                <select id="clarifier-select" class="manual-select"></select>
                <label class="manual-rev-label">
                  <input type="checkbox" id="clarifier-reversed" class="manual-rev-check" /> Reversed
                </label>
                <button class="clarifier-btn" id="clarifier-submit-btn">Read this card</button>
              </div>
            </div>
          </div>

          <!-- Clarifier card result -->
          <div id="clarifier-result" class="hidden">
            <div class="clarifier-card-area" id="clarifier-card-area"></div>
            <div class="clarifier-reading-label">What it reveals</div>
            <div id="clarifier-reading-text"></div>
          </div>

          <!-- Continue: ask another question -->
          <div id="continue-reading" class="hidden">
            <div class="continue-divider">&#10022; &#10022; &#10022;</div>
            <div class="continue-row">
              <textarea id="continue-question" placeholder="What calls to you? Share a question, a situation, or anything on your mind." autocomplete="off" rows="2"></textarea>
              <button class="draw-btn continue-draw-btn" id="continue-draw-btn">Read Again</button>
            </div>
          </div>
        </div>
      </div>
    </div>
```

### Part B — CSS

- [ ] **Step 2: Update `.meaning-panel` and add column styles in `style.css`**

Find:
```css
.meaning-panel {
  width: 100%;
  max-width: 700px;
  background: var(--bg2);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 1.5rem;
  display: flex;
  flex-direction: column;
  gap: 1rem;
}
```

Replace with:
```css
.meaning-panel {
  width: 100%;
  max-width: 900px;
  background: var(--bg2);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 1.5rem;
  display: flex;
  flex-direction: row;
  gap: 1.5rem;
  align-items: flex-start;
}

.meanings-col {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  min-width: 0;
}

.ai-col {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  min-width: 0;
}

.col-eyebrow {
  font-size: 0.65rem;
  text-transform: uppercase;
  letter-spacing: 0.18em;
  color: var(--text-dim);
  margin-bottom: 0.1rem;
}

/* Responsive fallback */
@media (max-width: 768px) {
  .meaning-panel {
    flex-direction: column;
    max-width: 700px;
  }
}
```

### Part C — Keyword pills in JS

- [ ] **Step 3: Add keyword pill wrapping in `app.js`**

Find line ~1592 inside `showMeaning()` (or similar function that renders per-card meaning):
```javascript
    <div class="meaning-keywords">${(card.keywords || []).join(' · ')}</div>
```

Replace with:
```javascript
    <div class="meaning-keywords">${
      (card.keywords || []).map(kw =>
        `<span class="keyword-pill${card.isReversed ? ' keyword-pill-rev' : ''}">${kw}</span>`
      ).join('')
    }</div>
```

- [ ] **Step 4: Add keyword pill CSS in `style.css`**

After the `.meaning-keywords` rule, add:
```css
.keyword-pill {
  display: inline-block;
  background: rgba(201, 168, 76, 0.10);
  border: 1px solid rgba(201, 168, 76, 0.18);
  color: var(--gold-dim);
  border-radius: 10px;
  padding: 1px 7px;
  font-size: 0.68rem;
  letter-spacing: 0.05em;
  margin: 1px 2px 3px;
  text-transform: uppercase;
}

.keyword-pill-rev {
  background: rgba(123, 94, 167, 0.12);
  border-color: rgba(123, 94, 167, 0.25);
  color: var(--purple-light);
}
```

- [ ] **Step 5: Verify meaning panel in browser**

- Draw a 3-card spread and flip all cards
- Click "Open the reading" button — the two-column layout should appear: keywords and card text on the left, AI response area on the right
- Keywords should appear as pill badges (gold for upright, purple for reversed)
- On a narrow window (< 768px), columns should stack vertically

- [ ] **Step 6: Commit**

```bash
git add public/style.css public/index.html public/app.js
git commit -m "feat: two-column meaning panel with keyword pill badges"
```

---

## Task 7: Miriel's Choice — rename display label in app.js

**Files:**
- Modify: `public/app.js` — label in SPREADS definition and loading message

The key `'reader-choice'` stays as-is (changing it would break state/resume logic). Only the user-visible label changes.

- [ ] **Step 1: Update the label in the SPREADS definition**

Find line ~113–116:
```javascript
  'reader-choice': {
    category: 'general', label: '✦ Reader\'s Choice',
    special: 'reader-choice',
```

Change `label` to:
```javascript
  'reader-choice': {
    category: 'general', label: '✦ Miriel\'s Choice',
    special: 'reader-choice',
```

(The `activateTab()` rewrite in Task 4 already overrides this label with `'⋯ Miriel\'s Choice'` in the dropdown, but updating the SPREADS definition keeps the label consistent if it appears elsewhere.)

- [ ] **Step 2: Update the loading message**

Find line ~986:
```javascript
  spreadArea.innerHTML = '<div class="reader-choice-loading"><span class="loading">The reader is reading your question</span></div>';
```

Replace with:
```javascript
  spreadArea.innerHTML = '<div class="reader-choice-loading"><span class="loading">Miriel is reading your question</span></div>';
```

- [ ] **Step 3: Update the comment on line ~1913**

Find:
```javascript
// Launch a full Reader's Choice spread rooted in a clarifier thread
```

Replace:
```javascript
// Launch a full Miriel's Choice spread rooted in a clarifier thread
```

- [ ] **Step 4: Verify in browser**

Select the "⋯ Miriel's Choice" option in the spread dropdown and click "Lay the Cards". The loading spinner should read "Miriel is reading your question…" while the AI picks a spread.

- [ ] **Step 5: Commit**

```bash
git add public/app.js
git commit -m "feat: rename Reader's Choice to Miriel's Choice"
```

---

## Task 8: Final integration check

- [ ] **Step 1: Full smoke test**

Run `node server.js` from `C:\Users\Matt\projects\tarot` and verify each of the following:

1. Background image is visible and fixed on scroll
2. Header is centered with ornament / title / tagline
3. Category tabs switch the spread dropdown contents correctly
4. Miriel's Choice appears at the bottom of each category's spread list
5. Drawing a spread shows framed cards with gold borders and double inset
6. Face-down cards pulse with a gentle purple shimmer; pulsing stops on flip
7. Hovering a flipped card shows a gold glow lift
8. Flipping cards reveals the meaning panel in two-column layout
9. Keyword pills appear (gold for upright, purple-tint for reversed)
10. "Open the reading" (AI) response renders in the right column

- [ ] **Step 2: Check reading archive**

Draw a second spread after the first — the archived reading (dimmed, above) should still render correctly with the new card styles.

- [ ] **Step 3: Check the resume panel**

Reload the page — if there's a prior session in localStorage, the resume banner should appear and still function.

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "feat: complete visual polish pass for Miriel's Readings"
```
