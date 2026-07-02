# Android Emotional Seasons (Slice B) - Design

**Date:** 2026-06-27
**Status:** Approved (design)
**Project:** TarotApp (Android), C:\Users\Matt\projects\TarotApp
**Web reference:** C:\Users\Matt\projects\tarot (data/emotional-seasons.js, server.js)
**Builds on:** the Android memory substrate + Threshold greeting Slice A (both shipped to TarotApp master).

## Goal

Port the web emotional-seasons pipeline to Android so Miriel tracks the querent's
emotional "seasons" over time, and so two signals derived from that timeline reach
the reader:

- **Season shift** -> the **Threshold greeting** (fills the `seasonShift` parameter
  that Slice A already threads through `decideThresholdMode` / `buildGreetingPrompt`
  as `null`).
- **Recurring theme** -> the **in-reading interpret persona** (a theme block appended
  alongside the existing memory + pattern blocks).

Faithful 1:1 port of the web split (shift in the greeting, theme in the reading).
No schema migration: seasons live in `memory_meta` as JSON.

## What a "season" is

The pipeline reads the querent's `feeling` atoms and characterizes a stretch of them
into one season record via Haiku:

```
{ index, started_at, ended_at, label, valence (-2..+2), themes [up to 4 lowercase], summary }
```

Records accumulate as a JSON array in `memory_meta` under key `seasons:<slug>`. Two
producers build it:

- **backfillSeasons** (one-time, on first launch): buckets ALL existing feelings into
  consecutive windows of at most 30 days (measured from each window's first feeling),
  characterizes each window that has >= 4 feelings. Gated by a `seasons_backfilled:<slug>`
  flag. Lets a Haiku throw propagate so the flag stays unset and a later boot retries
  (same contract as memory backfill).
- **updateSeasons** (incremental, every 8th reading): characterizes feelings newer than
  the last season's `ended_at` into ONE new season, only if there are >= 4 such feelings.
  Best-effort: any throw returns "added 0", never breaks the save.

Two consumers read it:

- **detectSeasonShift(seasons, now)** (pure): compares the latest season to the most
  contrasting earlier one; if the valence delta >= 2, emits a `SeasonShift{signature,
  fact}` for the greeting. Else null.
- **detectRecurringTheme(seasons)** (pure): finds the theme present in the most distinct
  seasons (>= 2); emits a `RecurringTheme{theme, seasons, fact}` for the reading. Else null.

## Architecture (same pure/Android split as Slice A)

### 1. MemoryModel.kt (extend; PURE, JVM-unit-tested)

Constants (verbatim from web):
```
const val MIN_FEELINGS_PER_SEASON = 4
const val SEASON_WINDOW_DAYS = 30
const val SEASON_CADENCE = 8
const val SHIFT_THRESHOLD = 2
const val THEME_MIN_SEASONS = 2
```

Types:
```
data class Season(val index: Int, val startedAt: Long, val endedAt: Long,
                  val label: String, val valence: Int, val themes: List<String>, val summary: String)
data class ParsedSeason(val label: String, val valence: Int, val themes: List<String>, val summary: String)
data class Feeling(val content: String, val salience: Int, val createdAt: Long)
data class RecurringTheme(val theme: String, val seasons: Int, val fact: String)
// SeasonShift(signature, fact) already exists from Slice A and is reused.
```

Pure functions (ported verbatim from data/emotional-seasons.js):
- `themesPhrase(themes: List<String>): String` -> ` (a, b)` or ``
- `detectSeasonShift(seasons: List<Season>, now: Long): SeasonShift?` - latest vs most
  contrasting earlier (tie broken by higher index); requires delta >= SHIFT_THRESHOLD;
  signature `season-shift:<earlier.index>-><latest.index>`; fact text exact.
- `detectRecurringTheme(seasons: List<Season>): RecurringTheme?` - theme in >= THEME_MIN_SEASONS
  distinct seasons, ranked by distinct, then occurrences, then recency; fact text exact.
- `parseSeasonOutput(raw: String?): ParsedSeason?` - first `{` to last `}`, JSON parse,
  require non-empty label + summary, clamp valence to [-2,2], themes lowercased/trimmed/<=4.
- `buildSeasonPrompt(feelings: List<Feeling>): String` - verbatim.
- `bucketWindows(feelings: List<Feeling>, windowDays: Int): List<List<Feeling>>` - verbatim.
- `const val SEASON_SYSTEM: String` - verbatim (note: its own text says "ASCII only. No em dashes.").
- `buildSeasonThemeBlock(fact: String): String` - the in-reading persona block wrapper
  (ported from server.js seasonThemeBlock), so the model-facing prose is testable + ASCII-checked.

JSON <-> Season conversion (pure; org.json is available in unit tests via the existing
`testImplementation 'org.json:json:20231013'`):
- `seasonToJson(s: Season): JSONObject` and `seasonFromJson(o: JSONObject): Season?`
  using snake_case keys `index, started_at, ended_at, label, valence, themes, summary`
  (identical shape to the web meta).
- `parseTimeline(json: String?): List<Season>` (tolerant: bad JSON -> empty list).
- `serializeTimeline(seasons: List<Season>): String`.

All ported strings ASCII only; verify with a byte scan before committing.

### 2. MemoryStore.kt (extend)

Add `listMemories(slug: String): List<MemoryRow>` - `SELECT * FROM memories WHERE
reader_slug = ? ORDER BY created_at ASC` (the pipeline needs all `feeling` atoms; the
store has no list method today). Uses the existing `rowFrom` + `.use {}` pattern.

### 3. EmotionalSeasons.kt (NEW; impure: LLM + meta)

`class EmotionalSeasons(private val store: MemoryStore)` - mirrors the web module.
Constructed by MemoryEngine using MemoryEngine's existing single `store` instance, so
there is exactly ONE SQLite connection (preserving the concurrency property the Slice A
review relied on). Time in unix SECONDS.

- `listFeelings(slug): List<Feeling>` = `store.listMemories(slug).filter { it.type ==
  "feeling" }.map { Feeling(it.content, it.salience, it.createdAt) }.sortedBy { it.createdAt }`.
- `readTimeline(slug): List<Season>` = `parseTimeline(store.getMeta("seasons:$slug"))`.
- `writeTimeline(slug, seasons)` = `store.setMeta("seasons:$slug", serializeTimeline(seasons))`.
- `updateSeasons(slug, callLLM): Int` - try/catch -> 0; windowStart = last season ended_at
  (or 0); feelings newer than windowStart; need >= MIN_FEELINGS_PER_SEASON; Haiku characterize;
  parse; append Season(index = timeline.size, startedAt = first.createdAt, endedAt =
  last.createdAt, ...parsed); write; return 1.
- `backfillSeasons(slug, callLLM): Int` - if `seasons_backfilled:$slug` set -> 0; if timeline
  already non-empty -> set flag, 0; bucket all feelings; per window with >= MIN_FEELINGS_PER_SEASON,
  Haiku characterize + parse + append (index increments only on accepted windows); write if any;
  set flag; return count. Lets a callLLM throw propagate (flag stays unset, retries next boot).
- `pendingSeasonShift(slug, now): SeasonShift?` - `detectSeasonShift(readTimeline(slug), now)`
  filtered by the `season_surfaced:<slug>` TTL map: suppressed if the signature was surfaced
  within 30 days (SEASON_TTL_S = 30 * 86400). Read-only (no write here).
- `markSeasonSurfaced(slug, shift, now)` - prune entries older than the TTL, set
  `surfaced[shift.signature] = now`, write back. (`season_surfaced:<slug>` is a JSON object
  string in meta.)
- `recurringThemeFact(slug): String?` - `detectRecurringTheme(readTimeline(slug))?.fact`.

Haiku model id = the existing `HAIKU` constant. Characterization maxTokens 300.

### 4. MemoryEngine.kt (extend - delegation + threshold wiring)

- `private val seasons = EmotionalSeasons(store)`.
- Delegators for TarotServer: `fun seasonsUpdate(slug, callLLM): Int`, `fun seasonsBackfill(slug,
  callLLM): Int`, `fun recurringThemeBlock(slug): String` (= `recurringThemeFact(slug)?.let {
  buildSeasonThemeBlock(it) } ?: ""`).
- `threshold(...)` change: replace the `null` season argument. Compute
  `val seasonShift = seasons.pendingSeasonShift(slug, now)`; pass it to BOTH
  `decideThresholdMode(... , seasonShift)` and `buildGreetingPrompt(... , seasonShift)`.
  In the success path (after `markAsked` + `last_visit`), if `seasonShift != null` call
  `seasons.markSeasonSurfaced(slug, seasonShift, now)`. (A shift alone can now make the
  mode non-"none" even with no threads - faithful to web `hasMaterial`.)

### 5. TarotServer.kt (two wiring points)

- `handleInterpret`: append the recurring-theme block to the system prompt -
  `systemPrompt = READER_PERSONA + buildAddressingNote(readerName) + memoryBlock +
  memory.recurringThemeBlock(slug) + buildPatternBlock(slug, cards)`. (Web orders it after
  prophecy/before overclaim; Android has neither yet, so it sits after the memory block.)
- `handleSaveReading`: after the reading is written, compute `readingCount = trimmed.length()`;
  if `readingCount % SEASON_CADENCE == 0`, fire `Thread { memory.seasonsUpdate(slug,
  ::memoryCallLLM) }` (best-effort, wrapped in try/catch + Log.w; mirrors the existing capture Thread).
- `ensureBackfill`: in the existing per-reader backfill loop, after `memory.backfill(...)`,
  also run `memory.seasonsBackfill(rslug, ::memoryCallLLM)` SEQUENTIALLY (so feeling atoms
  exist before season backfill reads them - a deliberate, faithful-but-safer ordering vs the
  web's concurrent fire). Wrapped so a season-backfill throw is logged, not fatal.

## Data flow

Readings accumulate `feeling` atoms (existing capture). First launch: backfillSeasons buckets
them into the initial timeline. Every 8th reading: updateSeasons appends a new season.
Return visit: the greeting reads the timeline -> detectSeasonShift -> (deduped) seasonShift ->
rendered in the reunion greeting. In a reading: handleInterpret reads the timeline ->
detectRecurringTheme -> theme block in the persona.

## Error handling

Every layer best-effort and observable:
- updateSeasons / detect* / parse* degrade to a safe default (0 / null / empty) and never throw
  into a reading or the greeting.
- backfillSeasons lets a Haiku throw propagate (so it retries next boot); the ensureBackfill
  thread catches + Log.w.
- The season-update Thread and the season-backfill call are wrapped with Log.w (the recall
  lesson: degrade, but log - never silently swallow).
- A corrupt `seasons:<slug>` meta blob parses to an empty timeline (no shift, no theme), never a crash.

## Testing

JVM unit tests (MemoryModelTest.kt, pure):
- detectSeasonShift: null on < 2 seasons; null when max delta < 2; fires on delta >= 2; picks the
  most-contrasting earlier season; tie broken by higher index; signature + monthsAgo phrasing.
- detectRecurringTheme: null on < 2 seasons; null when no theme reaches 2 distinct seasons; picks
  the theme in the most distinct seasons; ranking by distinct/occ/recency; fact text.
- parseSeasonOutput: valid object; valence clamp [-2,2] and non-integer -> 0; themes lowercased/
  trimmed/capped at 4; missing label or summary -> null; junk -> null.
- bucketWindows: groups consecutive feelings within a 30-day span from each window's first;
  starts a new window when the span is exceeded.
- parseTimeline / serializeTimeline round-trip; seasonFromJson tolerates a malformed record.
- buildSeasonPrompt / buildSeasonThemeBlock include their inputs.

Compile gate: assembleDebug (the store/engine/server changes are not JVM-testable).

On-device smoke (HUMAN gate):
1. Install; confirm season backfill runs without error and sets `seasons_backfilled:<slug>`
   (logcat clean; pull memory.db and read `memory_meta`).
2. Because the live device has too few feelings spread over too little time to form >= 2
   contrasting seasons naturally, SEED a synthetic 2-season timeline into `seasons:<slug>` (a
   light, heavy pair with a shared theme), then: (a) open the app and confirm the reunion greeting
   voices the season shift; (b) run a reading and confirm the recurring-theme block reaches the
   persona (a season-aware line in the interpretation, and/or the logged system prompt).
3. Confirm the `season_surfaced` dedup: the same shift does not re-voice on an immediate second open.

## Global constraints

- ASCII only in all model-facing prose and ported strings (SEASON_SYSTEM, prompts, the theme block).
  Verify with a byte scan before committing.
- Never push tarot or TarotApp git history. TarotApp is local-only. All commits stay local.
- Time in the memory layer is unix SECONDS.
- Faithful port: prompt wording, constants, and the detect/bucket math copied verbatim from
  data/emotional-seasons.js. Meta JSON keys are snake_case, identical shape to web.
- ONE SQLite connection: EmotionalSeasons shares MemoryEngine's existing store instance; do not
  construct a second MemoryStore.
- Reuse existing infrastructure (memoryCallLLM, ensureBackfill, the existing HAIKU constant, the
  capture-Thread pattern). No new HTTP or LLM plumbing.
- Build/verify from CLI with JAVA_HOME = the Android Studio JBR (gradlew.bat assembleDebug /
  testDebugUnitTest).

## Deferred (unchanged by this slice)

- Temporal callbacks (findTemporalCallbacks / filterSurfaced) - separate memory-depth feature;
  the greeting still omits the temporal block.
- Profile-notebook persona layer (buildPersonaWithProfile) - greeting/reading use the base persona.
- Foretellings read surface (getResolvedPredictions, /api/foretellings) - Slice C; the RESOLVE
  write path from Slice A is already complete.

## Files touched

- Modify: app/src/main/java/com/matt/tarot/MemoryModel.kt
- Modify: app/src/main/java/com/matt/tarot/MemoryStore.kt
- Create: app/src/main/java/com/matt/tarot/EmotionalSeasons.kt
- Modify: app/src/main/java/com/matt/tarot/MemoryEngine.kt
- Modify: app/src/main/java/com/matt/tarot/TarotServer.kt
- Modify (tests): app/src/test/java/com/matt/tarot/MemoryModelTest.kt
- versionCode 4 -> 5, versionName "1.4" -> "1.5" in app/build.gradle
