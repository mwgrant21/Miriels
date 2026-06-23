# Temporal Callbacks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Miriel resonant time-awareness — anniversaries, elapsed-since-last, seasonal echoes, milestones — surfaced (rarely) through the Threshold welcome in her own voice.

**Architecture:** A pure detector module (`data/temporal-recall.js`) computes scored temporal candidates from the reader's readings + last-visit; a pure dedup filter removes recently-surfaced ones. `/api/threshold` runs the detector, selects the strongest, and passes it into the (backward-compatibly extended) `decideThresholdMode` / `buildGreetingPrompt` so the welcome can reference it; surfaced signatures are recorded in a `temporal_surfaced` meta. No SQL schema change.

**Tech Stack:** Node/Express; pure logic in `data/temporal-recall.js`; tests via `node --test tests/*.test.js`.

**Verification:** The detector + dedup are pure and unit-tested (TDD) with seeded readings and a fixed `now`. Engine signature change gets a unit test. Server wiring + greeting prose verified by a seeded sample read. Regression suite stays green.

**Branch:** `temporal-callbacks` (created; spec committed there).

---

## File Structure
- **Create** `data/temporal-recall.js` — `findTemporalCallbacks(...)` + `filterSurfaced(...)` (pure).
- **Create** `tests/temporal-recall.test.js` — unit tests.
- **Modify** `data/memory-engine.js` — extend `decideThresholdMode` + `buildGreetingPrompt` with an optional `temporalCallbacks` arg.
- **Modify** `tests/` (memory-engine test if present, else within temporal test) — unit test the decideThresholdMode change.
- **Modify** `server.js` — wire the detector into `/api/threshold` + record surfaced signatures.

---

## Task 1: Temporal detector module (TDD)

**Files:** Create `data/temporal-recall.js`; Create `tests/temporal-recall.test.js`

- [ ] **Step 1: Write the failing tests**

Create `tests/temporal-recall.test.js`:
```javascript
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { findTemporalCallbacks, filterSurfaced } = require('../data/temporal-recall');

const DAY = 86400000;
// Fixed "now": 2026-06-20T12:00:00Z
const NOW = Date.UTC(2026, 5, 20, 12, 0, 0);
function daysAgo(n) { return NOW - n * DAY; }
function reading(ts, extra = {}) {
  return { timestamp: ts, id: extra.id || String(ts), question: extra.question || 'q', cards: extra.cards || [{ name: 'The Tower' }], date: extra.date || 'somedate' };
}

test('anniversary: a reading ~1 year ago today yields a 1y anniversary candidate', () => {
  const oneYear = reading(daysAgo(365), { id: 'r1', question: 'should I leave the job?' });
  const out = findTemporalCallbacks({ readings: [oneYear], lastVisitTs: daysAgo(2), now: NOW });
  const anniv = out.find(c => c.kind === 'anniversary');
  assert.ok(anniv, 'anniversary candidate present');
  assert.match(anniv.signature, /^anniversary:1y:r1$/);
  assert.match(anniv.fact, /should I leave the job/);
});

test('anniversary window: 10 days off does NOT match', () => {
  const off = reading(daysAgo(365 - 10), { id: 'r2' });
  const out = findTemporalCallbacks({ readings: [off], lastVisitTs: daysAgo(1), now: NOW });
  assert.equal(out.find(c => c.kind === 'anniversary'), undefined);
});

test('elapsed: a long gap since last visit yields an elapsed candidate', () => {
  const out = findTemporalCallbacks({ readings: [reading(daysAgo(400))], lastVisitTs: daysAgo(90), now: NOW });
  const el = out.find(c => c.kind === 'elapsed');
  assert.ok(el, 'elapsed candidate present');
  assert.match(el.signature, /^elapsed:/);
});

test('elapsed: a short gap (3 days) yields NO elapsed candidate', () => {
  const out = findTemporalCallbacks({ readings: [reading(daysAgo(400))], lastVisitTs: daysAgo(3), now: NOW });
  assert.equal(out.find(c => c.kind === 'elapsed'), undefined);
});

test('milestone: reading count at a round 50 yields a milestone candidate', () => {
  const readings = Array.from({ length: 100 }, (_, i) => reading(daysAgo(500 - i * 3), { id: 'm' + i }));
  const out = findTemporalCallbacks({ readings, lastVisitTs: daysAgo(1), now: NOW });
  const ms = out.find(c => c.kind === 'milestone');
  assert.ok(ms, 'milestone present at count 100');
  assert.match(ms.signature, /milestone:count:100/);
});

test('ordinary visit with no matches returns []', () => {
  const out = findTemporalCallbacks({ readings: [reading(daysAgo(200)), reading(daysAgo(5))], lastVisitTs: daysAgo(2), now: NOW });
  assert.deepEqual(out, []);
});

test('candidates are sorted strongest-first', () => {
  const readings = [reading(daysAgo(365), { id: 'a' })]; // 1y anniversary (strong)
  const out = findTemporalCallbacks({ readings, lastVisitTs: daysAgo(90), now: NOW }); // + long elapsed
  assert.ok(out.length >= 2);
  for (let i = 1; i < out.length; i++) assert.ok(out[i - 1].strength >= out[i].strength);
});

test('filterSurfaced drops candidates whose signature was recently surfaced', () => {
  const cands = [{ kind: 'milestone', strength: 4, signature: 'milestone:count:100', fact: 'x' }];
  const surfaced = { 'milestone:count:100': NOW - 2 * DAY };
  assert.deepEqual(filterSurfaced(cands, surfaced, NOW, 30), []);
  // a stale entry (older than ttl) does NOT filter
  const stale = { 'milestone:count:100': NOW - 60 * DAY };
  assert.equal(filterSurfaced(cands, stale, NOW, 30).length, 1);
});
```

- [ ] **Step 2: Run, verify failure**

Run: `node --test tests/temporal-recall.test.js`
Expected: FAIL — `Cannot find module '../data/temporal-recall'`.

- [ ] **Step 3: Implement `data/temporal-recall.js`**

```javascript
'use strict';

const DAY = 86400000; // ms

// True when |age - target| <= window (all ms).
function near(age, target, windowMs) { return Math.abs(age - target) <= windowMs; }

function cardNames(r) {
  return (r.cards || []).map(c => c.name).filter(Boolean).join(', ') || 'the cards';
}

function describeGap(days) {
  if (days >= 330) return 'a year';
  if (days >= 60)  return `${Math.round(days / 30)} months`;
  if (days >= 21)  return `${Math.round(days / 7)} weeks`;
  return `${Math.round(days)} days`;
}

// Add whole months to a ms timestamp (calendar-aware), return ms.
function addMonths(ts, months) {
  const d = new Date(ts);
  d.setMonth(d.getMonth() + months);
  return d.getTime();
}

/**
 * Pure: compute resonant temporal callback candidates for a reader at `now`.
 * @param {{readings: Array, lastVisitTs: number|null, now: number}} args
 * @returns {Array<{kind,strength,signature,fact,ref?}>} sorted strongest-first
 */
function findTemporalCallbacks({ readings, lastVisitTs, now }) {
  const list = (Array.isArray(readings) ? readings : []).filter(r => r && typeof r.timestamp === 'number');
  const count = list.length;
  const out = [];
  const ANNIV_WINDOW = 3 * DAY;

  // ── Anniversaries (1 year strongest, then 1 month) ──
  for (const r of list) {
    const age = now - r.timestamp;
    if (age <= 0) continue;
    if (near(age, 365 * DAY, ANNIV_WINDOW)) {
      out.push({ kind: 'anniversary', strength: 5, signature: `anniversary:1y:${r.id}`,
        fact: `One year ago today they asked: "${r.question || '(no question)'}" (${cardNames(r)}).`,
        ref: { date: r.date, question: r.question, cards: r.cards } });
    } else if (near(age, 30 * DAY, ANNIV_WINDOW)) {
      out.push({ kind: 'anniversary', strength: 3, signature: `anniversary:1m:${r.id}`,
        fact: `A month ago they asked: "${r.question || '(no question)'}" (${cardNames(r)}).`,
        ref: { date: r.date, question: r.question, cards: r.cards } });
    }
  }

  // ── Elapsed since last visit (only notably long gaps) ──
  if (lastVisitTs != null) {
    const gapDays = (now - Number(lastVisitTs)) / DAY;
    if (gapDays >= 21) {
      out.push({ kind: 'elapsed', strength: Math.min(5, 3 + Math.floor(gapDays / 30)),
        signature: `elapsed:${Math.round(gapDays)}d`,
        fact: `It has been about ${describeGap(gapDays)} since they last sat with you.` });
    }
  }

  // ── Seasonal echo: same calendar month, a prior year, not already a 1y anniversary ──
  const nowD = new Date(now);
  const nowMonth = nowD.getMonth();
  const nowYear = nowD.getFullYear();
  for (const r of list) {
    const d = new Date(r.timestamp);
    const age = now - r.timestamp;
    if (d.getMonth() === nowMonth && d.getFullYear() < nowYear && !near(age, 365 * DAY, ANNIV_WINDOW)) {
      out.push({ kind: 'seasonal', strength: 2, signature: `seasonal:${d.getFullYear()}:${r.id}`,
        fact: `Around this time ${nowYear - d.getFullYear()} year${nowYear - d.getFullYear() > 1 ? 's' : ''} ago they asked: "${r.question || '(no question)'}" (${cardNames(r)}).`,
        ref: { date: r.date, question: r.question, cards: r.cards } });
      break; // at most one seasonal echo
    }
  }

  // ── Milestones ──
  if (count > 0 && count % 50 === 0) {
    out.push({ kind: 'milestone', strength: 4, signature: `milestone:count:${count}`,
      fact: `This is around their ${count}th reading with you.` });
  }
  if (count > 0) {
    const firstTs = Math.min(...list.map(r => r.timestamp));
    for (const m of [6, 12, 24, 36, 48]) {
      if (near(now - addMonths(firstTs, m), 0, ANNIV_WINDOW)) {
        const years = m % 12 === 0 ? `${m / 12} year${m / 12 > 1 ? 's' : ''}` : `${m} months`;
        out.push({ kind: 'milestone', strength: 4, signature: `milestone:met:${m}m`,
          fact: `It has been ${years} since they first sat down with you.` });
        break;
      }
    }
  }

  out.sort((a, b) => b.strength - a.strength);
  return out;
}

/**
 * Pure: drop candidates whose signature was surfaced within ttlDays.
 * @param {Array} candidates
 * @param {Object} surfacedMap  signature -> ms timestamp last surfaced
 * @param {number} now ms
 * @param {number} ttlDays
 */
function filterSurfaced(candidates, surfacedMap, now, ttlDays) {
  const map = surfacedMap || {};
  const ttl = ttlDays * DAY;
  return (candidates || []).filter(c => {
    const last = map[c.signature];
    return !(last && (now - last) < ttl);
  });
}

module.exports = { findTemporalCallbacks, filterSurfaced };
```

- [ ] **Step 4: Run tests, verify pass**

Run: `node --test tests/temporal-recall.test.js`
Expected: PASS (all). Then `node --test tests/*.test.js` → full suite still green.

- [ ] **Step 5: Commit**
```bash
git add data/temporal-recall.js tests/temporal-recall.test.js
git commit -m "feat(memory): temporal callback detector + dedup (pure, TDD)"
```

---

## Task 2: Extend the threshold/greeting engine (TDD)

**Files:** Modify `data/memory-engine.js`; Test in `tests/temporal-recall.test.js` (or a memory-engine test file if one exists)

- [ ] **Step 1: Write failing test for decideThresholdMode**

Add to `tests/temporal-recall.test.js`:
```javascript
const engine = require('../data/memory-engine');

test('decideThresholdMode fires on a temporal callback even with no threads/predictions', () => {
  const cb = [{ kind: 'anniversary', strength: 5, signature: 'x', fact: 'f' }];
  // no threads, no predictions, but a callback present, long gap -> reunion
  assert.equal(engine.decideThresholdMode(NOW - 90 * DAY, [], NOW, 14, [], cb), 'reunion');
  // nothing at all -> none
  assert.equal(engine.decideThresholdMode(NOW - 90 * DAY, [], NOW, 14, [], []), 'none');
});
```

- [ ] **Step 2: Run, verify failure**

Run: `node --test tests/temporal-recall.test.js`
Expected: FAIL — `decideThresholdMode` ignores the 6th arg (returns 'none' for the first assertion).

- [ ] **Step 3: Extend the two functions**

In `data/memory-engine.js`, change the `decideThresholdMode` signature/body:
FIND:
```javascript
function decideThresholdMode(lastVisitTs, threads, now, gapDays = REUNION_GAP_DAYS, predictions = []) {
  const hasMaterial = (threads && threads.length) || (predictions && predictions.length);
  if (!hasMaterial) return 'none';
  const gap = (lastVisitTs == null) ? Infinity : (now - Number(lastVisitTs)) / 86400;
  return gap >= gapDays ? 'reunion' : 'gentle';
}
```
REPLACE WITH:
```javascript
function decideThresholdMode(lastVisitTs, threads, now, gapDays = REUNION_GAP_DAYS, predictions = [], temporalCallbacks = []) {
  const hasMaterial = (threads && threads.length) || (predictions && predictions.length) || (temporalCallbacks && temporalCallbacks.length);
  if (!hasMaterial) return 'none';
  const gap = (lastVisitTs == null) ? Infinity : (now - Number(lastVisitTs)) / 86400;
  return gap >= gapDays ? 'reunion' : 'gentle';
}
```
Then change `buildGreetingPrompt` to accept and weave the callbacks.
FIND:
```javascript
function buildGreetingPrompt(mode, threads, gapDays, predictions = []) {
```
REPLACE WITH:
```javascript
function buildGreetingPrompt(mode, threads, gapDays, predictions = [], temporalCallbacks = []) {
```
Then, still inside `buildGreetingPrompt`, FIND:
```javascript
  const material = [threadBlock, predBlock].filter(Boolean).join('\n\n');
```
REPLACE WITH:
```javascript
  const temporalBlock = (temporalCallbacks && temporalCallbacks.length)
    ? `Something you notice about the timing (mention it naturally, in your own words, only if it feels right):\n${temporalCallbacks.map(c => `- ${c.fact}`).join('\n')}`
    : '';
  const material = [temporalBlock, threadBlock, predBlock].filter(Boolean).join('\n\n');
```
(The existing `ask`/`material` interpolation already includes `material`, so the temporal block flows into both gentle and reunion prompts. The greeting text instructs Miriel to weave it in her own voice — consistent with the anti-AI-tells persona.)

- [ ] **Step 4: Run tests, verify pass**

Run: `node --test tests/*.test.js`
Expected: all pass (new decideThresholdMode test + existing).

- [ ] **Step 5: Commit**
```bash
git add data/memory-engine.js tests/temporal-recall.test.js
git commit -m "feat(memory): thread temporal callbacks through threshold mode + greeting"
```

---

## Task 3: Wire the detector into `/api/threshold`

**Files:** Modify `server.js` (the `/api/threshold` handler ~line 947, and add the require)

- [ ] **Step 1: Require the detector**

Near the other requires at the top of `server.js`, add:
```javascript
const { findTemporalCallbacks, filterSurfaced } = require('./data/temporal-recall');
```

- [ ] **Step 2: Compute + select callbacks in `/api/threshold`**

In the `/api/threshold` handler, FIND:
```javascript
    const threads     = memory.getOpenUnaskedThreads(slug, REUNION_MAX_THREADS, THRESHOLD_SALIENCE_BAR);
    const predictions = memory.getRipePredictions(slug, REUNION_MAX_THREADS, now);
    const lastVisit = memory.getMeta(`last_visit:${slug}`);
    const mode      = decideThresholdMode(lastVisit, threads, now, REUNION_GAP_DAYS, predictions);
```
REPLACE WITH:
```javascript
    const threads     = memory.getOpenUnaskedThreads(slug, REUNION_MAX_THREADS, THRESHOLD_SALIENCE_BAR);
    const predictions = memory.getRipePredictions(slug, REUNION_MAX_THREADS, now);
    const lastVisit = memory.getMeta(`last_visit:${slug}`);

    // Temporal callbacks (rare, resonant) — detector is pure; dedup via meta.
    const nowMs = now * 1000;
    const lastVisitMs = lastVisit == null ? null : Number(lastVisit) * 1000;
    let surfacedMap = {};
    try { surfacedMap = JSON.parse(memory.getMeta(`temporal_surfaced:${slug}`) || '{}'); } catch {}
    const allCallbacks = findTemporalCallbacks({ readings: loadReadings(slug), lastVisitTs: lastVisitMs, now: nowMs });
    const temporalCallbacks = filterSurfaced(allCallbacks, surfacedMap, nowMs, 30).slice(0, 1);

    const mode      = decideThresholdMode(lastVisit, threads, now, REUNION_GAP_DAYS, predictions, temporalCallbacks);
```
(Note: the engine stores `now`/`last_visit` in SECONDS, but the detector and readings use MILLISECONDS. Convert as shown.)

- [ ] **Step 3: Pass callbacks to the greeting + record surfaced**

FIND:
```javascript
      greeting = await callLLM(persona, buildGreetingPrompt(mode, shownThreads, gapDays, shownPredictions), 700, 'claude-sonnet-4-6');
```
REPLACE WITH:
```javascript
      greeting = await callLLM(persona, buildGreetingPrompt(mode, shownThreads, gapDays, shownPredictions, temporalCallbacks), 700, 'claude-sonnet-4-6');
```
Then, where the handler records success — FIND:
```javascript
    memory.markAsked(shown.map(t => t.id));
    memory.setMeta(`last_visit:${slug}`, String(now));
```
REPLACE WITH:
```javascript
    memory.markAsked(shown.map(t => t.id));
    if (temporalCallbacks.length) {
      for (const c of temporalCallbacks) surfacedMap[c.signature] = nowMs;
      memory.setMeta(`temporal_surfaced:${slug}`, JSON.stringify(surfacedMap));
    }
    memory.setMeta(`last_visit:${slug}`, String(now));
```

- [ ] **Step 4: Verify**

Run: `node --check server.js` → valid. `node --test tests/*.test.js` → green (server change doesn't affect tests).
Then a live smoke test in Step (Task 4 sample review).

- [ ] **Step 5: Commit**
```bash
git add server.js
git commit -m "feat(memory): surface temporal callbacks in the Threshold welcome"
```

---

## Task 4: Wrap — regression + seeded sample review

**Files:** Reference only

- [ ] **Step 1: Regression**

Run: `node --test tests/*.test.js`
Expected: all pass (108 prior + temporal-recall tests).

- [ ] **Step 2: Seeded sample review (live)**

With a valid API key and `npm start` running, verify the greeting actually weaves a callback:
- Temporarily craft a throwaway reader `temporaltest` with a readings file containing one reading dated ~365 days before today (set `timestamp` to `Date.now() - 365*86400000` ± a day) and set its `last_visit` meta to ~90 days ago (or leave unset).
- Hit `curl -s "http://localhost:3000/api/threshold?reader=temporaltest"` and read the greeting — it should naturally reference the one-year-ago reading, in Miriel's voice, without canned phrasing.
- Hit it again immediately — the same anniversary should NOT resurface (dedup), and `last_visit` now recent so no elapsed.
- Confirm a reader with only recent, unremarkable readings gets `mode:"none"` or a greeting with no temporal mention (restraint).
- Clean up the throwaway reader afterward.

- [ ] **Step 3: Final commit (if touch-ups needed)**
```bash
git add -A
git commit -m "chore(memory): temporal callbacks sample-review pass"
```

---

## Self-Review

**Spec coverage:**
- Four signals (anniversary/elapsed/seasonal/milestone) → Task 1 detector ✓
- Resonance bar + strongest-first cap + `[]` on ordinary visits → Task 1 (+ tests) ✓
- Dedup via `temporal_surfaced` meta → Task 1 `filterSurfaced` + Task 3 record ✓
- Threshold fires on a strong callback even with no threads → Task 2 decideThresholdMode ✓
- Greeting weaves the callback in Miriel's voice → Task 2 buildGreetingPrompt ✓
- Surfacing only at Threshold (not reading body) → scope held; no reading-path changes ✓
- No schema change (only a meta key) → Task 3 uses getMeta/setMeta ✓
- Seconds-vs-ms boundary handled → Task 3 Step 2 conversion ✓

**Placeholder scan:** none — full detector code, full test code, exact server edits. Milestone rules pinned (count % 50; first-meeting at 6/12/24/36/48 months within ±3 days).

**Type/name consistency:** `findTemporalCallbacks({readings,lastVisitTs,now})` and `filterSurfaced(candidates,surfacedMap,now,ttlDays)` used consistently in tests + server. `temporalCallbacks` param added as the 6th arg of `decideThresholdMode` and 5th of `buildGreetingPrompt`, both with `= []` defaults so existing calls (and the engine's other callers) are unaffected. Candidate shape `{kind,strength,signature,fact,ref?}` consistent across detector, dedup, and greeting use.
