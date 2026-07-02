# Android Reader Profile Synthesis + Persona Injection (Slice G1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every Android reading warmth-tiered and (past 10 readings) shaped by a synthesized reader profile, refreshed in the background after saves -- a faithful port of `data/reader-profile.js` and its five `server.js` persona-injection sites. The notebook DISPLAY surface is out of scope (that is G2).

**Architecture:** Pure tier/persona/parse logic in `MemoryModel.kt` (JVM-testable). A new flat-JSON `ReaderProfile.kt` (owned by TarotServer, NOT SQLite) does profile IO + the two LLM syntheses. TarotServer wraps `readerProfile.persona(...)` into the five reader-relationship LLM call sites and fires refresh + living-note on background threads after a save.

**Tech Stack:** Kotlin, Android SQLite (untouched here), NanoHTTPD, `org.json`, JUnit4. Build via Android Studio's bundled JBR from CLI.

## Global Constraints

- **ASCII only** in every added/model-facing line. Verify with `LANG=C.UTF-8 grep -nP '[^\x00-\x7F]' <file>` (plain `LC_ALL=C` makes `grep -P` error here). MemoryModel.kt / ReaderProfile.kt must be fully clean; TarotServer.kt has PRE-EXISTING non-ASCII (persona em dash, box-drawing dividers, ellipsis) OUT OF SCOPE -- only ADDED lines must be ASCII.
- **Local only** -- never push. TarotApp has no remote. All commits local.
- **Time is unix SECONDS** (`System.currentTimeMillis() / 1000`).
- **ReaderProfile is flat-JSON** (profiles/<slug>.json) -- it does NOT construct or touch a SQLite MemoryStore.
- **Faithful port** -- `data/reader-profile.js` and the five `server.js` `buildPersonaWithProfile` call sites + the save-reading refresh/living-note cadence are the source of truth.
- **Build/test (Windows):** `JAVA_HOME="C:/Program Files/Android/Android Studio/jbr" "C:/Users/Matt/projects/TarotApp/gradlew.bat" -p "C:/Users/Matt/projects/TarotApp" <task>` (gradlew.bat only; up to 600000 ms). Tasks: `testDebugUnitTest`, `assembleDebug`.

## Existing pieces this plan consumes

- `MemoryModel`: `const val HAIKU = "claude-haiku-4-5-20251001"`; imports `org.json.JSONObject`/`org.json.JSONArray`.
- `MemoryEngine`: `typealias CallLLM = (system: String, prompt: String, maxTokens: Int, model: String) -> String?`.
- `TarotServer`: `dataDir: File`, `readingsDir = File(dataDir, "readings")`, `loadReadingList(slug): List<JSONObject>`, `loadReaders()`, `readerNameFor(readers, slug)`, `buildAddressingNote(readerName)`, `buildCompatAddressingNote(readerName, aName, bName)`, `memoryCallLLM` (matches CallLLM), `TAG`, `READER_PERSONA`, the reading model literal `"claude-sonnet-4-6"`.

---

## File Structure

- `app/src/main/java/com/matt/tarot/MemoryModel.kt` (MODIFY) -- pure tiers, WARMTH_NOTES, buildPersonaWithProfile, extract/parse helpers, PROFILE_T2/T3.
- `app/src/test/java/com/matt/tarot/MemoryModelTest.kt` (MODIFY) -- JVM tests.
- `app/src/main/java/com/matt/tarot/ReaderProfile.kt` (CREATE) -- profile IO + refreshReaderProfile + updateLivingNote + persona wrapper.
- `app/src/main/java/com/matt/tarot/TarotServer.kt` (MODIFY) -- readerProfile field, 5 persona injections, save cadence.
- `app/build.gradle` (MODIFY) -- version 9 -> 10 / "1.9" -> "1.10".

---

## Task 1: Pure tier/persona/parse logic + tests

**Files:**
- Modify: `app/src/main/java/com/matt/tarot/MemoryModel.kt`
- Test: `app/src/test/java/com/matt/tarot/MemoryModelTest.kt`

**Interfaces (produced, consumed by Tasks 2-3):**
- `const val PROFILE_T2 = 10`, `const val PROFILE_T3 = 30`
- `fun getTier(readingCount: Int): Int`
- `fun getWarmthTier(readingCount: Int): Int`
- `val WARMTH_NOTES: Map<Int, String>`
- `fun buildPersonaWithProfile(basePersona: String, profile: JSONObject?, readingCount: Int, currentCards: List<JSONObject>): String`
- `fun extractProfileLabel(raw: String, label: String): String`
- `fun extractProfileJSONArray(raw: String, label: String): JSONArray`
- `fun parseProfileSynthesis(raw: String, slug: String, readingCount: Int, nowSeconds: Long): JSONObject?`

- [ ] **Step 1: Write the failing tests**

First add the JUnit assertion imports these tests need (the file currently imports only `assertEquals`, `assertTrue`, `Test`). Add near the existing imports:

```kotlin
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
```

Then append to the end of `app/src/test/java/com/matt/tarot/MemoryModelTest.kt`, before the closing brace (`org.json.JSONObject`/`JSONArray` already imported):

```kotlin
    // --- Reader profile (Slice G1) ---
    @Test fun getTier_boundaries() {
        assertEquals(1, getTier(0)); assertEquals(1, getTier(9))
        assertEquals(2, getTier(10)); assertEquals(2, getTier(29))
        assertEquals(3, getTier(30)); assertEquals(3, getTier(100))
    }

    @Test fun getWarmthTier_boundaries() {
        assertEquals(1, getWarmthTier(0)); assertEquals(1, getWarmthTier(1))
        assertEquals(2, getWarmthTier(2)); assertEquals(2, getWarmthTier(5))
        assertEquals(3, getWarmthTier(6)); assertEquals(3, getWarmthTier(20))
        assertEquals(4, getWarmthTier(21)); assertEquals(4, getWarmthTier(59))
        assertEquals(5, getWarmthTier(60))
    }

    @Test fun persona_tier1_warmth_only_no_profile_leak() {
        val p = buildPersonaWithProfile("BASE", null, 1, emptyList())
        assertTrue(p.startsWith("BASE"))
        assertTrue(p.contains("one of your very first readings"))
        assertFalse(p.contains("From your prior readings"))
    }

    @Test fun persona_below_synth_tier_ignores_profile() {
        val prof = JSONObject().put("miriel_notes", "SECRET NOTES")
        val p = buildPersonaWithProfile("BASE", prof, 5, emptyList()) // tier 1, warmth 2
        assertTrue(p.contains("handful of times"))
        assertFalse(p.contains("SECRET NOTES"))
    }

    @Test fun persona_tier2_adds_miriel_notes_not_life_arc() {
        val prof = JSONObject().put("miriel_notes", "NOTES_HERE")
            .put("life_arc", JSONObject().put("current_chapter", "CHAP"))
        val p = buildPersonaWithProfile("BASE", prof, 10, emptyList()) // getTier 2
        assertTrue(p.contains("From your prior readings with this person:\nNOTES_HERE"))
        assertFalse(p.contains("Their current chapter"))
    }

    @Test fun persona_tier3_adds_life_arc_and_unresolved() {
        val prof = JSONObject().put("miriel_notes", "N")
            .put("life_arc", JSONObject().put("current_chapter", "CHAP"))
            .put("unresolved_thread", "UNRES")
        val p = buildPersonaWithProfile("BASE", prof, 30, emptyList()) // getTier 3
        assertTrue(p.contains("Their current chapter: CHAP"))
        assertTrue(p.contains("What has not resolved: UNRES"))
    }

    @Test fun persona_recurring_card_matches_by_id() {
        val prof = JSONObject().put("miriel_notes", "N").put("recurring_cards",
            JSONArray().put(JSONObject().put("card", "The Tower").put("card_id", "major-16").put("note", "upheaval")))
        val cards = listOf(JSONObject().put("id", "major-16").put("name", "The Tower"))
        val p = buildPersonaWithProfile("BASE", prof, 30, cards)
        assertTrue(p.contains("This person has drawn these cards many times before: The Tower (upheaval)"))
        // non-matching card -> no recurring note
        val p2 = buildPersonaWithProfile("BASE", prof, 30, listOf(JSONObject().put("id", "major-1")))
        assertFalse(p2.contains("drawn these cards many times before"))
    }

    @Test fun parseProfileSynthesis_tier2_shape() {
        val raw = "MIRIEL_NOTES:\nThey are searching.\n\nRECURRING_CARDS:\n[{\"card\":\"The Star\",\"card_id\":\"major-17\",\"count\":3,\"note\":\"hope\"}]"
        val prof = parseProfileSynthesis(raw, "matt", 12, 1000L)
        assertNotNull(prof)
        assertEquals("matt", prof!!.optString("slug"))
        assertEquals(12, prof.optInt("readings_synthesized"))
        assertEquals("They are searching.", prof.optString("miriel_notes"))
        assertEquals(1, prof.optJSONArray("recurring_cards").length())
        assertFalse(prof.has("life_arc")) // tier 2
    }

    @Test fun parseProfileSynthesis_tier3_shape() {
        val raw = "MIRIEL_NOTES:\nA long story.\n\nLIFE_ARC_CHAPTER:\nRebuilding.\n\nKEY_THREADS:\n[{\"theme\":\"work\",\"status\":\"open\"}]\n\nINFLECTION_POINTS:\nThe move.\n\nUNRESOLVED_THREAD:\nBelonging.\n\nRECURRING_CARDS:\n[]"
        val prof = parseProfileSynthesis(raw, "matt", 40, 1000L)
        assertNotNull(prof)
        assertEquals("Rebuilding.", prof!!.optJSONObject("life_arc").optString("current_chapter"))
        assertEquals("Belonging.", prof.optString("unresolved_thread"))
        assertEquals(1, prof.optJSONObject("life_arc").optJSONArray("key_threads").length())
    }

    @Test fun parseProfileSynthesis_degraded_returns_null() {
        assertNull(parseProfileSynthesis("no labels here", "matt", 12, 1000L))
        assertNull(parseProfileSynthesis("MIRIEL_NOTES:\n\nRECURRING_CARDS:\n[]", "matt", 12, 1000L))
    }

    @Test fun extractProfileLabel_stops_at_next_label() {
        val raw = "MIRIEL_NOTES:\nline one\nline two\n\nRECURRING_CARDS:\n[]"
        assertEquals("line one\nline two", extractProfileLabel(raw, "MIRIEL_NOTES"))
        assertEquals(0, extractProfileJSONArray(raw, "RECURRING_CARDS").length())
    }
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `& "C:\Users\Matt\projects\TarotApp\gradlew.bat" -p "C:\Users\Matt\projects\TarotApp" testDebugUnitTest`
Expected: FAIL -- unresolved references `getTier`, `getWarmthTier`, `buildPersonaWithProfile`, `parseProfileSynthesis`, `extractProfileLabel`, `extractProfileJSONArray`.

- [ ] **Step 3: Implement the pure logic in MemoryModel.kt**

Append to the end of `app/src/main/java/com/matt/tarot/MemoryModel.kt`:

```kotlin
// -- Reader profile (Slice G1) ----------------------------------------------
// Pure port of data/reader-profile.js tier + persona + synthesis-parse logic.
const val PROFILE_T2 = 10
const val PROFILE_T3 = 30

fun getTier(readingCount: Int): Int =
    if (readingCount >= PROFILE_T3) 3 else if (readingCount >= PROFILE_T2) 2 else 1

// Warmth tiers are SEPARATE from getTier; they only color the voice by relationship depth.
fun getWarmthTier(readingCount: Int): Int {
    val c = readingCount
    return when {
        c >= 60 -> 5
        c >= 21 -> 4
        c >= 6  -> 3
        c >= 2  -> 2
        else    -> 1
    }
}

val WARMTH_NOTES: Map<Int, String> = mapOf(
    1 to "\n\nThis is one of your very first readings for this person, perhaps the first. You don't know them yet. Be warm and genuinely welcoming, curious about who they are, but don't pretend to a shared history you don't have.",
    2 to "\n\nYou've read for this person a handful of times now. You're beginning to recognize them, their face, the shape of what they tend to bring. A little familiarity is forming; let it show.",
    3 to "\n\nYou've read for this person many times. You know their recurring threads and how certain cards tend to land for them. Reference what you know naturally, the way you would with someone whose story you've been following.",
    4 to "\n\nThis person returns to you often. There's real warmth and shorthand between you now, you can pick up threads mid-stream and refer back to past readings without re-explaining. You're glad when they sit down across from you.",
    5 to "\n\nYou have known this person across a great many readings. You don't re-introduce yourself or your way of working, the relationship is already deep. Greet and read them like someone you've known for years and are genuinely glad to see again. Your uncanny accuracy with them comes from how well you know them."
)

fun buildPersonaWithProfile(basePersona: String, profile: JSONObject?, readingCount: Int, currentCards: List<JSONObject>): String {
    var persona = basePersona + (WARMTH_NOTES[getWarmthTier(readingCount)] ?: "")
    if (profile == null) return persona
    val synthTier = getTier(readingCount)
    if (synthTier < 2) return persona

    val currentIds = currentCards.map { it.optString("id") }.filter { it.isNotEmpty() }.toSet()
    val recurring = profile.optJSONArray("recurring_cards") ?: JSONArray()
    val matching = (0 until recurring.length()).mapNotNull { recurring.optJSONObject(it) }
        .filter { currentIds.contains(it.optString("card_id")) }
    val recurringNote = if (matching.isNotEmpty())
        "\n\nThis person has drawn these cards many times before: " +
        matching.joinToString("; ") { "${it.optString("card")} (${it.optString("note")})" } +
        ". You already know how these cards tend to land for them."
    else ""

    val mirielNotes = profile.optString("miriel_notes")
    if (mirielNotes.isNotEmpty()) persona += "\n\nFrom your prior readings with this person:\n$mirielNotes"
    val lifeArc = profile.optJSONObject("life_arc")
    if (lifeArc != null && synthTier >= 3) {
        persona += "\n\nTheir current chapter: ${lifeArc.optString("current_chapter")}\n\nWhat has not resolved: ${profile.optString("unresolved_thread")}"
    }
    return persona + recurringNote
}

// Label extractor: lookahead stops at the next uppercase LABEL: or end of string.
fun extractProfileLabel(raw: String, label: String): String {
    val re = Regex("$label:\\s*([\\s\\S]*?)(?=\\n[A-Z][A-Z_]+:|$)", RegexOption.IGNORE_CASE)
    return re.find(raw)?.groupValues?.getOrNull(1)?.trim() ?: ""
}

fun extractProfileJSONArray(raw: String, label: String): JSONArray =
    try { JSONArray(extractProfileLabel(raw, label)) } catch (e: Exception) { JSONArray() }

fun parseProfileSynthesis(raw: String, slug: String, readingCount: Int, nowSeconds: Long): JSONObject? {
    val mirielNotes = extractProfileLabel(raw, "MIRIEL_NOTES")
    if (mirielNotes.isEmpty()) return null // do not persist a degraded profile
    val profile = JSONObject()
        .put("slug", slug)
        .put("last_updated", nowSeconds)
        .put("readings_synthesized", readingCount)
        .put("miriel_notes", mirielNotes)
        .put("recurring_cards", extractProfileJSONArray(raw, "RECURRING_CARDS"))
    if (getTier(readingCount) == 3) {
        profile.put("life_arc", JSONObject()
            .put("current_chapter", extractProfileLabel(raw, "LIFE_ARC_CHAPTER"))
            .put("key_threads", extractProfileJSONArray(raw, "KEY_THREADS"))
            .put("inflection_points", extractProfileLabel(raw, "INFLECTION_POINTS")))
        profile.put("unresolved_thread", extractProfileLabel(raw, "UNRESOLVED_THREAD"))
    }
    return profile
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `& "C:\Users\Matt\projects\TarotApp\gradlew.bat" -p "C:\Users\Matt\projects\TarotApp" testDebugUnitTest`
Expected: PASS -- all new profile tests plus the pre-existing suite.

- [ ] **Step 5: Compile gate**

Run: `& "C:\Users\Matt\projects\TarotApp\gradlew.bat" -p "C:\Users\Matt\projects\TarotApp" assembleDebug`
Expected: BUILD SUCCESSFUL.

- [ ] **Step 6: Verify added lines are ASCII-clean**

Run (Git Bash): `LANG=C.UTF-8 grep -nP '[^\x00-\x7F]' app/src/main/java/com/matt/tarot/MemoryModel.kt`
Expected: no matches.

- [ ] **Step 7: Commit**

```bash
git add app/src/main/java/com/matt/tarot/MemoryModel.kt app/src/test/java/com/matt/tarot/MemoryModelTest.kt
git commit -m "feat(android): pure reader-profile tier/persona/parse logic + tests (Slice G1 task 1)"
```

---

## Task 2: ReaderProfile.kt (profile IO + LLM synthesis + living note)

**Files:**
- Create: `app/src/main/java/com/matt/tarot/ReaderProfile.kt`

**Interfaces:**
- Consumes (Task 1): `getTier`, `PROFILE_T2`, `buildPersonaWithProfile`, `parseProfileSynthesis`, `HAIKU`, `CallLLM`.
- Produces (Task 3):
  - `ReaderProfile(dataDir: File)`
  - `loadReaderProfile(slug: String): JSONObject?`
  - `persona(basePersona: String, slug: String, cards: List<JSONObject>): String`
  - `refreshReaderProfile(slug: String, callLLM: CallLLM)`
  - `updateLivingNote(slug: String, callLLM: CallLLM)`

- [ ] **Step 1: Create ReaderProfile.kt**

Create `app/src/main/java/com/matt/tarot/ReaderProfile.kt`:

```kotlin
package com.matt.tarot

import android.util.Log
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

// Faithful port of data/reader-profile.js. Flat-JSON (profiles/<slug>.json), NOT SQLite.
// Owned by TarotServer. Every public method is best-effort: a failure never breaks a reading or a save.
class ReaderProfile(dataDir: File) {
    companion object {
        private const val TAG = "ReaderProfile"
        private const val SYNTH_SYSTEM = "You are Miriel, an experienced tarot reader."
        private const val LIVING_NOTE_SYSTEM =
            "You are Miriel, an experienced tarot reader keeping a private running note on the person you read for. " +
            "In your own voice and the second person (\"you\"), write one or two sentences on where things stand for them " +
            "right now, drawing on their most recent readings. Present tense, warm, specific. Speak to them as \"you\", " +
            "never name them or use the third person. No preamble or label, just the note."
    }

    private val profilesDir = File(dataDir, "profiles").apply { mkdirs() }
    private val readingsDir = File(dataDir, "readings")

    fun loadReaderProfile(slug: String): JSONObject? {
        return try {
            val f = File(profilesDir, "$slug.json")
            if (f.exists()) JSONObject(f.readText()) else null
        } catch (e: Exception) { null }
    }

    private fun saveReaderProfile(slug: String, profile: JSONObject) {
        File(profilesDir, "$slug.json").writeText(profile.toString(2))
    }

    private fun loadReadingsArray(slug: String): JSONArray {
        return try {
            val f = File(readingsDir, "$slug.json")
            if (f.exists()) JSONArray(f.readText()) else JSONArray()
        } catch (e: Exception) { JSONArray() }
    }

    private fun readingCount(slug: String): Int = loadReadingsArray(slug).length()

    // IO convenience wrapper used at every persona call site. Best-effort -> basePersona.
    fun persona(basePersona: String, slug: String, cards: List<JSONObject>): String {
        return try {
            buildPersonaWithProfile(basePersona, loadReaderProfile(slug), readingCount(slug), cards)
        } catch (e: Exception) {
            Log.w(TAG, "persona build failed: ${e.message}")
            basePersona
        }
    }

    private fun cardsLine(r: JSONObject, withPosition: Boolean): String {
        val arr = r.optJSONArray("cards") ?: return ""
        return (0 until arr.length()).mapNotNull { arr.optJSONObject(it) }.joinToString(", ") { c ->
            val pos = if (withPosition) c.optString("position").let { if (it.isNotEmpty()) "$it: " else "" } else ""
            val rev = if (c.optBoolean("isReversed")) " (reversed)" else ""
            "$pos${c.optString("name")}$rev"
        }
    }

    fun refreshReaderProfile(slug: String, callLLM: CallLLM) {
        try {
            val readings = loadReadingsArray(slug)
            val n = readings.length()
            if (n < PROFILE_T2) return
            val tier = getTier(n)
            val readingsText = (0 until n).joinToString("\n\n") { i ->
                val r = readings.getJSONObject(i)
                val cardList = cardsLine(r, true).ifEmpty { "" }
                val deck = r.optString("deckLabel").ifEmpty { r.optString("deck").ifEmpty { "tarot" } }
                val spread = r.optString("spread").ifEmpty { "unknown spread" }
                val date = r.optString("date").ifEmpty { "unknown date" }
                val q = r.optString("question").let { if (it.isNotEmpty()) ", question: \"$it\"" else "" }
                val syn = r.optString("synopsis").let { if (it.isNotEmpty()) "\nNotes: ${it.take(200)}" else "" }
                "$date -- $deck, $spread$q\nCards: $cardList$syn"
            }
            val userPrompt = if (tier == 2)
                "You have been reading for this person across $n sessions. Below is the complete history of their readings with you.\n\n$readingsText\n\nWrite your notes using these exact labels:\n\nMIRIEL_NOTES:\n[2 paragraphs in your own voice -- what patterns are you starting to notice?]\n\nRECURRING_CARDS:\n[JSON array: [{\"card\":\"name\",\"card_id\":\"id\",\"count\":N,\"note\":\"how it tends to land\"}] -- top 3 only, or []]"
            else
                "You have been reading for this person across $n sessions over time. Read this history the way you would read a long relationship -- not as data, but as a story.\n\n$readingsText\n\nWrite your notes using these exact labels:\n\nMIRIEL_NOTES:\n[2-3 paragraphs in your own voice. What do you actually know about this person from the cards?]\n\nLIFE_ARC_CHAPTER:\n[1-2 sentences: what is the current period about for them?]\n\nKEY_THREADS:\n[JSON array: [{\"theme\":\"...\",\"status\":\"open|moving|resolved\"}] -- 2-3 most significant]\n\nINFLECTION_POINTS:\n[1-2 sentences on any clear before/after moment, or leave blank]\n\nUNRESOLVED_THREAD:\n[The one thing that keeps surfacing without resolution]\n\nRECURRING_CARDS:\n[JSON array: [{\"card\":\"name\",\"card_id\":\"id\",\"count\":N,\"note\":\"how it tends to land\"}] -- top 5, or []]"

            val raw = callLLM(SYNTH_SYSTEM, userPrompt, 1500, "claude-sonnet-4-6") ?: return
            val profile = parseProfileSynthesis(raw, slug, n, System.currentTimeMillis() / 1000) ?: return
            // Preserve the living note (maintained on a faster cadence) across a full re-synthesis.
            val prev = loadReaderProfile(slug)
            if (prev != null && prev.has("living_note")) {
                profile.put("living_note", prev.opt("living_note"))
                profile.put("living_note_updated", prev.opt("living_note_updated"))
            }
            saveReaderProfile(slug, profile)
            Log.i(TAG, "profile refreshed slug=$slug tier=$tier readings=$n")
        } catch (e: Exception) {
            Log.w(TAG, "refreshReaderProfile failed: ${e.message}")
        }
    }

    fun updateLivingNote(slug: String, callLLM: CallLLM) {
        try {
            val readings = loadReadingsArray(slug)
            val n = readings.length()
            if (n == 0) return
            val block = (maxOf(0, n - 3) until n).joinToString("\n\n") { i ->
                val r = readings.getJSONObject(i)
                val cards = cardsLine(r, false)
                val head = r.optString("question").let { if (it.isNotEmpty()) "\"$it\"" else "no question" }
                val syn = r.optString("synopsis").let { if (it.isNotEmpty()) "\n${it.take(400)}" else "" }
                "${r.optString("date")} -- $head\nCards: $cards$syn"
            }
            val note = (callLLM(LIVING_NOTE_SYSTEM,
                "The most recent readings with this person:\n\n$block\n\nWrite your running note now (1-2 sentences, second person \"you\").",
                200, HAIKU) ?: return).trim()
            if (note.isEmpty()) return
            val profile = loadReaderProfile(slug) ?: JSONObject().put("slug", slug)
            profile.put("living_note", note)
            profile.put("living_note_updated", System.currentTimeMillis() / 1000)
            saveReaderProfile(slug, profile)
            Log.i(TAG, "living note updated slug=$slug")
        } catch (e: Exception) {
            Log.w(TAG, "updateLivingNote failed: ${e.message}")
        }
    }
}
```

- [ ] **Step 2: Compile gate**

Run: `& "C:\Users\Matt\projects\TarotApp\gradlew.bat" -p "C:\Users\Matt\projects\TarotApp" assembleDebug`
Expected: BUILD SUCCESSFUL.

- [ ] **Step 3: Verify added lines are ASCII-clean**

Run (Git Bash): `LANG=C.UTF-8 grep -nP '[^\x00-\x7F]' app/src/main/java/com/matt/tarot/ReaderProfile.kt`
Expected: no matches.

- [ ] **Step 4: Commit**

```bash
git add app/src/main/java/com/matt/tarot/ReaderProfile.kt
git commit -m "feat(android): ReaderProfile IO + LLM synthesis + living note (Slice G1 task 2)"
```

---

## Task 3: Persona injection (5 sites) + save cadence + version bump

**Files:**
- Modify: `app/src/main/java/com/matt/tarot/TarotServer.kt`
- Modify: `app/build.gradle`

**Interfaces:**
- Consumes (Task 2): `ReaderProfile(dataDir)`, `readerProfile.persona(base, slug, cards)`, `refreshReaderProfile`, `updateLivingNote`, `loadReaderProfile`.

READ each target region before editing to confirm the exact current text (line numbers below are approximate and shift as you edit). Adapt faithfully and NOTE any mismatch rather than forcing an edit.

- [ ] **Step 1: Add the readerProfile field**

Near the other `File`-derived fields in TarotServer (e.g. after `private val readingsDir = File(dataDir, "readings")`), add:

```kotlin
    private val readerProfile = ReaderProfile(dataDir)
```

- [ ] **Step 2: Inject profile into the interpret persona**

Find (around line 776):

```kotlin
        val systemPrompt = READER_PERSONA + buildAddressingNote(readerName) + memoryBlock + memory.recurringThemeBlock(slug) + buildPatternBlock(slug, cards) + prophecy.block + OVERCLAIM_GUARD
```

Replace with (wrapping only the persona+addressing term with the profile; `slug` already exists; build a `cardsList` from the spread `cards`):

```kotlin
        val cardsList = (0 until cards.length()).mapNotNull { cards.optJSONObject(it) }
        val systemPrompt = readerProfile.persona(READER_PERSONA + buildAddressingNote(readerName), slug, cardsList) + memoryBlock + memory.recurringThemeBlock(slug) + buildPatternBlock(slug, cards) + prophecy.block + OVERCLAIM_GUARD
```

- [ ] **Step 3: Inject profile into the compatibility persona**

Find (around line 484):

```kotlin
        val system = READER_PERSONA + buildCompatAddressingNote(readerName, aName, bName)
```

Replace with (parse the reader slug like the web compat, then wrap):

```kotlin
        val slug = body.optString("reader").ifEmpty {
            val rs = loadReaders(); if (rs.length() > 0) rs.getJSONObject(0).optString("slug") else "matt"
        }
        val compatCards = (0 until cards.length()).mapNotNull { cards.optJSONObject(it) }
        val system = readerProfile.persona(READER_PERSONA + buildCompatAddressingNote(readerName, aName, bName), slug, compatCards)
```

- [ ] **Step 4: Inject profile into the threshold greeting persona**

Find (around line 660, inside `handleThreshold`):

```kotlin
            val system = READER_PERSONA + buildAddressingNote(readerName)
```

Replace with (slug already exists in scope):

```kotlin
            val system = readerProfile.persona(READER_PERSONA + buildAddressingNote(readerName), slug, emptyList())
```

- [ ] **Step 5: Inject profile into the threshold-answer reply persona**

Find (around line 691, inside `handleThresholdAnswer`):

```kotlin
            val system = READER_PERSONA + buildAddressingNote(readerName)
```

Replace with (slug already exists in scope):

```kotlin
            val system = readerProfile.persona(READER_PERSONA + buildAddressingNote(readerName), slug, emptyList())
```

NOTE: Steps 4 and 5 target IDENTICAL text in two different functions. Edit them one at a time by matching enough surrounding context to make each unique (e.g. include the preceding line: `ensureBackfill()` for greeting; `val threads = memory.loadThreads(threadIds)` for the reply), or edit sequentially re-reading between edits.

- [ ] **Step 6: Inject profile into the clarify persona (reader-gated)**

In `handleClarify`, after `val readerName = body.optString("readerName")` (around line 927) add a slug parse:

```kotlin
        val readerSlug = body.optString("reader")
```

Then find (around line 967):

```kotlin
            .put("system", READER_PERSONA + buildAddressingNote(readerName))
```

Replace with (web ternary: profile only when a reader slug is present):

```kotlin
            .put("system", if (readerSlug.isNotEmpty())
                readerProfile.persona(READER_PERSONA + buildAddressingNote(readerName), readerSlug,
                    (0 until originalCards.length()).mapNotNull { originalCards.optJSONObject(it) })
                else READER_PERSONA + buildAddressingNote(readerName))
```

NOTE: `handleSessionSummary` (a different handler) has an identical `.put("system", READER_PERSONA + buildAddressingNote(readerNameRaw))` line -- do NOT touch it (web does not profile session-summary). Match the clarify line using `readerName` (not `readerNameRaw`) plus surrounding context to stay unique.

- [ ] **Step 7: Add the save-reading refresh cadence + living note**

In `handleSaveReading`, after the season-update block and before `return jsonResponse(JSONObject().put("ok", true))` (around line 345), insert:

```kotlin
        // Reader-profile refresh on cadence + per-save living note (best-effort, background).
        val lastSynth = readerProfile.loadReaderProfile(slug)?.optInt("readings_synthesized", 0) ?: 0
        val profileCadence = if (readingCount >= 30) 10 else 5
        if (readingCount - lastSynth >= profileCadence) {
            Thread {
                try { readerProfile.refreshReaderProfile(slug, ::memoryCallLLM) }
                catch (e: Exception) { Log.w(TAG, "profile refresh failed: ${e.message}") }
            }.start()
        }
        Thread {
            try { readerProfile.updateLivingNote(slug, ::memoryCallLLM) }
            catch (e: Exception) { Log.w(TAG, "living note failed: ${e.message}") }
        }.start()
```

(`readingCount` is the existing local `val readingCount = trimmed.length()` from earlier in the function.)

- [ ] **Step 8: Bump the version**

In `app/build.gradle`:

```groovy
        versionCode 10
        versionName "1.10"
```

(from `versionCode 9` / `versionName "1.9"`.)

- [ ] **Step 9: Compile gate**

Run: `& "C:\Users\Matt\projects\TarotApp\gradlew.bat" -p "C:\Users\Matt\projects\TarotApp" assembleDebug`
Expected: BUILD SUCCESSFUL.

- [ ] **Step 10: Verify added lines are ASCII-clean**

Run (Git Bash): `LANG=C.UTF-8 grep -nP '[^\x00-\x7F]' app/src/main/java/com/matt/tarot/TarotServer.kt`
Expected: any hits are PRE-EXISTING (persona em dash, box-drawing, ellipsis) and NOT among the lines you added.

- [ ] **Step 11: Commit**

```bash
git add app/src/main/java/com/matt/tarot/TarotServer.kt app/build.gradle
git commit -m "feat(android): inject reader profile into 5 persona sites + save cadence + bump to 1.10 (Slice G1 task 3)"
```

---

## Self-Review (completed)

**1. Spec coverage:**
- Pure getTier/getWarmthTier/WARMTH_NOTES/buildPersonaWithProfile/extract/parse -> Task 1. Ok.
- ReaderProfile IO + refreshReaderProfile (tier 2/3, living-note preservation) + updateLivingNote + persona wrapper -> Task 2. Ok.
- 5 persona injections (interpret, compatibility, threshold greeting, threshold answer, clarify-gated) + save cadence + version bump -> Task 3. Ok.
- session-summary/suggest-spread left untouched -> Task 3 Step 6 note. Ok.
- Ambiguity resolutions honored: TarotServer owns ReaderProfile (flat-JSON, no SQLite); refresh uses "claude-sonnet-4-6", living note HAIKU; living note written in G1 (Step 7); clarify + compat slug parsing (Steps 3, 6); buildPersonaWithProfile pure (Task 1). Ok.

**2. Placeholder scan:** No TBD/TODO; every code step shows complete code. Ok.

**3. Type consistency:** `buildPersonaWithProfile(basePersona: String, profile: JSONObject?, readingCount: Int, currentCards: List<JSONObject>)` identical across Task 1 def, Task 1 tests, and `ReaderProfile.persona`. `parseProfileSynthesis(raw, slug, readingCount, nowSeconds): JSONObject?` matches Task 1 def and Task 2 use. `persona(basePersona, slug, cards: List<JSONObject>)` matches Task 2 def and all 5 Task 3 call sites. `refreshReaderProfile(slug, callLLM)` / `updateLivingNote(slug, callLLM)` match Task 2 def and Task 3 Step 7. `CallLLM` 4-arg shape used consistently (Sonnet for refresh, HAIKU for living note). Ok.
