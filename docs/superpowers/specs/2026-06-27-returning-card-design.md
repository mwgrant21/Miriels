# The Returning Card — Design

**Date:** 2026-06-27
**Status:** Approved (design); pending implementation plan
**Capability area:** Memory engine — card-pattern recognition (the moat)

## Summary

Miriel notices when a card that was once a recurring presence in the querent's
spreads went quiet for a long stretch and has now reappeared, and names the
return inside the reading:

> "The Tower returns, you haven't drawn it in about four months."

This is the absence-then-return complement to the existing recurrence pattern.
Today `findCardPatterns` notes when a card recurs ("the 5th time you've drawn
it") but has no sense of a card vanishing and coming back, which is the more
striking, more memorable beat.

## Behavioral decisions (locked)

| Decision | Choice |
|---|---|
| Definition | Recurring-then-absent: the card was a genuine presence before AND has been gone a long stretch |
| "A presence before" | `total >= 3` prior appearances (reuses the existing recurrence bar) |
| Absence gap | `>= 90 days` since the card's most-recent PRIOR appearance |
| Surface | The reading body, via the existing `patternBlock` (no greeting — it is about a card just drawn) |
| Precedence | reversal > returning > recurrence (a long-absent card gets the return framing instead of the generic recurrence fact) |
| Strength | base 4, +1 when the gap is very long (`>= 180 days`) |

## Non-goals (YAGNI)

- No new module — it is one branch inside the existing `findCardPatterns`.
- No greeting surface (the greeting has no current draw to anchor a "returning card").
- No server, wiring, or schema changes — it rides the existing `patternBlock`.
- No absolute-date / calendar-season phrasing (fragile); a relative gap phrase
  (months/weeks) only.

## Architecture

A single new branch in the pure detector `data/card-patterns.js`
(`findCardPatterns`), which already computes each current card's full appearance
history. Mirrors the structure of the existing reversal/recurrence branches.

### Detector logic (`data/card-patterns.js`)

`findCardPatterns({ readings, currentCards, now })` already, per current card,
builds:
- `hist` = that card's prior appearances `{ name, reversed, ts }` (sorted ascending overall)
- `total` = `hist.length`
- `last30`, `inLastN` (existing)

Add a **returning** branch in the per-card loop, positioned AFTER the reversal
branch (which `continue`s) and BEFORE the recurrence branch:

```
const RETURN_GAP_MS = 90 * DAY;            // DAY is ms in this file (86400000)

if (total >= 3) {
  const lastPriorTs = Math.max(...hist.map(a => a.ts));   // most-recent prior appearance
  const gapMs = now - lastPriorTs;
  if (gapMs >= RETURN_GAP_MS) {
    byCard.set(nm, {
      kind: 'returning',
      strength: 4 + (gapMs >= 180 * DAY ? 1 : 0),
      fact: `${c.name} returns, you haven't drawn it in ${describeGap(gapMs)}.`,
    });
    continue;                               // precedence over recurrence
  }
}
```

- Because `gapMs >= 90 days`, the card had no appearance in the last 30 days, so
  the "not currently frequent" condition is satisfied automatically — no extra
  check needed.
- `continue` after setting the fact means the generic recurrence fact does not
  also fire for the same card (one fact per card, matching the existing
  reversal-then-recurrence structure).
- Reversal still wins: the reversal branch above already `continue`s before this
  one is reached, so a reversed-heavy card keeps its reversal fact.

### Gap phrasing helper

Add a small `describeGap(ms)` helper (ASCII, relative, no calendar math),
mirroring the spirit of `temporal-recall.js`'s `describeGap` but ms-based to
match this file's `DAY`:

```
function describeGap(ms) {
  const days = ms / DAY;
  if (days >= 330) return 'almost a year';
  if (days >= 60)  return `about ${Math.round(days / 30)} months`;
  if (days >= 21)  return `about ${Math.round(days / 7)} weeks`;
  return `about ${Math.round(days)} days`;
}
```

(For a `>= 90`-day gap this yields "about N months" or "almost a year" — never a
sub-month phrase, which is the only range that can reach this branch.)

### Surfacing (no change)

The returned `returning` fact flows through the existing top-3 sort
(`facts.sort((a,b) => b.strength - a.strength).slice(0,3)`) into the interpret
persona's `patternBlock` exactly like recurrence/reversal/skew facts. The
`patternBlock` framing already instructs Miriel to state patterns that genuinely
illuminate, in her own voice, never inflated — which fits a returning card. No
server change.

## Data flow

```
/api/interpret
  -> findCardPatterns({ readings: pre-save history, currentCards: drawn cards, now })
       -> per current card: reversal? -> RETURNING? -> recurrence?   [new branch]
       -> suit skew
       -> sort by strength, top 3
  -> patternBlock appended to persona (existing)
```

(Contract unchanged: `findCardPatterns` must receive PRE-save readings — history
WITHOUT the current draw — or counts double. The returning branch only reads
prior appearances, so it is unaffected by that contract either way, but the
existing comment stands.)

## Testing

Add to `tests/card-patterns.test.js`:
- A card with `>= 3` prior appearances whose most-recent prior appearance is
  `>= 90` days ago, drawn now -> emits a `returning` fact naming the card and a
  months/weeks gap phrase.
- A very long gap (`>= 180` days) -> strength is 5 (base 4 + 1).
- A card with `>= 3` appearances but a recent one (gap `< 90` days) -> does NOT
  return; falls through to `recurrence`.
- A card with only 1-2 prior appearances and a long gap -> emits nothing
  (neither returning nor recurrence).
- Precedence: a qualifying returning card emits `kind: 'returning'`, not
  `kind: 'recurrence'`, for that card.
- Reversal precedence preserved: a reversed card meeting the reversal bar
  (`total >= 3`, reversed-share `>= 0.7`) AND the return gap still emits
  `kind: 'reversal'` (reversal branch runs first).
- `describeGap` returns the expected phrase for representative gaps (e.g. ~120
  days -> "about 4 months"; ~350 days -> "almost a year").

**Bar:** all current tests (184) remain green; ~7 new tests.

## Risks & mitigations

- **Sparse history** -> the `total >= 3` and `>= 90`-day-gap bars mean it simply
  stays silent for light or new users, like the other detectors.
- **Double-firing with recurrence** -> the `continue` after the returning fact
  prevents the same card from also producing a recurrence fact.
- **Top-3 starvation** -> strength 4-5 ranks returning near reversal and above
  skew and most recurrence, so a genuine return is unlikely to be dropped.
- **Reversal interaction** -> reversal branch runs first and `continue`s, so a
  reversed-heavy returning card keeps the (more specific) reversal framing; this
  is an intentional, documented precedence.
