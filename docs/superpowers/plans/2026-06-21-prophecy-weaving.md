# Prophecy Weaving Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Miriel reference her own past foretellings (resolved with verdicts, and still-open) inside a new reading when a card or theme genuinely connects.

**Architecture:** A new pure detector (`data/prophecy-recall.js`) builds a small recency/verdict/overlap-ranked dossier of the reader's predictions; `/api/interpret` appends it as a framed "prophecy" block to the persona and the interpret LLM weaves in what genuinely connects. A new store method `getOpenPredictions` supplies the open ones. No schema change, no extra LLM call, consume-only of the shipped Outcome Loop.

**Tech Stack:** Node.js, Express, better-sqlite3, `node:test` + `node:assert/strict`. Pure-detector pattern matching `data/card-patterns.js` and `data/temporal-recall.js`.

**Spec:** `docs/superpowers/specs/2026-06-21-prophecy-weaving-design.md`

**Key existing facts the engineer must know:**
- The `memories` table columns are `reader_slug`, `type`, `content`, `status`, `salience`, `created_at`, `updated_at`, `asked_at` (NOT `slug`). Timestamps are stored in **seconds**.
- `getResolvedPredictions(slug, limit)` already exists and returns objects shaped
  `{ prediction_id, foretelling, outcome, verdict, resolved_at }` where `verdict` is
  one of `came_to_pass | did_not | partly` (or `null`).
- Tests run with `node --test tests/*.test.js` (the bare `tests/` dir form fails on this Node version — always use the glob).
- If a test run errors with `ERR_DLOPEN_FAILED`, run `npm rebuild better-sqlite3` first (Node ABI), then re-run.

---

### Task 1: `getOpenPredictions` store method + engine passthrough

Supplies the reader's open (in-motion) prediction atoms, newest first. Parallel to the existing `getResolvedPredictions` / `getRipePredictions`.

**Files:**
- Modify: `data/memory-store.js` (add prepared statement after `stmtResolvedPredictions` ~line 136; add function after `getResolvedPredictions` ~line 250; add to the returned object ~line 271)
- Modify: `data/memory-engine.js` (add passthrough in the returned object ~line 420, next to `getResolvedPredictions`)
- Test: `tests/memory-engine.test.js` (append at end of file)

- [ ] **Step 1: Write the failing test**

Append to `tests/memory-engine.test.js`:

```javascript
test('getOpenPredictions returns only open predictions, newest first, respecting limit', () => {
  const engine = createMemoryEngine(tmpDir());
  const now = engine._store._now();
  const setCreated = (id, ts) =>
    engine._store._db.prepare('UPDATE memories SET created_at = ? WHERE id = ?').run(ts, id);

  const older = engine._store.addMemory('matt', { type: 'prediction', content: 'old foretelling', status: 'open', salience: 4 });
  const newer = engine._store.addMemory('matt', { type: 'prediction', content: 'new foretelling', status: 'open', salience: 4 });
  setCreated(older, now - 50 * 86400);
  setCreated(newer, now - 2 * 86400);

  // excluded: a resolved prediction and a non-prediction thread
  const resolved = engine._store.addMemory('matt', { type: 'prediction', content: 'done', status: 'resolved', salience: 4 });
  engine._store.addMemory('matt', { type: 'thread', content: 'a thread', status: 'open', salience: 4 });

  const out = engine.getOpenPredictions('matt', 12);
  assert.equal(out.length, 2, 'only the two open predictions');
  assert.equal(out[0].id, newer, 'newest first');
  assert.equal(out[1].id, older);
  assert.ok(!out.some(p => p.id === resolved), 'resolved prediction excluded');

  const limited = engine.getOpenPredictions('matt', 1);
  assert.equal(limited.length, 1, 'limit respected');
  assert.equal(limited[0].id, newer);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/memory-engine.test.js`
Expected: FAIL with `engine.getOpenPredictions is not a function`.

- [ ] **Step 3: Add the prepared statement in `data/memory-store.js`**

Immediately after the `stmtResolvedPredictions = db.prepare(`...`);` block (ends ~line 136), add:

```javascript
  const stmtOpenPredictions = db.prepare(`
    SELECT id, content, created_at, salience
    FROM memories
    WHERE reader_slug = ? AND type = 'prediction' AND status = 'open'
    ORDER BY created_at DESC
    LIMIT ?
  `);
```

- [ ] **Step 4: Add the function in `data/memory-store.js`**

Immediately after the `getResolvedPredictions` function (ends ~line 250), add:

```javascript
  function getOpenPredictions(slug, limit = 12) {
    return stmtOpenPredictions.all(slug, limit);
  }
```

- [ ] **Step 5: Export it from the store's returned object**

In `data/memory-store.js`, change the line:

```javascript
    getResolvedPredictions,
```

to:

```javascript
    getResolvedPredictions, getOpenPredictions,
```

- [ ] **Step 6: Add the engine passthrough in `data/memory-engine.js`**

In the returned object (~line 420), change:

```javascript
    getResolvedPredictions: (slug, limit) => store.getResolvedPredictions(slug, limit),
```

to:

```javascript
    getResolvedPredictions: (slug, limit) => store.getResolvedPredictions(slug, limit),
    getOpenPredictions: (slug, limit) => store.getOpenPredictions(slug, limit),
```

- [ ] **Step 7: Run test to verify it passes**

Run: `node --test tests/memory-engine.test.js`
Expected: PASS (the new test and all existing tests in the file green).

- [ ] **Step 8: Commit**

```bash
git add data/memory-store.js data/memory-engine.js tests/memory-engine.test.js
git commit -m "feat(memory): add getOpenPredictions store method + engine passthrough"
```

---

### Task 2: `findProphecyCallbacks` pure detector

The deterministic dossier builder. Pure, no I/O, fully unit-tested. Mirrors `data/card-patterns.js`.

**Files:**
- Create: `data/prophecy-recall.js`
- Test: `tests/prophecy-recall.test.js`

- [ ] **Step 1: Write the failing tests**

Create `tests/prophecy-recall.test.js`:

```javascript
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { findProphecyCallbacks } = require('../data/prophecy-recall');

const card = (name) => ({ name });
const res = (o) => Object.assign(
  { prediction_id: 1, foretelling: 'f', outcome: 'o', verdict: 'came_to_pass', resolved_at: 1000 }, o);
const opn = (o) => Object.assign(
  { id: 1, content: 'c', created_at: 1000, salience: 3 }, o);

test('a came_to_pass prediction surfaces as fulfilled with its outcome in the fact', () => {
  const out = findProphecyCallbacks({
    resolved: [res({ foretelling: 'friction in the move', outcome: 'the move was hard', verdict: 'came_to_pass' })],
    open: [], currentCards: [card('The Tower')], question: 'the move',
  });
  assert.equal(out.length, 1);
  assert.equal(out[0].kind, 'fulfilled');
  assert.equal(out[0].verdict, 'came_to_pass');
  assert.match(out[0].fact, /friction in the move/);
  assert.match(out[0].fact, /came to pass/i);
  assert.match(out[0].fact, /the move was hard/);
});

test('an open prediction surfaces as kind open, still unfolding', () => {
  const out = findProphecyCallbacks({
    resolved: [], open: [opn({ content: 'this connection will not last the season' })],
    currentCards: [], question: '',
  });
  assert.equal(out.length, 1);
  assert.equal(out[0].kind, 'open');
  assert.equal(out[0].verdict, null);
  assert.match(out[0].fact, /still unfolding/i);
  assert.match(out[0].fact, /connection will not last/);
});

test('hits rank before misses (verdict weight ordering)', () => {
  const out = findProphecyCallbacks({
    resolved: [
      res({ prediction_id: 1, foretelling: 'A', outcome: 'a', verdict: 'did_not', resolved_at: 2000 }),
      res({ prediction_id: 2, foretelling: 'B', outcome: 'b', verdict: 'came_to_pass', resolved_at: 1000 }),
    ],
    open: [], currentCards: [], question: '',
  });
  assert.equal(out[0].verdict, 'came_to_pass', 'the hit leads despite being older');
  assert.equal(out[1].verdict, 'did_not');
});

test('question/card overlap boosts a matching prediction above a non-matching one', () => {
  const out = findProphecyCallbacks({
    resolved: [
      res({ prediction_id: 1, foretelling: 'something about gardening', outcome: 'x', verdict: 'came_to_pass', resolved_at: 2000 }),
      res({ prediction_id: 2, foretelling: 'tension at your workplace', outcome: 'y', verdict: 'came_to_pass', resolved_at: 1000 }),
    ],
    open: [], currentCards: [], question: 'will the workplace tension ease?',
  });
  assert.match(out[0].fact, /workplace/, 'the overlapping foretelling ranks first despite being older');
});

test('caps the combined result at 3', () => {
  const resolved = [];
  for (let i = 1; i <= 5; i++) {
    resolved.push(res({ prediction_id: i, foretelling: 'f' + i, outcome: 'o' + i, verdict: 'came_to_pass', resolved_at: i }));
  }
  const open = [opn({ id: 9, content: 'still going' })];
  const out = findProphecyCallbacks({ resolved, open, currentCards: [], question: '' });
  assert.ok(out.length <= 3, 'no more than 3');
});

test('empty inputs return []', () => {
  assert.deepEqual(findProphecyCallbacks({ resolved: [], open: [], currentCards: [], question: '' }), []);
  assert.deepEqual(findProphecyCallbacks({}), []);
});

test('fact strings contain no em dashes', () => {
  const out = findProphecyCallbacks({
    resolved: [res({ foretelling: 'a', outcome: 'b', verdict: 'partly' })],
    open: [opn({ content: 'c' })],
    currentCards: [], question: '',
  });
  for (const item of out) assert.ok(!item.fact.includes('—'), 'no em dash in: ' + item.fact);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/prophecy-recall.test.js`
Expected: FAIL with `Cannot find module '../data/prophecy-recall'`.

- [ ] **Step 3: Implement `data/prophecy-recall.js`**

Create `data/prophecy-recall.js`:

```javascript
'use strict';

// Self-contained tokenizer/overlap (kept dependency-free so this module stays pure
// and unit-testable without loading the sqlite-backed memory engine). Mirrors the
// tokenizer in data/memory-engine.js intentionally.
const STOPWORDS = new Set(
  ('the a an and or but if then of to in on for with about into your you i me my we our it its this that ' +
   'these those is are was were be been being do does did so as at by from will would can could should ' +
   'what when where who how').split(' ')
);

function tokenize(str) {
  return String(str || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !STOPWORDS.has(w));
}

function overlap(queryTokens, text) {
  if (!queryTokens.size) return 0;
  const seen = new Set();
  let hits = 0;
  for (const w of tokenize(text)) {
    if (queryTokens.has(w) && !seen.has(w)) { hits++; seen.add(w); }
  }
  return hits;
}

const VERDICT_WEIGHT = { came_to_pass: 3, partly: 2, did_not: 1 };
const VERDICT_KIND   = { came_to_pass: 'fulfilled', partly: 'partial', did_not: 'missed' };

function resolvedFact(kind, foretelling, outcome) {
  const tail = kind === 'fulfilled' ? 'It came to pass'
             : kind === 'partial'   ? 'It came partly true'
             : 'It did not come to pass';
  return outcome
    ? `You foretold: "${foretelling}". ${tail}: "${outcome}".`
    : `You foretold: "${foretelling}". ${tail}.`;
}

function openFact(foretelling) {
  return `You foretold: "${foretelling}". This is still unfolding, not yet resolved.`;
}

// Build a small dossier (<=3) of the reader's foretellings for the interpret LLM to
// weave in only when a current card/theme genuinely connects. Resolved hits lead
// (verdict weight), broken ties by lexical overlap with the question/cards, then by
// recency. Open (in-motion) predictions follow for continuity. Pure: no I/O.
function findProphecyCallbacks({ resolved, open, currentCards, question } = {}) {
  const cards = Array.isArray(currentCards) ? currentCards : [];
  const cardNames = cards.map(c => c && c.name).filter(Boolean).join(' ');
  const queryTokens = new Set(tokenize(`${question || ''} ${cardNames}`));

  const resolvedItems = (Array.isArray(resolved) ? resolved : [])
    .filter(r => r && r.foretelling)
    .map(r => {
      const verdict = r.verdict || null;
      const kind = VERDICT_KIND[verdict] || 'fulfilled';
      return {
        kind,
        verdict,
        foretelling: r.foretelling,
        outcome: r.outcome || null,
        fact: resolvedFact(kind, r.foretelling, r.outcome),
        _weight: VERDICT_WEIGHT[verdict] || 1,
        _ov: overlap(queryTokens, `${r.foretelling} ${r.outcome || ''}`),
        _ts: r.resolved_at || 0,
      };
    });

  const openItems = (Array.isArray(open) ? open : [])
    .filter(o => o && o.content)
    .map(o => ({
      kind: 'open',
      verdict: null,
      foretelling: o.content,
      outcome: null,
      fact: openFact(o.content),
      _weight: 0,
      _ov: overlap(queryTokens, o.content),
      _ts: o.created_at || 0,
    }));

  resolvedItems.sort((a, b) => (b._weight - a._weight) || (b._ov - a._ov) || (b._ts - a._ts));
  openItems.sort((a, b) => (b._ov - a._ov) || (b._ts - a._ts));

  return [...resolvedItems, ...openItems]
    .slice(0, 3)
    .map(({ _weight, _ov, _ts, ...item }) => item);
}

module.exports = { findProphecyCallbacks };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/prophecy-recall.test.js`
Expected: PASS (all 7 tests green).

- [ ] **Step 5: Commit**

```bash
git add data/prophecy-recall.js tests/prophecy-recall.test.js
git commit -m "feat(memory): add findProphecyCallbacks detector"
```

---

### Task 3: Wire prophecy weaving into `/api/interpret`

Gather predictions, run the detector, append the framed prophecy block, and widen the over-claim guard to license referencing these foretellings.

**Files:**
- Modify: `server.js` (require ~line 29; interpret endpoint ~lines 633–652)

- [ ] **Step 1: Add the require**

In `server.js`, immediately after the line:

```javascript
const { findCardPatterns } = require('./data/card-patterns');
```

add:

```javascript
const { findProphecyCallbacks } = require('./data/prophecy-recall');
```

- [ ] **Step 2: Build the prophecy block in the interpret handler**

In `server.js`, find the end of the pattern-detection `try/catch` followed by the
over-claim guard and `personaFinal` (currently):

```javascript
  } catch (err) {
    console.warn('  ⚠  Pattern detection failed:', err.message);
  }

  // Guard against over-claiming. She genuinely tracks recurring cards and the
  // specific remembered moments surfaced above, but the app does NOT analyze the
  // topics or types of questions she's asked over time. She must not claim to see
  // patterns in "what they ask" unless one is explicitly given here.
  const overclaimGuard = `\n\nWhat you may and may not claim to notice across their readings: you genuinely track the cards and symbols that recur for them, the patterns named above, and the specific past moments surfaced to you here. You do NOT keep a record of the topics or kinds of questions they bring over time, so never claim to see a pattern in "what they ask" or "the questions they keep asking" unless such a pattern is explicitly stated above. Speak only to patterns you actually have in front of you; do not invent a history of noticing.`;

  const personaFinal = personaWithName + memoryBlock + patternBlock + overclaimGuard;
```

Replace that whole block with:

```javascript
  } catch (err) {
    console.warn('  ⚠  Pattern detection failed:', err.message);
  }

  // Prophecy weaving: surface her own past foretellings (resolved with verdicts +
  // still-open) so she can reference her foresight when a card/theme connects. The
  // interpret LLM does the final semantic selection (see prophecy-weaving spec).
  let prophecyBlock = '';
  try {
    const prophecy = findProphecyCallbacks({
      resolved: memory.getResolvedPredictions(slug, 12),
      open:     memory.getOpenPredictions(slug, 12),
      currentCards: cards,
      question,
    });
    if (prophecy.length) {
      prophecyBlock = `\n\nForetellings you have made for this person and how they have stood (reference one only when a card or theme in front of you genuinely connects to it; name the specific foretelling and how it turned out; speak with quiet, earned confidence when one came to pass, and with honesty when one did not; never recite these as a list, and never inflate your record):\n${prophecy.map(p => `- ${p.fact}`).join('\n')}`;
    }
  } catch (err) {
    console.warn('  ⚠  Prophecy detection failed:', err.message);
  }

  // Guard against over-claiming. She genuinely tracks recurring cards, the patterns
  // and foretellings surfaced above, and specific remembered moments, but the app
  // does NOT analyze the topics or types of questions she's asked over time.
  const overclaimGuard = `\n\nWhat you may and may not claim to notice across their readings: you genuinely track the cards and symbols that recur for them, the patterns named above, the foretellings surfaced above, and the specific past moments surfaced to you here. You do NOT keep a record of the topics or kinds of questions they bring over time, so never claim to see a pattern in "what they ask" or "the questions they keep asking" unless such a pattern is explicitly stated above. Speak only to patterns and foretellings you actually have in front of you; do not invent a history of noticing.`;

  const personaFinal = personaWithName + memoryBlock + patternBlock + prophecyBlock + overclaimGuard;
```

- [ ] **Step 3: Syntax check**

Run: `node --check server.js`
Expected: no output (exit 0).

- [ ] **Step 4: Run the full test suite**

Run: `node --test tests/*.test.js`
Expected: PASS, all tests green (the new prophecy-recall tests + the new getOpenPredictions test + all pre-existing tests).

- [ ] **Step 5: Confirm em-dash hygiene in the new prose**

Run: `grep -n "\xe2\x80\x94" data/prophecy-recall.js server.js | grep -v 'Never use the' || echo "clean"`
Expected: `clean` (the only allowed em dash in server.js is inside the persona's em-dash prohibition; the new prophecy strings must contain none).

- [ ] **Step 6: Commit**

```bash
git add server.js
git commit -m "feat(interpret): weave prophecy block into readings; widen over-claim guard"
```

---

## Final verification (after all tasks)

- [ ] Run `node --check server.js` (exit 0).
- [ ] Run `node --test tests/*.test.js` (all green).
- [ ] Live sample (manual, optional but recommended): with the dev server running
      (`tarot.bat` / `node server.js`), perform a reading for a reader who has a
      resolved `came_to_pass` prediction on a related theme; confirm Miriel references
      the fulfilled foretelling with earned confidence and names it, and that a reader
      with no related predictions gets no prophecy mention.

## Notes for the implementer

- The detector is intentionally recency/verdict/overlap-ranked rather than a precise
  semantic matcher: it produces a candidate dossier and the interpret LLM chooses what
  genuinely connects (same model as the richer-recall sub-project). Do not add an LLM
  call here.
- Do not touch capture, ripeness, the Threshold flow, or the notebook Foretellings
  section. This sub-project is consume-only.
- Keep `data/prophecy-recall.js` dependency-free (no `require` of the memory engine);
  that is what keeps it pure and fast to test.
