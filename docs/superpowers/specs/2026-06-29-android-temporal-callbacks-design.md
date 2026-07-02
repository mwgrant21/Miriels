# Android Temporal Callbacks + Overclaim Guard (Slice E) — Design

**Date:** 2026-06-29
**Target:** TarotApp (Android, Kotlin)
**Status:** Approved

## Goal

Surface one dated past-reading moment into the **Threshold greeting** ("Exactly one
year ago you asked...", "Around this time 2 years ago...", reading-count milestones,
long-gap echoes), with `temporal_surfaced` dedup. Plus fold in the small interpret
`overclaimGuard` clause. Faithful port of `data/temporal-recall.js` + its threshold
wiring in `server.js`. Mirror web.

This is the first of three remaining memory-engine parity slices (E temporal, F
curiosity, G profile notebook).

## Background

The Threshold greeting on Android (Slice A + B) already gathers open threads, ripe
predictions, dormant threads, and a season shift, and decides reunion/gentle/none.
Web additionally surfaces a single temporal callback (a dated PAST reading, distinct
from "when they last visited") and weaves it into the greeting. Temporal callbacks
are computed from the readings JSON (not the SQLite atom store), deduped via a
`temporal_surfaced:<slug>` meta, and passed into `decideThresholdMode` +
`buildGreetingPrompt`, then stamped after the greeting succeeds.

Separately, the web interpret persona ends with an `overclaimGuard` paragraph that
bounds what Miriel may claim to "notice across readings" (the surfaced patterns,
foretellings, recurring threads, and past moments — but NOT the topics of questions).
Android's interpret currently ships without it; the Slice D review flagged this. It is
folded into this slice because it references "the specific past moments surfaced," which
this slice introduces.

## Web reference (source of truth)

`data/temporal-recall.js` (ms-native; `DAY = 86400000`):

```js
function findTemporalCallbacks({ readings, lastVisitTs, now }) {
  const list = (Array.isArray(readings) ? readings : []).filter(r => r && typeof r.timestamp === 'number');
  const count = list.length;
  const out = [];
  const ANNIV_WINDOW = 3 * DAY;
  // anniversary: exactly 1 year ago (within +/-3 days)
  for (const r of list) {
    const age = now - r.timestamp;
    if (age <= 0) continue;
    if (near(age, 365 * DAY, ANNIV_WINDOW))
      out.push({ kind:'anniversary', strength:5, signature:`anniversary:1y:${r.id}`,
        fact:`Exactly one year ago, in a past reading (not their last visit), they asked: "${r.question || '(no question)'}" (${cardNames(r)}).` });
  }
  // elapsed: >= 21 days since last visit
  if (lastVisitTs != null) {
    const gapDays = (now - Number(lastVisitTs)) / DAY;
    if (gapDays >= 21)
      out.push({ kind:'elapsed', strength:Math.min(5, 3 + Math.floor(gapDays/30)),
        signature:`elapsed:${Math.round(gapDays)}d`,
        fact:`It has been about ${describeGap(gapDays)} since they last sat with you.` });
  }
  // seasonal echo: same calendar month, a prior year, not already a 1y anniversary; pick MOST RECENT such reading
  // (out.push strength 2, signature `seasonal:${year}:${id}`,
  //  fact `Around this time ${yrs} year(s) ago they asked: "${q}" (${cards}).`)
  // milestone count: count>0 && count%50===0 -> strength 4 signature `milestone:count:${count}`
  //   fact `They have now sat with you around ${count} times.`
  // milestone met: first reading ts + [6,12,24,36,48] months ~ now (within ANNIV_WINDOW), first match ->
  //   strength 4 signature `milestone:met:${m}m`
  //   fact `It has been ${m%12===0?`${m/12} year(s)`:`${m} months`} since they first sat down with you.`
  out.sort((a, b) => b.strength - a.strength);
  return out;
}
function filterSurfaced(candidates, surfacedMap, now, ttlDays) {
  const map = surfacedMap || {}; const ttl = ttlDays * DAY;
  return (candidates||[]).filter(c => { const last = map[c.signature]; return !(last && (now - last) < ttl); });
}
// helpers:
near(age,target,windowMs) = Math.abs(age-target) <= windowMs
cardNames(r) = (r.cards||[]).map(c=>c.name).filter(Boolean).join(', ') || 'the cards'
describeGap(days): days>=330 'a year'; >=60 `${round(days/30)} months`; >=21 `${round(days/7)} weeks`; else `${round(days)} days`
addMonths(ts,months): Date(ts).setMonth(getMonth()+months) -> getTime()
```

`data/memory-engine.js` — the `temporalCallbacks` param (default `[]`) in
`decideThresholdMode` and `buildGreetingPrompt`, and the temporal greeting block:

```js
function decideThresholdMode(lastVisitTs, threads, now, gapDays = REUNION_GAP_DAYS, predictions = [], temporalCallbacks = [], dormantThreads = [], seasonShift = null) {
  const hasMaterial = threads.length || predictions.length || temporalCallbacks.length || dormantThreads.length || !!seasonShift;
  if (!hasMaterial) return 'none';
  const gap = (lastVisitTs == null) ? Infinity : (now - Number(lastVisitTs)) / 86400;
  return gap >= gapDays ? 'reunion' : 'gentle';
}
// buildGreetingPrompt(mode, threads, gapDays, predictions = [], temporalCallbacks = [], timeOfDay = '', dormantThreads = [], seasonShift = null)
// temporalBlock (when temporalCallbacks.length):
//   `What you notice about the timing, in your own words:\n${temporalCallbacks.map(c => `- ${c.fact}`).join('\n')}\n\nIf this carries real history (a question they actually asked, the cards that fell), recall it concretely and specifically. Name it. Let them feel that you genuinely remember them and what they were carrying, then let it lead into now. If it is only a span of time (how long it has been, a milestone), simply acknowledge it warmly without inventing detail. IMPORTANT: these are facts about PAST READINGS, not about when they last visited. Do not say it has been a month or a year since they were here unless the gap line above actually says so. Honor the real recency stated above.`
// material order: [temporalBlock, threadBlock, dormantBlock, seasonBlock, predBlock, timeHint]
```

`data/temporal-recall.js` threshold wiring in `server.js` (~1080-1136): read
`temporal_surfaced:<slug>` meta; `findTemporalCallbacks({readings: loadReadings(slug),
lastVisitTs: lastVisitMs, now: nowMs})`; `filterSurfaced(..., 30).slice(0,1)`; pass into
`decideThresholdMode` + `buildGreetingPrompt`; after the greeting succeeds, stamp
`surfacedMap[c.signature] = nowMs` and `setMeta(temporal_surfaced:<slug>, ...)`.

`overclaimGuard` (server.js:703, appended to the interpret persona):

```
What you may and may not claim to notice across their readings: you genuinely track the cards and symbols that recur for them, the patterns named above, the foretellings surfaced above, the recurring emotional threads surfaced above, and the specific past moments surfaced to you here. You do NOT keep a record of the topics or kinds of questions they bring over time, so never claim to see a pattern in "what they ask" or "the questions they keep asking" unless such a pattern is explicitly stated above. Speak only to patterns and foretellings you actually have in front of you; do not invent a history of noticing.
```

## Architecture / Components

### 1. MemoryModel.kt (PURE — no `android.*` imports; JVM-unit-testable)

- `data class TemporalCallback(val strength: Int, val signature: String, val fact: String)`
  (web's `kind`/`ref` are unused downstream — dropped per YAGNI).
- Helpers (private): `near(age, target, windowMs): Boolean`; `describeGap(days: Double): String`;
  `addMonths(ts: Long, months: Int): Long` (via `java.util.Calendar`); `cardNames(r: JSONObject): String`.
- `findTemporalCallbacks(readings: List<JSONObject>, lastVisitTs: Long?, now: Long): List<TemporalCallback>`
  — ms-native port of the web function, using `java.util.Calendar` for month/year math
  (NOT `java.time`; minSdk 24). `r.timestamp` read as a Long via `optLong`/`has` guard
  (skip readings without a numeric timestamp, matching `typeof r.timestamp === 'number'`).
- `filterTemporalSurfaced(candidates: List<TemporalCallback>, surfaced: Map<String, Long>, now: Long, ttlDays: Int): List<TemporalCallback>`
  — `ttl = ttlDays * 86400000L` (ms). Drop a candidate whose `surfaced[signature]` is within ttl.
- Add `temporalCallbacks: List<TemporalCallback> = emptyList()` to `decideThresholdMode`
  (inserted after `predictions`, before `dormant`, matching web's positional order) and to
  `buildGreetingPrompt` (after `predictions`, before `timeOfDay`). `hasMaterial` includes
  `temporalCallbacks.isNotEmpty()`. The default keeps existing call sites valid (build green
  until Task 3 wires real values).
- Add the `temporalBlock` string in `buildGreetingPrompt` (verbatim above), PREPENDED to the
  material list: `listOf(temporalBlock, threadBlock, dormantBlock, seasonBlock, predBlock, timeHint)`.
- `const val OVERCLAIM_GUARD: String` = `"\n\n"` + the exact overclaimGuard text above.

### 2. TemporalRecall.kt (NEW — mirrors EmotionalSeasons.kt / ProphecyWeaving.kt)

- `class TemporalRecall(private val store: MemoryStore)` — shares MemoryEngine's single store.
- `temporalTtlDays = 30`.
- `pending(slug: String, readings: List<JSONObject>, lastVisitMs: Long?, nowMs: Long): List<TemporalCallback>`
  — best-effort `try { filterTemporalSurfaced(findTemporalCallbacks(readings, lastVisitMs, nowMs), readSurfaced(slug), nowMs, temporalTtlDays).take(1) } catch { emptyList() }`.
- `markSurfaced(slug: String, callbacks: List<TemporalCallback>, nowMs: Long)` — prune entries
  with `(nowMs - value) >= temporalTtlDays*86400000L`, stamp each `signature -> nowMs`, write meta.
- private `readSurfaced`/`writeSurfaced` — JSON object in `temporal_surfaced:<slug>`, values in
  MS; tolerant parse -> empty map. (Same idiom as the other surfaced maps, but ms values.)

### 3. MemoryEngine.kt

- `private val temporal = TemporalRecall(store)`.
- `threshold(slug, now, timeOfDay, system, callLLM, readings: List<JSONObject>)` — NEW `readings`
  param. Inside: `val nowMs = now * 1000`; `val lastVisitMs = lastVisit?.let { it * 1000 }`;
  `val temporalCallbacks = temporal.pending(slug, readings, lastVisitMs, nowMs)`. Thread
  `temporalCallbacks` into `decideThresholdMode(...)` and `buildGreetingPrompt(...)`. After the
  greeting succeeds (alongside the existing `seasons.markSeasonSurfaced`):
  `if (temporalCallbacks.isNotEmpty()) temporal.markSurfaced(slug, temporalCallbacks, nowMs)`.

### 4. TarotServer.kt

- `handleThreshold`: load the slug's readings — `val readings = loadReadingsList(slug)` (the
  full `readings/<slug>.json` array as `List<JSONObject>`; empty list on missing/parse failure) —
  and pass into `memory.threshold(..., readings)`.
- `handleInterpret`: append `OVERCLAIM_GUARD` to the end of `systemPrompt` (after the prophecy block).
- Version bump: `versionCode` 7 -> 8, `versionName` "1.7" -> "1.8".

## Adaptations (Android vs web)

1. **Milliseconds for temporal.** Readings carry `timestamp` = frontend `Date.now()` (ms) and
   `temporal-recall.js` is ms-native. So temporal computes in ms end-to-end: `nowMs = now*1000`,
   `lastVisitMs = lastVisit*1000`, `temporal_surfaced` map values in ms, TTL `30*86400000`. This
   is the one ms island in the otherwise-seconds memory layer; it is internally consistent and
   matches web. The rest of `threshold()` stays in seconds.
2. **`java.util.Calendar`, not `java.time`** for month/year math (minSdk 24 — same constraint the
   Year Ahead reorder already honors). `Calendar` is core Java, so MemoryModel stays pure and
   JVM-testable.
3. **`kind`/`ref` dropped** from `TemporalCallback` — only `fact` (greeting), `signature` (dedup),
   and `strength` (sort) are used downstream.

## Data flow

App open -> `handleThreshold` loads readings + calls `threshold(..., readings)` -> `temporal.pending`
reads `temporal_surfaced` + `findTemporalCallbacks(readings, lastVisitMs, nowMs)` + filter + take 1
-> threaded into mode decision + greeting prompt (temporalBlock leads the material) -> greeting LLM ->
on success, `temporal.markSurfaced` stamps the shown signature(s). Interpret persona now ends with
`OVERCLAIM_GUARD`.

## Error handling

- `pending` is best-effort: any parse/IO failure returns `emptyList()` (no temporal block; greeting
  proceeds). Matches the season/prophecy contract.
- `markSurfaced` runs only after a successful greeting, so a callback is never marked surfaced when
  the greeting itself failed (faithful to web, which stamps after the response).
- `loadReadingsList` returns `emptyList()` on missing/corrupt readings file.

## Testing

- **JVM unit tests** (`MemoryModelTest`):
  - `findTemporalCallbacks`: anniversary fires within +/-3 days of 1y and not outside; seasonal echo
    picks the most-recent prior-year same-month reading and excludes the 1y anniversary; milestone
    `count % 50 == 0`; milestone met-anniversary (first reading + 12 months ~ now); elapsed gap >= 21
    days from lastVisit; `out` sorted by strength desc.
  - `filterTemporalSurfaced`: signature within TTL dropped; outside TTL kept; absent signature kept.
  - `buildGreetingPrompt` with a temporal callback: the temporalBlock appears and leads the material;
    `decideThresholdMode` returns reunion/gentle (not none) when only a temporal callback is present.
- **Compile gate:** `assembleDebug` each task; `testDebugUnitTest` for Task 1.
- **On-device smoke (real data):** the provisioned readings span real dates. (1) If a temporal tier
  is naturally in-window today, open the app and confirm the greeting voices it + `temporal_surfaced`
  is stamped. (2) Otherwise seed one reading dated ~1 year ago (anniversary tier) into
  `readings/matt.json`, open the app, confirm the greeting references it and `temporal_surfaced:matt`
  gets the `anniversary:1y:<id>` signature; a second open dedups it (mode falls back / no temporal block).

## Global constraints (carried from prior slices)

- **ASCII only** in all added/model-facing lines.
- **Local only** — never push tarot or TarotApp git history. TarotApp has no remote.
- **One SQLite connection** — `TemporalRecall` shares MemoryEngine's single `MemoryStore`.
- **Time:** the memory layer is unix SECONDS; temporal is the documented ms island (readings are ms).
- **Mirror web exactly** — `temporal-recall.js` + the `memory-engine.js`/`server.js` wiring are the
  source of truth.

## Task split (subagent-driven)

- **Task 1:** MemoryModel pure — `TemporalCallback`, helpers, `findTemporalCallbacks`,
  `filterTemporalSurfaced`, the `temporalCallbacks` default param + `temporalBlock` in
  `decideThresholdMode`/`buildGreetingPrompt`, `OVERCLAIM_GUARD` const + JVM tests.
  Ends with `testDebugUnitTest` + `assembleDebug`.
- **Task 2:** `TemporalRecall.kt` + MemoryEngine `temporal` field. Ends with `assembleDebug`.
- **Task 3:** `threshold()` readings param + temporal compute/thread/stamp; `handleThreshold` load+pass
  readings; `handleInterpret` append `OVERCLAIM_GUARD`; version bump. Ends with `assembleDebug`.

## Out of scope

- In-reading curiosity (Slice F) and the profile notebook / living note (Slice G).
