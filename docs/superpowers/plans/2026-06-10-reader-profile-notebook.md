# Your Story So Far — Reader Profile Notebook Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A full-screen cinematic "Your Story So Far" overlay that displays Miriel's stored profile of the active reader — chapter quote, verbatim notes, recurring cards with real card art, threads, and unresolved thread — entered from the reader menu.

**Architecture:** A new `data/notebook.js` module builds the API payload (profile + reading count + tier) and resolves recurring-card images by card *name* (the LLM-invented `card_id` values like `major_09` don't match real deck ids like `major-9`). A new `GET /api/profiles/:slug` endpoint serves it. The frontend adds a reader-menu entry and a scrollable overlay styled after the existing `.miriel-takeover`.

**Tech Stack:** Node 18+, Express, vanilla JS frontend, `node:test` + `node:assert/strict` (run with `node --test tests/`).

**Spec:** `docs/superpowers/specs/2026-06-10-reader-profile-notebook-design.md`

**Key facts for the implementer:**
- `data/tarot.json` is a flat JSON array of cards: `{ "id": "major-9", "name": "The Hermit", ... }`.
- Tarot card images live at `public/images/tarot/<id>.jpg` (e.g. `major-9.jpg`).
- Profiles: `data/profiles/<slug>.json` — fields `miriel_notes`, `recurring_cards` (`[{card, card_id, count, note}]`), `readings_synthesized`, `last_updated` (unix seconds); tier 3 adds `life_arc` (`{current_chapter, key_threads: [{theme, status}], inflection_points}`) and `unresolved_thread`.
- Tiers (from `data/reader-profile.js` `getTier`): 1 = under 10 readings (no profile), 2 = 10–29, 3 = 30+.
- `server.js` globals available to handlers: `DATA_DIR`, `loadReaders()`, `loadReadings(slug)`, `profiles` (the profile manager), `path`, `fs`.

---

### Task 1: `data/notebook.js` — payload builder with image resolution

**Files:**
- Create: `data/notebook.js`
- Test: `tests/notebook.test.js`

- [ ] **Step 1: Write the failing tests**

Create `tests/notebook.test.js`:

```js
'use strict';
const { test } = require('node:test');
const assert   = require('node:assert/strict');
const os   = require('os');
const path = require('path');
const fs   = require('fs');
const { buildNotebookPayload, resolveCardImage } = require('../data/notebook');

// Build a throwaway data dir with a 2-card tarot.json and one image on disk
function makeFixture() {
  const dataDir   = fs.mkdtempSync(path.join(os.tmpdir(), 'tarot-nb-data-'));
  const imagesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tarot-nb-img-'));
  fs.writeFileSync(path.join(dataDir, 'tarot.json'), JSON.stringify([
    { id: 'major-9',  name: 'The Hermit' },
    { id: 'cups-8',   name: 'Eight of Cups' }
  ]));
  fs.mkdirSync(path.join(imagesDir, 'tarot'));
  fs.writeFileSync(path.join(imagesDir, 'tarot', 'major-9.jpg'), 'x');
  return { dataDir, imagesDir };
}

function getTier(n) { return n >= 30 ? 3 : n >= 10 ? 2 : 1; }

test('resolveCardImage matches by name, case-insensitively', () => {
  const { dataDir, imagesDir } = makeFixture();
  assert.equal(resolveCardImage('the hermit', dataDir, imagesDir), '/images/tarot/major-9.jpg');
});

test('resolveCardImage returns null when image file is missing', () => {
  const { dataDir, imagesDir } = makeFixture();
  assert.equal(resolveCardImage('Eight of Cups', dataDir, imagesDir), null);
});

test('resolveCardImage returns null for unknown card name', () => {
  const { dataDir, imagesDir } = makeFixture();
  assert.equal(resolveCardImage('Wunjo', dataDir, imagesDir), null);
});

test('buildNotebookPayload returns null profile and tier 1 for a new reader', () => {
  const { dataDir, imagesDir } = makeFixture();
  const out = buildNotebookPayload({ profile: null, readingCount: 3, getTier, dataDir, imagesDir });
  assert.deepEqual(out, { profile: null, readingCount: 3, tier: 1 });
});

test('buildNotebookPayload enriches recurring cards with imageUrl', () => {
  const { dataDir, imagesDir } = makeFixture();
  const profile = {
    miriel_notes: 'Notes.',
    recurring_cards: [
      { card: 'The Hermit',    card_id: 'major_09', count: 6, note: 'foundation' },
      { card: 'Eight of Cups', card_id: 'cups_08',  count: 3, note: 'departure' }
    ]
  };
  const out = buildNotebookPayload({ profile, readingCount: 66, getTier, dataDir, imagesDir });
  assert.equal(out.tier, 3);
  assert.equal(out.profile.recurring_cards[0].imageUrl, '/images/tarot/major-9.jpg');
  assert.equal(out.profile.recurring_cards[1].imageUrl, null);
  // original profile object is not mutated
  assert.equal(profile.recurring_cards[0].imageUrl, undefined);
});

test('buildNotebookPayload tolerates profile without recurring_cards', () => {
  const { dataDir, imagesDir } = makeFixture();
  const out = buildNotebookPayload({ profile: { miriel_notes: 'n' }, readingCount: 12, getTier, dataDir, imagesDir });
  assert.equal(out.tier, 2);
  assert.equal(out.profile.miriel_notes, 'n');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/notebook.test.js`
Expected: FAIL — `Cannot find module '../data/notebook'`

- [ ] **Step 3: Write the implementation**

Create `data/notebook.js`:

```js
'use strict';
const path = require('path');
const fs   = require('fs');

const IMG_EXTS = ['.jpg', '.jpeg', '.png', '.webp', '.svg'];

// Profile card_ids are LLM-invented during synthesis (e.g. "major_09") and do
// not reliably match real deck ids ("major-9"), so images resolve by card name
// against tarot.json. Unresolvable cards get imageUrl null and the frontend
// renders a styled placeholder.
function resolveCardImage(cardName, dataDir, imagesDir) {
  let cards;
  try {
    cards = JSON.parse(fs.readFileSync(path.join(dataDir, 'tarot.json'), 'utf8'));
  } catch {
    return null;
  }
  if (!Array.isArray(cards)) return null;
  const wanted = String(cardName || '').trim().toLowerCase();
  const match  = cards.find(c => String(c.name).toLowerCase() === wanted);
  if (!match) return null;
  for (const ext of IMG_EXTS) {
    const file = `${match.id}${ext}`;
    if (fs.existsSync(path.join(imagesDir, 'tarot', file))) {
      return `/images/tarot/${encodeURIComponent(file)}`;
    }
  }
  return null;
}

function buildNotebookPayload({ profile, readingCount, getTier, dataDir, imagesDir }) {
  const tier = getTier(readingCount);
  let out = profile;
  if (profile && Array.isArray(profile.recurring_cards)) {
    out = {
      ...profile,
      recurring_cards: profile.recurring_cards.map(rc => ({
        ...rc,
        imageUrl: resolveCardImage(rc.card, dataDir, imagesDir)
      }))
    };
  }
  return { profile: out || null, readingCount, tier };
}

module.exports = { buildNotebookPayload, resolveCardImage };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/notebook.test.js`
Expected: 6 passing, 0 failing

- [ ] **Step 5: Commit**

```bash
git add data/notebook.js tests/notebook.test.js
git commit -m "feat: notebook payload builder with name-based card image resolution"
```

---

### Task 2: `GET /api/profiles/:slug` endpoint

**Files:**
- Modify: `server.js` (require block ~line 16; insert route directly above the existing `app.post('/api/profiles/:slug/refresh', ...)` at ~line 715)

- [ ] **Step 1: Add the require**

In `server.js`, below `const createProfileManager = require('./data/reader-profile');`, add:

```js
const { buildNotebookPayload } = require('./data/notebook');
```

- [ ] **Step 2: Add the route**

Directly above `app.post('/api/profiles/:slug/refresh', ...)`, add:

```js
app.get('/api/profiles/:slug', (req, res) => {
  const { slug } = req.params;
  const readers = loadReaders();
  if (!readers.find(r => r.slug === slug)) {
    return res.status(404).json({ error: 'Reader not found' });
  }
  res.json(buildNotebookPayload({
    profile:      profiles.loadReaderProfile(slug),
    readingCount: loadReadings(slug).length,
    getTier:      profiles.getTier,
    dataDir:      DATA_DIR,
    imagesDir:    path.join(__dirname, 'public', 'images')
  }));
});
```

- [ ] **Step 3: Verify syntax and smoke-test the endpoint**

Run: `node --check server.js`
Expected: exit 0

Run: `npm start` in one terminal, then:

```bash
curl -s http://localhost:3000/api/profiles/matt | head -c 300
curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/api/profiles/nobody
```

Expected: first returns JSON starting `{"profile":{"slug":"matt",...`; second prints `404`. Stop the server.

- [ ] **Step 4: Commit**

```bash
git add server.js
git commit -m "feat: GET /api/profiles/:slug for the notebook view"
```

---

### Task 3: Overlay markup and CSS

**Files:**
- Modify: `public/index.html` (insert before the `#miriel-takeover` div, ~line 233)
- Modify: `public/style.css` (append at end)

- [ ] **Step 1: Add the overlay skeleton to `index.html`**

Before `<!-- Miriel's Choice cinematic takeover overlay -->`, insert:

```html
  <!-- Your Story So Far — reader profile notebook overlay -->
  <div id="notebook-overlay" class="notebook-overlay hidden" role="dialog" aria-modal="true">
    <div class="notebook-backdrop" id="notebook-backdrop"></div>
    <button class="notebook-close" id="notebook-close" aria-label="Close">&#x2715;</button>
    <div class="notebook-scroll">
      <div class="notebook-inner" id="notebook-inner"></div>
    </div>
  </div>
```

- [ ] **Step 2: Append the CSS to `style.css`**

```css
/* ── Your Story So Far — reader profile notebook ─────────────────────────── */

.notebook-overlay {
  position: fixed;
  inset: 0;
  z-index: 300;
  opacity: 0;
  transition: opacity 0.6s ease;
}
.notebook-overlay.visible { opacity: 1; }
.notebook-overlay.hidden  { display: none; }

.notebook-backdrop {
  position: absolute;
  inset: 0;
  background: radial-gradient(ellipse at center, #1c1428 0%, #0a0810 100%);
}

.notebook-close {
  position: fixed;
  top: 18px;
  right: 22px;
  z-index: 302;
  background: none;
  border: none;
  color: #6f6582;
  font-size: 20px;
  cursor: pointer;
}
.notebook-close:hover { color: #c9a45c; }

.notebook-scroll {
  position: absolute;
  inset: 0;
  overflow-y: auto;
  z-index: 301;
}

.notebook-inner {
  max-width: 620px;
  margin: 0 auto;
  padding: 56px 24px 72px;
  font-family: Georgia, serif;
  color: #cfc6b8;
  text-align: center;
}

.notebook-ornament {
  color: #c9a45c;
  font-size: 13px;
  letter-spacing: 5px;
}

.notebook-title {
  color: #c9a45c;
  font-size: 19px;
  letter-spacing: 5px;
  margin: 12px 0 4px;
}

.notebook-meta {
  color: #6f6582;
  font-size: 12px;
  margin-bottom: 26px;
}

.notebook-quote {
  font-style: italic;
  color: #9b8ec4;
  font-size: 16px;
  line-height: 1.6;
  margin: 0 auto 28px;
  max-width: 540px;
}

.notebook-eyebrow {
  color: #c9a45c;
  font-size: 11px;
  letter-spacing: 3px;
  text-transform: uppercase;
  margin: 32px 0 12px;
}

.notebook-notes {
  text-align: left;
}
.notebook-notes p {
  font-size: 14px;
  line-height: 1.85;
  margin: 0 0 14px;
}

.notebook-cards {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  justify-content: center;
}

.notebook-card { width: 104px; }

.notebook-card-img {
  width: 104px;
  height: 160px;
  object-fit: cover;
  border: 2px solid rgba(201, 164, 92, 0.4);
  border-radius: 6px;
  display: block;
}

.notebook-card-placeholder {
  width: 104px;
  height: 160px;
  border: 2px solid rgba(201, 164, 92, 0.4);
  border-radius: 6px;
  background: linear-gradient(160deg, #241b33, #171122);
  display: flex;
  align-items: center;
  justify-content: center;
  color: #c9a45c;
  font-size: 26px;
}

.notebook-card-name {
  font-size: 12px;
  margin-top: 7px;
  color: #e8d9b0;
}

.notebook-card-note {
  font-size: 11px;
  color: #8d829f;
  line-height: 1.45;
  margin-top: 4px;
}

.notebook-threads {
  text-align: left;
  font-size: 14px;
  line-height: 2.1;
}
.notebook-thread-status            { font-variant: small-caps; }
.notebook-thread-status.open       { color: #cf8a8a; }
.notebook-thread-status.moving     { color: #e0b252; }
.notebook-thread-status.resolved   { color: #7fbf8e; }

.notebook-unresolved {
  border-top: 1px solid rgba(58, 49, 80, 0.5);
  margin-top: 30px;
  padding-top: 4px;
}
.notebook-unresolved-text {
  font-size: 14px;
  font-style: italic;
  color: #a99dbd;
  line-height: 1.7;
}

.notebook-teaser {
  font-style: italic;
  color: #9b8ec4;
  font-size: 16px;
  line-height: 1.8;
  margin-top: 48px;
}
.notebook-teaser-count {
  color: #6f6582;
  font-style: normal;
  font-size: 13px;
  margin-top: 14px;
}

.notebook-hint {
  color: #6f6582;
  font-size: 12px;
  margin-top: 44px;
}

/* Reader-menu entry */
.reader-option-story {
  border-top: 1px solid rgba(58, 49, 80, 0.6);
  color: #c9a45c;
}
```

(`.reader-option-story` inherits the rest of its look from the existing `.reader-option` class it shares.)

- [ ] **Step 3: Verify the app still loads**

Run: `npm start`, open http://localhost:3000.
Expected: page renders unchanged (overlay is `.hidden`).

- [ ] **Step 4: Commit**

```bash
git add public/index.html public/style.css
git commit -m "feat: notebook overlay markup and styles"
```

---

### Task 4: Frontend — menu entry and notebook rendering

**Files:**
- Modify: `public/app.js` — add menu entry inside `populateReaderDropdown()` (after the `readers.forEach(...)` loop, before the "Add new reader button + form" block, ~line 615); add the notebook functions near the other reader-profile code (after `switchReader`, ~line 669).

- [ ] **Step 1: Add the menu entry**

In `populateReaderDropdown()`, between the `readers.forEach(...)` loop and the `// Add new reader button + form` comment, insert:

```js
  // Your Story So Far — Miriel's notebook on the active reader
  const storyBtn = document.createElement('button');
  storyBtn.className = 'reader-option reader-option-story';
  storyBtn.textContent = '✦ Your Story So Far';
  storyBtn.addEventListener('click', () => {
    dropdown.classList.add('hidden');
    openNotebook();
  });
  dropdown.appendChild(storyBtn);
```

- [ ] **Step 2: Add the notebook functions**

After the `switchReader` function, add:

```js
// ── Your Story So Far (reader profile notebook) ──────────────────────────────

function notebookEl(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text) el.textContent = text;
  return el;
}

async function openNotebook() {
  const overlay = document.getElementById('notebook-overlay');
  const inner   = document.getElementById('notebook-inner');
  inner.innerHTML = '';

  let data = null;
  try {
    const r = await fetch(`/api/profiles/${encodeURIComponent(currentReader.slug)}`);
    if (r.ok) data = await r.json();
  } catch {}

  // Header (always shown)
  inner.appendChild(notebookEl('div', 'notebook-ornament', '✦ · ✦ · ✦'));
  inner.appendChild(notebookEl('div', 'notebook-title', 'YOUR STORY SO FAR'));

  if (!data) {
    renderNotebookTeaser(inner, null, "I couldn't reach her notebook just now.");
  } else if (data.tier === 1 || !data.profile) {
    renderNotebookTeaser(inner, data.readingCount, null);
  } else {
    renderNotebookProfile(inner, data);
  }

  inner.appendChild(notebookEl('div', 'notebook-hint', 'esc · return to the table'));

  overlay.classList.remove('hidden');
  requestAnimationFrame(() => overlay.classList.add('visible'));
  document.body.style.overflow = 'hidden';
  document.addEventListener('keydown', notebookEscHandler);
}

function renderNotebookTeaser(inner, readingCount, errorNote) {
  const teaser = notebookEl('div', 'notebook-teaser',
    errorNote || "I'm still getting to know you. Sit with me a few more times — the cards will tell me who you are.");
  inner.appendChild(teaser);
  if (readingCount !== null && readingCount !== undefined) {
    const remaining = Math.max(1, 10 - readingCount);
    inner.appendChild(notebookEl('div', 'notebook-teaser-count',
      `${remaining} more reading${remaining === 1 ? '' : 's'} until she opens it`));
  }
}

function renderNotebookProfile(inner, data) {
  const p = data.profile;

  // Meta line
  const updated = p.last_updated
    ? new Date(p.last_updated * 1000).toLocaleDateString(undefined, { month: 'long', day: 'numeric' })
    : null;
  const metaBits = [`as Miriel has come to know ${currentReader.name}`];
  if (p.readings_synthesized) metaBits.push(`${p.readings_synthesized} readings`);
  if (updated) metaBits.push(`last updated ${updated}`);
  inner.appendChild(notebookEl('div', 'notebook-meta', metaBits.join(' · ')));

  // Chapter quote (tier 3 only — life_arc absent at tier 2)
  if (p.life_arc && p.life_arc.current_chapter) {
    inner.appendChild(notebookEl('div', 'notebook-quote', `“${p.life_arc.current_chapter}”`));
  }

  // Her notes, verbatim
  if (p.miriel_notes) {
    inner.appendChild(notebookEl('div', 'notebook-eyebrow', 'From her notebook'));
    const notes = notebookEl('div', 'notebook-notes');
    p.miriel_notes.split(/\n\s*\n/).forEach(par => {
      if (par.trim()) notes.appendChild(notebookEl('p', null, par.trim()));
    });
    inner.appendChild(notes);
  }

  // Recurring cards
  if (Array.isArray(p.recurring_cards) && p.recurring_cards.length) {
    inner.appendChild(notebookEl('div', 'notebook-eyebrow', 'The cards that keep finding you'));
    const row = notebookEl('div', 'notebook-cards');
    p.recurring_cards.forEach(rc => {
      const cell = notebookEl('div', 'notebook-card');
      if (rc.imageUrl) {
        const img = document.createElement('img');
        img.className = 'notebook-card-img';
        img.src = rc.imageUrl;
        img.alt = rc.card;
        cell.appendChild(img);
      } else {
        cell.appendChild(notebookEl('div', 'notebook-card-placeholder', '✦'));
      }
      cell.appendChild(notebookEl('div', 'notebook-card-name', `${rc.card} ×${rc.count}`));
      if (rc.note) cell.appendChild(notebookEl('div', 'notebook-card-note', rc.note));
      row.appendChild(cell);
    });
    inner.appendChild(row);
  }

  // Threads (tier 3)
  const threads = p.life_arc && Array.isArray(p.life_arc.key_threads) ? p.life_arc.key_threads : [];
  if (threads.length) {
    inner.appendChild(notebookEl('div', 'notebook-eyebrow', 'The threads'));
    const list = notebookEl('div', 'notebook-threads');
    const glyphs = { open: '○', moving: '◐', resolved: '●' };
    threads.forEach(t => {
      const status = String(t.status || 'open').toLowerCase();
      const line = notebookEl('div', null);
      line.appendChild(document.createTextNode(`${glyphs[status] || '○'} `));
      line.appendChild(notebookEl('span', `notebook-thread-status ${status}`, status));
      line.appendChild(document.createTextNode(` — ${t.theme}`));
      list.appendChild(line);
    });
    inner.appendChild(list);
  }

  // What keeps surfacing (tier 3)
  if (p.unresolved_thread || (p.life_arc && p.life_arc.inflection_points)) {
    const box = notebookEl('div', 'notebook-unresolved');
    box.appendChild(notebookEl('div', 'notebook-eyebrow', 'What keeps surfacing'));
    if (p.unresolved_thread) {
      box.appendChild(notebookEl('div', 'notebook-unresolved-text', p.unresolved_thread));
    }
    if (p.life_arc && p.life_arc.inflection_points) {
      box.appendChild(notebookEl('div', 'notebook-unresolved-text', p.life_arc.inflection_points));
    }
    inner.appendChild(box);
  }
}

function notebookEscHandler(e) {
  if (e.key === 'Escape') closeNotebook();
}

function closeNotebook() {
  const overlay = document.getElementById('notebook-overlay');
  overlay.classList.remove('visible');
  document.body.style.overflow = '';
  document.removeEventListener('keydown', notebookEscHandler);
  setTimeout(() => overlay.classList.add('hidden'), 600);
}
```

- [ ] **Step 3: Wire the close button and backdrop**

In app.js, find the init section where other one-time listeners are bound (inside the `DOMContentLoaded`/init flow where `settings-close-btn` and similar are wired; search for `settings-close-btn`). Add alongside them:

```js
  document.getElementById('notebook-close').addEventListener('click', closeNotebook);
  document.getElementById('notebook-backdrop').addEventListener('click', closeNotebook);
```

If listeners are bound at top level rather than in an init function, place these two lines at top level after the functions from Step 2.

- [ ] **Step 4: Smoke-test in the browser**

Run: `npm start`, open http://localhost:3000.

- Open the reader menu (☾ Matt) → "✦ Your Story So Far" appears below the reader rows.
- Click it as Matt: full overlay with chapter quote, notes paragraphs, recurring cards (The Hermit should show real card art; cards whose names only exist in other decks show the ✦ placeholder), threads with colored statuses, unresolved thread, footer hint.
- `esc`, the ✕ button, and clicking the dark backdrop each close it; page scroll restored after closing.
- Switch to Test Reader (or a fresh reader) and open it: teaser with remaining-readings count.

- [ ] **Step 5: Run the full test suite**

Run: `node --test tests/`
Expected: all tests pass

- [ ] **Step 6: Commit**

```bash
git add public/app.js
git commit -m "feat: Your Story So Far notebook overlay"
```

---

### Task 5: Final verification

- [ ] **Step 1: Full test suite and syntax check**

Run: `node --check server.js && node --test tests/`
Expected: clean exit, all tests pass

- [ ] **Step 2: Walk the user through it**

Have the user open the notebook as Matt and confirm the layout matches the approved mockup (section order: quote → notes → cards → threads → unresolved). Report any visual gaps before declaring done.
