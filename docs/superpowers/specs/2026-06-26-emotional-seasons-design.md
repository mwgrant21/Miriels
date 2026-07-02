# Querent Emotional Seasons — Design

**Date:** 2026-06-26
**Status:** Approved (design); pending implementation plan
**Capability area:** Memory engine (the moat)

## Summary

Miriel senses the querent's emotional arc over time and speaks to it. She reads
their accumulated `feeling` atoms not one-by-one (as today's keyword recall does)
but in aggregate, as a *timeline of emotional seasons*, and reflects three facets
of it:

- **Drift** — the emotional weather shifting across time ("there was a lighter
  season before the heavy one we sat through").
- **Now-vs-then** — the current tone contrasted against a notable past window
  ("you came to me last winter heavy with grief; today there is something
  steadier").
- **Recurring theme** — an emotional thread that persists across seasons ("a
  restlessness keeps returning to you").

All three are lenses on ONE underlying representation (the season timeline), so
this is a single coherent feature, not three.

## Behavioral decisions (locked)

| Decision | Choice |
|---|---|
| Observation | Drift + now-vs-then + recurring theme (all three) |
| Surfaces | Greeting (drift + now-vs-then) AND reading body (recurring theme) |
| Computation | Async Haiku pass writes precomputed season records (Approach A); no LLM on the live greeting/interpret path |
| Storage | JSON array in `memory_meta` under `seasons:<slug>` |
| Compute cadence | every ~8 readings AND only if >= 4 new `feeling` atoms exist since the last season's `ended_at` |
| Min to surface | drift/now-vs-then need >= 2 seasons; recurring theme needs a theme in >= 2 seasons |
| Build order | 2 slices — Slice 1: season core + greeting; Slice 2: reading-body theme |

## Non-goals (YAGNI)

- No new SQLite table (season volume is tiny, read whole; meta JSON suffices).
- No structured valence tagging of individual feeling atoms (that was Approach B,
  rejected — only works forward, coarse, touches the capture path).
- No LLM call added to the greeting or interpret critical path.
- No new UI surface (no "seasons" screen); seasons ride the existing greeting and
  interpretation.
- No backfill of season records on every boot — one-time, flag-guarded.

## Architecture

Mirrors two established patterns:
1. The async, best-effort, fire-and-forget Haiku pass after a reading save
   (`profiles.updateLivingNote`, `data/reader-profile.js:151`) — the season
   characterization copies this shape exactly (never throws into the save path).
2. The pure, LLM-free detector feeding a prompt block
   (`data/temporal-recall.js`, `data/card-patterns.js`, `data/prophecy-recall.js`)
   — the two surfacing functions copy this shape (pure, unit-testable, emit
   text only).

### The season record (§1, shared core)

```
{
  index:      <int>,        // 0-based position in the timeline
  started_at: <unix sec>,   // window start (earliest feeling in the window)
  ended_at:   <unix sec>,   // window end (latest feeling in the window)
  label:      <string>,     // short evocative name, e.g. "the heavy winter"
  valence:    <int -2..+2>, // overall emotional weather (-2 heavy .. +2 light)
  themes:     <string[]>,   // 1-4 short theme words, e.g. ["fear","the move"]
  summary:    <string>      // 1-2 sentences, Miriel's private characterization
}
```

Stored append-only as a JSON array under `memory_meta` key `seasons:<slug>` via
the existing `store.getMeta`/`store.setMeta`. The array IS the timeline, ordered
oldest-first.

### §2 Computing seasons — `data/emotional-seasons.js` (new module)

A focused module (factory `createEmotionalSeasons(store)` returning the functions
below) so it stays independently testable and does not bloat `memory-engine.js`
or `reader-profile.js`.

- `listFeelings(slug)` — helper: `store.listMemories(slug)` filtered to
  `type === 'feeling'`, mapped to `{ content, salience, created_at }`, sorted
  ascending by `created_at`. (`created_at` is unix seconds, per the store schema.)

- `async updateSeasons(slug, callLLM)` — cadence-gated season characterization:
  - Read the season timeline (`seasons:<slug>` meta, default `[]`).
  - Determine the window start = last season's `ended_at` (or 0 if none).
  - Gather `feeling` atoms with `created_at > windowStart`. If fewer than
    `MIN_FEELINGS_PER_SEASON` (= 4), return (not enough material yet).
  - Haiku pass (`SEASON_SYSTEM`, `claude-haiku-4-5-20251001`): given the window's
    feelings, return ONE season record's `label`/`valence`/`themes`/`summary` as
    tolerant JSON (parse defensively, same posture as `parseExtractorOutput`).
  - Append `{ index, started_at, ended_at, ...parsed }` to the timeline; persist.
  - Best-effort: any throw/parse failure returns without writing. Never throws
    into the caller.
  - Cadence gate lives at the CALL SITE (server), not here: called only when
    `totalReadings % SEASON_CADENCE (= 8) === 0`, paralleling the profile-refresh
    cadence check at `server.js:282`.

- `async backfillSeasons(slug, callLLM)` — one-time, idempotent:
  - If meta flag `seasons_backfilled:<slug>` is set, return `{ skipped: true }`.
  - Bucket all historical `feeling` atoms into ~monthly windows
    (`SEASON_WINDOW_DAYS` = 30) by `created_at`.
  - For each window with >= `MIN_FEELINGS_PER_SEASON` feelings, run the same
    Haiku characterization; append each resulting record in chronological order.
  - Set the flag (only after the loop completes, so a mid-run failure retries
    from scratch — same contract as `memory-engine.js` `backfill()`).

### §3 Surface 1 — Greeting (drift + now-vs-then)

`detectSeasonShift(seasons, now)` — PURE (no LLM), in `data/emotional-seasons.js`,
exported statically like `findTemporalCallbacks`:
- Requires >= 2 seasons; else return `null`.
- Compares the latest season to the most contrasting earlier season (largest
  `valence` delta; tie-broken by recency of the earlier one).
- If `abs(latest.valence - earlier.valence) >= SHIFT_THRESHOLD` (= 2), emit:
  ```
  { kind: 'season-shift', signature: `season-shift:${earlier.index}->${latest.index}`,
    fact: "<plain statement of the then-season and the now-season, naming both
           labels/valences and their themes, for Miriel to voice>" }
  ```
- Else return `null` (no manufactured drift).

Wired into the Threshold greeting alongside the existing material: server gathers
it, passes it through `decideThresholdMode` (so a strong shift can help drive a
reunion) and `buildGreetingPrompt` as a new trailing optional `seasonShift = null`
parameter, with its own framing block instructing Miriel to reflect the arc
warmly and specifically, not clinically. Dedup via `season_surfaced:<slug>` meta
(store the surfaced `signature` with a timestamp; suppress within
`SEASON_SURFACE_TTL_DAYS` = 30), mirroring `temporal_surfaced`.

### §4 Surface 2 — Reading body (recurring theme)

`detectRecurringTheme(seasons)` — PURE, in `data/emotional-seasons.js`:
- Requires >= 2 seasons; tally `themes` across all season records
  (case-insensitive, trimmed).
- If a theme appears in >= `THEME_MIN_SEASONS` (= 2) distinct seasons, emit the
  most-recurring one (tie-broken by total occurrences then recency) as:
  ```
  { theme: "<word>", seasons: <count>,
    fact: "<statement that this emotional thread keeps returning across their
           record, for the interpret LLM to weave only if a card connects>" }
  ```
- Else return `null`.

Wired into `/api/interpret`: gather it, build a framed `seasonThemeBlock`
(reference only when a drawn card genuinely meets the theme; name it; never a
list; never inflate) appended to `personaFinal` after the existing
prophecy/pattern blocks. Consume-only — no LLM call added (rides the existing
interpret call).

### §5 Voice / constraints

- All model-facing prose is ASCII-only, second-person ("you"), no em dashes
  (per the established Miriel rules; `READER_PERSONA` bans the `—` character).
- The async Haiku characterization is the ONLY new LLM usage, and it is
  fire-and-forget off the reading-save path. Greeting and interpret add only
  precomputed text to prompts they already build.

## Data flow

```
reading saved (POST /api/readings)
  -> [cadence: totalReadings % 8 == 0] updateSeasons(slug, callLLM)   [§2, async, best-effort]
       -> Haiku characterizes new feeling window -> append season record to seasons:<slug>

app open (GET /api/threshold)
  -> detectSeasonShift(seasons, now)            [§3 pure]
  -> filter via season_surfaced:<slug> TTL
  -> decideThresholdMode(..., seasonShift) / buildGreetingPrompt(..., seasonShift)
  -> on send, record signature in season_surfaced:<slug>

interpret (POST /api/interpret)
  -> detectRecurringTheme(seasons)              [§4 pure]
  -> append seasonThemeBlock to personaFinal

one-time (deferred after migrate, like memory backfill)
  -> backfillSeasons(slug, callLLM)             [§2, flag-guarded]
```

## Testing

**`tests/emotional-seasons.test.js`** (new):
- `detectSeasonShift`: returns null with <2 seasons; null when valence delta below
  threshold; emits a shift with the correct signature when delta >= 2; picks the
  most-contrasting earlier season.
- `detectRecurringTheme`: null with <2 seasons; null when no theme repeats; emits
  the theme present in >= 2 seasons; tie-break by occurrences then recency.
- `listFeelings`: filters to feeling atoms, sorts ascending by created_at.
- `updateSeasons`: with a fake `callLLM`, appends one record when >= 4 new
  feelings exist since the last `ended_at`; returns without writing when fewer; a
  callLLM throw leaves the timeline unchanged (best-effort).
- `backfillSeasons`: buckets historical feelings into windows, is idempotent (flag
  set; second run skips), retries from scratch if the flag was never set.

**Greeting/interpret wiring** (Slices 1 and 2): the existing engine tests gain
cases that `buildGreetingPrompt` emits the season-shift block when given a
`seasonShift`, and that the interpret theme block renders; the HTTP wiring is
verified by a manual smoke script (deleted after), per the project's pattern for
untested handlers.

**Bar:** all current tests (163) remain green; ~10-12 new tests across the two
slices.

## Build slices

- **Slice 1 (this plan's primary):** §1 record shape, §2 `emotional-seasons.js`
  (`listFeelings`, `updateSeasons`, `backfillSeasons`), §3 `detectSeasonShift` +
  greeting wiring + dedup. End-to-end: seasons compute and a drift/now-vs-then
  reflection can open the greeting.
- **Slice 2 (follow-on plan):** §4 `detectRecurringTheme` + interpret wiring.
  Pure addition; depends only on the season timeline from Slice 1.

## Risks & mitigations

- **Sparse feeling data** → thresholds (>= 4 feelings/window, >= 2 seasons) mean
  the feature simply stays silent for light users, like prophecy does without
  predictions.
- **Haiku mischaracterization / bad JSON** → defensive parse; best-effort write;
  a wrong season is low-stakes (private characterization, surfaced only on a
  strong delta) and ages out of relevance as the timeline grows.
- **Repetition** → `season_surfaced` TTL dedup (§3).
- **Critical-path latency** → none added; characterization is async, surfacing is
  pure.
- **Existing call signatures** → `seasonShift` added as a trailing optional
  parameter (default `null`) on `decideThresholdMode`/`buildGreetingPrompt`, as
  dormant threads were, so existing callers/tests are unaffected.
