# Android Emotional Seasons (Slice B) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port the web emotional-seasons pipeline to Android so Miriel builds a season timeline from feeling atoms, surfaces a season shift in the Threshold greeting, and a recurring theme in the in-reading persona.

**Architecture:** Pure logic (constants, types, detect/parse/bucket/prompt/serialize) in MemoryModel.kt, JVM-unit-tested. A new EmotionalSeasons.kt holds the impure LLM+meta pipeline and shares MemoryEngine's single MemoryStore (one SQLite connection). MemoryEngine delegates and wires the season shift into threshold(); TarotServer wires the theme block into interpret, the update cadence into save, and the backfill into first launch.

**Tech Stack:** Kotlin, Android SQLite, NanoHTTPD, OkHttp (via memoryCallLLM), org.json, JUnit4. Build via Android Studio JBR from CLI.

## Global Constraints

- ASCII only in all model-facing prose and ported strings (SEASON_SYSTEM, prompts, the theme block). Verify with a byte scan before committing.
- Never push tarot or TarotApp git history. TarotApp is local-only. All commits stay local.
- Time in the memory layer is unix SECONDS.
- Faithful port: prompt wording, constants, and the detect/bucket math copied verbatim from data/emotional-seasons.js (MIN_FEELINGS_PER_SEASON=4, SEASON_WINDOW_DAYS=30, SEASON_CADENCE=8, SHIFT_THRESHOLD=2, THEME_MIN_SEASONS=2). Meta JSON keys snake_case, identical shape to web.
- ONE SQLite connection: EmotionalSeasons takes MemoryEngine's existing store instance. Do NOT construct a second MemoryStore.
- Reuse existing infrastructure (memoryCallLLM, ensureBackfill, the existing HAIKU constant, the capture-Thread pattern). No new HTTP or LLM plumbing.
- Build/verify from CLI with the Android Studio JBR (PowerShell):
  `$env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"` then
  `& "C:\Users\Matt\projects\TarotApp\gradlew.bat" -p "C:\Users\Matt\projects\TarotApp" <task>` (gradlew.bat only).
- Characterization uses the existing `HAIKU` constant, maxTokens 300.

## File Structure

- `MemoryModel.kt` (modify) - season constants, types, pure detect/parse/bucket/prompt/serialize. PURE.
- `MemoryModelTest.kt` (modify) - season unit tests.
- `MemoryStore.kt` (modify) - add `listMemories(slug)`.
- `EmotionalSeasons.kt` (create) - the impure pipeline (LLM + meta), shares the store.
- `MemoryEngine.kt` (modify) - `seasons` field, delegators, threshold seasonShift wiring.
- `TarotServer.kt` (modify) - interpret theme block, updateSeasons cadence, season backfill.
- `app/build.gradle` (modify) - versionCode 4 -> 5, versionName "1.4" -> "1.5".

---

### Task 1: MemoryModel.kt season pure logic + unit tests

**Files:**
- Modify: `app/src/main/java/com/matt/tarot/MemoryModel.kt`
- Test: `app/src/test/java/com/matt/tarot/MemoryModelTest.kt`

**Interfaces:**
- Consumes: existing `SeasonShift(signature, fact)` (from Slice A), `org.json.JSONArray`/`JSONObject` (already imported), `HAIKU` (already defined).
- Produces (used by Tasks 2-4):
  - constants `MIN_FEELINGS_PER_SEASON`, `SEASON_WINDOW_DAYS`, `SEASON_CADENCE`, `SHIFT_THRESHOLD`, `THEME_MIN_SEASONS`
  - `data class Season(index:Int, startedAt:Long, endedAt:Long, label:String, valence:Int, themes:List<String>, summary:String)`
  - `data class ParsedSeason(label:String, valence:Int, themes:List<String>, summary:String)`
  - `data class Feeling(content:String, salience:Int, createdAt:Long)`
  - `data class RecurringTheme(theme:String, seasons:Int, fact:String)`
  - `detectSeasonShift(seasons:List<Season>, now:Long): SeasonShift?`
  - `detectRecurringTheme(seasons:List<Season>): RecurringTheme?`
  - `parseSeasonOutput(raw:String?): ParsedSeason?`
  - `buildSeasonPrompt(feelings:List<Feeling>): String`
  - `bucketWindows(feelings:List<Feeling>, windowDays:Int): List<List<Feeling>>`
  - `const val SEASON_SYSTEM: String`
  - `buildSeasonThemeBlock(fact:String): String`
  - `parseTimeline(json:String?): List<Season>`, `serializeTimeline(seasons:List<Season>): String`

- [ ] **Step 1: Write the failing tests**

Append inside the existing `MemoryModelTest` class (after the existing tests, before the closing brace). Reuse the existing `NOW`.

```kotlin
    private fun season(index: Int, valence: Int, themes: List<String>,
                       label: String = "S$index", endedAt: Long = NOW, summary: String = "a summary") =
        Season(index, NOW, endedAt, label, valence, themes, summary)
    private fun feel(content: String, createdAt: Long) = Feeling(content, 3, createdAt)

    @Test fun seasonShift_null_under_two_seasons() {
        assertEquals(null, detectSeasonShift(listOf(season(0, 2, listOf("a"))), NOW))
    }

    @Test fun seasonShift_null_when_delta_below_threshold() {
        val ss = listOf(season(0, 1, listOf("a")), season(1, 2, listOf("b")))
        assertEquals(null, detectSeasonShift(ss, NOW))
    }

    @Test fun seasonShift_fires_on_delta_ge_two() {
        val ss = listOf(season(0, -2, listOf("grief"), label = "Long Dark", endedAt = NOW - 60 * 86400),
                        season(1, 2, listOf("hope"), label = "First Light"))
        val s = detectSeasonShift(ss, NOW)
        assertTrue(s != null)
        assertEquals("season-shift:0->1", s!!.signature)
        assertTrue(s.fact.contains("\"Long Dark\""))
        assertTrue(s.fact.contains("\"First Light\""))
        assertTrue(s.fact.contains("About 2 months ago"))
    }

    @Test fun seasonShift_picks_most_contrasting_earlier() {
        val ss = listOf(season(0, 0, listOf("a")), season(1, 1, listOf("b")), season(2, 2, listOf("c")))
        val s = detectSeasonShift(ss, NOW)
        assertEquals("season-shift:0->2", s!!.signature) // |2-0|=2 beats |2-1|=1
    }

    @Test fun seasonShift_tie_break_prefers_higher_index() {
        val ss = listOf(season(0, 0, listOf("a")), season(1, 0, listOf("b")), season(2, 2, listOf("c")))
        val s = detectSeasonShift(ss, NOW)
        assertEquals("season-shift:1->2", s!!.signature) // both deltas 2; higher index wins
    }

    @Test fun recurringTheme_null_under_two_seasons() {
        assertEquals(null, detectRecurringTheme(listOf(season(0, 1, listOf("work")))))
    }

    @Test fun recurringTheme_null_when_no_theme_two_distinct() {
        val ss = listOf(season(0, 1, listOf("work")), season(1, 1, listOf("love")))
        assertEquals(null, detectRecurringTheme(ss))
    }

    @Test fun recurringTheme_picks_theme_in_most_distinct_seasons() {
        val ss = listOf(season(0, 1, listOf("work", "fear")), season(1, 1, listOf("work")), season(2, 1, listOf("work")))
        val r = detectRecurringTheme(ss)
        assertEquals("work", r!!.theme)
        assertEquals(3, r.seasons)
        assertTrue(r.fact.contains("\"work\""))
        assertTrue(r.fact.contains("3 of the seasons"))
    }

    @Test fun parseSeason_valid() {
        val p = parseSeasonOutput("{\"label\":\"Quiet Thaw\",\"valence\":1,\"themes\":[\"Hope\",\"Rest\"],\"summary\":\"You are easing.\"}")
        assertEquals("Quiet Thaw", p!!.label)
        assertEquals(1, p.valence)
        assertEquals(listOf("hope", "rest"), p.themes)
        assertEquals("You are easing.", p.summary)
    }

    @Test fun parseSeason_clamps_valence_and_caps_themes() {
        val p = parseSeasonOutput("{\"label\":\"X\",\"valence\":9,\"themes\":[\"a\",\"b\",\"c\",\"d\",\"e\"],\"summary\":\"s\"}")
        assertEquals(2, p!!.valence)
        assertEquals(4, p.themes.size)
    }

    @Test fun parseSeason_missing_label_or_junk_returns_null() {
        assertEquals(null, parseSeasonOutput("{\"valence\":1,\"summary\":\"s\"}"))
        assertEquals(null, parseSeasonOutput("not json at all"))
        assertEquals(null, parseSeasonOutput(null))
    }

    @Test fun bucketWindows_groups_within_span_and_splits_when_exceeded() {
        val d = 86400L
        val fs = listOf(feel("a", 0), feel("b", 10 * d), feel("c", 25 * d), feel("d", 65 * d))
        val w = bucketWindows(fs, 30)
        assertEquals(2, w.size)
        assertEquals(3, w[0].size) // 0,10,25 within 30d of first(0)
        assertEquals(1, w[1].size) // 65 starts a new window
    }

    @Test fun timeline_roundtrip_and_tolerates_malformed() {
        val ss = listOf(season(0, -1, listOf("a", "b"), label = "L0"), season(1, 2, listOf("c"), label = "L1"))
        val round = parseTimeline(serializeTimeline(ss))
        assertEquals(2, round.size)
        assertEquals("L0", round[0].label)
        assertEquals(listOf("a", "b"), round[0].themes)
        assertEquals(2, round[1].valence)
        // a malformed element (missing label) is dropped, the good one survives
        assertEquals(1, parseTimeline("[{\"valence\":1},{\"label\":\"ok\",\"valence\":0,\"themes\":[],\"summary\":\"s\"}]").size)
        assertEquals(0, parseTimeline("garbage").size)
    }

    @Test fun seasonPrompt_and_themeBlock_include_inputs() {
        assertTrue(buildSeasonPrompt(listOf(feel("a heavy week", 0))).contains("- a heavy week"))
        assertTrue(buildSeasonThemeBlock("the thread of grief returns").contains("the thread of grief returns"))
    }
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:
```
$env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
& "C:\Users\Matt\projects\TarotApp\gradlew.bat" -p "C:\Users\Matt\projects\TarotApp" testDebugUnitTest
```
Expected: FAIL - unresolved references (Season, detectSeasonShift, parseSeasonOutput, bucketWindows, etc.).

- [ ] **Step 3: Implement the pure logic**

Append to `app/src/main/java/com/matt/tarot/MemoryModel.kt` (after the threshold logic from Slice A, before EOF). All strings ASCII.

```kotlin
// ---- Emotional seasons pure logic. Port of data/emotional-seasons.js. ----

const val MIN_FEELINGS_PER_SEASON = 4
const val SEASON_WINDOW_DAYS = 30
const val SEASON_CADENCE = 8
const val SHIFT_THRESHOLD = 2
const val THEME_MIN_SEASONS = 2
private const val SEASON_DAY = 86400L // seconds

data class Season(
    val index: Int, val startedAt: Long, val endedAt: Long,
    val label: String, val valence: Int, val themes: List<String>, val summary: String
)
data class ParsedSeason(val label: String, val valence: Int, val themes: List<String>, val summary: String)
data class Feeling(val content: String, val salience: Int, val createdAt: Long)
data class RecurringTheme(val theme: String, val seasons: Int, val fact: String)

fun themesPhrase(themes: List<String>): String {
    val t = themes.filter { it.isNotEmpty() }
    return if (t.isNotEmpty()) " (${t.joinToString(", ")})" else ""
}

// PURE: compare the latest season to the most-contrasting earlier one.
fun detectSeasonShift(seasons: List<Season>, now: Long): SeasonShift? {
    if (seasons.size < 2) return null
    val latest = seasons.last()
    var earlier: Season? = null
    var bestDelta = -1
    for (i in 0 until seasons.size - 1) {
        val s = seasons[i]
        val delta = Math.abs(latest.valence - s.valence)
        if (delta > bestDelta || (delta == bestDelta && earlier != null && s.index > earlier.index)) {
            bestDelta = delta
            earlier = s
        }
    }
    val e = earlier ?: return null
    if (bestDelta < SHIFT_THRESHOLD) return null
    val monthsAgo = maxOf(1L, Math.round((now - e.endedAt) / (30.0 * SEASON_DAY)))
    val fact = "About $monthsAgo month${if (monthsAgo == 1L) "" else "s"} ago they were in \"${e.label}\"" +
        themesPhrase(e.themes) + "; now they are in \"${latest.label}\"" + themesPhrase(latest.themes) + ". " +
        "The emotional weather has shifted between these."
    return SeasonShift("season-shift:${e.index}->${latest.index}", fact)
}

private class ThemeTally { var distinct = 0; var occ = 0; var lastIndex = -1 }

// PURE: the theme present in the most distinct seasons (>= THEME_MIN_SEASONS).
fun detectRecurringTheme(seasons: List<Season>): RecurringTheme? {
    if (seasons.size < 2) return null
    val tally = HashMap<String, ThemeTally>()
    for (s in seasons) {
        val seen = HashSet<String>()
        for (raw in s.themes) {
            val t = raw.trim().lowercase()
            if (t.isEmpty()) continue
            val e = tally.getOrPut(t) { ThemeTally() }
            e.occ += 1
            if (seen.add(t)) e.distinct += 1
            if (s.index > e.lastIndex) e.lastIndex = s.index
        }
    }
    val candidates = tally.entries.filter { it.value.distinct >= THEME_MIN_SEASONS }
    if (candidates.isEmpty()) return null
    val top = candidates.sortedWith(
        compareByDescending<Map.Entry<String, ThemeTally>> { it.value.distinct }
            .thenByDescending { it.value.occ }
            .thenByDescending { it.value.lastIndex }
    ).first()
    val e = top.value
    val fact = "The emotional thread of \"${top.key}\" keeps returning across their record, " +
        "present in ${e.distinct} of the seasons you have witnessed in them."
    return RecurringTheme(top.key, e.distinct, fact)
}

const val SEASON_SYSTEM =
    "You are Miriel, an experienced tarot reader keeping a private record of the emotional " +
    "seasons of the person you read for. Given the things they have felt over one stretch of " +
    "time, characterize that season. Respond with ONLY a JSON object: " +
    "{\"label\": short evocative name, \"valence\": integer from -2 (heavy) to 2 (light), " +
    "\"themes\": array of 1-4 short lowercase words, \"summary\": one or two sentences in the " +
    "second person (\"you\")}. ASCII only. No em dashes. No text outside the JSON."

fun buildSeasonPrompt(feelings: List<Feeling>): String {
    val lines = feelings.joinToString("\n") { "- ${it.content}" }
    return "Things they have felt during one stretch of time:\n$lines\n\n" +
        "Characterize this emotional season now. Return only the JSON object."
}

fun parseSeasonOutput(raw: String?): ParsedSeason? {
    if (raw.isNullOrEmpty()) return null
    val a = raw.indexOf('{')
    val b = raw.lastIndexOf('}')
    if (a < 0 || b <= a) return null
    val obj = try { JSONObject(raw.substring(a, b + 1)) } catch (e: Exception) { return null }
    val label = obj.optString("label").trim()
    val summary = obj.optString("summary").trim()
    if (label.isEmpty() || summary.isEmpty()) return null
    val valence = maxOf(-2, minOf(2, obj.optInt("valence", 0)))
    val themesArr = obj.optJSONArray("themes")
    val themes = if (themesArr == null) emptyList() else
        (0 until themesArr.length()).mapNotNull { i ->
            val t = themesArr.optString(i, "").trim()
            if (t.isEmpty()) null else t.lowercase()
        }.take(4)
    return ParsedSeason(label, valence, themes, summary)
}

// Group consecutive (ascending) feelings into windows of at most windowDays,
// measured from each window's first feeling.
fun bucketWindows(feelings: List<Feeling>, windowDays: Int): List<List<Feeling>> {
    val span = windowDays * SEASON_DAY
    val windows = ArrayList<List<Feeling>>()
    var cur = ArrayList<Feeling>()
    var start = 0L
    var started = false
    for (f in feelings) {
        if (!started) { start = f.createdAt; cur = arrayListOf(f); started = true; continue }
        if (f.createdAt - start <= span) cur.add(f)
        else { windows.add(cur); cur = arrayListOf(f); start = f.createdAt }
    }
    if (cur.isNotEmpty()) windows.add(cur)
    return windows
}

fun buildSeasonThemeBlock(fact: String): String =
    "\n\nAn emotional thread that recurs across the seasons you have witnessed in this person " +
    "(reference it only when a card in front of you genuinely meets it; name it plainly in your own voice; " +
    "never as a list, never inflated):\n- $fact"

private fun seasonToJson(s: Season): JSONObject = JSONObject()
    .put("index", s.index).put("started_at", s.startedAt).put("ended_at", s.endedAt)
    .put("label", s.label).put("valence", s.valence)
    .put("themes", JSONArray(s.themes)).put("summary", s.summary)

private fun seasonFromJson(o: JSONObject): Season? {
    val label = o.optString("label").trim()
    if (label.isEmpty()) return null
    val themesArr = o.optJSONArray("themes")
    val themes = if (themesArr == null) emptyList() else
        (0 until themesArr.length()).mapNotNull { i ->
            val t = themesArr.optString(i, "").trim(); if (t.isEmpty()) null else t
        }
    return Season(
        index = o.optInt("index", 0), startedAt = o.optLong("started_at", 0), endedAt = o.optLong("ended_at", 0),
        label = label, valence = o.optInt("valence", 0), themes = themes, summary = o.optString("summary").trim()
    )
}

fun parseTimeline(json: String?): List<Season> {
    if (json.isNullOrEmpty()) return emptyList()
    return try {
        val arr = JSONArray(json)
        (0 until arr.length()).mapNotNull { i -> arr.optJSONObject(i)?.let { seasonFromJson(it) } }
    } catch (e: Exception) { emptyList() }
}

fun serializeTimeline(seasons: List<Season>): String {
    val arr = JSONArray()
    for (s in seasons) arr.put(seasonToJson(s))
    return arr.toString()
}
```

Note: `parseSeasonOutput` uses `optInt("valence", 0)` (a number or numeric string -> its int; anything else -> 0), then clamps to [-2,2]. This is the faithful equivalent of the web `parseInt(valence,10)` + clamp given SEASON_SYSTEM mandates an integer.

- [ ] **Step 4: Run the tests to verify they pass**

Run:
```
$env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
& "C:\Users\Matt\projects\TarotApp\gradlew.bat" -p "C:\Users\Matt\projects\TarotApp" testDebugUnitTest
```
Expected: BUILD SUCCESSFUL, all MemoryModelTest tests pass (existing + new season tests).

- [ ] **Step 5: ASCII byte scan**

Run (git-bash):
```
cd /c/Users/Matt/projects/TarotApp && LC_ALL=C grep -nE '[^[:print:][:space:]]' app/src/main/java/com/matt/tarot/MemoryModel.kt app/src/test/java/com/matt/tarot/MemoryModelTest.kt
```
Expected: no output.

- [ ] **Step 6: Commit**

```
cd /c/Users/Matt/projects/TarotApp
git add app/src/main/java/com/matt/tarot/MemoryModel.kt app/src/test/java/com/matt/tarot/MemoryModelTest.kt
git commit -m "feat(android): emotional-seasons pure logic (detect shift/theme, parse, bucket, timeline json)"
```

---

### Task 2: MemoryStore.listMemories + EmotionalSeasons.kt pipeline

**Files:**
- Modify: `app/src/main/java/com/matt/tarot/MemoryStore.kt`
- Create: `app/src/main/java/com/matt/tarot/EmotionalSeasons.kt`

**Interfaces:**
- Consumes: Task 1 (`Season`, `Feeling`, `parseTimeline`, `serializeTimeline`, `detectSeasonShift`, `detectRecurringTheme`, `parseSeasonOutput`, `buildSeasonPrompt`, `bucketWindows`, `SEASON_SYSTEM`, constants); existing `MemoryStore.getMeta`/`setMeta`, `rowFrom`; the `CallLLM` typealias and `HAIKU` constant.
- Produces (used by Task 3): `MemoryStore.listMemories(slug): List<MemoryRow>`; class `EmotionalSeasons(store: MemoryStore)` with `updateSeasons(slug, callLLM): Int`, `backfillSeasons(slug, callLLM): Int`, `pendingSeasonShift(slug, now): SeasonShift?`, `markSeasonSurfaced(slug, shift, now)`, `recurringThemeFact(slug): String?`.

- [ ] **Step 1: Add listMemories to MemoryStore**

Add to `app/src/main/java/com/matt/tarot/MemoryStore.kt`, next to `getOpenAndSalient`:

```kotlin
    fun listMemories(slug: String): List<MemoryRow> {
        val out = ArrayList<MemoryRow>()
        readableDatabase.rawQuery(
            "SELECT * FROM memories WHERE reader_slug = ? ORDER BY created_at ASC", arrayOf(slug)
        ).use { c -> while (c.moveToNext()) out.add(rowFrom(c)) }
        return out
    }
```

- [ ] **Step 2: Create EmotionalSeasons.kt**

Create `app/src/main/java/com/matt/tarot/EmotionalSeasons.kt`:

```kotlin
package com.matt.tarot

import org.json.JSONObject

// Emotional seasons pipeline. Port of the impure half of data/emotional-seasons.js.
// Shares MemoryEngine's single MemoryStore so there is one SQLite connection.
// Best-effort: a DB/LLM failure never breaks a reading or a greeting. Time in unix SECONDS.
class EmotionalSeasons(private val store: MemoryStore) {

    private val seasonTtlS = 30L * 86400

    private fun listFeelings(slug: String): List<Feeling> =
        store.listMemories(slug)
            .filter { it.type == "feeling" }
            .map { Feeling(it.content, it.salience, it.createdAt) }
            .sortedBy { it.createdAt }

    private fun readTimeline(slug: String): List<Season> = parseTimeline(store.getMeta("seasons:$slug"))
    private fun writeTimeline(slug: String, seasons: List<Season>) =
        store.setMeta("seasons:$slug", serializeTimeline(seasons))

    // Best-effort, characterizes feelings newer than the last season into ONE new record.
    fun updateSeasons(slug: String, callLLM: CallLLM): Int {
        return try {
            val timeline = readTimeline(slug)
            val windowStart = if (timeline.isEmpty()) 0L else timeline.last().endedAt
            val feelings = listFeelings(slug).filter { it.createdAt > windowStart }
            if (feelings.size < MIN_FEELINGS_PER_SEASON) return 0
            val raw = callLLM(SEASON_SYSTEM, buildSeasonPrompt(feelings), 300, HAIKU)
            val parsed = parseSeasonOutput(raw) ?: return 0
            val season = Season(
                timeline.size, feelings.first().createdAt, feelings.last().createdAt,
                parsed.label, parsed.valence, parsed.themes, parsed.summary
            )
            writeTimeline(slug, timeline + season)
            1
        } catch (e: Exception) { 0 }
    }

    // One-time, idempotent. Lets a callLLM throw propagate so the flag is never set
    // and the next boot retries (same contract as memory backfill).
    fun backfillSeasons(slug: String, callLLM: CallLLM): Int {
        if (store.getMeta("seasons_backfilled:$slug") != null) return 0
        if (readTimeline(slug).isNotEmpty()) { store.setMeta("seasons_backfilled:$slug", "1"); return 0 }
        val windows = bucketWindows(listFeelings(slug), SEASON_WINDOW_DAYS)
        val timeline = ArrayList<Season>()
        for (w in windows) {
            if (w.size < MIN_FEELINGS_PER_SEASON) continue
            val raw = callLLM(SEASON_SYSTEM, buildSeasonPrompt(w), 300, HAIKU)
            val parsed = parseSeasonOutput(raw) ?: continue
            timeline.add(Season(
                timeline.size, w.first().createdAt, w.last().createdAt,
                parsed.label, parsed.valence, parsed.themes, parsed.summary
            ))
        }
        if (timeline.isNotEmpty()) writeTimeline(slug, timeline)
        store.setMeta("seasons_backfilled:$slug", "1")
        return timeline.size
    }

    // Read-only detect + 30-day TTL dedup. Caller commits via markSeasonSurfaced on success.
    fun pendingSeasonShift(slug: String, now: Long): SeasonShift? {
        val shift = detectSeasonShift(readTimeline(slug), now) ?: return null
        val last = readSurfaced(slug)[shift.signature]
        return if (last != null && (now - last) < seasonTtlS) null else shift
    }

    fun markSeasonSurfaced(slug: String, shift: SeasonShift, now: Long) {
        val surfaced = HashMap(readSurfaced(slug))
        surfaced.entries.removeAll { (now - it.value) >= seasonTtlS }
        surfaced[shift.signature] = now
        writeSurfaced(slug, surfaced)
    }

    fun recurringThemeFact(slug: String): String? = detectRecurringTheme(readTimeline(slug))?.fact

    private fun readSurfaced(slug: String): Map<String, Long> {
        val raw = store.getMeta("season_surfaced:$slug") ?: return emptyMap()
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
        store.setMeta("season_surfaced:$slug", o.toString())
    }
}
```

- [ ] **Step 3: Compile gate**

Run:
```
$env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
& "C:\Users\Matt\projects\TarotApp\gradlew.bat" -p "C:\Users\Matt\projects\TarotApp" assembleDebug
```
Expected: BUILD SUCCESSFUL.

- [ ] **Step 4: ASCII byte scan**

Run (git-bash):
```
cd /c/Users/Matt/projects/TarotApp && LC_ALL=C grep -nE '[^[:print:][:space:]]' app/src/main/java/com/matt/tarot/MemoryStore.kt app/src/main/java/com/matt/tarot/EmotionalSeasons.kt
```
Expected: no output.

- [ ] **Step 5: Commit**

```
cd /c/Users/Matt/projects/TarotApp
git add app/src/main/java/com/matt/tarot/MemoryStore.kt app/src/main/java/com/matt/tarot/EmotionalSeasons.kt
git commit -m "feat(android): emotional-seasons pipeline (EmotionalSeasons.kt) + MemoryStore.listMemories"
```

---

### Task 3: MemoryEngine delegation + threshold seasonShift wiring

**Files:**
- Modify: `app/src/main/java/com/matt/tarot/MemoryEngine.kt`

**Interfaces:**
- Consumes: Task 2 (`EmotionalSeasons`); Task 1 (`buildSeasonThemeBlock`); existing `store`, `decideThresholdMode`, `buildGreetingPrompt`, the `CallLLM` typealias.
- Produces (used by Task 4): `MemoryEngine.seasonsUpdate(slug, callLLM): Int`, `seasonsBackfill(slug, callLLM): Int`, `recurringThemeBlock(slug): String`.

- [ ] **Step 1: Add the seasons field**

In `MemoryEngine.kt`, right after `private val store = MemoryStore(context.applicationContext)`:

```kotlin
    private val seasons = EmotionalSeasons(store)
```

- [ ] **Step 2: Add the delegators**

Add these methods to the `MemoryEngine` class (next to the other public methods):

```kotlin
    fun seasonsUpdate(slug: String, callLLM: CallLLM): Int = seasons.updateSeasons(slug, callLLM)

    fun seasonsBackfill(slug: String, callLLM: CallLLM): Int = seasons.backfillSeasons(slug, callLLM)

    fun recurringThemeBlock(slug: String): String =
        seasons.recurringThemeFact(slug)?.let { buildSeasonThemeBlock(it) } ?: ""
```

- [ ] **Step 3: Wire seasonShift into threshold()**

In `threshold()`, make three edits.

(a) After `val lastVisit = store.getMeta("last_visit:$slug")?.toLongOrNull()`, add:
```kotlin
        val seasonShift = seasons.pendingSeasonShift(slug, now)
```

(b) Change the `decideThresholdMode` call from passing `null` to `seasonShift`:
```kotlin
        val mode = decideThresholdMode(lastVisit, freshThreads, now, REUNION_GAP_DAYS, predictions, dormant, seasonShift)
```

(c) Change the `buildGreetingPrompt` call's final argument from `null` to `seasonShift`:
```kotlin
        val prompt = buildGreetingPrompt(mode, shownThreads, gapDays, shownPredictions, timeOfDay, shownDormant, seasonShift)
```

(d) In the success path, after `store.setMeta("last_visit:$slug", now.toString())` (the line just before the final `return ThresholdResult(mode, greeting, shown.map { it.id })`), add:
```kotlin
        if (seasonShift != null) seasons.markSeasonSurfaced(slug, seasonShift, now)
```

(The `mode == "none"` early-return path is unchanged: if there were a shift, `mode` would not be `"none"`, so no surfaced-commit is needed there.)

- [ ] **Step 4: Compile gate**

Run:
```
$env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
& "C:\Users\Matt\projects\TarotApp\gradlew.bat" -p "C:\Users\Matt\projects\TarotApp" assembleDebug
```
Expected: BUILD SUCCESSFUL.

- [ ] **Step 5: ASCII byte scan**

Run (git-bash):
```
cd /c/Users/Matt/projects/TarotApp && LC_ALL=C grep -nE '[^[:print:][:space:]]' app/src/main/java/com/matt/tarot/MemoryEngine.kt
```
Expected: no output.

- [ ] **Step 6: Commit**

```
cd /c/Users/Matt/projects/TarotApp
git add app/src/main/java/com/matt/tarot/MemoryEngine.kt
git commit -m "feat(android): wire season shift into threshold greeting + season delegators"
```

---

### Task 4: TarotServer wiring + version bump

**Files:**
- Modify: `app/src/main/java/com/matt/tarot/TarotServer.kt`
- Modify: `app/build.gradle`

**Interfaces:**
- Consumes: Task 3 (`memory.recurringThemeBlock`, `memory.seasonsUpdate`, `memory.seasonsBackfill`); Task 1 (`SEASON_CADENCE`); existing `memoryCallLLM`, `loadReadingList`, the capture-Thread pattern, `Log`, `TAG`.
- Produces: season backfill on first launch; season update every 8th reading; the recurring-theme block in the interpret persona.

- [ ] **Step 1: Append the recurring-theme block in handleInterpret**

Find this line in `handleInterpret`:
```kotlin
        val systemPrompt = READER_PERSONA + buildAddressingNote(readerName) + memoryBlock + buildPatternBlock(slug, cards)
```
Replace it with (insert `memory.recurringThemeBlock(slug)` before the pattern block):
```kotlin
        val systemPrompt = READER_PERSONA + buildAddressingNote(readerName) + memoryBlock + memory.recurringThemeBlock(slug) + buildPatternBlock(slug, cards)
```

- [ ] **Step 2: Run season backfill in ensureBackfill**

In `ensureBackfill()`, find:
```kotlin
                    memory.backfill(rslug, loadReadingList(rslug), ::memoryCallLLM)
```
Add immediately after it (same loop body, runs after memory backfill so feeling atoms exist):
```kotlin
                    memory.seasonsBackfill(rslug, ::memoryCallLLM)
```

- [ ] **Step 3: Fire the cadence-gated season update in handleSaveReading**

In `handleSaveReading`, find the fire-and-forget capture Thread:
```kotlin
        Thread {
            try { memory.captureFromReading(slug, body, ::memoryCallLLM) }
            catch (e: Exception) { Log.w(TAG, "memory capture failed: ${e.message}") }
        }.start()
        return jsonResponse(JSONObject().put("ok", true))
```
Insert the season-update gate between the capture Thread and the `return`:
```kotlin
        Thread {
            try { memory.captureFromReading(slug, body, ::memoryCallLLM) }
            catch (e: Exception) { Log.w(TAG, "memory capture failed: ${e.message}") }
        }.start()
        val readingCount = trimmed.length()
        if (readingCount % SEASON_CADENCE == 0) {
            Thread {
                try { memory.seasonsUpdate(slug, ::memoryCallLLM) }
                catch (e: Exception) { Log.w(TAG, "season update failed: ${e.message}") }
            }.start()
        }
        return jsonResponse(JSONObject().put("ok", true))
```

- [ ] **Step 4: Bump the app version**

In `app/build.gradle`, change:
```
        versionCode 4
        versionName "1.4"
```
to:
```
        versionCode 5
        versionName "1.5"
```

- [ ] **Step 5: Compile gate**

Run:
```
$env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
& "C:\Users\Matt\projects\TarotApp\gradlew.bat" -p "C:\Users\Matt\projects\TarotApp" assembleDebug
```
Expected: BUILD SUCCESSFUL; APK at `app/build/outputs/apk/debug/app-debug.apk`.

- [ ] **Step 6: ASCII byte scan (added lines only)**

Run (git-bash):
```
cd /c/Users/Matt/projects/TarotApp && git diff --staged -U0 app/src/main/java/com/matt/tarot/TarotServer.kt | grep '^+' | LC_ALL=C grep -nE '[^[:print:][:space:]]'
```
(Stage first if needed.) Expected: no output for the ADDED lines. (TarotServer.kt has pre-existing non-ASCII - persona em dash, box-drawing dividers - which is out of scope.)

- [ ] **Step 7: Commit**

```
cd /c/Users/Matt/projects/TarotApp
git add app/src/main/java/com/matt/tarot/TarotServer.kt app/build.gradle
git commit -m "feat(android): wire season backfill + update cadence + recurring-theme block; bump to 1.5 (versionCode 5)"
```

---

## On-device smoke (HUMAN gate, after the branch review, before merge)

The SQLite + LLM path is not JVM-testable. Sideload `app-debug.apk` (v1.5, install -r to preserve data), then:

1. **Backfill runs clean:** launch the app; confirm logcat has no season errors and `memory_meta` has `seasons_backfilled:<slug>` set (pull memory.db). Given the live device has few feelings over a short span, the timeline may have 0-1 seasons - that is expected.
2. **Shift -> greeting (seeded):** the device cannot form >= 2 contrasting seasons naturally, so seed a synthetic 2-season timeline into `seasons:<slug>` (a heavy season then a light season, sharing a theme; e.g. via run-as writing memory_meta, or by POSTing readings until feelings accrue is impractical). Then open the app and confirm the reunion greeting voices the season shift ("about N months ago you were in X, now you are in Y").
3. **Theme -> reading (seeded):** with the same seeded timeline (shared theme across both seasons), run a reading and confirm the recurring-theme line reaches the persona (a season-aware line in the interpretation, or the logged system prompt contains the theme block).
4. **Dedup:** open the app again immediately; confirm the same shift does not re-voice (the `season_surfaced` TTL suppresses it).

---

## Self-review notes (for the controller)

- Spec coverage: Task 1 = pure logic + tests; Task 2 = store query + pipeline; Task 3 = engine delegation + threshold wiring; Task 4 = server wiring + version bump. All spec sections covered.
- One SQLite connection preserved: EmotionalSeasons takes MemoryEngine's existing `store` (Task 3 Step 1).
- The greeting now fires on a season shift alone (no threads needed) because `seasonShift` flows into `decideThresholdMode` - intended, faithful to web `hasMaterial`.
- `season_surfaced` is committed only on greeting success (Task 3 Step 3d), not on the LLM-failure or none paths.
