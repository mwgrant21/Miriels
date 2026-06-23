# Miriel Outcome Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Miriel record the predictions she makes in readings, ask at the Threshold whether ripe ones came to pass, and write a voiced outcome note that feeds future readings.

**Architecture:** Extends the existing memory engine (no schema migration). Reading-time capture gains a prediction directive; a new ripeness query gates predictions by a per-id jittered age window; the Threshold reunion gathers ripe predictions alongside threads and asks about them; the answer-capture path resolves each prediction with a verdict and a Miriel-voiced outcome; a read-only endpoint + notebook section surface the record.

**Tech Stack:** Node.js, Express, better-sqlite3, `node:test` + `node:assert/strict`, vanilla JS frontend.

**Test command:** `node --test tests/<file>.test.js` (run a single file) or `node --test tests/` (whole suite).

**Source files involved:**
- `data/memory-store.js` — SQLite store (prepared statements, `applyOps`)
- `data/memory-engine.js` — prompts, recall, capture, threshold helpers
- `server.js` — Express endpoints (`/api/threshold*`, new `/api/foretellings`)
- `public/app.js` — notebook overlay frontend
- `tests/memory-store.test.js`, `tests/memory-engine.test.js` — existing suites to extend

---

## Task 1: Capture predictions at reading time

**Files:**
- Modify: `data/memory-engine.js` (`buildCapturePrompt`, module exports)
- Test: `tests/memory-engine.test.js`

- [ ] **Step 1: Write the failing test**

Add at the end of `tests/memory-engine.test.js`:

```js
const { buildCapturePrompt } = require('../data/memory-engine');

test('buildCapturePrompt instructs conservative prediction capture', () => {
  const p = buildCapturePrompt(
    { date: '2026-06-14', cards: [], question: 'work?', synopsis: 'expect friction in that move' },
    []
  );
  assert.ok(/prediction/i.test(p));
  assert.ok(/foretelling|checkable/i.test(p));
  assert.ok(/not a prediction/i.test(p));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/memory-engine.test.js`
Expected: FAIL — `buildCapturePrompt` is `undefined` (not yet exported), TypeError.

- [ ] **Step 3: Add the prediction directive and export the function**

In `data/memory-engine.js`, inside `buildCapturePrompt`, the rules list currently ends with the "Record only what is explicitly present" line. Add a new bullet immediately **after** the `- TOUCH an existing memory ...` line and **before** the `- If there is genuinely nothing worth remembering` line:

```js
- A PREDICTION is special: when Miriel's own words contain a specific, checkable foretelling about the future (e.g. "expect friction in that move", "this connection won't last the season"), ADD it as type "prediction", status "open", salience 3 or higher, with content phrased as the claim itself so it reads back cleanly later. Vague encouragement ("good things are coming") is NOT a prediction — leave it out.
```

Then add to the bottom `module.exports.*` block:

```js
module.exports.buildCapturePrompt = buildCapturePrompt;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/memory-engine.test.js`
Expected: PASS (all prior tests still pass).

- [ ] **Step 5: Commit**

```bash
git add data/memory-engine.js tests/memory-engine.test.js
git commit -m "feat: capture checkable predictions from readings"
```

---

## Task 2: Ripeness query (`getRipePredictions`)

**Files:**
- Modify: `data/memory-store.js` (new prepared statement, function, export)
- Test: `tests/memory-store.test.js`

- [ ] **Step 1: Write the failing tests**

Add at the end of `tests/memory-store.test.js`:

```js
test('getRipePredictions includes a matured prediction, excludes a fresh one', () => {
  const store = createMemoryStore(tmpDir());
  const now = store._now();
  const id  = store.addMemory('matt', { type: 'prediction', content: 'friction in the move', status: 'open', salience: 4 });
  const threshold = 14 + (id % 7) - 3; // per-id window, 11..17 days
  const setCreated = (daysAgo) =>
    store._db.prepare('UPDATE memories SET created_at = ? WHERE id = ?').run(now - daysAgo * 86400, id);

  setCreated(threshold + 1);
  assert.equal(store.getRipePredictions('matt', 10, now).length, 1);

  setCreated(threshold - 1);
  assert.equal(store.getRipePredictions('matt', 10, now).length, 0);
});

test('getRipePredictions excludes resolved predictions and non-predictions', () => {
  const store = createMemoryStore(tmpDir());
  const now = store._now();
  const old = now - 60 * 86400;
  const rid = store.addMemory('matt', { type: 'prediction', content: 'resolved one', status: 'resolved', salience: 4 });
  const tid = store.addMemory('matt', { type: 'thread',     content: 'a thread',     status: 'open',     salience: 4 });
  store._db.prepare('UPDATE memories SET created_at = ? WHERE id = ?').run(old, rid);
  store._db.prepare('UPDATE memories SET created_at = ? WHERE id = ?').run(old, tid);
  assert.equal(store.getRipePredictions('matt', 10, now).length, 0);
});

test('getRipePredictions re-ripens a deferred prediction relative to asked_at', () => {
  const store = createMemoryStore(tmpDir());
  const now = store._now();
  const id  = store.addMemory('matt', { type: 'prediction', content: 'x', status: 'open', salience: 4 });
  const threshold = 14 + (id % 7) - 3;
  // created long ago, but asked just now -> measured from asked_at, NOT ripe
  store._db.prepare('UPDATE memories SET created_at = ?, asked_at = ? WHERE id = ?')
    .run(now - 100 * 86400, now, id);
  assert.equal(store.getRipePredictions('matt', 10, now).length, 0);
  // asked_at pushed past the window -> ripe again
  store._db.prepare('UPDATE memories SET asked_at = ? WHERE id = ?')
    .run(now - (threshold + 1) * 86400, id);
  assert.equal(store.getRipePredictions('matt', 10, now).length, 1);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/memory-store.test.js`
Expected: FAIL — `store.getRipePredictions is not a function`.

- [ ] **Step 3: Implement the query**

In `data/memory-store.js`, add a prepared statement near `stmtOpenUnasked` (after it):

```js
  const stmtRipePredictions = db.prepare(`
    SELECT * FROM memories
    WHERE reader_slug = ? AND type = 'prediction' AND status = 'open'
      AND (? - COALESCE(asked_at, created_at)) >= (14 + (id % 7) - 3) * 86400
    ORDER BY salience DESC, updated_at DESC
    LIMIT ?
  `);
```

Add the function near `getOpenUnaskedThreads`:

```js
  function getRipePredictions(slug, limit = 3, nowTs = now()) {
    return stmtRipePredictions.all(slug, nowTs, limit);
  }
```

Add `getRipePredictions` to the returned object (the `return { ... }` near the bottom of the factory), e.g. after `getOpenUnaskedThreads, markAsked,`:

```js
    getRipePredictions,
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/memory-store.test.js`
Expected: PASS (all prior store tests still pass).

- [ ] **Step 5: Commit**

```bash
git add data/memory-store.js tests/memory-store.test.js
git commit -m "feat: getRipePredictions ripeness gate with per-id jitter"
```

---

## Task 3: Verdict handling in `applyOps` RESOLVE

**Files:**
- Modify: `data/memory-store.js` (`VERDICTS` const, RESOLVE branch, result shape)
- Test: `tests/memory-store.test.js`

- [ ] **Step 1: Write the failing tests**

Add at the end of `tests/memory-store.test.js`:

```js
test('applyOps RESOLVE with a verdict tags the outcome event', () => {
  const store = createMemoryStore(tmpDir());
  const pid = store.addMemory('matt', { type: 'prediction', content: 'friction in the move', status: 'open', salience: 4 });
  const res = store.applyOps('matt',
    [{ op: 'RESOLVE', id: pid, verdict: 'came_to_pass', outcome: 'The move brought the friction we saw.' }],
    'threshold', null);
  assert.equal(res.resolved, 1);
  assert.equal(store.getMemory(pid).status, 'resolved');
  const outcome = store.listMemories('matt').find(m => m.type === 'event' && m.subject === 'verdict:came_to_pass');
  assert.ok(outcome);
  assert.equal(outcome.content, 'The move brought the friction we saw.');
});

test('applyOps RESOLVE too_soon defers without resolving and creates no outcome', () => {
  const store = createMemoryStore(tmpDir());
  const pid = store.addMemory('matt', { type: 'prediction', content: 'x', status: 'open', salience: 4 });
  const res = store.applyOps('matt',
    [{ op: 'RESOLVE', id: pid, verdict: 'too_soon', outcome: 'ignored' }], 'threshold', null);
  assert.equal(res.resolved, 0);
  assert.equal(res.deferred, 1);
  const m = store.getMemory(pid);
  assert.equal(m.status, 'open');
  assert.ok(m.asked_at > 0);
  assert.equal(store.listMemories('matt').filter(x => x.type === 'event').length, 0);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/memory-store.test.js`
Expected: FAIL — first test: no event with `subject === 'verdict:came_to_pass'`; second: `res.deferred` is `undefined`.

- [ ] **Step 3: Implement verdict + too_soon handling**

In `data/memory-store.js`, add a constant beside `TYPES`/`STATUSES` near the top of the module:

```js
const VERDICTS = ['came_to_pass', 'did_not', 'partly'];
```

In `applyOps`, change the result initializer to include `deferred`:

```js
    const result = { added: 0, updated: 0, touched: 0, resolved: 0, deferred: 0 };
```

Replace the existing `else if (kind === 'RESOLVE') { ... }` block with:

```js
      } else if (kind === 'RESOLVE') {
        const row = stmtGetForSlug.get(op.id, slug);
        if (!row) continue;
        const verdict = typeof op.verdict === 'string' ? op.verdict : null;
        if (verdict === 'too_soon') {
          stmtMarkAsked.run(t, op.id); // defer: re-stamp asked_at, leave status open
          result.deferred++;
          continue;
        }
        stmtResolveStatus.run(t, op.id, slug);
        if (op.outcome && String(op.outcome).trim()) {
          const outcomeId = addMemory(slug, {
            type: 'event', content: String(op.outcome).trim(),
            subject: VERDICTS.includes(verdict) ? `verdict:${verdict}` : null,
            salience: op.salience, source_kind: sourceKind, source_id: sourceId,
          });
          stmtLink.run(outcomeId, op.id, 'resolves');
        }
        result.resolved++;
      }
```

(`stmtMarkAsked` is already defined above in the module. `addMemory` already accepts `subject`.)

Optionally export `VERDICTS` for reuse — add to the returned object: `VERDICTS,` beside `TYPES, STATUSES`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/memory-store.test.js`
Expected: PASS — including the pre-existing "RESOLVE marks the thread resolved" test (threads pass no verdict → `subject` null, behaviour unchanged).

- [ ] **Step 5: Commit**

```bash
git add data/memory-store.js tests/memory-store.test.js
git commit -m "feat: RESOLVE verdict tagging + too_soon deferral"
```

---

## Task 4: Threshold capture prompt handles predictions

**Files:**
- Modify: `data/memory-engine.js` (`buildThresholdCapturePrompt`)
- Test: `tests/memory-engine.test.js`

- [ ] **Step 1: Write the failing test**

Add at the end of `tests/memory-engine.test.js`:

```js
test('buildThresholdCapturePrompt asks for verdicts on predictions', () => {
  const p = buildThresholdCapturePrompt(
    [{ id: 5, type: 'prediction', content: 'friction in the move', status: 'open' }],
    'it did happen'
  );
  assert.ok(p.includes('friction in the move'));
  assert.ok(/verdict/i.test(p));
  assert.ok(p.includes('came_to_pass'));
  assert.ok(p.includes('too_soon'));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/memory-engine.test.js`
Expected: FAIL — current prompt has no "verdict"/"came_to_pass" text.

- [ ] **Step 3: Rewrite the prompt to be type-aware**

In `data/memory-engine.js`, replace the whole `buildThresholdCapturePrompt` function with:

```js
function buildThresholdCapturePrompt(items, answer) {
  const block = (items || [])
    .map(t => `#${t.id} [${t.type || 'thread'}/${t.status || '-'}] ${t.content}`).join('\n');
  return `WHAT MIRIEL ASKED ABOUT:
${block}

WHAT THE PERSON SAID:
"${String(answer || '').slice(0, 1000)}"

Update memory. Respond with ONLY a JSON object:

{"operations":[
  {"op":"RESOLVE","id":7,"verdict":"came_to_pass","outcome":"one short line in Miriel's voice on how it concluded"},
  {"op":"UPDATE","id":8,"status":"moving","content":"refined one-sentence state"},
  {"op":"ADD","type":"event","content":"a new specific thing they mentioned","salience":3}
]}

Rules:
- For a PREDICTION (type prediction) the person reports on, emit RESOLVE with:
    "verdict": one of "came_to_pass", "did_not", "partly", or "too_soon" (use too_soon ONLY if it genuinely cannot be judged yet);
    "outcome": a single short line in Miriel's own voice (e.g. "The time with Maggie has ended."). Omit "outcome" when the verdict is too_soon.
- For a THREAD (type thread) the person reports as concluded, emit RESOLVE with an "outcome" line (no verdict needed).
- UPDATE a thread or prediction still in motion — set status "moving" and optionally refine content.
- ADD a new memory only for genuinely new specifics they mentioned (type: person|thread|event|feeling|prediction|fact|preference; salience 1-5).
- If they were vague or skipped, return {"operations":[]}.
- Record only what they actually said. Do not invent.`;
}
```

(Existing test "lists threads by id and asks for ops including RESOLVE" still passes: `#7`, the answer text, and `RESOLVE` are all present.)

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/memory-engine.test.js`
Expected: PASS (including the pre-existing threshold-capture tests).

- [ ] **Step 5: Commit**

```bash
git add data/memory-engine.js tests/memory-engine.test.js
git commit -m "feat: threshold capture prompt requests prediction verdicts"
```

---

## Task 5: Greeting prompt + mode decision include predictions

**Files:**
- Modify: `data/memory-engine.js` (`decideThresholdMode`, `buildGreetingPrompt`, add `predictionLines` helper)
- Test: `tests/memory-engine.test.js`

- [ ] **Step 1: Write the failing tests**

Add at the end of `tests/memory-engine.test.js`:

```js
test('decideThresholdMode triggers on ripe predictions even with no threads', () => {
  const now = 1000000;
  const pred = [{ id: 1, content: 'the move would bring friction' }];
  assert.equal(decideThresholdMode(now - 5 * 86400, [], now, undefined, pred), 'reunion');
  assert.equal(decideThresholdMode(now, [], now, undefined, []), 'none');
});

test('buildGreetingPrompt weaves in a ripe prediction', () => {
  const p = buildGreetingPrompt('reunion', [], 11, [{ id: 1, content: 'the move would bring friction' }]);
  assert.ok(p.includes('the move would bring friction'));
  assert.ok(/foretold|foretelling|cards spoke|come to pass/i.test(p));
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/memory-engine.test.js`
Expected: FAIL — `decideThresholdMode` ignores the 5th arg (returns 'none' for empty threads); `buildGreetingPrompt` ignores predictions.

- [ ] **Step 3: Implement**

In `data/memory-engine.js`, replace `decideThresholdMode` with:

```js
function decideThresholdMode(lastVisitTs, threads, now, gapDays = REUNION_GAP_DAYS, predictions = []) {
  const hasMaterial = (threads && threads.length) || (predictions && predictions.length);
  if (!hasMaterial) return 'none';
  const gap = (lastVisitTs == null) ? Infinity : (now - Number(lastVisitTs)) / 86400;
  return gap >= gapDays ? 'reunion' : 'gentle';
}
```

Add a helper next to `threadLines`:

```js
function predictionLines(predictions) {
  return (predictions || []).map(p => `- ${p.content}`).join('\n');
}
```

Replace the whole `buildGreetingPrompt` function with:

```js
function buildGreetingPrompt(mode, threads, gapDays, predictions = []) {
  const gap = Math.max(0, Math.round(gapDays));
  const gapPhrase = !isFinite(gapDays)
    ? 'It has been some time since they last sat with you.'
    : `About ${gap} day${gap === 1 ? '' : 's'} have passed since they last sat with you.`;

  const hasThreads = threads && threads.length;
  const hasPreds   = predictions && predictions.length;

  const threadBlock = hasThreads
    ? `Open thread${threads.length > 1 ? 's' : ''} still between you:\n${threadLines(threads)}`
    : '';
  const predBlock = hasPreds
    ? `Foretelling${predictions.length > 1 ? 's' : ''} the cards once spoke through you, which may have come to pass by now:\n${predictionLines(predictions)}`
    : '';
  const material = [threadBlock, predBlock].filter(Boolean).join('\n\n');
  const both = hasThreads && hasPreds;

  const askParts = [];
  if (hasThreads) askParts.push(`what came of ${threads.length > 1 ? 'them' : 'it'}`);
  if (hasPreds)   askParts.push('whether what the cards foretold has come to pass');
  const ask = askParts.join(', and ');

  if (mode === 'gentle') {
    return `This person has just returned for a reading. ${gapPhrase}
${material}

Greet them warmly and briefly, in your own voice, and gently ask ${ask} — woven in naturally, not as a form. Two or three sentences. Do not begin the reading yet. Speak only your greeting.`;
  }
  return `This person has just returned to you after a real absence. ${gapPhrase}
${material}

Greet them the way you would greet someone you know well who has been away — acknowledge the gap as you naturally would, then say you have been holding ${both ? 'these' : 'this'} for them, and ask ${ask}. Warm, unhurried, unmistakably you. Three to five sentences. Do not begin the reading. Speak only your greeting and your question.`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/memory-engine.test.js`
Expected: PASS — including pre-existing `buildGreetingPrompt` reunion/gentle tests (gap `11`, the thread content, and `returned` are all still present).

- [ ] **Step 5: Commit**

```bash
git add data/memory-engine.js tests/memory-engine.test.js
git commit -m "feat: greeting + mode decision fold in ripe predictions"
```

---

## Task 6: Engine pass-through for `getRipePredictions`

**Files:**
- Modify: `data/memory-engine.js` (engine returned object)
- Test: `tests/memory-engine.test.js`

- [ ] **Step 1: Write the failing test**

Add at the end of `tests/memory-engine.test.js`:

```js
test('engine.getRipePredictions passes through to the store', () => {
  const engine = createMemoryEngine(tmpDir());
  const now = engine._store._now();
  const id  = engine._store.addMemory('matt', { type: 'prediction', content: 'p', status: 'open', salience: 4 });
  engine._store._db.prepare('UPDATE memories SET created_at = ? WHERE id = ?').run(now - 30 * 86400, id);
  assert.equal(engine.getRipePredictions('matt', 5, now).length, 1);
});
```

(`createMemoryEngine` is already required at the top of this test file — see existing `captureThresholdAnswer` tests.)

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/memory-engine.test.js`
Expected: FAIL — `engine.getRipePredictions is not a function`.

- [ ] **Step 3: Add the pass-through**

In `data/memory-engine.js`, in the engine's returned object (where `getOpenUnaskedThreads`, `markAsked` pass-throughs are defined), add:

```js
    getRipePredictions: (slug, limit, nowTs) => store.getRipePredictions(slug, limit, nowTs),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/memory-engine.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add data/memory-engine.js tests/memory-engine.test.js
git commit -m "feat: engine getRipePredictions pass-through"
```

---

## Task 7: Wire predictions into the Threshold endpoints

**Files:**
- Modify: `server.js` (`GET /api/threshold` ~line 910, `POST /api/threshold/answer` ~line 950)

No unit test (Express route over live LLM). Verified by the integration smoke test in Task 10.

- [ ] **Step 1: Gather + show ripe predictions in `GET /api/threshold`**

In `server.js`, in the `GET /api/threshold` handler, after the line:

```js
    const threads   = memory.getOpenUnaskedThreads(slug, REUNION_MAX_THREADS, THRESHOLD_SALIENCE_BAR);
```

add:

```js
    const predictions = memory.getRipePredictions(slug, REUNION_MAX_THREADS, now);
```

Replace:

```js
    const mode      = decideThresholdMode(lastVisit, threads, now);
```

with:

```js
    const mode      = decideThresholdMode(lastVisit, threads, now, REUNION_GAP_DAYS, predictions);
```

Replace the block that computes `shown` and builds the greeting:

```js
    const shown = mode === 'gentle' ? threads.slice(0, 1) : threads;
    const gapDays = lastVisit == null ? Infinity : (now - Number(lastVisit)) / 86400;

    const persona = `${READER_PERSONA}${buildAddressingNote(reader.name)}`;
    let greeting;
    try {
      greeting = await callLLM(persona, buildGreetingPrompt(mode, shown, gapDays), 700, 'claude-sonnet-4-6');
```

with:

```js
    const shownThreads     = mode === 'gentle' ? threads.slice(0, 1) : threads;
    const shownPredictions = mode === 'gentle'
      ? (shownThreads.length ? [] : predictions.slice(0, 1))
      : predictions;
    const shown = [...shownThreads, ...shownPredictions];
    const gapDays = lastVisit == null ? Infinity : (now - Number(lastVisit)) / 86400;

    const persona = `${READER_PERSONA}${buildAddressingNote(reader.name)}`;
    let greeting;
    try {
      greeting = await callLLM(persona, buildGreetingPrompt(mode, shownThreads, gapDays, shownPredictions), 700, 'claude-sonnet-4-6');
```

The existing lines after the `try/catch` already read:

```js
    memory.markAsked(shown.map(t => t.id));
    memory.setMeta(`last_visit:${slug}`, String(now));
    res.json({ mode, greeting, threadIds: shown.map(t => t.id) });
```

These now correctly stamp and return both threads and predictions because `shown` is the combined array. Leave them unchanged.

Ensure `REUNION_GAP_DAYS` is imported. At the top of `server.js` the destructure currently reads:

```js
  decideThresholdMode, buildGreetingPrompt, buildReplyPrompt,
  REUNION_MAX_THREADS, THRESHOLD_SALIENCE_BAR,
```

Change to include `REUNION_GAP_DAYS`:

```js
  decideThresholdMode, buildGreetingPrompt, buildReplyPrompt,
  REUNION_MAX_THREADS, THRESHOLD_SALIENCE_BAR, REUNION_GAP_DAYS,
```

- [ ] **Step 2: Confirm `POST /api/threshold/answer` already routes predictions correctly**

No code change needed. The handler does:

```js
    const threads = (threadIds || []).map(id => memory._store.getMemory(id)).filter(Boolean);
    ...
    memory.captureThresholdAnswer(slug, answer, threadIds || [], callLLM)
```

`memory._store.getMemory(id)` returns predictions and threads alike (each row carries its own `type`), and `captureThresholdAnswer` → `captureAnswer` → `buildThresholdCapturePrompt` (now type-aware) handles both. The reply prompt (`buildReplyPrompt`) still reflects the answer warmly regardless of type. Verify by reading the handler; make no change.

- [ ] **Step 3: Sanity-check the server boots**

Run: `node -e "require('./server.js')"` then Ctrl-C, OR start it: `node server.js` and confirm "listening" with no throw, then stop it.
Expected: server starts without ReferenceError (confirms `REUNION_GAP_DAYS` import + `memory.getRipePredictions` resolve).

- [ ] **Step 4: Commit**

```bash
git add server.js
git commit -m "feat: Threshold gathers and asks about ripe predictions"
```

---

## Task 8: `getResolvedPredictions` store query (foretellings record)

**Files:**
- Modify: `data/memory-store.js` (new prepared statement, function, export)
- Test: `tests/memory-store.test.js`

- [ ] **Step 1: Write the failing test**

Add at the end of `tests/memory-store.test.js`:

```js
test('getResolvedPredictions joins prediction to its voiced outcome and verdict', () => {
  const store = createMemoryStore(tmpDir());
  const pid = store.addMemory('matt', { type: 'prediction', content: 'the move would bring friction', status: 'open', salience: 4 });
  store.applyOps('matt',
    [{ op: 'RESOLVE', id: pid, verdict: 'came_to_pass', outcome: 'The friction came, as the cards saw.' }],
    'threshold', null);

  const rows = store.getResolvedPredictions('matt', 10);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].foretelling, 'the move would bring friction');
  assert.equal(rows[0].outcome, 'The friction came, as the cards saw.');
  assert.equal(rows[0].verdict, 'came_to_pass');
});

test('getResolvedPredictions returns [] when there are none', () => {
  const store = createMemoryStore(tmpDir());
  assert.deepEqual(store.getResolvedPredictions('matt', 10), []);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/memory-store.test.js`
Expected: FAIL — `store.getResolvedPredictions is not a function`.

- [ ] **Step 3: Implement the join**

In `data/memory-store.js`, add a prepared statement (near the other `stmt*` definitions):

```js
  const stmtResolvedPredictions = db.prepare(`
    SELECT p.id AS prediction_id,
           p.content AS foretelling,
           p.updated_at AS resolved_at,
           e.content AS outcome,
           e.subject AS verdict_tag
    FROM memories p
    JOIN memory_links l ON l.to_id = p.id AND l.relation = 'resolves'
    JOIN memories e ON e.id = l.from_id
    WHERE p.reader_slug = ? AND p.type = 'prediction' AND p.status = 'resolved'
    ORDER BY p.updated_at DESC
    LIMIT ?
  `);
```

Add the function (near `getStats`):

```js
  function getResolvedPredictions(slug, limit = 20) {
    return stmtResolvedPredictions.all(slug, limit).map(r => ({
      prediction_id: r.prediction_id,
      foretelling:   r.foretelling,
      outcome:       r.outcome,
      verdict:       typeof r.verdict_tag === 'string' && r.verdict_tag.startsWith('verdict:')
                       ? r.verdict_tag.slice('verdict:'.length)
                       : null,
      resolved_at:   r.resolved_at,
    }));
  }
```

Add `getResolvedPredictions` to the factory's returned object.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/memory-store.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add data/memory-store.js tests/memory-store.test.js
git commit -m "feat: getResolvedPredictions join for the foretellings record"
```

---

## Task 9: `GET /api/foretellings/:slug` endpoint

**Files:**
- Modify: `server.js` (new route; engine pass-through)
- Modify: `data/memory-engine.js` (expose `getResolvedPredictions`)

- [ ] **Step 1: Expose the store method through the engine**

In `data/memory-engine.js`, in the engine's returned object (beside `listMemories`, `getStats`), add:

```js
    getResolvedPredictions: (slug, limit) => store.getResolvedPredictions(slug, limit),
```

- [ ] **Step 2: Add the route**

In `server.js`, add this route immediately after the `app.post('/api/reading-questions', ...)` handler (just before `app.get('/api/cache/stats', ...)`):

```js
// ── Foretellings — Miriel's record of predictions that came due ───────────────

app.get('/api/foretellings/:slug', (req, res) => {
  try {
    const slug = req.params.slug;
    const foretellings = memory.getResolvedPredictions(slug, 20);
    res.json({ foretellings });
  } catch (err) {
    console.warn('  ⚠  foretellings failed:', err.message);
    res.json({ foretellings: [] });
  }
});
```

- [ ] **Step 3: Verify the endpoint responds**

Start the server (`node server.js`), then in another shell:
Run: `curl -s http://localhost:3000/api/foretellings/matt`
Expected: JSON `{"foretellings":[...]}` (array may be empty). Confirm port matches the server's configured port; adjust if different. Stop the server.

- [ ] **Step 4: Commit**

```bash
git add server.js data/memory-engine.js
git commit -m "feat: GET /api/foretellings/:slug read-only record"
```

---

## Task 10: "Foretellings" section in the notebook overlay

**Files:**
- Modify: `public/app.js` (`openNotebook`, new `renderForetellings`)
- Modify: `public/style.css` (reuse existing notebook classes; add a small verdict marker style)

No automated frontend test (vanilla DOM). Verified by manual smoke test below.

- [ ] **Step 1: Fetch foretellings in `openNotebook`**

In `public/app.js`, in `openNotebook()`, after the profile fetch block:

```js
  let data = null;
  try {
    const r = await fetch(`/api/profiles/${encodeURIComponent(currentReader.slug)}`);
    if (r.ok) data = await r.json();
  } catch {}
```

add:

```js
  let foretellings = [];
  try {
    const fr = await fetch(`/api/foretellings/${encodeURIComponent(currentReader.slug)}`);
    if (fr.ok) foretellings = (await fr.json()).foretellings || [];
  } catch {}
```

Then, immediately before the existing `inner.appendChild(notebookEl('div', 'notebook-hint', ...))` line, add:

```js
  renderForetellings(inner, foretellings);
```

- [ ] **Step 2: Add the render function**

In `public/app.js`, add after `renderNotebookProfile` (anywhere in the notebook section):

```js
const VERDICT_LABELS = {
  came_to_pass: 'came to pass',
  did_not:      "didn't come",
  partly:       'came in part',
};

function renderForetellings(inner, foretellings) {
  if (!Array.isArray(foretellings) || !foretellings.length) return;
  inner.appendChild(notebookEl('div', 'notebook-eyebrow', 'Foretellings'));
  const list = notebookEl('div', 'notebook-foretellings');
  foretellings.forEach(f => {
    const row = notebookEl('div', 'notebook-foretelling');
    if (f.outcome) row.appendChild(notebookEl('p', 'notebook-foretelling-outcome', f.outcome));
    if (f.foretelling) row.appendChild(notebookEl('p', 'notebook-foretelling-claim', `She foretold: ${f.foretelling}`));
    const label = VERDICT_LABELS[f.verdict];
    if (label) row.appendChild(notebookEl('div', `notebook-foretelling-verdict verdict-${f.verdict}`, label));
    list.appendChild(row);
  });
  inner.appendChild(list);
}
```

- [ ] **Step 3: Add minimal styles**

In `public/style.css`, append (matching the existing notebook aesthetic — find the `.notebook-eyebrow` / `.notebook-notes` rules and place these nearby):

```css
.notebook-foretellings { margin: 0.5rem 0 1.25rem; }
.notebook-foretelling { margin-bottom: 1rem; }
.notebook-foretelling-outcome { font-style: italic; margin: 0 0 0.15rem; }
.notebook-foretelling-claim { opacity: 0.7; font-size: 0.85em; margin: 0 0 0.25rem; }
.notebook-foretelling-verdict {
  display: inline-block; font-size: 0.7em; letter-spacing: 0.08em;
  text-transform: uppercase; opacity: 0.75;
}
.verdict-came_to_pass { color: #b9975b; }
.verdict-did_not      { opacity: 0.5; }
.verdict-partly       { color: #8a9a8a; }
```

- [ ] **Step 4: Manual smoke test**

Seed a resolved prediction so the section renders, then view it:

```bash
node -e "const e=require('./data/memory-engine')('./data'); const id=e._store.addMemory('matt',{type:'prediction',content:'the move would bring friction',status:'open',salience:4}); e._store.applyOps('matt',[{op:'RESOLVE',id,verdict:'came_to_pass',outcome:'The friction came, as the cards saw.'}],'threshold',null); console.log('seeded', id);"
```

Start the server (`node server.js`), open the app, open the notebook overlay ("Your Story So Far"), and confirm a **Foretellings** section shows the outcome line, the original claim, and a "came to pass" marker. Stop the server.

(Cleanup is optional — the seeded row is real memory for `matt`. To remove it: `node -e "const e=require('./data/memory-engine')('./data'); e._store._db.prepare('DELETE FROM memories WHERE content=?').run('the move would bring friction');"` plus the linked outcome event if desired.)

- [ ] **Step 5: Commit**

```bash
git add public/app.js public/style.css
git commit -m "feat: Foretellings section in the notebook overlay"
```

---

## Task 11: Full suite + final verification

- [ ] **Step 1: Run the entire test suite**

Run: `node --test tests/`
Expected: all tests pass (the prior 87 + the new store/engine tests added here). Zero failures.

- [ ] **Step 2: Confirm the server boots cleanly**

Run: `node server.js`
Expected: starts and logs listening with no ReferenceError/throw. Stop it.

- [ ] **Step 3: Commit any final touch-ups**

```bash
git add -A
git commit -m "chore: outcome loop final verification" --allow-empty
```

---

## Self-Review notes (for the implementer)

- **Spec coverage:** Stage 1 → Task 1; Stage 2 → Tasks 2 & 6; Stage 3 → Tasks 3, 4, 5, 7; Stage 4 → Tasks 8, 9, 10. All four spec stages mapped.
- **No schema migration:** verdict rides `subject` ("verdict:*"); ripeness reuses `created_at`/`asked_at`; the join reuses `memory_links` (`resolves`). Confirmed against `data/memory-store.js`.
- **Backward compatibility:** new params are appended/optional (`buildGreetingPrompt`'s `predictions`, `decideThresholdMode`'s `predictions`, `buildThresholdCapturePrompt` renamed `threads`→`items` but same shape) so the 87 existing tests stay green. RESOLVE without a verdict (threads) behaves exactly as before.
- **Naming consistency:** `getRipePredictions`, `getResolvedPredictions`, `VERDICTS`, `result.deferred`, `verdict:<value>` subject tag used identically across store, engine, server, and frontend.
