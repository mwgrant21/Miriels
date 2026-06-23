# Prophecy Weaving Design Spec

**Date:** 2026-06-21
**Status:** Approved (design), pending implementation plan
**App:** Miriel's Readings (web/Electron tarot app at `C:\Users\Matt\projects\tarot`)
**Part of:** the Memory-Depth program (sub-project 4 of 4). Sub-projects 1 (temporal
callbacks), 2 (pattern recognition), and 3 (richer in-reading recall) are merged.
**Builds on:** the shipped Outcome Loop (`2026-06-14-miriel-outcome-loop-design.md`),
which already captures predictions, ripens them, asks at the Threshold, records a
voiced verdict, and feeds outcome notes back into recall + a notebook "Foretellings"
section.

## Summary

Make Miriel reference her own past foretellings **inside a new reading** when a card
or theme genuinely connects: *"I foresaw friction in that move, and it came; now the
Three of Swords returns…"* She speaks with earned, quiet confidence on threads she
read true, and with honesty on those she did not.

Today her prediction outcomes surface only at the Threshold and *implicitly* through
recall (she sees the outcome note "The time with Maggie has ended" but is never told
"you predicted this, and here is how it turned out"). This sub-project closes that gap
by surfacing her resolved and still-open predictions, paired with their verdicts, into
the interpret prompt so she can weave her own foresight into the reading body.

## Problem (accurately, from the current code)

- `getResolvedPredictions(slug, limit)` already returns `{prediction_id, foretelling,
  outcome, verdict, resolved_at}` (verdict parsed from the `verdict:*` subject tag on
  the linked outcome event). It powers the read-only `GET /api/foretellings/:slug`
  notebook section only.
- Resolved outcome `event` atoms do flow through `recall()` into `/api/interpret`, but
  recall surfaces the **outcome note alone**, decoupled from the original foretelling
  and its verdict. Nothing tells Miriel the note was *her own prediction* or licenses
  her to claim the foresight.
- There is no store method to fetch a reader's **open** (in-motion) predictions
  irrespective of ripeness; `getRipePredictions` is ripeness/asked-gated for the
  Threshold and is the wrong tool here.

Consequence: Miriel never says "I told you this would happen" inside a reading, so the
emotional payoff of the memory investment (a reader accountable to her own foresight)
is muted during the moment that matters most: the reading itself.

## Decisions (locked during brainstorming)

- **Deterministic detector + LLM selection (dossier-first).** A pure module builds a
  small recency/overlap-ranked candidate set; the interpret LLM (already reading the
  spread) decides what genuinely connects. No dedicated relevance LLM call, no fragile
  deterministic semantic match. Consistent with sub-project 3.
- **Consume only.** This sub-project does not add prediction capture or resolution
  logic; it reads what the shipped Outcome Loop produces.
- **Felt, not scored.** No numeric accuracy stat / batting average (carried over from
  the Outcome Loop's explicit decision). Confidence comes from naming concrete hits.
- **Honesty preserved.** Misses (`did_not`) remain available so she is not selectively
  self-flattering, but hits rank first.
- No schema change, no new table/column, no extra LLM call on the interpret path.

## Architecture

One new pure module plus thin wiring, mirroring `data/card-patterns.js` and
`data/temporal-recall.js`.

### 1. `data/prophecy-recall.js` (new, pure, unit-tested)

```
findProphecyCallbacks({ resolved, open, currentCards, question }) -> Item[]  (<= 3)
```

**Inputs**
- `resolved`: array from `getResolvedPredictions` — `{prediction_id, foretelling,
  outcome, verdict, resolved_at}`.
- `open`: array from the new `getOpenPredictions` — memory rows `{id, content,
  created_at, salience}`.
- `currentCards`: the cards just drawn (`[{name, ...}]`).
- `question`: the querent's question string (may be empty).

Recency tiebreaks compare the stored `resolved_at` / `created_at` values directly
(larger = more recent), so no `now` argument is needed and the seconds-vs-ms boundary
never arises.

**Selection**
- Build a lowercased, stopword-filtered token set from `question` + card `name`s.
- **Resolved:** order by `verdictWeight` then recency (`resolved_at` desc), with a
  light overlap boost. `verdictWeight`: `came_to_pass` 3, `partly` 2, `did_not` 1.
  This leads with hits; a miss only surfaces when hits are scarce.
- **Open:** order by recency (`created_at` desc) with the same overlap boost — for
  continuity ("I foresaw this; here it is again, still unresolved").
- Interleave resolved-first, then open, and cap the combined result at **3**.
- Selection is dossier-led (a reasonable candidate set), NOT precise matching. The
  interpret LLM performs final semantic selection.

**Output** — each `Item`:
```js
{
  kind: 'fulfilled' | 'partial' | 'missed' | 'open',   // from verdict (open => 'open')
  verdict: 'came_to_pass' | 'partly' | 'did_not' | null,
  foretelling: string,        // the original prediction text
  outcome: string | null,     // voiced outcome line (resolved only)
  fact: string,               // the line the interpret LLM reads (see formatting)
}
```

**Fact formatting** (exact strings pinned in the plan; no em dashes, per the
accuracy-fixes policy):
- fulfilled: `You foretold: "<foretelling>". It came to pass: "<outcome>".`
- partial: `You foretold: "<foretelling>". It came partly true: "<outcome>".`
- missed:  `You foretold: "<foretelling>". It did not come to pass: "<outcome>".`
- open:    `You foretold: "<foretelling>". This is still unfolding, not yet resolved.`

`kind: 'missed'` and `'open'` items carry honest framing; the block-level instruction
(below) governs tone.

### 2. `data/memory-store.js` + `data/memory-engine.js`

New store method `getOpenPredictions(slug, limit = 12)`:
```sql
SELECT id, content, created_at, salience
FROM memories
WHERE slug = ? AND type = 'prediction' AND status = 'open'
ORDER BY created_at DESC
LIMIT ?
```
Exposed through the engine the same way `getResolvedPredictions` is:
`getOpenPredictions: (slug, limit) => store.getOpenPredictions(slug, limit)`.

### 3. `server.js` `/api/interpret`

After the existing `patternBlock` is built and before `personaFinal` is assembled:
- Gather `resolved = memory.getResolvedPredictions(slug, 12)` and
  `open = memory.getOpenPredictions(slug, 12)` inside a try/catch (warn + continue on
  failure, exactly like `patternBlock`).
- `const prophecy = findProphecyCallbacks({ resolved, open, currentCards: cards,
  question })`.
- If `prophecy.length`, build `prophecyBlock`:
  ```
  \n\nForetellings you have made for this person and how they have stood (reference one
  only when a card or theme in front of you genuinely connects to it; name the specific
  foretelling and how it turned out; speak with quiet, earned confidence when one came
  to pass, and with honesty when one did not; never recite these as a list, and never
  inflate your record):
  - <fact>
  - <fact>
  ```
- `personaFinal = personaWithName + memoryBlock + patternBlock + prophecyBlock +
  overclaimGuard`.
- Update `overclaimGuard` wording so it acknowledges the prophecy block as licensed
  content: she may reference the foretellings surfaced there (in addition to recurring
  cards, named patterns, and surfaced memories), still never inventing a record.

No frontend change. No change to capture, ripeness, Threshold, or the notebook
Foretellings section.

## Components touched

| Component | Change |
|---|---|
| `data/prophecy-recall.js` | New pure module: `findProphecyCallbacks`. |
| `data/memory-store.js` | New `getOpenPredictions(slug, limit)` + prepared statement. |
| `data/memory-engine.js` | Expose `getOpenPredictions` through the engine. |
| `server.js` | `/api/interpret`: gather predictions, run detector, append `prophecyBlock`; widen `overclaimGuard`. |
| `tests/prophecy-recall.test.js` | New unit tests for the detector. |
| `tests/` (store/engine) | Test for `getOpenPredictions`. |

## Data flow

1. (Already shipped) A reading produces a `prediction` atom; the Outcome Loop later
   resolves it with a verdict + voiced outcome, or it stays open.
2. A new reading begins → `/api/interpret` gathers resolved + open predictions.
3. `findProphecyCallbacks` ranks and caps them into a <=3 dossier.
4. The `prophecyBlock` is appended to the persona; the interpret LLM weaves in any
   that genuinely connect to the current cards/question, naming the foretelling and
   its outcome, and stays silent otherwise.

## Error handling

- Gather + detect wrapped in try/catch; any failure logs a warning and omits the
  block (reading proceeds normally), matching `patternBlock`.
- Empty inputs → detector returns `[]` → no block.
- Pure module has no I/O; cannot throw on DB.

## Testing

Follow the existing TDD pattern (`node --test tests/*.test.js`).

- **Detector:**
  - a `came_to_pass` resolved prediction surfaces as `fulfilled` with its outcome in
    the `fact`;
  - an open prediction surfaces as `open` ("still unfolding");
  - verdict-weight ordering: with a hit and a miss, the hit ranks first;
  - question/card overlap boosts a matching prediction above a non-matching one;
  - the combined result is capped at 3;
  - empty `resolved` and `open` → `[]`;
  - `fact` strings contain the foretelling text (and outcome where applicable) and
    contain no em dashes.
- **Store:** `getOpenPredictions` returns only `open` `prediction` rows, in
  `created_at DESC` order, respecting `limit`; excludes resolved predictions and other
  types.
- **Regression:** full suite stays green; `/api/interpret` behaves normally when no
  predictions exist (no block appended).

## Success Criteria

- A reader with a resolved `came_to_pass` prediction draws a thematically related card
  and Miriel references the fulfilled foretelling with earned confidence, naming it.
- With nothing connecting, she does not mention predictions at all (conservative).
- Hits lead; misses are surfaced honestly, never hidden or inflated.
- No numeric scoreboard; no extra LLM call; no schema change; full suite green.

## Out of Scope (YAGNI)

- Numeric accuracy stat / batting average.
- A dedicated relevance LLM pre-pass.
- New prediction capture / resolution / ripeness logic (consumed from the Outcome Loop).
- New visible UI surface (the notebook Foretellings section already exists).
- Surfacing predictions in the Threshold (already done by the Outcome Loop) or in the
  clarifier / session-summary endpoints.
