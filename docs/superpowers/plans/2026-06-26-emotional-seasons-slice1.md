# Emotional Seasons (Slice 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Miriel a timeline of the querent's emotional "seasons" and let her reflect a drift / now-vs-then shift in the Threshold greeting.

**Architecture:** A new focused module `data/emotional-seasons.js` computes season records via an async best-effort Haiku pass (mirroring `profiles.updateLivingNote`) stored as a JSON timeline in `memory_meta`, plus a PURE `detectSeasonShift` detector (mirroring `findTemporalCallbacks`) that feeds a new greeting block. No LLM is added to the live greeting path. This is Slice 1 of 2; Slice 2 (recurring-theme reading block) is a separate later plan.

**Tech Stack:** Node.js, better-sqlite3 (via the memory store's `getMeta`/`setMeta`/`listMemories`), `node --test`.

## Global Constraints

- **Storage:** season timeline is a JSON array under `memory_meta` key `seasons:<slug>`, oldest-first. Use `store.getMeta`/`store.setMeta` only — no new table.
- **Season record shape:** `{ index:int, started_at:unix_sec, ended_at:unix_sec, label:string, valence:int(-2..2), themes:string[], summary:string }`.
- **Constants (exact):** `MIN_FEELINGS_PER_SEASON = 4`, `SEASON_WINDOW_DAYS = 30`, `SEASON_CADENCE = 8`, `SHIFT_THRESHOLD = 2`, season-surface dedup TTL = 30 days.
- **Timestamps are unix SECONDS** everywhere here (the store's `created_at` and the server's `now` are seconds — NO milliseconds conversion, unlike temporal-recall).
- **ASCII only** in all model-facing prose — no em dashes, no smart quotes (Miriel rule).
- **New params are trailing and optional**, defaulting (`seasonShift = null`), so existing callers/tests are unaffected.
- **Best-effort async:** `updateSeasons` must never throw into the reading-save path (catch internally), exactly like `updateLivingNote`.
- **Test command:** `node --test` from the project root (currently 163 passing). Targeted: `node --test tests/<file>.test.js`. Do NOT use `node --test tests/`.
- **Commit cadence:** one commit per task after its tests pass.

---

### Task 1: Season module scaffold — `listFeelings` + `detectSeasonShift` (pure)

**Files:**
- Create: `data/emotional-seasons.js`
- Test: `tests/emotional-seasons.test.js`

**Interfaces:**
- Consumes: a `store` object providing `getMeta(key)`, `setMeta(key, value)`, `listMemories(slug)` (the existing memory store / engine satisfies this).
- Produces:
  - `module.exports = function createEmotionalSeasons(store)` returning an object that will grow; in this task it returns `{ listFeelings, SEASON_CADENCE }`.
    - `listFeelings(slug) -> Array<{content, salience, created_at}>` — feeling atoms only, ascending by `created_at`.
    - `SEASON_CADENCE === 8`.
  - Static: `module.exports.detectSeasonShift = detectSeasonShift`.
    - `detectSeasonShift(seasons, now) -> { kind:'season-shift', signature, fact } | null`. Needs >= 2 seasons and a valence delta >= 2 between the latest season and the most-contrasting earlier one (tie-broken toward the more recent earlier season).

- [ ] **Step 1: Write the failing tests**

Create `tests/emotional-seasons.test.js`:

```javascript
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const createMemoryStore = require('../data/memory-store');
const createEmotionalSeasons = require('../data/emotional-seasons');
const { detectSeasonShift } = require('../data/emotional-seasons');

function tmpDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'tarot-seasons-')); }
const DAY = 86400;

function season(index, valence, label, themes, endedDaysAgo, now) {
  return { index, valence, label, themes: themes || [], summary: `${label} summary`,
           started_at: now - (endedDaysAgo + 25) * DAY, ended_at: now - endedDaysAgo * DAY };
}

test('listFeelings returns only feeling atoms, ascending by created_at', () => {
  const store = createMemoryStore(tmpDir());
  const now = store._now();
  const a = store.addMemory('matt', { type: 'feeling', content: 'older feeling', salience: 3 });
  const b = store.addMemory('matt', { type: 'feeling', content: 'newer feeling', salience: 3 });
  store.addMemory('matt', { type: 'thread', content: 'not a feeling', status: 'open', salience: 4 });
  store._db.prepare('UPDATE memories SET created_at = ? WHERE id = ?').run(now - 10 * DAY, a);
  store._db.prepare('UPDATE memories SET created_at = ? WHERE id = ?').run(now - 2 * DAY, b);
  const seasons = createEmotionalSeasons(store);
  const got = seasons.listFeelings('matt');
  assert.deepEqual(got.map(f => f.content), ['older feeling', 'newer feeling']);
});

test('detectSeasonShift returns null with fewer than 2 seasons', () => {
  const now = 1_000_000_000;
  assert.equal(detectSeasonShift([], now), null);
  assert.equal(detectSeasonShift([season(0, -2, 'a', [], 100, now)], now), null);
});

test('detectSeasonShift returns null when the valence delta is below threshold', () => {
  const now = 1_000_000_000;
  const seasons = [season(0, 0, 'flat', [], 100, now), season(1, 1, 'slightly up', [], 10, now)];
  assert.equal(detectSeasonShift(seasons, now), null);
});

test('detectSeasonShift emits a shift with correct signature when delta >= 2', () => {
  const now = 1_000_000_000;
  const seasons = [season(0, -2, 'the heavy winter', ['fear'], 120, now),
                   season(1, 2, 'the lighter spring', ['hope'], 10, now)];
  const shift = detectSeasonShift(seasons, now);
  assert.ok(shift);
  assert.equal(shift.kind, 'season-shift');
  assert.equal(shift.signature, 'season-shift:0->1');
  assert.match(shift.fact, /heavy winter/);
  assert.match(shift.fact, /lighter spring/);
});

test('detectSeasonShift picks the most-contrasting earlier season', () => {
  const now = 1_000_000_000;
  const seasons = [season(0, 1, 'mild', [], 200, now),
                   season(1, -2, 'the low', [], 120, now),
                   season(2, 2, 'now', [], 10, now)];
  const shift = detectSeasonShift(seasons, now);
  assert.equal(shift.signature, 'season-shift:1->2'); // |2-(-2)|=4 beats |2-1|=1
});

test('detectSeasonShift tie-breaks toward the more recent earlier season', () => {
  const now = 1_000_000_000;
  const seasons = [season(0, 0, 'first', [], 200, now),
                   season(1, 0, 'second', [], 100, now),
                   season(2, 2, 'now', [], 10, now)];
  const shift = detectSeasonShift(seasons, now); // both deltas == 2; pick index 1
  assert.equal(shift.signature, 'season-shift:1->2');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/emotional-seasons.test.js`
Expected: FAIL — `Cannot find module '../data/emotional-seasons'`.

- [ ] **Step 3: Create `data/emotional-seasons.js` with the pure pieces**

```javascript
'use strict';

const DAY = 86400; // seconds
const MIN_FEELINGS_PER_SEASON = 4;
const SEASON_WINDOW_DAYS = 30;
const SEASON_CADENCE = 8;
const SHIFT_THRESHOLD = 2;

function themesPhrase(themes) {
  const t = (themes || []).filter(Boolean);
  return t.length ? ` (${t.join(', ')})` : '';
}

// PURE: compare the latest season to the most-contrasting earlier one. Returns a
// fact string for Miriel to voice, or null when there is no real shift. Mirrors
// findTemporalCallbacks (pure, emits text only). `now` is unix seconds.
function detectSeasonShift(seasons, now) {
  if (!Array.isArray(seasons) || seasons.length < 2) return null;
  const latest = seasons[seasons.length - 1];
  let earlier = null;
  let bestDelta = -1;
  for (let i = 0; i < seasons.length - 1; i++) {
    const s = seasons[i];
    const delta = Math.abs((latest.valence || 0) - (s.valence || 0));
    if (delta > bestDelta || (delta === bestDelta && earlier && s.index > earlier.index)) {
      bestDelta = delta;
      earlier = s;
    }
  }
  if (!earlier || bestDelta < SHIFT_THRESHOLD) return null;
  const monthsAgo = Math.max(1, Math.round((now - earlier.ended_at) / (30 * DAY)));
  const fact =
    `About ${monthsAgo} month${monthsAgo === 1 ? '' : 's'} ago they were in "${earlier.label}"` +
    `${themesPhrase(earlier.themes)}; now they are in "${latest.label}"${themesPhrase(latest.themes)}. ` +
    `The emotional weather has shifted between these.`;
  return { kind: 'season-shift', signature: `season-shift:${earlier.index}->${latest.index}`, fact };
}

module.exports = function createEmotionalSeasons(store) {
  function listFeelings(slug) {
    return (store.listMemories(slug) || [])
      .filter(m => m.type === 'feeling')
      .map(m => ({ content: m.content, salience: m.salience, created_at: m.created_at }))
      .sort((a, b) => a.created_at - b.created_at);
  }

  return { listFeelings, SEASON_CADENCE };
};

module.exports.detectSeasonShift = detectSeasonShift;
module.exports.SEASON_CADENCE = SEASON_CADENCE;
module.exports.MIN_FEELINGS_PER_SEASON = MIN_FEELINGS_PER_SEASON;
module.exports.SEASON_WINDOW_DAYS = SEASON_WINDOW_DAYS;
module.exports.SHIFT_THRESHOLD = SHIFT_THRESHOLD;
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/emotional-seasons.test.js`
Expected: PASS — 6 tests.

- [ ] **Step 5: Run the full suite**

Run: `node --test`
Expected: `pass 169  fail 0` (163 + 6).

- [ ] **Step 6: Commit**

```bash
git add data/emotional-seasons.js tests/emotional-seasons.test.js
git commit -m "feat(seasons): emotional-seasons module scaffold + detectSeasonShift detector

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: `updateSeasons` + `backfillSeasons` (async Haiku passes)

**Files:**
- Modify: `data/emotional-seasons.js`
- Test: `tests/emotional-seasons.test.js`

**Interfaces:**
- Consumes: `store.getMeta`/`store.setMeta`/`store.listMemories`; a `callLLM(system, user, maxTokens, model)` function (async, returns a string).
- Produces (added to the object returned by `createEmotionalSeasons`):
  - `async updateSeasons(slug, callLLM) -> { added: 0|1 }` — characterizes feelings newer than the last season's `ended_at` into ONE new appended record, only when there are >= 4 such feelings. Best-effort: never throws.
  - `async backfillSeasons(slug, callLLM) -> { skipped:true } | { added:int }` — one-time (flag `seasons_backfilled:<slug>`), buckets historical feelings into <=30-day windows and characterizes each window of >= 4 feelings.

- [ ] **Step 1: Write the failing tests**

Append to `tests/emotional-seasons.test.js`:

```javascript
// A fake callLLM returning a fixed season JSON; records how many times it is called.
function fakeLLM(record) {
  return async () => {
    if (record) record.calls++;
    return JSON.stringify({ label: 'the heavy winter', valence: -2, themes: ['fear', 'the move'], summary: 'You carry a weight right now.' });
  };
}

function addFeeling(store, slug, content, daysAgo, now) {
  const id = store.addMemory(slug, { type: 'feeling', content, salience: 3 });
  store._db.prepare('UPDATE memories SET created_at = ? WHERE id = ?').run(now - daysAgo * DAY, id);
  return id;
}

test('updateSeasons appends one record when >= 4 new feelings exist', async () => {
  const store = createMemoryStore(tmpDir());
  const now = store._now();
  for (let i = 0; i < 4; i++) addFeeling(store, 'matt', `feeling ${i}`, 20 - i, now);
  const seasons = createEmotionalSeasons(store);
  const res = await seasons.updateSeasons('matt', fakeLLM());
  assert.equal(res.added, 1);
  const timeline = JSON.parse(store.getMeta('seasons:matt'));
  assert.equal(timeline.length, 1);
  assert.equal(timeline[0].index, 0);
  assert.equal(timeline[0].valence, -2);
  assert.deepEqual(timeline[0].themes, ['fear', 'the move']);
});

test('updateSeasons does nothing with fewer than 4 new feelings', async () => {
  const store = createMemoryStore(tmpDir());
  const now = store._now();
  for (let i = 0; i < 3; i++) addFeeling(store, 'matt', `feeling ${i}`, 10 - i, now);
  const seasons = createEmotionalSeasons(store);
  const res = await seasons.updateSeasons('matt', fakeLLM());
  assert.equal(res.added, 0);
  assert.equal(store.getMeta('seasons:matt'), null);
});

test('updateSeasons only considers feelings newer than the last season ended_at', async () => {
  const store = createMemoryStore(tmpDir());
  const now = store._now();
  // Pre-seed a timeline whose last season ended 5 days ago.
  store.setMeta('seasons:matt', JSON.stringify([{ index: 0, started_at: now - 40 * DAY, ended_at: now - 5 * DAY, label: 'old', valence: 0, themes: [], summary: 'x' }]));
  // 3 feelings AFTER the window end -> not enough -> no new record.
  for (let i = 0; i < 3; i++) addFeeling(store, 'matt', `recent ${i}`, 4 - i, now);
  const seasons = createEmotionalSeasons(store);
  assert.equal((await seasons.updateSeasons('matt', fakeLLM())).added, 0);
});

test('updateSeasons is best-effort: a callLLM throw leaves the timeline unchanged', async () => {
  const store = createMemoryStore(tmpDir());
  const now = store._now();
  for (let i = 0; i < 4; i++) addFeeling(store, 'matt', `feeling ${i}`, 20 - i, now);
  const seasons = createEmotionalSeasons(store);
  const throwing = async () => { throw new Error('llm down'); };
  const res = await seasons.updateSeasons('matt', throwing);
  assert.equal(res.added, 0);
  assert.equal(store.getMeta('seasons:matt'), null);
});

test('backfillSeasons buckets history into windows and is idempotent', async () => {
  const store = createMemoryStore(tmpDir());
  const now = store._now();
  // Window A ~around 120 days ago (4 feelings within 30d), Window B ~recent (4 feelings).
  for (let i = 0; i < 4; i++) addFeeling(store, 'matt', `old ${i}`, 120 - i, now);
  for (let i = 0; i < 4; i++) addFeeling(store, 'matt', `new ${i}`, 10 - i, now);
  const seasons = createEmotionalSeasons(store);
  const rec = { calls: 0 };
  const res = await seasons.backfillSeasons('matt', fakeLLM(rec));
  assert.equal(res.added, 2);
  assert.equal(rec.calls, 2);
  const timeline = JSON.parse(store.getMeta('seasons:matt'));
  assert.equal(timeline.length, 2);
  assert.equal(timeline[0].index, 0);
  assert.equal(timeline[1].index, 1);
  // Idempotent: a second run skips.
  const again = await seasons.backfillSeasons('matt', fakeLLM(rec));
  assert.deepEqual(again, { skipped: true });
  assert.equal(rec.calls, 2);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/emotional-seasons.test.js`
Expected: FAIL — `seasons.updateSeasons is not a function`.

- [ ] **Step 3: Add the Haiku characterization + the two functions**

In `data/emotional-seasons.js`, add the system prompt, prompt builder, and parser ABOVE the `module.exports = function...` line (module scope):

```javascript
const SEASON_SYSTEM =
  'You are Miriel, an experienced tarot reader keeping a private record of the emotional ' +
  'seasons of the person you read for. Given the things they have felt over one stretch of ' +
  'time, characterize that season. Respond with ONLY a JSON object: ' +
  '{"label": short evocative name, "valence": integer from -2 (heavy) to 2 (light), ' +
  '"themes": array of 1-4 short lowercase words, "summary": one or two sentences in the ' +
  'second person ("you")}. ASCII only. No em dashes. No text outside the JSON.';

function buildSeasonPrompt(feelings) {
  const lines = feelings.map(f => `- ${f.content}`).join('\n');
  return `Things they have felt during one stretch of time:\n${lines}\n\n` +
         `Characterize this emotional season now. Return only the JSON object.`;
}

function parseSeasonOutput(raw) {
  if (!raw) return null;
  const s = String(raw);
  const a = s.indexOf('{');
  const b = s.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  let obj;
  try { obj = JSON.parse(s.slice(a, b + 1)); } catch { return null; }
  if (!obj || typeof obj !== 'object') return null;
  const label = typeof obj.label === 'string' ? obj.label.trim() : '';
  const summary = typeof obj.summary === 'string' ? obj.summary.trim() : '';
  if (!label || !summary) return null;
  let valence = parseInt(obj.valence, 10);
  if (Number.isNaN(valence)) valence = 0;
  valence = Math.max(-2, Math.min(2, valence));
  const themes = Array.isArray(obj.themes)
    ? obj.themes.filter(t => typeof t === 'string' && t.trim()).map(t => t.trim().toLowerCase()).slice(0, 4)
    : [];
  return { label, valence, themes, summary };
}
```

Inside `createEmotionalSeasons`, add timeline helpers and the two functions, and export them:

```javascript
  function readTimeline(slug) {
    try { return JSON.parse(store.getMeta(`seasons:${slug}`) || '[]'); } catch { return []; }
  }
  function writeTimeline(slug, timeline) {
    store.setMeta(`seasons:${slug}`, JSON.stringify(timeline));
  }

  // Async, best-effort. Characterizes feelings newer than the last season's
  // ended_at into ONE new record. Never throws into the caller (mirrors
  // profiles.updateLivingNote). Cadence gating happens at the call site.
  async function updateSeasons(slug, callLLM) {
    try {
      const timeline = readTimeline(slug);
      const windowStart = timeline.length ? timeline[timeline.length - 1].ended_at : 0;
      const feelings = listFeelings(slug).filter(f => f.created_at > windowStart);
      if (feelings.length < MIN_FEELINGS_PER_SEASON) return { added: 0 };
      const raw = await callLLM(SEASON_SYSTEM, buildSeasonPrompt(feelings), 300, 'claude-haiku-4-5-20251001');
      const parsed = parseSeasonOutput(raw);
      if (!parsed) return { added: 0 };
      timeline.push({ index: timeline.length, started_at: feelings[0].created_at, ended_at: feelings[feelings.length - 1].created_at, ...parsed });
      writeTimeline(slug, timeline);
      return { added: 1 };
    } catch {
      return { added: 0 };
    }
  }

  // Group consecutive feelings (ascending) into windows of at most windowDays,
  // measured from each window's first feeling.
  function bucketWindows(feelings, windowDays) {
    const span = windowDays * DAY;
    const windows = [];
    let cur = [];
    let start = null;
    for (const f of feelings) {
      if (start === null) { start = f.created_at; cur = [f]; continue; }
      if (f.created_at - start <= span) { cur.push(f); }
      else { windows.push(cur); cur = [f]; start = f.created_at; }
    }
    if (cur.length) windows.push(cur);
    return windows;
  }

  // One-time, idempotent. Lets a callLLM throw propagate so the flag is never set
  // and the next boot retries from scratch (same contract as memory backfill()).
  async function backfillSeasons(slug, callLLM) {
    if (store.getMeta(`seasons_backfilled:${slug}`)) return { skipped: true };
    if (readTimeline(slug).length) { store.setMeta(`seasons_backfilled:${slug}`, '1'); return { skipped: true }; }
    const windows = bucketWindows(listFeelings(slug), SEASON_WINDOW_DAYS);
    const timeline = [];
    for (const w of windows) {
      if (w.length < MIN_FEELINGS_PER_SEASON) continue;
      const raw = await callLLM(SEASON_SYSTEM, buildSeasonPrompt(w), 300, 'claude-haiku-4-5-20251001');
      const parsed = parseSeasonOutput(raw);
      if (!parsed) continue;
      timeline.push({ index: timeline.length, started_at: w[0].created_at, ended_at: w[w.length - 1].created_at, ...parsed });
    }
    if (timeline.length) writeTimeline(slug, timeline);
    store.setMeta(`seasons_backfilled:${slug}`, '1');
    return { added: timeline.length };
  }
```

Update the returned object to include the new functions:

```javascript
  return { listFeelings, updateSeasons, backfillSeasons, SEASON_CADENCE };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/emotional-seasons.test.js`
Expected: PASS — 11 tests (6 from Task 1 + 5 new).

- [ ] **Step 5: Run the full suite**

Run: `node --test`
Expected: `pass 174  fail 0` (169 + 5).

- [ ] **Step 6: Commit**

```bash
git add data/emotional-seasons.js tests/emotional-seasons.test.js
git commit -m "feat(seasons): updateSeasons + backfillSeasons Haiku characterization

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Greeting integration — `seasonShift` param + block in `memory-engine.js`

**Files:**
- Modify: `data/memory-engine.js`
- Test: `tests/memory-engine.test.js`

**Interfaces:**
- Consumes: a `seasonShift` object `{ kind, signature, fact } | null` (from `detectSeasonShift`).
- Produces:
  - `decideThresholdMode(lastVisitTs, threads, now, gapDays, predictions, temporalCallbacks, dormantThreads = [], seasonShift = null)` — a season shift alone can drive a greeting.
  - `buildGreetingPrompt(mode, threads, gapDays, predictions, temporalCallbacks, timeOfDay, dormantThreads = [], seasonShift = null)` — emits a season block when `seasonShift` is present.

Note: these two functions currently end with the trailing `dormantThreads = []` parameter (added by the dormant-thread feature). You are adding `seasonShift = null` AFTER it.

- [ ] **Step 1: Write the failing tests**

Add to `tests/memory-engine.test.js` (near the other `decideThresholdMode`/`buildGreetingPrompt` tests):

```javascript
test('decideThresholdMode triggers on a season shift alone', () => {
  const { decideThresholdMode } = require('../data/memory-engine');
  const now = 1000000;
  const shift = { kind: 'season-shift', signature: 'season-shift:0->1', fact: 'weather shifted' };
  assert.equal(decideThresholdMode(now, [], now, undefined, [], [], [], shift), 'gentle');
  assert.equal(decideThresholdMode(now - 5 * 86400, [], now, undefined, [], [], [], shift), 'reunion');
  assert.equal(decideThresholdMode(now, [], now, undefined, [], [], [], null), 'none');
});

test('buildGreetingPrompt emits the season-shift block with its fact', () => {
  const { buildGreetingPrompt } = require('../data/memory-engine');
  const shift = { kind: 'season-shift', signature: 'season-shift:0->1',
    fact: 'About 4 months ago they were in "the heavy winter"; now they are in "the lighter spring".' };
  const p = buildGreetingPrompt('reunion', [], 90, [], [], '', [], shift);
  assert.match(p, /heavy winter/);
  assert.match(p, /lighter spring/);
  assert.ok(!/[‒-―‘’“”]/.test(p)); // no em dashes / smart quotes
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/memory-engine.test.js`
Expected: FAIL — season fact text absent from the prompt; mode not driven by shift.

- [ ] **Step 3: Add `seasonShift` to `decideThresholdMode`**

In `data/memory-engine.js`, replace the `decideThresholdMode` function. It currently reads:

```javascript
function decideThresholdMode(lastVisitTs, threads, now, gapDays = REUNION_GAP_DAYS, predictions = [], temporalCallbacks = [], dormantThreads = []) {
  const hasMaterial = (threads && threads.length) || (predictions && predictions.length)
    || (temporalCallbacks && temporalCallbacks.length) || (dormantThreads && dormantThreads.length);
  if (!hasMaterial) return 'none';
  const gap = (lastVisitTs == null) ? Infinity : (now - Number(lastVisitTs)) / 86400;
  return gap >= gapDays ? 'reunion' : 'gentle';
}
```

Replace with (adds the trailing param and the `seasonShift` clause):

```javascript
function decideThresholdMode(lastVisitTs, threads, now, gapDays = REUNION_GAP_DAYS, predictions = [], temporalCallbacks = [], dormantThreads = [], seasonShift = null) {
  const hasMaterial = (threads && threads.length) || (predictions && predictions.length)
    || (temporalCallbacks && temporalCallbacks.length) || (dormantThreads && dormantThreads.length)
    || !!seasonShift;
  if (!hasMaterial) return 'none';
  const gap = (lastVisitTs == null) ? Infinity : (now - Number(lastVisitTs)) / 86400;
  return gap >= gapDays ? 'reunion' : 'gentle';
}
```

- [ ] **Step 4: Add `seasonShift` to `buildGreetingPrompt`**

In `data/memory-engine.js`, change the `buildGreetingPrompt` signature (it currently ends `..., timeOfDay = '', dormantThreads = []`) to add the trailing param:

```javascript
function buildGreetingPrompt(mode, threads, gapDays, predictions = [], temporalCallbacks = [], timeOfDay = '', dormantThreads = [], seasonShift = null) {
```

Immediately after the `dormantBlock` definition (added by the dormant feature), add the season block:

```javascript
  const seasonBlock = seasonShift
    ? `The emotional weather you have watched move through them over time:\n${seasonShift.fact}\n\n` +
      `If it feels true and kind, reflect this change back to them in your own voice, gently and specifically, ` +
      `as someone who has sat with them across these seasons. Notice it; do not diagnose or explain it.`
    : '';
```

Then add `seasonBlock` to the `material` join. It currently reads:

```javascript
  const material = [temporalBlock, threadBlock, dormantBlock, predBlock, timeHint].filter(Boolean).join('\n\n');
```

Change to:

```javascript
  const material = [temporalBlock, threadBlock, dormantBlock, seasonBlock, predBlock, timeHint].filter(Boolean).join('\n\n');
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test tests/memory-engine.test.js`
Expected: PASS — existing greeting tests plus the 2 new ones.

- [ ] **Step 6: Run the full suite**

Run: `node --test`
Expected: `pass 176  fail 0` (174 + 2).

- [ ] **Step 7: Commit**

```bash
git add data/memory-engine.js tests/memory-engine.test.js
git commit -m "feat(seasons): season-shift greeting block + decideThresholdMode trigger

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Server wiring — instantiate, compute on cadence, surface in greeting

**Files:**
- Modify: `server.js`

**Interfaces:**
- Consumes: `createEmotionalSeasons` (Task 1/2), `detectSeasonShift` (Task 1), `decideThresholdMode`/`buildGreetingPrompt` with their new trailing `seasonShift` param (Task 3).
- Produces: greeting responses that may include a season-shift reflection; season records computed on cadence and back-filled at boot.

No unit-test harness exists for the HTTP handler; verified by the full suite staying green plus a manual smoke script (then deleted).

- [ ] **Step 1: Instantiate the seasons module**

In `server.js`, after the memory engine is created (the line `const memory = createMemoryEngine(DATA_DIR);`, around line 20), add:

```javascript
const createEmotionalSeasons = require('./data/emotional-seasons');
const seasons = createEmotionalSeasons(memory);
const { detectSeasonShift } = createEmotionalSeasons;
```

(The memory engine exposes `getMeta`/`setMeta`/`listMemories`, which is all the module needs.)

- [ ] **Step 2: Back-fill seasons at boot**

In `server.js`, inside the existing `setImmediate(() => { for (const r of loadReaders()) { ... } })` block (around lines 100-106), add a second call after the `memory.backfill(...)` chain, inside the same loop:

```javascript
    seasons.backfillSeasons(r.slug, callLLM)
      .then(res => { if (res && res.added) console.log(`  + Emotional seasons back-filled for ${r.slug} (${res.added})`); })
      .catch(err => console.warn(`  ⚠  Season back-fill failed for ${r.slug}:`, err.message));
```

- [ ] **Step 3: Compute a season on cadence after a reading save**

In `server.js`, in `POST /api/readings`, after the `profiles.updateLivingNote(...)` fire-and-forget block (around line 289), add:

```javascript
    if (totalReadings % seasons.SEASON_CADENCE === 0) {
      seasons.updateSeasons(slug, callLLM)
        .then(res => { if (res && res.added) console.log(`  + Emotional season recorded for ${slug}`); })
        .catch(err => console.warn('  ⚠  Season update failed:', err.message));
    }
```

(`totalReadings` is already in scope here, computed at line 279.)

- [ ] **Step 4: Detect + dedup the season shift in the greeting handler**

In `server.js`, in `GET /api/threshold`, after the temporal-callbacks block (the line `const temporalCallbacks = filterSurfaced(...).slice(0, 1);`, around line 1064), add:

```javascript
    let seasonSurfaced = {};
    try { seasonSurfaced = JSON.parse(memory.getMeta(`season_surfaced:${slug}`) || '{}'); } catch {}
    const rawShift = detectSeasonShift(JSON.parse(memory.getMeta(`seasons:${slug}`) || '[]'), now);
    const SEASON_TTL_S = 30 * 86400;
    const seasonShift = (rawShift && !(seasonSurfaced[rawShift.signature] && (now - seasonSurfaced[rawShift.signature]) < SEASON_TTL_S))
      ? rawShift : null;
```

- [ ] **Step 5: Pass `seasonShift` into the mode decision and the greeting prompt**

In `server.js`, update the `decideThresholdMode` call (around line 1066). It currently reads:

```javascript
    const mode      = decideThresholdMode(lastVisit, freshThreads, now, REUNION_GAP_DAYS, predictions, temporalCallbacks, dormant);
```

Change to:

```javascript
    const mode      = decideThresholdMode(lastVisit, freshThreads, now, REUNION_GAP_DAYS, predictions, temporalCallbacks, dormant, seasonShift);
```

And update the `buildGreetingPrompt` call (around line 1091). It currently reads:

```javascript
      greeting = await callLLM(persona, buildGreetingPrompt(mode, shownThreads, gapDays, shownPredictions, temporalCallbacks, phase, shownDormant), 700, 'claude-sonnet-4-6');
```

Change to:

```javascript
      greeting = await callLLM(persona, buildGreetingPrompt(mode, shownThreads, gapDays, shownPredictions, temporalCallbacks, phase, shownDormant, seasonShift), 700, 'claude-sonnet-4-6');
```

- [ ] **Step 6: Persist the season-surfaced dedup after a successful greeting**

In `server.js`, after the `temporalCallbacks` persistence block (the `if (temporalCallbacks.length) { ... }` ending around line 1110) and before `memory.setMeta(\`last_visit:${slug}\`, ...)`, add:

```javascript
    if (seasonShift) {
      const ttlS = 30 * 86400;
      for (const sig of Object.keys(seasonSurfaced)) {
        if (now - seasonSurfaced[sig] >= ttlS) delete seasonSurfaced[sig];
      }
      seasonSurfaced[seasonShift.signature] = now;
      memory.setMeta(`season_surfaced:${slug}`, JSON.stringify(seasonSurfaced));
    }
```

- [ ] **Step 7: Verify the full suite still passes**

Run: `node --test`
Expected: `pass 176  fail 0` (no regressions; server.js has no unit tests).

- [ ] **Step 8: Manual smoke test of the season path**

Create `scratch-seasons-smoke.js` in the project root:

```javascript
const os = require('os'), path = require('path'), fs = require('fs');
const createMemoryStore = require('./data/memory-store');
const createEmotionalSeasons = require('./data/emotional-seasons');
const { detectSeasonShift } = createEmotionalSeasons;
const { decideThresholdMode, buildGreetingPrompt, REUNION_GAP_DAYS } = require('./data/memory-engine');

const DAY = 86400;
const store = createMemoryStore(fs.mkdtempSync(path.join(os.tmpdir(), 'seasons-smoke-')));
const seasons = createEmotionalSeasons(store);
const now = store._now();

// Two clearly contrasting seasons in the timeline.
store.setMeta('seasons:matt', JSON.stringify([
  { index: 0, started_at: now - 150 * DAY, ended_at: now - 120 * DAY, label: 'the heavy winter', valence: -2, themes: ['fear', 'the move'], summary: 'You carried a weight.' },
  { index: 1, started_at: now - 30 * DAY, ended_at: now - 3 * DAY, label: 'the lighter spring', valence: 2, themes: ['hope'], summary: 'Something has eased.' },
]));

const shift = detectSeasonShift(JSON.parse(store.getMeta('seasons:matt')), now);
console.log('shift signature:', shift && shift.signature, '(expect season-shift:0->1)');
const mode = decideThresholdMode(now - 30 * DAY, [], now, REUNION_GAP_DAYS, [], [], [], shift);
const prompt = buildGreetingPrompt(mode, [], 30, [], [], '', [], shift);
console.log('mode:', mode, '(expect reunion)');
console.log('--- greeting prompt ---\n' + prompt);
console.log('--- checks ---');
console.log('has shift:', !!shift);
console.log('mentions both seasons:', prompt.includes('heavy winter') && prompt.includes('lighter spring'));
console.log('no em dashes:', !/[‒-―‘’“”]/.test(prompt));
```

Run: `node scratch-seasons-smoke.js`
Expected: `shift signature: season-shift:0->1`, `mode: reunion`, and all three checks `true`; the printed prompt contains the season-shift reflection instruction with both season labels.

- [ ] **Step 9: Delete the smoke script**

```bash
rm scratch-seasons-smoke.js
```

- [ ] **Step 10: Commit**

```bash
git add server.js
git commit -m "feat(seasons): compute seasons on cadence + surface the shift in the greeting

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage (Slice 1 scope):**
- §1 season record shape -> Task 2 (record assembled in `updateSeasons`/`backfillSeasons`); fields match the Global Constraints. ✓
- §2 `data/emotional-seasons.js`: `listFeelings` (Task 1), `updateSeasons` + `backfillSeasons` (Task 2). ✓
- §3 `detectSeasonShift` (Task 1) + greeting wiring (Task 3 prompt/mode, Task 4 server) + `season_surfaced` dedup (Task 4 Steps 4/6). ✓
- §5 ASCII-only, async-only LLM (SEASON_SYSTEM bans em dashes; characterization is fire-and-forget; no LLM added to greeting path). ✓
- §6 testing: pure detector + listFeelings + updateSeasons/backfill tests (Tasks 1-2), greeting prompt tests (Task 3), manual smoke (Task 4). ✓
- §4 recurring theme is explicitly Slice 2 — correctly NOT in this plan. ✓

**Placeholder scan:** No TBD/TODO; every code step shows complete code and exact commands with expected counts. ✓

**Type consistency:** `createEmotionalSeasons(store)` and its returned `{ listFeelings, updateSeasons, backfillSeasons, SEASON_CADENCE }` used identically in tests and server. `detectSeasonShift(seasons, now)` signature consistent across module, tests, and server. The season-record fields (`index/started_at/ended_at/label/valence/themes/summary`) are identical in `updateSeasons`, `backfillSeasons`, the detector, and the smoke script. `seasonShift`/`shownDormant` trailing-arg order in `decideThresholdMode` (`..., dormantThreads, seasonShift`) and `buildGreetingPrompt` (`..., dormantThreads, seasonShift`) matches between Task 3 definitions and Task 4 call sites. ✓
