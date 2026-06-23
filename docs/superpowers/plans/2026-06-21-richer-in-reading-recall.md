# Richer In-Reading Recall Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make recall surface the memories *relevant to this reading* (not just the globally salient ones), more of them, framed so Miriel uses them concretely.

**Architecture:** Three surgical changes in `data/memory-engine.js`'s recall path — rebalance `scoreMemory` so query relevance outweighs raw salience, raise `RECALL_LIMIT` 5→10, and rewrite `formatRecallBlock`'s framing. The reading LLM does final semantic selection from the richer ranked set. No new files, no extra LLM call, no schema change.

**Tech Stack:** Node; pure helpers `scoreCandidates`/`scoreMemory`/`formatRecallBlock` in `data/memory-engine.js` (scoreCandidates + formatRecallBlock are exported); tests via `node --test tests/*.test.js` (existing `tests/memory-engine.test.js`).

**Verification:** The ranking change is unit-tested via the exported `scoreCandidates` (a query-relevant memory must outrank a more-salient unrelated one). The framing change is unit-tested via `formatRecallBlock`. Final relevance/specificity verified by live sample readings.

**Branch:** `richer-recall` (created; spec committed there).

---

## File Structure
- **Modify** `data/memory-engine.js` — `scoreMemory` weights, `RECALL_LIMIT`, `formatRecallBlock`.
- **Modify** `tests/memory-engine.test.js` — ranking + framing unit tests.

---

## Task 1: Re-tune recall (TDD)

**Files:** Modify `data/memory-engine.js`; Test `tests/memory-engine.test.js`

- [ ] **Step 1: Write failing tests**

Append to `tests/memory-engine.test.js` (it already requires `createMemoryEngine`; add the named imports you need at the top or inline-require):
```javascript
const { scoreCandidates, formatRecallBlock } = require('../data/memory-engine');

test('recall ranking: a query-relevant memory outranks a more-salient unrelated one', () => {
  const now = Math.floor(Date.now() / 1000);
  const salientUnrelated = { id: 1, content: 'they love hiking in the mountains', subject: 'hobbies', status: 'open', salience: 5, last_referenced_at: null, reference_count: 0 };
  const relevant         = { id: 2, content: 'they keep wrestling with whether to leave their job', subject: 'work', status: 'open', salience: 3, last_referenced_at: null, reference_count: 0 };
  const ranked = scoreCandidates([salientUnrelated, relevant], { question: 'should I leave my job?', cards: [{ name: 'The Tower' }], now });
  assert.equal(ranked[0].memory.id, 2, 'the job-relevant memory ranks first despite lower salience');
});

test('recall ranking: with no query overlap, salience still orders results', () => {
  const now = Math.floor(Date.now() / 1000);
  const a = { id: 1, content: 'unrelated alpha', subject: '', status: 'open', salience: 5, last_referenced_at: null, reference_count: 0 };
  const b = { id: 2, content: 'unrelated beta',  subject: '', status: 'open', salience: 2, last_referenced_at: null, reference_count: 0 };
  const ranked = scoreCandidates([b, a], { question: 'nothing in common here', cards: [], now });
  assert.equal(ranked[0].memory.id, 1, 'higher salience wins when neither overlaps');
});

test('formatRecallBlock uses the concrete-use framing and includes contents', () => {
  const block = formatRecallBlock([{ content: 'they fear repeating their mother\'s path' }]);
  assert.match(block, /name it specifically|genuinely connects/i);
  assert.match(block, /mother's path/);
});
```

- [ ] **Step 2: Run, verify failure**

Run: `node --test tests/memory-engine.test.js`
Expected: the first test FAILS (currently salience 2.0 > overlap 1.5, so the salient-unrelated memory ranks first); the framing test FAILS (old wording). The second test may already pass.

- [ ] **Step 3: Rebalance `scoreMemory`**

In `data/memory-engine.js`, FIND:
```javascript
function scoreMemory(m, queryTokens, now) {
  const statusW = m.status === 'open' ? 1 : m.status === 'moving' ? 0.6 : 0;
  const sal     = Math.min(5, Math.max(1, m.salience || 3)) / 5;
  const overlap = keywordOverlap(queryTokens, tokenize(`${m.content} ${m.subject || ''}`));
  const fresh   = freshness(m.last_referenced_at, now);
  const over    = Math.min(1, (m.reference_count || 0) / 5);
  return 2.0 * sal + 1.5 * statusW + 1.5 * overlap + 0.5 * fresh - 0.4 * over;
}
```
REPLACE the final `return` line with (query relevance now leads; salience becomes a strong floor/tiebreaker):
```javascript
  return 3.0 * overlap + 1.5 * sal + 1.5 * statusW + 0.5 * fresh - 0.4 * over;
}
```
(Only the coefficients change: overlap 1.5→3.0, salience 2.0→1.5. Keep `statusW`, `fresh`, `over` and the rest of the function as-is.)

- [ ] **Step 4: Raise `RECALL_LIMIT`**

FIND:
```javascript
const RECALL_LIMIT = 5;
```
REPLACE WITH:
```javascript
const RECALL_LIMIT = 10;
```

- [ ] **Step 5: Rewrite `formatRecallBlock`**

FIND:
```javascript
function formatRecallBlock(memories) {
  if (!memories || !memories.length) return '';
  const lines = memories.map(m => `- ${m.content}`).join('\n');
  return `\n\nThings you remember about this person that may bear on what's in front of you now — ` +
         `hold them lightly, and bring them in only if the cards genuinely point there:\n${lines}`;
}
```
REPLACE WITH:
```javascript
function formatRecallBlock(memories) {
  if (!memories || !memories.length) return '';
  const lines = memories.map(m => `- ${m.content}`).join('\n');
  return `\n\nWhat you know about this person that may bear on what's in front of them now. ` +
         `Draw on whatever genuinely connects to their question or these cards — and when you do, ` +
         `name it specifically (the actual moment or thread), not a vague gesture. Don't force in ` +
         `memories that don't fit; say nothing rather than reach:\n${lines}`;
}
```

- [ ] **Step 6: Run tests, verify pass**

Run: `node --test tests/memory-engine.test.js` → the three new tests PASS. Then `node --test tests/*.test.js` → full suite green.

- [ ] **Step 7: Commit**
```bash
git add data/memory-engine.js tests/memory-engine.test.js
git commit -m "feat(memory): relevance-led recall, wider limit, concrete-use framing"
```

---

## Task 2: Wrap — regression + sample review

**Files:** Reference only

- [ ] **Step 1: Regression**

Run: `node --test tests/*.test.js`
Expected: all pass (129 prior + the 3 new recall tests).

- [ ] **Step 2: Sample review (live)**

With a valid API key and `npm start` running, for a reader with varied history, run a reading whose question maps to a *specific, non-most-salient* memory. Confirm Miriel now:
- surfaces the **relevant** memory (not just her most salient one),
- **names it specifically** (the actual thread/event), woven naturally,
- and, on a question with no relevant history, does NOT force a memory in.
A direct `POST /api/interpret` (as used for prior sample reviews) reading the `interpretation` field is the easiest probe.

- [ ] **Step 3: Final commit (if touch-ups needed)**
```bash
git add -A
git commit -m "chore(memory): richer recall sample-review pass"
```

---

## Self-Review

**Spec coverage:**
- Relevance leads (overlap 3.0 > salience 1.5) → Task 1 Step 3 + ranking test ✓
- More coverage (RECALL_LIMIT 5→10) → Task 1 Step 4 ✓
- Concrete-use + specificity framing → Task 1 Step 5 + framing test ✓
- Salience still orders when no overlap (no regression to baseline behavior) → second ranking test ✓
- `score > 0` guard unchanged (resolved/irrelevant still excluded) → not modified ✓
- No extra LLM call / schema change / new files → held ✓

**Placeholder scan:** none — exact coefficient edits, exact constant, full new `formatRecallBlock`, full test code.

**Type/name consistency:** uses exported `scoreCandidates(candidates, {question, cards, now})` and `formatRecallBlock(memories)` — matching their real signatures. `scoreMemory` keeps its signature; only coefficients change. `RECALL_LIMIT` referenced by `recall` unchanged in name.
