# Emotional Seasons (Slice 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Miriel weave a recurring emotional theme (one that persists across the querent's seasons) into a reading's interpretation when a drawn card genuinely meets it.

**Architecture:** A new PURE `detectRecurringTheme(seasons)` detector in the existing `data/emotional-seasons.js` (sibling of `detectSeasonShift`), tallying themes across the season timeline; plus consume-only wiring in `/api/interpret` that appends a framed `seasonThemeBlock` to the persona (after the existing prophecy block) and widens the existing `overclaimGuard` to license the new claim. No new LLM call (rides the existing interpret call). This is Slice 2 of 2; Slice 1 (season core + greeting) already shipped to master.

**Tech Stack:** Node.js, `node --test`.

## Global Constraints

- **Detector is PURE** (no LLM, no I/O): `detectRecurringTheme(seasons)` reads the season timeline (array of season records `{index, started_at, ended_at, label, valence, themes[], summary}`) already produced by Slice 1.
- **Constant (exact):** `THEME_MIN_SEASONS = 2` — a theme must appear in at least this many DISTINCT seasons to surface.
- **Selection:** emit the single most-recurring theme; rank by distinct-season count desc, then total occurrences desc, then recency (highest season index) desc. Return `null` if fewer than 2 seasons or no theme reaches the bar.
- **Themes compared case-insensitively, trimmed, lowercased** (the same normalization Slice 1's `parseSeasonOutput` already applies when writing them).
- **Consume-only in `/api/interpret`:** no new LLM call; the block is appended to `personaFinal`. Reading the `seasons:<slug>` meta is wrapped in try/catch (degrade to no block).
- **overclaimGuard must be widened** to list recurring emotional threads as something Miriel legitimately tracks — otherwise the guard contradicts the new block.
- **ASCII only** in all model-facing prose — no em dashes, no smart quotes.
- **New static export is additive**; existing callers unaffected.
- **Test command:** `node --test` from the project root (currently 178 passing). Targeted: `node --test tests/<file>.test.js`. Do NOT use `node --test tests/`.
- **Commit cadence:** one commit per task after its tests pass.

---

### Task 1: `detectRecurringTheme` pure detector

**Files:**
- Modify: `data/emotional-seasons.js`
- Test: `tests/emotional-seasons.test.js`

**Interfaces:**
- Consumes: a `seasons` array of records `{index, themes:string[], ...}` (the Slice 1 timeline).
- Produces: static `module.exports.detectRecurringTheme = detectRecurringTheme`.
  - `detectRecurringTheme(seasons) -> { theme:string, seasons:int, fact:string } | null`. `seasons` in the return is the distinct-season count for the chosen theme.

- [ ] **Step 1: Write the failing tests**

Add to `tests/emotional-seasons.test.js` (the file already requires `createEmotionalSeasons`; add `detectRecurringTheme` to the existing destructured static import line `const { detectSeasonShift } = require('../data/emotional-seasons');` so it becomes `const { detectSeasonShift, detectRecurringTheme } = require('../data/emotional-seasons');`). Append these tests:

```javascript
function seasonWithThemes(index, themes) {
  return { index, valence: 0, label: `s${index}`, themes, summary: 'x',
           started_at: 0, ended_at: 0 };
}

test('detectRecurringTheme returns null with fewer than 2 seasons', () => {
  assert.equal(detectRecurringTheme([]), null);
  assert.equal(detectRecurringTheme([seasonWithThemes(0, ['fear', 'hope'])]), null);
});

test('detectRecurringTheme returns null when no theme repeats across seasons', () => {
  const seasons = [seasonWithThemes(0, ['fear']), seasonWithThemes(1, ['hope'])];
  assert.equal(detectRecurringTheme(seasons), null);
});

test('detectRecurringTheme emits a theme present in >= 2 distinct seasons', () => {
  const seasons = [seasonWithThemes(0, ['fear', 'the move']),
                   seasonWithThemes(1, ['hope']),
                   seasonWithThemes(2, ['fear'])];
  const got = detectRecurringTheme(seasons);
  assert.ok(got);
  assert.equal(got.theme, 'fear');
  assert.equal(got.seasons, 2);
  assert.match(got.fact, /fear/);
});

test('detectRecurringTheme is case-insensitive when tallying', () => {
  const seasons = [seasonWithThemes(0, ['Fear']), seasonWithThemes(1, ['FEAR'])];
  const got = detectRecurringTheme(seasons);
  assert.equal(got.theme, 'fear');
  assert.equal(got.seasons, 2);
});

test('detectRecurringTheme ranks by distinct-season count first', () => {
  const seasons = [seasonWithThemes(0, ['fear', 'doubt']),
                   seasonWithThemes(1, ['fear', 'doubt']),
                   seasonWithThemes(2, ['fear'])];
  // fear in 3 seasons, doubt in 2 -> fear wins.
  assert.equal(detectRecurringTheme(seasons).theme, 'fear');
});

test('detectRecurringTheme tie-breaks equal distinct counts by recency', () => {
  // both 'old' and 'new' appear in exactly 2 distinct seasons with equal total occurrences;
  // 'new' recurs in the more recent seasons -> wins on recency.
  const seasons = [seasonWithThemes(0, ['old']),
                   seasonWithThemes(1, ['old']),
                   seasonWithThemes(2, ['new']),
                   seasonWithThemes(3, ['new'])];
  assert.equal(detectRecurringTheme(seasons).theme, 'new');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/emotional-seasons.test.js`
Expected: FAIL — `detectRecurringTheme is not a function`.

- [ ] **Step 3: Implement the detector**

In `data/emotional-seasons.js`, add the constant near the other constants (after `const SHIFT_THRESHOLD = 2;`):

```javascript
const THEME_MIN_SEASONS = 2;
```

Add the function at module scope, next to `detectSeasonShift` (above the `module.exports = function...` line):

```javascript
// PURE: find the emotional theme that recurs across the most seasons. Returns the
// single strongest recurring theme, or null when none reaches THEME_MIN_SEASONS
// distinct seasons. Ranked by distinct-season count, then total occurrences, then
// recency (highest season index). Mirrors detectSeasonShift's pure, text-emitting shape.
function detectRecurringTheme(seasons) {
  if (!Array.isArray(seasons) || seasons.length < 2) return null;
  const tally = new Map(); // theme -> { distinct, occ, lastIndex }
  seasons.forEach((s, i) => {
    const seenThisSeason = new Set();
    for (const raw of (s.themes || [])) {
      const t = String(raw || '').trim().toLowerCase();
      if (!t) continue;
      const e = tally.get(t) || { distinct: 0, occ: 0, lastIndex: -1 };
      e.occ += 1;
      if (!seenThisSeason.has(t)) { e.distinct += 1; seenThisSeason.add(t); }
      e.lastIndex = i;
      tally.set(t, e);
    }
  });
  const candidates = [];
  for (const [theme, e] of tally) {
    if (e.distinct >= THEME_MIN_SEASONS) candidates.push({ theme, ...e });
  }
  if (!candidates.length) return null;
  candidates.sort((a, b) => b.distinct - a.distinct || b.occ - a.occ || b.lastIndex - a.lastIndex);
  const top = candidates[0];
  return {
    theme: top.theme,
    seasons: top.distinct,
    fact: `The emotional thread of "${top.theme}" keeps returning across their record, present in ${top.distinct} of the seasons you have witnessed in them.`,
  };
}
```

Add the static export near the bottom (next to `module.exports.detectSeasonShift = detectSeasonShift;`):

```javascript
module.exports.detectRecurringTheme = detectRecurringTheme;
module.exports.THEME_MIN_SEASONS = THEME_MIN_SEASONS;
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/emotional-seasons.test.js`
Expected: PASS — existing emotional-seasons tests plus the 6 new ones.

- [ ] **Step 5: Run the full suite**

Run: `node --test`
Expected: `pass 184  fail 0` (178 + 6).

- [ ] **Step 6: Commit**

```bash
git add data/emotional-seasons.js tests/emotional-seasons.test.js
git commit -m "feat(seasons): detectRecurringTheme detector across the season timeline

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Wire the recurring theme into `/api/interpret`

**Files:**
- Modify: `server.js`

**Interfaces:**
- Consumes: `detectRecurringTheme` (Task 1); the `seasons:<slug>` meta timeline (written by Slice 1).
- Produces: interpretations whose persona may include a recurring-emotional-theme block.

No unit-test harness exists for `/api/interpret`; verified by the full suite staying green plus a manual smoke script (then deleted).

- [ ] **Step 1: Import `detectRecurringTheme`**

In `server.js`, the seasons module is already instantiated (Slice 1) with a line like:

```javascript
const { detectSeasonShift } = createEmotionalSeasons;
```

Change it to also pull the new static:

```javascript
const { detectSeasonShift, detectRecurringTheme } = createEmotionalSeasons;
```

- [ ] **Step 2: Build the `seasonThemeBlock` in `/api/interpret`**

In `server.js`, find the prophecy block assembly in `/api/interpret` (the `let prophecyBlock = '';` block that ends by assigning `prophecyBlock = ...`, around lines 669-690). Immediately AFTER that block closes and BEFORE the `const overclaimGuard = ...` line (around line 694), add:

```javascript
  let seasonThemeBlock = '';
  try {
    const themeTimeline = JSON.parse(memory.getMeta(`seasons:${slug}`) || '[]');
    const recurring = detectRecurringTheme(themeTimeline);
    if (recurring) {
      seasonThemeBlock = `\n\nAn emotional thread that recurs across the seasons you have witnessed in this person (reference it only when a card in front of you genuinely meets it; name it plainly in your own voice; never as a list, never inflated):\n- ${recurring.fact}`;
    }
  } catch {}
```

- [ ] **Step 3: Append the block to `personaFinal`**

In `server.js`, the `personaFinal` assembly currently reads (around line 696):

```javascript
  const personaFinal = personaWithName + memoryBlock + patternBlock + prophecyBlock + overclaimGuard;
```

Change it to insert `seasonThemeBlock` after `prophecyBlock`:

```javascript
  const personaFinal = personaWithName + memoryBlock + patternBlock + prophecyBlock + seasonThemeBlock + overclaimGuard;
```

- [ ] **Step 4: Widen `overclaimGuard` to license the recurring theme**

In `server.js`, the `overclaimGuard` string (around line 694) currently contains this clause:

```javascript
you genuinely track the cards and symbols that recur for them, the patterns named above, the foretellings surfaced above, and the specific past moments surfaced to you here.
```

Change that clause to add the recurring emotional thread (so the guard licenses the new block rather than contradicting it):

```javascript
you genuinely track the cards and symbols that recur for them, the patterns named above, the foretellings surfaced above, the recurring emotional threads surfaced above, and the specific past moments surfaced to you here.
```

(Leave the rest of `overclaimGuard` unchanged — the prohibition on claiming patterns in "what they ask" still stands; a recurring emotional thread comes from their felt record, not their question topics.)

- [ ] **Step 5: Verify the full suite still passes**

Run: `node --test`
Expected: `pass 184  fail 0` (no regressions; server.js has no unit tests).

- [ ] **Step 6: Manual smoke test of the theme path**

Create `scratch-theme-smoke.js` in the project root:

```javascript
const os = require('os'), path = require('path'), fs = require('fs');
const createMemoryStore = require('./data/memory-store');
const createEmotionalSeasons = require('./data/emotional-seasons');
const { detectRecurringTheme } = createEmotionalSeasons;

const store = createMemoryStore(fs.mkdtempSync(path.join(os.tmpdir(), 'theme-smoke-')));
// Three seasons; "restlessness" recurs in two of them.
store.setMeta('seasons:matt', JSON.stringify([
  { index: 0, started_at: 0, ended_at: 0, label: 'a', valence: -1, themes: ['restlessness', 'the move'], summary: 'x' },
  { index: 1, started_at: 0, ended_at: 0, label: 'b', valence: 0, themes: ['hope'], summary: 'y' },
  { index: 2, started_at: 0, ended_at: 0, label: 'c', valence: -1, themes: ['restlessness'], summary: 'z' },
]));

const recurring = detectRecurringTheme(JSON.parse(store.getMeta('seasons:matt')));
const block = recurring
  ? `\n\nAn emotional thread that recurs across the seasons you have witnessed in this person (reference it only when a card in front of you genuinely meets it; name it plainly in your own voice; never as a list, never inflated):\n- ${recurring.fact}`
  : '';
console.log('recurring theme:', recurring && recurring.theme, '(expect restlessness)');
console.log('distinct seasons:', recurring && recurring.seasons, '(expect 2)');
console.log('--- block ---' + block);
console.log('--- checks ---');
console.log('theme is restlessness:', recurring && recurring.theme === 'restlessness');
console.log('block names the theme:', block.includes('restlessness'));
console.log('no em dashes:', !/[‒-―‘’“”]/.test(block));
```

Run: `node scratch-theme-smoke.js`
Expected: `recurring theme: restlessness`, `distinct seasons: 2`, and all three checks `true`.

- [ ] **Step 7: Delete the smoke script**

```bash
rm scratch-theme-smoke.js
```

- [ ] **Step 8: Commit**

```bash
git add server.js
git commit -m "feat(seasons): weave a recurring emotional theme into the interpretation

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage (§4):**
- `detectRecurringTheme(seasons)` pure, >= 2 seasons, theme in >= THEME_MIN_SEASONS distinct seasons, tie-break occurrences then recency, returns `{theme, seasons, fact} | null` -> Task 1. ✓
- Framed `seasonThemeBlock` appended after the prophecy/pattern blocks, reference-only-when-a-card-connects, never a list, never inflate -> Task 2 Steps 2-3. ✓
- Consume-only, no new LLM call -> Task 2 (block appended to existing personaFinal). ✓
- overclaimGuard coherence (a spec-implicit requirement surfaced during planning: the guard enumerates what she may claim) -> Task 2 Step 4. ✓
- ASCII-only -> block prose uses straight quotes/commas; smoke asserts no em dashes. ✓

**Placeholder scan:** No TBD/TODO; every code step shows complete code and exact commands with expected counts. ✓

**Type consistency:** `detectRecurringTheme(seasons) -> {theme, seasons, fact}|null` used identically in Task 1 tests, the static export, the server wiring, and the smoke script. The season-record `themes` field read here matches the field written by Slice 1's `updateSeasons`/`backfillSeasons`. `seasonThemeBlock` is defined (Task 2 Step 2) before it is referenced in `personaFinal` (Step 3). ✓
