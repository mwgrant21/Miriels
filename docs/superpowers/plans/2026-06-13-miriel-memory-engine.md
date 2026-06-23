# Miriel Memory Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Miriel an accumulating, structured, outcome-aware memory of the querent — captured after each reading, seeded from history, and recalled into future readings — so readings feel uncannily personal.

**Architecture:** A SQLite-backed memory store of discrete "atoms" (`data/memory-store.js`) wrapped by an orchestration layer (`data/memory-engine.js`) that does op-based capture (cheap Haiku extraction), deterministic in-process recall (no LLM on the reading's critical path), and a one-time back-fill from existing readings. `server.js` gains four surgical hooks: require, capture on save, recall into the persona, deferred back-fill on boot.

**Tech Stack:** Node.js, `better-sqlite3` (already a dependency), `node:test` for tests, the existing `callLLM(system, prompt, maxTokens, model)` helper.

---

## Prerequisites (read before starting)

- **Run tests with:** `node --test tests/*.test.js` (from the project root `C:\Users\Matt\projects\tarot`).
- **better-sqlite3 ABI:** these tests run under system Node. If any test fails with `ERR_DLOPEN_FAILED ... NODE_MODULE_VERSION`, the native binary was last built for Electron. Fix once with: `npm rebuild better-sqlite3`. (The `dist:win`/`dist:dmg` scripts re-rebuild for Electron before packaging, so this does not harm the build path.)
- **Baseline:** the suite is currently 32/32. Every task keeps it green and adds tests.
- **Pattern to imitate:** `data/interpretation-cache.js` (factory over prepared statements) and `tests/interpretation-cache.test.js` (tmpdir factory tests).

## File Structure

| File | Responsibility |
|------|----------------|
| `data/memory-store.js` (create) | Pure SQLite layer: schema, `addMemory`, `applyOps` (ADD/UPDATE/TOUCH), candidate queries, `markReferenced`, links, meta, stats. No LLM. Deterministic. |
| `data/memory-engine.js` (create) | Orchestration: `captureFromReading`, `recall`, `backfill`; plus the pure, exported-for-test helpers `parseExtractorOutput`, `scoreCandidates`, `formatRecallBlock`, `tokenize`. Owns the extraction prompts. |
| `tests/memory-store.test.js` (create) | Unit tests for the store. |
| `tests/memory-engine.test.js` (create) | Unit + integration tests for the engine (LLM mocked). |
| `server.js` (modify) | Wire engine in: require (~line 17), deferred back-fill after `migrateIfNeeded()` (~line 87), capture in `POST /api/readings` (~line 257), recall in `POST /api/interpret` (~line 587). |
| `package.json` (modify) | Add the two new `data/*.js` files to the electron-builder `files` allowlist (~lines 86–88). |

---

## Task 1: Memory store — schema + addMemory/getMemory

**Files:**
- Create: `data/memory-store.js`
- Test: `tests/memory-store.test.js`

- [ ] **Step 1: Write the failing test**

Create `tests/memory-store.test.js`:

```js
'use strict';
const { test } = require('node:test');
const assert   = require('node:assert/strict');
const os   = require('os');
const path = require('path');
const fs   = require('fs');
const createMemoryStore = require('../data/memory-store');

function tmpDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'tarot-memory-')); }

test('addMemory then getMemory round-trips core fields', () => {
  const store = createMemoryStore(tmpDir());
  const id = store.addMemory('matt', {
    type: 'thread', content: 'worried about the job interview',
    status: 'open', salience: 4, subject: 'work',
  });
  const m = store.getMemory(id);
  assert.equal(m.reader_slug, 'matt');
  assert.equal(m.type, 'thread');
  assert.equal(m.content, 'worried about the job interview');
  assert.equal(m.status, 'open');
  assert.equal(m.salience, 4);
  assert.equal(m.subject, 'work');
  assert.equal(m.reference_count, 0);
  assert.ok(m.created_at > 0);
});

test('addMemory clamps salience into 1..5 and defaults to 3', () => {
  const store = createMemoryStore(tmpDir());
  const a = store.getMemory(store.addMemory('matt', { type: 'fact', content: 'x', salience: 99 }));
  const b = store.getMemory(store.addMemory('matt', { type: 'fact', content: 'y' }));
  assert.equal(a.salience, 5);
  assert.equal(b.salience, 3);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/memory-store.test.js`
Expected: FAIL — `Cannot find module '../data/memory-store'`.

- [ ] **Step 3: Write minimal implementation**

Create `data/memory-store.js`:

```js
'use strict';
const path = require('path');
const Database = require('better-sqlite3');

const TYPES    = ['person', 'thread', 'event', 'feeling', 'prediction', 'fact', 'preference'];
const STATUSES = ['open', 'moving', 'resolved', 'dormant'];

function clampSalience(n) {
  const v = parseInt(n, 10);
  if (Number.isNaN(v)) return 3;
  return Math.min(5, Math.max(1, v));
}

module.exports = function createMemoryStore(dataDir) {
  const db = new Database(path.join(dataDir, 'memory.db'));
  db.pragma('journal_mode = WAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS memories (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      reader_slug        TEXT NOT NULL,
      type               TEXT NOT NULL,
      content            TEXT NOT NULL,
      status             TEXT,
      salience           INTEGER NOT NULL DEFAULT 3,
      subject            TEXT,
      source_kind        TEXT NOT NULL,
      source_id          TEXT,
      created_at         INTEGER NOT NULL,
      updated_at         INTEGER NOT NULL,
      last_referenced_at INTEGER,
      reference_count    INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_mem_slug        ON memories(reader_slug);
    CREATE INDEX IF NOT EXISTS idx_mem_slug_type   ON memories(reader_slug, type);
    CREATE INDEX IF NOT EXISTS idx_mem_slug_status ON memories(reader_slug, status);
    CREATE INDEX IF NOT EXISTS idx_mem_slug_sal    ON memories(reader_slug, salience);

    CREATE TABLE IF NOT EXISTS memory_links (
      from_id  INTEGER NOT NULL,
      to_id    INTEGER NOT NULL,
      relation TEXT NOT NULL,
      PRIMARY KEY (from_id, to_id, relation)
    );

    CREATE TABLE IF NOT EXISTS memory_meta (
      key   TEXT PRIMARY KEY,
      value TEXT
    );
  `);

  const now = () => Math.floor(Date.now() / 1000);

  const stmtAdd = db.prepare(`
    INSERT INTO memories
      (reader_slug, type, content, status, salience, subject, source_kind, source_id, created_at, updated_at)
    VALUES
      (@reader_slug, @type, @content, @status, @salience, @subject, @source_kind, @source_id, @created_at, @updated_at)
  `);
  const stmtGet = db.prepare('SELECT * FROM memories WHERE id = ?');

  function addMemory(slug, m) {
    const t = now();
    const info = stmtAdd.run({
      reader_slug: slug,
      type:        m.type,
      content:     m.content,
      status:      m.status || null,
      salience:    clampSalience(m.salience),
      subject:     m.subject || null,
      source_kind: m.source_kind || 'reading',
      source_id:   m.source_id != null ? String(m.source_id) : null,
      created_at:  t,
      updated_at:  t,
    });
    return info.lastInsertRowid;
  }

  function getMemory(id) { return stmtGet.get(id) || null; }

  return { addMemory, getMemory, _db: db, _now: now, TYPES, STATUSES, clampSalience };
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/memory-store.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add data/memory-store.js tests/memory-store.test.js
git commit -m "feat: memory store schema + addMemory/getMemory"
```

---

## Task 2: Memory store — applyOps (ADD / UPDATE / TOUCH)

**Files:**
- Modify: `data/memory-store.js`
- Test: `tests/memory-store.test.js`

- [ ] **Step 1: Write the failing tests**

Append to `tests/memory-store.test.js`:

```js
test('applyOps ADD inserts only valid-typed, non-empty atoms', () => {
  const store = createMemoryStore(tmpDir());
  const res = store.applyOps('matt', [
    { op: 'ADD', type: 'thread', content: 'a real thread', status: 'open', salience: 3 },
    { op: 'ADD', type: 'bogus',  content: 'ignored' },
    { op: 'ADD', type: 'fact',   content: '' },
  ], 'reading', 42);
  assert.equal(res.added, 1);
  const all = store.listMemories('matt');
  assert.equal(all.length, 1);
  assert.equal(all[0].source_kind, 'reading');
  assert.equal(all[0].source_id, '42');
});

test('applyOps UPDATE changes fields only for the matching slug', () => {
  const store = createMemoryStore(tmpDir());
  const id = store.addMemory('matt', { type: 'thread', content: 't', status: 'open' });
  store.applyOps('matt', [{ op: 'UPDATE', id, status: 'moving' }], 'reading', 1);
  assert.equal(store.getMemory(id).status, 'moving');
  store.applyOps('other', [{ op: 'UPDATE', id, status: 'resolved' }], 'reading', 1);
  assert.equal(store.getMemory(id).status, 'moving'); // untouched: wrong slug
});

test('applyOps TOUCH bumps reference_count for matching slug only', () => {
  const store = createMemoryStore(tmpDir());
  const id = store.addMemory('matt', { type: 'fact', content: 'f' });
  assert.equal(store.applyOps('matt', [{ op: 'TOUCH', id }], 'reading', 1).touched, 1);
  assert.equal(store.getMemory(id).reference_count, 1);
  assert.equal(store.applyOps('matt', [{ op: 'TOUCH', id: 9999 }], 'reading', 1).touched, 0);
});

test('applyOps ignores non-array input and junk ops safely', () => {
  const store = createMemoryStore(tmpDir());
  assert.deepEqual(store.applyOps('matt', null, 'reading', 1), { added: 0, updated: 0, touched: 0 });
  assert.deepEqual(store.applyOps('matt', [null, 5, {}, { op: 'NOPE' }], 'reading', 1),
                   { added: 0, updated: 0, touched: 0 });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/memory-store.test.js`
Expected: FAIL — `store.applyOps is not a function` (and `store.listMemories is not a function`).

- [ ] **Step 3: Write minimal implementation**

In `data/memory-store.js`, add these prepared statements after `const stmtGet = ...`:

```js
  const stmtGetForSlug = db.prepare('SELECT * FROM memories WHERE id = ? AND reader_slug = ?');
  const stmtUpdate = db.prepare(`
    UPDATE memories SET
      content    = COALESCE(@content,  content),
      status     = COALESCE(@status,   status),
      salience   = COALESCE(@salience, salience),
      subject    = COALESCE(@subject,  subject),
      updated_at = @updated_at
    WHERE id = @id AND reader_slug = @reader_slug
  `);
  const stmtTouch = db.prepare(`
    UPDATE memories SET reference_count = reference_count + 1, updated_at = ?
    WHERE id = ? AND reader_slug = ?
  `);
  const stmtList = db.prepare('SELECT * FROM memories WHERE reader_slug = ? ORDER BY created_at DESC');
```

Add these functions before the `return`:

```js
  function applyOps(slug, ops, sourceKind, sourceId) {
    const result = { added: 0, updated: 0, touched: 0 };
    if (!Array.isArray(ops)) return result;
    const t = now();
    for (const op of ops) {
      if (!op || typeof op !== 'object') continue;
      const kind = String(op.op || '').toUpperCase();
      if (kind === 'ADD') {
        if (!TYPES.includes(op.type)) continue;
        if (!op.content || !String(op.content).trim()) continue;
        addMemory(slug, {
          type:        op.type,
          content:     String(op.content).trim(),
          status:      STATUSES.includes(op.status) ? op.status : null,
          salience:    op.salience,
          subject:     op.subject,
          source_kind: sourceKind,
          source_id:   sourceId,
        });
        result.added++;
      } else if (kind === 'UPDATE') {
        if (!stmtGetForSlug.get(op.id, slug)) continue;
        stmtUpdate.run({
          id:         op.id,
          reader_slug: slug,
          content:    op.content  != null ? String(op.content).trim() : null,
          status:     STATUSES.includes(op.status) ? op.status : null,
          salience:   op.salience != null ? clampSalience(op.salience) : null,
          subject:    op.subject  != null ? String(op.subject) : null,
          updated_at: t,
        });
        result.updated++;
      } else if (kind === 'TOUCH') {
        if (stmtTouch.run(t, op.id, slug).changes) result.touched++;
      }
    }
    return result;
  }

  function listMemories(slug) { return stmtList.all(slug); }
```

Update the `return` object to include them:

```js
  return { addMemory, getMemory, applyOps, listMemories, _db: db, _now: now, TYPES, STATUSES, clampSalience };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/memory-store.test.js`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add data/memory-store.js tests/memory-store.test.js
git commit -m "feat: memory store applyOps (ADD/UPDATE/TOUCH) with validation"
```

---

## Task 3: Memory store — candidate query, markReferenced, links, meta, stats

**Files:**
- Modify: `data/memory-store.js`
- Test: `tests/memory-store.test.js`

- [ ] **Step 1: Write the failing tests**

Append to `tests/memory-store.test.js`:

```js
test('getOpenAndSalient orders open + salient first', () => {
  const store = createMemoryStore(tmpDir());
  store.addMemory('matt', { type: 'fact',   content: 'low fact',     salience: 1 });
  store.addMemory('matt', { type: 'thread', content: 'open big',     status: 'open',     salience: 5 });
  store.addMemory('matt', { type: 'thread', content: 'resolved big', status: 'resolved', salience: 5 });
  const rows = store.getOpenAndSalient('matt', 10);
  assert.equal(rows[0].content, 'open big');
});

test('markReferenced bumps reference_count and last_referenced_at', () => {
  const store = createMemoryStore(tmpDir());
  const id = store.addMemory('matt', { type: 'fact', content: 'f' });
  store.markReferenced([id]);
  const m = store.getMemory(id);
  assert.equal(m.reference_count, 1);
  assert.ok(m.last_referenced_at > 0);
});

test('meta get/set round-trips; links insert idempotently', () => {
  const store = createMemoryStore(tmpDir());
  assert.equal(store.getMeta('k'), null);
  store.setMeta('k', '1');
  assert.equal(store.getMeta('k'), '1');
  const a = store.addMemory('matt', { type: 'prediction', content: 'p', status: 'open' });
  const b = store.addMemory('matt', { type: 'event', content: 'e' });
  store.linkMemories(b, a, 'resolves');
  store.linkMemories(b, a, 'resolves'); // duplicate ignored by PK
  assert.equal(store.getLinks(b).length, 1);
});

test('getStats counts by type for the slug only', () => {
  const store = createMemoryStore(tmpDir());
  store.addMemory('matt',  { type: 'fact',   content: 'a' });
  store.addMemory('matt',  { type: 'fact',   content: 'b' });
  store.addMemory('matt',  { type: 'thread', content: 'c', status: 'open' });
  store.addMemory('other', { type: 'fact',   content: 'd' });
  assert.deepEqual(store.getStats('matt'), { fact: 2, thread: 1 });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/memory-store.test.js`
Expected: FAIL — `store.getOpenAndSalient is not a function`.

- [ ] **Step 3: Write minimal implementation**

In `data/memory-store.js`, add prepared statements after `stmtList`:

```js
  const stmtOpenSalient = db.prepare(`
    SELECT * FROM memories
    WHERE reader_slug = ?
    ORDER BY (status = 'open') DESC, salience DESC, updated_at DESC
    LIMIT ?
  `);
  const stmtMarkRef = db.prepare(`
    UPDATE memories SET reference_count = reference_count + 1, last_referenced_at = ?
    WHERE id = ?
  `);
  const stmtLink    = db.prepare('INSERT OR IGNORE INTO memory_links (from_id, to_id, relation) VALUES (?, ?, ?)');
  const stmtGetLinks = db.prepare('SELECT * FROM memory_links WHERE from_id = ?');
  const stmtGetMeta = db.prepare('SELECT value FROM memory_meta WHERE key = ?');
  const stmtSetMeta = db.prepare(`
    INSERT INTO memory_meta (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `);
  const stmtStats = db.prepare('SELECT type, COUNT(*) AS cnt FROM memories WHERE reader_slug = ? GROUP BY type');
```

Add functions before the `return`:

```js
  function getOpenAndSalient(slug, limit = 40) { return stmtOpenSalient.all(slug, limit); }

  function markReferenced(ids) {
    if (!Array.isArray(ids) || !ids.length) return;
    const t = now();
    const tx = db.transaction((arr) => { for (const id of arr) stmtMarkRef.run(t, id); });
    tx(ids);
  }

  function linkMemories(fromId, toId, relation) { stmtLink.run(fromId, toId, relation); }
  function getLinks(fromId) { return stmtGetLinks.all(fromId); }

  function getMeta(key) { const r = stmtGetMeta.get(key); return r ? r.value : null; }
  function setMeta(key, value) { stmtSetMeta.run(key, String(value)); }

  function getStats(slug) {
    const out = {};
    for (const r of stmtStats.all(slug)) out[r.type] = r.cnt;
    return out;
  }
```

Replace the `return` with the full surface:

```js
  return {
    addMemory, getMemory, applyOps, listMemories,
    getOpenAndSalient, markReferenced,
    linkMemories, getLinks, getMeta, setMeta, getStats,
    _db: db, _now: now, TYPES, STATUSES, clampSalience,
  };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/memory-store.test.js`
Expected: PASS (10 tests).

- [ ] **Step 5: Commit**

```bash
git add data/memory-store.js tests/memory-store.test.js
git commit -m "feat: memory store queries, markReferenced, links, meta, stats"
```

---

## Task 4: Engine — parseExtractorOutput (tolerant JSON parser)

**Files:**
- Create: `data/memory-engine.js`
- Test: `tests/memory-engine.test.js`

- [ ] **Step 1: Write the failing tests**

Create `tests/memory-engine.test.js`:

```js
'use strict';
const { test } = require('node:test');
const assert   = require('node:assert/strict');
const os   = require('os');
const path = require('path');
const fs   = require('fs');
const createMemoryEngine = require('../data/memory-engine');
const { parseExtractorOutput } = require('../data/memory-engine');

function tmpDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'tarot-engine-')); }

test('parseExtractorOutput reads operations from a clean object', () => {
  const ops = parseExtractorOutput('{"operations":[{"op":"ADD","type":"fact","content":"x"}]}');
  assert.equal(ops.length, 1);
  assert.equal(ops[0].type, 'fact');
});

test('parseExtractorOutput tolerates prose around the JSON', () => {
  const ops = parseExtractorOutput('Sure!\n{"operations":[{"op":"TOUCH","id":3}]}\nDone.');
  assert.equal(ops[0].op, 'TOUCH');
});

test('parseExtractorOutput accepts a bare array', () => {
  const ops = parseExtractorOutput('[{"op":"ADD","type":"fact","content":"y"}]');
  assert.equal(ops.length, 1);
});

test('parseExtractorOutput returns [] on garbage or empty', () => {
  assert.deepEqual(parseExtractorOutput('no json here'), []);
  assert.deepEqual(parseExtractorOutput(''), []);
  assert.deepEqual(parseExtractorOutput('{"operations": not json}'), []);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/memory-engine.test.js`
Expected: FAIL — `Cannot find module '../data/memory-engine'`.

- [ ] **Step 3: Write minimal implementation**

Create `data/memory-engine.js`:

```js
'use strict';
const createMemoryStore = require('./memory-store');

function parseExtractorOutput(raw) {
  if (!raw) return [];
  const text = String(raw);
  const objStart = text.indexOf('{');
  const arrStart = text.indexOf('[');
  try {
    if (objStart !== -1 && (arrStart === -1 || objStart < arrStart)) {
      const parsed = JSON.parse(text.slice(objStart, text.lastIndexOf('}') + 1));
      if (Array.isArray(parsed)) return parsed;
      if (parsed && Array.isArray(parsed.operations)) return parsed.operations;
      return [];
    }
    if (arrStart !== -1) {
      const parsed = JSON.parse(text.slice(arrStart, text.lastIndexOf(']') + 1));
      return Array.isArray(parsed) ? parsed : [];
    }
  } catch {
    return [];
  }
  return [];
}

module.exports = function createMemoryEngine(dataDir) {
  const store = createMemoryStore(dataDir);
  return {
    listMemories: (slug) => store.listMemories(slug),
    getStats:     (slug) => store.getStats(slug),
    _store: store,
  };
};

module.exports.parseExtractorOutput = parseExtractorOutput;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/memory-engine.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add data/memory-engine.js tests/memory-engine.test.js
git commit -m "feat: memory engine parseExtractorOutput tolerant parser"
```

---

## Task 5: Engine — scoreCandidates (deterministic recall scorer)

**Files:**
- Modify: `data/memory-engine.js`
- Test: `tests/memory-engine.test.js`

- [ ] **Step 1: Write the failing tests**

Append to `tests/memory-engine.test.js`:

```js
const { scoreCandidates } = require('../data/memory-engine');

function mem(o) {
  return Object.assign({
    id: 1, type: 'thread', content: '', status: 'open', salience: 3,
    subject: null, last_referenced_at: null, reference_count: 0,
  }, o);
}

test('scoreCandidates ranks open + keyword-matching + salient highest', () => {
  const cands = [
    mem({ id: 1, content: 'enjoys hiking on weekends', status: 'dormant', salience: 2 }),
    mem({ id: 2, content: 'anxious about the job interview at work', status: 'open', salience: 5, subject: 'work' }),
  ];
  const ranked = scoreCandidates(cands, {
    question: 'should I take the job?', cards: [{ name: 'The Tower' }], now: 1000000,
  });
  assert.equal(ranked[0].memory.id, 2);
});

test('scoreCandidates penalizes recently-referenced, over-exposed memories', () => {
  const now = 1000000;
  const fresh = mem({ id: 1, content: 'topic alpha beta', salience: 3, last_referenced_at: null, reference_count: 0 });
  const stale = mem({ id: 2, content: 'topic alpha beta', salience: 3, last_referenced_at: now - 60, reference_count: 9 });
  const ranked = scoreCandidates([stale, fresh], { question: 'topic alpha beta', cards: [], now });
  assert.equal(ranked[0].memory.id, 1);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/memory-engine.test.js`
Expected: FAIL — `scoreCandidates is not a function`.

- [ ] **Step 3: Write minimal implementation**

In `data/memory-engine.js`, add after `parseExtractorOutput`:

```js
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

function keywordOverlap(queryTokens, memTokens) {
  if (!queryTokens.size || !memTokens.length) return 0;
  const seen = new Set();
  let hits = 0;
  for (const w of memTokens) {
    if (queryTokens.has(w) && !seen.has(w)) { hits++; seen.add(w); }
  }
  return Math.min(1, hits / 3); // 3+ shared salient words = full marks
}

// Higher when we have NOT surfaced this memory recently — discourages repeating
// the same line every reading. Never-referenced memories score a full 1.
function freshness(lastRef, now) {
  if (!lastRef) return 1;
  const days = (now - lastRef) / 86400;
  return Math.min(1, days / 30);
}

function scoreMemory(m, queryTokens, now) {
  const statusW = m.status === 'open' ? 1 : m.status === 'moving' ? 0.6 : 0;
  const sal     = Math.min(5, Math.max(1, m.salience || 3)) / 5;
  const overlap = keywordOverlap(queryTokens, tokenize(`${m.content} ${m.subject || ''}`));
  const fresh   = freshness(m.last_referenced_at, now);
  const over    = Math.min(1, (m.reference_count || 0) / 5);
  return 2.0 * sal + 1.5 * statusW + 1.5 * overlap + 0.5 * fresh - 0.4 * over;
}

function scoreCandidates(candidates, { question, cards, now } = {}) {
  const cardNames   = (cards || []).map(c => c.name).join(' ');
  const queryTokens = new Set(tokenize(`${question || ''} ${cardNames}`));
  const t = now || Math.floor(Date.now() / 1000);
  return candidates
    .map(m => ({ memory: m, score: scoreMemory(m, queryTokens, t) }))
    .sort((a, b) => b.score - a.score);
}
```

Add the exports at the bottom (after the existing `module.exports.parseExtractorOutput` line):

```js
module.exports.scoreCandidates = scoreCandidates;
module.exports.tokenize = tokenize;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/memory-engine.test.js`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add data/memory-engine.js tests/memory-engine.test.js
git commit -m "feat: deterministic recall scorer (scoreCandidates)"
```

---

## Task 6: Engine — formatRecallBlock + recall()

**Files:**
- Modify: `data/memory-engine.js`
- Test: `tests/memory-engine.test.js`

- [ ] **Step 1: Write the failing tests**

Append to `tests/memory-engine.test.js`:

```js
const { formatRecallBlock } = require('../data/memory-engine');

test('formatRecallBlock returns empty string for no memories', () => {
  assert.equal(formatRecallBlock([]), '');
});

test('formatRecallBlock lists contents under the framing line', () => {
  const block = formatRecallBlock([{ content: 'afraid of being seen' }]);
  assert.ok(block.includes('hold them lightly'));
  assert.ok(block.includes('afraid of being seen'));
});

test('recall returns empty block when the store is empty', () => {
  const engine = createMemoryEngine(tmpDir());
  const r = engine.recall('matt', { question: 'x', cards: [] });
  assert.equal(r.block, '');
  assert.deepEqual(r.memories, []);
});

test('recall surfaces a relevant memory and marks it referenced', () => {
  const engine = createMemoryEngine(tmpDir());
  engine._store.addMemory('matt', {
    type: 'thread', content: 'anxious about the job interview',
    status: 'open', salience: 5, subject: 'work',
  });
  const r = engine.recall('matt', { question: 'will the job work out?', cards: [{ name: 'The Tower' }] });
  assert.ok(r.block.includes('job interview'));
  assert.equal(r.memories.length, 1);
  assert.equal(engine._store.getMemory(r.memories[0].id).reference_count, 1);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/memory-engine.test.js`
Expected: FAIL — `formatRecallBlock is not a function` and `engine.recall is not a function`.

- [ ] **Step 3: Write minimal implementation**

In `data/memory-engine.js`, add after `scoreCandidates`:

```js
const RECALL_LIMIT = 5;

function formatRecallBlock(memories) {
  if (!memories || !memories.length) return '';
  const lines = memories.map(m => `- ${m.content}`).join('\n');
  return `\n\nThings you remember about this person that may bear on what's in front of you now — ` +
         `hold them lightly, and bring them in only if the cards genuinely point there:\n${lines}`;
}
```

Inside the `createMemoryEngine` factory, add a `recall` function and expose it. Replace the current `return { ... }` inside the factory with:

```js
  function recall(slug, { question, cards } = {}) {
    let candidates = [];
    try { candidates = store.getOpenAndSalient(slug, 200); } catch { candidates = []; }
    if (!candidates.length) return { memories: [], block: '' };
    const chosen = scoreCandidates(candidates, { question, cards })
      .filter(r => r.score > 0)
      .slice(0, RECALL_LIMIT)
      .map(r => r.memory);
    if (!chosen.length) return { memories: [], block: '' };
    store.markReferenced(chosen.map(m => m.id));
    return { memories: chosen, block: formatRecallBlock(chosen) };
  }

  return {
    recall,
    listMemories: (slug) => store.listMemories(slug),
    getStats:     (slug) => store.getStats(slug),
    _store: store,
  };
```

Add the export at the bottom:

```js
module.exports.formatRecallBlock = formatRecallBlock;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/memory-engine.test.js`
Expected: PASS (10 tests).

- [ ] **Step 5: Commit**

```bash
git add data/memory-engine.js tests/memory-engine.test.js
git commit -m "feat: recall() + formatRecallBlock injection block"
```

---

## Task 7: Engine — captureFromReading (LLM extraction → ops)

**Files:**
- Modify: `data/memory-engine.js`
- Test: `tests/memory-engine.test.js`

- [ ] **Step 1: Write the failing tests**

Append to `tests/memory-engine.test.js`:

```js
test('captureFromReading applies extractor ops to the store', async () => {
  const engine = createMemoryEngine(tmpDir());
  const fakeLLM = async () =>
    '{"operations":[{"op":"ADD","type":"thread","content":"starting a new job soon","status":"open","salience":4,"subject":"work"}]}';
  const res = await engine.captureFromReading('matt',
    { id: 7, question: 'new job?', cards: [{ name: 'Ace of Pentacles' }], synopsis: 'beginnings' }, fakeLLM);
  assert.equal(res.added, 1);
  const all = engine.listMemories('matt');
  assert.equal(all.length, 1);
  assert.equal(all[0].source_kind, 'reading');
  assert.equal(all[0].source_id, '7');
});

test('captureFromReading persists nothing when output is unparseable', async () => {
  const engine = createMemoryEngine(tmpDir());
  const fakeLLM = async () => 'I could not find anything.';
  const res = await engine.captureFromReading('matt', { id: 8, cards: [] }, fakeLLM);
  assert.equal(res.added, 0);
  assert.equal(engine.listMemories('matt').length, 0);
});

test('captureFromReading swallows LLM errors without throwing', async () => {
  const engine = createMemoryEngine(tmpDir());
  const fakeLLM = async () => { throw new Error('network down'); };
  const res = await engine.captureFromReading('matt', { id: 9, cards: [] }, fakeLLM);
  assert.equal(res.added, 0);
  assert.ok(res.error);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/memory-engine.test.js`
Expected: FAIL — `engine.captureFromReading is not a function`.

- [ ] **Step 3: Write minimal implementation**

In `data/memory-engine.js`, add these module-level helpers after `formatRecallBlock`:

```js
const EXTRACT_MODEL = 'claude-haiku-4-5-20251001';

function summarizeReading(reading) {
  const cards = (reading.cards || [])
    .map(c => `${c.position ? c.position + ': ' : ''}${c.name}${c.isReversed ? ' (reversed)' : ''}`)
    .join(', ');
  const syn = reading.synopsis ? String(reading.synopsis).slice(0, 1200) : '';
  return `Date: ${reading.date || 'unknown'}\n` +
         `Spread: ${reading.spread || 'unknown'}\n` +
         `Question: ${reading.question ? `"${reading.question}"` : 'none'}\n` +
         `Cards: ${cards}\n` +
         `What Miriel said: ${syn}`;
}

const EXTRACT_SYSTEM =
  'You are the memory keeper for a tarot reader named Miriel. From a reading you extract durable, ' +
  'specific things worth remembering about the querent and their life, so Miriel can recall them in ' +
  'future readings. Be conservative: record only what is explicitly present in the question or in what ' +
  'Miriel observed. Never invent names, dates, or events. When unsure, leave it out.';

function buildCapturePrompt(reading, existing) {
  const existingBlock = existing.length
    ? existing.map(m => `#${m.id} [${m.type}/${m.status || '-'}] ${m.content}`).join('\n')
    : '(none yet)';
  return `READING:
${summarizeReading(reading)}

WHAT MIRIEL ALREADY REMEMBERS ABOUT THIS PERSON:
${existingBlock}

Decide what, if anything, to remember from this reading. Respond with ONLY a JSON object of this exact shape and nothing else:

{"operations":[
  {"op":"ADD","type":"thread","content":"one specific sentence","status":"open","salience":4,"subject":"optional short tag"},
  {"op":"UPDATE","id":12,"status":"moving"},
  {"op":"TOUCH","id":7}
]}

Rules:
- ADD a NEW memory only for something not already listed above. type is one of: person, thread, event, feeling, prediction, fact, preference. status (open|moving|resolved|dormant) applies to threads and predictions; omit it otherwise. salience is 1-5 (5 = central to their life). content is one specific sentence.
- UPDATE an existing memory by its #id when this reading adds detail or changes its status.
- TOUCH an existing memory by its #id when it simply came up again with nothing new.
- If there is genuinely nothing worth remembering, return {"operations":[]}.
- Record only what is explicitly present. Do not invent.`;
}
```

Inside the factory, add a `captureFromReading` function and expose it in the `return`:

```js
  async function captureFromReading(slug, reading, callLLM) {
    const existing = store.getOpenAndSalient(slug, 30);
    let raw;
    try {
      raw = await callLLM(EXTRACT_SYSTEM, buildCapturePrompt(reading, existing), 800, EXTRACT_MODEL);
    } catch (e) {
      return { added: 0, updated: 0, touched: 0, error: e.message };
    }
    const ops = parseExtractorOutput(raw);
    return store.applyOps(slug, ops, 'reading', reading && reading.id);
  }
```

Updated `return` inside the factory:

```js
  return {
    recall, captureFromReading,
    listMemories: (slug) => store.listMemories(slug),
    getStats:     (slug) => store.getStats(slug),
    _store: store,
  };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/memory-engine.test.js`
Expected: PASS (13 tests).

- [ ] **Step 5: Commit**

```bash
git add data/memory-engine.js tests/memory-engine.test.js
git commit -m "feat: captureFromReading extraction into memory store"
```

---

## Task 8: Engine — backfill (one-time, idempotent, resumable)

**Files:**
- Modify: `data/memory-engine.js`
- Test: `tests/memory-engine.test.js`

- [ ] **Step 1: Write the failing tests**

Append to `tests/memory-engine.test.js`:

```js
test('backfill seeds memories from history then is idempotent', async () => {
  const engine = createMemoryEngine(tmpDir());
  const readings = [
    { id: 1, question: 'career?', cards: [{ name: 'Ace of Pentacles' }], synopsis: 'a new beginning at work' },
    { id: 2, question: 'love?',   cards: [{ name: 'The Lovers' }],       synopsis: 'a choice in the heart' },
  ];
  let calls = 0;
  const fakeLLM = async () => { calls++; return '{"operations":[{"op":"ADD","type":"thread","content":"seeded note","status":"open","salience":3}]}'; };

  const r1 = await engine.backfill('matt', () => readings, fakeLLM);
  assert.ok(r1.added >= 1);
  const after = calls;

  const r2 = await engine.backfill('matt', () => readings, fakeLLM);
  assert.equal(r2.skipped, true);
  assert.equal(calls, after); // no further LLM calls once flagged done
});

test('backfill with no readings marks done without calling the LLM', async () => {
  const engine = createMemoryEngine(tmpDir());
  let calls = 0;
  const fakeLLM = async () => { calls++; return '{"operations":[]}'; };
  await engine.backfill('matt', () => [], fakeLLM);
  assert.equal(calls, 0);
  const r2 = await engine.backfill('matt', () => [], fakeLLM);
  assert.equal(r2.skipped, true);
});

test('backfill does not set the done flag when a chunk fails', async () => {
  const engine = createMemoryEngine(tmpDir());
  const loadReadings = () => [{ id: 1, cards: [], synopsis: 'x' }];
  const failLLM = async () => { throw new Error('boom'); };
  await assert.rejects(() => engine.backfill('matt', loadReadings, failLLM));
  // flag stays unset, so a retry with a working LLM proceeds
  const okLLM = async () => '{"operations":[{"op":"ADD","type":"fact","content":"recovered"}]}';
  const r = await engine.backfill('matt', loadReadings, okLLM);
  assert.ok(r.added >= 1);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/memory-engine.test.js`
Expected: FAIL — `engine.backfill is not a function`.

- [ ] **Step 3: Write minimal implementation**

In `data/memory-engine.js`, add module-level helpers after `buildCapturePrompt`:

```js
const BACKFILL_CHUNK = 12;

const BACKFILL_SYSTEM =
  'You are the memory keeper for a tarot reader named Miriel. You are reviewing a batch of past ' +
  'readings to seed her memory of this querent. Extract durable, specific things worth remembering. ' +
  'Be conservative: only what is explicitly present. Never invent names, dates, or events.';

function buildBackfillPrompt(readings) {
  const block = readings.map((r, i) => `--- Reading ${i + 1} ---\n${summarizeReading(r)}`).join('\n\n');
  return `PAST READINGS:
${block}

Extract what is worth remembering about this person. Respond with ONLY a JSON object:

{"operations":[
  {"op":"ADD","type":"thread","content":"one specific sentence","status":"open","salience":3,"subject":"optional tag"}
]}

Rules:
- Only ADD operations. type is one of: person, thread, event, feeling, prediction, fact, preference. status (open|moving|resolved|dormant) for threads and predictions only. salience 1-5. content is one specific sentence.
- Merge duplicates across readings into a single memory.
- Record only what is explicitly present. Do not invent. If nothing, return {"operations":[]}.`;
}
```

Inside the factory, add `backfill` and expose it:

```js
  async function backfill(slug, loadReadings, callLLM) {
    const flag = `backfilled:${slug}`;
    if (store.getMeta(flag)) return { skipped: true };

    const readings = loadReadings(slug) || [];
    if (!readings.length) { store.setMeta(flag, '1'); return { added: 0 }; }

    let added = 0;
    for (let i = 0; i < readings.length; i += BACKFILL_CHUNK) {
      const chunk = readings.slice(i, i + BACKFILL_CHUNK);
      // If this throws, the flag is never set, so a later run retries from scratch.
      const raw = await callLLM(BACKFILL_SYSTEM, buildBackfillPrompt(chunk), 1200, EXTRACT_MODEL);
      const ops = parseExtractorOutput(raw).filter(o => o && String(o.op).toUpperCase() === 'ADD');
      added += store.applyOps(slug, ops, 'backfill', null).added;
    }
    store.setMeta(flag, '1');
    return { added };
  }
```

Updated `return` inside the factory:

```js
  return {
    recall, captureFromReading, backfill,
    listMemories: (slug) => store.listMemories(slug),
    getStats:     (slug) => store.getStats(slug),
    _store: store,
  };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/memory-engine.test.js`
Expected: PASS (16 tests).

- [ ] **Step 5: Run the full suite**

Run: `node --test tests/*.test.js`
Expected: PASS — 32 existing + 26 new = 58 tests, 0 fail.

- [ ] **Step 6: Commit**

```bash
git add data/memory-engine.js tests/memory-engine.test.js
git commit -m "feat: one-time idempotent memory back-fill from history"
```

---

## Task 9: Wire the engine into server.js + packaging

**Files:**
- Modify: `server.js` (4 edits)
- Modify: `package.json` (electron-builder `files` allowlist)

There is no automated server test in this project (the suite tests modules only), so this task is careful edits + a manual smoke test.

- [ ] **Step 1: Require the engine**

In `server.js`, after the profile-manager require (around line 16–17):

```js
const createProfileManager = require('./data/reader-profile');
const profiles = createProfileManager(DATA_DIR);
```

add:

```js
const createMemoryEngine = require('./data/memory-engine');
const memory = createMemoryEngine(DATA_DIR);
```

- [ ] **Step 2: Kick off deferred back-fill on boot**

In `server.js`, immediately after the `migrateIfNeeded();` call (around line 87), add:

```js
// Seed Miriel's memory from existing history once per reader (deferred, non-blocking).
setImmediate(() => {
  for (const r of loadReaders()) {
    memory.backfill(r.slug, loadReadings, callLLM)
      .then(res => { if (res && res.added) console.log(`  + Memory back-filled for ${r.slug} (${res.added} memories)`); })
      .catch(err => console.warn(`  ⚠  Memory back-fill failed for ${r.slug}:`, err.message));
  }
});
```

(`loadReaders`, `loadReadings`, and `callLLM` are function declarations and are hoisted, so calling them inside the deferred `setImmediate` callback is safe even though `callLLM` appears later in the file.)

- [ ] **Step 3: Capture after a reading is saved**

In `POST /api/readings` (around lines 255–267), change the save so the entry is reused, then fire capture after the existing profile-refresh block. Replace:

```js
    const readers = loadReaders();
    const slug = req.body.reader || (readers[0] && readers[0].slug) || 'matt';
    appendReading({ ...req.body, id: Date.now() }, slug);
```

with:

```js
    const readers = loadReaders();
    const slug = req.body.reader || (readers[0] && readers[0].slug) || 'matt';
    const entry = { ...req.body, id: Date.now() };
    appendReading(entry, slug);
```

Then, immediately after the existing `if (totalReadings - lastSynth >= cadence) { ... }` block and before `res.json({ ok: true });`, add:

```js
    memory.captureFromReading(slug, entry, callLLM)
      .catch(err => console.warn('  ⚠  Memory capture failed:', err.message));
```

- [ ] **Step 4: Inject recall into the interpretation persona**

In `POST /api/interpret` (around lines 586–587), after:

```js
  const basePersona = `${READER_PERSONA}${buildAddressingNote(readerName)}`;
  const personaWithName = profiles.buildPersonaWithProfile(basePersona, readerProfile, readerReadingCount, cards);
```

add:

```js
  let memoryBlock = '';
  try {
    memoryBlock = memory.recall(slug, { question, cards }).block;
  } catch (err) {
    console.warn('  ⚠  Memory recall failed:', err.message);
  }
  const personaFinal = personaWithName + memoryBlock;
```

Then update the two model calls in the same handler (around lines 674 and 682) to use `personaFinal`:

```js
        text   = await callClaude(apiKey, personaFinal, prompt, 3000, 'claude-sonnet-4-6');
```

```js
        text = await callOllama(personaFinal, prompt, 3000);
```

- [ ] **Step 5: Add new modules to the electron-builder allowlist**

In `package.json`, inside `build.files` (around lines 84–88), after `"data/notebook.js",` add:

```json
      "data/memory-store.js",
      "data/memory-engine.js",
```

(Runtime data files `memory.db`, `memory.db-wal`, `memory.db-shm` are created in `DATA_DIR` at runtime and are intentionally NOT packaged — same posture as `readings`/`profiles`.)

- [ ] **Step 6: Confirm the full suite is still green**

Run: `node --test tests/*.test.js`
Expected: PASS — 58 tests, 0 fail. (server.js is not exercised by the suite; this confirms the edits did not break module loading.)

- [ ] **Step 7: Manual smoke test**

Start the server:

```bash
node server.js
```

Expected console: server starts on port 3000 with no errors; within a moment a back-fill line may appear if an API key is configured and history exists (`+ Memory back-filled for matt (...)`), or a warning if offline — neither should crash the server.

In a second terminal, save a reading and then request an interpretation:

```bash
curl -s -X POST http://localhost:3000/api/readings \
  -H "content-type: application/json" \
  -d '{"reader":"matt","date":"2026-06-13","spread":"single","question":"smoke test memory capture","cards":[{"id":"major-0","name":"The Fool","isReversed":false}],"synopsis":"a test of the memory engine"}'
# expect: {"ok":true}

curl -s -X POST http://localhost:3000/api/interpret \
  -H "content-type: application/json" \
  -d '{"reader":"matt","spread_type":"single","question":"smoke test","cards":[{"id":"major-0","name":"The Fool","isReversed":false}]}' | head -c 200
# expect: a JSON object with an "interpretation" field (HTTP 200), no error
```

Then confirm an atom was written (capture is async; allow a couple of seconds if an API key is set):

```bash
node -e "const e=require('./data/memory-engine')('./data'); console.log(e.getStats('matt'), e.listMemories('matt').slice(0,3).map(m=>m.content));"
# expect: a stats object and at least one remembered atom once capture completes
```

> If the smoke test runs offline (no API key, no Ollama), capture/back-fill produce no atoms — that is correct, not a failure. The store and recall still work; recall simply returns an empty block.

- [ ] **Step 8: Commit**

```bash
git add server.js package.json
git commit -m "feat: wire memory engine into readings, interpret, boot back-fill"
```

---

## Task 10: Final verification

**Files:** none (verification only)

- [ ] **Step 1: Run the complete suite**

Run: `node --test tests/*.test.js`
Expected: PASS — 58 tests, 0 fail.

- [ ] **Step 2: Confirm clean module load of the server**

Run: `node -e "process.env.PORT=0; require('./server.js'); setTimeout(()=>process.exit(0), 500);"`
Expected: no thrown errors (a startup log line is fine).

- [ ] **Step 3: Confirm the git history is clean and scoped**

Run: `git log --oneline -10`
Expected: the Task 1–9 commits present; `git status` shows only intended files (no stray `memory.db*` committed — they are runtime artifacts in `data/`).

> If `data/memory.db*` appear as untracked, that is expected (runtime data). Do not commit them. If the project lacks a rule for them, add `data/memory.db*` to `.gitignore` as an optional cleanup commit.

---

## Self-Review (completed during authoring)

- **Spec coverage:** §4 data model → Tasks 1–3; §5 capture → Task 7 (+ store ops Task 2); §6 recall → Tasks 5–6; §7 synthesis coexistence → Task 9 Step 4 (recall augments existing `buildPersonaWithProfile`, not replaces); §8 back-fill → Task 8 + Task 9 Step 2; §9 module/integration → Tasks 4–9; §10 scope (status lifecycle + `resolves` link data model) → schema in Task 1 + `linkMemories` in Task 3; §12 testing → tests in every task; deterministic-recall decision (§11 #3) → Task 5/6 (no LLM in `recall`). Out-of-scope items (Threshold UI, conversation, LLM rerank, embeddings) are correctly absent.
- **Placeholder scan:** none — every code step is complete.
- **Type/name consistency:** `addMemory`, `applyOps`, `getOpenAndSalient`, `markReferenced`, `getMeta`/`setMeta`, `linkMemories`/`getLinks`, `listMemories`, `getStats`, `recall`, `captureFromReading`, `backfill`, `parseExtractorOutput`, `scoreCandidates`, `formatRecallBlock`, `tokenize` are used identically across store, engine, tests, and server wiring. `summarizeReading` is shared by capture and back-fill prompts. `EXTRACT_MODEL` is the single source for the Haiku model id.
