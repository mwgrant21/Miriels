# Miriel Threshold Implementation Plan (Phase 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When you return to the app, Miriel greets you across the gap — recalls an open thread, asks what came of it, responds to your answer, and folds it back into memory — as a cinematic reunion (or a gentle inline ask on quick returns).

**Architecture:** Builds on the Phase-1 memory engine. Adds: an `asked_at` column + thread queries to the store; a pure mode-decision + prompt builders + answer-capture to the engine; two endpoints (`GET /api/threshold`, `POST /api/threshold/answer`) in server.js; and an interactive reunion overlay in the frontend that reuses the Miriel's-Choice takeover aesthetic.

**Tech Stack:** Node.js, `better-sqlite3`, `node:test`, the existing `callLLM(system, prompt, maxTokens, model)` and `READER_PERSONA` + `buildAddressingNote`.

---

## Prerequisites

- Run tests: `node --test tests/*.test.js` (from `C:\Users\Matt\projects\tarot`). Baseline after Phase 1: **60 pass**.
- If a test errors with `ERR_DLOPEN_FAILED ... NODE_MODULE_VERSION`: run `npm rebuild better-sqlite3` once.
- Branch: create `feat/miriel-threshold` off `master` before Task 1 (the executor handles branch setup).
- Pattern references: `data/memory-store.js`, `data/memory-engine.js`, `tests/memory-engine.test.js`. The cinematic overlay to imitate: `#miriel-takeover` in `public/index.html` (markup), `.miriel-takeover*` in `public/style.css` (style), `showMirielTakeover()` in `public/app.js`.

## File Structure

| File | Change | Responsibility |
|------|--------|----------------|
| `data/memory-store.js` | modify | `asked_at` migration; `getOpenUnaskedThreads`; `markAsked`; new `RESOLVE` op in `applyOps` (resolve thread + add outcome atom + link) |
| `data/memory-engine.js` | modify | `decideThresholdMode` (pure) + constants; prompt builders (`buildGreetingPrompt`, `buildReplyPrompt`, `buildThresholdCapturePrompt`); `captureThresholdAnswer`; engine pass-throughs |
| `tests/memory-store.test.js` | modify | store additions |
| `tests/memory-engine.test.js` | modify | engine additions |
| `server.js` | modify | `GET /api/threshold`, `POST /api/threshold/answer` |
| `public/index.html` | modify | `#threshold-overlay` markup |
| `public/style.css` | modify | threshold overlay styles |
| `public/app.js` | modify | `checkThreshold()` wired into `init()`; reunion/gentle render |

---

## Task 1: Store — `asked_at` migration, `getOpenUnaskedThreads`, `markAsked`

**Files:** Modify `data/memory-store.js`; Test `tests/memory-store.test.js`

- [ ] **Step 1: Write failing tests** — append to `tests/memory-store.test.js`:

```js
test('asked_at column exists and migrates onto a pre-existing db', () => {
  const dir = tmpDir();
  // simulate a pre-phase-2 db: create memories table WITHOUT asked_at, then open via factory
  const Database = require('better-sqlite3');
  const raw = new Database(require('path').join(dir, 'memory.db'));
  raw.exec(`CREATE TABLE memories (
    id INTEGER PRIMARY KEY AUTOINCREMENT, reader_slug TEXT NOT NULL, type TEXT NOT NULL,
    content TEXT NOT NULL, status TEXT, salience INTEGER NOT NULL DEFAULT 3, subject TEXT,
    source_kind TEXT NOT NULL, source_id TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
    last_referenced_at INTEGER, reference_count INTEGER NOT NULL DEFAULT 0);`);
  raw.close();
  const store = createMemoryStore(dir); // factory must ALTER TABLE to add asked_at
  const id = store.addMemory('matt', { type: 'thread', content: 't', status: 'open' });
  // asked_at present and null by default
  assert.equal(store.getMemory(id).asked_at, null);
});

test('getOpenUnaskedThreads returns only open/moving, unasked, salient threads', () => {
  const store = createMemoryStore(tmpDir());
  store.addMemory('matt', { type: 'thread',  content: 'open salient',  status: 'open',   salience: 4 });
  store.addMemory('matt', { type: 'thread',  content: 'low salience',  status: 'open',   salience: 1 });
  store.addMemory('matt', { type: 'thread',  content: 'resolved',      status: 'resolved', salience: 5 });
  store.addMemory('matt', { type: 'feeling', content: 'not a thread',  status: 'open',   salience: 5 });
  store.addMemory('matt', { type: 'thread',  content: 'moving ok',     status: 'moving', salience: 3 });
  const rows = store.getOpenUnaskedThreads('matt', 10, 3);
  const contents = rows.map(r => r.content);
  assert.ok(contents.includes('open salient'));
  assert.ok(contents.includes('moving ok'));
  assert.ok(!contents.includes('low salience'));
  assert.ok(!contents.includes('resolved'));
  assert.ok(!contents.includes('not a thread'));
});

test('markAsked sets asked_at and excludes from getOpenUnaskedThreads', () => {
  const store = createMemoryStore(tmpDir());
  const id = store.addMemory('matt', { type: 'thread', content: 'ask me', status: 'open', salience: 4 });
  store.markAsked([id]);
  assert.ok(store.getMemory(id).asked_at > 0);
  assert.equal(store.getOpenUnaskedThreads('matt', 10, 3).length, 0);
});
```

- [ ] **Step 2: Run, verify FAIL**

Run: `node --test tests/memory-store.test.js`
Expected: FAIL — `store.getOpenUnaskedThreads is not a function` (and asked_at undefined).

- [ ] **Step 3: Implement in `data/memory-store.js`**

After the `db.exec(\`...\`)` schema block (and before `const now = ...` or right after it), add a guarded migration:

```js
  // Phase-2 migration: add asked_at to pre-existing dbs (CREATE TABLE IF NOT EXISTS
  // never alters an existing table).
  const cols = db.prepare(`PRAGMA table_info(memories)`).all().map(c => c.name);
  if (!cols.includes('asked_at')) {
    db.exec(`ALTER TABLE memories ADD COLUMN asked_at INTEGER`);
  }
```

Add prepared statements (near the other `stmt*`):

```js
  const stmtOpenUnasked = db.prepare(`
    SELECT * FROM memories
    WHERE reader_slug = ? AND type = 'thread'
      AND status IN ('open','moving') AND asked_at IS NULL AND salience >= ?
    ORDER BY salience DESC, updated_at DESC
    LIMIT ?
  `);
  const stmtMarkAsked = db.prepare(`UPDATE memories SET asked_at = ? WHERE id = ?`);
```

Add functions before the `return`:

```js
  function getOpenUnaskedThreads(slug, limit = 3, minSalience = 3) {
    return stmtOpenUnasked.all(slug, minSalience, limit);
  }

  function markAsked(ids) {
    if (!Array.isArray(ids) || !ids.length) return;
    const t = now();
    const tx = db.transaction((arr) => { for (const id of arr) stmtMarkAsked.run(t, id); });
    tx(ids);
  }
```

Add both to the returned object (keep all existing keys):

```js
  return {
    addMemory, getMemory, applyOps, listMemories,
    getOpenAndSalient, markReferenced,
    getOpenUnaskedThreads, markAsked,
    linkMemories, getLinks, getMeta, setMeta, getStats,
    _db: db, _now: now, TYPES, STATUSES, clampSalience,
  };
```

- [ ] **Step 4: Run, verify PASS**

Run: `node --test tests/memory-store.test.js`
Expected: PASS (existing + 3 new).

- [ ] **Step 5: Commit**

```bash
git add data/memory-store.js tests/memory-store.test.js
git commit -m "feat: store asked_at migration + getOpenUnaskedThreads + markAsked"
```

---

## Task 2: Store — `RESOLVE` op in `applyOps` (resolve thread + outcome atom + link)

**Files:** Modify `data/memory-store.js`; Test `tests/memory-store.test.js`

- [ ] **Step 1: Write failing tests** — append to `tests/memory-store.test.js`:

```js
test('applyOps RESOLVE marks the thread resolved, adds an outcome atom, and links them', () => {
  const store = createMemoryStore(tmpDir());
  const threadId = store.addMemory('matt', { type: 'thread', content: 'the Portland job', status: 'open', salience: 4 });
  const res = store.applyOps('matt',
    [{ op: 'RESOLVE', id: threadId, outcome: 'took the job and moved' }], 'threshold', null);
  assert.equal(res.resolved, 1);
  // thread now resolved
  assert.equal(store.getMemory(threadId).status, 'resolved');
  // an outcome event atom exists, source_kind threshold
  const all = store.listMemories('matt');
  const outcome = all.find(m => m.type === 'event' && m.content === 'took the job and moved');
  assert.ok(outcome);
  assert.equal(outcome.source_kind, 'threshold');
  // a resolves link points from the outcome to the thread
  const links = store.getLinks(outcome.id);
  assert.ok(links.some(l => l.to_id === threadId && l.relation === 'resolves'));
});

test('applyOps RESOLVE ignores unknown id / wrong slug and counts nothing', () => {
  const store = createMemoryStore(tmpDir());
  const id = store.addMemory('matt', { type: 'thread', content: 't', status: 'open', salience: 4 });
  assert.equal(store.applyOps('matt',  [{ op: 'RESOLVE', id: 9999, outcome: 'x' }], 'threshold', null).resolved, 0);
  assert.equal(store.applyOps('other', [{ op: 'RESOLVE', id, outcome: 'x' }], 'threshold', null).resolved, 0);
  assert.equal(store.getMemory(id).status, 'open');
});
```

- [ ] **Step 2: Run, verify FAIL**

Run: `node --test tests/memory-store.test.js`
Expected: FAIL — `res.resolved` is `undefined`.

- [ ] **Step 3: Implement in `data/memory-store.js`**

Add a prepared statement (near the others):

```js
  const stmtResolve = db.prepare(`UPDATE memories SET status = 'resolved', updated_at = ? WHERE id = @id AND reader_slug = @slug`);
```

Note: rewrite as positional to match better-sqlite3 mixing rules — use this exact form instead:

```js
  const stmtResolveStatus = db.prepare(`UPDATE memories SET status = 'resolved', updated_at = ? WHERE id = ? AND reader_slug = ?`);
```

In `applyOps`, initialize `resolved` in the result and handle the op. Change the result initializer:

```js
    const result = { added: 0, updated: 0, touched: 0, resolved: 0 };
```

Add an `else if` branch inside the `for` loop, after the `TOUCH` branch:

```js
      } else if (kind === 'RESOLVE') {
        const row = stmtGetForSlug.get(op.id, slug);
        if (!row) continue;
        stmtResolveStatus.run(t, op.id, slug);
        if (op.outcome && String(op.outcome).trim()) {
          const outcomeId = addMemory(slug, {
            type: 'event', content: String(op.outcome).trim(),
            salience: op.salience, source_kind: sourceKind, source_id: sourceId,
          });
          stmtLink.run(outcomeId, op.id, 'resolves');
        }
        result.resolved++;
      }
```

(`stmtGetForSlug`, `stmtLink`, `addMemory`, `t` already exist in scope.)

- [ ] **Step 4: Run, verify PASS**

Run: `node --test tests/memory-store.test.js`
Expected: PASS (existing + 2 new).

- [ ] **Step 5: Commit**

```bash
git add data/memory-store.js tests/memory-store.test.js
git commit -m "feat: store RESOLVE op (resolve thread + outcome atom + resolves link)"
```

---

## Task 3: Engine — `decideThresholdMode` + constants

**Files:** Modify `data/memory-engine.js`; Test `tests/memory-engine.test.js`

- [ ] **Step 1: Write failing tests** — append to `tests/memory-engine.test.js`:

```js
const { decideThresholdMode } = require('../data/memory-engine');

const DAY = 86400;
function thread(o) { return Object.assign({ id: 1, type: 'thread', content: 't', status: 'open', salience: 4 }, o); }

test('decideThresholdMode: none when no threads', () => {
  assert.equal(decideThresholdMode(1000000, [], 1000000), 'none');
});
test('decideThresholdMode: reunion when gap >= 2 days', () => {
  const now = 1000000;
  assert.equal(decideThresholdMode(now - 3 * DAY, [thread()], now), 'reunion');
});
test('decideThresholdMode: gentle when gap < 2 days', () => {
  const now = 1000000;
  assert.equal(decideThresholdMode(now - 1 * DAY, [thread()], now), 'gentle');
});
test('decideThresholdMode: null last-visit counts as reunion (first visit after backfill)', () => {
  assert.equal(decideThresholdMode(null, [thread()], 1000000), 'reunion');
});
```

- [ ] **Step 2: Run, verify FAIL**

Run: `node --test tests/memory-engine.test.js`
Expected: FAIL — `decideThresholdMode is not a function`.

- [ ] **Step 3: Implement in `data/memory-engine.js`** — add at module level (e.g. after `formatRecallBlock`):

```js
const REUNION_GAP_DAYS      = 2;
const THRESHOLD_SALIENCE_BAR = 3;
const REUNION_MAX_THREADS   = 3;

function decideThresholdMode(lastVisitTs, threads, now, gapDays = REUNION_GAP_DAYS) {
  if (!threads || !threads.length) return 'none';
  const gap = (lastVisitTs == null) ? Infinity : (now - Number(lastVisitTs)) / 86400;
  return gap >= gapDays ? 'reunion' : 'gentle';
}
```

Add exports at the bottom (after the other `module.exports.X` lines):

```js
module.exports.decideThresholdMode = decideThresholdMode;
module.exports.REUNION_GAP_DAYS = REUNION_GAP_DAYS;
module.exports.THRESHOLD_SALIENCE_BAR = THRESHOLD_SALIENCE_BAR;
module.exports.REUNION_MAX_THREADS = REUNION_MAX_THREADS;
```

- [ ] **Step 4: Run, verify PASS**

Run: `node --test tests/memory-engine.test.js`
Expected: PASS (existing + 4 new).

- [ ] **Step 5: Commit**

```bash
git add data/memory-engine.js tests/memory-engine.test.js
git commit -m "feat: decideThresholdMode + threshold constants"
```

---

## Task 4: Engine — prompt builders (greeting, reply, attribution)

**Files:** Modify `data/memory-engine.js`; Test `tests/memory-engine.test.js`

- [ ] **Step 1: Write failing tests** — append to `tests/memory-engine.test.js`:

```js
const { buildGreetingPrompt, buildReplyPrompt, buildThresholdCapturePrompt } = require('../data/memory-engine');

test('buildGreetingPrompt includes the gap and the thread contents (reunion)', () => {
  const p = buildGreetingPrompt('reunion', [{ id: 1, content: 'the Portland job' }], 11);
  assert.ok(p.includes('the Portland job'));
  assert.ok(p.includes('11'));
  assert.ok(/reunion|returned|been a while|across the/i.test(p));
});
test('buildGreetingPrompt gentle is softer and single-thread', () => {
  const p = buildGreetingPrompt('gentle', [{ id: 1, content: 'the Portland job' }], 1);
  assert.ok(p.includes('the Portland job'));
});
test('buildReplyPrompt includes the answer and the threads', () => {
  const p = buildReplyPrompt([{ id: 1, content: 'the Portland job' }], 'I took it and moved');
  assert.ok(p.includes('I took it and moved'));
  assert.ok(p.includes('the Portland job'));
});
test('buildThresholdCapturePrompt lists threads by id and asks for ops including RESOLVE', () => {
  const p = buildThresholdCapturePrompt([{ id: 7, content: 'the Portland job', status: 'open' }], 'I took it');
  assert.ok(p.includes('#7'));
  assert.ok(p.includes('I took it'));
  assert.ok(p.includes('RESOLVE'));
});
```

- [ ] **Step 2: Run, verify FAIL**

Run: `node --test tests/memory-engine.test.js`
Expected: FAIL — `buildGreetingPrompt is not a function`.

- [ ] **Step 3: Implement in `data/memory-engine.js`** — add at module level (after `decideThresholdMode`):

```js
function threadLines(threads) {
  return (threads || []).map(t => `- ${t.content}`).join('\n');
}

function buildGreetingPrompt(mode, threads, gapDays) {
  const gap = Math.max(0, Math.round(gapDays));
  const gapPhrase = !isFinite(gapDays)
    ? 'It has been some time since they last sat with you.'
    : `About ${gap} day${gap === 1 ? '' : 's'} have passed since they last sat with you.`;
  if (mode === 'gentle') {
    return `This person has just returned for a reading. ${gapPhrase}
There is one thread from a past sitting still open between you:
${threadLines(threads)}

Greet them warmly and briefly, in your own voice, and gently ask what came of that one thing — woven in naturally, not as a form. Two or three sentences. Do not begin the reading yet. Speak only your greeting.`;
  }
  return `This person has just returned to you after a real absence. ${gapPhrase}
These threads from past sittings are still open between you:
${threadLines(threads)}

Greet them the way you would greet someone you know well who has been away — acknowledge the gap as you naturally would, then say you have been holding ${threads && threads.length > 1 ? 'these' : 'this'} for them, and ask what came of ${threads && threads.length > 1 ? 'them' : 'it'}. Warm, unhurried, unmistakably you. Three to five sentences. Do not begin the reading. Speak only your greeting and your question.`;
}

function buildReplyPrompt(threads, answer) {
  return `Moments ago you asked this person what had come of:
${threadLines(threads)}

They answered: "${String(answer || '').slice(0, 800)}"

Respond as Miriel — take in what they said and reflect it back briefly, with warmth and honesty, and let it settle into a single quiet bridge toward the reading to come. One or two sentences. Do not read the cards yet.`;
}

const THRESHOLD_CAPTURE_SYSTEM =
  'You are the memory keeper for a tarot reader named Miriel. The querent has just told Miriel ' +
  'what came of threads she remembered. Update her memory from their answer. Be conservative: ' +
  'only what they actually said. Never invent.';

function buildThresholdCapturePrompt(threads, answer) {
  const block = (threads || []).map(t => `#${t.id} [${t.status || '-'}] ${t.content}`).join('\n');
  return `THREADS MIRIEL ASKED ABOUT:
${block}

WHAT THE PERSON SAID:
"${String(answer || '').slice(0, 1000)}"

Update memory. Respond with ONLY a JSON object:

{"operations":[
  {"op":"RESOLVE","id":7,"outcome":"one sentence on how it concluded"},
  {"op":"UPDATE","id":8,"status":"moving","content":"refined one-sentence state"},
  {"op":"ADD","type":"event","content":"a new specific thing they mentioned","salience":3}
]}

Rules:
- RESOLVE a thread (by #id) the person reports as concluded; outcome is one sentence on what happened.
- UPDATE a thread (by #id) still in motion — set status "moving" and optionally refine content.
- ADD a new memory only for genuinely new specifics they mentioned (type: person|thread|event|feeling|prediction|fact|preference; status open|moving for threads/predictions; salience 1-5).
- If they were vague or skipped, return {"operations":[]}.
- Record only what they actually said. Do not invent.`;
}
```

Add exports at the bottom:

```js
module.exports.buildGreetingPrompt = buildGreetingPrompt;
module.exports.buildReplyPrompt = buildReplyPrompt;
module.exports.buildThresholdCapturePrompt = buildThresholdCapturePrompt;
```

- [ ] **Step 4: Run, verify PASS**

Run: `node --test tests/memory-engine.test.js`
Expected: PASS (existing + 4 new).

- [ ] **Step 5: Commit**

```bash
git add data/memory-engine.js tests/memory-engine.test.js
git commit -m "feat: threshold prompt builders (greeting, reply, attribution)"
```

---

## Task 5: Engine — `captureThresholdAnswer` + pass-throughs

**Files:** Modify `data/memory-engine.js`; Test `tests/memory-engine.test.js`

- [ ] **Step 1: Write failing tests** — append to `tests/memory-engine.test.js`:

```js
test('captureThresholdAnswer applies RESOLVE ops attributed to the threads', async () => {
  const engine = createMemoryEngine(tmpDir());
  const id = engine._store.addMemory('matt', { type: 'thread', content: 'the Portland job', status: 'open', salience: 4 });
  const fakeLLM = async () => `{"operations":[{"op":"RESOLVE","id":${id},"outcome":"took the job"}]}`;
  const res = await engine.captureThresholdAnswer('matt', 'I took it', [id], fakeLLM);
  assert.equal(res.resolved, 1);
  assert.equal(engine._store.getMemory(id).status, 'resolved');
  const outcome = engine.listMemories('matt').find(m => m.type === 'event' && m.content === 'took the job');
  assert.ok(outcome && outcome.source_kind === 'threshold');
});

test('captureThresholdAnswer swallows LLM errors', async () => {
  const engine = createMemoryEngine(tmpDir());
  const id = engine._store.addMemory('matt', { type: 'thread', content: 't', status: 'open', salience: 4 });
  const res = await engine.captureThresholdAnswer('matt', 'x', [id], async () => { throw new Error('down'); });
  assert.ok(res.error);
});

test('engine exposes getOpenUnaskedThreads, markAsked, getMeta/setMeta pass-throughs', () => {
  const engine = createMemoryEngine(tmpDir());
  engine._store.addMemory('matt', { type: 'thread', content: 'open', status: 'open', salience: 4 });
  assert.equal(engine.getOpenUnaskedThreads('matt', 3, 3).length, 1);
  engine.setMeta('last_visit:matt', '123');
  assert.equal(engine.getMeta('last_visit:matt'), '123');
  const t = engine.getOpenUnaskedThreads('matt', 3, 3)[0];
  engine.markAsked([t.id]);
  assert.equal(engine.getOpenUnaskedThreads('matt', 3, 3).length, 0);
});
```

- [ ] **Step 2: Run, verify FAIL**

Run: `node --test tests/memory-engine.test.js`
Expected: FAIL — `engine.captureThresholdAnswer is not a function`.

- [ ] **Step 3: Implement in `data/memory-engine.js`** — inside the factory, add the method and pass-throughs, and include them in the returned object:

```js
  async function captureThresholdAnswer(slug, answer, threadIds, callLLM) {
    const threads = (threadIds || []).map(id => store.getMemory(id)).filter(Boolean);
    let raw;
    try {
      raw = await callLLM(THRESHOLD_CAPTURE_SYSTEM, buildThresholdCapturePrompt(threads, answer), 600, EXTRACT_MODEL);
    } catch (e) {
      return { added: 0, updated: 0, touched: 0, resolved: 0, error: e.message };
    }
    const ops = parseExtractorOutput(raw);
    return store.applyOps(slug, ops, 'threshold', null);
  }
```

Update the factory's returned object to add the new method and pass-throughs (keep all existing keys):

```js
  return {
    recall, captureFromReading, backfill, captureThresholdAnswer,
    getOpenUnaskedThreads: (slug, limit, minSal) => store.getOpenUnaskedThreads(slug, limit, minSal),
    markAsked: (ids) => store.markAsked(ids),
    getMeta: (k) => store.getMeta(k),
    setMeta: (k, v) => store.setMeta(k, v),
    listMemories: (slug) => store.listMemories(slug),
    getStats:     (slug) => store.getStats(slug),
    _store: store,
  };
```

- [ ] **Step 4: Run, verify PASS**

Run: `node --test tests/memory-engine.test.js`
Expected: PASS (existing + 3 new).

- [ ] **Step 5: Run full suite**

Run: `node --test tests/*.test.js`
Expected: PASS — 0 fail (report totals).

- [ ] **Step 6: Commit**

```bash
git add data/memory-engine.js tests/memory-engine.test.js
git commit -m "feat: captureThresholdAnswer + engine threshold pass-throughs"
```

---

## Task 6: Server — `GET /api/threshold` and `POST /api/threshold/answer`

**Files:** Modify `server.js` (no automated test — manual verification)

Context: `server.js` already has `const memory = createMemoryEngine(DATA_DIR)`, `callLLM`, `getApiKey`, `READER_PERSONA`, `buildAddressingNote`, and `loadReaders`. The engine module also exports `decideThresholdMode`, `buildGreetingPrompt`, `buildReplyPrompt`, and the constants.

- [ ] **Step 1: Import the pure helpers**

Find the engine require near the top:

```js
const createMemoryEngine = require('./data/memory-engine');
const memory = createMemoryEngine(DATA_DIR);
```

Change it to also pull the pure helpers off the module:

```js
const createMemoryEngine = require('./data/memory-engine');
const memory = createMemoryEngine(DATA_DIR);
const {
  decideThresholdMode, buildGreetingPrompt, buildReplyPrompt,
  REUNION_MAX_THREADS, THRESHOLD_SALIENCE_BAR,
} = createMemoryEngine;
```

- [ ] **Step 2: Add the two endpoints**

Add immediately before the `app.get('/api/cache/stats'` handler:

```js
// ── The Threshold — Miriel greets you across the gap ─────────────────────────

app.get('/api/threshold', async (req, res) => {
  try {
    const readers = loadReaders();
    const slug = req.query.reader || (readers[0] && readers[0].slug) || 'matt';
    const reader = readers.find(r => r.slug === slug) || readers[0] || { name: 'you', slug };
    const now = Math.floor(Date.now() / 1000);

    const threads   = memory.getOpenUnaskedThreads(slug, REUNION_MAX_THREADS, THRESHOLD_SALIENCE_BAR);
    const lastVisit = memory.getMeta(`last_visit:${slug}`);
    const mode      = decideThresholdMode(lastVisit, threads, now);

    if (mode === 'none') {
      memory.setMeta(`last_visit:${slug}`, String(now));
      return res.json({ mode: 'none' });
    }

    const shown = mode === 'gentle' ? threads.slice(0, 1) : threads;
    const gapDays = lastVisit == null ? Infinity : (now - Number(lastVisit)) / 86400;

    const persona = `${READER_PERSONA}${buildAddressingNote(reader.name)}`;
    let greeting;
    try {
      greeting = await callLLM(persona, buildGreetingPrompt(mode, shown, gapDays), 700, 'claude-sonnet-4-6');
    } catch (err) {
      console.warn('  ⚠  Threshold greeting failed:', err.message);
      memory.setMeta(`last_visit:${slug}`, String(now));
      return res.json({ mode: 'none' }); // no wooden template reunion
    }

    memory.markAsked(shown.map(t => t.id));
    memory.setMeta(`last_visit:${slug}`, String(now));
    res.json({ mode, greeting, threadIds: shown.map(t => t.id) });
  } catch (err) {
    console.warn('  ⚠  Threshold failed:', err.message);
    res.json({ mode: 'none' });
  }
});

app.post('/api/threshold/answer', async (req, res) => {
  try {
    const readers = loadReaders();
    const slug = req.body.reader || (readers[0] && readers[0].slug) || 'matt';
    const reader = readers.find(r => r.slug === slug) || readers[0] || { name: 'you', slug };
    const { answer, threadIds } = req.body;

    const threads = (threadIds || []).map(id => memory._store.getMemory(id)).filter(Boolean);

    let reply = 'Thank you for telling me. Let us see what the cards have for you now.';
    try {
      const persona = `${READER_PERSONA}${buildAddressingNote(reader.name)}`;
      reply = await callLLM(persona, buildReplyPrompt(threads, answer), 400, 'claude-sonnet-4-6');
    } catch (err) {
      console.warn('  ⚠  Threshold reply failed (using fallback):', err.message);
    }

    memory.captureThresholdAnswer(slug, answer, threadIds || [], callLLM)
      .catch(err => console.warn('  ⚠  Threshold capture failed:', err.message));

    res.json({ reply });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
```

- [ ] **Step 3: Syntax check + suite**

Run: `node --check server.js` → expect "OK"
Run: `node --test tests/*.test.js` → expect 0 fail.

- [ ] **Step 4: Manual verification** (against a temp DATA_DIR with config copied, as in Phase-1 smoke)

```bash
rm -rf .smoke-data && mkdir .smoke-data && cp data/config.json .smoke-data/ 2>/dev/null
DATA_DIR="$(pwd)/.smoke-data" PORT=3101 node server.js &
sleep 1
# seed an open thread + a last_visit 3 days ago via the engine
node -e "const e=require('./data/memory-engine')(process.argv[1]); const id=e._store.addMemory('matt',{type:'thread',content:'the Portland job',status:'open',salience:4}); e.setMeta('last_visit:matt', String(Math.floor(Date.now()/1000)-3*86400)); console.log('seeded thread', id)" "$(pwd)/.smoke-data"
echo '--- GET threshold (expect mode reunion + greeting naming the job) ---'
curl -s "http://localhost:3101/api/threshold?reader=matt" | node -e "process.stdin.once('data',d=>{const j=JSON.parse(d);console.log('mode:',j.mode,'| ids:',JSON.stringify(j.threadIds),'| greeting:',(j.greeting||'').slice(0,160))})"
echo '--- POST answer (expect a reply) ---'
curl -s -X POST http://localhost:3101/api/threshold/answer -H 'content-type: application/json' -d '{"reader":"matt","answer":"I took the job and moved","threadIds":[1]}' | node -e "process.stdin.once('data',d=>console.log('reply:',(JSON.parse(d).reply||'').slice(0,160)))"
sleep 2
echo '--- thread now resolved + threshold atom? ---'
node -e "const e=require('./data/memory-engine')(process.argv[1]); for(const m of e.listMemories('matt')) console.log(m.type, m.status||'-', m.source_kind, '|', m.content)" "$(pwd)/.smoke-data"
echo '--- GET again (expect none — thread asked) ---'
curl -s "http://localhost:3101/api/threshold?reader=matt" | node -e "process.stdin.once('data',d=>console.log('mode:',JSON.parse(d).mode))"
```

Then kill the server (PowerShell): `Get-NetTCPConnection -LocalPort 3101 -State Listen | %{ Stop-Process -Id $_.OwningProcess -Force }`, and `rm -rf .smoke-data`.

Expected: first GET → `reunion` with a greeting that names the Portland job; POST → a warm reply; the thread becomes `resolved` and a `threshold` event atom appears; second GET → `none`.

- [ ] **Step 5: Commit**

```bash
git add server.js
git commit -m "feat: /api/threshold GET (greeting) + POST answer (reply + capture)"
```

---

## Task 7: Frontend — reunion overlay + gentle ask, wired into init

**Files:** Modify `public/index.html`, `public/style.css`, `public/app.js` (no automated test — manual smoke)

- [ ] **Step 1: Add overlay markup** — in `public/index.html`, after the existing `#miriel-takeover` overlay block (`</div>` that closes it, near line 273), add:

```html
  <!-- The Threshold — Miriel's memory-aware reunion greeting -->
  <div id="threshold-overlay" class="miriel-takeover threshold-overlay hidden" aria-hidden="true">
    <div class="miriel-takeover-inner threshold-inner">
      <div class="miriel-takeover-ornament">&#10022; &middot; &#10022; &middot; &#10022;</div>
      <div class="threshold-greeting" id="threshold-greeting"></div>
      <textarea id="threshold-answer" class="threshold-answer" rows="3" placeholder="Tell her, or leave it&hellip;"></textarea>
      <div class="threshold-reply" id="threshold-reply" hidden></div>
      <div class="threshold-actions">
        <button id="threshold-skip" class="threshold-btn ghost" type="button">Not now</button>
        <button id="threshold-continue" class="threshold-btn" type="button">Continue</button>
      </div>
    </div>
  </div>
```

- [ ] **Step 2: Add styles** — append to `public/style.css`:

```css
/* The Threshold reunion overlay (reuses .miriel-takeover backdrop/fade) */
.threshold-inner { max-width: 620px; padding: 8px 6px; }
.threshold-greeting {
  font-family: Georgia, 'Times New Roman', serif; font-size: 1.15rem; line-height: 1.7;
  color: #f1ebdf; white-space: pre-wrap; margin: 14px 0 18px; text-align: center;
}
.threshold-answer {
  width: 100%; box-sizing: border-box; background: rgba(255,255,255,0.05);
  border: 1px solid rgba(198,166,100,0.35); border-radius: 8px; color: #e8e0d0;
  font-family: Georgia, serif; font-size: 1rem; padding: 12px 14px; resize: vertical;
}
.threshold-reply {
  font-family: Georgia, serif; font-style: italic; color: #d8c79a; line-height: 1.7;
  margin: 16px 4px; text-align: center; white-space: pre-wrap;
}
.threshold-actions { display: flex; gap: 12px; justify-content: center; margin-top: 18px; }
.threshold-btn {
  background: linear-gradient(180deg,#c6a664,#9c7d3e); color:#1a1322; border:none;
  border-radius:8px; padding:10px 22px; font-weight:600; font-family:Georgia,serif; cursor:pointer;
}
.threshold-btn.ghost { background: transparent; color:#9a8f7c; border:1px solid rgba(255,255,255,0.15); }
.threshold-btn:disabled { opacity:.5; cursor:default; }
```

- [ ] **Step 3: Wire into `init()` and add `checkThreshold()`** — in `public/app.js`, change the `init()` body so the threshold runs before the greeting and suppresses it when it takes over. Replace this block in `init()`:

```js
  setupButtons();
  buildReaderUI();
  checkKeyStatus();
  checkForPriorSession();
  buildGreeting();
  buildDailyCardBar();
  renderHeaderMoon();
```

with:

```js
  setupButtons();
  buildReaderUI();
  checkKeyStatus();
  checkForPriorSession();
  const tookOver = await checkThreshold();
  if (!tookOver) buildGreeting();
  buildDailyCardBar();
  renderHeaderMoon();
```

Then add the `checkThreshold` function (place it just above `buildGreeting`):

```js
async function checkThreshold() {
  // Don't intrude on a resumed in-progress session.
  if (drawnCards.length) return false;
  let data;
  try {
    const r = await fetch(`/api/threshold?reader=${encodeURIComponent(currentReader.slug)}`);
    if (!r.ok) return false;
    data = await r.json();
  } catch { return false; }
  if (!data || data.mode === 'none' || !data.greeting) return false;

  const overlay  = document.getElementById('threshold-overlay');
  const greetEl  = document.getElementById('threshold-greeting');
  const answerEl = document.getElementById('threshold-answer');
  const replyEl  = document.getElementById('threshold-reply');
  const contBtn  = document.getElementById('threshold-continue');
  const skipBtn  = document.getElementById('threshold-skip');
  if (!overlay) return false;

  greetEl.textContent = data.greeting;
  answerEl.value = '';
  answerEl.hidden = false;
  replyEl.hidden = true; replyEl.textContent = '';
  contBtn.textContent = 'Continue';
  contBtn.disabled = false;

  overlay.classList.remove('hidden');
  requestAnimationFrame(() => requestAnimationFrame(() => overlay.classList.add('visible')));

  const dismiss = () => {
    overlay.classList.remove('visible');
    overlay.addEventListener('transitionend', function done() {
      overlay.classList.add('hidden');
      overlay.removeEventListener('transitionend', done);
    }, { once: true });
  };

  return await new Promise(resolve => {
    let replied = false;
    skipBtn.onclick = () => { dismiss(); resolve(true); };
    contBtn.onclick = async () => {
      if (replied) { dismiss(); resolve(true); return; }     // second press = begin
      const answer = answerEl.value.trim();
      if (!answer) { dismiss(); resolve(true); return; }      // empty = skip
      contBtn.disabled = true; contBtn.textContent = 'Speaking…';
      let reply = '';
      try {
        const r = await fetch('/api/threshold/answer', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reader: currentReader.slug, answer, threadIds: data.threadIds }),
        });
        if (r.ok) reply = (await r.json()).reply || '';
      } catch {}
      replied = true;
      answerEl.hidden = true;
      skipBtn.hidden = true;
      if (reply) { replyEl.textContent = reply; replyEl.hidden = false; }
      contBtn.disabled = false; contBtn.textContent = 'Begin';
    };
  });
}
```

(`checkThreshold` returns `true` when it showed the reunion — so `init()` skips the default greeting. Returns `false` to fall through to `buildGreeting()`.)

> NOTE on `gentle` mode: this implementation renders both `reunion` and `gentle` through the same overlay (the greeting text differs by mode server-side). That satisfies the spec's behavior; a lighter inline treatment for `gentle` can be a follow-up. Do not build a separate inline panel in this task.

- [ ] **Step 4: Manual smoke** (real app)

```bash
npm start
```
Then in a browser at `http://localhost:3000`: with a seeded open thread and an old `last_visit` (use the Task 6 seeding against the real `data` dir if you want to see it live, or just confirm a fresh reader shows the normal greeting). Verify: reunion overlay fades in with Miriel's greeting; typing an answer + Continue shows her reply and a "Begin" button; Begin dismisses into the app; "Not now" dismisses; reloading shows the normal greeting (thread now asked). Confirm a reader with no memory still gets the normal greeting (overlay never appears).

- [ ] **Step 5: Commit**

```bash
git add public/index.html public/style.css public/app.js
git commit -m "feat: Threshold reunion overlay wired into app open"
```

---

## Task 8: Final verification

**Files:** none

- [ ] **Step 1: Full suite** — `node --test tests/*.test.js` → expect 0 fail (report totals).
- [ ] **Step 2: Clean server load** — `node -e "process.env.DATA_DIR='./.vcheck'; require('./server.js'); setTimeout(()=>{console.log('ok');process.exit(0)},600)"` then `rm -rf .vcheck` → expect no thrown errors.
- [ ] **Step 3: Git history** — `git log --oneline master..HEAD` shows the Task 1–7 commits; `git status` clean (no `.smoke-data`, `.vcheck`, or `memory.db*` tracked).

---

## Self-Review (completed during authoring)

- **Spec coverage:** §3 triggering → Task 3 (`decideThresholdMode`) + Task 6 (endpoint wiring) + Task 1 (`getOpenUnaskedThreads` salience gate, `markAsked` rotation); §4 two-beat exchange → Task 6 (GET greeting, POST reply) + Task 7 (overlay flow); §4 capture/resolution → Task 2 (`RESOLVE` op + `resolves` link) + Task 5 (`captureThresholdAnswer`, `source_kind:'threshold'`); §5 models → Task 6 (Sonnet greeting/reply) + Task 5 (Haiku capture); §6 store/engine/endpoints → Tasks 1–6; §7 frontend → Task 7; §8 error handling → Task 6 (LLM-down → `mode:none`, no template; wrapped) + Task 7 (fetch errors → normal greeting); §9 testing → Tasks 1–5 unit + Tasks 6–7 manual; §10 decisions all reflected (gap=2, null=reunion, mark-on-show, no template, asked_at column).
- **Placeholder scan:** none — every code step is complete.
- **Type/name consistency:** `getOpenUnaskedThreads(slug, limit, minSalience)`, `markAsked(ids)`, `decideThresholdMode(lastVisitTs, threads, now, gapDays?)`, `buildGreetingPrompt(mode, threads, gapDays)`, `buildReplyPrompt(threads, answer)`, `buildThresholdCapturePrompt(threads, answer)`, `captureThresholdAnswer(slug, answer, threadIds, callLLM)`, the `RESOLVE` op + `{added,updated,touched,resolved}` result shape, and `source_kind:'threshold'` are used identically across store, engine, server, tests, and frontend. Server pulls `decideThresholdMode`/builders/constants off the `createMemoryEngine` module object (matching the bottom-of-file `module.exports.X` exports).
