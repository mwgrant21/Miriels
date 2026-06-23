# Pattern Recognition Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Miriel accurate, quantified pattern-awareness about the cards just drawn (recurrence+recency, reversal tendency, suit/element skew), surfaced in the reading.

**Architecture:** A pure detector (`data/card-patterns.js`) computes factual pattern statements from the reader's readings + the current draw; `/api/interpret` runs it and appends the facts to the persona as a "patterns you accurately notice" block. No schema change; correlation deferred.

**Tech Stack:** Node/Express; pure logic in `data/card-patterns.js`; tests via `node --test tests/*.test.js`.

**Verification:** The detector is pure and unit-tested (TDD). The interpret wiring is verified by `node --check` + a live sample reading. Regression suite stays green.

**Branch:** `pattern-recognition` (created; spec committed there).

---

## File Structure
- **Create** `data/card-patterns.js` — `findCardPatterns(...)` (pure).
- **Create** `tests/card-patterns.test.js` — unit tests.
- **Modify** `server.js` — `/api/interpret`: compute patterns, append a pattern block to the persona.

---

## Task 1: Pattern detector (TDD)

**Files:** Create `data/card-patterns.js`; Create `tests/card-patterns.test.js`

- [ ] **Step 1: Write the failing tests**

Create `tests/card-patterns.test.js`:
```javascript
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { findCardPatterns } = require('../data/card-patterns');

const DAY = 86400000;
const NOW = Date.UTC(2026, 5, 20, 12, 0, 0);
function daysAgo(n) { return NOW - n * DAY; }
function rdg(ts, cards) { return { timestamp: ts, cards }; }
function card(name, reversed = false) { return { name, isReversed: reversed }; }

test('recurrence: a card drawn several times this month is noticed with accurate counts', () => {
  const readings = [
    rdg(daysAgo(25), [card('The Tower')]),
    rdg(daysAgo(12), [card('The Tower')]),
    rdg(daysAgo(3),  [card('Three of Cups')]),
  ];
  const out = findCardPatterns({ readings, currentCards: [card('The Tower')], now: NOW });
  const rec = out.find(f => f.kind === 'recurrence');
  assert.ok(rec, 'recurrence fact present');
  assert.match(rec.fact, /The Tower/);
  assert.match(rec.fact, /3 times this past month/);   // 2 historical this month + current
  assert.match(rec.fact, /3rd time/);                   // total 2 + current = 3rd
});

test('recurrence: a card seen only once before does NOT fire', () => {
  const readings = [rdg(daysAgo(40), [card('The Star')])];
  const out = findCardPatterns({ readings, currentCards: [card('The Star')], now: NOW });
  assert.equal(out.find(f => f.kind === 'recurrence'), undefined);
});

test('reversal tendency: a card that mostly comes reversed is flagged, not as plain recurrence', () => {
  const readings = [
    rdg(daysAgo(100), [card('The Empress', true)]),
    rdg(daysAgo(70),  [card('The Empress', true)]),
    rdg(daysAgo(40),  [card('The Empress', true)]),
  ];
  const out = findCardPatterns({ readings, currentCards: [card('The Empress', true)], now: NOW });
  const rev = out.find(f => f.kind === 'reversal');
  assert.ok(rev, 'reversal fact present');
  assert.match(rev.fact, /reversed/i);
  assert.equal(out.find(f => f.kind === 'recurrence' && /Empress/.test(f.fact)), undefined, 'no duplicate recurrence fact for same card');
});

test('reversal does not fire when the current draw is upright', () => {
  const readings = [
    rdg(daysAgo(100), [card('The Empress', true)]),
    rdg(daysAgo(70),  [card('The Empress', true)]),
    rdg(daysAgo(40),  [card('The Empress', true)]),
  ];
  const out = findCardPatterns({ readings, currentCards: [card('The Empress', false)], now: NOW });
  assert.equal(out.find(f => f.kind === 'reversal'), undefined);
});

test('suit skew: a window dominated by one suit is noticed (tarot)', () => {
  const readings = [
    rdg(daysAgo(10), [card('Two of Swords'), card('Five of Swords')]),
    rdg(daysAgo(5),  [card('Knight of Swords'), card('The Sun')]),
  ];
  const out = findCardPatterns({ readings, currentCards: [card('Ten of Swords')], now: NOW });
  const skew = out.find(f => f.kind === 'skew');
  assert.ok(skew, 'skew fact present');
  assert.match(skew.fact, /Swords/i);
});

test('suit skew does NOT fire without enough suited cards', () => {
  const readings = [rdg(daysAgo(5), [card('The Sun'), card('The Moon')])];
  const out = findCardPatterns({ readings, currentCards: [card('The Star')], now: NOW });
  assert.equal(out.find(f => f.kind === 'skew'), undefined);
});

test('ordinary draw with no history returns []', () => {
  const out = findCardPatterns({ readings: [], currentCards: [card('The Hermit')], now: NOW });
  assert.deepEqual(out, []);
});

test('caps at 3 facts', () => {
  const many = [];
  for (let i = 0; i < 6; i++) many.push(rdg(daysAgo(20 - i), [card('The Tower'), card('Two of Cups'), card('Three of Cups'), card('Four of Cups')]));
  const out = findCardPatterns({ readings: many, currentCards: [card('The Tower'), card('Two of Cups')], now: NOW });
  assert.ok(out.length <= 3, 'no more than 3 facts');
});
```

- [ ] **Step 2: Run, verify failure**

Run: `node --test tests/card-patterns.test.js`
Expected: FAIL — `Cannot find module '../data/card-patterns'`.

- [ ] **Step 3: Implement `data/card-patterns.js`**

```javascript
'use strict';

const DAY = 86400000; // ms
const SUIT_RE = /\bof\s+(wands|cups|swords|pentacles|disks|coins)\b/i;

function norm(name) { return String(name || '').trim().toLowerCase(); }

function suitOf(name) {
  const m = SUIT_RE.exec(name || '');
  if (!m) return null;
  let s = m[1].toLowerCase();
  if (s === 'disks' || s === 'coins') s = 'pentacles'; // normalize across decks
  return s;
}

function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

/**
 * Pure: factual pattern observations about the current draw.
 * @param {{readings:Array, currentCards:Array, now:number}} args  ms timestamps
 * @returns {Array<{kind:'recurrence'|'reversal'|'skew', strength:number, fact:string}>}
 */
function findCardPatterns({ readings, currentCards, now }) {
  const sorted = (Array.isArray(readings) ? readings : [])
    .filter(r => r && typeof r.timestamp === 'number')
    .sort((a, b) => a.timestamp - b.timestamp);

  const appearances = []; // {name, reversed, ts}
  for (const r of sorted) for (const c of (r.cards || [])) {
    appearances.push({ name: norm(c.name), reversed: !!c.isReversed, ts: r.timestamp });
  }

  const cur = Array.isArray(currentCards) ? currentCards : [];
  const lastN = sorted.slice(-8);
  const byCard = new Map(); // one fact per current card name (reversal preferred)

  for (const c of cur) {
    const nm = norm(c.name);
    if (!nm || byCard.has(nm)) continue;
    const hist = appearances.filter(a => a.name === nm);
    const total = hist.length;                                   // historical (excludes current)
    const last30 = hist.filter(a => now - a.ts <= 30 * DAY).length;
    const inLastN = lastN.filter(r => (r.cards || []).some(x => norm(x.name) === nm)).length;

    // Reversal tendency (more striking) wins when the current draw is reversed.
    if (c.isReversed && total >= 3) {
      const revShare = hist.filter(a => a.reversed).length / total;
      if (revShare >= 0.7) {
        byCard.set(nm, {
          kind: 'reversal',
          strength: 4 + (revShare >= 0.9 ? 1 : 0),
          fact: `${c.name}, reversed again — it almost never lands upright for you (${Math.round(revShare * 100)}% of the times it's come).`,
        });
        continue;
      }
    }

    if (total >= 3 || last30 >= 2 || inLastN >= 4) {
      const ever = total + 1;     // count including this draw
      const month = last30 + 1;
      const bits = [];
      if (last30 >= 2) bits.push(`${month} times this past month`);
      bits.push(`the ${ordinal(ever)} time you've drawn it`);
      byCard.set(nm, {
        kind: 'recurrence',
        strength: (last30 >= 2 ? 2 : 0) + Math.min(3, ever),
        fact: `${c.name} again — ${bits.join(', ')}.`,
      });
    }
  }

  const facts = [...byCard.values()];

  // Suit/element skew over the current cards + the last 5 readings (tarot suits only).
  const windowCards = [
    ...cur.map(c => c.name),
    ...sorted.slice(-5).flatMap(r => (r.cards || []).map(x => x.name)),
  ];
  const suits = windowCards.map(suitOf).filter(Boolean);
  if (suits.length >= 4) {
    const counts = {};
    for (const s of suits) counts[s] = (counts[s] || 0) + 1;
    let top = null;
    for (const s of Object.keys(counts)) if (!top || counts[s] > counts[top]) top = s;
    if (top && counts[top] / suits.length >= 0.5) {
      facts.push({
        kind: 'skew',
        strength: 2,
        fact: `${top.charAt(0).toUpperCase() + top.slice(1)} keep crowding your spreads lately.`,
      });
    }
  }

  facts.sort((a, b) => b.strength - a.strength);
  return facts.slice(0, 3);
}

module.exports = { findCardPatterns };
```

- [ ] **Step 4: Run tests, verify pass**

Run: `node --test tests/card-patterns.test.js` → PASS. Then `node --test tests/*.test.js` → full suite green.

- [ ] **Step 5: Commit**
```bash
git add data/card-patterns.js tests/card-patterns.test.js
git commit -m "feat(memory): deterministic card-pattern detector (pure, TDD)"
```

---

## Task 2: Surface patterns in the reading (`/api/interpret`)

**Files:** Modify `server.js` (require + the `/api/interpret` handler ~line 607-627)

- [ ] **Step 1: Require the detector**

Near the other top-level requires in `server.js`, add:
```javascript
const { findCardPatterns } = require('./data/card-patterns');
```

- [ ] **Step 2: Compute patterns and append a pattern block to the persona**

In `app.post('/api/interpret', ...)`, FIND:
```javascript
  let memoryBlock = '';
  try {
    memoryBlock = memory.recall(slug, { question, cards }).block;
  } catch (err) {
    console.warn('  ⚠  Memory recall failed:', err.message);
  }
  const personaFinal = personaWithName + memoryBlock;
```
REPLACE WITH:
```javascript
  let memoryBlock = '';
  try {
    memoryBlock = memory.recall(slug, { question, cards }).block;
  } catch (err) {
    console.warn('  ⚠  Memory recall failed:', err.message);
  }

  // Deterministic, accurate pattern facts about the cards just drawn.
  let patternBlock = '';
  try {
    const patterns = findCardPatterns({ readings: loadReadings(slug), currentCards: cards, now: Date.now() });
    if (patterns.length) {
      patternBlock = `\n\nPatterns you accurately notice in the cards before you (state any that genuinely illuminate something, in your own voice — these counts are real; never inflate them, and skip any that don't serve the reading):\n${patterns.map(p => `- ${p.fact}`).join('\n')}`;
    }
  } catch (err) {
    console.warn('  ⚠  Pattern detection failed:', err.message);
  }

  const personaFinal = personaWithName + memoryBlock + patternBlock;
```

- [ ] **Step 3: Verify**

Run: `node --check server.js` → valid. `node --test tests/*.test.js` → green (server change doesn't affect tests).

- [ ] **Step 4: Commit**
```bash
git add server.js
git commit -m "feat(memory): feed accurate card patterns into the reading"
```

---

## Task 3: Wrap — regression + sample review

**Files:** Reference only

- [ ] **Step 1: Regression**

Run: `node --test tests/*.test.js`
Expected: all pass (121 prior + the new card-pattern tests).

- [ ] **Step 2: Sample review (live)**

With a valid API key and `npm start` running, do a reading whose drawn card genuinely recurs in the reader's history (or temporarily seed a throwaway reader whose readings include the same card ≥3 times this month, then draw that card). Confirm Miriel cites the pattern with the **correct count** ("…that's 3 times this past month, the 4th time you've drawn it"), woven naturally, not exaggerated. Then do an ordinary reading with no recurring card and confirm she does NOT manufacture a pattern. Clean up any throwaway reader.

- [ ] **Step 3: Final commit (if touch-ups needed)**
```bash
git add -A
git commit -m "chore(memory): pattern recognition sample-review pass"
```

---

## Self-Review

**Spec coverage:**
- Recurrence + recency (thresholds total≥3 / last30≥2 / inLastN≥4; accurate counts incl. current) → Task 1 ✓
- Reversal tendency (seen≥3, reversed share≥0.7, only when current reversed, precedence over recurrence) → Task 1 ✓
- Suit/element skew (current + last 5 readings, ≥4 suited, ≥50% one suit, Disks/Coins→Pentacles, tarot-only) → Task 1 ✓
- Cap ≤3, `[]` on ordinary draws → Task 1 (+ tests) ✓
- Surfaced in the reading via persona pattern block, "counts are real; never inflate" → Task 2 ✓
- No schema change; correlation/journal-weave untouched → held ✓

**Placeholder scan:** none — full detector + test code, exact server edit.

**Type/name consistency:** `findCardPatterns({readings,currentCards,now})` matches usage in tests and server. Fact shape `{kind,strength,fact}` consistent. `now` injected (pure) in tests; server passes `Date.now()` (ms) and `loadReadings(slug)` (readings carry ms `timestamp`). `suitOf`/`norm`/`ordinal` are internal helpers.
