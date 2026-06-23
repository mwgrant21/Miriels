# Miriel In-Reading Curiosity Implementation Plan (Phase 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** As cards are laid at a human pace, Miriel sometimes gets stopped by a card that pulls at a remembered thread, pauses on it to ask, captures your answer, and lets it shape the reading.

**Architecture:** Backend reuses the Phase-1/2 memory engine — a Haiku "detector" picks 0–2 cards that resonate with open un-asked threads; a generalized `captureAnswer` records the reply (`source_kind:'curiosity'`); `/api/interpret` folds the answers into the reading. Frontend converts the deal into a JS-sequenced, human-paced, *pausable* animation so the pause lands mid-deal.

**Tech Stack:** Node.js, `better-sqlite3`, `node:test`, existing `callLLM(system,prompt,maxTokens,model)`; vanilla-JS frontend (`public/app.js`).

---

## Prerequisites
- Run tests: `node --test tests/*.test.js` (from `C:\Users\Matt\projects\tarot`). Baseline: **76 pass**.
- `ERR_DLOPEN_FAILED` → `npm rebuild better-sqlite3` once.
- Branch: create `feat/miriel-curiosity` off `master` before Task 1.
- Engine reference: `data/memory-engine.js` (has `parseExtractorOutput`, `buildThresholdCapturePrompt`, `THRESHOLD_CAPTURE_SYSTEM`, `EXTRACT_MODEL`, `THRESHOLD_SALIENCE_BAR`, `captureThresholdAnswer`, `getOpenUnaskedThreads`, `markAsked`, store `applyOps` with `RESOLVE`).
- Frontend reference: `public/app.js` — deal constants (`SHUFFLE_MS=1400`, `DEAL_INTERVAL=480`, `DEAL_FLIP_DELAY=640`), `drawCards()`, `drawWithReaderChoice()`, `autoReveal()`, `renderSpread()`, `makeCardEl(card,index)`, `askClaude()`.

## File Structure
| File | Change | Responsibility |
|------|--------|----------------|
| `data/memory-engine.js` | modify | `parseCuriosityOutput`, `buildCuriosityPrompt`, `detectCuriosity`, generalized `captureAnswer` |
| `tests/memory-engine.test.js` | modify | engine unit tests |
| `server.js` | modify | `POST /api/reading-questions`; curiosity fold + capture in `/api/interpret` |
| `public/index.html` | modify | `#curiosity-panel` markup |
| `public/style.css` | modify | curiosity glow/dim/panel styles |
| `public/app.js` | modify | JS-sequenced paced deal; curiosity pause; detection call; `curiosityAnswers` in payload |

---

## Task 1: Engine — `parseCuriosityOutput`

**Files:** Modify `data/memory-engine.js`; Test `tests/memory-engine.test.js`

- [ ] **Step 1: Write failing tests** — append to `tests/memory-engine.test.js`:

```js
const { parseCuriosityOutput } = require('../data/memory-engine');

test('parseCuriosityOutput reads questions from a clean object', () => {
  const q = parseCuriosityOutput('{"questions":[{"card_id":"major-18","question":"Is your sister ok?","thread_ids":[7]}]}');
  assert.equal(q.length, 1);
  assert.equal(q[0].card_id, 'major-18');
});
test('parseCuriosityOutput tolerates prose around the JSON', () => {
  const q = parseCuriosityOutput('Sure:\n{"questions":[{"card_id":"x","question":"y","thread_ids":[1]}]}\ndone');
  assert.equal(q[0].question, 'y');
});
test('parseCuriosityOutput accepts a bare array', () => {
  const q = parseCuriosityOutput('[{"card_id":"x","question":"y","thread_ids":[1]}]');
  assert.equal(q.length, 1);
});
test('parseCuriosityOutput returns [] on garbage/empty', () => {
  assert.deepEqual(parseCuriosityOutput('nope'), []);
  assert.deepEqual(parseCuriosityOutput(''), []);
  assert.deepEqual(parseCuriosityOutput('{"questions": broken}'), []);
});
```

- [ ] **Step 2: Run, verify FAIL**

Run: `node --test tests/memory-engine.test.js`
Expected: FAIL — `parseCuriosityOutput is not a function`.

- [ ] **Step 3: Implement** — in `data/memory-engine.js`, add at module level (after `parseExtractorOutput`):

```js
function parseCuriosityOutput(raw) {
  if (!raw) return [];
  const text = String(raw);
  const objStart = text.indexOf('{');
  const arrStart = text.indexOf('[');
  try {
    if (objStart !== -1 && (arrStart === -1 || objStart < arrStart)) {
      const parsed = JSON.parse(text.slice(objStart, text.lastIndexOf('}') + 1));
      if (Array.isArray(parsed)) return parsed;
      if (parsed && Array.isArray(parsed.questions)) return parsed.questions;
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
```

Add export at the bottom (after the other `module.exports.X` lines):

```js
module.exports.parseCuriosityOutput = parseCuriosityOutput;
```

- [ ] **Step 4: Run, verify PASS**

Run: `node --test tests/memory-engine.test.js`
Expected: PASS (existing + 4 new).

- [ ] **Step 5: Commit**

```bash
git add data/memory-engine.js tests/memory-engine.test.js
git commit -m "feat: parseCuriosityOutput tolerant parser"
```

---

## Task 2: Engine — `buildCuriosityPrompt`

**Files:** Modify `data/memory-engine.js`; Test `tests/memory-engine.test.js`

- [ ] **Step 1: Write failing tests** — append to `tests/memory-engine.test.js`:

```js
const { buildCuriosityPrompt } = require('../data/memory-engine');

test('buildCuriosityPrompt includes card ids/names and thread ids and asks for JSON questions', () => {
  const p = buildCuriosityPrompt(
    [{ id: 'major-18', name: 'The Moon', position: 'Present', isReversed: false }],
    [{ id: 7, content: 'tension with his sister' }]
  );
  assert.ok(p.includes('The Moon'));
  assert.ok(p.includes('major-18'));
  assert.ok(p.includes('#7'));
  assert.ok(p.includes('tension with his sister'));
  assert.ok(/questions/.test(p));
  assert.ok(/0 to 2|0-2|conservative/i.test(p));
});
```

- [ ] **Step 2: Run, verify FAIL**

Run: `node --test tests/memory-engine.test.js`
Expected: FAIL — `buildCuriosityPrompt is not a function`.

- [ ] **Step 3: Implement** — in `data/memory-engine.js`, add at module level (after `parseCuriosityOutput`):

```js
const CURIOSITY_SYSTEM =
  'You are the quiet intuition of a tarot reader named Miriel. As she lays a spread, a single card ' +
  'will sometimes stop her because it stirs something she remembers about this person. You decide, ' +
  'conservatively, whether any card genuinely does that. Never force a connection; most spreads stir nothing.';

function buildCuriosityCardLines(cards) {
  return (cards || [])
    .map(c => `[${c.id || '?'}] ${c.position ? c.position + ': ' : ''}${c.name}${c.isReversed ? ' (reversed)' : ''}`)
    .join('\n');
}

function buildCuriosityPrompt(cards, threads) {
  const cardBlock   = buildCuriosityCardLines(cards);
  const threadBlock = (threads || []).map(t => `#${t.id} ${t.content}`).join('\n');
  return `THE SPREAD JUST LAID (id in brackets):
${cardBlock}

OPEN THREADS MIRIEL REMEMBERS ABOUT THIS PERSON:
${threadBlock}

Decide whether any single card genuinely and strikingly pulls her toward one of these remembered threads — especially a surprising, less-obvious connection to another part of their life. Respond with ONLY a JSON object:

{"questions":[
  {"card_id":"<id of the card that stopped her>","question":"one sentence in Miriel's voice, as if she paused mid-reading on that card","thread_ids":[<id>]}
]}

Rules:
- 0 to 2 questions. Most readings: {"questions":[]}.
- Be conservative — only a real, striking resonance, never a forced one.
- Favor the less-obvious / off-topic pull; a natural on-topic one is also fine.
- The question is one sentence and names or clearly refers to that card.
- card_id MUST be one of the spread ids above; thread_ids MUST come from the list above.
- Never invent facts.`;
}
```

Add exports at the bottom:

```js
module.exports.buildCuriosityPrompt = buildCuriosityPrompt;
```

- [ ] **Step 4: Run, verify PASS**

Run: `node --test tests/memory-engine.test.js`
Expected: PASS (existing + 1 new).

- [ ] **Step 5: Commit**

```bash
git add data/memory-engine.js tests/memory-engine.test.js
git commit -m "feat: buildCuriosityPrompt (conservative card-resonance detector prompt)"
```

---

## Task 3: Engine — `detectCuriosity`

**Files:** Modify `data/memory-engine.js`; Test `tests/memory-engine.test.js`

- [ ] **Step 1: Write failing tests** — append to `tests/memory-engine.test.js`:

```js
test('detectCuriosity returns [] and makes NO llm call when there are no open threads', async () => {
  const engine = createMemoryEngine(tmpDir());
  let called = false;
  await engine.detectCuriosity('matt', [{ id: 'major-18', name: 'The Moon' }], async () => { called = true; return '{}'; });
  assert.equal(called, false);
});

test('detectCuriosity returns a normalized trigger for a valid resonance', async () => {
  const engine = createMemoryEngine(tmpDir());
  const tid = engine._store.addMemory('matt', { type: 'thread', content: 'tension with his sister', status: 'open', salience: 4 });
  const fakeLLM = async () => `{"questions":[{"card_id":"major-18","question":"Is your sister still upset?","thread_ids":[${tid}]}]}`;
  const out = await engine.detectCuriosity('matt', [{ id: 'major-18', name: 'The Moon' }], fakeLLM);
  assert.equal(out.length, 1);
  assert.equal(out[0].cardId, 'major-18');
  assert.equal(out[0].question, 'Is your sister still upset?');
  assert.deepEqual(out[0].threadIds, [tid]);
});

test('detectCuriosity drops triggers with unknown card or thread ids', async () => {
  const engine = createMemoryEngine(tmpDir());
  const tid = engine._store.addMemory('matt', { type: 'thread', content: 't', status: 'open', salience: 4 });
  const fakeLLM = async () =>
    `{"questions":[{"card_id":"NOT-IN-SPREAD","question":"q","thread_ids":[${tid}]},{"card_id":"major-0","question":"q2","thread_ids":[9999]}]}`;
  const out = await engine.detectCuriosity('matt', [{ id: 'major-0', name: 'The Fool' }], fakeLLM);
  assert.equal(out.length, 0);
});

test('detectCuriosity swallows LLM errors', async () => {
  const engine = createMemoryEngine(tmpDir());
  engine._store.addMemory('matt', { type: 'thread', content: 't', status: 'open', salience: 4 });
  const out = await engine.detectCuriosity('matt', [{ id: 'major-0', name: 'The Fool' }], async () => { throw new Error('down'); });
  assert.deepEqual(out, []);
});
```

- [ ] **Step 2: Run, verify FAIL**

Run: `node --test tests/memory-engine.test.js`
Expected: FAIL — `engine.detectCuriosity is not a function`.

- [ ] **Step 3: Implement** — inside the `createMemoryEngine` factory in `data/memory-engine.js`, add (near `captureThresholdAnswer`):

```js
  async function detectCuriosity(slug, cards, callLLM) {
    const threads = store.getOpenUnaskedThreads(slug, 8, THRESHOLD_SALIENCE_BAR);
    if (!threads.length) return [];
    let raw;
    try {
      raw = await callLLM(CURIOSITY_SYSTEM, buildCuriosityPrompt(cards, threads), 500, EXTRACT_MODEL);
    } catch {
      return [];
    }
    const cardIds   = new Set((cards || []).map(c => c.id));
    const threadIds = new Set(threads.map(t => t.id));
    return parseCuriosityOutput(raw)
      .filter(q => q && q.question && cardIds.has(q.card_id) &&
                   Array.isArray(q.thread_ids) && q.thread_ids.some(id => threadIds.has(id)))
      .slice(0, 2)
      .map(q => ({
        cardId:    q.card_id,
        question:  String(q.question),
        threadIds: q.thread_ids.filter(id => threadIds.has(id)),
      }));
  }
```

Add `detectCuriosity` to the factory's returned object (keep all existing keys):

```js
  return {
    recall, captureFromReading, backfill, captureThresholdAnswer, detectCuriosity,
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
Expected: PASS (existing + 4 new).

- [ ] **Step 5: Commit**

```bash
git add data/memory-engine.js tests/memory-engine.test.js
git commit -m "feat: detectCuriosity (card-resonance detection over open threads)"
```

---

## Task 4: Engine — generalize `captureAnswer(..., sourceKind)`

**Files:** Modify `data/memory-engine.js`; Test `tests/memory-engine.test.js`

- [ ] **Step 1: Write failing tests** — append to `tests/memory-engine.test.js`:

```js
test('captureAnswer records atoms under the given source_kind', async () => {
  const engine = createMemoryEngine(tmpDir());
  const id = engine._store.addMemory('matt', { type: 'thread', content: 'the move', status: 'open', salience: 4 });
  const fakeLLM = async () => `{"operations":[{"op":"RESOLVE","id":${id},"outcome":"the move happened"}]}`;
  const res = await engine.captureAnswer('matt', 'we moved', [id], fakeLLM, 'curiosity');
  assert.equal(res.resolved, 1);
  const outcome = engine.listMemories('matt').find(m => m.type === 'event' && m.content === 'the move happened');
  assert.ok(outcome && outcome.source_kind === 'curiosity');
});

test('captureThresholdAnswer still records under threshold', async () => {
  const engine = createMemoryEngine(tmpDir());
  const id = engine._store.addMemory('matt', { type: 'thread', content: 'x', status: 'open', salience: 4 });
  const fakeLLM = async () => `{"operations":[{"op":"ADD","type":"event","content":"a thing","salience":3}]}`;
  await engine.captureThresholdAnswer('matt', 'a thing happened', [id], fakeLLM);
  const ev = engine.listMemories('matt').find(m => m.content === 'a thing');
  assert.ok(ev && ev.source_kind === 'threshold');
});
```

- [ ] **Step 2: Run, verify FAIL**

Run: `node --test tests/memory-engine.test.js`
Expected: FAIL — `engine.captureAnswer is not a function`.

- [ ] **Step 3: Implement** — in `data/memory-engine.js`, replace the existing `captureThresholdAnswer` function with a generalized `captureAnswer` plus a thin wrapper:

```js
  async function captureAnswer(slug, answer, threadIds, callLLM, sourceKind = 'threshold') {
    const threads = (threadIds || []).map(id => store.getMemory(id)).filter(Boolean);
    let raw;
    try {
      raw = await callLLM(THRESHOLD_CAPTURE_SYSTEM, buildThresholdCapturePrompt(threads, answer), 600, EXTRACT_MODEL);
    } catch (e) {
      return { added: 0, updated: 0, touched: 0, resolved: 0, error: e.message };
    }
    const ops = parseExtractorOutput(raw);
    return store.applyOps(slug, ops, sourceKind, null);
  }

  async function captureThresholdAnswer(slug, answer, threadIds, callLLM) {
    return captureAnswer(slug, answer, threadIds, callLLM, 'threshold');
  }
```

Add `captureAnswer` to the factory's returned object (keep all existing keys, including `captureThresholdAnswer` and `detectCuriosity`):

```js
  return {
    recall, captureFromReading, backfill, captureThresholdAnswer, captureAnswer, detectCuriosity,
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
Expected: PASS (existing + 2 new). The Phase-2 threshold tests still pass (wrapper preserves behavior).

- [ ] **Step 5: Run full suite**

Run: `node --test tests/*.test.js`
Expected: 0 fail (report totals).

- [ ] **Step 6: Commit**

```bash
git add data/memory-engine.js tests/memory-engine.test.js
git commit -m "feat: generalize captureAnswer(sourceKind); captureThresholdAnswer wraps it"
```

---

## Task 5: Server — `/api/reading-questions` + curiosity fold in `/api/interpret`

**Files:** Modify `server.js` (no automated test — manual smoke)

Context: `server.js` has `const memory = createMemoryEngine(DATA_DIR)`, `loadReaders`, `callLLM`, and the `/api/interpret` handler that builds `prompt` then calls `callClaude(apiKey, personaFinal, prompt, 3000, 'claude-sonnet-4-6')` and `callOllama(personaFinal, prompt, 3000)`.

- [ ] **Step 1: Add the detection endpoint**

In `server.js`, immediately before the `app.get('/api/cache/stats'` handler, add:

```js
// ── In-reading curiosity — a card stops her ──────────────────────────────────

app.post('/api/reading-questions', async (req, res) => {
  try {
    const readers = loadReaders();
    const slug = req.body.reader || (readers[0] && readers[0].slug) || 'matt';
    const cards = Array.isArray(req.body.cards) ? req.body.cards : [];
    const questions = await memory.detectCuriosity(slug, cards, callLLM);
    memory.markAsked(questions.flatMap(q => q.threadIds));
    res.json({ questions });
  } catch (err) {
    console.warn('  ⚠  reading-questions failed:', err.message);
    res.json({ questions: [] });
  }
});
```

- [ ] **Step 2: Fold curiosity answers into `/api/interpret`**

In the `/api/interpret` handler, find where the user `prompt` is finalized (the `const prompt = isSingle ? \`...\` : \`...\`;` assignment). Immediately AFTER that assignment, add:

```js
  // In-reading curiosity: weave any answers the querent gave mid-deal into the reading.
  const curiosityAnswers = Array.isArray(req.body.curiosityAnswers) ? req.body.curiosityAnswers : [];
  const answeredCuriosity = curiosityAnswers.filter(a => a && a.answer && String(a.answer).trim());
  let curiosityBlock = '';
  if (answeredCuriosity.length) {
    curiosityBlock = '\n\nAs the cards were laid, you paused on what they stirred and asked:\n' +
      answeredCuriosity.map(a => `- You asked: "${a.question}" — they answered: "${String(a.answer).slice(0, 500)}"`).join('\n') +
      '\nLet what they shared genuinely shape this reading; do not quote it back mechanically.';
  }
  const promptFinal = prompt + curiosityBlock;
```

Then change BOTH model calls in this handler to use `promptFinal` instead of `prompt`:

```js
        text   = await callClaude(apiKey, personaFinal, promptFinal, 3000, 'claude-sonnet-4-6');
```
```js
        text = await callOllama(personaFinal, promptFinal, 3000);
```

Finally, after the response is sent (just before the closing of the `try`, after `res.json({ interpretation: text });`), add the fire-and-forget capture:

```js
    for (const a of answeredCuriosity) {
      if (Array.isArray(a.threadIds) && a.threadIds.length) {
        memory.captureAnswer(slug, a.answer, a.threadIds, callLLM, 'curiosity')
          .catch(err => console.warn('  ⚠  Curiosity capture failed:', err.message));
      }
    }
```

- [ ] **Step 3: Verify syntax + suite**

Run: `node --check server.js` → expect OK
Run: `node --test tests/*.test.js` → expect 0 fail

- [ ] **Step 4: Manual smoke** (temp DATA_DIR copy, as in earlier phases)

```bash
rm -rf .smoke-data && cp -r data .smoke-data 2>/dev/null || (mkdir .smoke-data && cp data/config.json .smoke-data/)
node -e "const e=require('./data/memory-engine')(process.argv[1]); e._store._db.prepare('UPDATE memories SET asked_at=NULL').run(); const id=e._store.addMemory('matt',{type:'thread',content:'tension with his sister Anna',status:'open',salience:5}); console.log('seeded',id)" "$(pwd)/.smoke-data"
DATA_DIR="$(pwd)/.smoke-data" PORT=3104 node server.js &
sleep 1
echo '--- detect (The Moon should plausibly resonate; result may be 0-2) ---'
curl -s -X POST http://localhost:3104/api/reading-questions -H 'content-type: application/json' -d '{"reader":"matt","cards":[{"id":"major-18","name":"The Moon","position":"Present","isReversed":false},{"id":"major-10","name":"Wheel of Fortune","position":"Future","isReversed":false}]}'
echo; echo '--- interpret with a curiosity answer (expect 200 interpretation) ---'
curl -s -X POST http://localhost:3104/api/interpret -H 'content-type: application/json' -d '{"reader":"matt","spread_type":"single","question":"general","cards":[{"id":"major-18","name":"The Moon","isReversed":false}],"curiosityAnswers":[{"question":"Is your sister still upset?","answer":"We talked, it is better now","threadIds":[REPLACE_WITH_SEEDED_ID]}]}' | node -e "process.stdin.once('data',d=>console.log('interp len:', (JSON.parse(d).interpretation||'').length))"
sleep 2
echo '--- did curiosity capture land? ---'
node -e "const e=require('./data/memory-engine')(process.argv[1]); for(const m of e.listMemories('matt')) if(m.source_kind==='curiosity') console.log(m.type,m.status||'-',m.content)" "$(pwd)/.smoke-data"
```
Replace `REPLACE_WITH_SEEDED_ID` with the id printed by the seed step. Then kill: `Get-NetTCPConnection -LocalPort 3104 -State Listen | %{ Stop-Process -Id $_.OwningProcess -Force }` and `rm -rf .smoke-data`.

Expected: detection returns `{questions:[...]}` (0–2; fine if 0 — detection is conservative); interpret returns a non-empty interpretation; a `curiosity`-sourced atom appears after the answer.

- [ ] **Step 5: Commit**

```bash
git add server.js
git commit -m "feat: /api/reading-questions + curiosity fold/capture in /api/interpret"
```

---

## Task 6: Frontend — curiosity panel markup + styles

**Files:** Modify `public/index.html`, `public/style.css` (no automated test)

- [ ] **Step 1: Add markup** — in `public/index.html`, after the `#threshold-overlay` block's closing `</div>`, add:

```html
  <!-- In-reading curiosity — she pauses on a card -->
  <div id="curiosity-panel" class="curiosity-panel hidden" aria-hidden="true">
    <div class="curiosity-eyebrow" id="curiosity-eyebrow"></div>
    <div class="curiosity-q" id="curiosity-q"></div>
    <textarea id="curiosity-answer" class="curiosity-answer" rows="2" placeholder="Tell her, or skip&hellip;"></textarea>
    <div class="curiosity-actions">
      <button id="curiosity-skip" class="curiosity-btn ghost" type="button">Skip</button>
      <button id="curiosity-answer-btn" class="curiosity-btn" type="button">Answer</button>
    </div>
  </div>
```

- [ ] **Step 2: Add styles** — append to `public/style.css`:

```css
/* In-reading curiosity pause */
.spread-area.curiosity-dim .card-container:not(.curiosity-focus) { opacity: .55; transition: opacity .5s; }
.card-container.curiosity-focus {
  box-shadow: 0 0 22px rgba(198,166,100,0.55), 0 0 4px rgba(198,166,100,0.85);
  transform: translateY(-6px) scale(1.03); transition: all .45s; z-index: 5;
}
.curiosity-panel {
  max-width: 440px; margin: 18px auto 0; text-align: center; padding: 16px 18px;
  background: radial-gradient(120% 130% at 50% 0%, #241a33 0%, #150f20 70%);
  border: 1px solid rgba(198,166,100,0.4); border-radius: 12px;
  box-shadow: 0 8px 36px rgba(0,0,0,0.45); opacity: 0; transition: opacity .5s;
}
.curiosity-panel.visible { opacity: 1; }
.curiosity-panel.hidden { display: none; }
.curiosity-eyebrow { font-size: 11px; letter-spacing: .18em; text-transform: uppercase; color: #c6a664; opacity: .85; margin-bottom: 9px; }
.curiosity-q { font-family: Georgia, serif; color: #f1ebdf; font-size: 16px; line-height: 1.6; }
.curiosity-answer {
  width: 100%; box-sizing: border-box; margin-top: 12px; background: rgba(255,255,255,0.05);
  border: 1px solid rgba(198,166,100,0.3); border-radius: 8px; color: #e8e0d0;
  font-family: Georgia, serif; font-size: 14px; padding: 9px 11px; resize: vertical;
}
.curiosity-actions { display: flex; gap: 11px; justify-content: center; margin-top: 11px; }
.curiosity-btn { background: linear-gradient(180deg,#c6a664,#9c7d3e); color: #1a1322; border: none;
  border-radius: 8px; padding: 8px 20px; font-family: Georgia, serif; font-weight: 600; cursor: pointer; }
.curiosity-btn.ghost { background: transparent; color: #9a8f7c; border: 1px solid rgba(255,255,255,0.14); }
.curiosity-btn:disabled { opacity: .5; cursor: default; }
```

- [ ] **Step 3: Verify**

Run: `node --check public/app.js` (unchanged, sanity) and confirm markup present: grep `curiosity-panel` in `public/index.html`, `.curiosity-q` in `public/style.css`.

- [ ] **Step 4: Commit**

```bash
git add public/index.html public/style.css
git commit -m "feat: curiosity pause panel markup + styles"
```

---

## Task 7: Frontend — JS-sequenced, human-paced, pausable deal

**Files:** Modify `public/app.js` (no automated test — manual smoke; timing is tuned visually)

Goal: replace the auto-deal's index-based CSS scheduling with a JS loop so the deal paces at ~2s/card (capped) and can pause. This task introduces the paced deal **without** curiosity yet (verify the deal still looks right); Task 8 inserts the pause.

- [ ] **Step 1: Add pacing helpers** — in `public/app.js`, near the deal constants (after `DEAL_FLIP_DELAY`), add:

```js
let dealToken = 0; // bumped on each new draw so an in-flight async deal can abort
function dealPaceMs(n) { return Math.min(2000, Math.max(1100, Math.round(14000 / n))); }
function jittered(ms) { return ms + (Math.random() * 500 - 250); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
```

- [ ] **Step 2: Make `makeCardEl` support deferred (JS-triggered) dealing**

In `makeCardEl`, replace the `if (lastRenderDealt) { ... }` block (the deal-in/deal-drop scheduling) with a version that, when the new async path is active (`window.__asyncDeal`), defers the animation to a `container.dealNow()` the loop calls. Replace the existing block:

```js
  if (lastRenderDealt) {
    const isRune = card.deckType === 'Runic';
    container.classList.add(isRune ? 'deal-drop' : 'deal-in');
    container.style.animationDelay = `${SHUFFLE_MS + index * DEAL_INTERVAL}ms`;
    container.addEventListener('animationend', () => {
      container.classList.remove('deal-in', 'deal-drop');
      container.style.animationDelay = '';
    }, { once: true });
    const flipAt = SHUFFLE_MS + index * DEAL_INTERVAL + DEAL_FLIP_DELAY;
    if (!faceUp) setTimeout(() => inner.classList.add('flipped'), flipAt);
    if (isRune) {
      const SCATTER_ANGLES = [-12, 8, -5, 14, -9, 6, -13, 10, -3, 11, -7, 4, -15, 9, -2, 13, -8, 5, -11, 7];
      const tilt = SCATTER_ANGLES[index % SCATTER_ANGLES.length];
      setTimeout(() => {
        container.style.transition = 'transform 0.22s ease-out';
        container.style.transform = `rotate(${tilt}deg)`;
        if (card.isReversed) {
          const badge = container.querySelector('.card-img-badge');
          if (badge) badge.style.transform = `translateX(-50%) rotate(${180 - tilt}deg)`;
        }
      }, flipAt - 80);
    }
  } else if (!faceUp) {
    setTimeout(() => inner.classList.add('flipped'), 300 + index * 150);
  }
```

with:

```js
  const isRune = card.deckType === 'Runic';
  function runScatter() {
    const SCATTER_ANGLES = [-12, 8, -5, 14, -9, 6, -13, 10, -3, 11, -7, 4, -15, 9, -2, 13, -8, 5, -11, 7];
    const tilt = SCATTER_ANGLES[index % SCATTER_ANGLES.length];
    container.style.transition = 'transform 0.22s ease-out';
    container.style.transform = `rotate(${tilt}deg)`;
    if (card.isReversed) {
      const badge = container.querySelector('.card-img-badge');
      if (badge) badge.style.transform = `translateX(-50%) rotate(${180 - tilt}deg)`;
    }
  }

  if (lastRenderDealt && window.__asyncDeal) {
    // JS-sequenced deal: the loop calls dealNow() when it's this card's turn.
    container.dealNow = () => {
      container.classList.add(isRune ? 'deal-drop' : 'deal-in');
      container.style.animationDelay = '0ms';
      container.addEventListener('animationend', () => {
        container.classList.remove('deal-in', 'deal-drop');
        container.style.animationDelay = '';
      }, { once: true });
      if (!faceUp) setTimeout(() => inner.classList.add('flipped'), DEAL_FLIP_DELAY);
      if (isRune) setTimeout(runScatter, DEAL_FLIP_DELAY - 80);
    };
  } else if (lastRenderDealt) {
    container.classList.add(isRune ? 'deal-drop' : 'deal-in');
    container.style.animationDelay = `${SHUFFLE_MS + index * DEAL_INTERVAL}ms`;
    container.addEventListener('animationend', () => {
      container.classList.remove('deal-in', 'deal-drop');
      container.style.animationDelay = '';
    }, { once: true });
    const flipAt = SHUFFLE_MS + index * DEAL_INTERVAL + DEAL_FLIP_DELAY;
    if (!faceUp) setTimeout(() => inner.classList.add('flipped'), flipAt);
    if (isRune) setTimeout(runScatter, flipAt - 80);
  } else if (!faceUp) {
    setTimeout(() => inner.classList.add('flipped'), 300 + index * 150);
  }
```

- [ ] **Step 3: Add the async deal driver** — in `public/app.js`, add a new function above `autoReveal`:

```js
// JS-sequenced paced deal for auto draws. onCard(i) may return a Promise to pause
// the deal after card i is laid (used by curiosity in Task 8).
async function dealAndReveal(onCard) {
  const myToken = dealToken;
  const n = drawnCards.length;
  const per = dealPaceMs(n);
  // Wait out the shuffle/riffle that renderSpread is showing, then deal card-by-card.
  await sleep(SHUFFLE_MS);
  for (let i = 0; i < n; i++) {
    if (dealToken !== myToken) return;            // a new draw superseded this one
    const containers = document.querySelectorAll('#spread-area .card-container');
    const el = containers[i];
    if (el && el.dealNow) el.dealNow();
    setTimeout(() => { if (dealToken === myToken) showMeaning(i); }, DEAL_FLIP_DELAY + 250);
    if (onCard) {
      const maybePause = onCard(i);
      if (maybePause && typeof maybePause.then === 'function') await maybePause;
    }
    await sleep(jittered(per));
  }
  if (dealToken !== myToken) return;
  if (themeCard) showThemeMeaning();
  await sleep(900);
  if (dealToken !== myToken) return;
  askClaude();
}
```

- [ ] **Step 4: Route the auto-draw paths through the async deal**

In `drawCards()` (the random-mode branch), find the tail:

```js
  cancelRevealTimers();
  dealAnimActive = true;
  renderSpread();
  renderThemeCard();
  hideMeaningPanel();
  scrollToNewReading();
  autoReveal();
```

replace the last two lines (`scrollToNewReading(); autoReveal();`) with:

```js
  scrollToNewReading();
  dealToken++;
  window.__asyncDeal = true;
  renderSpread();              // re-render so cards are created in deferred-deal mode
  window.__asyncDeal = false;
  dealAndReveal();
```

Wait — `renderSpread()` was already called above. To avoid a double render, instead set the flag BEFORE the existing `renderSpread()`. Apply this exact replacement for the whole tail block instead:

```js
  cancelRevealTimers();
  dealToken++;
  dealAnimActive = true;
  window.__asyncDeal = true;
  renderSpread();
  window.__asyncDeal = false;
  renderThemeCard();
  hideMeaningPanel();
  scrollToNewReading();
  dealAndReveal();
```

In `drawWithReaderChoice()`, find its tail where it calls `renderSpread(); renderThemeCard(); ... autoReveal();` (after the spread is chosen) and apply the same pattern: bump `dealToken`, set `window.__asyncDeal = true` around `renderSpread()`, and replace `autoReveal()` with `dealAndReveal()`.

> `renderSpread` reads `lastRenderDealt = dealAnimActive` then clears it; `makeCardEl` checks `lastRenderDealt && window.__asyncDeal`. Setting the flag only around `renderSpread()` is sufficient because `dealNow` closures capture nothing time-based. Manual draws and resume paths still call `autoReveal()` and are unchanged.

- [ ] **Step 5: Manual smoke (deal pacing only)**

Run `npm start`, open `http://localhost:3000`, draw a single card and a multi-card spread (e.g. three-card and Celtic Cross). Verify: cards lay one at a time at a deliberate ~2s pace (single/small spreads), a 10-card spread stays ~14s total, the rhythm has slight variation, each card flips and its meaning appears, and the reading still generates at the end. Confirm manual entry and "resume" still deal as before (unchanged path). If the pace feels off, tune `dealPaceMs`/jitter.

- [ ] **Step 6: Commit**

```bash
git add public/app.js
git commit -m "feat: JS-sequenced human-paced deal (pausable) for auto draws"
```

---

## Task 8: Frontend — the curiosity pause (detection + pause + fold)

**Files:** Modify `public/app.js` (no automated test — manual smoke)

- [ ] **Step 1: Detect up front and pause on trigger cards**

In `public/app.js`, add a module-level holder and a pause function above `dealAndReveal`:

```js
let pendingCuriosity = [];   // [{cardId, question, threadIds}] for the current deal
let curiosityAnswers = [];   // [{question, answer, threadIds}] collected this deal

function curiosityPauseForCard(cardIndex) {
  const card = drawnCards[cardIndex];
  const trigger = card && pendingCuriosity.find(q => q.cardId === (card.id || ''));
  if (!trigger) return null;
  return new Promise(resolve => {
    const containers = document.querySelectorAll('#spread-area .card-container');
    const el = containers[cardIndex];
    const area = document.getElementById('spread-area');
    const panel = document.getElementById('curiosity-panel');
    const qEl = document.getElementById('curiosity-q');
    const eyebrow = document.getElementById('curiosity-eyebrow');
    const answerEl = document.getElementById('curiosity-answer');
    const answerBtn = document.getElementById('curiosity-answer-btn');
    const skipBtn = document.getElementById('curiosity-skip');
    if (!el || !panel) { resolve(); return; }

    if (area) area.classList.add('curiosity-dim');
    el.classList.add('curiosity-focus');
    eyebrow.textContent = `☾  she lingers on ${card.name}`;
    qEl.textContent = trigger.question;
    answerEl.value = '';
    answerEl.hidden = false;
    answerBtn.disabled = false;
    answerBtn.textContent = 'Answer';
    // place the panel right after the spread area so it reads as attached to the spread
    if (area && area.parentNode) area.parentNode.insertBefore(panel, area.nextSibling);
    panel.classList.remove('hidden');
    requestAnimationFrame(() => panel.classList.add('visible'));

    const started = Date.now();
    const finish = (answer) => {
      if (answer && answer.trim()) {
        curiosityAnswers.push({ question: trigger.question, answer: answer.trim(), threadIds: trigger.threadIds });
      }
      panel.classList.remove('visible');
      el.classList.remove('curiosity-focus');
      if (area) area.classList.remove('curiosity-dim');
      setTimeout(() => panel.classList.add('hidden'), 500);
      resolve();
    };
    // enforce a 3-4s minimum glow even if the user is instant, so it reads as a real beat
    const guard = (answer) => {
      const elapsed = Date.now() - started;
      const wait = Math.max(0, 3200 - elapsed);
      answerBtn.disabled = true;
      setTimeout(() => finish(answer), wait);
    };
    answerBtn.onclick = () => guard(answerEl.value);
    skipBtn.onclick = () => guard('');
  });
}
```

- [ ] **Step 2: Run detection before the deal and pass the pause hook**

In `dealAndReveal`, replace the body's opening (the `const myToken = dealToken;` through the first `await sleep(SHUFFLE_MS);`) so detection runs during the shuffle:

```js
async function dealAndReveal(onCard) {
  const myToken = dealToken;
  const n = drawnCards.length;
  const per = dealPaceMs(n);

  // Detect curiosity during the shuffle beat (only fires if the reader has threads).
  pendingCuriosity = [];
  curiosityAnswers = [];
  const detectP = (async () => {
    try {
      const r = await fetch('/api/reading-questions', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reader: currentReader.slug,
          cards: drawnCards.map(c => ({ id: c.id || '', name: c.name, position: c.positionLabel || '', isReversed: !!c.isReversed })),
        }),
      });
      if (r.ok) pendingCuriosity = (await r.json()).questions || [];
    } catch {}
  })();

  await sleep(SHUFFLE_MS);
  await detectP;                 // ensure triggers known before the first card lands
  if (dealToken !== myToken) return;
  // (rest of the loop unchanged)
```

Keep the existing `for` loop and tail exactly as in Task 7, but the callers will now pass `curiosityPauseForCard`. Change the loop's `onCard` usage to default to the curiosity hook: where Task 7 had `if (onCard) { const maybePause = onCard(i); ... }`, replace with:

```js
    const hook = onCard || curiosityPauseForCard;
    const maybePause = hook(i);
    if (maybePause && typeof maybePause.then === 'function') await maybePause;
```

- [ ] **Step 3: Send `curiosityAnswers` with the reading**

In `askClaude`, find the `payload` object (the one with `priorReadings`, `readerName`, `moonPhase`). Add one field to it:

```js
    moonPhase: moonPhaseInfo().name,
    curiosityAnswers: curiosityAnswers,
```

(`curiosityAnswers` is the module-level array filled during the deal; it's `[]` for readings with no curiosity, so the payload is harmless then.)

- [ ] **Step 4: Manual smoke (full curiosity flow)**

```bash
node -e "const e=require('./data/memory-engine')('./data'); e._store._db.prepare('UPDATE memories SET asked_at=NULL').run(); console.log('cleared asked_at so threads can trigger')"
npm start
```
Open `http://localhost:3000` as a reader with strong open threads (e.g. `matt`). Draw several spreads. Expected: most deals proceed normally; occasionally the deal pauses on a card that glows (others dim), the panel names the card and asks a memory-aware question; answering resumes the deal and the resulting reading reflects your answer; a `curiosity` atom is written and the thread is marked asked (won't re-trigger). Verify skip resumes cleanly, and that a 10-card spread still completes. (Detection is conservative — if nothing triggers across a few draws, lower `THRESHOLD_SALIENCE_BAR` temporarily or seed a clearly card-resonant thread to exercise the path, then restore.)

- [ ] **Step 5: Commit**

```bash
git add public/app.js
git commit -m "feat: in-reading curiosity pause (detect, pause-on-card, fold answer into reading)"
```

---

## Task 9: Final verification

- [ ] **Step 1: Full suite** — `node --test tests/*.test.js` → expect 0 fail (report totals).
- [ ] **Step 2: Clean load** — `node -e "process.env.DATA_DIR='./.vcheck'; require('./server.js'); setTimeout(()=>{console.log('ok');process.exit(0)},600)"` then `rm -rf .vcheck` → no thrown errors.
- [ ] **Step 3: Syntax** — `node --check server.js && node --check public/app.js` → both OK.
- [ ] **Step 4: Git** — `git log --oneline master..HEAD` shows Tasks 1–8; `git status` clean (no `.smoke-data`, `.vcheck`, `memory.db*`).

---

## Self-Review (completed during authoring)

- **Spec coverage:** §3.1 paced deal → Task 7 (`dealPaceMs`/jitter/`dealAndReveal`); §3.2 pause UI → Task 6 (panel/CSS) + Task 8 (`curiosityPauseForCard`, glow/dim, 3–4s min beat); §3.3 frequency/triggering → Task 3 (`detectCuriosity`, ≤2, conservative, salience-gated unasked) + Task 2 (prompt bias); §3.4 capture+fold+mark-asked → Task 4 (`captureAnswer` 'curiosity'), Task 5 (interpret fold + fire-and-forget capture; endpoint `markAsked`), skip-still-marks (marked at detection in Task 5); §4 architecture (detect-up-front, single-shot interpret) → Tasks 5/8; §5 components → Tasks 1–8; §6 error handling → Task 3 (LLM→[]), Task 5 (endpoint wrapped→`{questions:[]}`), Task 8 (fetch catch), `dealToken` abort (Tasks 7/8); §7 testing → Tasks 1–4 unit + 5/7/8 manual.
- **Placeholder scan:** the only intentional fill-in is `REPLACE_WITH_SEEDED_ID` in the Task 5 manual smoke (an interactive value the operator pastes), and the `(rest of the loop unchanged)` reference in Task 8 which points at the fully-written loop in Task 7 of the same file — acceptable for a same-file continuation. No code-step placeholders.
- **Type/name consistency:** `parseCuriosityOutput`, `buildCuriosityPrompt`, `detectCuriosity(slug,cards,callLLM)` → `[{cardId,question,threadIds}]`, `captureAnswer(slug,answer,threadIds,callLLM,sourceKind)`, `CURIOSITY_SYSTEM`, `EXTRACT_MODEL`, `THRESHOLD_SALIENCE_BAR`, `/api/reading-questions` `{questions}`, payload `curiosityAnswers:[{question,answer,threadIds}]`, frontend `dealToken`/`window.__asyncDeal`/`container.dealNow`/`dealAndReveal`/`curiosityPauseForCard` are used identically across tasks. Server marks asked via `q.threadIds` matching detector output. Interpret uses `promptFinal` in both model calls.
