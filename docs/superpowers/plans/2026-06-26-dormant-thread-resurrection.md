# Dormant Thread Resurrection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Miriel notice a salient life-thread gone quiet for ~60 days and gently circle back to it in the Threshold greeting.

**Architecture:** A pure SQL detector (`getDormantThreads`) in the memory store, mirroring the existing `getRipePredictions` ripeness pattern, plus a distinct greeting block in `buildGreetingPrompt`. `server.js` fetches dormant threads, de-dupes them against the fresh open-thread list, threads them through `decideThresholdMode`/`buildGreetingPrompt`, and reuses the existing `markAsked` call to enforce the ask-once-then-rest cooldown. The querent's reply resolves via the existing threshold-capture path — no new capture code.

**Tech Stack:** Node.js, better-sqlite3, `node --test` (built-in test runner).

## Global Constraints

- **Dormancy window:** 60 days, measured from `COALESCE(asked_at, updated_at)`.
- **Per-row jitter:** `(id % 7) - 3`, giving a stable 57–63 day threshold (mirrors `getRipePredictions`' `(14 + (id % 7) - 3)`).
- **Salience bar:** `>= 3`.
- **Caps:** 2 dormant threads in reunion mode, 1 in gentle mode.
- **ASCII only** in all prompt strings — no em dashes, no smart quotes (per project codex rules; Miriel's voice had em dashes removed).
- **New parameters are trailing and optional**, defaulting to `[]`, so existing callers/tests are unaffected.
- **Test command:** `node --test` from the project root (runs all ~154 tests). Targeted: `node --test tests/<file>.test.js`. Do NOT use `node --test tests/` (it fails to glob correctly in this repo).
- **Commit cadence:** one commit per task after its tests pass.

---

### Task 1: `getDormantThreads` store method + constants

**Files:**
- Modify: `data/memory-store.js`
- Test: `tests/memory-store.test.js`

**Interfaces:**
- Consumes: nothing new (uses existing `memories` table columns `type`, `status`, `salience`, `asked_at`, `updated_at`, `reader_slug`).
- Produces:
  - `store.getDormantThreads(slug, limit = 2, nowTs = now()) -> Array<row>` — rows are full `memories` rows. Returns salient (`>= 3`) `thread` rows with `status IN ('open','moving')` whose `COALESCE(asked_at, updated_at)` is at least `(60 + (id%7) - 3)` days before `nowTs`, ordered quietest-and-most-salient first, capped to `limit`.
  - `store.DORMANT_DAYS === 60`, `store.DORMANT_SALIENCE_BAR === 3` (exported on the returned object alongside `TYPES`/`STATUSES`).

- [ ] **Step 1: Write the failing tests**

Add to `tests/memory-store.test.js` (after the `getRipePredictions` tests, near line 229):

```javascript
test('getDormantThreads returns a salient open thread gone quiet past the window', () => {
  const store = createMemoryStore(tmpDir());
  const now = store._now();
  const id = store.addMemory('matt', { type: 'thread', content: 'the Portland move', status: 'open', salience: 4 });
  const threshold = 60 + (id % 7) - 3; // per-id window, 57..63 days
  store._db.prepare('UPDATE memories SET updated_at = ? WHERE id = ?').run(now - (threshold + 1) * 86400, id);
  const rows = store.getDormantThreads('matt', 2, now);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].content, 'the Portland move');
});

test('getDormantThreads excludes a freshly-touched thread', () => {
  const store = createMemoryStore(tmpDir());
  const now = store._now();
  const id = store.addMemory('matt', { type: 'thread', content: 'recent worry', status: 'open', salience: 4 });
  store._db.prepare('UPDATE memories SET updated_at = ? WHERE id = ?').run(now - 5 * 86400, id);
  assert.equal(store.getDormantThreads('matt', 2, now).length, 0);
});

test('getDormantThreads excludes resolved/dormant-status threads, non-threads, and low salience', () => {
  const store = createMemoryStore(tmpDir());
  const now = store._now();
  const old = now - 120 * 86400;
  const ids = [
    store.addMemory('matt', { type: 'thread',  content: 'resolved one', status: 'resolved', salience: 5 }),
    store.addMemory('matt', { type: 'thread',  content: 'already dormant-status', status: 'dormant', salience: 5 }),
    store.addMemory('matt', { type: 'feeling', content: 'not a thread', status: 'open', salience: 5 }),
    store.addMemory('matt', { type: 'thread',  content: 'low salience', status: 'open', salience: 2 }),
  ];
  for (const id of ids) store._db.prepare('UPDATE memories SET updated_at = ? WHERE id = ?').run(old, id);
  assert.equal(store.getDormantThreads('matt', 5, now).length, 0);
});

test('getDormantThreads enforces ask-once-then-rest cooldown via asked_at', () => {
  const store = createMemoryStore(tmpDir());
  const now = store._now();
  const id = store.addMemory('matt', { type: 'thread', content: 'the move', status: 'open', salience: 4 });
  const threshold = 60 + (id % 7) - 3;
  // updated_at is old (would be dormant) but it was just asked -> within cooldown -> excluded
  store._db.prepare('UPDATE memories SET updated_at = ?, asked_at = ? WHERE id = ?')
    .run(now - 200 * 86400, now, id);
  assert.equal(store.getDormantThreads('matt', 2, now).length, 0);
  // asked_at now past the cooldown window -> re-ripens
  store._db.prepare('UPDATE memories SET asked_at = ? WHERE id = ?')
    .run(now - (threshold + 1) * 86400, id);
  assert.equal(store.getDormantThreads('matt', 2, now).length, 1);
});

test('getDormantThreads exposes DORMANT_DAYS and DORMANT_SALIENCE_BAR constants', () => {
  const store = createMemoryStore(tmpDir());
  assert.equal(store.DORMANT_DAYS, 60);
  assert.equal(store.DORMANT_SALIENCE_BAR, 3);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/memory-store.test.js`
Expected: FAIL — `store.getDormantThreads is not a function` (and the constants test fails on `undefined`).

- [ ] **Step 3: Add the constants near the top of `data/memory-store.js`**

After line 8 (`const VERDICTS = [...]`), add:

```javascript
const DORMANT_DAYS         = 60;
const DORMANT_SALIENCE_BAR = 3;
```

- [ ] **Step 4: Add the prepared statement and method**

In `data/memory-store.js`, after the `stmtRipePredictions` prepared statement block (ends around line 122), add:

```javascript
  // Dormant = an open/moving, salient thread untouched past a per-id jittered
  // window: base 60 days, +/-3 from (id % 7) -> 57..63 days, stable per row so it
  // never flickers. Measured from COALESCE(asked_at, updated_at): a never-asked
  // thread qualifies via updated_at; a thread raised once re-ripens 60 days after
  // asked_at (ask-once-then-rest). Quietest, most salient first. Mirrors
  // stmtRipePredictions.
  const stmtDormantThreads = db.prepare(`
    SELECT * FROM memories
    WHERE reader_slug = ? AND type = 'thread'
      AND status IN ('open','moving') AND salience >= ${DORMANT_SALIENCE_BAR}
      AND (? - COALESCE(asked_at, updated_at)) >= (${DORMANT_DAYS} + (id % 7) - 3) * 86400
    ORDER BY salience DESC, updated_at ASC
    LIMIT ?
  `);
```

Then, next to `getRipePredictions` (around line 268), add the method:

```javascript
  function getDormantThreads(slug, limit = 2, nowTs = now()) {
    return stmtDormantThreads.all(slug, nowTs, limit);
  }
```

- [ ] **Step 5: Export the method and constants**

In the `return { ... }` object at the bottom of `createMemoryStore` (around line 279-286), add `getDormantThreads` to the method list and the two constants to the metadata line. The final lines become:

```javascript
  return {
    addMemory, getMemory, applyOps, listMemories,
    getOpenAndSalient, markReferenced,
    getOpenUnaskedThreads, getRipePredictions, getDormantThreads, markAsked,
    getResolvedPredictions, getOpenPredictions,
    linkMemories, getLinks, getMeta, setMeta, getStats,
    _db: db, _now: now, TYPES, STATUSES, VERDICTS, clampSalience,
    DORMANT_DAYS, DORMANT_SALIENCE_BAR,
  };
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `node --test tests/memory-store.test.js`
Expected: PASS — all existing store tests plus the 5 new ones.

- [ ] **Step 7: Run the full suite (no regressions)**

Run: `node --test`
Expected: `pass 159  fail 0` (154 existing + 5 new).

- [ ] **Step 8: Commit**

```bash
git add data/memory-store.js tests/memory-store.test.js
git commit -m "feat(memory): getDormantThreads detector for long-quiet threads

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Dormant block in the greeting + engine pass-through

**Files:**
- Modify: `data/memory-engine.js`
- Test: `tests/memory-engine.test.js`

**Interfaces:**
- Consumes: `store.getDormantThreads` (from Task 1).
- Produces:
  - `decideThresholdMode(lastVisitTs, threads, now, gapDays, predictions, temporalCallbacks, dormantThreads = [])` — dormant threads alone can now return `'reunion'`/`'gentle'`.
  - `buildGreetingPrompt(mode, threads, gapDays, predictions, temporalCallbacks, timeOfDay, dormantThreads = [])` — emits a distinct dormant block when `dormantThreads` is non-empty.
  - `engine.getDormantThreads(slug, limit, nowTs)` pass-through.

- [ ] **Step 1: Write the failing tests**

Add to `tests/memory-engine.test.js` (after the existing `buildGreetingPrompt` ripe-prediction test near line 375):

```javascript
test('decideThresholdMode triggers on dormant threads alone', () => {
  const { decideThresholdMode } = require('../data/memory-engine');
  const now = 1000000;
  const dormant = [{ id: 1, content: 'the Portland move' }];
  assert.equal(decideThresholdMode(now, [], now, undefined, [], [], dormant), 'gentle');
  assert.equal(decideThresholdMode(now - 5 * 86400, [], now, undefined, [], [], dormant), 'reunion');
  assert.equal(decideThresholdMode(now, [], now, undefined, [], [], []), 'none');
});

test('buildGreetingPrompt emits a distinct dormant block with the thread content', () => {
  const { buildGreetingPrompt } = require('../data/memory-engine');
  const p = buildGreetingPrompt('reunion', [], 90, [], [], '', [{ id: 1, content: 'the Portland move' }]);
  assert.ok(p.includes('the Portland move'));
  assert.ok(/gone quiet/i.test(p));
  assert.ok(!/[‒-―‘’“”]/.test(p)); // no em dashes / smart quotes
});

test('engine.getDormantThreads passes through to the store', () => {
  const engine = createMemoryEngine(tmpDir());
  const now = engine._store._now();
  const id = engine._store.addMemory('matt', { type: 'thread', content: 'quiet thread', status: 'open', salience: 4 });
  engine._store._db.prepare('UPDATE memories SET updated_at = ? WHERE id = ?').run(now - 120 * 86400, id);
  assert.equal(engine.getDormantThreads('matt', 2, now).length, 1);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/memory-engine.test.js`
Expected: FAIL — dormant block content absent from the prompt; `engine.getDormantThreads is not a function`.

- [ ] **Step 3: Add `dormantThreads` to `decideThresholdMode`**

In `data/memory-engine.js`, replace the `decideThresholdMode` function (lines 114-119):

```javascript
function decideThresholdMode(lastVisitTs, threads, now, gapDays = REUNION_GAP_DAYS, predictions = [], temporalCallbacks = [], dormantThreads = []) {
  const hasMaterial = (threads && threads.length) || (predictions && predictions.length)
    || (temporalCallbacks && temporalCallbacks.length) || (dormantThreads && dormantThreads.length);
  if (!hasMaterial) return 'none';
  const gap = (lastVisitTs == null) ? Infinity : (now - Number(lastVisitTs)) / 86400;
  return gap >= gapDays ? 'reunion' : 'gentle';
}
```

- [ ] **Step 4: Add the dormant block to `buildGreetingPrompt`**

In `data/memory-engine.js`, change the `buildGreetingPrompt` signature (line 129) to add the trailing parameter:

```javascript
function buildGreetingPrompt(mode, threads, gapDays, predictions = [], temporalCallbacks = [], timeOfDay = '', dormantThreads = []) {
```

Immediately after the `predBlock` definition (ends line 143), add the dormant block (ASCII only, no dashes):

```javascript
  const hasDormant = dormantThreads && dormantThreads.length;
  const dormantBlock = hasDormant
    ? `Thread${dormantThreads.length > 1 ? 's' : ''} that ${dormantThreads.length > 1 ? 'have' : 'has'} gone quiet between you. They spoke of ${dormantThreads.length > 1 ? 'these' : 'this'} once, but not for a long while now:\n${dormantThreads.map(t => `- ${t.content}`).join('\n')}\n\nYou have been quietly holding ${dormantThreads.length > 1 ? 'these' : 'this'}. If it feels natural, gently wonder aloud whether ${dormantThreads.length > 1 ? 'they ever settled' : 'it ever settled'}, not as a checklist, but the way you would ask after something a friend once carried and may no longer be carrying. Do not press; if they do not take it up, let it rest.`
    : '';
```

Then add `dormantBlock` to the `material` join (line 150). Change:

```javascript
  const material = [temporalBlock, threadBlock, predBlock, timeHint].filter(Boolean).join('\n\n');
```

to:

```javascript
  const material = [temporalBlock, threadBlock, dormantBlock, predBlock, timeHint].filter(Boolean).join('\n\n');
```

Note: the dormant block carries its own instruction, so it stands on its own even when no open threads or predictions are present. The existing `ask` logic (open threads / predictions) is intentionally left unchanged — dormant threads are wondered about, not folded into the "what came of it" ask.

- [ ] **Step 5: Add the engine pass-through**

In `data/memory-engine.js`, in the `return { ... }` object (around line 416-418), add the pass-through next to `getOpenUnaskedThreads`:

```javascript
    getDormantThreads: (slug, limit, nowTs) => store.getDormantThreads(slug, limit, nowTs),
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `node --test tests/memory-engine.test.js`
Expected: PASS — existing greeting tests plus the 3 new ones.

- [ ] **Step 7: Run the full suite (no regressions)**

Run: `node --test`
Expected: `pass 162  fail 0` (159 from Task 1 + 3 new).

- [ ] **Step 8: Commit**

```bash
git add data/memory-engine.js tests/memory-engine.test.js
git commit -m "feat(memory): dormant-thread greeting block + engine passthrough

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Wire dormant threads into the greeting endpoint

**Files:**
- Modify: `server.js` (the threshold/greeting handler, ~lines 1050-1094)

**Interfaces:**
- Consumes: `memory.getDormantThreads` (Task 2), `decideThresholdMode`/`buildGreetingPrompt` with their new trailing params (Task 2).
- Produces: greeting responses that may include a dormant-thread wondering; surfaced dormant ids are stamped via the existing `markAsked` call.

This task is integration wiring with no unit-test harness for the HTTP handler, so it is verified by (a) the full suite staying green and (b) a focused manual smoke script that exercises the exact fetch -> dedup -> prompt path.

- [ ] **Step 1: Fetch dormant threads and de-dupe against fresh threads**

In `server.js`, after the `predictions` line (1051):

```javascript
    const predictions = memory.getRipePredictions(slug, REUNION_MAX_THREADS, now);
```

add:

```javascript
    const dormant = memory.getDormantThreads(slug, 2, now);
    const dormantIds = new Set(dormant.map(t => t.id));
    const freshThreads = threads.filter(t => !dormantIds.has(t.id));
```

- [ ] **Step 2: Use `freshThreads` and pass `dormant` into `decideThresholdMode`**

Replace the `decideThresholdMode` call (line 1063):

```javascript
    const mode      = decideThresholdMode(lastVisit, threads, now, REUNION_GAP_DAYS, predictions, temporalCallbacks);
```

with:

```javascript
    const mode      = decideThresholdMode(lastVisit, freshThreads, now, REUNION_GAP_DAYS, predictions, temporalCallbacks, dormant);
```

- [ ] **Step 3: Compute the shown dormant set (cap 2 reunion / 1 gentle) and keep gentle to a single item**

Replace the `shownThreads`/`shownPredictions`/`shown` block (lines 1070-1074):

```javascript
    const shownThreads     = mode === 'gentle' ? threads.slice(0, 1) : threads;
    const shownPredictions = mode === 'gentle'
      ? (shownThreads.length ? [] : predictions.slice(0, 1))
      : predictions;
    const shown = [...shownThreads, ...shownPredictions];
```

with:

```javascript
    const shownThreads  = mode === 'gentle' ? freshThreads.slice(0, 1) : freshThreads;
    const shownDormant  = mode === 'gentle'
      ? (shownThreads.length ? [] : dormant.slice(0, 1))
      : dormant;
    const shownPredictions = mode === 'gentle'
      ? ((shownThreads.length || shownDormant.length) ? [] : predictions.slice(0, 1))
      : predictions;
    const shown = [...shownThreads, ...shownDormant, ...shownPredictions];
```

- [ ] **Step 4: Pass `shownDormant` into `buildGreetingPrompt`**

Replace the `buildGreetingPrompt` call (line 1085):

```javascript
      greeting = await callLLM(persona, buildGreetingPrompt(mode, shownThreads, gapDays, shownPredictions, temporalCallbacks, phase), 700, 'claude-sonnet-4-6');
```

with:

```javascript
      greeting = await callLLM(persona, buildGreetingPrompt(mode, shownThreads, gapDays, shownPredictions, temporalCallbacks, phase, shownDormant), 700, 'claude-sonnet-4-6');
```

(The `markAsked(shown.map(t => t.id))` call at line 1094 now already includes the dormant ids because `shown` includes `shownDormant` — no further change needed there. This is what enforces the 60-day cooldown.)

- [ ] **Step 5: Verify the full suite still passes**

Run: `node --test`
Expected: `pass 162  fail 0` (no regressions; server.js has no unit tests).

- [ ] **Step 6: Manual smoke test of the fetch -> dedup -> prompt path**

Create `scratch-dormant-smoke.js` in the project root:

```javascript
const os = require('os'), path = require('path'), fs = require('fs');
const createMemoryEngine = require('./data/memory-engine');
const { decideThresholdMode, buildGreetingPrompt, REUNION_GAP_DAYS } = require('./data/memory-engine');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dormant-smoke-'));
const memory = createMemoryEngine(dir);
const now = memory._store._now();

// A dormant thread (untouched 100 days) and a fresh one (touched 3 days ago).
const dormantId = memory._store.addMemory('matt', { type: 'thread', content: 'the Portland move', status: 'open', salience: 4 });
const freshId   = memory._store.addMemory('matt', { type: 'thread', content: 'this week\'s job interview', status: 'open', salience: 4 });
memory._store._db.prepare('UPDATE memories SET updated_at = ? WHERE id = ?').run(now - 100 * 86400, dormantId);
memory._store._db.prepare('UPDATE memories SET updated_at = ? WHERE id = ?').run(now - 3 * 86400, freshId);

const threads = memory.getOpenUnaskedThreads('matt', 3, 3);
const dormant = memory.getDormantThreads('matt', 2, now);
const dormantIds = new Set(dormant.map(t => t.id));
const freshThreads = threads.filter(t => !dormantIds.has(t.id));

console.log('dormant ids:', [...dormantIds], '(expect just', dormantId, ')');
console.log('fresh thread ids:', freshThreads.map(t => t.id), '(expect just', freshId, ')');
const mode = decideThresholdMode(now - 30 * 86400, freshThreads, now, REUNION_GAP_DAYS, [], [], dormant);
const prompt = buildGreetingPrompt(mode, freshThreads, 30, [], [], '', dormant);
console.log('mode:', mode, '(expect reunion)');
console.log('--- greeting prompt ---\n' + prompt);
console.log('--- checks ---');
console.log('mentions dormant thread:', prompt.includes('the Portland move'));
console.log('mentions fresh thread:', prompt.includes('job interview'));
console.log('has dormant framing:', /gone quiet/i.test(prompt));
console.log('no overlap (dormant id not in fresh):', !freshThreads.some(t => dormantIds.has(t.id)));
```

Run: `node scratch-dormant-smoke.js`
Expected output: dormant ids = `[<dormantId>]`, fresh ids = `[<freshId>]`, `mode: reunion`, and all four checks print `true`. The printed prompt should contain both a "what came of it" ask for the fresh thread and a separate "gone quiet" wondering for the dormant one, with no em dashes.

- [ ] **Step 7: Delete the smoke script**

```bash
rm scratch-dormant-smoke.js
```

- [ ] **Step 8: Commit**

```bash
git add server.js
git commit -m "feat(memory): surface dormant threads in the threshold greeting

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
- §1 Detection (`getDormantThreads`, COALESCE age basis, jitter, constants, ORDER BY) -> Task 1. ✓
- §2 Greeting integration (fetch first, dedup Set, pass to decideThresholdMode, gentle cap, markAsked cooldown) -> Task 3. ✓
- §3 Greeting prompt (decideThresholdMode dormant param, buildGreetingPrompt dormant block + softer voice) -> Task 2. ✓
- §4 Resolution (no new code; existing threshold-capture) -> nothing to build; verified by leaving the capture path untouched. ✓
- §5 Testing (store cases, engine cases, all green + new) -> Tasks 1, 2 tests; Task 3 smoke. ✓
- Behavioral decisions: 60d window (Global Constraints + Task 1 SQL), ask-once-then-rest (Task 1 cooldown test), salience>=3 (Task 1), caps 2/1 (Task 3 Step 3). ✓

**Placeholder scan:** No TBD/TODO; every code step shows complete code and exact commands with expected counts. ✓

**Type consistency:** `getDormantThreads(slug, limit, nowTs)` identical across store method, engine pass-through, tests, and server call. `decideThresholdMode` and `buildGreetingPrompt` trailing `dormantThreads`/`shownDormant` argument positions consistent between Task 2 definitions and Task 3 call sites. Constant names `DORMANT_DAYS`/`DORMANT_SALIENCE_BAR` consistent. ✓
