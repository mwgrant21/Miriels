# Android Threshold Greeting (Slice A) - Design

**Date:** 2026-06-27
**Status:** Approved (design)
**Project:** TarotApp (Android), C:\Users\Matt\projects\TarotApp
**Web reference:** C:\Users\Matt\projects\tarot (server.js, data/memory-engine.js, data/memory-store.js)
**Builds on:** the Android memory substrate (2026-06-27-android-memory-substrate-design.md), shipped to TarotApp master.

## Goal

Replace the two Android Threshold stubs with the real reunion greeting: when a
querent returns, Miriel greets them across the gap, recalling open threads,
quiet (dormant) threads, and foretellings that may have come to pass, then asks
what came of them. Their answer is captured back into memory, closing predictions
they report as resolved. The greeting is driven entirely by the atom store that
already exists on the device. No schema migration.

This is a faithful port of the web memory-engine threshold half. It is Slice A of
the larger Threshold/memory port; the season-driven and display-driven parts are
explicitly deferred (see Deferred).

## Current state (the stubs being replaced)

In TarotServer.kt:

```
"/api/threshold" GET          -> {"mode":"none"}                         (greeting never fires)
"/api/threshold/answer" POST  -> {"reply":"Thank you for telling me..."}  (answer discarded)
```

The substrate already on device provides everything this slice needs: the
memories table with columns type, status, salience, asked_at, created_at,
updated_at, reference_count; the memory_links table; memory_meta (getMeta/setMeta);
and applyOps with ADD/UPDATE/TOUCH. The Op data class already carries verdict and
outcome fields. The bundled frontend (assets app.js) already calls /api/threshold
and /api/threshold/answer, so the UI is ready and waiting for real responses.

## Architecture

Mirror the substrate slice's pure/Android split so pure logic stays JVM-unit-testable:

- MemoryModel.kt (PURE, no android.* imports): constants, the mode decision, and
  all prompt builders. Unit-tested on the JVM.
- MemoryStore.kt (Android SQLite): the four signal queries, markAsked, and a new
  RESOLVE branch in applyOps. Compile-gated + on-device smoke.
- MemoryEngine.kt: orchestration (gather signals, decide, generate greeting,
  commit) and threshold-answer capture.
- TarotServer.kt: two real handlers replacing the stubs.

Time is unix SECONDS throughout the memory layer (matches the substrate;
milliseconds only ever appear in CardPatterns).

### 1. MemoryModel.kt (extend; PURE)

Constants (verbatim from web):

```
const val REUNION_GAP_DAYS = 2
const val THRESHOLD_SALIENCE_BAR = 3
const val REUNION_MAX_THREADS = 3
val VERDICTS = setOf("came_to_pass", "did_not", "partly")
```

(DORMANT_DAYS = 60 and DORMANT_SALIENCE_BAR = 3 live with the dormant query in the
store, matching where the web keeps them.)

decideThresholdMode - pure, returns "none" | "gentle" | "reunion":

```
fun decideThresholdMode(
    lastVisit: Long?, threads: List<MemoryRow>, now: Long,
    gapDays: Int = REUNION_GAP_DAYS,
    predictions: List<MemoryRow> = emptyList(),
    dormant: List<MemoryRow> = emptyList(),
    seasonShift: SeasonShift? = null      // always null in Slice A; param kept for Slice B
): String
```

- hasMaterial = threads.isNotEmpty() || predictions.isNotEmpty() || dormant.isNotEmpty() || seasonShift != null
- if not hasMaterial -> "none"
- gap = if (lastVisit == null) Double.POSITIVE_INFINITY else (now - lastVisit) / 86400.0
- return if (gap >= gapDays) "reunion" else "gentle"

Note: the web signature also takes temporalCallbacks. Slice A omits temporal
callbacks entirely (a separate deferred feature), so that parameter is dropped
rather than carried. seasonShift IS carried (defaulted null) because Slice B feeds
it with no further change to this function.

Prompt builders, ported verbatim (preserving wording exactly, since this is
Miriel's voice):

- buildGreetingPrompt(mode, threads, gapDays, predictions, timeOfDay, dormant, seasonShift)
  - Assembles gapPhrase, threadBlock, predBlock, dormantBlock, seasonBlock,
    timeHint; "gentle" vs "reunion" instruction text exactly as web.
  - seasonShift block and its branch are kept (null in Slice A). The web temporal
    block is omitted (no temporal callbacks in Slice A).
- buildReplyPrompt(threads, answer)
- THRESHOLD_CAPTURE_SYSTEM (constant string, verbatim)
- buildThresholdCapturePrompt(items, answer) - the RESOLVE/UPDATE/ADD instruction
  prompt, verbatim.

A small SeasonShift placeholder type is introduced now so decideThresholdMode and
buildGreetingPrompt compile with the season parameter:

```
data class SeasonShift(val signature: String, val fact: String)
```

It is never constructed in Slice A (always null). Slice B will produce it.

ASCII constraint: all ported strings must be ASCII only. The web prompts use plain
ASCII already; verify with a charCodeAt/byte scan before committing (no curly
quotes, no em dashes). This is a hard project constraint.

### 2. MemoryStore.kt (extend; Android SQLite)

Three read queries (SQL ported 1:1 over existing columns), returning List<MemoryRow>:

getOpenUnaskedThreads(slug, limit = 3, minSalience = 3):

```
SELECT * FROM memories
WHERE reader_slug = ? AND type = 'thread'
  AND status IN ('open','moving') AND asked_at IS NULL AND salience >= ?
ORDER BY salience DESC, updated_at DESC
LIMIT ?
```

getRipePredictions(slug, limit = 3, now): ripe = open prediction aged past a
per-id jittered window (base 14d, +/-3 from id%7 -> 11..17d), measured from
COALESCE(asked_at, created_at):

```
SELECT * FROM memories
WHERE reader_slug = ? AND type = 'prediction' AND status = 'open'
  AND (? - COALESCE(asked_at, created_at)) >= (14 + (id % 7) - 3) * 86400
ORDER BY salience DESC, updated_at DESC
LIMIT ?
```

getDormantThreads(slug, limit = 2, now): dormant = open/moving salient thread
untouched past a per-id jittered window (base 60d, +/-3 -> 57..63d), measured from
MAX(IFNULL(asked_at,0), updated_at):

```
SELECT * FROM memories
WHERE reader_slug = ? AND type = 'thread'
  AND status IN ('open','moving') AND salience >= 3
  AND (? - MAX(IFNULL(asked_at,0), updated_at)) >= (60 + (id % 7) - 3) * 86400
ORDER BY salience DESC, updated_at ASC
LIMIT ?
```

markAsked(ids: List<Long>): UPDATE memories SET asked_at = ? WHERE id = ?, run for
each id inside one transaction (compile the statement once, close in finally;
follow the markReferenced pattern already in the file).

RESOLVE branch added to applyOps (the only change to existing applyOps logic):

```
"RESOLVE" -> {
    val id = op.id ?: continue
    val row = getForSlug(id, slug) ?: continue
    val verdict = op.verdict
    if (verdict == "too_soon") {
        // nothing concluded yet: re-stamp asked_at, leave status open
        markAskedWithin(id, t)   // or inline the single UPDATE on the open txn
        result.deferred++
        continue
    }
    // set status resolved
    db.update("memories", ContentValues().apply {
        put("status", "resolved"); put("updated_at", t)
    }, "id = ? AND reader_slug = ?", arrayOf(id.toString(), slug))
    val outcome = op.outcome?.trim()
    if (!outcome.isNullOrEmpty()) {
        val outcomeId = addMemory(
            slug, "event", outcome,
            null, op.salience,
            if (verdict != null && verdict in VERDICTS) "verdict:$verdict" else null,
            sourceKind, sourceId
        )
        // link the outcome event to the prediction it resolves
        db.insert("memory_links", null, ContentValues().apply {
            put("from_id", outcomeId); put("to_id", id); put("relation", "resolves")
        })
    }
    result.resolved++
}
```

This is the complete, faithful RESOLVE write path (matches the web store). It runs
inside the existing applyOps transaction. ApplyResult already has resolved and
deferred fields. addMemory already exists and returns the new row id.

Note on too_soon inside a transaction: applyOps already holds an open transaction,
so RESOLVE must re-stamp asked_at via a direct UPDATE on the same db handle (not by
calling the public markAsked, which opens its own transaction). Inline the single
UPDATE statement, or pass the transaction's timestamp to a private helper.

### 3. MemoryEngine.kt (extend)

```
data class ThresholdResult(val mode: String, val greeting: String?, val threadIds: List<Long>)
```

threshold(slug, now, timeOfDay, system, callLLM): ThresholdResult

1. threads = store.getOpenUnaskedThreads(slug, REUNION_MAX_THREADS, THRESHOLD_SALIENCE_BAR)
2. predictions = store.getRipePredictions(slug, REUNION_MAX_THREADS, now)
3. dormant = store.getDormantThreads(slug, 2, now)
4. freshThreads = threads minus any id present in dormant (dormant takes precedence)
5. lastVisit = store.getMeta("last_visit:" + slug)?.toLongOrNull()
6. mode = decideThresholdMode(lastVisit, freshThreads, now, REUNION_GAP_DAYS, predictions, dormant, null)
7. if mode == "none": store.setMeta("last_visit:" + slug, now.toString()); return ThresholdResult("none", null, [])
8. Compute shown sets exactly as web:
   - shownThreads = if gentle freshThreads.take(1) else freshThreads
   - shownDormant = if gentle (if shownThreads nonempty [] else dormant.take(1)) else dormant
   - shownPredictions = if gentle (if shownThreads or shownDormant nonempty [] else predictions.take(1)) else predictions
   - shown = shownThreads + shownDormant + shownPredictions
   - gapDays = if lastVisit == null +inf else (now - lastVisit)/86400.0
9. prompt = buildGreetingPrompt(mode, shownThreads, gapDays, shownPredictions, timeOfDay, shownDormant, null)
10. greeting = callLLM(system, prompt, 700, "claude-sonnet-4-6")
    - if greeting is null (LLM failure): return ThresholdResult("none", null, []) WITHOUT
      advancing last_visit (so the full reunion retries next open; faithful to web).
11. store.markAsked(shown.map { id }); store.setMeta("last_visit:" + slug, now.toString())
12. return ThresholdResult(mode, greeting, shown.map { id })

captureThresholdAnswer(slug, answer, threadIds, callLLM): ApplyResult - best-effort
(try/catch -> empty ApplyResult), mirrors captureFromReading:

```
val items = threadIds.mapNotNull { store.getMemory(it) }
val raw = callLLM(THRESHOLD_CAPTURE_SYSTEM, buildThresholdCapturePrompt(items, answer), 600, HAIKU)
val ops = parseExtractorOutput(raw)
return store.applyOps(slug, ops, "threshold", null)
```

loadThreads(ids): List<MemoryRow> = ids.mapNotNull { store.getMemory(it) }
(so the server can build the reply prompt without reaching into the store directly).

### 4. TarotServer.kt (two real handlers)

handleThreshold(params: Map<String, List<String>>): Response  (GET /api/threshold)

- slug = params["reader"]?.firstOrNull()?.ifEmpty{null} ?: first reader slug ?: "matt"
  (same fallback used by handleInterpret / handleSaveReading)
- reader = readers entry whose slug matches (for its name); readerName = reader name or "you"
- phase = params["phase"]?.firstOrNull(); timeOfDay = phase if in {dawn,day,dusk,night} else ""
- ensureBackfill()  (so a first-ever interpret is not the only backfill trigger)
- system = READER_PERSONA + buildAddressingNote(readerName)
- now = System.currentTimeMillis() / 1000
- result = memory.threshold(slug, now, timeOfDay, system, ::memoryCallLLM)
- if result.mode == "none": return {"mode":"none"}
- else: return {"mode":result.mode, "greeting":result.greeting, "threadIds":[...]}
- Wrap the whole thing in try/catch -> {"mode":"none"} (never crash the reunion screen).

handleThresholdAnswer(body): Response  (POST /api/threshold/answer)

- slug resolved as above (from body)
- answer = body.optString("answer"); threadIds = optJSONArray("threadIds") -> List<Long>
- threads = memory.loadThreads(threadIds)
- reply: try memoryCallLLM(system, buildReplyPrompt(threads, answer), 400, "claude-sonnet-4-6");
  on failure or null, fall back to "Thank you for telling me. Let us see what the
  cards have for you now."
- Fire-and-forget: Thread { memory.captureThresholdAnswer(slug, answer, threadIds, ::memoryCallLLM) }
  wrapped in try/catch with Log.w (mirrors the capture thread in handleSaveReading).
- return {"reply": reply}

Routing: replace the two stub arms in handleApi. GET passes session.parameters;
POST passes the parsed body (same as the existing arms).

Models: greeting and reply use claude-sonnet-4-6; capture uses HAIKU
(claude-haiku-4-5-20251001). All three go through the existing memoryCallLLM
adapter, which already forwards the model argument.

## Data flow

Return visit (GET /api/threshold):
device -> gather threads/predictions/dormant from memory.db -> decide mode ->
if material and gap, build greeting prompt -> Sonnet -> markAsked + last_visit ->
greeting shown on the reunion screen.

Answer (POST /api/threshold/answer):
querent's answer -> Sonnet reply (shown immediately) + background Haiku capture ->
applyOps (RESOLVE closes reported predictions, UPDATE advances live threads, ADD
records new specifics) -> memory.db.

## Error handling

Every layer is best-effort and degrades to a quiet, correct default:
- store query throws -> caught in the engine, treated as empty -> mode may fall to "none".
- greeting LLM fails -> mode "none", last_visit NOT advanced (retry next open). No
  wooden template greeting is ever shown.
- reply LLM fails -> canned fallback reply; capture still attempted.
- capture throws -> swallowed (Log.w), empty ApplyResult; the reading proceeds.
- handler-level try/catch returns {"mode":"none"} / {"reply":fallback} so the screen
  never errors.

Recall's lesson applies: do not silently swallow without a log. Capture/greeting
failures log via Log.w/Log.e so a regression is visible (as the substrate slice now does).

## Testing

JVM unit tests (MemoryModelTest.kt, pure, run via gradlew testDebugUnitTest):
- decideThresholdMode: "none" when no material; "reunion" when lastVisit null;
  "reunion" when gap >= 2 days; "gentle" when gap < 2 days; material contributed by
  any one of threads / predictions / dormant / seasonShift.
- buildGreetingPrompt: gentle vs reunion instruction text; thread/pred/dormant
  blocks present only when their list is non-empty; gapPhrase singular vs plural and
  the infinite-gap phrasing; ask clause assembly (threads only, predictions only, both).
- buildReplyPrompt and buildThresholdCapturePrompt: include the items and the
  (truncated) answer.
- parseExtractorOutput already tested; add a case asserting a RESOLVE op parses with
  verdict + outcome populated.

Compile gate: gradlew assembleDebug (catches all Kotlin errors in the SQLite layer).

On-device smoke (HUMAN gate, the SQLite + LLM path is not JVM-testable):
1. Sideload the debug APK; confirm existing memory.db has open threads (it does: the
   substrate smoke left several).
2. Backdate last_visit (setMeta or wait): confirm GET /api/threshold returns
   mode "reunion" with a greeting that names real remembered threads, and that
   asked_at gets stamped on the shown rows (so they are not re-asked next open).
3. Answer the greeting reporting a foretelling as come to pass; confirm via a
   memory.db pull that the prediction row flipped to status "resolved", an outcome
   event atom was written with subject verdict:came_to_pass, and a memory_links
   row (relation "resolves") links them.
4. Confirm a "too_soon" answer leaves the prediction open with a fresh asked_at.

## Global constraints

- ASCII only in all model-facing prose and ported strings. No em dashes, no smart
  quotes. Verify ported prompts with a byte scan before committing.
- Never push tarot or TarotApp git history (the tarot history contains an API key);
  TarotApp is local-only with no remote. All commits stay local.
- Time in the memory layer is unix SECONDS.
- Faithful port: prompt wording and the SQL window math are copied from the web
  source, not reinvented. Constants match web exactly.
- Reuse existing infrastructure (memoryCallLLM, ensureBackfill, buildAddressingNote,
  the markReferenced statement pattern); do not add new HTTP or LLM plumbing.
- Build/verify from CLI with JAVA_HOME set to the Android Studio JBR (see the
  tarot-android-build-toolchain note): gradlew.bat assembleDebug / testDebugUnitTest.

## Deferred (explicitly out of scope for Slice A)

- Slice B - emotional-seasons pipeline (updateSeasons/backfillSeasons/listFeelings +
  detectSeasonShift/detectRecurringTheme). Unlocks the season shift and recurring
  theme triggers in the greeting. decideThresholdMode and buildGreetingPrompt already
  take seasonShift, so Slice B feeds it with no change to this slice's code.
- Slice C - outcome-loop display: getResolvedPredictions (the join that reads a
  resolved prediction back with its outcome + verdict) and a real /api/foretellings
  endpoint. After Slice A, resolved predictions are correctly STORED but not yet
  shown in a foretellings view. This is a read-only concern and does not touch
  applyOps, which is complete after Slice A.
- Temporal callbacks (findTemporalCallbacks/filterSurfaced) - a separate memory-depth
  feature; the greeting omits the temporal block.
- Profile-notebook persona layer (buildPersonaWithProfile) - the greeting uses the
  base READER_PERSONA + addressing, not the profile-enriched persona. /api/profiles
  stays stubbed.
- Curiosity questions (/api/reading-questions) - stays stubbed.

## Files touched

- Modify: app/src/main/java/com/matt/tarot/MemoryModel.kt
- Modify: app/src/main/java/com/matt/tarot/MemoryStore.kt
- Modify: app/src/main/java/com/matt/tarot/MemoryEngine.kt
- Modify: app/src/main/java/com/matt/tarot/TarotServer.kt
- Modify (tests): app/src/test/java/com/matt/tarot/MemoryModelTest.kt
- versionCode 3 -> 4, versionName "1.3" -> "1.4" in app/build.gradle
