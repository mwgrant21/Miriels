# Android Threshold Greeting (Slice A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the two Android Threshold stubs with the real reunion greeting (open/dormant threads + ripe predictions) plus threshold-answer capture that closes resolved predictions, a faithful Kotlin port of the web memory-engine threshold half.

**Architecture:** Mirror the substrate slice's pure/Android split. Pure logic (constants, mode decision, prompt builders) goes in MemoryModel.kt and is JVM-unit-tested. SQLite signal queries + a new RESOLVE branch go in MemoryStore.kt (compile-gated). MemoryEngine.kt orchestrates (gather, decide, generate, commit). TarotServer.kt exposes two real handlers replacing the stubs.

**Tech Stack:** Kotlin, Android SQLite (SQLiteOpenHelper), NanoHTTPD, OkHttp (via existing memoryCallLLM), JUnit4. Build via Android Studio JBR from CLI.

## Global Constraints

- ASCII only in all model-facing prose and ported strings. No em dashes, no smart quotes. Verify with a byte scan before committing.
- Never push tarot or TarotApp git history. TarotApp is local-only (no remote). All commits stay local.
- Time in the memory layer is unix SECONDS.
- Faithful port: prompt wording and SQL window math copied verbatim from the web source; constants match web exactly (REUNION_GAP_DAYS=2, THRESHOLD_SALIENCE_BAR=3, REUNION_MAX_THREADS=3, DORMANT base 60d, ripe base 14d).
- Reuse existing infrastructure (memoryCallLLM, ensureBackfill, buildAddressingNote, READER_PERSONA, the markReferenced transaction idiom). Do not add new HTTP or LLM plumbing.
- Build/verify from CLI with JAVA_HOME set to the Android Studio JBR:
  `$env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"` then
  `& "C:\Users\Matt\projects\TarotApp\gradlew.bat" -p "C:\Users\Matt\projects\TarotApp" <task>` (PowerShell; gradlew.bat only).
- Models: greeting + reply use `claude-sonnet-4-6`; capture uses `HAIKU` (claude-haiku-4-5-20251001). All via memoryCallLLM (forwards the model arg).

## File Structure

- `app/src/main/java/com/matt/tarot/MemoryModel.kt` (modify) - add threshold constants, SeasonShift type, decideThresholdMode, prompt builders. PURE.
- `app/src/test/java/com/matt/tarot/MemoryModelTest.kt` (modify) - add threshold unit tests.
- `app/src/main/java/com/matt/tarot/MemoryStore.kt` (modify) - add three signal queries, markAsked, RESOLVE branch in applyOps.
- `app/src/main/java/com/matt/tarot/MemoryEngine.kt` (modify) - add ThresholdResult, threshold(), captureThresholdAnswer(), loadThreads().
- `app/src/main/java/com/matt/tarot/TarotServer.kt` (modify) - replace the two stub route arms with handleThreshold + handleThresholdAnswer.
- `app/build.gradle` (modify) - versionCode 3 -> 4, versionName "1.3" -> "1.4".

---

### Task 1: MemoryModel.kt threshold pure logic + unit tests

**Files:**
- Modify: `app/src/main/java/com/matt/tarot/MemoryModel.kt`
- Test: `app/src/test/java/com/matt/tarot/MemoryModelTest.kt`

**Interfaces:**
- Consumes: existing `MemoryRow`, `Op`, `parseExtractorOutput` (already in MemoryModel.kt).
- Produces (used by Tasks 2-4):
  - `const val REUNION_GAP_DAYS = 2`, `const val THRESHOLD_SALIENCE_BAR = 3`, `const val REUNION_MAX_THREADS = 3`, `val VERDICTS: Set<String>`
  - `data class SeasonShift(val signature: String, val fact: String)`
  - `fun decideThresholdMode(lastVisit: Long?, threads: List<MemoryRow>, now: Long, gapDays: Int = REUNION_GAP_DAYS, predictions: List<MemoryRow> = emptyList(), dormant: List<MemoryRow> = emptyList(), seasonShift: SeasonShift? = null): String`
  - `fun buildGreetingPrompt(mode: String, threads: List<MemoryRow>, gapDays: Double, predictions: List<MemoryRow> = emptyList(), timeOfDay: String = "", dormant: List<MemoryRow> = emptyList(), seasonShift: SeasonShift? = null): String`
  - `fun buildReplyPrompt(threads: List<MemoryRow>, answer: String?): String`
  - `const val THRESHOLD_CAPTURE_SYSTEM: String`
  - `fun buildThresholdCapturePrompt(items: List<MemoryRow>, answer: String?): String`

- [ ] **Step 1: Write the failing tests**

Append to `app/src/test/java/com/matt/tarot/MemoryModelTest.kt`, inside the existing `MemoryModelTest` class (after the existing tests, before the closing brace). Reuse the existing `row()` helper (it builds type="thread") and add a `predRow()` helper:

```kotlin
    private fun predRow(id: Long, content: String, salience: Int = 3) = MemoryRow(
        id = id, readerSlug = "matt", type = "prediction", content = content, status = "open",
        salience = salience, subject = null, sourceKind = "reading", sourceId = null,
        createdAt = NOW, updatedAt = NOW, lastReferencedAt = null, referenceCount = 0, askedAt = null
    )

    @Test fun decideThreshold_none_when_no_material() {
        assertEquals("none", decideThresholdMode(NOW - 10 * 86400, emptyList(), NOW))
    }

    @Test fun decideThreshold_reunion_on_first_visit() {
        assertEquals("reunion", decideThresholdMode(null, listOf(row(1, "a thread")), NOW))
    }

    @Test fun decideThreshold_reunion_when_gap_two_days_or_more() {
        assertEquals("reunion", decideThresholdMode(NOW - 3 * 86400, listOf(row(1, "a thread")), NOW))
    }

    @Test fun decideThreshold_gentle_when_gap_under_two_days() {
        assertEquals("gentle", decideThresholdMode(NOW - 1 * 86400, listOf(row(1, "a thread")), NOW))
    }

    @Test fun decideThreshold_material_from_predictions_only() {
        assertEquals("reunion",
            decideThresholdMode(NOW - 5 * 86400, emptyList(), NOW, REUNION_GAP_DAYS, listOf(predRow(2, "a foretelling"))))
    }

    @Test fun decideThreshold_material_from_dormant_only() {
        assertEquals("reunion",
            decideThresholdMode(NOW - 5 * 86400, emptyList(), NOW, REUNION_GAP_DAYS, emptyList(), listOf(row(3, "quiet thread"))))
    }

    @Test fun greeting_gentle_has_thread_block_ask_and_short_instruction() {
        val p = buildGreetingPrompt("gentle", listOf(row(1, "the move to Portland")), 1.0)
        assertTrue(p.contains("Open thread still between you:"))
        assertTrue(p.contains("- the move to Portland"))
        assertTrue(p.contains("what came of it"))
        assertTrue(p.contains("Two or three sentences"))
    }

    @Test fun greeting_reunion_both_threads_and_predictions() {
        val p = buildGreetingPrompt(
            "reunion", listOf(row(1, "t one"), row(2, "t two")), 10.0, listOf(predRow(3, "p one"))
        )
        assertTrue(p.contains("returned to you after a real absence"))
        assertTrue(p.contains("About 10 days have passed"))
        assertTrue(p.contains("what came of them, and whether what the cards foretold has come to pass"))
        assertTrue(p.contains("holding these for them"))
        assertTrue(p.contains("Three to five sentences"))
    }

    @Test fun greeting_askless_when_only_dormant() {
        val p = buildGreetingPrompt("reunion", emptyList(), 10.0, emptyList(), "", listOf(row(5, "old thread")))
        assertTrue(p.contains("gone quiet between you"))
        assertTrue(!p.contains("and your question"))
    }

    @Test fun greeting_infinite_gap_phrase() {
        val p = buildGreetingPrompt("reunion", listOf(row(1, "t")), Double.POSITIVE_INFINITY)
        assertTrue(p.contains("It has been some time since they last sat with you."))
    }

    @Test fun replyPrompt_includes_truncated_answer_and_threads() {
        val p = buildReplyPrompt(listOf(row(1, "the move")), "it happened")
        assertTrue(p.contains("- the move"))
        assertTrue(p.contains("They answered: \"it happened\""))
    }

    @Test fun capturePrompt_includes_items_and_answer() {
        val p = buildThresholdCapturePrompt(listOf(predRow(7, "a foretelling")), "it came true")
        assertTrue(p.contains("#7 [prediction/open] a foretelling"))
        assertTrue(p.contains("it came true"))
        assertTrue(p.contains("\"op\":\"RESOLVE\""))
    }

    @Test fun parse_resolve_op_with_verdict_and_outcome() {
        val raw = "{\"operations\":[{\"op\":\"RESOLVE\",\"id\":7,\"verdict\":\"came_to_pass\",\"outcome\":\"It ended.\"}]}"
        val ops = parseExtractorOutput(raw)
        assertEquals(1, ops.size)
        assertEquals("RESOLVE", ops[0].op)
        assertEquals(7L, ops[0].id)
        assertEquals("came_to_pass", ops[0].verdict)
        assertEquals("It ended.", ops[0].outcome)
    }
```

- [ ] **Step 2: Run the tests to verify they fail**

Run (PowerShell):
```
$env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
& "C:\Users\Matt\projects\TarotApp\gradlew.bat" -p "C:\Users\Matt\projects\TarotApp" testDebugUnitTest
```
Expected: FAIL - compile errors / unresolved references (decideThresholdMode, buildGreetingPrompt, buildReplyPrompt, buildThresholdCapturePrompt, REUNION_GAP_DAYS not defined).

- [ ] **Step 3: Implement the pure logic**

Append to `app/src/main/java/com/matt/tarot/MemoryModel.kt` (after the existing prompt builders, before EOF). All strings are ASCII.

```kotlin
// ---- Threshold (reunion greeting) pure logic. Port of data/memory-engine.js threshold half. ----

const val REUNION_GAP_DAYS = 2
const val THRESHOLD_SALIENCE_BAR = 3
const val REUNION_MAX_THREADS = 3
val VERDICTS: Set<String> = setOf("came_to_pass", "did_not", "partly")

// Slice A always passes null; the type exists so the greeting/decision compile with
// the season parameter that the emotional-seasons slice (B) will feed.
data class SeasonShift(val signature: String, val fact: String)

fun decideThresholdMode(
    lastVisit: Long?,
    threads: List<MemoryRow>,
    now: Long,
    gapDays: Int = REUNION_GAP_DAYS,
    predictions: List<MemoryRow> = emptyList(),
    dormant: List<MemoryRow> = emptyList(),
    seasonShift: SeasonShift? = null
): String {
    val hasMaterial = threads.isNotEmpty() || predictions.isNotEmpty() || dormant.isNotEmpty() || seasonShift != null
    if (!hasMaterial) return "none"
    val gap = if (lastVisit == null) Double.POSITIVE_INFINITY else (now - lastVisit) / 86400.0
    return if (gap >= gapDays) "reunion" else "gentle"
}

private fun threadLines(threads: List<MemoryRow>): String =
    threads.joinToString("\n") { "- ${it.content}" }

fun buildGreetingPrompt(
    mode: String,
    threads: List<MemoryRow>,
    gapDays: Double,
    predictions: List<MemoryRow> = emptyList(),
    timeOfDay: String = "",
    dormant: List<MemoryRow> = emptyList(),
    seasonShift: SeasonShift? = null
): String {
    val gap = maxOf(0L, Math.round(gapDays))
    val gapPhrase = if (gapDays.isInfinite())
        "It has been some time since they last sat with you."
    else
        "About $gap day${if (gap == 1L) "" else "s"} have passed since they last sat with you."

    val hasThreads = threads.isNotEmpty()
    val hasPreds = predictions.isNotEmpty()

    val threadBlock = if (hasThreads)
        "Open thread${if (threads.size > 1) "s" else ""} still between you:\n${threadLines(threads)}"
    else ""
    val predBlock = if (hasPreds)
        "Thing${if (predictions.size > 1) "s" else ""} the cards once foretold through you, which may have come to pass by now:\n${threadLines(predictions)}"
    else ""
    val dormantBlock = if (dormant.isNotEmpty()) {
        val s = dormant.size > 1
        "Thread${if (s) "s" else ""} that ${if (s) "have" else "has"} gone quiet between you. They spoke of ${if (s) "these" else "this"} once, but not for a long while now:\n" +
        dormant.joinToString("\n") { "- ${it.content}" } +
        "\n\nYou have been quietly holding ${if (s) "these" else "this"}. If it feels natural, gently wonder aloud whether ${if (s) "they ever settled" else "it ever settled"}, not as a checklist, but the way you would ask after something a friend once carried and may no longer be carrying. Do not press; if they do not take it up, let it rest."
    } else ""
    val seasonBlock = if (seasonShift != null)
        "The emotional weather you have watched move through them over time:\n${seasonShift.fact}\n\n" +
        "If it feels true and kind, reflect this change back to them in your own voice, gently and specifically, " +
        "as someone who has sat with them across these seasons. Notice it; do not diagnose or explain it."
    else ""
    val timeHint = if (timeOfDay.isNotEmpty())
        "It is currently $timeOfDay where they are. You may let the hour gently color your greeting (a passing nod to the light or the time), but only if it feels natural; never force it and never make it the focus."
    else ""
    val material = listOf(threadBlock, dormantBlock, seasonBlock, predBlock, timeHint)
        .filter { it.isNotEmpty() }.joinToString("\n\n")
    val both = hasThreads && hasPreds

    val askParts = mutableListOf<String>()
    if (hasThreads) askParts.add("what came of ${if (threads.size > 1) "them" else "it"}")
    if (hasPreds) askParts.add("whether what the cards foretold has come to pass")
    val ask = askParts.joinToString(", and ")

    if (mode == "gentle") {
        val instruction = if (ask.isNotEmpty())
            "Greet them warmly and briefly, in your own voice, and gently ask $ask, woven in naturally, not as a form."
        else
            "Greet them warmly and briefly, in your own voice, letting what you notice about the timing surface naturally if it feels right, no question is needed."
        return "This person has just returned for a reading. $gapPhrase\n$material\n\n$instruction Two or three sentences. Do not begin the reading yet. Speak only your greeting."
    }
    val instruction = if (ask.isNotEmpty())
        "Greet them the way you would greet someone you know well who has been away, acknowledge the gap as you naturally would, then say you have been holding ${if (both) "these" else "this"} for them, and ask $ask."
    else
        "Greet them the way you would greet someone you know well who has been away, acknowledge the gap, and let what you notice about the timing surface if it feels right."
    return "This person has just returned to you after a real absence. $gapPhrase\n$material\n\n$instruction Warm, unhurried, unmistakably you. Three to five sentences. Do not begin the reading. Speak only your greeting${if (ask.isNotEmpty()) " and your question" else ""}."
}

fun buildReplyPrompt(threads: List<MemoryRow>, answer: String?): String {
    val a = (answer ?: "").let { if (it.length > 800) it.substring(0, 800) else it }
    return "Moments ago you asked this person what had come of:\n${threadLines(threads)}\n\n" +
        "They answered: \"$a\"\n\n" +
        "Respond as Miriel, take in what they said and reflect it back briefly, with warmth and honesty, and let it settle into a single quiet bridge toward the reading to come. One or two sentences. Do not read the cards yet."
}

const val THRESHOLD_CAPTURE_SYSTEM =
    "You are the memory keeper for a tarot reader named Miriel. The querent has just told Miriel " +
    "what came of the open threads and foretellings she remembered. Update her memory from their answer, " +
    "resolving a prediction with a verdict when they report how it turned out. Be conservative: " +
    "only what they actually said. Never invent."

fun buildThresholdCapturePrompt(items: List<MemoryRow>, answer: String?): String {
    val block = items.joinToString("\n") { "#${it.id} [${it.type}/${it.status ?: "-"}] ${it.content}" }
    val a = (answer ?: "").let { if (it.length > 1000) it.substring(0, 1000) else it }
    return "WHAT MIRIEL ASKED ABOUT:\n$block\n\n" +
        "WHAT THE PERSON SAID:\n\"$a\"\n\n" +
        "Update memory. Respond with ONLY a JSON object:\n\n" +
        "{\"operations\":[\n" +
        "  {\"op\":\"RESOLVE\",\"id\":7,\"verdict\":\"came_to_pass\",\"outcome\":\"one short line in Miriel's voice on how it concluded\"},\n" +
        "  {\"op\":\"UPDATE\",\"id\":8,\"status\":\"moving\",\"content\":\"refined one-sentence state\"},\n" +
        "  {\"op\":\"ADD\",\"type\":\"event\",\"content\":\"a new specific thing they mentioned\",\"salience\":3}\n" +
        "]}\n\n" +
        "Rules:\n" +
        "- For a PREDICTION (type prediction) the person reports on, emit RESOLVE with:\n" +
        "    \"verdict\": one of \"came_to_pass\", \"did_not\", \"partly\", or \"too_soon\" (use too_soon ONLY if it genuinely cannot be judged yet);\n" +
        "    \"outcome\": a single short line in Miriel's own voice (e.g. \"The time with Maggie has ended.\"). Omit \"outcome\" when the verdict is too_soon.\n" +
        "- For a THREAD (type thread) the person reports as concluded, emit RESOLVE with an \"outcome\" line (no verdict needed).\n" +
        "- UPDATE a thread or prediction still in motion, set status \"moving\" and optionally refine content.\n" +
        "- ADD a new memory only for genuinely new specifics they mentioned (type: person|thread|event|feeling|prediction|fact|preference; salience 1-5).\n" +
        "- If they were vague or skipped, return {\"operations\":[]}.\n" +
        "- Record only what they actually said. Do not invent."
}
```

Note: `threadLines` is reused for predictions too (both render as `- content`), matching the web `predictionLines` which is identical to `threadLines`.

- [ ] **Step 4: Run the tests to verify they pass**

Run:
```
$env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
& "C:\Users\Matt\projects\TarotApp\gradlew.bat" -p "C:\Users\Matt\projects\TarotApp" testDebugUnitTest
```
Expected: BUILD SUCCESSFUL, all MemoryModelTest tests pass (existing + the new threshold tests).

- [ ] **Step 5: ASCII byte scan**

Run (git-bash):
```
cd /c/Users/Matt/projects/TarotApp && LC_ALL=C grep -nE '[^[:print:][:space:]]' app/src/main/java/com/matt/tarot/MemoryModel.kt app/src/test/java/com/matt/tarot/MemoryModelTest.kt
```
Expected: no output (ASCII clean).

- [ ] **Step 6: Commit**

```
cd /c/Users/Matt/projects/TarotApp
git add app/src/main/java/com/matt/tarot/MemoryModel.kt app/src/test/java/com/matt/tarot/MemoryModelTest.kt
git commit -m "feat(android): threshold pure logic (decideThresholdMode + greeting/reply/capture prompts)"
```

---

### Task 2: MemoryStore.kt signal queries + markAsked + RESOLVE

**Files:**
- Modify: `app/src/main/java/com/matt/tarot/MemoryStore.kt`

**Interfaces:**
- Consumes: `VERDICTS` (Task 1), existing `rowFrom`, `nowSec`, `addMemory`, `getForSlug`, `MEMORY_TYPES`, `MEMORY_STATUSES`, `clampSalience`, the `memories` and `memory_links` tables.
- Produces (used by Task 3):
  - `fun getOpenUnaskedThreads(slug: String, limit: Int = 3, minSalience: Int = 3): List<MemoryRow>`
  - `fun getRipePredictions(slug: String, limit: Int = 3, now: Long): List<MemoryRow>`
  - `fun getDormantThreads(slug: String, limit: Int = 2, now: Long): List<MemoryRow>`
  - `fun markAsked(ids: List<Long>)`
  - `applyOps` now also handles a `"RESOLVE"` op.

- [ ] **Step 1: Add the three signal queries and markAsked**

In `app/src/main/java/com/matt/tarot/MemoryStore.kt`, add these methods (place them next to `getOpenAndSalient`/`markReferenced`, which they mirror):

```kotlin
    fun getOpenUnaskedThreads(slug: String, limit: Int = 3, minSalience: Int = 3): List<MemoryRow> {
        val out = ArrayList<MemoryRow>()
        readableDatabase.rawQuery(
            "SELECT * FROM memories WHERE reader_slug = ? AND type = 'thread' " +
            "AND status IN ('open','moving') AND asked_at IS NULL AND salience >= ? " +
            "ORDER BY salience DESC, updated_at DESC LIMIT ?",
            arrayOf(slug, minSalience.toString(), limit.toString())
        ).use { c -> while (c.moveToNext()) out.add(rowFrom(c)) }
        return out
    }

    // Ripe = open prediction aged past a per-id jittered window (base 14d, +/-3 from
    // id % 7 -> 11..17d), measured from COALESCE(asked_at, created_at) so a deferred
    // prediction re-ripens a fresh window after it was last asked.
    fun getRipePredictions(slug: String, limit: Int = 3, now: Long): List<MemoryRow> {
        val out = ArrayList<MemoryRow>()
        readableDatabase.rawQuery(
            "SELECT * FROM memories WHERE reader_slug = ? AND type = 'prediction' AND status = 'open' " +
            "AND (? - COALESCE(asked_at, created_at)) >= (14 + (id % 7) - 3) * 86400 " +
            "ORDER BY salience DESC, updated_at DESC LIMIT ?",
            arrayOf(slug, now.toString(), limit.toString())
        ).use { c -> while (c.moveToNext()) out.add(rowFrom(c)) }
        return out
    }

    // Dormant = open/moving salient thread untouched past a per-id jittered window
    // (base 60d, +/-3 -> 57..63d), measured from MAX(asked_at, updated_at) so
    // re-engaging or asking about it rests it for another window.
    fun getDormantThreads(slug: String, limit: Int = 2, now: Long): List<MemoryRow> {
        val out = ArrayList<MemoryRow>()
        readableDatabase.rawQuery(
            "SELECT * FROM memories WHERE reader_slug = ? AND type = 'thread' " +
            "AND status IN ('open','moving') AND salience >= 3 " +
            "AND (? - MAX(IFNULL(asked_at, 0), updated_at)) >= (60 + (id % 7) - 3) * 86400 " +
            "ORDER BY salience DESC, updated_at ASC LIMIT ?",
            arrayOf(slug, now.toString(), limit.toString())
        ).use { c -> while (c.moveToNext()) out.add(rowFrom(c)) }
        return out
    }

    fun markAsked(ids: List<Long>) {
        if (ids.isEmpty()) return
        val t = nowSec()
        val db = writableDatabase
        val stmt = db.compileStatement("UPDATE memories SET asked_at = ? WHERE id = ?")
        db.beginTransaction()
        try {
            for (id in ids) { stmt.clearBindings(); stmt.bindLong(1, t); stmt.bindLong(2, id); stmt.executeUpdateDelete() }
            db.setTransactionSuccessful()
        } finally { stmt.close(); db.endTransaction() }
    }
```

- [ ] **Step 2: Add the RESOLVE branch to applyOps**

In `applyOps`, inside the `when (op.op.uppercase())` block, add a `"RESOLVE"` arm alongside the existing `"ADD"`/`"UPDATE"`/`"TOUCH"` arms (this runs inside the existing `db.beginTransaction()`; `t` and `db` are already in scope):

```kotlin
                    "RESOLVE" -> {
                        val id = op.id ?: continue
                        if (getForSlug(id, slug) == null) continue
                        val verdict = op.verdict
                        if (verdict == "too_soon") {
                            // Nothing concluded yet: re-stamp asked_at, leave status open so it re-ripens.
                            db.update("memories", ContentValues().apply { put("asked_at", t) },
                                "id = ? AND reader_slug = ?", arrayOf(id.toString(), slug))
                            result.deferred++
                            continue
                        }
                        db.update("memories", ContentValues().apply {
                            put("status", "resolved"); put("updated_at", t)
                        }, "id = ? AND reader_slug = ?", arrayOf(id.toString(), slug))
                        val outcome = op.outcome?.trim()
                        if (!outcome.isNullOrEmpty()) {
                            val outcomeId = addMemory(
                                slug, "event", outcome, null, op.salience,
                                if (verdict != null && verdict in VERDICTS) "verdict:$verdict" else null,
                                sourceKind, sourceId
                            )
                            db.insert("memory_links", null, ContentValues().apply {
                                put("from_id", outcomeId); put("to_id", id); put("relation", "resolves")
                            })
                        }
                        result.resolved++
                    }
```

Note: `addMemory` opens its own `writableDatabase.insert`, which shares this connection and participates in the active transaction. `result.resolved` and `result.deferred` already exist on `ApplyResult`. `ContentValues` is already imported in this file.

- [ ] **Step 3: Compile gate**

Run:
```
$env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
& "C:\Users\Matt\projects\TarotApp\gradlew.bat" -p "C:\Users\Matt\projects\TarotApp" assembleDebug
```
Expected: BUILD SUCCESSFUL (the SQLite layer has no JVM unit tests; this is the compile gate).

- [ ] **Step 4: ASCII byte scan**

Run (git-bash):
```
cd /c/Users/Matt/projects/TarotApp && LC_ALL=C grep -nE '[^[:print:][:space:]]' app/src/main/java/com/matt/tarot/MemoryStore.kt
```
Expected: no output.

- [ ] **Step 5: Commit**

```
cd /c/Users/Matt/projects/TarotApp
git add app/src/main/java/com/matt/tarot/MemoryStore.kt
git commit -m "feat(android): threshold store queries (open-unasked/ripe/dormant) + markAsked + RESOLVE in applyOps"
```

---

### Task 3: MemoryEngine.kt orchestration

**Files:**
- Modify: `app/src/main/java/com/matt/tarot/MemoryEngine.kt`

**Interfaces:**
- Consumes: `decideThresholdMode`, `buildGreetingPrompt`, `THRESHOLD_CAPTURE_SYSTEM`, `buildThresholdCapturePrompt`, `parseExtractorOutput`, `REUNION_MAX_THREADS`, `THRESHOLD_SALIENCE_BAR`, `REUNION_GAP_DAYS`, `HAIKU` (all in MemoryModel.kt); `store.getOpenUnaskedThreads`, `store.getRipePredictions`, `store.getDormantThreads`, `store.markAsked`, `store.getMeta`, `store.setMeta`, `store.getMemory`, `store.applyOps` (Task 2 + existing); the existing `CallLLM` typealias.
- Produces (used by Task 4):
  - `data class MemoryEngine.ThresholdResult(val mode: String, val greeting: String?, val threadIds: List<Long>)`
  - `fun threshold(slug: String, now: Long, timeOfDay: String, system: String, callLLM: CallLLM): ThresholdResult`
  - `fun captureThresholdAnswer(slug: String, answer: String?, threadIds: List<Long>, callLLM: CallLLM): ApplyResult`
  - `fun loadThreads(ids: List<Long>): List<MemoryRow>`

- [ ] **Step 1: Add ThresholdResult and the three methods**

In `app/src/main/java/com/matt/tarot/MemoryEngine.kt`, inside the `MemoryEngine` class (next to the existing `RecallResult` / `recall` / `captureFromReading`):

```kotlin
    data class ThresholdResult(val mode: String, val greeting: String?, val threadIds: List<Long>)

    // Deterministic gather + decide; the only network call is the greeting itself.
    // On an LLM failure we return "none" WITHOUT advancing last_visit, so the full
    // reunion retries on the next open (faithful to web; no wooden template greeting).
    fun threshold(slug: String, now: Long, timeOfDay: String, system: String, callLLM: CallLLM): ThresholdResult {
        val threads = try { store.getOpenUnaskedThreads(slug, REUNION_MAX_THREADS, THRESHOLD_SALIENCE_BAR) } catch (e: Exception) { emptyList() }
        val predictions = try { store.getRipePredictions(slug, REUNION_MAX_THREADS, now) } catch (e: Exception) { emptyList() }
        val dormant = try { store.getDormantThreads(slug, 2, now) } catch (e: Exception) { emptyList() }
        val dormantIds = dormant.map { it.id }.toSet()
        val freshThreads = threads.filter { it.id !in dormantIds }
        val lastVisit = store.getMeta("last_visit:$slug")?.toLongOrNull()

        val mode = decideThresholdMode(lastVisit, freshThreads, now, REUNION_GAP_DAYS, predictions, dormant, null)
        if (mode == "none") {
            store.setMeta("last_visit:$slug", now.toString())
            return ThresholdResult("none", null, emptyList())
        }

        val shownThreads = if (mode == "gentle") freshThreads.take(1) else freshThreads
        val shownDormant = if (mode == "gentle") (if (shownThreads.isNotEmpty()) emptyList() else dormant.take(1)) else dormant
        val shownPredictions = if (mode == "gentle") (if (shownThreads.isNotEmpty() || shownDormant.isNotEmpty()) emptyList() else predictions.take(1)) else predictions
        val shown = shownThreads + shownDormant + shownPredictions
        val gapDays = if (lastVisit == null) Double.POSITIVE_INFINITY else (now - lastVisit) / 86400.0

        val prompt = buildGreetingPrompt(mode, shownThreads, gapDays, shownPredictions, timeOfDay, shownDormant, null)
        val greeting = callLLM(system, prompt, 700, "claude-sonnet-4-6")
            ?: return ThresholdResult("none", null, emptyList())

        store.markAsked(shown.map { it.id })
        store.setMeta("last_visit:$slug", now.toString())
        return ThresholdResult(mode, greeting, shown.map { it.id })
    }

    // Best-effort: any throw returns a zero ApplyResult. Run off the request thread (it makes a network call).
    fun captureThresholdAnswer(slug: String, answer: String?, threadIds: List<Long>, callLLM: CallLLM): ApplyResult {
        return try {
            val items = threadIds.mapNotNull { store.getMemory(it) }
            val raw = callLLM(THRESHOLD_CAPTURE_SYSTEM, buildThresholdCapturePrompt(items, answer), 600, HAIKU)
            val ops = parseExtractorOutput(raw)
            store.applyOps(slug, ops, "threshold", null)
        } catch (e: Exception) {
            ApplyResult()
        }
    }

    fun loadThreads(ids: List<Long>): List<MemoryRow> = ids.mapNotNull { store.getMemory(it) }
```

- [ ] **Step 2: Compile gate**

Run:
```
$env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
& "C:\Users\Matt\projects\TarotApp\gradlew.bat" -p "C:\Users\Matt\projects\TarotApp" assembleDebug
```
Expected: BUILD SUCCESSFUL.

- [ ] **Step 3: ASCII byte scan**

Run (git-bash):
```
cd /c/Users/Matt/projects/TarotApp && LC_ALL=C grep -nE '[^[:print:][:space:]]' app/src/main/java/com/matt/tarot/MemoryEngine.kt
```
Expected: no output.

- [ ] **Step 4: Commit**

```
cd /c/Users/Matt/projects/TarotApp
git add app/src/main/java/com/matt/tarot/MemoryEngine.kt
git commit -m "feat(android): threshold engine (gather/decide/greet/commit + answer capture)"
```

---

### Task 4: TarotServer.kt endpoint wiring + version bump

**Files:**
- Modify: `app/src/main/java/com/matt/tarot/TarotServer.kt`
- Modify: `app/build.gradle`

**Interfaces:**
- Consumes: `memory.threshold`, `memory.captureThresholdAnswer`, `memory.loadThreads`, `buildReplyPrompt` (Tasks 1+3); existing `loadReaders`, `READER_PERSONA`, `buildAddressingNote`, `memoryCallLLM`, `ensureBackfill`, `jsonResponse`, `Log`, `TAG`, `session.parameters`.
- Produces: real `/api/threshold` (GET) and `/api/threshold/answer` (POST) responses.

- [ ] **Step 1: Replace the two stub route arms**

In `handleApi` in `app/src/main/java/com/matt/tarot/TarotServer.kt`, replace these two arms:

```kotlin
            uri == "/api/threshold" && method == Method.GET ->
                jsonResponse(JSONObject().put("mode", "none"))

            uri == "/api/threshold/answer" && method == Method.POST ->
                jsonResponse(JSONObject().put("reply", "Thank you for telling me. Let us see what the cards have for you now."))
```

with:

```kotlin
            uri == "/api/threshold" && method == Method.GET ->
                handleThreshold(session.parameters)

            uri == "/api/threshold/answer" && method == Method.POST ->
                handleThresholdAnswer(body)
```

- [ ] **Step 2: Add the two handlers**

Add these methods near `handleInterpret` / `ensureBackfill` in the same file:

```kotlin
    private val FALLBACK_REPLY = "Thank you for telling me. Let us see what the cards have for you now."

    private fun readerNameFor(readers: JSONArray, slug: String): String {
        for (i in 0 until readers.length()) {
            val r = readers.getJSONObject(i)
            if (r.optString("slug") == slug) return r.optString("name").ifEmpty { "you" }
        }
        return "you"
    }

    private fun handleThreshold(params: Map<String, List<String>>): Response {
        return try {
            val readers = loadReaders()
            val slug = params["reader"]?.firstOrNull()?.ifEmpty { null }
                ?: if (readers.length() > 0) readers.getJSONObject(0).optString("slug") else "matt"
            val readerName = readerNameFor(readers, slug)
            val phase = params["phase"]?.firstOrNull() ?: ""
            val timeOfDay = if (phase in setOf("dawn", "day", "dusk", "night")) phase else ""
            ensureBackfill()
            val system = READER_PERSONA + buildAddressingNote(readerName)
            val now = System.currentTimeMillis() / 1000
            val result = memory.threshold(slug, now, timeOfDay, system, ::memoryCallLLM)
            Log.i(TAG, "threshold slug=$slug mode=${result.mode} shown=${result.threadIds.size}")
            if (result.mode == "none") {
                jsonResponse(JSONObject().put("mode", "none"))
            } else {
                jsonResponse(JSONObject()
                    .put("mode", result.mode)
                    .put("greeting", result.greeting)
                    .put("threadIds", JSONArray(result.threadIds)))
            }
        } catch (e: Exception) {
            Log.w(TAG, "threshold failed: ${e.message}", e)
            jsonResponse(JSONObject().put("mode", "none"))
        }
    }

    private fun handleThresholdAnswer(body: JSONObject?): Response {
        if (body == null) return jsonResponse(JSONObject().put("reply", FALLBACK_REPLY))
        val readers = loadReaders()
        val slug = body.optString("reader").ifEmpty {
            if (readers.length() > 0) readers.getJSONObject(0).optString("slug") else "matt"
        }
        val readerName = readerNameFor(readers, slug)
        val answer = body.optString("answer")
        val tidArr = body.optJSONArray("threadIds") ?: JSONArray()
        val threadIds = (0 until tidArr.length()).map { tidArr.optLong(it) }
        val threads = memory.loadThreads(threadIds)
        val system = READER_PERSONA + buildAddressingNote(readerName)
        val reply = (try {
            memoryCallLLM(system, buildReplyPrompt(threads, answer), 400, "claude-sonnet-4-6")
        } catch (e: Exception) { null }) ?: FALLBACK_REPLY
        Thread {
            try { memory.captureThresholdAnswer(slug, answer, threadIds, ::memoryCallLLM) }
            catch (e: Exception) { Log.w(TAG, "threshold capture failed: ${e.message}") }
        }.start()
        return jsonResponse(JSONObject().put("reply", reply))
    }
```

- [ ] **Step 3: Bump the app version**

In `app/build.gradle`, change:
```
        versionCode 3
        versionName "1.3"
```
to:
```
        versionCode 4
        versionName "1.4"
```

- [ ] **Step 4: Compile gate**

Run:
```
$env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
& "C:\Users\Matt\projects\TarotApp\gradlew.bat" -p "C:\Users\Matt\projects\TarotApp" assembleDebug
```
Expected: BUILD SUCCESSFUL; APK at `app/build/outputs/apk/debug/app-debug.apk`.

- [ ] **Step 5: ASCII byte scan**

Run (git-bash):
```
cd /c/Users/Matt/projects/TarotApp && LC_ALL=C grep -nE '[^[:print:][:space:]]' app/src/main/java/com/matt/tarot/TarotServer.kt
```
Expected: no output.

- [ ] **Step 6: Commit**

```
cd /c/Users/Matt/projects/TarotApp
git add app/src/main/java/com/matt/tarot/TarotServer.kt app/build.gradle
git commit -m "feat(android): wire real /api/threshold + /api/threshold/answer; bump to 1.4 (versionCode 4)"
```

---

## On-device smoke (HUMAN gate, after the branch review, before merge)

The SQLite + LLM path is not JVM-testable; verify on a device (sideload `app-debug.apk`, install -r to preserve data):

1. Confirm the device memory.db has open threads (the substrate smoke left several). Backdate `last_visit:<slug>` (or simply ensure none is set) so the gap triggers.
2. Open the app: confirm `/api/threshold` returns `mode "reunion"` with a greeting naming real remembered threads, and that `asked_at` gets stamped on the shown rows (pull memory.db; shown rows have non-null `asked_at`). Logcat shows `threshold slug=... mode=reunion shown=N`.
3. Answer the greeting reporting a foretelling as come to pass. Pull memory.db and confirm: the prediction row flipped to `status='resolved'`; an `event` atom was written with `subject='verdict:came_to_pass'`; a `memory_links` row (`relation='resolves'`) links the event to the prediction.
4. Confirm a `too_soon` answer leaves the prediction `open` with a fresh `asked_at`.

---

## Self-review notes (for the controller)

- Spec coverage: Task 1 = MemoryModel pure logic + tests; Task 2 = store queries + RESOLVE; Task 3 = engine orchestration; Task 4 = endpoints + version bump + on-device smoke. All spec sections covered.
- The greeting omits the temporal block (no temporal callbacks in Slice A); `decideThresholdMode` drops the temporalCallbacks param but keeps `seasonShift` (always null) so Slice B is additive.
- RESOLVE is the complete write path; the foretellings read surface (`getResolvedPredictions`, `/api/foretellings`) stays deferred to Slice C and is untouched here.
