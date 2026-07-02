# The Returning Card Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Miriel notice when a card that was once a recurring presence reappears after a long absence, and name the return in the reading.

**Architecture:** One new branch in the existing pure detector `findCardPatterns` (`data/card-patterns.js`), plus a small `describeGap` helper. Surfaces through the existing `patternBlock` with no server, wiring, or schema changes.

**Tech Stack:** Node.js, `node --test`.

## Global Constraints

- **Single file of production code:** `data/card-patterns.js`. No server/schema/wiring changes.
- **`DAY` in this file is MILLISECONDS** (`86400000`) — all gap math is ms.
- **Definition:** a current card with `total >= 3` prior appearances whose most-recent prior appearance is `>= 90 days` ago (`RETURN_GAP_MS = 90 * DAY`).
- **Precedence:** reversal > returning > recurrence. The returning branch goes AFTER the reversal branch (which already `continue`s) and BEFORE the recurrence branch, and itself `continue`s so the same card does not also emit a recurrence fact.
- **Strength:** `4 + (gapMs >= 180 * DAY ? 1 : 0)` (i.e. 4, or 5 for a `>= 180`-day gap).
- **Fact wording (ASCII, second person):** `` `${c.name} returns, you haven't drawn it in ${describeGap(gapMs)}.` ``
- **`describeGap` is relative only** (months/weeks/days/"almost a year") — no calendar/season math.
- **Contract unchanged:** `findCardPatterns` receives PRE-save readings (history WITHOUT the current draw). The returning branch reads only prior appearances.
- **Test command:** `node --test` from project root (currently 184 passing). Targeted: `node --test tests/card-patterns.test.js`. Do NOT use `node --test tests/`.

---

### Task 1: Returning-card branch in `findCardPatterns`

**Files:**
- Modify: `data/card-patterns.js`
- Test: `tests/card-patterns.test.js`

**Interfaces:**
- Consumes: the existing per-card locals in `findCardPatterns` (`nm`, `c`, `hist`, `total`, `byCard`, `now`, the module `DAY`).
- Produces: a fact object `{ kind: 'returning', strength: 4|5, fact: string }` set into `byCard` for a qualifying card; a module-scope `describeGap(ms)` helper.

- [ ] **Step 1: Write the failing tests**

Append to `tests/card-patterns.test.js` (the helpers `DAY`, `NOW`, `daysAgo`, `rdg`, `card` already exist at the top of the file):

```javascript
test('returning: a recurring card absent >= 90 days is noticed as a return', () => {
  const readings = [
    rdg(daysAgo(180), [card('The Tower')]),
    rdg(daysAgo(150), [card('The Tower')]),
    rdg(daysAgo(120), [card('The Tower')]), // most-recent prior = 120 days ago
  ];
  const out = findCardPatterns({ readings, currentCards: [card('The Tower')], now: NOW });
  const ret = out.find(f => f.kind === 'returning');
  assert.ok(ret, 'returning fact present');
  assert.match(ret.fact, /The Tower returns/);
  assert.match(ret.fact, /about 4 months/);
});

test('returning: a very long absence (>= 180 days) gets strength 5', () => {
  const readings = [
    rdg(daysAgo(360), [card('Death')]),
    rdg(daysAgo(300), [card('Death')]),
    rdg(daysAgo(210), [card('Death')]), // most-recent prior = 210 days ago
  ];
  const out = findCardPatterns({ readings, currentCards: [card('Death')], now: NOW });
  const ret = out.find(f => f.kind === 'returning');
  assert.ok(ret);
  assert.equal(ret.strength, 5);
});

test('returning: an absence of almost a year is phrased as such', () => {
  const readings = [
    rdg(daysAgo(500), [card('The Moon')]),
    rdg(daysAgo(420), [card('The Moon')]),
    rdg(daysAgo(350), [card('The Moon')]), // ~350 days ago
  ];
  const out = findCardPatterns({ readings, currentCards: [card('The Moon')], now: NOW });
  assert.match(out.find(f => f.kind === 'returning').fact, /almost a year/);
});

test('returning does NOT fire when the card appeared recently (falls through to recurrence)', () => {
  const readings = [
    rdg(daysAgo(120), [card('The Tower')]),
    rdg(daysAgo(110), [card('The Tower')]),
    rdg(daysAgo(20),  [card('The Tower')]), // most-recent prior = 20 days ago (< 90)
  ];
  const out = findCardPatterns({ readings, currentCards: [card('The Tower')], now: NOW });
  assert.equal(out.find(f => f.kind === 'returning'), undefined);
  assert.ok(out.find(f => f.kind === 'recurrence'), 'recurrence fires instead');
});

test('returning does NOT fire for a card with fewer than 3 prior appearances', () => {
  const readings = [
    rdg(daysAgo(200), [card('The Star')]),
    rdg(daysAgo(150), [card('The Star')]), // only 2 prior appearances
  ];
  const out = findCardPatterns({ readings, currentCards: [card('The Star')], now: NOW });
  assert.equal(out.find(f => f.kind === 'returning'), undefined);
  assert.equal(out.find(f => f.kind === 'recurrence'), undefined);
});

test('returning takes precedence over recurrence for the same card (no duplicate fact)', () => {
  const readings = [
    rdg(daysAgo(200), [card('Death')]),
    rdg(daysAgo(170), [card('Death')]),
    rdg(daysAgo(140), [card('Death')]),
  ];
  const out = findCardPatterns({ readings, currentCards: [card('Death')], now: NOW });
  assert.ok(out.find(f => f.kind === 'returning'));
  assert.equal(out.find(f => f.kind === 'recurrence' && /Death/.test(f.fact)), undefined);
});

test('reversal still wins over returning for a reversed-heavy returning card', () => {
  const readings = [
    rdg(daysAgo(200), [card('The Empress', true)]),
    rdg(daysAgo(170), [card('The Empress', true)]),
    rdg(daysAgo(140), [card('The Empress', true)]), // gap qualifies for returning too
  ];
  const out = findCardPatterns({ readings, currentCards: [card('The Empress', true)], now: NOW });
  assert.ok(out.find(f => f.kind === 'reversal'), 'reversal fact present');
  assert.equal(out.find(f => f.kind === 'returning'), undefined, 'returning suppressed by reversal');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/card-patterns.test.js`
Expected: FAIL — the new tests find no `returning` fact (e.g. "returning fact present" assertion fails).

- [ ] **Step 3: Add the `describeGap` helper**

In `data/card-patterns.js`, add this function at module scope, right after the `ordinal` function (around line 19):

```javascript
function describeGap(ms) {
  const days = ms / DAY;
  if (days >= 330) return 'almost a year';
  if (days >= 60)  return `about ${Math.round(days / 30)} months`;
  if (days >= 21)  return `about ${Math.round(days / 7)} weeks`;
  return `about ${Math.round(days)} days`;
}
```

- [ ] **Step 4: Add the returning branch in the per-card loop**

In `data/card-patterns.js`, inside `findCardPatterns`'s `for (const c of cur)` loop, insert the returning branch BETWEEN the reversal branch (which ends with `continue;` and a closing `}`) and the recurrence branch (`if (total >= 3 || last30 >= 2 || inLastN >= 4) {`). The reversal branch currently ends like this:

```javascript
        continue;
      }
    }

    if (total >= 3 || last30 >= 2 || inLastN >= 4) {
```

Insert the new branch so it reads:

```javascript
        continue;
      }
    }

    if (total >= 3) {
      const lastPriorTs = Math.max(...hist.map(a => a.ts));
      const gapMs = now - lastPriorTs;
      if (gapMs >= RETURN_GAP_MS) {
        byCard.set(nm, {
          kind: 'returning',
          strength: 4 + (gapMs >= 180 * DAY ? 1 : 0),
          fact: `${c.name} returns, you haven't drawn it in ${describeGap(gapMs)}.`,
        });
        continue;
      }
    }

    if (total >= 3 || last30 >= 2 || inLastN >= 4) {
```

- [ ] **Step 5: Add the `RETURN_GAP_MS` constant**

In `data/card-patterns.js`, add the constant near the top with the other module constants (after `const DAY = 86400000;`, around line 3):

```javascript
const RETURN_GAP_MS = 90 * DAY;
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `node --test tests/card-patterns.test.js`
Expected: PASS — the existing card-patterns tests plus the 7 new ones.

- [ ] **Step 7: Run the full suite**

Run: `node --test`
Expected: `pass 191  fail 0` (184 + 7).

- [ ] **Step 8: Commit**

```bash
git add data/card-patterns.js tests/card-patterns.test.js
git commit -m "feat(patterns): notice a recurring card returning after a long absence

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
- Detector branch: `total >= 3` + gap `>= 90 days`, precedence reversal > returning > recurrence via placement + `continue` -> Task 1 Step 4. ✓
- Strength `4 (+1 at >= 180 days)` -> Step 4 (`4 + (gapMs >= 180 * DAY ? 1 : 0)`); tested in Step 1. ✓
- `describeGap` relative phrasing -> Step 3; tested via the fact strings ("about 4 months", "almost a year"). ✓
- Fact wording exact -> Step 4. ✓
- Surfacing unchanged (rides `patternBlock`) -> no server change in this plan. ✓
- Testing: returning fires; long-gap strength; recent->recurrence; <3->nothing; precedence over recurrence; reversal precedence preserved -> Step 1 (7 tests). ✓

**Placeholder scan:** No TBD/TODO; every code step shows complete code and exact commands with expected counts. ✓

**Type consistency:** `RETURN_GAP_MS` defined (Step 5) and used (Step 4). `describeGap(ms)` defined (Step 3) and called (Step 4). Fact object shape `{ kind, strength, fact }` matches the existing reversal/recurrence facts and the top-3 `strength` sort. The branch uses only locals already present in the loop (`nm`, `c`, `hist`, `total`, `byCard`, `now`). ✓
