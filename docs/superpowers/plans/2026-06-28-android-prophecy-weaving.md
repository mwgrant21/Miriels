# Android Prophecy Weaving (Slice D) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface up to 3 of Miriel's own past foretellings (resolved-with-verdict first, then still-open) into the interpret persona, with across-visit dedup, so she can reference her foresight when a card or theme connects.

**Architecture:** Faithful port of `data/prophecy-recall.js` + the `server.js` interpret integration. Pure ranking/formatting logic goes in `MemoryModel.kt` (JVM-unit-testable); one new SQL read (`getOpenPredictions`) goes in `MemoryStore.kt`; a new `ProphecyWeaving.kt` (mirroring `EmotionalSeasons.kt`) orchestrates read + dedup over the shared store; `MemoryEngine.kt` exposes delegators; `TarotServer.handleInterpret` injects the block and stamps the surfaced ids after a successful reading.

**Tech Stack:** Kotlin, Android SQLite (`rawQuery`), NanoHTTPD, `org.json`, JUnit4. Build via Android Studio's bundled JBR from CLI.

## Global Constraints

- **ASCII only** in every added or model-facing line. No em dashes, no smart/curly quotes. (Pre-existing non-ASCII in `TarotServer.kt` is out of scope; only added lines must be ASCII.)
- **Local only** — never push tarot or TarotApp git history (the API key is in tarot history). TarotApp has no remote. All commits stay local.
- **One SQLite connection** — `ProphecyWeaving` shares `MemoryEngine`'s single `MemoryStore`.
- **Time is unix SECONDS** in the memory layer. The web prophecy module uses milliseconds; here `now` is `System.currentTimeMillis()/1000`, TTL is `21*86400` seconds, and the `prophecy_surfaced` map stores seconds (exactly like Slice B's `season_surfaced`).
- **Mirror web exactly** — `data/prophecy-recall.js` + the `server.js` block/dedup are the source of truth. Canonical verdicts: `came_to_pass`, `did_not`, `partly`.
- **Build/test commands (Windows PowerShell):**
  - Set JDK once per shell: `$env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"`
  - Unit tests: `& "C:\Users\Matt\projects\TarotApp\gradlew.bat" -p "C:\Users\Matt\projects\TarotApp" testDebugUnitTest`
  - Compile gate: `& "C:\Users\Matt\projects\TarotApp\gradlew.bat" -p "C:\Users\Matt\projects\TarotApp" assembleDebug`
  - Use `gradlew.bat` only (no unix `gradlew`).

---

## File Structure

- `app/src/main/java/com/matt/tarot/MemoryModel.kt` (MODIFY) — PURE: `ProphecyItem`, `ProphecyResult`, constants, `resolvedFact`/`openFact`, `prophecyOverlap`, `findProphecyCallbacks`, `filterProphecySurfaced`, `buildProphecyBlock`.
- `app/src/test/java/com/matt/tarot/MemoryModelTest.kt` (MODIFY) — JVM tests for the above.
- `app/src/main/java/com/matt/tarot/MemoryStore.kt` (MODIFY) — `getOpenPredictions`.
- `app/src/main/java/com/matt/tarot/ProphecyWeaving.kt` (CREATE) — orchestration + dedup meta.
- `app/src/main/java/com/matt/tarot/MemoryEngine.kt` (MODIFY) — delegators.
- `app/src/main/java/com/matt/tarot/TarotServer.kt` (MODIFY) — `handleInterpret` wiring.
- `app/build.gradle` (MODIFY) — version bump 6 -> 7 / "1.6" -> "1.7".

Existing types reused: `ResolvedPrediction(predictionId: Long, foretelling: String, outcome: String, verdict: String?, resolvedAt: Long)` (Slice C); `MemoryRow` (fields used: `id: Long`, `content: String`, `createdAt: Long`); `tokenize(s: String?): List<String>` (existing, byte-identical to the web prophecy tokenizer).

---

## Task 1: Pure prophecy logic + `getOpenPredictions`

**Files:**
- Modify: `app/src/main/java/com/matt/tarot/MemoryModel.kt`
- Test: `app/src/test/java/com/matt/tarot/MemoryModelTest.kt`
- Modify: `app/src/main/java/com/matt/tarot/MemoryStore.kt`

**Interfaces:**
- Produces (consumed by Tasks 2-3):
  - `data class ProphecyItem(val id: Long, val kind: String, val verdict: String?, val foretelling: String, val outcome: String?, val fact: String)`
  - `data class ProphecyResult(val block: String, val shownIds: List<Long>)`
  - `const val PROPHECY_SURFACE_TTL_DAYS = 21`
  - `fun findProphecyCallbacks(resolved: List<ResolvedPrediction>, open: List<MemoryRow>, cardNames: List<String>, question: String?, surfaced: Map<String, Long>, now: Long, ttlDays: Int = PROPHECY_SURFACE_TTL_DAYS): List<ProphecyItem>`
  - `fun filterProphecySurfaced(items: List<ProphecyItem>, surfaced: Map<String, Long>, now: Long, ttlDays: Int = PROPHECY_SURFACE_TTL_DAYS): List<ProphecyItem>`
  - `fun buildProphecyBlock(items: List<ProphecyItem>): String`
  - `MemoryStore.getOpenPredictions(slug: String, limit: Int = 12): List<MemoryRow>`

- [ ] **Step 1: Write the failing tests**

Add to the end of `app/src/test/java/com/matt/tarot/MemoryModelTest.kt`, just before the closing brace of `class MemoryModelTest`:

```kotlin
    // --- Prophecy weaving (Slice D) ---
    private fun resolvedPred(id: Long, foretelling: String, verdict: String?, outcome: String = "", resolvedAt: Long = NOW) =
        ResolvedPrediction(id, foretelling, outcome, verdict, resolvedAt)

    private fun openPred(id: Long, content: String, createdAt: Long = NOW) = MemoryRow(
        id = id, readerSlug = "matt", type = "prediction", content = content, status = "open",
        salience = 3, subject = null, sourceKind = "reading", sourceId = null,
        createdAt = createdAt, updatedAt = createdAt, lastReferencedAt = null, referenceCount = 0, askedAt = null
    )

    @Test fun prophecy_resolved_ordered_by_verdict_weight() {
        val res = findProphecyCallbacks(
            resolved = listOf(
                resolvedPred(1, "a did not", "did_not"),
                resolvedPred(2, "b came to pass", "came_to_pass"),
                resolvedPred(3, "c partly", "partly")
            ),
            open = emptyList(), cardNames = emptyList(), question = null,
            surfaced = emptyMap(), now = NOW
        )
        assertEquals(listOf(2L, 3L, 1L), res.map { it.id }) // came_to_pass(3) > partly(2) > did_not(1)
    }

    @Test fun prophecy_overlap_breaks_weight_ties() {
        val res = findProphecyCallbacks(
            resolved = listOf(
                resolvedPred(1, "the garden grows", "came_to_pass"),
                resolvedPred(2, "a journey to portland", "came_to_pass")
            ),
            open = emptyList(), cardNames = listOf("Portland"), question = "moving to portland",
            surfaced = emptyMap(), now = NOW
        )
        assertEquals(2L, res.first().id) // id 2 overlaps "portland"
    }

    @Test fun prophecy_resolved_precede_open() {
        val res = findProphecyCallbacks(
            resolved = listOf(resolvedPred(1, "resolved one", "did_not")),
            open = listOf(openPred(2, "open one")),
            cardNames = emptyList(), question = null, surfaced = emptyMap(), now = NOW
        )
        assertEquals(listOf(1L, 2L), res.map { it.id })
    }

    @Test fun prophecy_caps_at_three() {
        val res = findProphecyCallbacks(
            resolved = listOf(
                resolvedPred(1, "a", "came_to_pass"),
                resolvedPred(2, "b", "came_to_pass"),
                resolvedPred(3, "c", "partly")
            ),
            open = listOf(openPred(4, "d"), openPred(5, "e")),
            cardNames = emptyList(), question = null, surfaced = emptyMap(), now = NOW
        )
        assertEquals(3, res.size)
    }

    @Test fun prophecy_fact_strings() {
        val fulfilled = findProphecyCallbacks(
            listOf(resolvedPred(1, "X happens", "came_to_pass", "It did")),
            emptyList(), emptyList(), null, emptyMap(), NOW
        ).first()
        assertEquals("You foretold: \"X happens\". It came to pass: \"It did\".", fulfilled.fact)
        val open = findProphecyCallbacks(
            emptyList(), listOf(openPred(2, "Y unfolds")), emptyList(), null, emptyMap(), NOW
        ).first()
        assertEquals("You foretold: \"Y unfolds\". This is still unfolding, not yet resolved.", open.fact)
    }

    @Test fun prophecy_did_not_fact_without_outcome() {
        val item = findProphecyCallbacks(
            listOf(resolvedPred(1, "Z arrives", "did_not")), emptyList(), emptyList(), null, emptyMap(), NOW
        ).first()
        assertEquals("You foretold: \"Z arrives\". It did not come to pass.", item.fact)
    }

    @Test fun filterProphecySurfaced_drops_within_ttl_keeps_outside() {
        val items = listOf(
            ProphecyItem(1, "open", null, "a", null, "fa"),
            ProphecyItem(2, "open", null, "b", null, "fb")
        )
        val ttlS = PROPHECY_SURFACE_TTL_DAYS * 86400L
        val surfaced = mapOf("1" to NOW - 5L, "2" to NOW - (ttlS + 10))
        val kept = filterProphecySurfaced(items, surfaced, NOW, PROPHECY_SURFACE_TTL_DAYS)
        assertEquals(listOf(2L), kept.map { it.id }) // id 1 within TTL dropped; id 2 outside kept
    }

    @Test fun buildProphecyBlock_empty_and_nonempty() {
        assertEquals("", buildProphecyBlock(emptyList()))
        val block = buildProphecyBlock(listOf(ProphecyItem(1, "open", null, "a", null, "FACT-A")))
        assertTrue(block.startsWith("\n\nForetellings you have made"))
        assertTrue(block.endsWith("- FACT-A"))
    }
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `& "C:\Users\Matt\projects\TarotApp\gradlew.bat" -p "C:\Users\Matt\projects\TarotApp" testDebugUnitTest`
Expected: FAIL — unresolved references `findProphecyCallbacks`, `filterProphecySurfaced`, `buildProphecyBlock`, `ProphecyItem`, `PROPHECY_SURFACE_TTL_DAYS`.

- [ ] **Step 3: Implement the pure logic in MemoryModel.kt**

Append to `app/src/main/java/com/matt/tarot/MemoryModel.kt` (end of file, top-level — no `android.*` imports):

```kotlin
// -- Prophecy weaving (Slice D) ---------------------------------------------
// PURE port of data/prophecy-recall.js. Canonical verdicts: came_to_pass/partly/did_not.
val VERDICT_WEIGHT: Map<String, Int> = mapOf("came_to_pass" to 3, "partly" to 2, "did_not" to 1)
val VERDICT_KIND: Map<String, String> = mapOf("came_to_pass" to "fulfilled", "partly" to "partial", "did_not" to "missed")
const val PROPHECY_SURFACE_TTL_DAYS = 21

data class ProphecyItem(
    val id: Long, val kind: String, val verdict: String?,
    val foretelling: String, val outcome: String?, val fact: String
)
data class ProphecyResult(val block: String, val shownIds: List<Long>)

fun resolvedFact(kind: String, foretelling: String, outcome: String?): String {
    val tail = when (kind) {
        "fulfilled" -> "It came to pass"
        "partial"   -> "It came partly true"
        else        -> "It did not come to pass"
    }
    return if (!outcome.isNullOrEmpty())
        "You foretold: \"$foretelling\". $tail: \"$outcome\"."
    else
        "You foretold: \"$foretelling\". $tail."
}

fun openFact(foretelling: String): String =
    "You foretold: \"$foretelling\". This is still unfolding, not yet resolved."

// Distinct query-token hits in tokenize(text), UNCAPPED. (Not keywordOverlap, which is
// the recall scorer's capped min(1.0, hits/3.0) and would change prophecy ranking.)
private fun prophecyOverlap(queryTokens: Set<String>, text: String): Int {
    if (queryTokens.isEmpty()) return 0
    val seen = HashSet<String>()
    var hits = 0
    for (w in tokenize(text)) if (w in queryTokens && seen.add(w)) hits++
    return hits
}

fun findProphecyCallbacks(
    resolved: List<ResolvedPrediction>,
    open: List<MemoryRow>,
    cardNames: List<String>,
    question: String?,
    surfaced: Map<String, Long>,
    now: Long,
    ttlDays: Int = PROPHECY_SURFACE_TTL_DAYS
): List<ProphecyItem> {
    val queryTokens = tokenize((question ?: "") + " " + cardNames.joinToString(" ")).toSet()

    data class Scored(val item: ProphecyItem, val weight: Int, val ov: Int, val ts: Long)

    val resolvedScored = resolved
        .filter { it.foretelling.isNotEmpty() }
        .map { r ->
            val kind = (r.verdict?.let { VERDICT_KIND[it] }) ?: "fulfilled"
            val weight = (r.verdict?.let { VERDICT_WEIGHT[it] }) ?: 1
            Scored(
                ProphecyItem(r.predictionId, kind, r.verdict, r.foretelling, r.outcome.ifEmpty { null },
                    resolvedFact(kind, r.foretelling, r.outcome.ifEmpty { null })),
                weight,
                prophecyOverlap(queryTokens, "${r.foretelling} ${r.outcome}"),
                r.resolvedAt
            )
        }
        .sortedWith(compareByDescending<Scored> { it.weight }.thenByDescending { it.ov }.thenByDescending { it.ts })

    val openScored = open
        .filter { it.content.isNotEmpty() }
        .map { o ->
            Scored(
                ProphecyItem(o.id, "open", null, o.content, null, openFact(o.content)),
                0,
                prophecyOverlap(queryTokens, o.content),
                o.createdAt
            )
        }
        .sortedWith(compareByDescending<Scored> { it.ov }.thenByDescending { it.ts })

    val all = (resolvedScored + openScored).map { it.item }
    return filterProphecySurfaced(all, surfaced, now, ttlDays).take(3)
}

fun filterProphecySurfaced(
    items: List<ProphecyItem>,
    surfaced: Map<String, Long>,
    now: Long,
    ttlDays: Int = PROPHECY_SURFACE_TTL_DAYS
): List<ProphecyItem> {
    val ttl = ttlDays * 86400L
    return items.filter { item ->
        val last = surfaced[item.id.toString()]
        !(last != null && (now - last) < ttl)
    }
}

fun buildProphecyBlock(items: List<ProphecyItem>): String {
    if (items.isEmpty()) return ""
    val header = "Foretellings you have made for this person and how they have stood " +
        "(reference one only when a card or theme in front of you genuinely connects to it; " +
        "name the specific foretelling and how it turned out; speak with quiet, earned confidence " +
        "when one came to pass, and with honesty when one did not; never recite these as a list, " +
        "and never inflate your record):"
    return "\n\n" + header + "\n" + items.joinToString("\n") { "- ${it.fact}" }
}
```

Note: the web `_ov` uses ``overlap(queryTokens, `${foretelling} ${outcome||''}`)``; here `r.outcome` is a non-null String (Slice C), so `"${r.foretelling} ${r.outcome}"` is equivalent (empty outcome contributes no tokens). `r.outcome.ifEmpty { null }` is passed to `ProphecyItem.outcome` and `resolvedFact` so an empty outcome behaves as "no outcome" (matching the web `outcome ? ... : ...` truthiness).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `& "C:\Users\Matt\projects\TarotApp\gradlew.bat" -p "C:\Users\Matt\projects\TarotApp" testDebugUnitTest`
Expected: PASS — all `prophecy_*`, `filterProphecySurfaced_*`, `buildProphecyBlock_*` green, plus the pre-existing suite (42+ tests).

- [ ] **Step 5: Add `getOpenPredictions` to MemoryStore.kt**

Insert directly after the `getResolvedPredictions` function (added in Slice C) in `app/src/main/java/com/matt/tarot/MemoryStore.kt`:

```kotlin
    // Still-open predictions, newest first. Faithful port of data/memory-store.js
    // stmtOpenPredictions. Returns MemoryRow (callers read id, content, created_at).
    fun getOpenPredictions(slug: String, limit: Int = 12): List<MemoryRow> {
        val out = ArrayList<MemoryRow>()
        readableDatabase.rawQuery(
            "SELECT * FROM memories WHERE reader_slug = ? AND type = 'prediction' AND status = 'open' ORDER BY created_at DESC LIMIT ?",
            arrayOf(slug, limit.toString())
        ).use { c -> while (c.moveToNext()) out.add(rowFrom(c)) }
        return out
    }
```

- [ ] **Step 6: Compile gate**

Run: `& "C:\Users\Matt\projects\TarotApp\gradlew.bat" -p "C:\Users\Matt\projects\TarotApp" assembleDebug`
Expected: BUILD SUCCESSFUL.

- [ ] **Step 7: Verify added lines are ASCII-clean**

Run (Git Bash): `LC_ALL=C grep -nP '[^\x00-\x7F]' app/src/main/java/com/matt/tarot/MemoryModel.kt app/src/main/java/com/matt/tarot/MemoryStore.kt`
Expected: no matches among the lines you added (any pre-existing box-drawing dividers in MemoryStore.kt must NOT be a line you added).

- [ ] **Step 8: Commit**

```bash
git add app/src/main/java/com/matt/tarot/MemoryModel.kt \
        app/src/test/java/com/matt/tarot/MemoryModelTest.kt \
        app/src/main/java/com/matt/tarot/MemoryStore.kt
git commit -m "feat(android): prophecy ranking/format logic + getOpenPredictions (Slice D task 1)"
```

---

## Task 2: `ProphecyWeaving.kt` + MemoryEngine delegators

**Files:**
- Create: `app/src/main/java/com/matt/tarot/ProphecyWeaving.kt`
- Modify: `app/src/main/java/com/matt/tarot/MemoryEngine.kt`

**Interfaces:**
- Consumes (Task 1): `findProphecyCallbacks`, `buildProphecyBlock`, `ProphecyResult`, `PROPHECY_SURFACE_TTL_DAYS`, `MemoryStore.getResolvedPredictions`/`getOpenPredictions`.
- Produces (Task 3): `MemoryEngine.prophecyBlock(slug: String, cardNames: List<String>, question: String?, now: Long): ProphecyResult`; `MemoryEngine.markProphecySurfaced(slug: String, ids: List<Long>, now: Long)`.

- [ ] **Step 1: Create `ProphecyWeaving.kt`**

Create `app/src/main/java/com/matt/tarot/ProphecyWeaving.kt` (mirrors `EmotionalSeasons.kt`'s surfaced-map pattern; shares the single store):

```kotlin
package com.matt.tarot

import android.util.Log
import org.json.JSONObject

// Prophecy weaving. Port of data/prophecy-recall.js + the server.js interpret integration.
// Shares MemoryEngine's single MemoryStore so there is one SQLite connection.
// Best-effort: a DB failure never breaks a reading. Time in unix SECONDS (web uses ms;
// the dedup map here is seconds, like season_surfaced).
class ProphecyWeaving(private val store: MemoryStore) {
    companion object { private const val TAG = "ProphecyWeaving" }

    private val prophecyTtlS = PROPHECY_SURFACE_TTL_DAYS.toLong() * 86400

    // Read surfaced dedup + rank the foretellings for this reading. Returns the persona
    // block and the ids actually shown (to stamp after the reading succeeds).
    fun pending(slug: String, cardNames: List<String>, question: String?, now: Long): ProphecyResult {
        return try {
            val surfaced = readSurfaced(slug)
            val items = findProphecyCallbacks(
                store.getResolvedPredictions(slug, 12),
                store.getOpenPredictions(slug, 12),
                cardNames, question, surfaced, now
            )
            ProphecyResult(buildProphecyBlock(items), items.map { it.id })
        } catch (e: Exception) {
            Log.w(TAG, "prophecy pending failed: ${e.message}")
            ProphecyResult("", emptyList())
        }
    }

    // Prune expired entries, stamp the shown ids. Called only after a reading succeeded.
    fun markSurfaced(slug: String, shownIds: List<Long>, now: Long) {
        val surfaced = HashMap(readSurfaced(slug))
        surfaced.entries.removeAll { (now - it.value) >= prophecyTtlS }
        for (id in shownIds) surfaced[id.toString()] = now
        writeSurfaced(slug, surfaced)
    }

    private fun readSurfaced(slug: String): Map<String, Long> {
        val raw = store.getMeta("prophecy_surfaced:$slug") ?: return emptyMap()
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
        store.setMeta("prophecy_surfaced:$slug", o.toString())
    }
}
```

- [ ] **Step 2: Add the delegators to MemoryEngine.kt**

In `app/src/main/java/com/matt/tarot/MemoryEngine.kt`:

First, add the field next to the existing `private val seasons = EmotionalSeasons(store)`:

```kotlin
    private val prophecy = ProphecyWeaving(store)
```

Then add the two delegators alongside the other delegators (e.g. after `recurringThemeBlock`, before the class closing brace):

```kotlin
    fun prophecyBlock(slug: String, cardNames: List<String>, question: String?, now: Long): ProphecyResult =
        prophecy.pending(slug, cardNames, question, now)

    fun markProphecySurfaced(slug: String, ids: List<Long>, now: Long) =
        prophecy.markSurfaced(slug, ids, now)
```

- [ ] **Step 3: Compile gate**

Run: `& "C:\Users\Matt\projects\TarotApp\gradlew.bat" -p "C:\Users\Matt\projects\TarotApp" assembleDebug`
Expected: BUILD SUCCESSFUL.

- [ ] **Step 4: Verify added lines are ASCII-clean**

Run (Git Bash): `LC_ALL=C grep -nP '[^\x00-\x7F]' app/src/main/java/com/matt/tarot/ProphecyWeaving.kt app/src/main/java/com/matt/tarot/MemoryEngine.kt`
Expected: no matches.

- [ ] **Step 5: Commit**

```bash
git add app/src/main/java/com/matt/tarot/ProphecyWeaving.kt \
        app/src/main/java/com/matt/tarot/MemoryEngine.kt
git commit -m "feat(android): ProphecyWeaving orchestration + engine delegators (Slice D task 2)"
```

---

## Task 3: `handleInterpret` wiring + version bump

**Files:**
- Modify: `app/src/main/java/com/matt/tarot/TarotServer.kt` (systemPrompt at line 749; success point after `callClaude` at line 855)
- Modify: `app/build.gradle:14-15`

**Interfaces:**
- Consumes (Task 2): `memory.prophecyBlock(slug, cardNames, question, now): ProphecyResult`; `memory.markProphecySurfaced(slug, ids, now)`; `ProphecyResult(block, shownIds)`.

- [ ] **Step 1: Compute the prophecy block and append it to the system prompt**

In `app/src/main/java/com/matt/tarot/TarotServer.kt`, find the current systemPrompt construction (line 749):

```kotlin
        val systemPrompt = READER_PERSONA + buildAddressingNote(readerName) + memoryBlock + memory.recurringThemeBlock(slug) + buildPatternBlock(slug, cards)
```

Replace it with (the `cardNames` and `question` vals already exist above in this function at lines ~740 and ~730):

```kotlin
        val pNow = System.currentTimeMillis() / 1000
        val prophecy = memory.prophecyBlock(slug, cardNames, question, pNow)
        val systemPrompt = READER_PERSONA + buildAddressingNote(readerName) + memoryBlock + memory.recurringThemeBlock(slug) + buildPatternBlock(slug, cards) + prophecy.block
```

- [ ] **Step 2: Stamp the surfaced ids after a successful reading**

Still in `handleInterpret`, find the LLM call + return (lines 855-856):

```kotlin
        val text = callClaude(apiKey, claudeBody) ?: return errorResponse(500, "Claude API call failed")
        return jsonResponse(JSONObject().put("interpretation", text))
```

Replace with:

```kotlin
        val text = callClaude(apiKey, claudeBody) ?: return errorResponse(500, "Claude API call failed")
        if (prophecy.shownIds.isNotEmpty()) {
            try { memory.markProphecySurfaced(slug, prophecy.shownIds, pNow) }
            catch (e: Exception) { Log.w(TAG, "prophecy surfaced write-back failed: ${e.message}") }
        }
        return jsonResponse(JSONObject().put("interpretation", text))
```

- [ ] **Step 3: Bump the version**

In `app/build.gradle`, change lines 14-15:

```groovy
        versionCode 7
        versionName "1.7"
```

(from `versionCode 6` / `versionName "1.6"`.)

- [ ] **Step 4: Compile gate**

Run: `& "C:\Users\Matt\projects\TarotApp\gradlew.bat" -p "C:\Users\Matt\projects\TarotApp" assembleDebug`
Expected: BUILD SUCCESSFUL.

- [ ] **Step 5: Verify added lines are ASCII-clean**

Run (Git Bash): `LC_ALL=C grep -nP '[^\x00-\x7F]' app/src/main/java/com/matt/tarot/TarotServer.kt`
Expected: any hits are PRE-EXISTING (persona em dash, box-drawing dividers, ellipsis) and NOT among the lines you added (the `pNow`/`prophecy` lines, the `markProphecySurfaced` block).

- [ ] **Step 6: Commit**

```bash
git add app/src/main/java/com/matt/tarot/TarotServer.kt app/build.gradle
git commit -m "feat(android): weave prophecy block into interpret + bump to 1.7 (Slice D task 3)"
```

---

## Self-Review (completed)

**1. Spec coverage:**
- `ProphecyItem`/`ProphecyResult`, constants, `resolvedFact`/`openFact`, `prophecyOverlap` (uncapped, reusing `tokenize`), `findProphecyCallbacks` (verdict-weight -> overlap -> recency; resolved before open; cap 3), `filterProphecySurfaced` (seconds TTL, string-keyed), `buildProphecyBlock` -> Task 1, Steps 1-4. ✓
- `MemoryStore.getOpenPredictions` -> Task 1, Step 5. ✓
- `ProphecyWeaving.kt` (shared store, seconds dedup, best-effort) + MemoryEngine delegators -> Task 2. ✓
- `handleInterpret` block injection after patternBlock + `markProphecySurfaced` after success + version bump -> Task 3. ✓
- Seconds-not-ms adaptation -> Global Constraints + `prophecyTtlS`/`pNow`. ✓
- On-device smoke (real data; resolve one foretelling for the resolved arm; dedup) -> human gate after merge, not a code task. ✓

**2. Placeholder scan:** No TBD/TODO/vague steps; every code step shows complete code. ✓

**3. Type consistency:** `ProphecyItem`/`ProphecyResult` field names identical across definition, `findProphecyCallbacks`, `ProphecyWeaving`, and `handleInterpret`. `findProphecyCallbacks` and `filterProphecySurfaced` signatures match between definition and call sites (Task 2). `prophecyBlock(slug, cardNames, question, now)` / `markProphecySurfaced(slug, ids, now)` consistent between MemoryEngine (Task 2) and TarotServer (Task 3). `getOpenPredictions` returns `List<MemoryRow>`, consumed as such. ✓
