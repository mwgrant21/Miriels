# Android In-Reading Curiosity (Slice F) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the `/api/reading-questions` stub with real curiosity detection, weave querent answers into the interpretation, and capture those answers into the memory graph -- a faithful port of the web `detectCuriosity` + interpret `curiosityBlock` + `captureAnswer('curiosity')`.

**Architecture:** Pure detection/prompt/parse logic goes in `MemoryModel.kt` (JVM-testable). `MemoryEngine.kt` gains `detectCuriosity`, a generic `captureAnswer(sourceKind)` (with `captureThresholdAnswer` delegating to it), and a `markAsked` delegator. `TarotServer.kt` wires the real `/api/reading-questions` handler and the interpret `curiosityBlock` + background capture. Every new path is best-effort.

**Tech Stack:** Kotlin, Android SQLite, NanoHTTPD, `org.json`, JUnit4. Build via Android Studio's bundled JBR from CLI.

## Global Constraints

- **ASCII only** in every added or model-facing line. Verify with `LANG=C.UTF-8 grep -nP '[^\x00-\x7F]' <file>` (plain `LC_ALL=C` makes `grep -P` error on this machine). MemoryModel.kt / MemoryEngine.kt must be fully clean; TarotServer.kt has PRE-EXISTING non-ASCII (persona em dash, box-drawing dividers, ellipsis) that is OUT OF SCOPE -- only your ADDED lines must be ASCII.
- **Local only** -- never push. TarotApp has no remote. All commits local.
- **One SQLite connection** -- new engine code uses MemoryEngine's existing `store`.
- **Time is unix SECONDS** -- capture uses the existing seconds-based `applyOps`; no ms island in this slice.
- **Faithful port** -- `data/memory-engine.js` (`detectCuriosity`, `captureAnswer`, `CURIOSITY_SYSTEM`, `buildCuriosityCardLines`, `buildCuriosityPrompt`, `parseCuriosityOutput`) and `server.js` (the `/api/reading-questions` handler + interpret `curiosityBlock`/capture loop) are the source of truth.
- **Build/test (Windows PowerShell):** set `$env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"` once per shell; then `& "C:\Users\Matt\projects\TarotApp\gradlew.bat" -p "C:\Users\Matt\projects\TarotApp" testDebugUnitTest` and `... assembleDebug`. From the Bash tool the equivalent is `JAVA_HOME="C:/Program Files/Android/Android Studio/jbr" "C:/Users/Matt/projects/TarotApp/gradlew.bat" -p "C:/Users/Matt/projects/TarotApp" <task>`. Use `gradlew.bat` only; allow up to 600000 ms.

## Existing pieces this plan consumes (already on master)

- `MemoryStore.getOpenUnaskedThreads(slug: String, limit: Int = 3, minSalience: Int = 3): List<MemoryRow>`
- `MemoryStore.markAsked(ids: List<Long>)`
- `MemoryStore.getMemory(id: Long): MemoryRow?`
- `MemoryStore.applyOps(slug, ops, sourceKind: String, sourceId: Long?): ApplyResult`
- `MemoryModel`: `data class MemoryRow(val id: Long, ..., val content: String, ..., val subject: String?, ...)`, `THRESHOLD_CAPTURE_SYSTEM`, `buildThresholdCapturePrompt(items, answer)`, `parseExtractorOutput(raw)`, `const val THRESHOLD_SALIENCE_BAR = 3`, `const val HAIKU = "claude-haiku-4-5-20251001"`, `data class ApplyResult(...)`. MemoryModel.kt already imports `org.json.JSONObject` / `org.json.JSONArray`.
- `MemoryEngine`: `typealias CallLLM = (system: String, prompt: String, maxTokens: Int, model: String) -> String?`, current `captureThresholdAnswer(slug, answer, threadIds, callLLM): ApplyResult`.
- `TarotServer`: `readerNameFor(readers: JSONArray, slug: String): String`, `buildAddressingNote(readerName: String?): String`, `memoryCallLLM` (matches `CallLLM`), `loadReaders()`.

---

## File Structure

- `app/src/main/java/com/matt/tarot/MemoryModel.kt` (MODIFY) -- `CuriosityQuestion`, `CURIOSITY_SYSTEM`, `buildCuriosityCardLines`, `buildCuriosityPrompt`, `parseCuriosityOutput`.
- `app/src/test/java/com/matt/tarot/MemoryModelTest.kt` (MODIFY) -- JVM tests for parse + prompt.
- `app/src/main/java/com/matt/tarot/MemoryEngine.kt` (MODIFY) -- `captureAnswer`, `captureThresholdAnswer` delegate, `detectCuriosity`, `markAsked`.
- `app/src/main/java/com/matt/tarot/TarotServer.kt` (MODIFY) -- `handleReadingQuestions`, interpret `curiosityBlock` + background capture, route swap.
- `app/build.gradle` (MODIFY) -- version bump 8 -> 9 / "1.8" -> "1.9".

---

## Task 1: Pure curiosity logic + tests

**Files:**
- Modify: `app/src/main/java/com/matt/tarot/MemoryModel.kt`
- Test: `app/src/test/java/com/matt/tarot/MemoryModelTest.kt`

**Interfaces (produced, consumed by Tasks 2-3):**
- `data class CuriosityQuestion(val cardId: String, val question: String, val threadIds: List<Long>)`
- `const val CURIOSITY_SYSTEM: String`
- `fun buildCuriosityCardLines(cards: List<JSONObject>): String`
- `fun buildCuriosityPrompt(cards: List<JSONObject>, threads: List<MemoryRow>): String`
- `fun parseCuriosityOutput(raw: String?): List<JSONObject>`

- [ ] **Step 1: Write the failing tests**

Append to the end of `app/src/test/java/com/matt/tarot/MemoryModelTest.kt`, before the closing brace (imports `org.json.JSONObject`/`org.json.JSONArray` are already present from earlier temporal tests; add them if not):

```kotlin
    // --- In-reading curiosity (Slice F) ---
    @Test fun parseCuriosity_object_with_questions() {
        val raw = """Here you go: {"questions":[{"card_id":"7","question":"Does the Tower touch the move you mentioned?","thread_ids":[3,5]}]}"""
        val out = parseCuriosityOutput(raw)
        assertEquals(1, out.size)
        assertEquals("7", out[0].optString("card_id"))
        assertEquals(2, out[0].optJSONArray("thread_ids").length())
    }

    @Test fun parseCuriosity_bare_array() {
        val raw = """[{"card_id":"2","question":"q","thread_ids":[9]}]"""
        val out = parseCuriosityOutput(raw)
        assertEquals(1, out.size)
        assertEquals("2", out[0].optString("card_id"))
    }

    @Test fun parseCuriosity_object_without_questions_is_empty() {
        assertEquals(0, parseCuriosityOutput("""{"foo":1}""").size)
    }

    @Test fun parseCuriosity_garbage_is_empty() {
        assertEquals(0, parseCuriosityOutput("no json here").size)
        assertEquals(0, parseCuriosityOutput(null).size)
        assertEquals(0, parseCuriosityOutput("").size)
    }

    @Test fun buildCuriosityPrompt_contains_cards_threads_and_schema() {
        val cards = listOf(
            JSONObject().put("id", "7").put("position", "Present").put("name", "The Tower"),
            JSONObject().put("id", "8").put("name", "The Star").put("isReversed", true)
        )
        val threads = listOf(
            MemoryRow(id = 3L, readerSlug = "matt", type = "thread", content = "wants to leave the gallery",
                status = "open", salience = 4, subject = null, sourceKind = "reading", sourceId = null,
                createdAt = 0L, updatedAt = 0L, lastReferencedAt = null, referenceCount = 0, askedAt = null)
        )
        val p = buildCuriosityPrompt(cards, threads)
        assertTrue(p.contains("[7] Present: The Tower"))
        assertTrue(p.contains("[8] The Star (reversed)"))
        assertTrue(p.contains("#3 wants to leave the gallery"))
        assertTrue(p.contains("\"questions\":["))
        assertTrue(p.contains("card_id MUST be one of the spread ids"))
    }
```

NOTE: the `MemoryRow(...)` constructor call above uses named args for every field. If the real `MemoryRow` field names differ from those shown, READ `MemoryModel.kt` lines 21-40 and adjust the named args in this test to match exactly (the field set is: id, readerSlug, type, content, status, salience, subject, sourceKind, sourceId, createdAt, updatedAt, lastReferencedAt, referenceCount, askedAt -- match whatever names/nullability the real data class declares).

- [ ] **Step 2: Run the tests to verify they fail**

Run: `& "C:\Users\Matt\projects\TarotApp\gradlew.bat" -p "C:\Users\Matt\projects\TarotApp" testDebugUnitTest`
Expected: FAIL -- unresolved references `parseCuriosityOutput`, `buildCuriosityPrompt`, `CuriosityQuestion`.

- [ ] **Step 3: Implement the pure logic in MemoryModel.kt**

Append to the end of `app/src/main/java/com/matt/tarot/MemoryModel.kt` (top-level; `org.json.JSONObject`/`JSONArray` already imported):

```kotlin
// -- In-reading curiosity (Slice F) -----------------------------------------
// Faithful port of data/memory-engine.js curiosity detection.
data class CuriosityQuestion(val cardId: String, val question: String, val threadIds: List<Long>)

const val CURIOSITY_SYSTEM =
    "You are the quiet intuition of a tarot reader named Miriel. As she lays a spread, a single card " +
    "will sometimes stop her because it stirs something she remembers about this person. You decide, " +
    "conservatively, whether any card genuinely does that. Never force a connection; most spreads stir nothing."

fun buildCuriosityCardLines(cards: List<JSONObject>): String =
    cards.joinToString("\n") { c ->
        val id = c.optString("id").ifEmpty { "?" }
        val pos = c.optString("position").let { if (it.isNotEmpty()) "$it: " else "" }
        val rev = if (c.optBoolean("isReversed")) " (reversed)" else ""
        "[$id] $pos${c.optString("name")}$rev"
    }

fun buildCuriosityPrompt(cards: List<JSONObject>, threads: List<MemoryRow>): String {
    val cardBlock = buildCuriosityCardLines(cards)
    val threadBlock = threads.joinToString("\n") { "#${it.id} ${it.content}" }
    return "THE SPREAD JUST LAID (id in brackets):\n" + cardBlock + "\n\n" +
        "OPEN THREADS MIRIEL REMEMBERS ABOUT THIS PERSON:\n" + threadBlock + "\n\n" +
        "Decide whether any single card genuinely and strikingly pulls her toward one of these remembered threads, especially a surprising, less-obvious connection to another part of their life. Respond with ONLY a JSON object:\n\n" +
        "{\"questions\":[\n" +
        "  {\"card_id\":\"<id of the card that stopped her>\",\"question\":\"one sentence in Miriel's voice, as if she paused mid-reading on that card\",\"thread_ids\":[<id>]}\n" +
        "]}\n\n" +
        "Rules:\n" +
        "- 0 to 2 questions. Most readings: {\"questions\":[]}.\n" +
        "- Be conservative, only a real, striking resonance, never a forced one.\n" +
        "- Favor the less-obvious / off-topic pull; a natural on-topic one is also fine.\n" +
        "- The question is one sentence and names or clearly refers to that card.\n" +
        "- Speak the question directly TO the querent as \"you\", do not name them or describe them in the third person. (Other people in their life may still be named where the cards point to them.)\n" +
        "- card_id MUST be one of the spread ids above; thread_ids MUST come from the list above.\n" +
        "- Never invent facts."
}

fun parseCuriosityOutput(raw: String?): List<JSONObject> {
    if (raw.isNullOrEmpty()) return emptyList()
    val text = raw
    val objStart = text.indexOf('{')
    val arrStart = text.indexOf('[')
    return try {
        if (objStart != -1 && (arrStart == -1 || objStart < arrStart)) {
            val slice = text.substring(objStart, text.lastIndexOf('}') + 1)
            val parsed = JSONObject(slice)
            val arr = parsed.optJSONArray("questions") ?: return emptyList()
            (0 until arr.length()).mapNotNull { arr.optJSONObject(it) }
        } else if (arrStart != -1) {
            val slice = text.substring(arrStart, text.lastIndexOf(']') + 1)
            val arr = JSONArray(slice)
            (0 until arr.length()).mapNotNull { arr.optJSONObject(it) }
        } else emptyList()
    } catch (e: Exception) {
        emptyList()
    }
}
```

NOTE: `parseCuriosityOutput` returns `List<JSONObject>` (raw parsed entries). The web version also handles a top-level bare array being returned directly (when the model emits `[...]`); the object branch handles `{"questions":[...]}`. A top-level object WITHOUT a `questions` array yields `emptyList()` (the web returns `[]` there too). This matches the web `parseCuriosityOutput` behavior for the shapes the extractor actually produces.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `& "C:\Users\Matt\projects\TarotApp\gradlew.bat" -p "C:\Users\Matt\projects\TarotApp" testDebugUnitTest`
Expected: PASS -- all 5 new curiosity tests plus the pre-existing suite.

- [ ] **Step 5: Compile gate**

Run: `& "C:\Users\Matt\projects\TarotApp\gradlew.bat" -p "C:\Users\Matt\projects\TarotApp" assembleDebug`
Expected: BUILD SUCCESSFUL.

- [ ] **Step 6: Verify added lines are ASCII-clean**

Run (Git Bash): `LANG=C.UTF-8 grep -nP '[^\x00-\x7F]' app/src/main/java/com/matt/tarot/MemoryModel.kt`
Expected: no matches.

- [ ] **Step 7: Commit**

```bash
git add app/src/main/java/com/matt/tarot/MemoryModel.kt app/src/test/java/com/matt/tarot/MemoryModelTest.kt
git commit -m "feat(android): pure in-reading curiosity logic + tests (Slice F task 1)"
```

---

## Task 2: MemoryEngine -- detectCuriosity + generic captureAnswer + markAsked

**Files:**
- Modify: `app/src/main/java/com/matt/tarot/MemoryEngine.kt`

**Interfaces:**
- Consumes (Task 1): `CuriosityQuestion`, `CURIOSITY_SYSTEM`, `buildCuriosityPrompt`, `parseCuriosityOutput`.
- Produces (Task 3):
  - `captureAnswer(slug: String, answer: String?, threadIds: List<Long>, callLLM: CallLLM, sourceKind: String = "threshold"): ApplyResult`
  - `detectCuriosity(slug: String, cards: List<JSONObject>, callLLM: CallLLM, readerName: String, addressingNote: String): List<CuriosityQuestion>`
  - `markAsked(ids: List<Long>)`

- [ ] **Step 1: Refactor captureThresholdAnswer to a generic captureAnswer**

In `app/src/main/java/com/matt/tarot/MemoryEngine.kt`, replace the current `captureThresholdAnswer` (the whole function -- currently around lines 107-117):

```kotlin
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
```

with the generic version plus a thin delegate:

```kotlin
    // Best-effort: any throw returns a zero ApplyResult. Run off the request thread (it makes a network call).
    fun captureAnswer(slug: String, answer: String?, threadIds: List<Long>, callLLM: CallLLM, sourceKind: String = "threshold"): ApplyResult {
        return try {
            val items = threadIds.mapNotNull { store.getMemory(it) }
            val raw = callLLM(THRESHOLD_CAPTURE_SYSTEM, buildThresholdCapturePrompt(items, answer), 600, HAIKU)
            val ops = parseExtractorOutput(raw)
            store.applyOps(slug, ops, sourceKind, null)
        } catch (e: Exception) {
            ApplyResult()
        }
    }

    fun captureThresholdAnswer(slug: String, answer: String?, threadIds: List<Long>, callLLM: CallLLM): ApplyResult =
        captureAnswer(slug, answer, threadIds, callLLM, "threshold")
```

- [ ] **Step 2: Add detectCuriosity and markAsked**

Add these methods to `MemoryEngine` (place them near `captureAnswer`; `JSONObject` is already imported in MemoryEngine.kt -- verify, and add `import org.json.JSONObject` if missing):

```kotlin
    fun markAsked(ids: List<Long>) = store.markAsked(ids)

    // Faithful port of memory-engine.js detectCuriosity. Best-effort: any throw -> emptyList().
    // addressingNote is buildAddressingNote(readerName), supplied by the caller (TarotServer owns that helper).
    fun detectCuriosity(slug: String, cards: List<JSONObject>, callLLM: CallLLM, readerName: String, addressingNote: String): List<CuriosityQuestion> {
        return try {
            val threads = store.getOpenUnaskedThreads(slug, 8, THRESHOLD_SALIENCE_BAR)
            if (threads.isEmpty()) return emptyList()
            val system = CURIOSITY_SYSTEM + addressingNote
            val raw = callLLM(system, buildCuriosityPrompt(cards, threads), 500, HAIKU)
            val cardIds = cards.map { it.optString("id") }.filter { it.isNotEmpty() }.toSet()
            val threadIds = threads.map { it.id }.toSet()
            parseCuriosityOutput(raw).mapNotNull { q ->
                val cardId = q.optString("card_id")
                val question = q.optString("question")
                val tArr = q.optJSONArray("thread_ids") ?: JSONArray()
                val tids = (0 until tArr.length()).map { tArr.optLong(it) }.filter { threadIds.contains(it) }
                if (question.isNotEmpty() && cardIds.contains(cardId) && tids.isNotEmpty())
                    CuriosityQuestion(cardId, question, tids)
                else null
            }.take(2)
        } catch (e: Exception) {
            Log.w(TAG, "detectCuriosity failed: ${e.message}")
            emptyList()
        }
    }
```

NOTE: this uses `JSONArray` -- ensure `import org.json.JSONArray` is present in MemoryEngine.kt (add it if not). `TAG` is the existing MemoryEngine log tag (confirm it exists; MemoryEngine already calls `Log.w(TAG, ...)` elsewhere).

- [ ] **Step 3: Compile gate**

Run: `& "C:\Users\Matt\projects\TarotApp\gradlew.bat" -p "C:\Users\Matt\projects\TarotApp" assembleDebug`
Expected: BUILD SUCCESSFUL. (The `captureThresholdAnswer` delegate keeps the existing `handleThresholdAnswer` call site compiling unchanged.)

- [ ] **Step 4: Verify added lines are ASCII-clean**

Run (Git Bash): `LANG=C.UTF-8 grep -nP '[^\x00-\x7F]' app/src/main/java/com/matt/tarot/MemoryEngine.kt`
Expected: no matches.

- [ ] **Step 5: Commit**

```bash
git add app/src/main/java/com/matt/tarot/MemoryEngine.kt
git commit -m "feat(android): detectCuriosity + generic captureAnswer + markAsked (Slice F task 2)"
```

---

## Task 3: TarotServer wiring + version bump

**Files:**
- Modify: `app/src/main/java/com/matt/tarot/TarotServer.kt`
- Modify: `app/build.gradle`

**Interfaces:**
- Consumes (Task 2): `memory.detectCuriosity(...)`, `memory.captureAnswer(...)`, `memory.markAsked(...)`.

- [ ] **Step 1: Add the handleReadingQuestions method**

Add this private method to `TarotServer` (near `handleThresholdAnswer`, around line 679). `readingsDir`/`loadReaders`/`readerNameFor`/`buildAddressingNote`/`memoryCallLLM`/`jsonResponse` all already exist:

```kotlin
    private fun handleReadingQuestions(body: JSONObject?): Response {
        return try {
            val readers = loadReaders()
            val slug = body?.optString("reader")?.ifEmpty { null }
                ?: if (readers.length() > 0) readers.getJSONObject(0).optString("slug") else "matt"
            val readerName = readerNameFor(readers, slug)
            val cardsArr = body?.optJSONArray("cards") ?: JSONArray()
            val cards = (0 until cardsArr.length()).mapNotNull { cardsArr.optJSONObject(it) }
            val questions = memory.detectCuriosity(slug, cards, ::memoryCallLLM, readerName, buildAddressingNote(readerName))
            memory.markAsked(questions.flatMap { it.threadIds })
            val out = JSONArray()
            for (q in questions) {
                val tids = JSONArray()
                for (t in q.threadIds) tids.put(t)
                out.put(JSONObject().put("card_id", q.cardId).put("question", q.question).put("thread_ids", tids))
            }
            jsonResponse(JSONObject().put("questions", out))
        } catch (e: Exception) {
            Log.w(TAG, "reading-questions failed: ${e.message}")
            jsonResponse(JSONObject().put("questions", JSONArray()))
        }
    }
```

- [ ] **Step 2: Swap the /api/reading-questions route to the real handler**

In the route `when` block, replace the stub:

```kotlin
            uri == "/api/reading-questions" && method == Method.POST ->
                jsonResponse(JSONObject().put("questions", JSONArray()))
```

with:

```kotlin
            uri == "/api/reading-questions" && method == Method.POST ->
                handleReadingQuestions(body)
```

- [ ] **Step 3: Build the curiosityBlock and append to the interpret user prompt**

In `handleInterpret`, immediately AFTER the `prompt` val is assigned (the big `if (isSingle) ... else ...` expression ending around line 851) and BEFORE `val claudeBody = JSONObject()` (line 853), insert:

```kotlin
        // In-reading curiosity: weave any answers the querent gave mid-deal into the reading.
        val curiosityAnswersArr = body.optJSONArray("curiosityAnswers") ?: JSONArray()
        val answeredCuriosity = (0 until curiosityAnswersArr.length())
            .mapNotNull { curiosityAnswersArr.optJSONObject(it) }
            .filter { it.optString("answer").trim().isNotEmpty() }
        val curiosityBlock = if (answeredCuriosity.isNotEmpty())
            "\n\nAs the cards were laid, you paused on what they stirred and asked:\n" +
            answeredCuriosity.joinToString("\n") { a ->
                "- You asked: \"${a.optString("question")}\", they answered: \"${a.optString("answer").take(500)}\""
            } +
            "\nLet what they shared genuinely shape this reading; do not quote it back mechanically."
        else ""
        val promptFinal = prompt + curiosityBlock
```

Then change the `claudeBody` to send `promptFinal` instead of `prompt`:

```kotlin
        val claudeBody = JSONObject()
            .put("model", "claude-sonnet-4-6")
            .put("max_tokens", 3000)
            .put("system", systemPrompt)
            .put("messages", JSONArray().put(JSONObject().put("role", "user").put("content", promptFinal)))
```

- [ ] **Step 4: Fire the background curiosity capture after the Claude call**

In `handleInterpret`, AFTER the prophecy surfaced write-back block and BEFORE `return jsonResponse(...)` (around line 863-864), insert the fire-and-forget capture. Capture the `slug` into a local for the thread:

```kotlin
        if (answeredCuriosity.isNotEmpty()) {
            val capSlug = slug
            Thread {
                for (a in answeredCuriosity) {
                    try {
                        val tArr = a.optJSONArray("threadIds") ?: JSONArray()
                        val tids = (0 until tArr.length()).map { tArr.optLong(it) }.filter { it != 0L }
                        if (tids.isNotEmpty())
                            memory.captureAnswer(capSlug, a.optString("answer"), tids, ::memoryCallLLM, "curiosity")
                    } catch (e: Exception) {
                        Log.w(TAG, "curiosity capture failed: ${e.message}")
                    }
                }
            }.start()
        }
```

NOTE: the answer objects use the camelCase key `threadIds` (the frontend maps the endpoint's `thread_ids` to `threadIds` when it posts `curiosityAnswers`), matching the web `a.threadIds`. `it != 0L` drops entries `optLong` could not parse.

- [ ] **Step 5: Bump the version**

In `app/build.gradle`, change:

```groovy
        versionCode 9
        versionName "1.9"
```

(from `versionCode 8` / `versionName "1.8"`.)

- [ ] **Step 6: Compile gate**

Run: `& "C:\Users\Matt\projects\TarotApp\gradlew.bat" -p "C:\Users\Matt\projects\TarotApp" assembleDebug`
Expected: BUILD SUCCESSFUL.

- [ ] **Step 7: Verify added lines are ASCII-clean**

Run (Git Bash): `LANG=C.UTF-8 grep -nP '[^\x00-\x7F]' app/src/main/java/com/matt/tarot/TarotServer.kt`
Expected: any hits are PRE-EXISTING (persona em dash, box-drawing dividers, ellipsis) and NOT among the lines you added.

- [ ] **Step 8: Commit**

```bash
git add app/src/main/java/com/matt/tarot/TarotServer.kt app/build.gradle
git commit -m "feat(android): wire curiosity endpoint + interpret block/capture + bump to 1.9 (Slice F task 3)"
```

---

## Self-Review (completed)

**1. Spec coverage:**
- `CuriosityQuestion`, `CURIOSITY_SYSTEM`, `buildCuriosityCardLines`, `buildCuriosityPrompt`, `parseCuriosityOutput` -> Task 1. Ok.
- Generic `captureAnswer(sourceKind)` + `captureThresholdAnswer` delegate + `detectCuriosity` + `markAsked` -> Task 2. Ok.
- Real `handleReadingQuestions` + route swap + interpret `curiosityBlock` (user prompt) + background `captureAnswer("curiosity")` + version bump -> Task 3. Ok.
- Ambiguity resolutions honored: addressingNote passed in (Task 2/3), card ids as strings (Task 2 `optString("id")`), background thread capture (Task 3 Step 4), curiosityBlock on USER prompt via `promptFinal` (Task 3 Step 3). Ok.

**2. Placeholder scan:** No TBD/TODO; every code step shows complete code. Ok.

**3. Type consistency:** `CuriosityQuestion(cardId: String, question: String, threadIds: List<Long>)` identical across Task 1 definition, Task 2 construction, Task 3 serialization. `detectCuriosity(slug, cards: List<JSONObject>, callLLM, readerName, addressingNote)` matches between Task 2 definition and the Task 3 call. `captureAnswer(slug, answer, threadIds, callLLM, sourceKind)` matches between Task 2 definition and the Task 3 background call. `parseCuriosityOutput(raw): List<JSONObject>` matches Task 1 definition and Task 2 consumption. Ok.
