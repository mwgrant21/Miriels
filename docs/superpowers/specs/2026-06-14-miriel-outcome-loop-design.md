# Miriel Outcome Loop — Design Spec

**Date:** 2026-06-14
**Status:** Approved (design), pending implementation plan
**Builds on:** Memory Engine (phase 1), Threshold reunion (phase 2), In-reading curiosity (phase 3)

## Summary

Make Miriel **accountable to her own foretelling**. She records the specific,
checkable predictions she makes in readings, and — once a prediction has had time
to ripen — asks at the Threshold whether it came to pass. From the querent's
answer she writes a short outcome note **in her own voice** ("The time with Maggie
has ended."), resolves the prediction with a verdict, and feeds that note back into
recall so future readings go deeper. The track record is a *collection of voiced
outcome-notes*, never a scoreboard.

This is the keystone that makes the existing memory investment pay off
emotionally: a reader who remembers what she said would happen, and checks.

## Why this matters

No tarot app tracks its own predictions. The Threshold (phase 2) already asks
"what came of [open life thread]?" — but nothing captures **what Miriel foretold**,
surfaces it later, or records the verdict. This spec closes that gap and only that
gap. Scope is predictions specifically, not broad reading revisitation.

## Architecture

Four stages, all riding existing infrastructure. No schema migration.

```
capture (reading time) → ripen (age gate) → ask (Threshold) → record (voiced) → feed back (recall)
```

The `prediction` type, the `RESOLVE` op (resolve + linked outcome `event` +
`resolves` link), the `asked_at` column, and the Threshold reunion flow all
already exist. This spec extends them; it does not add tables or columns.

---

### Stage 1 — Capture (reading time)

**Where:** `data/memory-engine.js` → `buildCapturePrompt` (used by
`captureFromReading`, the existing single Haiku call after each reading).

Extend the capture directive so that when Miriel's synopsis contains a
**specific, checkable foretelling** — "expect friction in that move", "this
connection won't last the season" — it is recorded as:

- `type: prediction`
- `status: open`
- `salience >= 3`
- `content`: the claim itself, phrased as the prediction (so it reads back
  cleanly when she asks about it). Any implied timeframe is folded into the
  content text — it gives her voice something to reference, it does **not** drive
  the ripeness gate.

**Conservative bar:** vague encouragement ("good things are coming") is NOT a
prediction. Only a specific claim with a discernible yes/no future answer.
No extra LLM call — this folds into the existing capture pass (Approach A).

---

### Stage 2 — Ripeness (eligibility gate)

A foretelling needs time to possibly come true. A prediction is **ripe** when:

1. `type = 'prediction'` AND `status = 'open'` (not already resolved), AND
2. it has aged past a **per-prediction maturation threshold**, measured from
   `COALESCE(asked_at, created_at)`.

**Maturation threshold (stable jitter):** `14 + (id % 7) - 3` days since
`COALESCE(asked_at, created_at)`, i.e. an **11–17 day** window unique to each
prediction. Derived from the row `id` so it is **deterministic** — a prediction
never flickers in and out of ripe between checks. The jitter exists so Miriel
doesn't ask on a robotic exactly-14-day cadence.

**Why `COALESCE(asked_at, created_at)` rather than `asked_at IS NULL`:** a
never-asked prediction ripens a window after it was *created*; a prediction
deferred as `too_soon` (Stage 3) has its `asked_at` re-stamped, so it ripens
again a fresh window after it was last *asked*. This is the mechanism that lets a
`too_soon` prediction resurface later instead of being excluded forever.

**New store method:** `getRipePredictions(slug, limit)` in `data/memory-store.js`,
parallel to `getOpenUnaskedThreads`. SQL selects open, unasked predictions whose
age in days `>= 14 + (id % 7) - 3`. Exposed through the engine the same way
`getOpenUnaskedThreads` is.

---

### Stage 3 — The Threshold follow-up (ask & verdict)

Ripe predictions ride into the **existing Threshold reunion** alongside open
threads — one unified "looking back" moment, no second interruption.

**`GET /api/threshold` (server.js ~910):**
- Gather ripe predictions (`getRipePredictions`) in addition to open threads.
- Build a combined item set. Each item carries its `type` so the greeting and the
  later capture can tell predictions from threads.
- The greeting prompt (`buildGreetingPrompt`) gains prediction-aware framing so
  Miriel can say *"the cards and I spoke of friction in that move — did it come as
  we saw it?"* rather than the neutral thread phrasing. Threads keep their current
  "what came of that?" phrasing.
- `markAsked` stamps both shown threads and shown predictions (prevents
  double-asking). Existing failure-handling (don't advance `last_visit` on
  generation failure) is preserved unchanged.
- The response returns the shown ids; the frontend echoes them back on answer.
  Predictions and threads can share the existing `threadIds` channel since each
  memory row carries its own `type` — capture branches on the looked-up type.

**`POST /api/threshold/answer` (server.js ~950):**
- Reply generation (`buildReplyPrompt`) unchanged in shape; it already reflects
  the answer back warmly.
- Capture (`captureAnswer` / `buildThresholdCapturePrompt`) is extended so that,
  for each **prediction** the person reports on, the LLM emits a `RESOLVE` op
  carrying:
  - a **verdict**: one of `came_to_pass` | `did_not` | `partly` | `too_soon`
  - an **`outcome`** written **in Miriel's voice** — a single short line
    ("The time with Maggie has ended.")

**Verdict handling in `applyOps` RESOLVE (data/memory-store.js):**
- `came_to_pass` / `did_not` / `partly`: resolve the prediction (`status =
  resolved`), create the linked outcome `event` atom (existing behaviour), and
  store the verdict as a `subject` tag on that outcome event:
  `verdict:came_to_pass` (no schema change — `subject` already exists).
- `too_soon`: do **NOT** resolve. Re-stamp `asked_at = now` so the prediction
  leaves the ripe set for another maturation window, then may surface again later.

Threads continue to RESOLVE/UPDATE exactly as today.

---

### Stage 4 — The voiced record (feed-back + visible)

**Feeds future readings (already wired):** voiced outcome `event` atoms flow
through `recall()` into the reading prompt, so "The time with Maggie has ended"
becomes context Miriel can draw on. A prediction that **came to pass** lends
quiet confidence to her voice when a related card resurfaces — purely through what
recall surfaces, no explicit scoreboard logic.

**Visible if you go looking — "Foretellings" in the notebook overlay:**
- New read-only endpoint **`GET /api/foretellings/:slug`** returning resolved
  predictions joined to their linked outcome `event` (via the `resolves` link),
  each with: the original foretelling text, the voiced outcome line, the verdict
  (parsed from the outcome event's `verdict:*` subject), and the date.
- A new **Foretellings** section in the existing notebook overlay (frontend) lists
  these as voiced lines with a quiet verdict marker (came to pass / didn't /
  partly). Read-only. No synthesis pass, no new storage.

## Components touched

| Component | Change |
|---|---|
| `data/memory-engine.js` | Capture prompt: extract predictions. Threshold capture prompt + reply/greeting prompts: prediction-aware framing + verdict/outcome ops. Expose `getRipePredictions`. |
| `data/memory-store.js` | New `getRipePredictions(slug, limit)`. `applyOps` RESOLVE: verdict subject tag; `too_soon` re-stamps `asked_at` instead of resolving. New join query for foretellings. |
| `server.js` | `/api/threshold`: gather + show ripe predictions. `/api/threshold/answer`: unchanged shape, capture handles predictions. New `GET /api/foretellings/:slug`. |
| `public/` (frontend) | "Foretellings" section in the notebook overlay; echo prediction ids on threshold answer (reuses thread id channel). |

## Data flow

1. Reading completes → `captureFromReading` → prediction atom stored (`open`).
2. 11–17 days pass → prediction becomes ripe.
3. Querent returns after a gap → `/api/threshold` gathers ripe predictions + open
   threads → Miriel asks about them in the reunion greeting → `markAsked`.
4. Querent answers → `/api/threshold/answer` → reply shown → `captureAnswer`
   emits RESOLVE (verdict + voiced outcome) or, if `too_soon`, defers.
5. Outcome `event` atom now flows through `recall()` into future readings, and
   appears under "Foretellings" in the notebook.

## Error handling

- Capture is conservative and best-effort; a missed prediction simply never gets
  asked about (no crash). Existing capture error handling is unchanged.
- Threshold greeting/reply failures keep their current behaviour (don't advance
  `last_visit`; warm fallback reply).
- `too_soon` is the safety valve for predictions asked too early — they defer
  rather than being forced to a verdict.
- `/api/foretellings/:slug` returns `[]` on any error (read-only, non-critical).

## Testing

Follow the existing TDD pattern (the memory engine has 87 passing tests).

- **Ripeness:** `getRipePredictions` includes a prediction at age 17, excludes at
  age 10; respects per-id jitter determinism (same prediction, same threshold
  across calls); excludes resolved and already-asked predictions.
- **Verdict ops:** RESOLVE with `came_to_pass`/`did_not`/`partly` resolves +
  creates linked outcome event tagged `verdict:*`; `too_soon` does not resolve and
  re-stamps `asked_at`.
- **Capture:** prediction extraction from a synopsis containing a specific
  foretelling; no prediction from vague encouragement.
- **Threshold integration:** ripe predictions appear in the gathered set and get
  `markAsked`; threads still behave as before.
- **Foretellings endpoint:** returns resolved predictions joined to outcome +
  verdict; `[]` when none.

## Out of scope (YAGNI)

- Per-prediction parsed time horizons driving the gate (fixed jittered window
  instead).
- A numeric accuracy stat / batting average (felt + voiced record only).
- Dedicated prediction-capture LLM call (folded into existing capture).
- Predictions surfaced anywhere other than the Threshold (no new-reading or
  dedicated-ritual entry points).

## Sequencing note

This is sub-project 1 of the broader roadmap (outcome loop → reading-history
utility → divination depth → sensory polish). Each is its own spec/plan/build.
