# Android In-Reading Curiosity (Slice F) Design

**Date:** 2026-06-30
**Status:** Approved
**Scope:** Full parity (detect + weave + capture)

## Summary

Port the web "in-reading curiosity" feature to the Android app (TarotApp). As a spread is dealt, a conservative Haiku pass (`detectCuriosity`) decides whether any single card strikingly pulls Miriel toward a remembered open thread, returning 0-2 in-voice questions tied to a card. The bundled frontend surfaces them mid-deal; the querent may answer. On interpret, their answers (a) get woven into the reading via a `curiosityBlock` appended to the user prompt, and (b) are captured back into the memory graph via `captureAnswer(..., "curiosity")`.

This is a faithful port of the web source:
- `data/memory-engine.js`: `detectCuriosity`, `captureAnswer`, `CURIOSITY_SYSTEM`, `buildCuriosityCardLines`, `buildCuriosityPrompt`, `parseCuriosityOutput`.
- `server.js`: `/api/reading-questions` handler; the `curiosityBlock` + `answeredCuriosity` capture loop inside the interpret handler.

## What Android already has (no re-build)

From Slice A (Threshold greeting) and the memory substrate:
- `MemoryStore.getOpenUnaskedThreads(slug, limit=3, minSalience=3): List<MemoryRow>`
- `MemoryStore.markAsked(ids: List<Long>)`
- `MemoryStore.getMemory(id: Long): MemoryRow?`
- `MemoryStore.applyOps(slug, ops, sourceKind, sourceId): ApplyResult`
- `MemoryEngine.captureThresholdAnswer(slug, answer, threadIds, callLLM)` (to be refactored)
- `MemoryModel`: `THRESHOLD_CAPTURE_SYSTEM`, `buildThresholdCapturePrompt`, `parseExtractorOutput`, `THRESHOLD_SALIENCE_BAR = 3`, `HAIKU` model const, `buildAddressingNote` (in TarotServer)

The bundled frontend (`assets/tarot-server/public/app.js`, re-synced in Track 1) already POSTs cards to `/api/reading-questions` during the deal and includes `curiosityAnswers` in the `/api/interpret` body. **No frontend work.**

## Architecture (3 tasks)

### Task 1 - Pure logic in `MemoryModel.kt` (JVM-testable, no android.* imports)
- `data class CuriosityQuestion(val cardId: String, val question: String, val threadIds: List<Long>)`
- `const val CURIOSITY_SYSTEM` - verbatim from web (Miriel's quiet-intuition persona, conservative).
- `fun buildCuriosityCardLines(cards: List<JSONObject>): String` - `[id] position: name (reversed)` lines.
- `fun buildCuriosityPrompt(cards: List<JSONObject>, threads: List<MemoryRow>): String` - verbatim prompt.
- `fun parseCuriosityOutput(raw: String?): List<JSONObject>` - tolerant extractor: object-with-`questions`, bare array, or `[]` on garbage.
- JVM tests: `parseCuriosityOutput` (object-with-questions, bare array, prose+json, garbage->[]), and `buildCuriosityPrompt` shape (contains card lines + thread lines + the JSON schema instruction).

### Task 2 - `MemoryEngine.kt`
- New generic `captureAnswer(slug, answer, threadIds, callLLM, sourceKind = "threshold"): ApplyResult` (best-effort; any throw -> zero `ApplyResult`). Body = the current `captureThresholdAnswer` body but with `sourceKind` passed to `applyOps`.
- `captureThresholdAnswer` becomes a one-line delegate to `captureAnswer(..., "threshold")` (matches web).
- `detectCuriosity(slug, cards: List<JSONObject>, callLLM, readerName): List<CuriosityQuestion>`:
  - `threads = store.getOpenUnaskedThreads(slug, 8, THRESHOLD_SALIENCE_BAR)`; if empty return `emptyList()`.
  - `system = CURIOSITY_SYSTEM + buildAddressingNote(readerName)` - NOTE `buildAddressingNote` lives in TarotServer, so detectCuriosity takes the already-built `system` OR takes readerName and the caller passes a pre-built addressing note. DECISION: `detectCuriosity` takes `readerName: String` and an `addressingNote: String` param (the caller in TarotServer supplies `buildAddressingNote(readerName)`), keeping MemoryEngine free of the server helper. (Simplest faithful option; see Ambiguity Resolutions.)
  - Haiku call (`callLLM(system, buildCuriosityPrompt(cards, threads), 500, HAIKU)`); any throw -> `emptyList()`.
  - Build `cardIds` set (from spread card ids as strings) and `threadIds` set (Long).
  - `parseCuriosityOutput(raw)` -> filter to entries with a non-empty `question`, `card_id` in `cardIds`, and `thread_ids` intersecting `threadIds` -> `.take(2)` -> map to `CuriosityQuestion(cardId, question, thread_ids filtered to known)`.
- `markAsked(ids: List<Long>)` delegator to `store.markAsked`.

### Task 3 - `TarotServer.kt` wiring + version bump
- Replace the `/api/reading-questions` stub route body with `handleReadingQuestions(body)`:
  - Parse `reader` (fallback to first reader slug / "matt") and `cards` (JSONArray -> List<JSONObject>).
  - `readerName` via `readerNameFor(readers, slug)`.
  - `val questions = memory.detectCuriosity(slug, cards, ::memoryCallLLM, readerName, buildAddressingNote(readerName))`.
  - `memory.markAsked(questions.flatMap { it.threadIds })`.
  - Return `{questions:[{card_id, question, thread_ids:[...]}]}`.
  - Best-effort: any throw -> `{questions:[]}` (Log.w).
- `handleInterpret`:
  - Read `curiosityAnswers` (JSONArray, optional) from the body; filter to those with a non-blank `answer`.
  - Build `curiosityBlock` (verbatim web text) and append to the USER `prompt` (matching web `promptFinal = prompt + curiosityBlock`) - NOT the system prompt.
  - After the Claude call returns, fire a background `Thread` that, for each answered item with a non-empty `threadIds`, calls `memory.captureAnswer(slug, answer, threadIds, ::memoryCallLLM, "curiosity")`. Fire-and-forget, wrapped in try/catch -> Log.w. (Matches web non-blocking capture; must not delay the interpretation response.)
- Version bump `versionCode 8 -> 9`, `versionName "1.8" -> "1.9"`.

## Data flow

deal -> frontend POST `/api/reading-questions` {reader, cards} -> `detectCuriosity` (Haiku) -> 0-2 questions -> shown mid-deal -> querent answers -> frontend includes `curiosityAnswers:[{question, answer, threadIds, cardId}]` in `/api/interpret` body -> woven into the reading prompt (`curiosityBlock`) + captured to memory on a background thread (`captureAnswer('curiosity')`).

## Error handling

Every new path is best-effort and cannot break a reading:
- `detectCuriosity` throw -> `[]`; endpoint throw -> `{questions:[]}`.
- `captureAnswer` throw -> zero `ApplyResult`; the background capture loop is wrapped in try/catch -> Log.w.
- `curiosityBlock` only appended when there are answered items; empty otherwise.

## Ambiguity resolutions

1. **`buildAddressingNote` location:** it lives in `TarotServer`, not `MemoryEngine`. `detectCuriosity` will accept the pre-built `addressingNote: String` as a param (caller supplies `buildAddressingNote(readerName)`), so `MemoryEngine` stays free of server helpers. `readerName` is still passed for parity/logging but the system string is assembled as `CURIOSITY_SYSTEM + addressingNote`.
2. **Card id typing:** spread card ids are treated as **strings** (`optString("id")`); `card_id` from the LLM compared as string. Faithful to web (`c.id` / `q.card_id` used as Set members without numeric coercion).
3. **Curiosity capture threading:** background `Thread` (fire-and-forget) so the extra Haiku call never delays the interpretation response, matching web's post-`res.json` non-blocking capture and Android's existing background-capture pattern (`captureFromReading` in `handleSaveReading`).
4. **Prompt vs system placement:** `curiosityBlock` appends to the USER prompt (`promptFinal = prompt + curiosityBlock`), exactly as web; it is NOT part of the persona/system prompt.

## Constraints (binding)

- ASCII-only in every added/model-facing line (pre-existing TarotServer non-ASCII is out of scope).
- Local commits only; TarotApp has no remote; never push.
- Single `MemoryStore` connection (MemoryEngine's existing `store`).
- Time is unix SECONDS (capture uses the existing seconds-based `applyOps`; no ms island in this slice).
- Build/test via Android Studio's bundled JBR + `gradlew.bat` (JVM unit tests + assembleDebug).

## Testing

- Task 1: JVM unit tests for `parseCuriosityOutput` + `buildCuriosityPrompt`.
- Tasks 2-3: `assembleDebug` compile gate.
- End: on-device smoke on the real provisioned data - POST `/api/reading-questions` with a card set carrying ids, confirm a conservative 0-2 question response referencing real open threads; then confirm answering one via an `/api/interpret` call with `curiosityAnswers` persists a `curiosity`-sourced memory (source_kind='curiosity' row appears). Restore device state after.

## Out of scope

- Slice G (profile notebook / living note, `/api/profiles/*` still stubbed).
- Any frontend change (already bundled).
