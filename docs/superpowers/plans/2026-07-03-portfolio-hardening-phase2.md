# Portfolio Hardening Phase 2 — server.js Split Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the 1,276-line server.js into 9 route modules plus extracted `data/llm-client.js` and `data/reader-store.js` service modules, leaving server.js as ~120 lines of wiring — with API behavior byte-identical, pinned by a new integration test suite written BEFORE any refactoring.

**Architecture:** A `ctx` object assembled once in server.js carries shared services (store, llm, cache, profiles, memory, seasons, persona, paths) into route-factory modules (`routes/*.js`, each `module.exports = (ctx) => express.Router()`). Routers register FULL paths (`/api/...`) and are mounted bare (`app.use(router)`) so URL behavior cannot drift. Route handler bodies are transplanted verbatim; only identifier plumbing changes per the Reference Mapping table.

**Tech Stack:** Express 4 Router, Node built-in `node:test` + global `fetch` for integration tests. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-07-03-portfolio-hardening-design.md` (Phase 2 section)

## Global Constraints

- Repo: `C:\Users\Matt\projects\tarot`. Branch: `portfolio-phase2` off master (created in Task 1). Master is at the phase-1 merge; 201 tests green; lint clean.
- **API behavior byte-identical.** Route handler bodies move verbatim — no logic edits, no reformatting, no "improvements while we're here." Only the identifier changes listed in the Reference Mapping table are allowed.
- After EVERY task: `npm test` all-green (the integration suite from Task 1 is the refactor's safety net) and `npm run lint` exit 0.
- The verbatim-transplant rule is scoped to MOVED code. New files (factories, tests, wiring) follow normal quality rules.
- LLM-dependent endpoints (interpret family, threshold, daily-card, patterns, session-summary) are NOT integration-tested — background LLM calls in tests hit the user's live Ollama. They are covered by the final-task manual smoke. Do not add tests that trigger LLM calls, except `POST /api/readings` whose LLM work is fire-and-forget with `.catch`.
- Windows machine, Node 25 locally; `npm test` = `node --test tests/*.test.js`.
- ASCII only in new code; UTF-8 without BOM. server.js's existing strings contain non-ASCII (✓, ⚠, arrows, em-dash in one prompt) — moved code keeps its bytes exactly.

## Reference Mapping (the ONLY allowed edits inside moved handler bodies)

| Old identifier (in server.js) | New reference (inside routes/*.js) |
|---|---|
| `loadReaders` / `saveReaders` / `loadReadings` / `appendReading` / `slugify` / `readerReadingsPath` | `ctx.store.<same name>` |
| `getApiKey` / `callClaude` / `callOllama` / `callLLM` / `LOCAL_MODEL` / `OLLAMA_BASE` | `ctx.llm.<same name>` |
| `READER_PERSONA` | `ctx.READER_PERSONA` |
| `cache` / `profiles` / `memory` / `seasons` | `ctx.cache` / `ctx.profiles` / `ctx.memory` / `ctx.seasons` |
| `DATA_DIR` | `ctx.DATA_DIR` |
| `CONFIG_PATH` | `ctx.llm.configPath` |
| `path.join(__dirname, 'public', ...)` | `path.join(ctx.PUBLIC_DIR, ...)` |
| `fence` / `sanitizeUntrusted` | top-of-file `const { fence, sanitizeUntrusted } = require('../data/prompt-safety');` |
| memory-engine statics (`decideThresholdMode`, `buildGreetingPrompt`, `buildReplyPrompt`, `REUNION_MAX_THREADS`, `THRESHOLD_SALIENCE_BAR`, `REUNION_GAP_DAYS`) | destructure from `require('../data/memory-engine')` at top of routes/threshold.js |
| `detectSeasonShift` / `detectRecurringTheme` | destructure from `require('../data/emotional-seasons')` at top of the route file using them |
| `findTemporalCallbacks`, `filterSurfaced`, `buildAddressingNote`, `buildCompatAddressingNote`, `buildNotebookPayload`, `findCardPatterns`, `findProphecyCallbacks`, `PROPHECY_SURFACE_TTL_DAYS` | direct `require('../data/<module>')` at top of the route file using them |
| `PATTERNS_DIR` | local const in routes/readings.js: `path.join(ctx.DATA_DIR, 'patterns')` |
| `DAILY_DIR` | local const in routes/daily.js: `path.join(ctx.DATA_DIR, 'daily')` |

Helper functions used by exactly one route move INTO that route file unchanged: `deriveDeck`, `partOfDay` → routes/interpret.js; `dailyNoReversal`, `NON_REVERSIBLE_RUNE_IDS`, `loadDaily`, `saveDaily`, `localDateKey`, `loadAllDeckCards` → routes/daily.js. The two different `formatCardForPrompt` functions are each defined INSIDE their handler closures (interpret ~line 730, compatibility ~line 924) — they stay inside those closures, no collision.

## The ctx object (assembled in server.js, Task 4; final shape)

```js
const ctx = {
  DATA_DIR,
  PUBLIC_DIR: path.join(__dirname, 'public'),
  store,            // createReaderStore(DATA_DIR)
  llm,              // createLlmClient(DATA_DIR)
  cache,            // createCache(DATA_DIR)
  profiles,         // createProfileManager(DATA_DIR)
  memory,           // createMemoryEngine(DATA_DIR)
  seasons,          // createEmotionalSeasons(memory)
  READER_PERSONA,   // from data/persona.js (Task 5)
};
```

---

### Task 1: Branch, export app, pin behavior with an integration test suite

**Files:**
- Modify: `server.js:1270-1276` (listen block only)
- Test: `tests/routes.test.js` (new)

**Interfaces:**
- Produces: `require('../server')` returns the Express `app` without listening; `node server.js` (and Electron's `fork`) still listens on 127.0.0.1. Every later task relies on this suite passing untouched.

- [ ] **Step 1: Create the branch**

```bash
git checkout -b portfolio-phase2
```

- [ ] **Step 2: Guard the listen call and export the app**

Replace the final block of server.js (the `app.listen(...)` call and its comment, lines ~1267-1276) with:

```js
// Bind loopback only. This is a single-user local app; the server must never be
// reachable from the LAN. On-device testing goes through `adb reverse tcp:PORT tcp:PORT`,
// which delivers phone traffic to 127.0.0.1, so loopback binding does not affect it.
// Listen only when run directly (npm start, Electron's fork of server.js);
// requiring this file (tests) gets the app without a bound port.
if (require.main === module) {
  app.listen(PORT, '127.0.0.1', () => {
    console.log(`\n  Tarot is running at http://localhost:${PORT}\n`);
    if (!getApiKey()) {
      console.log('  ⚠  No API key found. Open the app and use ⚙ Settings to add one.\n');
    }
  });
}

module.exports = app;
```

(Electron uses `fork(serverPath)` — a forked child is its own `require.main`, verified in electron/main.js:107 — so packaged behavior is unchanged.)

- [ ] **Step 3: Write the integration test suite**

Create `tests/routes.test.js`. Tests run in file order and share state deliberately (the suite simulates one app lifetime against a temp DATA_DIR). Setup happens at module top level because `DATA_DIR` must be set before `require('../server')`.

```js
'use strict';
// Integration suite pinning /api behavior across the Phase 2 route split.
// Tests share one app instance + temp DATA_DIR and run in file order.
// LLM-dependent endpoints are deliberately not exercised (see phase-2 plan).
const os   = require('os');
const path = require('path');
const fs   = require('fs');
const { test, after } = require('node:test');
const assert = require('node:assert/strict');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tarot-routes-'));
process.env.DATA_DIR = tmp;
delete process.env.ANTHROPIC_API_KEY; // never let tests reach the real Claude API

const DECKS = ['tarot', 'oracle', 'miriel-lunar', 'veil-arcana', 'drowned-ephemeris',
               'lenormand', 'thoth', 'runic', 'iching'];
for (const d of DECKS) {
  fs.writeFileSync(path.join(tmp, `${d}.json`),
    JSON.stringify([{ id: `${d}-01`, name: `${d} test card`, upright: 'u', reversed: 'r' }]));
}

const app = require('../server');
const server = app.listen(0, '127.0.0.1');
after(() => server.close());
const base = () => `http://127.0.0.1:${server.address().port}`;

async function j(method, p, body) {
  const res = await fetch(base() + p, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

test('GET /api/readers returns the default reader created by migration', async () => {
  const r = await j('GET', '/api/readers');
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.body));
  assert.equal(r.body[0].slug, 'matt');
});

test('POST /api/readers validates name and creates collision-safe slug', async () => {
  let r = await j('POST', '/api/readers', { name: '   ' });
  assert.equal(r.status, 400);
  r = await j('POST', '/api/readers', { name: 'Matt' });
  assert.equal(r.status, 200);
  assert.equal(r.body.slug, 'matt-2');
  assert.ok(fs.existsSync(path.join(tmp, 'readings', 'matt-2.json')));
});

test('DELETE /api/readers/:slug 404s unknown, deletes existing, refuses last', async () => {
  let r = await j('DELETE', '/api/readers/nope');
  assert.equal(r.status, 404);
  r = await j('DELETE', '/api/readers/matt-2');
  assert.equal(r.status, 200);
  r = await j('DELETE', '/api/readers/matt');
  assert.equal(r.status, 400); // cannot remove the last reader
});

test('POST /api/readings validates payload, persists; GET honors limit', async () => {
  let r = await j('POST', '/api/readings', { nope: true });
  assert.equal(r.status, 400);
  for (let i = 1; i <= 7; i++) {
    r = await j('POST', '/api/readings', {
      reader: 'matt', date: `2026-07-0${i}`, spread: 'single', deck: 'tarot',
      cards: [{ name: 'Test Card', isReversed: false }],
    });
    assert.equal(r.status, 200);
  }
  r = await j('GET', '/api/readings?reader=matt');
  assert.equal(r.body.length, 5);            // default limit 5
  r = await j('GET', '/api/readings?reader=matt&limit=0');
  assert.equal(r.body.length, 7);            // limit=0 → full history
  assert.ok(r.body[0].id);                   // server stamps an id
});

test('GET /api/cards serves all nine decks', async () => {
  const r = await j('GET', '/api/cards');
  assert.equal(r.status, 200);
  for (const d of DECKS) {
    assert.ok(Array.isArray(r.body[d]), `deck ${d} missing`);
    assert.equal(r.body[d][0].name, `${d} test card`);
  }
});

test('GET /api/images returns a manifest keyed by deck', async () => {
  const r = await j('GET', '/api/images');
  assert.equal(r.status, 200);
  for (const k of ['tarot', 'veil-arcana', 'miriel-lunar', 'oracle', 'runic',
                   'iching', 'thoth', 'drowned-ephemeris']) {
    assert.ok(typeof r.body[k] === 'object', `manifest key ${k} missing`);
  }
});

test('GET /api/cache/stats responds with an object', async () => {
  const r = await j('GET', '/api/cache/stats');
  assert.equal(r.status, 200);
  assert.ok(r.body && typeof r.body === 'object');
});

test('GET /api/profiles/:slug 404s unknown reader, returns payload for matt', async () => {
  let r = await j('GET', '/api/profiles/ghost');
  assert.equal(r.status, 404);
  r = await j('GET', '/api/profiles/matt');
  assert.equal(r.status, 200);
  assert.ok(r.body && typeof r.body === 'object');
});

test('GET /api/foretellings/:slug returns an empty list for a fresh store', async () => {
  const r = await j('GET', '/api/foretellings/matt');
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.foretellings, []);
});

test('POST /api/config rejects malformed API keys', async () => {
  const r = await j('POST', '/api/config', { apiKey: 'not-a-key' });
  assert.equal(r.status, 400);
});

test('GET /api/config-status reports boolean flags', async () => {
  const r = await j('GET', '/api/config-status');
  assert.equal(r.status, 200);
  assert.equal(typeof r.body.hasKey, 'boolean');
  assert.equal(typeof r.body.hasLocalModel, 'boolean');
});
```

- [ ] **Step 4: Run the new suite against the CURRENT monolith**

Run: `node --test tests/routes.test.js`
Expected: ALL PASS. These tests pin existing behavior; if any fails, the test's expectation is wrong — fix the TEST to match actual behavior (this task must not change server behavior), and note it in the commit message.

- [ ] **Step 5: Full suite + lint**

Run: `npm test && npm run lint`
Expected: all suites pass (now 15 files), lint exit 0.

- [ ] **Step 6: Commit**

```bash
git add server.js tests/routes.test.js
git commit -m "test: pin /api behavior with integration suite; export app for tests"
```

### Task 2: Extract data/llm-client.js

**Files:**
- Create: `data/llm-client.js`
- Modify: `server.js` (delete lines ~128-187: `getApiKey`, LLM constants, `callClaude`, `callOllama`, `callLLM`; add require + destructure)
- Test: `tests/llm-client.test.js` (new)

**Interfaces:**
- Produces: `createLlmClient(dataDir)` → `{ getApiKey, callClaude, callOllama, callLLM, configPath, LOCAL_MODEL, OLLAMA_BASE }`. Signatures identical to the current inline functions: `callLLM(system, userPrompt, maxTokens, claudeModel = 'claude-sonnet-4-6')`, `callClaude(apiKey, system, userPrompt, maxTokens, model)`, `callOllama(system, userPrompt, maxTokens)`.

- [ ] **Step 1: Write the failing test**

Create `tests/llm-client.test.js`:

```js
'use strict';
const os   = require('os');
const path = require('path');
const fs   = require('fs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const createLlmClient = require('../data/llm-client');

function tmpDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'tarot-llm-')); }

test('getApiKey prefers config.json, falls back to env, else null', () => {
  const dir = tmpDir();
  const llm = createLlmClient(dir);
  const saved = process.env.ANTHROPIC_API_KEY;
  try {
    delete process.env.ANTHROPIC_API_KEY;
    assert.equal(llm.getApiKey(), null);
    process.env.ANTHROPIC_API_KEY = 'sk-ant-env';
    assert.equal(llm.getApiKey(), 'sk-ant-env');
    fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ apiKey: 'sk-ant-file' }));
    assert.equal(llm.getApiKey(), 'sk-ant-file');
  } finally {
    if (saved === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = saved;
  }
});

test('callClaude attaches httpStatus to API errors', async (t) => {
  const llm = createLlmClient(tmpDir());
  const orig = global.fetch;
  t.after(() => { global.fetch = orig; });
  global.fetch = async () => ({ ok: false, status: 429, text: async () => 'rate limited' });
  await assert.rejects(
    () => llm.callClaude('sk-ant-x', 'sys', 'hi', 10, 'claude-sonnet-4-6'),
    (err) => err.httpStatus === 429 && /rate limited/.test(err.message)
  );
});

test('callLLM falls back to Ollama when Claude fails', async (t) => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ apiKey: 'sk-ant-x' }));
  const llm = createLlmClient(dir);
  const orig = global.fetch;
  t.after(() => { global.fetch = orig; });
  global.fetch = async (url) => {
    if (String(url).includes('anthropic.com')) {
      return { ok: false, status: 500, text: async () => 'boom' };
    }
    return { ok: true, json: async () => ({ message: { content: 'local answer' } }) };
  };
  assert.equal(await llm.callLLM('sys', 'hi', 10), 'local answer');
});

test('callLLM uses Claude when the key works', async (t) => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ apiKey: 'sk-ant-x' }));
  const llm = createLlmClient(dir);
  const orig = global.fetch;
  t.after(() => { global.fetch = orig; });
  global.fetch = async () => ({ ok: true, json: async () => ({ content: [{ text: 'claude answer' }] }) });
  assert.equal(await llm.callLLM('sys', 'hi', 10), 'claude answer');
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test tests/llm-client.test.js`
Expected: FAIL — `Cannot find module '../data/llm-client'`

- [ ] **Step 3: Create data/llm-client.js**

Transplant the bodies of `getApiKey`, `callClaude`, `callOllama`, `callLLM` and the two constants from server.js VERBATIM into this factory (the code below shows the exact wrapper; the four function bodies are byte-identical moves):

```js
// LLM plumbing: Claude primary, local Ollama fallback. Extracted from server.js
// unchanged; the factory closes over the data dir so getApiKey can read config.json.
'use strict';
const fs = require('fs');
const path = require('path');

const LOCAL_MODEL = 'llama3.1:8b';
const OLLAMA_BASE = 'http://localhost:11434';

module.exports = function createLlmClient(dataDir) {
  const configPath = path.join(dataDir, 'config.json');

  function getApiKey() {
    // ... body moved verbatim from server.js (CONFIG_PATH → configPath) ...
  }

  async function callClaude(apiKey, system, userPrompt, maxTokens, model) {
    // ... body moved verbatim ...
  }

  async function callOllama(system, userPrompt, maxTokens) {
    // ... body moved verbatim ...
  }

  async function callLLM(system, userPrompt, maxTokens, claudeModel = 'claude-sonnet-4-6') {
    // ... body moved verbatim ...
  }

  return { getApiKey, callClaude, callOllama, callLLM, configPath, LOCAL_MODEL, OLLAMA_BASE };
};
```

The ONLY body edit permitted: inside `getApiKey`, `CONFIG_PATH` → `configPath`.

- [ ] **Step 4: Rewire server.js**

Delete the moved code from server.js. Where it stood, add:

```js
const createLlmClient = require('./data/llm-client');
const llm = createLlmClient(DATA_DIR);
const { getApiKey, callClaude, callOllama, callLLM, LOCAL_MODEL, OLLAMA_BASE } = llm;
```

The destructure keeps every existing call site in server.js compiling unchanged. `CONFIG_PATH` is still used by `/api/config` (moves in Task 4) — keep the `CONFIG_PATH` const for now.

- [ ] **Step 5: Verify**

Run: `node --test tests/llm-client.test.js` → PASS (4 tests). Then `npm test && npm run lint` → all green.

- [ ] **Step 6: Commit**

```bash
git add data/llm-client.js tests/llm-client.test.js server.js
git commit -m "refactor: extract LLM client (Claude + Ollama fallback) to data/llm-client.js"
```

### Task 3: Extract data/reader-store.js

**Files:**
- Create: `data/reader-store.js`
- Modify: `server.js` (delete `slugify`, `loadReaders`, `saveReaders`, `readerReadingsPath`, `loadReadings`, `appendReading`, `migrateIfNeeded` at lines ~41-101; add require + destructure)
- Test: `tests/reader-store.test.js` (new)

**Interfaces:**
- Produces: `createReaderStore(dataDir)` → `{ slugify, loadReaders, saveReaders, readerReadingsPath, loadReadings, appendReading, migrateIfNeeded }`. `loadReadings(slug)` keeps its exact signature — it is passed by reference into `memory.backfill` and `profiles.refreshReaderProfile`.

- [ ] **Step 1: Write the failing test**

Create `tests/reader-store.test.js`:

```js
'use strict';
const os   = require('os');
const path = require('path');
const fs   = require('fs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const createReaderStore = require('../data/reader-store');

function freshStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tarot-store-'));
  return { dir, store: createReaderStore(dir) };
}

test('slugify normalizes names and never returns empty', () => {
  const { store } = freshStore();
  assert.equal(store.slugify('  Matt G.  '), 'matt-g');
  assert.equal(store.slugify('Ünïcode!!'), 'n-code');
  assert.equal(store.slugify('!!!'), 'reader');
});

test('loadReaders returns [] on a fresh dir; saveReaders round-trips', () => {
  const { store } = freshStore();
  assert.deepEqual(store.loadReaders(), []);
  store.saveReaders([{ name: 'A', slug: 'a' }]);
  assert.deepEqual(store.loadReaders(), [{ name: 'A', slug: 'a' }]);
});

test('appendReading persists and caps history at 200', () => {
  const { store } = freshStore();
  for (let i = 0; i < 205; i++) store.appendReading({ id: i }, 'cap');
  const readings = store.loadReadings('cap');
  assert.equal(readings.length, 200);
  assert.equal(readings[0].id, 5);   // oldest 5 trimmed
  assert.equal(readings[199].id, 204);
});

test('migrateIfNeeded creates the default reader and migrates legacy readings.json', () => {
  const { dir, store } = freshStore();
  fs.writeFileSync(path.join(dir, 'readings.json'), JSON.stringify([{ id: 1 }]));
  store.migrateIfNeeded();
  assert.equal(store.loadReaders()[0].slug, 'matt');
  assert.deepEqual(store.loadReadings('matt'), [{ id: 1 }]);
  // idempotent: running again neither duplicates readers nor re-copies
  store.appendReading({ id: 2 }, 'matt');
  store.migrateIfNeeded();
  assert.equal(store.loadReaders().length, 1);
  assert.equal(store.loadReadings('matt').length, 2);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test tests/reader-store.test.js`
Expected: FAIL — `Cannot find module '../data/reader-store'`

- [ ] **Step 3: Create data/reader-store.js**

Transplant the seven functions verbatim; only the path constants become factory locals:

```js
// Reader + reading-history persistence (JSON files under the data dir).
// Extracted from server.js unchanged.
'use strict';
const fs = require('fs');
const path = require('path');

module.exports = function createReaderStore(dataDir) {
  const READERS_PATH = path.join(dataDir, 'readers.json');
  const READINGS_DIR = path.join(dataDir, 'readings');
  const LEGACY_PATH  = path.join(dataDir, 'readings.json'); // pre-profiles

  // ... the seven function bodies moved verbatim from server.js lines 41-99 ...

  return { slugify, loadReaders, saveReaders, readerReadingsPath, loadReadings, appendReading, migrateIfNeeded };
};
```

- [ ] **Step 4: Rewire server.js**

Delete the moved functions and the now-unused `READERS_PATH`/`READINGS_DIR`/`LEGACY_PATH` consts. Add:

```js
const createReaderStore = require('./data/reader-store');
const store = createReaderStore(DATA_DIR);
const { slugify, loadReaders, saveReaders, readerReadingsPath, loadReadings, appendReading } = store;
```

Replace the bare `migrateIfNeeded();` call with `store.migrateIfNeeded();`.

- [ ] **Step 5: Verify**

Run: `node --test tests/reader-store.test.js` → PASS. Then `npm test && npm run lint` → all green (routes suite proves the wiring).

- [ ] **Step 6: Commit**

```bash
git add data/reader-store.js tests/reader-store.test.js server.js
git commit -m "refactor: extract reader/reading persistence to data/reader-store.js"
```

### Task 4: First route modules — config, cards, cache (+ ctx + eslint glob)

**Files:**
- Create: `routes/config.js`, `routes/cards.js`, `routes/cache.js`
- Modify: `server.js` (remove the three route groups; assemble `ctx`; mount routers), `eslint.config.js` (add `'routes/**/*.js'` to the backend files glob)

**Interfaces:**
- Produces: the route-factory pattern every later task copies: `module.exports = function createXRoutes(ctx) { const router = require('express').Router(); ...full-path registrations...; return router; };` mounted in server.js as `app.use(require('./routes/x')(ctx));`. Also produces the `ctx` object (shape in the header of this plan; `READER_PERSONA` joins it in Task 5).

- [ ] **Step 1: Create routes/config.js**

Move `/api/config-status` (server.js ~191-202) and `/api/config` (~204-215) verbatim, with mapping-table substitutions (`getApiKey` → `ctx.llm.getApiKey`, `OLLAMA_BASE`/`LOCAL_MODEL` → `ctx.llm.*`, `CONFIG_PATH` → `ctx.llm.configPath`):

```js
'use strict';
const fs = require('fs');
const express = require('express');

module.exports = function createConfigRoutes(ctx) {
  const router = express.Router();

  router.get('/api/config-status', async (req, res) => {
    // ... moved body ...
  });

  router.post('/api/config', (req, res) => {
    // ... moved body ...
  });

  return router;
};
```

- [ ] **Step 2: Create routes/cards.js**

Move `/api/cards` (~505-516) and `/api/images` (~469-501) verbatim (`DATA_DIR` → `ctx.DATA_DIR`; `path.join(__dirname, 'public', 'images')` → `path.join(ctx.PUBLIC_DIR, 'images')`). Same factory skeleton, requires `fs`, `path`, `express`.

- [ ] **Step 3: Create routes/cache.js**

Move `/api/cache/stats` (~1224-1235) verbatim (`DATA_DIR` → `ctx.DATA_DIR`, `cache` → `ctx.cache`).

- [ ] **Step 4: Assemble ctx and mount in server.js**

After the service singletons in server.js, add:

```js
const ctx = {
  DATA_DIR,
  PUBLIC_DIR: path.join(__dirname, 'public'),
  store, llm, cache, profiles, memory, seasons,
};

app.use(require('./routes/config')(ctx));
app.use(require('./routes/cards')(ctx));
app.use(require('./routes/cache')(ctx));
```

Mount AFTER `app.use(express.json())` / `express.static` (keep middleware order). Delete the three moved route groups and the now-unused `CONFIG_PATH` const from server.js.

- [ ] **Step 5: Add routes/ to the eslint backend glob**

In `eslint.config.js`, the backend `files` array gains `'routes/**/*.js'`:

```js
files: ['server.js', 'eslint.config.js', 'data/**/*.js', 'routes/**/*.js', 'scripts/**/*.js', 'electron/**/*.js', 'tests/**/*.js', 'generate-*.js'],
```

(Match the file's actual current array — add the routes entry, change nothing else.)

- [ ] **Step 6: Verify**

Run: `npm test && npm run lint`
Expected: all green — `tests/routes.test.js` exercises config-status, config-400, cards, images, cache/stats through the new routers.

- [ ] **Step 7: Commit**

```bash
git add routes/ server.js eslint.config.js
git commit -m "refactor: extract config/cards/cache routes; introduce ctx + router pattern"
```

### Task 5: routes/readers.js + routes/daily.js (+ data/persona.js)

**Files:**
- Create: `data/persona.js`, `routes/readers.js`, `routes/daily.js`
- Modify: `server.js`

**Interfaces:**
- Produces: `require('./data/persona')` → `{ READER_PERSONA }` (the exact template literal from server.js ~520-539, moved byte-identically — it contains the persona voice rules and the fence-tag trust note; do not retouch a single character). `ctx.READER_PERSONA` joins the ctx object.

- [ ] **Step 1: Create data/persona.js**

```js
// Miriel's system persona, shared by every LLM-backed route.
// Moved byte-identically from server.js; treat as copy, not code.
'use strict';

const READER_PERSONA = `...MOVED VERBATIM from server.js lines ~520-539...`;

module.exports = { READER_PERSONA };
```

- [ ] **Step 2: Create routes/readers.js**

Move `/api/readers` GET/POST/DELETE (~219-263) verbatim (`loadReaders`/`saveReaders`/`slugify`/`readerReadingsPath` → `ctx.store.*`).

- [ ] **Step 3: Create routes/daily.js**

Move the whole Card-of-the-Day section (~375-465): `NON_REVERSIBLE_RUNE_IDS`, `dailyNoReversal`, `loadDaily`, `saveDaily`, `localDateKey`, `loadAllDeckCards`, and the `/api/daily-card` handler. Helpers become module-level functions inside the factory (above the handler), `DAILY_DIR` becomes `const DAILY_DIR = path.join(ctx.DATA_DIR, 'daily');` inside the factory. Substitutions: `loadReaders` → `ctx.store.loadReaders`, `callLLM` → `ctx.llm.callLLM`, `READER_PERSONA` → `ctx.READER_PERSONA`, `DATA_DIR` → `ctx.DATA_DIR` (in `loadAllDeckCards` and `DAILY_DIR`).

- [ ] **Step 4: Rewire server.js**

Delete the moved sections and the READER_PERSONA literal. Add near the other requires / ctx:

```js
const { READER_PERSONA } = require('./data/persona');
```

Add `READER_PERSONA` to the ctx object, and mount:

```js
app.use(require('./routes/readers')(ctx));
app.use(require('./routes/daily')(ctx));
```

READER_PERSONA is still referenced by the not-yet-moved routes in server.js (patterns, interpret, compatibility, clarify, session-summary, threshold) — the destructured const covers them until their tasks.

- [ ] **Step 5: Verify byte-identity of the persona move**

Run: `git diff HEAD -- server.js | grep -c "^-.*em dash"` — sanity only. Stronger check: `node -e "const {READER_PERSONA}=require('./data/persona'); console.log(READER_PERSONA.length)"` and compare against pre-move length via `git show HEAD:server.js | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const m=s.match(/const READER_PERSONA = \`([\s\S]*?)\`;/); console.log(m[1].length)})"` — the two lengths must be EQUAL.

- [ ] **Step 6: Verify suites**

Run: `npm test && npm run lint`
Expected: all green (readers CRUD covered by routes suite; daily-card has no automated coverage — its move is verbatim and smoke-tested in Task 9).

- [ ] **Step 7: Commit**

```bash
git add data/persona.js routes/readers.js routes/daily.js server.js
git commit -m "refactor: extract readers + daily-card routes; persona to data/persona.js"
```

### Task 6: routes/readings.js (readings, patterns, session-summary)

**Files:**
- Create: `routes/readings.js`
- Modify: `server.js`

**Interfaces:**
- Consumes: ctx (store, profiles, memory, seasons, llm, READER_PERSONA, DATA_DIR); `fence` via direct require of `../data/prompt-safety`; `buildAddressingNote` via `../data/addressing`.

- [ ] **Step 1: Create routes/readings.js**

Move verbatim, with mapping-table substitutions:
- `/api/readings` GET (~267-274) and POST (~276-308): `loadReaders`/`loadReadings`/`appendReading` → `ctx.store.*`; `profiles` → `ctx.profiles`; `memory` → `ctx.memory`; `seasons` → `ctx.seasons`; `callLLM` → `ctx.llm.callLLM`. In the POST handler, `profiles.refreshReaderProfile(slug, callLLM, loadReadings)` becomes `ctx.profiles.refreshReaderProfile(slug, ctx.llm.callLLM, ctx.store.loadReadings)` (function references pass through unchanged).
- `/api/patterns` (~312-371) including the `PATTERNS_DIR` const → `const PATTERNS_DIR = path.join(ctx.DATA_DIR, 'patterns');` inside the factory. `READER_PERSONA` → `ctx.READER_PERSONA`; `fence` via top-of-file `const { fence } = require('../data/prompt-safety');`.
- `/api/session-summary` (~1034-1068): `sanitizeUntrusted` and `fence` from the same require; `buildAddressingNote` via `const { buildAddressingNote } = require('../data/addressing');`; `callLLM` → `ctx.llm.callLLM`; `READER_PERSONA` → `ctx.READER_PERSONA`.

- [ ] **Step 2: Rewire server.js** — delete the three moved groups; mount `app.use(require('./routes/readings')(ctx));`

- [ ] **Step 3: Verify**

Run: `npm test && npm run lint`
Expected: all green (readings GET/POST pinned by routes suite).

- [ ] **Step 4: Commit**

```bash
git add routes/readings.js server.js
git commit -m "refactor: extract readings/patterns/session-summary routes"
```

### Task 7: routes/threshold.js + routes/profiles.js

**Files:**
- Create: `routes/threshold.js`, `routes/profiles.js`
- Modify: `server.js`

**Interfaces:**
- Consumes: memory-engine statics and emotional-seasons statics via direct require (see mapping table). routes/profiles.js consumes `buildNotebookPayload` from `../data/notebook`.

- [ ] **Step 1: Create routes/threshold.js**

Move `/api/threshold` (~1072-1163), `/api/threshold/answer` (~1165-1192), and `/api/reading-questions` (~1196-1209) verbatim. Top-of-file requires:

```js
const createMemoryEngine = require('../data/memory-engine');
const {
  decideThresholdMode, buildGreetingPrompt, buildReplyPrompt,
  REUNION_MAX_THREADS, THRESHOLD_SALIENCE_BAR, REUNION_GAP_DAYS,
} = createMemoryEngine;
const { detectSeasonShift } = require('../data/emotional-seasons');
const { findTemporalCallbacks, filterSurfaced } = require('../data/temporal-recall');
const { buildAddressingNote } = require('../data/addressing');
```

(Note: `/api/reading-questions` is grouped here rather than with interpret — it shares the threshold trio's memory-curiosity machinery and none of interpret's prompt assembly. Deviation from the spec's grouping table, same total coverage.)

Substitutions per mapping table (`memory` → `ctx.memory`, `profiles` → `ctx.profiles`, `loadReaders`/`loadReadings` → `ctx.store.*`, `callLLM` → `ctx.llm.callLLM`, `READER_PERSONA` → `ctx.READER_PERSONA`).

- [ ] **Step 2: Create routes/profiles.js**

Move `/api/foretellings/:slug` (~1213-1222), `/api/profiles/:slug` (~1237-1250), `/api/profiles/:slug/refresh` (~1252-1265) verbatim. `buildNotebookPayload` via `require('../data/notebook')`; `path.join(__dirname, 'public', 'images')` → `path.join(ctx.PUBLIC_DIR, 'images')`; `DATA_DIR` → `ctx.DATA_DIR`.

- [ ] **Step 3: Rewire server.js** — delete moved groups + now-unused requires (temporal-recall, notebook; keep memory-engine statics only if still used by remaining code — after this task the destructured statics at server.js top are unused, remove that destructure but KEEP `createMemoryEngine` require for the `memory` singleton). Mount both routers.

- [ ] **Step 4: Verify** — `npm test && npm run lint` all green (profiles 404/foretellings pinned by routes suite).

- [ ] **Step 5: Commit**

```bash
git add routes/threshold.js routes/profiles.js server.js
git commit -m "refactor: extract threshold/reading-questions and profiles/foretellings routes"
```

### Task 8: routes/interpret.js (interpret, compatibility, clarify, suggest-spread)

**Files:**
- Create: `routes/interpret.js`
- Modify: `server.js`

**Interfaces:**
- Consumes: everything in the mapping table. This is the largest move (~450 lines).

- [ ] **Step 1: Create routes/interpret.js**

Move verbatim: `deriveDeck` (~115-126), `partOfDay` (~628-635), `/api/suggest-spread` (~543-622), `/api/interpret` (~637-899), `/api/compatibility` (~903-994), `/api/clarify` (~998-1030). Top-of-file requires:

```js
const { fence, sanitizeUntrusted } = require('../data/prompt-safety');
const { buildAddressingNote, buildCompatAddressingNote } = require('../data/addressing');
const { findCardPatterns } = require('../data/card-patterns');
const { findProphecyCallbacks, PROPHECY_SURFACE_TTL_DAYS } = require('../data/prophecy-recall');
const { detectRecurringTheme } = require('../data/emotional-seasons');
```

`deriveDeck` and `partOfDay` become factory-level functions. The two `formatCardForPrompt` definitions stay INSIDE their respective handler closures exactly where they are now (interpret's inside the interpret handler, compatibility's inside the compatibility handler) — moving either to factory level would collide and is forbidden.

Substitutions per mapping table only. Special attention:
- interpret's cache flow: `cache.buildCacheKey/lookupCache/saveToCache` → `ctx.cache.*`; `getApiKey`/`callClaude`/`callOllama` → `ctx.llm.*`.
- `memory.getMeta`/`setMeta`/`recall`/`getResolvedPredictions`/`getOpenPredictions`/`captureAnswer` → `ctx.memory.*`.

- [ ] **Step 2: Rewire server.js** — delete the moved sections and now-unused requires (addressing, card-patterns, prophecy-recall, prompt-safety, emotional-seasons statics — keep `createEmotionalSeasons` require for the `seasons` singleton). Mount `app.use(require('./routes/interpret')(ctx));`

- [ ] **Step 3: Verify** — `npm test && npm run lint` all green.

- [ ] **Step 4: Line-count check**

Run: `wc -l server.js routes/*.js data/llm-client.js data/reader-store.js data/persona.js`
Expected: server.js ≈ 100-140 lines (requires, singletons, migrate + backfill, middleware, ctx, 9 mounts, listen guard). No route file > ~470 lines (interpret.js is the largest). If server.js still contains any `app.get`/`app.post` route, something was missed — fix before committing.

- [ ] **Step 5: Commit**

```bash
git add routes/interpret.js server.js
git commit -m "refactor: extract interpret/compatibility/clarify/suggest-spread routes"
```

### Task 9: Docs, smoke, merge, publish (user checkpoint)

**Files:**
- Modify: `ARCHITECTURE.md` (route-layer description)

- [ ] **Step 1: Update ARCHITECTURE.md**

The layer diagram and Server bullet currently describe server.js as "~23 routes... route-module split is planned." Update to reality (keep the doc's voice, adjust facts): server.js is now wiring (~120 lines); routes live in `routes/` (9 modules: config, readers, readings, interpret, threshold, profiles, daily, cards, cache); `data/llm-client.js` (Claude + Ollama fallback) and `data/reader-store.js` are named in the service-layer bullet; remove the "split is planned" phrasing; update the module/suite counts (data/ now 14 modules incl. llm-client, reader-store, persona; tests now 17 suites) — VERIFY both counts with `ls data/*.js | wc -l` and `ls tests/*.test.js | wc -l` before writing them.

- [ ] **Step 2: Full verification**

Run: `npm test && npm run lint`
Expected: all green.

- [ ] **Step 3: Boot smoke**

Run: `npm start` in background; then `curl -s http://127.0.0.1:3000/api/config-status`, `curl -s http://127.0.0.1:3000/api/readers`, `curl -s http://127.0.0.1:3000/api/daily-card` (exercises persona + llm wiring through the real config; reflection may be null, endpoint must 200). Stop the server.
Expected: all three return JSON, no 500s, boot log shows the startup banner.

- [ ] **Step 4: USER CHECKPOINT — live reading smoke**

Ask the user to run the app and do one quick reading (any spread) plus open the notebook/journal. Pass = Miriel reads normally, history saves. This exercises interpret + readings + profiles through the real LLM, which no automated test covers.

- [ ] **Step 5: Merge and publish**

```bash
git checkout master
git merge --no-ff portfolio-phase2 -m "Merge portfolio-phase2: split server.js into route modules + llm-client/reader-store services"
npm test
pwsh ./scripts/publish-to-cloud.ps1 -Message "Portfolio hardening phase 2: server.js split into route modules"
```

- [ ] **Step 6: Verify CI green on Miriels**

Check the latest run on github.com/mwgrant21/Miriels (API or Actions tab). Expected: success on both matrix legs.

---

## Self-review notes

- Spec coverage: spec's Phase 2 route table → Tasks 4-8 (one deviation, documented in Task 7: reading-questions grouped with threshold instead of interpret); shared LLM-client extraction → Task 2; "server.js ≈ 100 lines" → Task 8 Step 4 check; "tests keep passing untouched" → strengthened to "plus a new integration suite pinning /api behavior" (Task 1); "manual smoke" → Task 9 Steps 3-4.
- The reader-store and llm-client factories exceed the spec's minimum (it only required the LLM extraction) — justified: the store functions are shared by 6 of 9 route modules and a ctx full of loose closures would be worse than the two cohesive services.
- Type consistency: ctx shape defined once in header + Task 4; all route factories consume the same shape; `loadReadings(slug)` signature preserved for the two pass-by-reference consumers (memory.backfill, profiles.refreshReaderProfile).
- The `setImmediate` backfill block stays in server.js (startup concern, not a route); it uses `store.loadReadings` and `llm.callLLM` after Tasks 2-3.
