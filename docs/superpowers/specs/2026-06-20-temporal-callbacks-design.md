# Temporal Callbacks Design Spec

**Date:** 2026-06-20
**Status:** Approved (design), pending implementation plan
**App:** Miriel's Readings (web/Electron tarot app at `C:\Users\Matt\projects\tarot`)
**Part of:** the Memory-Depth program (sub-project 1 of 4: temporal callbacks → pattern recognition → richer in-reading recall → outcome/prophecy loop).
**Builds on:** the memory engine (`data/memory-store.js`, `data/memory-engine.js`), the reader readings store (`loadReadings` in `server.js`), and the Threshold reunion greeting (`/api/threshold`).

## Summary

Give Miriel time-awareness: she occasionally notices *when* — "a year ago today you
asked about your work," "it's been three months since you sat down," "around this
time last autumn the Tower kept coming," "this is your hundredth reading." These
surface only at genuinely resonant moments (most visits have none), woven into her
Threshold welcome in her own voice. This is the "she remembers when" magic.

Sub-project 1 builds the temporal detector + Threshold surfacing only. Weaving
temporal references into the body of readings is deferred to sub-project 3 (richer
in-reading recall).

## Decisions (locked during brainstorming)

- **Four signals:** anniversaries ("on this day"), elapsed-since-last-visit,
  seasonal echoes, and relationship milestones.
- **Restraint:** fire only on genuinely resonant matches; most visits surface
  nothing. At most one callback (occasionally two) per visit, and a surfaced
  callback is marked used so it doesn't repeat within its window.
- **Surface:** the Threshold welcome (not yet the reading body).

## Data available (no schema change needed for detection)

- **Readings** (`data/readings/<slug>.json`): array of `{ date (human string),
  timestamp (ms epoch), deck, deckLabel, spread, question, cards, synopsis, id }`.
  `timestamp` is the reliable temporal key.
- **Memory atoms** carry `created_at` (seconds).
- **`last_visit:<slug>`** meta (seconds) already maintained by `/api/threshold`.
- **Reading count** = `loadReadings(slug).length`; **first-meeting** =
  earliest reading `timestamp`.

The only new persistence is a dedup meta key (see below).

## Architecture

### 1. Temporal detector — new `data/temporal-recall.js` (pure logic)

A single pure function, no I/O, fully unit-testable:

```
findTemporalCallbacks({ readings, lastVisitTs, readingCount, now }) -> Candidate[]
```

- `readings`: the reader's readings (each with `timestamp`, `question`, `cards`,
  `date`).
- `now`: ms epoch (injected so tests are deterministic).
- Returns scored `Candidate` objects, each:
  `{ kind: 'anniversary'|'elapsed'|'seasonal'|'milestone', strength: number,
     signature: string, fact: string, ref?: {date, question, cards} }`
  - `signature` — a stable key for dedup (e.g. `anniversary:1y:<readingId>`,
    `elapsed:90d`, `milestone:100`).
  - `fact` — a plain-language description Miriel can build on (NOT final prose),
    e.g. "One year ago today they asked: 'should I leave the job?' (The Tower,
    Three of Swords)."

**Detection rules (each yields a candidate only above its resonance bar):**
- **Anniversary:** a past reading whose `timestamp` is within ±3 days of
  `now − {1 month, 1 year}` (1y scores higher than 1m). Carries that reading's
  question/cards.
- **Elapsed:** `gapDays = (now − lastVisitTs)/day`. Resonant when notably long
  (≥ ~21 days; longer = higher strength). Very short gaps are not surfaced here
  (handled by existing greeting tone), except an optional streak case is out of
  scope for v1 to keep it simple.
- **Seasonal:** a reading from the same calendar month in a *prior* year that is
  NOT already caught as a 1-year anniversary (broader echo). Lower strength.
- **Milestone:** months since first meeting at round values (6, 12, 24…); and
  round reading-count milestones (50, 100, 150…). `readingCount` is the count
  *including* the visit about to happen — pin the exact rule in the plan.

**Resonance + cap:** sort by `strength`; return the single strongest by default
(allow the caller to take top N). Return `[]` when nothing clears the bar — the
common case.

### 2. Dedup — `temporal-surfaced` meta

Before surfacing, the caller filters out candidates whose `signature` was surfaced
recently, using a memory meta entry (e.g. `temporal_surfaced:<slug>` → JSON map of
`signature → timestamp`, pruned by age). On surfacing, record the signature. This
prevents repeating the same anniversary across its ±3-day window or re-announcing a
milestone. Uses the existing `getMeta`/`setMeta` store API — no schema change.

### 3. Surfacing — the Threshold welcome (`/api/threshold` + `memory-engine.js`)

- In `/api/threshold`, after loading threads/predictions, call the detector with
  the reader's readings + `last_visit` + count + `now`, filter via dedup, and select
  the top callback(s).
- Extend `decideThresholdMode(lastVisitTs, threads, now, gapDays, predictions,
  temporalCallbacks = [])` so the Threshold fires when a strong temporal callback
  exists even if there are no open threads/predictions (a pure "on this day"
  reunion). Backward-compatible default keeps existing callers working.
- Extend `buildGreetingPrompt(mode, threads, gapDays, predictions,
  temporalCallbacks = [])` to include the selected callback's `fact` so Miriel
  weaves it into her welcome in her own voice (she phrases it; we never hand her
  canned text). Honor the anti-AI-tells persona already in place.
- On successful greeting, mark the surfaced signatures used (alongside the existing
  `markAsked` for threads).

## Out of Scope

- Weaving temporal references into the reading body (sub-project 3).
- Pattern detection across readings (sub-project 2).
- New SQL tables/columns (only a meta key is added).
- Streak detection ("every day this week") — deferred to keep v1 focused.

## How We Verify

- **Unit tests (TDD)** for `findTemporalCallbacks` with seeded readings and a fixed
  `now`: each signal fires correctly (anniversary at 1y/1m within window, elapsed at
  ≥ threshold, seasonal same-month-prior-year, milestone at round count/age); the
  resonance bar returns `[]` when nothing qualifies; the cap returns the strongest;
  `signature`s are stable.
- **Dedup unit test:** a signature in the surfaced map is filtered out.
- **Sample review:** seed a reader with an "anniversary" reading dated ~1 year ago
  and confirm the Threshold greeting weaves it naturally; confirm a normal visit
  with no matches produces no temporal mention.
- **Regression:** existing `node --test tests/*.test.js` stays green; existing
  Threshold behavior (threads/predictions) unaffected when `temporalCallbacks` is
  empty.

## Success Criteria

- On a visit with a genuine temporal match, Miriel's welcome references it naturally
  and specifically (right date/question/card), in her voice.
- On an ordinary visit, there is no temporal mention (restraint holds).
- The same anniversary/milestone is not surfaced twice within its window.
- The detector is pure and covered by unit tests; threshold/greeting changes are
  backward-compatible; full suite stays green.
