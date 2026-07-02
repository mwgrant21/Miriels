# Android Memory Substrate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the Android Tarot app a persistent memory substrate: SQLite atom store + capture-from-reading (Haiku) + deterministic recall woven into `/api/interpret`, plus one-time backfill.

**Architecture:** Three new Kotlin files in `com.matt.tarot` — `MemoryModel.kt` (pure logic: types, recall scorer, JSON parser, prompt builders; NO `android.*` imports so it JVM-unit-tests), `MemoryStore.kt` (`SQLiteOpenHelper` over `memory.db`), `MemoryEngine.kt` (recall/capture/backfill orchestration) — plus wiring in `TarotServer.kt`. A faithful port of the web app's `data/memory-store.js` + `data/memory-engine.js` (substrate subset).

**Tech Stack:** Kotlin, Android `SQLiteOpenHelper`, org.json, OkHttp (existing `callClaude`), JUnit4 (`gradlew testDebugUnitTest`).

## Global Constraints

- **Time is unix SECONDS** in all memory code (`System.currentTimeMillis() / 1000`). NOT milliseconds (only `CardPatterns` uses ms).
- **ASCII only** in every string (the codebase rule; verify with a `charCodeAt>127` scan if unsure, NOT a curly-quote regex).
- **No new dependencies.** `SQLiteOpenHelper` (no Room, no annotation processor). Reuse `callClaude`.
- **`MemoryModel.kt` has NO `android.*` / `android.database.*` imports** — only `org.json.*` and stdlib. This is what keeps it JVM-unit-testable.
- **Extractor model:** `HAIKU = "claude-haiku-4-5-20251001"`.
- **Recall:** `RECALL_LIMIT = 10`; `scoreMemory = 3.0*overlap + 1.5*sal + 1.5*statusW + 0.5*fresh - 0.4*over` where `statusW` = 1.0 open / 0.6 moving / 0.0 else, `sal = clampSalience(salience)/5.0`, `over = min(1, refCount/5)`. Copy verbatim.
- **`applyOps` implements ADD / UPDATE / TOUCH only** this slice. `RESOLVE` is deferred (no branch). Schema still creates `asked_at`, `memory_links`, `memory_meta` so later slices need no migration.
- **`memoryBlock` is prepended BEFORE `patternBlock`** in the interpret persona: `READER_PERSONA + addressingNote + memoryBlock + patternBlock`.
- **Backfill** is triggered lazily on the first `/api/interpret` of the process (guarded by an `AtomicBoolean`), on a background thread, looping `loadReaders()`. It lets `callLLM` throw propagate (flag stays unset to retry); the caller thread catches.
- **Capture** runs fire-and-forget on a background `Thread` after a reading saves; never blocks the response.
- **Build/test commands** (PowerShell, set JBR each run):
  - Unit tests: `$env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"; & "C:\Users\Matt\projects\TarotApp\gradlew.bat" -p "C:\Users\Matt\projects\TarotApp" testDebugUnitTest`
  - Compile gate: same with `assembleDebug`.
- **Existing 15 `CardPatternsTest` cases must stay green.**

---

### Task 1: Pure memory core (`MemoryModel.kt`) + unit tests

**Files:**
- Create: `app/src/main/java/com/matt/tarot/MemoryModel.kt`
- Test: `app/src/test/java/com/matt/tarot/MemoryModelTest.kt`

**Interfaces:**
- Produces (consumed by Tasks 2-4):
  - `data class MemoryRow(id: Long, readerSlug: String, type: String, content: String, status: String?, salience: Int, subject: String?, sourceKind: String, sourceId: String?, createdAt: Long, updatedAt: Long, lastReferencedAt: Long?, referenceCount: Int, askedAt: Long?)`
  - `data class Op(op: String, type: String?=null, content: String?=null, status: String?=null, salience: Int?=null, subject: String?=null, id: Long?=null, verdict: String?=null, outcome: String?=null)`
  - `data class ApplyResult(var added: Int=0, var updated: Int=0, var touched: Int=0, var resolved: Int=0, var deferred: Int=0)`
  - `val MEMORY_TYPES: Set<String>`, `val MEMORY_STATUSES: Set<String>`, `fun clampSalience(n: Int?): Int`
  - `fun tokenize(s: String?): List<String>`, `fun keywordOverlap(q: Set<String>, m: List<String>): Double`, `fun freshness(lastRef: Long?, now: Long): Double`, `fun scoreMemory(m: MemoryRow, q: Set<String>, now: Long): Double`, `fun scoreCandidates(c: List<MemoryRow>, question: String?, cards: List<String>, now: Long): List<Scored>`, `data class Scored(memory: MemoryRow, score: Double)`
  - `fun parseExtractorOutput(raw: String?): List<Op>`, `fun formatRecallBlock(memories: List<MemoryRow>): String`
  - `fun summarizeReading(r: JSONObject): String`, `fun buildCapturePrompt(r: JSONObject, existing: List<MemoryRow>): String`, `fun buildBackfillPrompt(rs: List<JSONObject>): String`
  - consts `HAIKU`, `RECALL_LIMIT`, `BACKFILL_CHUNK`, `EXTRACT_SYSTEM`, `BACKFILL_SYSTEM`

- [ ] **Step 1: Write the failing tests**

Create `app/src/test/java/com/matt/tarot/MemoryModelTest.kt`:

```kotlin
package com.matt.tarot

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class MemoryModelTest {
    private val NOW = 1_000_000_000L // arbitrary fixed unix-seconds

    private fun row(
        id: Long, content: String, status: String? = "open", salience: Int = 3,
        subject: String? = null, lastRef: Long? = null, refCount: Int = 0
    ) = MemoryRow(
        id = id, readerSlug = "matt", type = "thread", content = content, status = status,
        salience = salience, subject = subject, sourceKind = "reading", sourceId = null,
        createdAt = NOW, updatedAt = NOW, lastReferencedAt = lastRef, referenceCount = refCount, askedAt = null
    )

    @Test fun tokenize_drops_stopwords_and_short_words() {
        val t = tokenize("The move to Portland is on my mind")
        assertTrue(t.contains("move"))
        assertTrue(t.contains("portland"))
        assertTrue(!t.contains("the"))   // stopword
        assertTrue(!t.contains("to"))    // stopword
        assertTrue(!t.contains("on"))    // stopword
        assertTrue(!t.contains("is"))    // stopword
    }

    @Test fun keywordOverlap_caps_at_one_with_three_hits() {
        val q = setOf("move", "portland", "job", "sister")
        assertEquals(0.0, keywordOverlap(q, tokenize("nothing relevant here words")), 1e-9)
        assertEquals(1.0 / 3, keywordOverlap(q, tokenize("the move")), 1e-9)
        assertEquals(1.0, keywordOverlap(q, tokenize("move portland job sister extra")), 1e-9)
    }

    @Test fun freshness_full_when_never_referenced_then_ramps_over_30_days() {
        assertEquals(1.0, freshness(null, NOW), 1e-9)
        assertEquals(0.0, freshness(NOW, NOW), 1e-9)
        assertEquals(0.5, freshness(NOW - 15 * 86400, NOW), 1e-9)
        assertEquals(1.0, freshness(NOW - 60 * 86400, NOW), 1e-9)
    }

    @Test fun scoreMemory_relevance_outweighs_salience() {
        val q = setOf("portland", "move")
        val onTopicLowSal = scoreMemory(row(1, "the Portland move", salience = 1), q, NOW)
        val offTopicHighSal = scoreMemory(row(2, "her garden in spring", salience = 5), q, NOW)
        assertTrue("on-topic must outrank off-topic high-salience", onTopicLowSal > offTopicHighSal)
    }

    @Test fun scoreMemory_open_ontopic_outranks_resolved_offtopic() {
        val q = setOf("portland")
        val openOnTopic = scoreMemory(row(1, "Portland decision", status = "open"), q, NOW)
        val resolvedOffTopic = scoreMemory(row(2, "old job thing", status = "resolved"), q, NOW)
        assertTrue(openOnTopic > resolvedOffTopic)
    }

    @Test fun scoreCandidates_sorts_descending_and_keeps_all() {
        val q = "should I move to Portland"
        val out = scoreCandidates(
            listOf(row(1, "garden plants"), row(2, "the Portland move decision")),
            q, emptyList(), NOW
        )
        assertEquals(2, out.size)
        assertEquals(2L, out[0].memory.id) // the Portland one scores higher
    }

    @Test fun parse_bare_array() {
        val ops = parseExtractorOutput("""[{"op":"ADD","type":"thread","content":"x"}]""")
        assertEquals(1, ops.size)
        assertEquals("ADD", ops[0].op)
        assertEquals("thread", ops[0].type)
    }

    @Test fun parse_operations_object_with_leading_prose() {
        val ops = parseExtractorOutput("""Sure, here you go: {"operations":[{"op":"TOUCH","id":7}]} done""")
        assertEquals(1, ops.size)
        assertEquals("TOUCH", ops[0].op)
        assertEquals(7L, ops[0].id)
    }

    @Test fun parse_malformed_returns_empty() {
        assertEquals(0, parseExtractorOutput("not json at all").size)
        assertEquals(0, parseExtractorOutput("").size)
        assertEquals(0, parseExtractorOutput(null).size)
        assertEquals(0, parseExtractorOutput("""{"operations": broken}""").size)
    }

    @Test fun formatRecallBlock_empty_is_blank_else_bulleted() {
        assertEquals("", formatRecallBlock(emptyList()))
        val block = formatRecallBlock(listOf(row(1, "the Portland move")))
        assertTrue(block.contains("- the Portland move"))
        assertTrue(block.contains("What you know about this person"))
    }

    @Test fun clampSalience_bounds() {
        assertEquals(3, clampSalience(null))
        assertEquals(1, clampSalience(0))
        assertEquals(1, clampSalience(-4))
        assertEquals(5, clampSalience(9))
        assertEquals(4, clampSalience(4))
    }
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `... testDebugUnitTest`
Expected: FAIL — `MemoryModel` symbols unresolved (compile error / unresolved reference).

- [ ] **Step 3: Implement `MemoryModel.kt`**

Create `app/src/main/java/com/matt/tarot/MemoryModel.kt`:

```kotlin
package com.matt.tarot

import org.json.JSONArray
import org.json.JSONObject

// Pure memory logic: NO android.* imports, so it unit-tests on the JVM.
// Faithful port of data/memory-store.js + data/memory-engine.js (substrate subset).

val MEMORY_TYPES: Set<String> = setOf("person", "thread", "event", "feeling", "prediction", "fact", "preference")
val MEMORY_STATUSES: Set<String> = setOf("open", "moving", "resolved", "dormant")

const val HAIKU = "claude-haiku-4-5-20251001"
const val RECALL_LIMIT = 10
const val BACKFILL_CHUNK = 12

fun clampSalience(n: Int?): Int {
    val v = n ?: 3
    return minOf(5, maxOf(1, v))
}

data class MemoryRow(
    val id: Long,
    val readerSlug: String,
    val type: String,
    val content: String,
    val status: String?,
    val salience: Int,
    val subject: String?,
    val sourceKind: String,
    val sourceId: String?,
    val createdAt: Long,
    val updatedAt: Long,
    val lastReferencedAt: Long?,
    val referenceCount: Int,
    val askedAt: Long?
)

data class Op(
    val op: String,
    val type: String? = null,
    val content: String? = null,
    val status: String? = null,
    val salience: Int? = null,
    val subject: String? = null,
    val id: Long? = null,
    val verdict: String? = null,
    val outcome: String? = null
)

data class ApplyResult(
    var added: Int = 0,
    var updated: Int = 0,
    var touched: Int = 0,
    var resolved: Int = 0,
    var deferred: Int = 0
)

private val STOPWORDS: Set<String> = (
    "the a an and or but if then of to in on for with about into your you i me my we our it its this that " +
    "these those is are was were be been being do does did so as at by from will would can could should " +
    "what when where who how"
).split(" ").toSet()

fun tokenize(s: String?): List<String> =
    (s ?: "").lowercase()
        .replace(Regex("[^a-z0-9\\s]"), " ")
        .split(Regex("\\s+"))
        .filter { it.length > 2 && it !in STOPWORDS }

fun keywordOverlap(queryTokens: Set<String>, memTokens: List<String>): Double {
    if (queryTokens.isEmpty() || memTokens.isEmpty()) return 0.0
    val seen = HashSet<String>()
    var hits = 0
    for (w in memTokens) if (w in queryTokens && seen.add(w)) hits++
    return minOf(1.0, hits / 3.0) // 3+ shared salient words = full marks
}

// Higher when NOT surfaced recently; never-referenced scores a full 1.
fun freshness(lastRef: Long?, now: Long): Double {
    if (lastRef == null || lastRef == 0L) return 1.0
    val days = (now - lastRef) / 86400.0
    return minOf(1.0, days / 30.0)
}

fun scoreMemory(m: MemoryRow, queryTokens: Set<String>, now: Long): Double {
    val statusW = when (m.status) { "open" -> 1.0; "moving" -> 0.6; else -> 0.0 }
    val sal = clampSalience(m.salience) / 5.0
    val overlap = keywordOverlap(queryTokens, tokenize("${m.content} ${m.subject ?: ""}"))
    val fresh = freshness(m.lastReferencedAt, now)
    val over = minOf(1.0, m.referenceCount / 5.0)
    return 3.0 * overlap + 1.5 * sal + 1.5 * statusW + 0.5 * fresh - 0.4 * over
}

data class Scored(val memory: MemoryRow, val score: Double)

fun scoreCandidates(candidates: List<MemoryRow>, question: String?, cards: List<String>, now: Long): List<Scored> {
    val cardNames = cards.joinToString(" ")
    val queryTokens = tokenize("${question ?: ""} $cardNames").toSet()
    return candidates.map { Scored(it, scoreMemory(it, queryTokens, now)) }
        .sortedByDescending { it.score }
}

fun formatRecallBlock(memories: List<MemoryRow>): String {
    if (memories.isEmpty()) return ""
    val lines = memories.joinToString("\n") { "- ${it.content}" }
    return "\n\nWhat you know about this person that may bear on what's in front of them now. " +
        "Draw on whatever genuinely connects to their question or these cards, and when you do, " +
        "name it specifically (the actual moment or thread), not a vague gesture. Don't force in " +
        "memories that don't fit; say nothing rather than reach:\n$lines"
}

private fun jsonObjToOp(o: JSONObject): Op = Op(
    op = o.optString("op", ""),
    type = o.optString("type").ifEmpty { null },
    content = if (o.has("content") && !o.isNull("content")) o.optString("content") else null,
    status = o.optString("status").ifEmpty { null },
    salience = if (o.has("salience") && !o.isNull("salience")) o.optInt("salience") else null,
    subject = if (o.has("subject") && !o.isNull("subject")) o.optString("subject") else null,
    id = if (o.has("id") && !o.isNull("id")) o.optLong("id") else null,
    verdict = o.optString("verdict").ifEmpty { null },
    outcome = o.optString("outcome").ifEmpty { null }
)

// Tolerant: locate the first { or [, slice to its matching close, accept a bare
// array or an {"operations":[...]} object; any failure -> empty list.
fun parseExtractorOutput(raw: String?): List<Op> {
    if (raw.isNullOrEmpty()) return emptyList()
    val objStart = raw.indexOf('{')
    val arrStart = raw.indexOf('[')
    return try {
        val arr: JSONArray = when {
            objStart != -1 && (arrStart == -1 || objStart < arrStart) -> {
                val obj = JSONObject(raw.substring(objStart, raw.lastIndexOf('}') + 1))
                obj.optJSONArray("operations") ?: return emptyList()
            }
            arrStart != -1 -> JSONArray(raw.substring(arrStart, raw.lastIndexOf(']') + 1))
            else -> return emptyList()
        }
        (0 until arr.length()).mapNotNull { i -> arr.optJSONObject(i)?.let { jsonObjToOp(it) } }
    } catch (e: Exception) {
        emptyList()
    }
}

const val EXTRACT_SYSTEM =
    "You are the memory keeper for a tarot reader named Miriel. From a reading you extract durable, " +
    "specific things worth remembering about the querent and their life, so Miriel can recall them in " +
    "future readings. Be conservative: record only what is explicitly present in the question or in what " +
    "Miriel observed. Never invent names, dates, or events. When unsure, leave it out."

const val BACKFILL_SYSTEM =
    "You are the memory keeper for a tarot reader named Miriel. You are reviewing a batch of past " +
    "readings to seed her memory of this querent. Extract durable, specific things worth remembering. " +
    "Be conservative: only what is explicitly present. Never invent names, dates, or events."

fun summarizeReading(reading: JSONObject): String {
    val cardsArr = reading.optJSONArray("cards")
    val cards = if (cardsArr == null) "" else (0 until cardsArr.length()).joinToString(", ") { i ->
        val c = cardsArr.optJSONObject(i) ?: JSONObject()
        val pos = c.optString("position").let { if (it.isNotEmpty()) "$it: " else "" }
        pos + c.optString("name") + if (c.optBoolean("isReversed")) " (reversed)" else ""
    }
    val syn = reading.optString("synopsis").let { if (it.length > 1200) it.substring(0, 1200) else it }
    val q = reading.optString("question").let { if (it.isNotEmpty()) "\"$it\"" else "none" }
    return "Date: ${reading.optString("date").ifEmpty { "unknown" }}\n" +
        "Spread: ${reading.optString("spread").ifEmpty { "unknown" }}\n" +
        "Question: $q\n" +
        "Cards: $cards\n" +
        "What Miriel said: $syn"
}

fun buildCapturePrompt(reading: JSONObject, existing: List<MemoryRow>): String {
    val existingBlock = if (existing.isEmpty()) "(none yet)"
        else existing.joinToString("\n") { "#${it.id} [${it.type}/${it.status ?: "-"}] ${it.content}" }
    return "READING:\n${summarizeReading(reading)}\n\n" +
        "WHAT MIRIEL ALREADY REMEMBERS ABOUT THIS PERSON:\n$existingBlock\n\n" +
        "Decide what, if anything, to remember from this reading. Respond with ONLY a JSON object of this exact shape and nothing else:\n\n" +
        "{\"operations\":[\n" +
        "  {\"op\":\"ADD\",\"type\":\"thread\",\"content\":\"one specific sentence\",\"status\":\"open\",\"salience\":4,\"subject\":\"optional short tag\"},\n" +
        "  {\"op\":\"UPDATE\",\"id\":12,\"status\":\"moving\"},\n" +
        "  {\"op\":\"TOUCH\",\"id\":7}\n" +
        "]}\n\n" +
        "Rules:\n" +
        "- ADD a NEW memory only for something not already listed above. type is one of: person, thread, event, feeling, prediction, fact, preference. status (open|moving|resolved|dormant) applies to threads and predictions; omit it otherwise. salience is 1-5 (5 = central to their life). content is one specific sentence.\n" +
        "- UPDATE an existing memory by its #id when this reading adds detail or changes its status.\n" +
        "- TOUCH an existing memory by its #id when it simply came up again with nothing new.\n" +
        "- A PREDICTION is special: when Miriel's own words contain a specific, checkable foretelling about the future, ADD it as type \"prediction\", status \"open\", salience 3 or higher, with content phrased as the claim itself so it reads back cleanly later. Vague encouragement is NOT a prediction, leave it out.\n" +
        "- If there is genuinely nothing worth remembering, return {\"operations\":[]}.\n" +
        "- Record only what is explicitly present. Do not invent."
}

fun buildBackfillPrompt(readings: List<JSONObject>): String {
    val block = readings.mapIndexed { i, r -> "--- Reading ${i + 1} ---\n${summarizeReading(r)}" }.joinToString("\n\n")
    return "PAST READINGS:\n$block\n\n" +
        "Extract what is worth remembering about this person. Respond with ONLY a JSON object:\n\n" +
        "{\"operations\":[\n" +
        "  {\"op\":\"ADD\",\"type\":\"thread\",\"content\":\"one specific sentence\",\"status\":\"open\",\"salience\":3,\"subject\":\"optional tag\"}\n" +
        "]}\n\n" +
        "Rules:\n" +
        "- Only ADD operations. type is one of: person, thread, event, feeling, prediction, fact, preference. status (open|moving|resolved|dormant) for threads and predictions only. salience 1-5. content is one specific sentence.\n" +
        "- Merge duplicates across readings into a single memory.\n" +
        "- Record only what is explicitly present. Do not invent. If nothing, return {\"operations\":[]}."
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `... testDebugUnitTest`
Expected: PASS — all `MemoryModelTest` cases plus the existing 15 `CardPatternsTest` cases. Confirm count in `app/build/test-results/testDebugUnitTest/TEST-com.matt.tarot.MemoryModelTest.xml` (`failures="0"`).

- [ ] **Step 5: Verify ASCII-clean**

Run (Bash): `node -e 'const s=require("fs").readFileSync("C:/Users/Matt/projects/TarotApp/app/src/main/java/com/matt/tarot/MemoryModel.kt","utf8");let n=0;for(const c of s)if(c.codePointAt(0)>127)n++;console.log("non-ascii:",n)'`
Expected: `non-ascii: 0`

- [ ] **Step 6: Commit**

```bash
cd /c/Users/Matt/projects/TarotApp && git add app/src/main/java/com/matt/tarot/MemoryModel.kt app/src/test/java/com/matt/tarot/MemoryModelTest.kt && git commit -m "feat(android): pure memory core (scoring, parsing, prompts) + unit tests

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: SQLite atom store (`MemoryStore.kt`)

**Files:**
- Create: `app/src/main/java/com/matt/tarot/MemoryStore.kt`

**Interfaces:**
- Consumes (from Task 1): `MemoryRow`, `Op`, `ApplyResult`, `MEMORY_TYPES`, `MEMORY_STATUSES`, `clampSalience`.
- Produces (consumed by Task 3): class `MemoryStore(context: Context)` with:
  - `addMemory(slug: String, type: String, content: String, status: String?, salience: Int?, subject: String?, sourceKind: String, sourceId: String?): Long`
  - `getMemory(id: Long): MemoryRow?`
  - `applyOps(slug: String, ops: List<Op>, sourceKind: String, sourceId: String?): ApplyResult`
  - `getOpenAndSalient(slug: String, limit: Int): List<MemoryRow>`
  - `markReferenced(ids: List<Long>)`
  - `getMeta(key: String): String?`, `setMeta(key: String, value: String)`

**Note:** Not JVM-unit-testable (Android SQLite). Verification is the compile gate (`assembleDebug`) plus review against `data/memory-store.js`. On-device behavior is validated in Task 4's smoke checklist.

- [ ] **Step 1: Implement `MemoryStore.kt`**

Create `app/src/main/java/com/matt/tarot/MemoryStore.kt`:

```kotlin
package com.matt.tarot

import android.content.ContentValues
import android.content.Context
import android.database.Cursor
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper

// SQLite atom store on memory.db (app databases dir; app-private, survives upgrades).
// Faithful port of data/memory-store.js (substrate subset). Time in unix SECONDS.
class MemoryStore(context: Context) : SQLiteOpenHelper(context.applicationContext, "memory.db", null, 1) {

    override fun onCreate(db: SQLiteDatabase) {
        db.execSQL(
            """
            CREATE TABLE memories (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              reader_slug TEXT NOT NULL,
              type TEXT NOT NULL,
              content TEXT NOT NULL,
              status TEXT,
              salience INTEGER NOT NULL DEFAULT 3,
              subject TEXT,
              source_kind TEXT NOT NULL,
              source_id TEXT,
              created_at INTEGER NOT NULL,
              updated_at INTEGER NOT NULL,
              last_referenced_at INTEGER,
              reference_count INTEGER NOT NULL DEFAULT 0,
              asked_at INTEGER
            )
            """.trimIndent()
        )
        db.execSQL("CREATE INDEX idx_mem_slug ON memories(reader_slug)")
        db.execSQL("CREATE INDEX idx_mem_slug_type ON memories(reader_slug, type)")
        db.execSQL("CREATE INDEX idx_mem_slug_status ON memories(reader_slug, status)")
        db.execSQL("CREATE INDEX idx_mem_slug_sal ON memories(reader_slug, salience)")
        db.execSQL(
            """
            CREATE TABLE memory_links (
              from_id INTEGER NOT NULL, to_id INTEGER NOT NULL, relation TEXT NOT NULL,
              PRIMARY KEY (from_id, to_id, relation)
            )
            """.trimIndent()
        )
        db.execSQL("CREATE TABLE memory_meta (key TEXT PRIMARY KEY, value TEXT)")
    }

    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) { /* v1 only */ }

    private fun nowSec(): Long = System.currentTimeMillis() / 1000

    private fun Cursor.strOrNull(name: String): String? {
        val i = getColumnIndexOrThrow(name); return if (isNull(i)) null else getString(i)
    }
    private fun Cursor.longOrNull(name: String): Long? {
        val i = getColumnIndexOrThrow(name); return if (isNull(i)) null else getLong(i)
    }

    private fun rowFrom(c: Cursor) = MemoryRow(
        id = c.getLong(c.getColumnIndexOrThrow("id")),
        readerSlug = c.getString(c.getColumnIndexOrThrow("reader_slug")),
        type = c.getString(c.getColumnIndexOrThrow("type")),
        content = c.getString(c.getColumnIndexOrThrow("content")),
        status = c.strOrNull("status"),
        salience = c.getInt(c.getColumnIndexOrThrow("salience")),
        subject = c.strOrNull("subject"),
        sourceKind = c.getString(c.getColumnIndexOrThrow("source_kind")),
        sourceId = c.strOrNull("source_id"),
        createdAt = c.getLong(c.getColumnIndexOrThrow("created_at")),
        updatedAt = c.getLong(c.getColumnIndexOrThrow("updated_at")),
        lastReferencedAt = c.longOrNull("last_referenced_at"),
        referenceCount = c.getInt(c.getColumnIndexOrThrow("reference_count")),
        askedAt = c.longOrNull("asked_at")
    )

    fun addMemory(
        slug: String, type: String, content: String, status: String?, salience: Int?,
        subject: String?, sourceKind: String, sourceId: String?
    ): Long {
        val t = nowSec()
        val cv = ContentValues().apply {
            put("reader_slug", slug); put("type", type); put("content", content)
            if (status != null) put("status", status) else putNull("status")
            put("salience", clampSalience(salience))
            if (subject != null) put("subject", subject) else putNull("subject")
            put("source_kind", sourceKind)
            if (sourceId != null) put("source_id", sourceId) else putNull("source_id")
            put("created_at", t); put("updated_at", t)
        }
        return writableDatabase.insert("memories", null, cv)
    }

    fun getMemory(id: Long): MemoryRow? {
        readableDatabase.rawQuery("SELECT * FROM memories WHERE id = ?", arrayOf(id.toString())).use { c ->
            return if (c.moveToFirst()) rowFrom(c) else null
        }
    }

    private fun getForSlug(id: Long, slug: String): MemoryRow? {
        readableDatabase.rawQuery(
            "SELECT * FROM memories WHERE id = ? AND reader_slug = ?", arrayOf(id.toString(), slug)
        ).use { c -> return if (c.moveToFirst()) rowFrom(c) else null }
    }

    // ADD / UPDATE / TOUCH only this slice. RESOLVE is deferred to the outcome-loop slice.
    fun applyOps(slug: String, ops: List<Op>, sourceKind: String, sourceId: String?): ApplyResult {
        val result = ApplyResult()
        val t = nowSec()
        val db = writableDatabase
        for (op in ops) {
            when (op.op.uppercase()) {
                "ADD" -> {
                    val type = op.type ?: continue
                    if (type !in MEMORY_TYPES) continue
                    val content = op.content?.trim().orEmpty()
                    if (content.isEmpty()) continue
                    addMemory(
                        slug, type, content,
                        if (op.status != null && op.status in MEMORY_STATUSES) op.status else null,
                        op.salience, op.subject, sourceKind, sourceId
                    )
                    result.added++
                }
                "UPDATE" -> {
                    val id = op.id ?: continue
                    if (getForSlug(id, slug) == null) continue
                    val cv = ContentValues().apply {
                        val c = op.content?.trim()
                        if (!c.isNullOrEmpty()) put("content", c)
                        if (op.status != null && op.status in MEMORY_STATUSES) put("status", op.status)
                        if (op.salience != null) put("salience", clampSalience(op.salience))
                        if (op.subject != null) put("subject", op.subject)
                        put("updated_at", t)
                    }
                    db.update("memories", cv, "id = ? AND reader_slug = ?", arrayOf(id.toString(), slug))
                    result.updated++
                }
                "TOUCH" -> {
                    val id = op.id ?: continue
                    val stmt = db.compileStatement(
                        "UPDATE memories SET reference_count = reference_count + 1, updated_at = ? WHERE id = ? AND reader_slug = ?"
                    )
                    stmt.bindLong(1, t); stmt.bindLong(2, id); stmt.bindString(3, slug)
                    if (stmt.executeUpdateDelete() > 0) result.touched++
                }
            }
        }
        return result
    }

    fun getOpenAndSalient(slug: String, limit: Int): List<MemoryRow> {
        val out = ArrayList<MemoryRow>()
        readableDatabase.rawQuery(
            "SELECT * FROM memories WHERE reader_slug = ? ORDER BY (status = 'open') DESC, salience DESC, updated_at DESC LIMIT ?",
            arrayOf(slug, limit.toString())
        ).use { c -> while (c.moveToNext()) out.add(rowFrom(c)) }
        return out
    }

    fun markReferenced(ids: List<Long>) {
        if (ids.isEmpty()) return
        val t = nowSec()
        val db = writableDatabase
        db.beginTransaction()
        try {
            val stmt = db.compileStatement(
                "UPDATE memories SET reference_count = reference_count + 1, last_referenced_at = ? WHERE id = ?"
            )
            for (id in ids) { stmt.clearBindings(); stmt.bindLong(1, t); stmt.bindLong(2, id); stmt.executeUpdateDelete() }
            db.setTransactionSuccessful()
        } finally { db.endTransaction() }
    }

    fun getMeta(key: String): String? {
        readableDatabase.rawQuery("SELECT value FROM memory_meta WHERE key = ?", arrayOf(key)).use { c ->
            return if (c.moveToFirst()) c.getString(0) else null
        }
    }

    fun setMeta(key: String, value: String) {
        val cv = ContentValues().apply { put("key", key); put("value", value) }
        writableDatabase.insertWithOnConflict("memory_meta", null, cv, SQLiteDatabase.CONFLICT_REPLACE)
    }
}
```

- [ ] **Step 2: Compile-check**

Run: `... assembleDebug`
Expected: `BUILD SUCCESSFUL`.

- [ ] **Step 3: Commit**

```bash
cd /c/Users/Matt/projects/TarotApp && git add app/src/main/java/com/matt/tarot/MemoryStore.kt && git commit -m "feat(android): SQLite memory atom store (SQLiteOpenHelper)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Memory engine (`MemoryEngine.kt`)

**Files:**
- Create: `app/src/main/java/com/matt/tarot/MemoryEngine.kt`

**Interfaces:**
- Consumes (from Tasks 1-2): all of `MemoryModel.kt`; `MemoryStore`.
- Produces (consumed by Task 4):
  - `typealias CallLLM = (system: String, prompt: String, maxTokens: Int, model: String) -> String?`
  - class `MemoryEngine(context: Context)` with:
    - `fun recall(slug: String, question: String?, cards: List<String>): RecallResult`
    - `data class RecallResult(memories: List<MemoryRow>, block: String)`
    - `fun captureFromReading(slug: String, reading: JSONObject, callLLM: CallLLM): ApplyResult`
    - `fun backfill(slug: String, readings: List<JSONObject>, callLLM: CallLLM): ApplyResult`

**Note:** Not JVM-unit-testable (holds a `MemoryStore`). Compile-gated; the pure logic it calls is already covered by Task 1.

- [ ] **Step 1: Implement `MemoryEngine.kt`**

Create `app/src/main/java/com/matt/tarot/MemoryEngine.kt`:

```kotlin
package com.matt.tarot

import android.content.Context
import org.json.JSONObject

typealias CallLLM = (system: String, prompt: String, maxTokens: Int, model: String) -> String?

// Capture + recall + backfill over the SQLite atom store. Port of the substrate
// half of data/memory-engine.js. Best-effort: a DB/LLM failure never breaks a reading.
class MemoryEngine(context: Context) {
    private val store = MemoryStore(context.applicationContext)

    data class RecallResult(val memories: List<MemoryRow>, val block: String)

    // Deterministic, no LLM. Safe to call synchronously on the request thread.
    fun recall(slug: String, question: String?, cards: List<String>): RecallResult {
        val candidates = try { store.getOpenAndSalient(slug, 200) } catch (e: Exception) { emptyList() }
        if (candidates.isEmpty()) return RecallResult(emptyList(), "")
        val now = System.currentTimeMillis() / 1000
        val chosen = scoreCandidates(candidates, question, cards, now)
            .filter { it.score > 0 }
            .take(RECALL_LIMIT)
            .map { it.memory }
        if (chosen.isEmpty()) return RecallResult(emptyList(), "")
        store.markReferenced(chosen.map { it.id })
        return RecallResult(chosen, formatRecallBlock(chosen))
    }

    // Haiku extraction. Best-effort: any throw returns a zero result. Run off the
    // request thread by the caller (it makes a network call).
    fun captureFromReading(slug: String, reading: JSONObject, callLLM: CallLLM): ApplyResult {
        return try {
            val existing = store.getOpenAndSalient(slug, 30)
            val raw = callLLM(EXTRACT_SYSTEM, buildCapturePrompt(reading, existing), 800, HAIKU)
            val ops = parseExtractorOutput(raw)
            store.applyOps(slug, ops, "reading", reading.optString("id").ifEmpty { null })
        } catch (e: Exception) {
            ApplyResult()
        }
    }

    // One-time seed from existing readings. Lets callLLM THROW propagate so the
    // flag stays unset and a later run retries (matches the web backfill contract).
    // The caller runs this on a background thread and catches.
    fun backfill(slug: String, readings: List<JSONObject>, callLLM: CallLLM): ApplyResult {
        val flag = "backfilled:$slug"
        val result = ApplyResult()
        if (store.getMeta(flag) != null) return result
        if (readings.isEmpty()) { store.setMeta(flag, "1"); return result }
        var i = 0
        while (i < readings.size) {
            val chunk = readings.subList(i, minOf(i + BACKFILL_CHUNK, readings.size))
            val raw = callLLM(BACKFILL_SYSTEM, buildBackfillPrompt(chunk), 1200, HAIKU)
            val ops = parseExtractorOutput(raw).filter { it.op.uppercase() == "ADD" }
            result.added += store.applyOps(slug, ops, "backfill", null).added
            i += BACKFILL_CHUNK
        }
        store.setMeta(flag, "1")
        return result
    }
}
```

- [ ] **Step 2: Compile-check**

Run: `... assembleDebug`
Expected: `BUILD SUCCESSFUL`.

- [ ] **Step 3: Commit**

```bash
cd /c/Users/Matt/projects/TarotApp && git add app/src/main/java/com/matt/tarot/MemoryEngine.kt && git commit -m "feat(android): memory engine (recall, capture, backfill)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Wire the engine into `TarotServer.kt`

**Files:**
- Modify: `app/src/main/java/com/matt/tarot/TarotServer.kt`

**Interfaces:**
- Consumes (from Task 3): `MemoryEngine`, `CallLLM`, `MemoryEngine.RecallResult`.
- Produces: capture on save, recall in interpret, lazy backfill. No new public API.

**Note:** Compile-gated + on-device smoke (Step 6). The interpret slug resolution reuses the `body.optString("reader")` fallback already added in Track 3.

- [ ] **Step 1: Add the engine field + a callLLM adapter + a readings loader**

In `TarotServer.kt`, add an import near the top (after the existing imports):

```kotlin
import java.util.concurrent.atomic.AtomicBoolean
```

Add fields alongside the other `private val` fields (near `dailyDir`):

```kotlin
    private val memory = MemoryEngine(context)
    private val backfillStarted = AtomicBoolean(false)
```

Add these helpers (place them right before `private fun handleInterpret`):

```kotlin
    // Adapter so MemoryEngine can call Claude through the existing OkHttp path.
    private fun memoryCallLLM(system: String, prompt: String, maxTokens: Int, model: String): String? {
        val apiKey = getApiKey() ?: return null
        val body = JSONObject()
            .put("model", model).put("max_tokens", maxTokens).put("system", system)
            .put("messages", JSONArray().put(JSONObject().put("role", "user").put("content", prompt)))
        return callClaude(apiKey, body)
    }

    private fun loadReadingList(slug: String): List<JSONObject> {
        val file = File(readingsDir, "$slug.json")
        val arr = try { if (file.exists()) JSONArray(file.readText()) else JSONArray() } catch (e: Exception) { JSONArray() }
        return (0 until arr.length()).mapNotNull { arr.optJSONObject(it) }
    }

    // One-time per launch: seed memory from each reader's existing history, off-thread.
    private fun ensureBackfill() {
        if (!backfillStarted.compareAndSet(false, true)) return
        Thread {
            try {
                val readers = loadReaders()
                for (i in 0 until readers.length()) {
                    val rslug = readers.getJSONObject(i).optString("slug")
                    if (rslug.isEmpty()) continue
                    memory.backfill(rslug, loadReadingList(rslug), ::memoryCallLLM)
                }
            } catch (e: Exception) {
                Log.w(TAG, "memory backfill failed: ${e.message}")
            }
        }.start()
    }
```

- [ ] **Step 2: Recall in `handleInterpret`**

In `handleInterpret`, replace the system-prompt assembly. Find:

```kotlin
        val systemPrompt = READER_PERSONA + buildAddressingNote(readerName) + buildPatternBlock(slug, cards)
```

Replace with:

```kotlin
        ensureBackfill()
        val cardNames = (0 until cards.length()).mapNotNull { cards.optJSONObject(it)?.optString("name") }
        val memoryBlock = try { memory.recall(slug, question, cardNames).block } catch (e: Exception) { "" }
        val systemPrompt = READER_PERSONA + buildAddressingNote(readerName) + memoryBlock + buildPatternBlock(slug, cards)
```

(`slug`, `cards`, `question`, `readerName` are already in scope from earlier in `handleInterpret`.)

- [ ] **Step 3: Capture in `handleSaveReading`**

In `handleSaveReading`, find:

```kotlin
        file.writeText(trimmed.toString(2))
        return jsonResponse(JSONObject().put("ok", true))
```

Replace with:

```kotlin
        file.writeText(trimmed.toString(2))
        // Fire-and-forget Haiku capture; never blocks the save response.
        Thread {
            try { memory.captureFromReading(slug, body, ::memoryCallLLM) }
            catch (e: Exception) { Log.w(TAG, "memory capture failed: ${e.message}") }
        }.start()
        return jsonResponse(JSONObject().put("ok", true))
```

(`slug` and `body` are in scope; `body` is the saved reading JSON, already carrying `id`, `cards`, `timestamp`, etc.)

- [ ] **Step 4: Compile-check + unit tests**

Run: `... assembleDebug testDebugUnitTest`
Expected: `BUILD SUCCESSFUL`; `MemoryModelTest` + `CardPatternsTest` all pass (failures="0").

- [ ] **Step 5: Commit**

```bash
cd /c/Users/Matt/projects/TarotApp && git add app/src/main/java/com/matt/tarot/TarotServer.kt && git commit -m "feat(android): wire memory engine into interpret (recall) + readings (capture) + lazy backfill

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

- [ ] **Step 6: On-device smoke (human verification gate)**

This validates the SQLite path, which cannot run in JVM unit tests. Build + sideload, then:
1. Do a reading whose question names something specific (e.g. "should I take the Portland job?"). Within a few seconds `memory.db` should gain atoms (capture ran).
2. Do a second reading that touches the same thread. Miriel's interpretation should reference what she "remembers" (the recall block fired).
3. Fresh install with existing reading history -> the first interpret seeds memory once (backfill); a relaunch does not re-seed (flag set).

If any step misbehaves, capture `adb logcat` around `TarotServer` and treat it as a defect against this task.

---

## Self-Review

**Spec coverage:**
- SQLite `memory.db` store (memories/links/meta + asked_at) -> Task 2. ✓
- `applyOps` ADD/UPDATE/TOUCH only -> Task 2 (`when` has no RESOLVE branch). ✓
- Capture from reading (Haiku, off-thread, after save) -> Task 3 (`captureFromReading`) + Task 4 Step 3. ✓
- Deterministic recall woven into interpret, before patternBlock -> Task 3 (`recall`) + Task 4 Step 2. ✓
- One-time backfill, lazy on first interpret, off-thread, throw-to-propagate -> Task 3 (`backfill`) + Task 4 Step 1/2 (`ensureBackfill`). ✓
- Pure scorer/parser unit-tested; store/engine compile-gated + on-device -> Task 1 (tests) + Tasks 2-4 (assembleDebug) + Task 4 Step 6. ✓
- Time in seconds -> `nowSec()` (store), `currentTimeMillis()/1000` (engine recall). ✓
- memoryBlock before patternBlock -> Task 4 Step 2. ✓
- Scope: Threshold/dormant/predictions/seasons/curiosity NOT implemented; schema built complete -> Task 2 schema, no extra queries. ✓

**Placeholder scan:** No TBD/TODO; every code step shows complete code; commands have expected output. ✓

**Type consistency:** `MemoryRow`/`Op`/`ApplyResult` defined in Task 1 and used identically in Tasks 2-3. `CallLLM` typealias defined in Task 3, used in Task 4 (`::memoryCallLLM` matches `(String,String,Int,String)->String?`). `recall(slug, question, cards: List<String>)` defined Task 3, called Task 4 with `cardNames: List<String>`. `captureFromReading(slug, reading: JSONObject, callLLM)` defined Task 3, called Task 4 with `body` (JSONObject). `backfill(slug, readings: List<JSONObject>, callLLM)` defined Task 3, called Task 4 with `loadReadingList(slug): List<JSONObject>`. `getOpenAndSalient`, `markReferenced`, `getMeta`/`setMeta`, `applyOps`, `getMemory`, `addMemory` signatures match between Task 2 (def) and Task 3 (use). ✓
