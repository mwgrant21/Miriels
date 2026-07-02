# Android Reader Profile Synthesis + Persona Injection (Slice G1) Design

**Date:** 2026-07-01
**Status:** Approved
**Scope:** G1 of the Slice G split (profile synthesis + persona injection = the reading-facing moat). G2 (notebook display surface + endpoints) is a separate later cycle.

## Summary

Port the web reader-profile "moat" (`data/reader-profile.js`) to the Android app so every reading is warmth-tiered and, past 10 readings, shaped by a synthesized profile of the querent. Two LLM syntheses run in the background after a save (a periodic full profile refresh + a per-save living note), and the profile is injected into the persona at the five reader-relationship LLM call sites. The notebook DISPLAY surface (`data/notebook.js`, `GET/POST /api/profiles/*`) is explicitly out of scope for G1 (that is G2).

Web source of truth: `data/reader-profile.js` (getTier, getWarmthTier, WARMTH_NOTES, buildPersonaWithProfile, refreshReaderProfile, updateLivingNote) and the five `server.js` call sites of `buildPersonaWithProfile` + the save-reading refresh/living-note cadence.

## What Android already has

- `handleSaveReading` already fires `captureFromReading` + `seasonsUpdate` on background threads after a save (the pattern the new refresh/living-note calls follow).
- `loadReadingList(slug): List<JSONObject>`, `loadReaders()`, `readerNameFor(readers, slug)`, `buildAddressingNote(readerName)`, `buildCompatAddressingNote(readerName, aName, bName)`, `memoryCallLLM` (matches `CallLLM`), `dataDir` all exist in TarotServer.
- `const val HAIKU = "claude-haiku-4-5-20251001"`; the reading model is the string literal `"claude-sonnet-4-6"` (used e.g. in the threshold-answer reply).
- `java.util.Calendar` / `org.json` allowed in pure code; `java.time` FORBIDDEN (minSdk 24).

## Architecture (3 tasks)

### Task 1 - Pure tier/persona logic in `MemoryModel.kt` (JVM-testable, no android.* imports)
- `fun getTier(readingCount: Int): Int` - T2=10, T3=30 -> 1/2/3.
- `fun getWarmthTier(readingCount: Int): Int` - >=60->5, >=21->4, >=6->3, >=2->2, else 1.
- `val WARMTH_NOTES: Map<Int, String>` - the 5 notes, verbatim.
- `fun buildPersonaWithProfile(basePersona: String, profile: JSONObject?, readingCount: Int, currentCards: List<JSONObject>): String` - always append `WARMTH_NOTES[getWarmthTier(count)] ?: ""`; if profile==null or getTier<2 return early (warmth only); else layer `miriel_notes`, `life_arc` (only at getTier>=3), and a recurring-cards note built from `profile.recurring_cards` entries whose `card_id` is in the current spread's card ids. Pure (JSONObject is core Java).
- `fun extractProfileLabel(raw: String, label: String): String` - the regex label extractor (`LABEL:\s*([\s\S]*?)(?=\n[A-Z][A-Z_]+:|$)`, case-insensitive, trimmed).
- `fun extractProfileJSONArray(raw: String, label: String): JSONArray` - `JSONArray(extractProfileLabel(...))` or empty array on parse failure.
- `fun parseProfileSynthesis(raw: String, slug: String, readingCount: Int, nowSeconds: Long): JSONObject?` - assembles the profile object: slug, last_updated, readings_synthesized, miriel_notes, recurring_cards; if tier==3 adds life_arc {current_chapter, key_threads, inflection_points} + unresolved_thread. Returns null when `miriel_notes` is blank (the "do not persist a degraded profile" guard).
- JVM tests: tier + warmth boundaries; buildPersonaWithProfile at each tier (warmth-only tier 1, +miriel_notes tier 2, +life_arc tier 3, recurring-card matching by card_id, null-profile -> warmth only); parseProfileSynthesis (tier-2 shape, tier-3 shape, degraded miriel_notes -> null); extractProfileLabel/JSONArray.

### Task 2 - `ReaderProfile.kt` (new Android class, flat-JSON, NOT SQLite)
- Constructor takes `dataDir: File`; derives `profilesDir = File(dataDir, "profiles")` (mkdirs) and `readingsDir = File(dataDir, "readings")`.
- `loadReaderProfile(slug): JSONObject?` / `saveReaderProfile(slug, profile: JSONObject)` (profiles/<slug>.json; load best-effort -> null on any error).
- `readingCount(slug): Int` - length of readings/<slug>.json array (0 on any error).
- `persona(basePersona: String, slug: String, cards: List<JSONObject>): String` - IO convenience wrapper: `buildPersonaWithProfile(basePersona, loadReaderProfile(slug), readingCount(slug), cards)`. This is what call sites use. Best-effort: any throw -> basePersona (never break a reading).
- `refreshReaderProfile(slug, callLLM)` - reads readings/<slug>.json; if < T2 (10) return; builds the tier-2 vs tier-3 synthesis prompt (verbatim), calls `callLLM(system, prompt, 1500, "claude-sonnet-4-6")`, `parseProfileSynthesis`; if null return (degraded); PRESERVE prior `living_note`/`living_note_updated` from the existing profile; save. Best-effort (any throw swallowed).
- `updateLivingNote(slug, callLLM)` - last-3 readings -> `callLLM(LIVING_NOTE_SYSTEM, prompt, 200, HAIKU)`; blank -> return; merge `living_note` + `living_note_updated` into the loaded (or new) profile; save. Best-effort.
- `LIVING_NOTE_SYSTEM` const (verbatim). `SYNTH_SYSTEM = "You are Miriel, an experienced tarot reader."` (verbatim).
- Time is unix SECONDS (`System.currentTimeMillis() / 1000`).

### Task 3 - Persona injection (5 sites) + save cadence + version bump
- Add a `private val readerProfile = ReaderProfile(dataDir)` field in TarotServer.
- Wrap the persona at the FIVE reader-relationship sites (mirroring the five web `buildPersonaWithProfile` calls):
  1. **interpret (line 776):** replace `READER_PERSONA + buildAddressingNote(readerName)` (the leading term) with `readerProfile.persona(READER_PERSONA + buildAddressingNote(readerName), slug, cardsList)`, keeping `+ memoryBlock + recurringThemeBlock + patternBlock + prophecy.block + OVERCLAIM_GUARD`. `slug` already exists; `cardsList` = the spread `cards` as `List<JSONObject>`.
  2. **compatibility (line 484):** parse `slug` (`body.optString("reader")` with the readers[0]/"matt" fallback) and wrap: `readerProfile.persona(READER_PERSONA + buildCompatAddressingNote(readerName, aName, bName), slug, cardsList)`.
  3. **threshold greeting (line 660):** `val system = readerProfile.persona(READER_PERSONA + buildAddressingNote(readerName), slug, emptyList())`.
  4. **threshold-answer reply (line 691):** `val system = readerProfile.persona(READER_PERSONA + buildAddressingNote(readerName), slug, emptyList())`.
  5. **clarify (line 967):** parse `reader` slug (`body.optString("reader")`); web ternary - only wrap when a slug is present, else the bare base: `if (readerSlug.isNotEmpty()) readerProfile.persona(base, readerSlug, originalCardsList) else base`, where `base = READER_PERSONA + buildAddressingNote(readerName)`.
- Bare-`READER_PERSONA` sites (suggest-spread, session-summary, patterns, config) are LEFT UNTOUCHED - the web does not profile those.
- `handleSaveReading`: after the existing `captureFromReading` thread, add (mirroring the web save cadence):
  - Cadence refresh: `val cadence = if (readingCount >= 30) 10 else 5`; load the current profile's `readings_synthesized` (0 if none); if `readingCount - lastSynth >= cadence`, fire `refreshReaderProfile(slug, ::memoryCallLLM)` on a background thread (best-effort).
  - Living note: fire `updateLivingNote(slug, ::memoryCallLLM)` on a background thread (best-effort), unconditionally after each save (matches web).
- Version bump `versionCode 9 -> 10`, `versionName "1.9" -> "1.10"`.

## Data flow

save reading -> (bg) refresh profile if `readingCount - readings_synthesized >= cadence` + update living note -> subsequent reads call `readerProfile.persona(base, slug, cards)` -> base + warmth note always; synthesized `miriel_notes` once >=10 readings; `life_arc` once >=30; recurring-card recognition when a current card's id matches a `recurring_cards` entry.

## Error handling

- `refreshReaderProfile` / `updateLivingNote` are best-effort: any throw is caught and swallowed (a failed synthesis must never break a save; the save response already returned since they run on background threads).
- `readerProfile.persona(...)` is best-effort: any throw returns `basePersona` (a profile problem must never break a reading).
- `loadReaderProfile` returns null on a missing/corrupt file -> warmth-only persona.
- `parseProfileSynthesis` returns null when extraction degrades -> no profile persisted (keeps the last good one).

## Ambiguity resolutions

1. **Where ReaderProfile lives:** it needs `dataDir` + readings files (server-side), not the MemoryStore, so **TarotServer owns it** (not MemoryEngine). It is flat-JSON (profiles/<slug>.json), consistent with readings/patterns/daily - it does NOT touch the single SQLite MemoryStore.
2. **Reading model for refresh:** web `refreshReaderProfile` calls `callLLM(system, prompt, 1500)` with the DEFAULT model = Sonnet; Android's `CallLLM` requires an explicit model arg, so refresh passes `"claude-sonnet-4-6"`. Living note passes `HAIKU` (web is explicit haiku).
3. **Living note in G1:** `updateLivingNote` WRITES the note in G1 (so the save wiring is one atomic edit and `refreshReaderProfile`'s living-note preservation is exercised), but it is only DISPLAYED in G2's notebook. Nothing in G1 injects `living_note` into a persona (matches web - the living note is a notebook-only field).
4. **Clarify slug:** Android `handleClarify` currently parses only `readerName`; G1 adds `body.optString("reader")` for the profile ternary, faithful to web clarify's `reader`-gated `buildPersonaWithProfile`.
5. **Compatibility slug:** web derives `slug = req.body.reader || readers[0].slug || 'matt'`; Android compat adds the same parse.
6. **buildPersonaWithProfile purity:** it takes a `JSONObject?` profile so it stays pure/JVM-testable; the IO (load + count) lives in `ReaderProfile.persona`.

## Constraints (binding)

- ASCII-only in every added/model-facing line (pre-existing TarotServer non-ASCII is out of scope).
- Local commits only; TarotApp has no remote; never push.
- Time is unix SECONDS.
- `ReaderProfile` is flat-JSON; it does NOT construct or touch a SQLite connection (the single MemoryStore stays MemoryEngine's).
- Build/test via Android Studio's bundled JBR + `gradlew.bat` (JVM unit tests + assembleDebug).

## Testing

- Task 1: JVM unit tests for all pure logic.
- Tasks 2-3: `assembleDebug` compile gate.
- End: on-device smoke on real data (matt = 85 readings -> tier 3). Verify: (a) a save that hits the cadence writes/refreshes profiles/matt.json with miriel_notes + recurring_cards + life_arc; (b) updateLivingNote writes living_note; (c) an interpret call's persona actually carries the warmth note + synthesized profile detail (confirm by forcing a profile and checking behavior, or by inspecting that persona construction runs without error and the profile file is consumed). Restore device state after.

## Out of scope (deferred to G2)

- `buildNotebookPayload` + `resolveCardImage` (image resolution for recurring cards).
- Real `GET /api/profiles/:slug` (notebook payload) + `POST /api/profiles/:slug/refresh` (manual refresh) - the stub stays in G1.
- Any frontend change (already bundled).
