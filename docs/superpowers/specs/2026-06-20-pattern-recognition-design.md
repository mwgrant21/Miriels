# Pattern Recognition Design Spec

**Date:** 2026-06-20
**Status:** Approved (design), pending implementation plan
**App:** Miriel's Readings (web/Electron tarot app at `C:\Users\Matt\projects\tarot`)
**Part of:** the Memory-Depth program (sub-project 2 of 4). Sub-project 1 (temporal callbacks) is merged.
**Builds on:** the readings store (`loadReadings`), the interpret endpoint (`/api/interpret`), and the existing soft pattern instruction in the reading prompt (`server.js:711`).

## Summary

Give Miriel *accurate, quantified* awareness of patterns in the cards in front of
her, computed deterministically — so when she says "the Tower, third time this
month," it is true. Today her pattern-noticing is pure LLM judgment over dumped
history (soft, can miss or invent). This adds a deterministic detector whose facts
feed the reading, making her perceptiveness real.

Three pattern types this sub-project: **card recurrence + recency**, **reversal
tendency**, **suit/element skew**. Question↔card correlation is deferred (it needs
question theming and risks false claims).

## Decisions (locked during brainstorming)

- **Deterministic detector**, not LLM judgment — accuracy is the point.
- **Three patterns:** recurrence+recency, reversal tendency, suit/element skew.
- **Restraint:** thresholds per pattern; only notable ones fire; cap ~3 facts per
  reading so it never overloads.
- **Surface in the reading** (the patterns concern the current draw), by feeding
  facts into the interpret prompt.
- **Correlation deferred** to a later careful pass.

## Data reality (no schema change)

Saved reading cards carry only `{ id, deckType, name, position, isReversed }`
(no suit/element). Therefore:
- **Recurrence & reversal** key on **card name** (normalized) — the querent
  experiences "the Tower" regardless of deck.
- **Suit** is **derived from the name** by parsing `… of <Wands|Cups|Swords|
  Pentacles|Disks|Coins>` (Disks/Coins normalized to Pentacles). Cards with no
  suit (majors, oracle, Lenormand, runes, I-Ching) contribute no suit signal, so
  suit-skew is meaningful only for tarot minor arcana — an accepted limitation.
- History timestamps come from each reading's `timestamp` (ms).

## Architecture

### 1. Detector — new `data/card-patterns.js` (pure logic)

```
findCardPatterns({ readings, currentCards, now }) -> Fact[]
```
- Flattens `readings` into historical card appearances `{ name, isReversed, ts }`.
- For the cards in `currentCards` (the reading just drawn) and the recent window,
  computes:

  **Recurrence + recency** (per current card, by name):
  - `total` = historical appearances; `last30` = appearances within 30 days;
    `inLastN` = how many of the last 8 readings contained it.
  - Emit when notable: `total >= 3` OR `last30 >= 2` OR `inLastN >= 4`.
  - `fact` favors the most striking true framing, e.g. *"The Tower again — that's
    3 times this past month, and the 6th time you've drawn it."* Strength scales
    with recency/frequency.

  **Reversal tendency** (per current card drawn reversed, by name):
  - Gather that name's historical appearances; if `count >= 3` and reversed share
    `>= 0.7`, emit *"the Empress, reversed once more — she almost never lands
    upright for you."*

  **Suit/element skew** (over current spread + last ~5 readings):
  - Derive suit per card from name; count suited cards. If one suit is `>= 50%`
    of suited cards AND there are `>= 4` suited cards in the window, emit *"swords
    keep crowding your spreads lately."* (tarot only.)

- Each `Fact = { kind:'recurrence'|'reversal'|'skew', strength, fact }`.
  Sort by strength; return top ~3. Returns `[]` when nothing is notable.
- **Pure** (takes `now`), unit-testable with seeded readings + currentCards.

### 2. Surfacing — `/api/interpret` (server.js)

- Compute `findCardPatterns({ readings: loadReadings(slug), currentCards: cards,
  now: Date.now() })`.
- Append the facts to the persona as a **pattern block** (mirroring how
  `memoryBlock` is appended), e.g.:
  `\n\nPatterns you accurately notice in the cards before you (state any that
  genuinely illuminate something, in your own voice — these counts are real, do
  not exaggerate them):\n- <fact>\n- <fact>`
- Keep the existing soft instruction (`server.js:711`) but it is now backed by
  hard facts; trim it if it becomes redundant. Miriel phrases the facts; we never
  output canned text to the user. Honors the anti-AI-tells persona.

## Out of Scope

- Question↔card correlation (deferred sub-project).
- The journal "pattern weaving" (`/api/patterns`) — already exists, unchanged.
- Broader memory weaving into readings (sub-project 3).
- Temporal patterns (sub-project 1, done).
- Any schema change; the detector reads existing readings data.

## How We Verify

- **Unit tests (TDD)** for `findCardPatterns` with seeded readings + currentCards
  and a fixed `now`:
  - recurrence fires at the thresholds and the fact reports the correct counts;
  - reversal tendency fires only with enough samples + high reversed share;
  - suit-skew fires on a dominant suit with enough suited cards, and does NOT fire
    for non-tarot/insufficient data;
  - the cap (≤3) and the empty case (`[]`) hold;
  - counts in the `fact` strings are accurate (no exaggeration).
- **Sample review:** run a reading whose current card has a seeded recurrence and
  confirm Miriel cites the correct count naturally; confirm an ordinary reading
  gets no forced pattern talk.
- **Regression:** `node --test tests/*.test.js` stays green; interpret behaves
  normally when the detector returns `[]`.

## Success Criteria

- When a drawn card genuinely recurs / tends reversed / a suit dominates, Miriel
  notices it with **accurate counts**, in her voice, woven into the reading.
- Ordinary readings get no manufactured pattern talk (restraint holds).
- The detector is pure and unit-tested; interpret unaffected when no patterns.
- Full suite stays green; no schema change.
