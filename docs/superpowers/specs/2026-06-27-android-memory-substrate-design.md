# Android Memory Substrate — Design

**Date:** 2026-06-27
**Status:** Approved (design); pending implementation plan
**Project:** TarotApp (Android) — `C:\Users\Matt\projects\TarotApp`
**Parity source:** web app `data/memory-store.js` + `data/memory-engine.js`

## Summary

Give the Android Tarot app the foundation of Miriel's memory moat: a persistent
store of discrete "memory atoms" about the querent, written from each reading and
recalled into future readings. This is **Track 4, slice 1** of the Android parity
program (after frontend re-sync, persona/accuracy, and card-patterns shipped). It
ports the web memory **substrate** only.

Today the Android app stubs every memory endpoint (`/api/threshold` -> `{mode:none}`,
`/api/profiles/*` -> tier 1, etc.) and has no persistence beyond flat reading JSON.
This slice makes Miriel actually accumulate and recall what she knows.

## Scope

### In scope (this slice)
- SQLite `memory.db` atom store (`memories`, `memory_links`, `memory_meta`).
- `applyOps` supporting **ADD / UPDATE / TOUCH**.
- Capture from a reading: a Haiku extraction pass after each saved reading writes/updates atoms.
- Deterministic recall: score stored atoms against the current question + cards, inject a recall block into `/api/interpret`.
- One-time backfill from the reader's existing reading history.

### Explicitly deferred (later slices)
- Threshold reunion greeting, dormant threads.
- Predictions: ripeness, `RESOLVE`/verdicts, foretellings surface, prophecy weaving.
- Emotional seasons (timeline, greeting drift, recurring-theme block).
- In-reading curiosity.
- Living note / profile notebook synthesis.

The DB schema is created **complete** (including `asked_at`, `status`, links, meta)
so later slices add behavior without a migration. `applyOps` will simply not
implement `RESOLVE` yet (it is a no-op branch / left out until the outcome-loop slice).

## Non-goals (YAGNI)
- No Room / no annotation processor. Raw `SQLiteOpenHelper`.
- No new dependencies. Reuse the existing OkHttp `callClaude` path.
- No change to the existing `handlePatterns` notebook endpoint (separate feature).
- No threading framework; a single background `Thread` (or a small cached executor) for fire-and-forget capture/backfill.

## Architecture

Two new Kotlin files plus wiring in `TarotServer.kt`. `memory.db` lives in the
app's `dataDir` (same writable dir as `readings/`, survives upgrades).

### `MemoryStore.kt` — persistence (SQLiteOpenHelper)

A `SQLiteOpenHelper` subclass (DB name `memory.db`, version 1) that creates the
schema in `onCreate` and exposes the substrate operations. Schema is a faithful
port of `data/memory-store.js`:

```sql
CREATE TABLE memories (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  reader_slug        TEXT NOT NULL,
  type               TEXT NOT NULL,
  content            TEXT NOT NULL,
  status             TEXT,
  salience           INTEGER NOT NULL DEFAULT 3,
  subject            TEXT,
  source_kind        TEXT NOT NULL,
  source_id          TEXT,
  created_at         INTEGER NOT NULL,   -- unix SECONDS
  updated_at         INTEGER NOT NULL,
  last_referenced_at INTEGER,
  reference_count    INTEGER NOT NULL DEFAULT 0,
  asked_at           INTEGER             -- created now even though unused this slice
);
CREATE INDEX idx_mem_slug        ON memories(reader_slug);
CREATE INDEX idx_mem_slug_type   ON memories(reader_slug, type);
CREATE INDEX idx_mem_slug_status ON memories(reader_slug, status);
CREATE INDEX idx_mem_slug_sal    ON memories(reader_slug, salience);

CREATE TABLE memory_links (
  from_id  INTEGER NOT NULL,
  to_id    INTEGER NOT NULL,
  relation TEXT NOT NULL,
  PRIMARY KEY (from_id, to_id, relation)
);

CREATE TABLE memory_meta ( key TEXT PRIMARY KEY, value TEXT );
```

Time is **unix SECONDS** throughout (`System.currentTimeMillis() / 1000`), matching
the web store (NOT the milliseconds used by CardPatterns).

A pure `MemoryRow` data class is the read shape returned by queries (so the recall
scorer never touches a `Cursor`):

```kotlin
data class MemoryRow(
  val id: Long, val readerSlug: String, val type: String, val content: String,
  val status: String?, val salience: Int, val subject: String?,
  val sourceKind: String, val sourceId: String?,
  val createdAt: Long, val updatedAt: Long,
  val lastReferencedAt: Long?, val referenceCount: Int, val askedAt: Long?
)
```

Public API (this slice):
- `addMemory(slug, type, content, status, salience, subject, sourceKind, sourceId): Long`
- `getMemory(id): MemoryRow?`
- `applyOps(slug, ops: List<Op>, sourceKind, sourceId): ApplyResult` — ADD/UPDATE/TOUCH
- `getOpenAndSalient(slug, limit): List<MemoryRow>` — `ORDER BY (status='open') DESC, salience DESC, updated_at DESC`
- `markReferenced(ids)` — bump `reference_count`, set `last_referenced_at = now`
- `getMeta(key): String?` / `setMeta(key, value)`
- `clampSalience(n): Int` (1..5, default 3)
- constants `TYPES`, `STATUSES`

`UPDATE` uses COALESCE semantics (only non-null fields change), scoped by
`reader_slug`. `TOUCH` bumps `reference_count` + `updated_at`. All writes set
`updated_at`. Validation mirrors the web: ADD requires a known `type` and
non-blank `content`; unknown ops are skipped.

### `MemoryEngine.kt` — capture, recall, backfill, + pure scorer

Holds a `MemoryStore` and the behavior. The **pure, framework-free** pieces (no
Android imports) so they unit-test on the JVM:

- `tokenize(s): List<String>` — lowercase, strip non-alphanumerics, drop stopwords + words <= 2 chars. Stopword set ported verbatim.
- `keywordOverlap(queryTokens: Set<String>, memTokens: List<String>): Double` — `min(1, distinctHits/3)`.
- `freshness(lastRef: Long?, now: Long): Double` — `1` if never referenced, else `min(1, days/30)`.
- `scoreMemory(m: MemoryRow, queryTokens: Set<String>, now: Long): Double` — `3.0*overlap + 1.5*sal + 1.5*statusW + 0.5*fresh - 0.4*over`, where `statusW` = 1 open / 0.6 moving / 0 else, `sal = clamp(1..5)/5`, `over = min(1, refCount/5)`. Weights and formula copied verbatim from the web.
- `scoreCandidates(cands, question, cards, now): List<Scored>` — build query tokens from `question + card names`, sort desc.
- `parseExtractorOutput(raw): List<Op>` — tolerant: find first `{`/`[`, slice to matching close, accept a bare array or `{operations:[...]}`; any parse error -> empty list.

The impure pieces (use the store and `callLLM`):

- `recall(slug, question, cards): RecallResult` — `getOpenAndSalient(slug, 200)`, score, keep `score > 0`, top `RECALL_LIMIT = 10`, `markReferenced` them, return `{memories, block}`. `block` from `formatRecallBlock` (text ported verbatim).
- `captureFromReading(slug, reading, callLLM)` — `existing = getOpenAndSalient(slug, 30)`; `callLLM(EXTRACT_SYSTEM, buildCapturePrompt(reading, existing), 800, HAIKU)`; parse -> `applyOps(slug, ops, "reading", reading.id)`. Best-effort: any throw returns a zero result.
- `backfill(slug, loadReadings, callLLM)` — guard on `getMeta("backfilled:$slug")`; chunk readings by `BACKFILL_CHUNK = 12`; per chunk `callLLM(BACKFILL_SYSTEM, buildBackfillPrompt(chunk), 1200, HAIKU)`, keep only ADD ops, apply; set the flag only after all chunks succeed (a throw leaves it unset so a later run retries). Same throw-to-propagate contract as the web.

`callLLM` is an Android-side adapter: `(system, prompt, maxTokens, model) -> String?`
built on the existing `callClaude(apiKey, body)`. `HAIKU = "claude-haiku-4-5-20251001"`.
Prompt builders (`buildCapturePrompt`, `summarizeReading`, `buildBackfillPrompt`,
`EXTRACT_SYSTEM`, `BACKFILL_SYSTEM`, `formatRecallBlock`) are ported verbatim
(ASCII; the persona em-dash rules do not apply to these internal extractor prompts,
but keep them ASCII to match the codebase).

### Wiring in `TarotServer.kt`

- Construct one `MemoryEngine(dataDir)` as a field (opens `memory.db`).
- `handleSaveReading`: after the reading is written, spawn a background thread that
  calls `engine.captureFromReading(slug, readingJson, callLLM)`. The HTTP response
  returns immediately (`{ok:true}`), unchanged.
- `handleInterpret`: compute `memoryBlock = engine.recall(slug, question, cards).block`
  (try/catch -> ""), and prepend it to the persona **before** `buildPatternBlock`:
  `READER_PERSONA + addressingNote + memoryBlock + patternBlock`.
- Backfill is triggered **lazily on the first `/api/interpret` of the process**
  (guarded by an `AtomicBoolean` so it runs once per launch), on a background
  thread, looping over `loadReaders()`. Lazy (not in the constructor / MainActivity)
  guarantees config + API key are present before any Haiku call. Capture already
  covers all new readings, so a slightly delayed backfill is harmless.

## Data flow

```
POST /api/readings (save)
  -> write reading JSON (existing)
  -> [background thread] engine.captureFromReading(slug, reading, callLLM)
        -> Haiku extract -> applyOps ADD/UPDATE/TOUCH on memory.db
  -> respond {ok:true}   (never waits on capture)

POST /api/interpret
  -> memoryBlock = engine.recall(slug, question, cards).block   (deterministic, sync)
  -> system = READER_PERSONA + addressingNote + memoryBlock + patternBlock
  -> Claude interpret (existing)

first /api/interpret of the process (guarded once)
  -> [background thread] for each reader: engine.backfill(slug, loadReadings, callLLM)  (one-time per reader)
```

## Error handling
- `recall`: wrap in try/catch, return `""` block on any failure. A reading still renders.
- `captureFromReading` / `backfill`: best-effort. LLM or parse failure -> zero ops, no crash. Backfill leaves its flag unset on throw so it retries next launch.
- SQLite open/IO failure must not crash a reading: the engine field construction and each call site are guarded; a null/failed engine degrades to no memory (empty recall block, capture skipped).
- Capture runs off the request thread; a slow or failing Haiku call never delays the save response.

## Testing
- **JVM unit tests** (`gradlew testDebugUnitTest`, no device) for the pure logic:
  - `tokenize` drops stopwords/short words; `keywordOverlap` caps at 1.0 at 3 hits.
  - `freshness` = 1 when never referenced, ramps to 1 over 30 days.
  - `scoreMemory` ordering: relevance (overlap) outweighs salience; an open salient on-topic atom outranks a resolved off-topic one (port the web regression guard).
  - `parseExtractorOutput`: bare array, `{operations:[...]}`, leading prose before JSON, and malformed input -> `[]`.
- **Compile gate**: `gradlew assembleDebug` green.
- **On-device smoke** (SQLite needs the device; not unit-testable without Robolectric):
  1. Do a reading -> `memory.db` gains atoms (capture ran).
  2. Do a second related reading -> Miriel references something from the first (recall block fired); `reference_count` bumps.
  3. Fresh install with existing readings -> backfill seeds atoms once; flag prevents re-run.

**Bar:** existing 15 CardPatterns unit tests stay green; new pure-logic tests added; `assembleDebug` green.

## Risks & mitigations
- **Android SQLite not in JVM tests** -> keep scorer/parser pure and unit-test those; validate the store on device. Accepted.
- **Capture latency / cost** -> off-thread, best-effort, Haiku (cheap). A failed capture just means nothing learned that reading.
- **Backfill on a large history** -> chunked (12), one-time, off-thread; flag guards re-run; partial failure retries from scratch (dup risk is low and matches the web's accepted behavior).
- **Seconds vs milliseconds** -> the memory store is unix SECONDS everywhere; only CardPatterns uses ms. Documented in code.
- **Reader slug resolution** -> reuse the same `body.reader || readers[0].slug || "matt"` resolution already added in Track 3's interpret wiring.

## File-by-file summary
- New: `app/src/main/java/com/matt/tarot/MemoryStore.kt`
- New: `app/src/main/java/com/matt/tarot/MemoryEngine.kt`
- New: `app/src/test/java/com/matt/tarot/MemoryEngineTest.kt` (pure-logic unit tests)
- Modify: `app/src/main/java/com/matt/tarot/TarotServer.kt` (construct engine; capture in save; recall in interpret; lazy backfill trigger). No `MainActivity.kt` change needed.
