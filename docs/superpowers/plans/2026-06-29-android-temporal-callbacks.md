# Android Temporal Callbacks + Overclaim Guard (Slice E) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface one dated past-reading moment into the Threshold greeting (with `temporal_surfaced` dedup), and add the interpret `overclaimGuard` clause.

**Architecture:** Faithful port of `data/temporal-recall.js` + its `memory-engine.js`/`server.js` threshold wiring. Pure logic + greeting/decide param changes go in `MemoryModel.kt` (JVM-testable); a new `TemporalRecall.kt` (mirroring `EmotionalSeasons`/`ProphecyWeaving`) orchestrates read + dedup over the shared store; `MemoryEngine.threshold()` gains a `readings` param and threads temporal through; `TarotServer` loads readings for the greeting and appends the overclaim guard to interpret.

**Tech Stack:** Kotlin, Android SQLite, NanoHTTPD, `org.json`, `java.util.Calendar` (minSdk 24 — NOT java.time), JUnit4. Build via Android Studio's bundled JBR from CLI.

## Global Constraints

- **ASCII only** in every added or model-facing line.
- **Local only** — never push tarot or TarotApp git history. TarotApp has no remote. All commits local.
- **One SQLite connection** — `TemporalRecall` uses MemoryEngine's shared `MemoryStore`.
- **Time:** the memory layer is unix SECONDS, but TEMPORAL is MILLISECONDS end-to-end (readings carry `timestamp` = frontend `Date.now()` ms): `nowMs = now*1000`, `lastVisitMs = lastVisit*1000`, `temporal_surfaced` map in ms, TTL `30*86400000`. Documented island; the rest of `threshold()` stays seconds.
- **Month/year math via `java.util.Calendar`** (NOT `java.time`; minSdk 24). `Calendar` is core Java, so MemoryModel stays pure.
- **Mirror web exactly** — `temporal-recall.js` + `memory-engine.js` `decideThresholdMode`/`buildGreetingPrompt` + `server.js` threshold wiring are the source of truth.
- **Build/test (Windows PowerShell):** `$env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"` once per shell; then `& "C:\Users\Matt\projects\TarotApp\gradlew.bat" -p "C:\Users\Matt\projects\TarotApp" testDebugUnitTest` and `... assembleDebug`. Use `gradlew.bat` only.

---

## File Structure

- `app/src/main/java/com/matt/tarot/MemoryModel.kt` (MODIFY) — PURE temporal logic + `TemporalCallback`, `OVERCLAIM_GUARD`, and the `temporalCallbacks` param/block in `decideThresholdMode`/`buildGreetingPrompt`.
- `app/src/test/java/com/matt/tarot/MemoryModelTest.kt` (MODIFY) — JVM tests.
- `app/src/main/java/com/matt/tarot/TemporalRecall.kt` (CREATE) — orchestration + dedup meta (ms).
- `app/src/main/java/com/matt/tarot/MemoryEngine.kt` (MODIFY) — `temporal` field; `threshold()` gains `readings` param + temporal compute/thread/stamp.
- `app/src/main/java/com/matt/tarot/TarotServer.kt` (MODIFY) — `handleThreshold` loads + passes readings; `loadReadingsList` helper; `handleInterpret` appends `OVERCLAIM_GUARD`.
- `app/build.gradle` (MODIFY) — version bump 7 -> 8 / "1.7" -> "1.8".

---

## Task 1: Pure temporal logic + greeting/decide params + overclaim guard

**Files:**
- Modify: `app/src/main/java/com/matt/tarot/MemoryModel.kt`
- Test: `app/src/test/java/com/matt/tarot/MemoryModelTest.kt`

**Interfaces:**
- Produces (consumed by Tasks 2-3):
  - `data class TemporalCallback(val strength: Int, val signature: String, val fact: String)`
  - `fun findTemporalCallbacks(readings: List<JSONObject>, lastVisitTs: Long?, now: Long): List<TemporalCallback>`
  - `fun filterTemporalSurfaced(candidates: List<TemporalCallback>, surfaced: Map<String, Long>, now: Long, ttlDays: Int): List<TemporalCallback>`
  - `const val OVERCLAIM_GUARD: String`
  - `decideThresholdMode(..., temporalCallbacks: List<TemporalCallback> = emptyList(), ...)` and `buildGreetingPrompt(..., temporalCallbacks: List<TemporalCallback> = emptyList(), ...)` (new param after `predictions`).

- [ ] **Step 1: Write the failing tests**

Add to the end of `app/src/test/java/com/matt/tarot/MemoryModelTest.kt`, before the closing brace. (Imports `org.json.JSONObject` and `org.json.JSONArray` — add them to the test file's imports if not already present.)

```kotlin
    // --- Temporal callbacks (Slice E) ---
    private val MS_DAY = 86400000L
    private val TNOW = 1_700_000_000_000L // arbitrary fixed ms

    private fun minusYears(now: Long, years: Int): Long {
        val c = java.util.Calendar.getInstance(); c.timeInMillis = now
        c.add(java.util.Calendar.YEAR, -years); return c.timeInMillis
    }
    private fun reading(id: Long, tsMs: Long, question: String = "", cards: List<String> = emptyList()): org.json.JSONObject {
        val o = org.json.JSONObject().put("id", id).put("timestamp", tsMs).put("question", question)
        val arr = org.json.JSONArray(); for (n in cards) arr.put(org.json.JSONObject().put("name", n))
        return o.put("cards", arr)
    }

    @Test fun temporal_anniversary_fires_within_window() {
        val cbs = findTemporalCallbacks(listOf(reading(1, TNOW - 365 * MS_DAY, "Will it work out?", listOf("The Star"))), null, TNOW)
        assertTrue(cbs.any { it.signature == "anniversary:1y:1" && it.fact.contains("Exactly one year ago") })
    }

    @Test fun temporal_anniversary_excluded_outside_window() {
        val cbs = findTemporalCallbacks(listOf(reading(1, TNOW - (365 + 10) * MS_DAY, "q")), null, TNOW)
        assertTrue(cbs.none { it.signature.startsWith("anniversary") })
    }

    @Test fun temporal_elapsed_when_gap_over_21_days() {
        val cbs = findTemporalCallbacks(emptyList(), TNOW - 40 * MS_DAY, TNOW)
        assertTrue(cbs.any { it.signature.startsWith("elapsed:") && it.fact.contains("since they last sat with you") })
    }

    @Test fun temporal_no_elapsed_under_21_days() {
        val cbs = findTemporalCallbacks(emptyList(), TNOW - 10 * MS_DAY, TNOW)
        assertTrue(cbs.none { it.signature.startsWith("elapsed") })
    }

    @Test fun temporal_seasonal_picks_most_recent_prior_year() {
        val cbs = findTemporalCallbacks(
            listOf(reading(1, minusYears(TNOW, 3), "old"), reading(2, minusYears(TNOW, 2), "newer")), null, TNOW)
        val seasonal = cbs.firstOrNull { it.signature.startsWith("seasonal:") }
        assertTrue(seasonal != null && seasonal.signature.endsWith(":2"))
    }

    @Test fun temporal_milestone_count_at_multiple_of_50() {
        val readings = (1..50).map { reading(it.toLong(), TNOW - it * MS_DAY) }
        val cbs = findTemporalCallbacks(readings, null, TNOW)
        assertTrue(cbs.any { it.signature == "milestone:count:50" && it.fact.contains("around 50 times") })
    }

    @Test fun temporal_milestone_met_one_year_since_first() {
        val cbs = findTemporalCallbacks(listOf(reading(1, minusYears(TNOW, 1), "q"), reading(2, TNOW - 5 * MS_DAY)), null, TNOW)
        assertTrue(cbs.any { it.signature == "milestone:met:12m" && it.fact.contains("1 year since they first sat down") })
    }

    @Test fun temporal_sorted_by_strength_desc() {
        val cbs = findTemporalCallbacks(
            listOf(reading(1, TNOW - 365 * MS_DAY, "anniv"), reading(2, minusYears(TNOW, 2), "seasonal")), null, TNOW)
        assertTrue(cbs.size >= 2)
        assertEquals(5, cbs.first().strength)
        assertTrue(cbs.first().strength >= cbs.last().strength)
    }

    @Test fun filterTemporalSurfaced_dedups_within_ttl() {
        val cbs = listOf(TemporalCallback(5, "anniversary:1y:1", "f1"), TemporalCallback(2, "seasonal:2023:2", "f2"))
        val ttlMs = 30 * MS_DAY
        val surfaced = mapOf("anniversary:1y:1" to TNOW - 5 * MS_DAY, "seasonal:2023:2" to TNOW - (ttlMs + 1000))
        val kept = filterTemporalSurfaced(cbs, surfaced, TNOW, 30)
        assertEquals(listOf("seasonal:2023:2"), kept.map { it.signature })
    }

    @Test fun greeting_includes_temporal_block_and_leads_material() {
        val tc = listOf(TemporalCallback(5, "anniversary:1y:1", "Exactly one year ago they asked X."))
        val g = buildGreetingPrompt("reunion", emptyList(), 40.0, emptyList(), tc, "", emptyList(), null)
        assertTrue(g.contains("What you notice about the timing"))
        assertTrue(g.contains("Exactly one year ago they asked X."))
    }

    @Test fun decideThresholdMode_temporal_alone_is_material() {
        val tc = listOf(TemporalCallback(5, "anniversary:1y:1", "f"))
        val mode = decideThresholdMode(null, emptyList(), 1_700_000_000L, REUNION_GAP_DAYS, emptyList(), tc, emptyList(), null)
        assertEquals("reunion", mode)
    }
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `& "C:\Users\Matt\projects\TarotApp\gradlew.bat" -p "C:\Users\Matt\projects\TarotApp" testDebugUnitTest`
Expected: FAIL — unresolved references `findTemporalCallbacks`, `filterTemporalSurfaced`, `TemporalCallback`, and the new `temporalCallbacks` arg in `decideThresholdMode`/`buildGreetingPrompt`.

- [ ] **Step 3: Implement the temporal logic + constant in MemoryModel.kt**

Append to the end of `app/src/main/java/com/matt/tarot/MemoryModel.kt` (top-level; no `android.*` imports — `java.util.Calendar`/`JSONObject` are fine):

```kotlin
// -- Temporal callbacks (Slice E) -------------------------------------------
// PURE port of data/temporal-recall.js. MILLISECONDS (readings carry timestamp =
// frontend Date.now() ms). Month/year math via java.util.Calendar (minSdk 24).
private const val TEMPORAL_DAY_MS = 86400000L
private const val ANNIV_WINDOW_MS = 3 * TEMPORAL_DAY_MS

data class TemporalCallback(val strength: Int, val signature: String, val fact: String)

private fun temporalNear(age: Long, target: Long, windowMs: Long): Boolean = Math.abs(age - target) <= windowMs

private fun temporalCardNames(r: JSONObject): String {
    val arr = r.optJSONArray("cards") ?: return "the cards"
    val names = (0 until arr.length()).mapNotNull { i -> arr.optJSONObject(i)?.optString("name")?.ifEmpty { null } }
    return if (names.isEmpty()) "the cards" else names.joinToString(", ")
}

private fun describeGap(days: Double): String = when {
    days >= 330 -> "a year"
    days >= 60  -> "${Math.round(days / 30)} months"
    days >= 21  -> "${Math.round(days / 7)} weeks"
    else        -> "${Math.round(days)} days"
}

private fun temporalAddMonths(ts: Long, months: Int): Long {
    val c = java.util.Calendar.getInstance(); c.timeInMillis = ts
    c.add(java.util.Calendar.MONTH, months); return c.timeInMillis
}
private fun temporalMonth(ts: Long): Int {
    val c = java.util.Calendar.getInstance(); c.timeInMillis = ts; return c.get(java.util.Calendar.MONTH)
}
private fun temporalYear(ts: Long): Int {
    val c = java.util.Calendar.getInstance(); c.timeInMillis = ts; return c.get(java.util.Calendar.YEAR)
}

fun findTemporalCallbacks(readings: List<JSONObject>, lastVisitTs: Long?, now: Long): List<TemporalCallback> {
    val list = readings.filter { it.has("timestamp") && !it.isNull("timestamp") }
    val count = list.size
    val out = ArrayList<TemporalCallback>()

    // anniversary: exactly one year ago (+/- 3 days)
    for (r in list) {
        val ts = r.optLong("timestamp")
        val age = now - ts
        if (age <= 0) continue
        if (temporalNear(age, 365 * TEMPORAL_DAY_MS, ANNIV_WINDOW_MS)) {
            val q = r.optString("question").ifEmpty { "(no question)" }
            out.add(TemporalCallback(5, "anniversary:1y:${r.optString("id")}",
                "Exactly one year ago, in a past reading (not their last visit), they asked: \"$q\" (${temporalCardNames(r)})."))
        }
    }

    // elapsed: >= 21 days since last visit
    if (lastVisitTs != null) {
        val gapDays = (now - lastVisitTs) / TEMPORAL_DAY_MS.toDouble()
        if (gapDays >= 21) {
            out.add(TemporalCallback(minOf(5, 3 + (gapDays / 30).toInt()), "elapsed:${Math.round(gapDays)}d",
                "It has been about ${describeGap(gapDays)} since they last sat with you."))
        }
    }

    // seasonal echo: same calendar month, a prior year, not a 1y anniversary; most recent prior year
    val nowMonth = temporalMonth(now); val nowYear = temporalYear(now)
    var seasonalBest: JSONObject? = null
    var seasonalBestTs = Long.MIN_VALUE
    for (r in list) {
        val ts = r.optLong("timestamp"); val age = now - ts
        if (temporalMonth(ts) == nowMonth && temporalYear(ts) < nowYear && !temporalNear(age, 365 * TEMPORAL_DAY_MS, ANNIV_WINDOW_MS)) {
            if (ts > seasonalBestTs) { seasonalBest = r; seasonalBestTs = ts }
        }
    }
    seasonalBest?.let { r ->
        val yrs = nowYear - temporalYear(seasonalBestTs)
        val q = r.optString("question").ifEmpty { "(no question)" }
        out.add(TemporalCallback(2, "seasonal:${temporalYear(seasonalBestTs)}:${r.optString("id")}",
            "Around this time $yrs year${if (yrs > 1) "s" else ""} ago they asked: \"$q\" (${temporalCardNames(r)})."))
    }

    // milestone: round reading-count totals
    if (count > 0 && count % 50 == 0) {
        out.add(TemporalCallback(4, "milestone:count:$count", "They have now sat with you around $count times."))
    }
    // milestone: anniversary of first reading
    if (count > 0) {
        var firstTs = Long.MAX_VALUE
        for (r in list) { val ts = r.optLong("timestamp"); if (ts < firstTs) firstTs = ts }
        for (m in intArrayOf(6, 12, 24, 36, 48)) {
            if (temporalNear(now - temporalAddMonths(firstTs, m), 0, ANNIV_WINDOW_MS)) {
                val years = if (m % 12 == 0) "${m / 12} year${if (m / 12 > 1) "s" else ""}" else "$m months"
                out.add(TemporalCallback(4, "milestone:met:${m}m", "It has been $years since they first sat down with you."))
                break
            }
        }
    }

    out.sortByDescending { it.strength }
    return out
}

fun filterTemporalSurfaced(candidates: List<TemporalCallback>, surfaced: Map<String, Long>, now: Long, ttlDays: Int): List<TemporalCallback> {
    val ttl = ttlDays * TEMPORAL_DAY_MS
    return candidates.filter { c ->
        val last = surfaced[c.signature]
        !(last != null && (now - last) < ttl)
    }
}

// Interpret persona anti-inflation guard (port of server.js overclaimGuard). Appended last.
const val OVERCLAIM_GUARD: String = "\n\n" +
    "What you may and may not claim to notice across their readings: you genuinely track the cards and symbols that recur for them, the patterns named above, the foretellings surfaced above, the recurring emotional threads surfaced above, and the specific past moments surfaced to you here. You do NOT keep a record of the topics or kinds of questions they bring over time, so never claim to see a pattern in \"what they ask\" or \"the questions they keep asking\" unless such a pattern is explicitly stated above. Speak only to patterns and foretellings you actually have in front of you; do not invent a history of noticing."
```

- [ ] **Step 4: Add the `temporalCallbacks` param to `decideThresholdMode`**

In `app/src/main/java/com/matt/tarot/MemoryModel.kt`, change the `decideThresholdMode` signature and `hasMaterial` line:

```kotlin
fun decideThresholdMode(
    lastVisit: Long?,
    threads: List<MemoryRow>,
    now: Long,
    gapDays: Int = REUNION_GAP_DAYS,
    predictions: List<MemoryRow> = emptyList(),
    temporalCallbacks: List<TemporalCallback> = emptyList(),
    dormant: List<MemoryRow> = emptyList(),
    seasonShift: SeasonShift? = null
): String {
    val hasMaterial = threads.isNotEmpty() || predictions.isNotEmpty() || temporalCallbacks.isNotEmpty() || dormant.isNotEmpty() || seasonShift != null
    if (!hasMaterial) return "none"
    val gap = if (lastVisit == null) Double.POSITIVE_INFINITY else (now - lastVisit) / 86400.0
    return if (gap >= gapDays) "reunion" else "gentle"
}
```

- [ ] **Step 5: Add the `temporalCallbacks` param + block to `buildGreetingPrompt`**

In `buildGreetingPrompt`, add the param (after `predictions`, before `timeOfDay`), build `temporalBlock`, and PREPEND it to the material list:

Change the signature to:

```kotlin
fun buildGreetingPrompt(
    mode: String,
    threads: List<MemoryRow>,
    gapDays: Double,
    predictions: List<MemoryRow> = emptyList(),
    temporalCallbacks: List<TemporalCallback> = emptyList(),
    timeOfDay: String = "",
    dormant: List<MemoryRow> = emptyList(),
    seasonShift: SeasonShift? = null
): String {
```

Add this `temporalBlock` val immediately before the existing `val timeHint = ...` line:

```kotlin
    val temporalBlock = if (temporalCallbacks.isNotEmpty())
        "What you notice about the timing, in your own words:\n" +
        temporalCallbacks.joinToString("\n") { "- ${it.fact}" } +
        "\n\nIf this carries real history (a question they actually asked, the cards that fell), recall it concretely and specifically. Name it. Let them feel that you genuinely remember them and what they were carrying, then let it lead into now. If it is only a span of time (how long it has been, a milestone), simply acknowledge it warmly without inventing detail. IMPORTANT: these are facts about PAST READINGS, not about when they last visited. Do not say it has been a month or a year since they were here unless the gap line above actually says so. Honor the real recency stated above."
    else ""
```

Change the existing `material` line to prepend `temporalBlock`:

```kotlin
    val material = listOf(temporalBlock, threadBlock, dormantBlock, seasonBlock, predBlock, timeHint)
        .filter { it.isNotEmpty() }.joinToString("\n\n")
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `& "C:\Users\Matt\projects\TarotApp\gradlew.bat" -p "C:\Users\Matt\projects\TarotApp" testDebugUnitTest`
Expected: PASS — all `temporal_*`, `filterTemporalSurfaced_*`, `greeting_includes_temporal_block_*`, `decideThresholdMode_temporal_alone_*` green, plus the pre-existing suite.

- [ ] **Step 7: Compile gate**

Run: `& "C:\Users\Matt\projects\TarotApp\gradlew.bat" -p "C:\Users\Matt\projects\TarotApp" assembleDebug`
Expected: BUILD SUCCESSFUL. (The new params default to `emptyList()`, so the existing `MemoryEngine.threshold()` call sites still compile.)

- [ ] **Step 8: Verify added lines are ASCII-clean**

Run (Git Bash): `LC_ALL=C grep -nP '[^\x00-\x7F]' app/src/main/java/com/matt/tarot/MemoryModel.kt`
Expected: no matches among the lines you added.

- [ ] **Step 9: Commit**

```bash
git add app/src/main/java/com/matt/tarot/MemoryModel.kt app/src/test/java/com/matt/tarot/MemoryModelTest.kt
git commit -m "feat(android): temporal callback logic + greeting/decide params + overclaim guard (Slice E task 1)"
```

---

## Task 2: `TemporalRecall.kt` + MemoryEngine field

**Files:**
- Create: `app/src/main/java/com/matt/tarot/TemporalRecall.kt`
- Modify: `app/src/main/java/com/matt/tarot/MemoryEngine.kt`

**Interfaces:**
- Consumes (Task 1): `findTemporalCallbacks`, `filterTemporalSurfaced`, `TemporalCallback`.
- Produces (Task 3): `TemporalRecall.pending(slug, readings, lastVisitMs, nowMs): List<TemporalCallback>`; `TemporalRecall.markSurfaced(slug, callbacks, nowMs)`; `MemoryEngine` holds `private val temporal = TemporalRecall(store)`.

- [ ] **Step 1: Create `TemporalRecall.kt`**

Create `app/src/main/java/com/matt/tarot/TemporalRecall.kt` (mirrors `EmotionalSeasons.kt`/`ProphecyWeaving.kt`; ms-valued surfaced map):

```kotlin
package com.matt.tarot

import android.util.Log
import org.json.JSONObject

// Temporal callbacks. Port of data/temporal-recall.js + its server.js threshold wiring.
// Shares MemoryEngine's single MemoryStore. Best-effort: a failure never breaks a greeting.
// NOTE: temporal works in MILLISECONDS (readings carry timestamp = frontend Date.now() ms);
// the temporal_surfaced dedup map stores ms. This is the one ms island in the seconds layer.
class TemporalRecall(private val store: MemoryStore) {
    companion object { private const val TAG = "TemporalRecall"; private const val TTL_DAYS = 30 }

    fun pending(slug: String, readings: List<JSONObject>, lastVisitMs: Long?, nowMs: Long): List<TemporalCallback> {
        return try {
            val surfaced = readSurfaced(slug)
            filterTemporalSurfaced(findTemporalCallbacks(readings, lastVisitMs, nowMs), surfaced, nowMs, TTL_DAYS).take(1)
        } catch (e: Exception) {
            Log.w(TAG, "temporal pending failed: ${e.message}")
            emptyList()
        }
    }

    fun markSurfaced(slug: String, callbacks: List<TemporalCallback>, nowMs: Long) {
        val surfaced = HashMap(readSurfaced(slug))
        val ttlMs = TTL_DAYS.toLong() * 86400000L
        surfaced.entries.removeAll { (nowMs - it.value) >= ttlMs }
        for (c in callbacks) surfaced[c.signature] = nowMs
        writeSurfaced(slug, surfaced)
    }

    private fun readSurfaced(slug: String): Map<String, Long> {
        val raw = store.getMeta("temporal_surfaced:$slug") ?: return emptyMap()
        return try {
            val o = JSONObject(raw)
            val m = HashMap<String, Long>()
            val keys = o.keys()
            while (keys.hasNext()) { val k = keys.next(); m[k] = o.optLong(k) }
            m
        } catch (e: Exception) { emptyMap() }
    }

    private fun writeSurfaced(slug: String, map: Map<String, Long>) {
        val o = JSONObject()
        for ((k, v) in map) o.put(k, v)
        store.setMeta("temporal_surfaced:$slug", o.toString())
    }
}
```

- [ ] **Step 2: Add the `temporal` field to MemoryEngine.kt**

In `app/src/main/java/com/matt/tarot/MemoryEngine.kt`, add next to the existing `private val seasons` / `private val prophecy` fields:

```kotlin
    private val temporal = TemporalRecall(store)
```

- [ ] **Step 3: Compile gate**

Run: `& "C:\Users\Matt\projects\TarotApp\gradlew.bat" -p "C:\Users\Matt\projects\TarotApp" assembleDebug`
Expected: BUILD SUCCESSFUL.

- [ ] **Step 4: Verify added lines are ASCII-clean**

Run (Git Bash): `LC_ALL=C grep -nP '[^\x00-\x7F]' app/src/main/java/com/matt/tarot/TemporalRecall.kt app/src/main/java/com/matt/tarot/MemoryEngine.kt`
Expected: no matches.

- [ ] **Step 5: Commit**

```bash
git add app/src/main/java/com/matt/tarot/TemporalRecall.kt app/src/main/java/com/matt/tarot/MemoryEngine.kt
git commit -m "feat(android): TemporalRecall orchestration + engine field (Slice E task 2)"
```

---

## Task 3: `threshold()` readings wiring + `handleThreshold`/`handleInterpret` + version bump

**Files:**
- Modify: `app/src/main/java/com/matt/tarot/MemoryEngine.kt` (`threshold()`)
- Modify: `app/src/main/java/com/matt/tarot/TarotServer.kt` (`handleThreshold`, `handleInterpret`, new `loadReadingsList`)
- Modify: `app/build.gradle:14-15`

**Interfaces:**
- Consumes (Task 2): `memory` field `temporal`; `TemporalRecall.pending`/`markSurfaced`; `TemporalCallback`.

- [ ] **Step 1: Wire temporal into `MemoryEngine.threshold()`**

In `app/src/main/java/com/matt/tarot/MemoryEngine.kt`, change the `threshold` signature to add a `readings` param:

```kotlin
    fun threshold(slug: String, now: Long, timeOfDay: String, system: String, callLLM: CallLLM, readings: List<JSONObject>): ThresholdResult {
```

Immediately after the existing `val seasonShift = seasons.pendingSeasonShift(slug, now)` line, add:

```kotlin
        val nowMs = now * 1000
        val lastVisitMs = lastVisit?.let { it * 1000 }
        val temporalCallbacks = temporal.pending(slug, readings, lastVisitMs, nowMs)
```

Update the `decideThresholdMode` call to pass `temporalCallbacks` (after `predictions`):

```kotlin
        val mode = decideThresholdMode(lastVisit, freshThreads, now, REUNION_GAP_DAYS, predictions, temporalCallbacks, dormant, seasonShift)
```

Update the `buildGreetingPrompt` call to pass `temporalCallbacks` (after `shownPredictions`):

```kotlin
        val prompt = buildGreetingPrompt(mode, shownThreads, gapDays, shownPredictions, temporalCallbacks, timeOfDay, shownDormant, seasonShift)
```

In the greeting-success block, alongside the existing `if (seasonShift != null) seasons.markSeasonSurfaced(slug, seasonShift, now)`, add:

```kotlin
        if (temporalCallbacks.isNotEmpty()) temporal.markSurfaced(slug, temporalCallbacks, nowMs)
```

(`JSONObject` is already imported in MemoryEngine.kt.)

- [ ] **Step 2: Add `loadReadingsList` + pass readings in `handleThreshold` (TarotServer.kt)**

Add this private helper to `TarotServer` (near the other readings helpers):

```kotlin
    private fun loadReadingsList(slug: String): List<JSONObject> {
        val file = File(readingsDir, "$slug.json")
        return try {
            if (!file.exists()) emptyList()
            else { val arr = JSONArray(file.readText()); (0 until arr.length()).mapNotNull { arr.optJSONObject(it) } }
        } catch (e: Exception) { emptyList() }
    }
```

In `handleThreshold`, change the `memory.threshold(...)` call to load and pass readings. The current line is:

```kotlin
            val result = memory.threshold(slug, now, timeOfDay, system, ::memoryCallLLM)
```

Replace with:

```kotlin
            val readings = loadReadingsList(slug)
            val result = memory.threshold(slug, now, timeOfDay, system, ::memoryCallLLM, readings)
```

- [ ] **Step 3: Append `OVERCLAIM_GUARD` to the interpret persona (TarotServer.kt)**

In `handleInterpret`, the current `systemPrompt` line ends with `+ prophecy.block`:

```kotlin
        val systemPrompt = READER_PERSONA + buildAddressingNote(readerName) + memoryBlock + memory.recurringThemeBlock(slug) + buildPatternBlock(slug, cards) + prophecy.block
```

Change it to append the guard:

```kotlin
        val systemPrompt = READER_PERSONA + buildAddressingNote(readerName) + memoryBlock + memory.recurringThemeBlock(slug) + buildPatternBlock(slug, cards) + prophecy.block + OVERCLAIM_GUARD
```

- [ ] **Step 4: Bump the version**

In `app/build.gradle`, change lines 14-15:

```groovy
        versionCode 8
        versionName "1.8"
```

(from `versionCode 7` / `versionName "1.7"`.)

- [ ] **Step 5: Compile gate**

Run: `& "C:\Users\Matt\projects\TarotApp\gradlew.bat" -p "C:\Users\Matt\projects\TarotApp" assembleDebug`
Expected: BUILD SUCCESSFUL.

- [ ] **Step 6: Verify added lines are ASCII-clean**

Run (Git Bash): `LC_ALL=C grep -nP '[^\x00-\x7F]' app/src/main/java/com/matt/tarot/MemoryEngine.kt app/src/main/java/com/matt/tarot/TarotServer.kt`
Expected: any hits in TarotServer.kt are PRE-EXISTING (persona em dash, box-drawing dividers, ellipsis) and NOT among the lines you added; none in MemoryEngine.kt.

- [ ] **Step 7: Commit**

```bash
git add app/src/main/java/com/matt/tarot/MemoryEngine.kt app/src/main/java/com/matt/tarot/TarotServer.kt app/build.gradle
git commit -m "feat(android): wire temporal into threshold greeting + overclaim guard + bump to 1.8 (Slice E task 3)"
```

---

## Self-Review (completed)

**1. Spec coverage:**
- `TemporalCallback`, helpers, `findTemporalCallbacks` (all tiers), `filterTemporalSurfaced` -> Task 1, Steps 1-3. ✓
- `temporalCallbacks` param in `decideThresholdMode`/`buildGreetingPrompt` + `temporalBlock` leading material -> Task 1, Steps 4-5. ✓
- `OVERCLAIM_GUARD` const -> Task 1, Step 3. ✓
- `TemporalRecall.kt` (ms surfaced map, best-effort) + engine field -> Task 2. ✓
- `threshold()` readings param + compute/thread/stamp -> Task 3, Step 1. ✓
- `handleThreshold` load+pass readings + `loadReadingsList` -> Task 3, Step 2. ✓
- `handleInterpret` appends `OVERCLAIM_GUARD` -> Task 3, Step 3. ✓
- Version bump -> Task 3, Step 4. ✓
- ms adaptation + Calendar -> implemented in Task 1/2; on-device smoke is a human gate after merge. ✓

**2. Placeholder scan:** No TBD/TODO; every code step shows complete code. ✓

**3. Type consistency:** `TemporalCallback(strength, signature, fact)` identical across definition, `findTemporalCallbacks`, `filterTemporalSurfaced`, `TemporalRecall`, and the greeting. `threshold(..., readings: List<JSONObject>)` matches between MemoryEngine (Task 3) and the `handleThreshold` call (Task 3). `decideThresholdMode`/`buildGreetingPrompt` new param position (after `predictions`) is consistent between definition (Task 1) and call sites (Task 3). `pending(slug, readings, lastVisitMs, nowMs)` / `markSurfaced(slug, callbacks, nowMs)` consistent between Task 2 and Task 3. ✓
