# Android Prophecy Weaving (Slice D) — Design

**Date:** 2026-06-28
**Target:** TarotApp (Android, Kotlin)
**Status:** Approved

## Goal

In a reading, surface up to 3 of Miriel's own past foretellings (resolved-with-verdict
first, then still-open) into the interpret persona, so she can reference her foresight
when a card or theme genuinely connects — with across-visit dedup so the same
foretelling does not re-fire on every keyword-matching reading. Faithful port of
`data/prophecy-recall.js` + the `server.js` interpret integration. Mirror web.

## Background

Slice C already ported `ResolvedPrediction`, `parseVerdictTag`, and
`MemoryStore.getResolvedPredictions`. This slice adds the still-open arm
(`getOpenPredictions`), the pure selection/formatting logic, the surfaced-dedup
meta, and the interpret wiring. The prediction RESOLVE write path (Slice A) and the
resolved read query (Slice C) are the upstream data sources.

The canonical verdict vocabulary is `came_to_pass`, `did_not`, `partly` (the
`VERDICTS` constant in both web and Android; what the threshold-capture LLM is told
to emit). Prophecy weights/kinds key off exactly these.

## Web reference (source of truth)

`data/prophecy-recall.js` — `findProphecyCallbacks`, `filterProphecySurfaced`,
constants, `resolvedFact`/`openFact`:

```js
const VERDICT_WEIGHT = { came_to_pass: 3, partly: 2, did_not: 1 };
const VERDICT_KIND   = { came_to_pass: 'fulfilled', partly: 'partial', did_not: 'missed' };
const PROPHECY_SURFACE_TTL_DAYS = 21;

function resolvedFact(kind, foretelling, outcome) {
  const tail = kind === 'fulfilled' ? 'It came to pass'
             : kind === 'partial'   ? 'It came partly true'
             : 'It did not come to pass';
  return outcome
    ? `You foretold: "${foretelling}". ${tail}: "${outcome}".`
    : `You foretold: "${foretelling}". ${tail}.`;
}
function openFact(foretelling) {
  return `You foretold: "${foretelling}". This is still unfolding, not yet resolved.`;
}

// resolved item: { id: prediction_id, kind: VERDICT_KIND[verdict]||'fulfilled', verdict,
//   foretelling, outcome, fact: resolvedFact(...), _weight: VERDICT_WEIGHT[verdict]||1,
//   _ov: overlap(queryTokens, `${foretelling} ${outcome||''}`), _ts: resolved_at||0 }
// open item: { id, kind:'open', verdict:null, foretelling: content, outcome:null,
//   fact: openFact(content), _weight:0, _ov: overlap(queryTokens, content), _ts: created_at||0 }
// resolvedItems.sort((a,b) => (b._weight-a._weight) || (b._ov-a._ov) || (b._ts-a._ts));
// openItems.sort((a,b) => (b._ov-a._ov) || (b._ts-a._ts));
// return filterProphecySurfaced([...resolved, ...open], surfaced, now, ttlDays)
//   .slice(0,3).map(strip _weight/_ov/_ts);

function filterProphecySurfaced(items, surfaced, now, ttlDays) {
  if (!surfaced || now == null) return items;
  const ttl = (ttlDays || PROPHECY_SURFACE_TTL_DAYS) * DAY;   // DAY = 86400*1000 (ms) on web
  return items.filter(it => {
    const last = surfaced[it.id];
    return !(last && (now - last) < ttl);
  });
}
```

`server.js` interpret integration (the block + the after-response dedup write-back):

```js
let prophecySurfaced = {};
try { prophecySurfaced = JSON.parse(memory.getMeta(`prophecy_surfaced:${slug}`) || '{}'); } catch {}
const prophecy = findProphecyCallbacks({
  resolved: memory.getResolvedPredictions(slug, 12),
  open:     memory.getOpenPredictions(slug, 12),
  currentCards: cards, question, surfaced: prophecySurfaced, now: Date.now(),
});
if (prophecy.length) {
  prophecyShownIds = prophecy.map(p => p.id).filter(id => id != null);
  prophecyBlock = `\n\nForetellings you have made for this person and how they have stood (reference one only when a card or theme in front of you genuinely connects to it; name the specific foretelling and how it turned out; speak with quiet, earned confidence when one came to pass, and with honesty when one did not; never recite these as a list, and never inflate your record):\n${prophecy.map(p => `- ${p.fact}`).join('\n')}`;
}
// ... personaFinal = personaWithName + memoryBlock + patternBlock + prophecyBlock + seasonThemeBlock + overclaimGuard
// ... after res.json(interpretation): prune surfaced entries older than TTL, stamp shownIds = now, setMeta.
```

`memory-store.js` `getOpenPredictions`:

```js
const stmtOpenPredictions = db.prepare(`
  SELECT id, content, created_at, salience
  FROM memories
  WHERE reader_slug = ? AND type = 'prediction' AND status = 'open'
  ORDER BY created_at DESC
  LIMIT ?
`);
```

## Architecture / Components

### 1. MemoryModel.kt (PURE — no android.* imports, JVM-unit-testable)

- `data class ProphecyItem(val id: Long, val kind: String, val verdict: String?, val foretelling: String, val outcome: String?, val fact: String)`
- `data class ProphecyResult(val block: String, val shownIds: List<Long>)`
- Constants: `VERDICT_WEIGHT` (map came_to_pass=3, partly=2, did_not=1), `VERDICT_KIND`
  (came_to_pass="fulfilled", partly="partial", did_not="missed"),
  `PROPHECY_SURFACE_TTL_DAYS = 21`.
- `resolvedFact(kind, foretelling, outcome)` / `openFact(foretelling)` — verbatim strings above.
- **Adaptation — overlap:** reuse the existing `tokenize` (byte-identical to the web
  prophecy tokenizer — same STOPWORDS, length>2, regex). Add a faithful private
  `prophecyOverlap(queryTokens: Set<String>, text: String): Int` that counts DISTINCT
  query-token hits in `tokenize(text)`, UNCAPPED. (Do NOT reuse `keywordOverlap`, which
  returns the capped/normalized `min(1.0, hits/3.0)` for the recall scorer.)
- `findProphecyCallbacks(resolved: List<ResolvedPrediction>, open: List<MemoryRow>, cardNames: List<String>, question: String?, surfaced: Map<String, Long>, now: Long, ttlDays: Int = PROPHECY_SURFACE_TTL_DAYS): List<ProphecyItem>`
  - `queryTokens = tokenize(question + " " + cardNames.joinToString(" ")).toSet()`
  - Map resolved -> items (id=predictionId, kind=VERDICT_KIND[verdict] ?: "fulfilled",
    weight=VERDICT_WEIGHT[verdict] ?: 1, ov=prophecyOverlap(queryTokens, "$foretelling ${outcome ?: ""}"),
    ts=resolvedAt). Map open -> items (kind="open", weight=0, ov=prophecyOverlap(queryTokens, content), ts=createdAt).
  - Sort resolved by weight desc, then ov desc, then ts desc; sort open by ov desc, then ts desc.
  - Concatenate [resolved, open], apply `filterProphecySurfaced`, take(3), return stripped `ProphecyItem`s.
- `filterProphecySurfaced(items: List<ProphecyItem>, surfaced: Map<String, Long>, now: Long, ttlDays: Int): List<ProphecyItem>`
  - `ttl = ttlDays * 86400` SECONDS (see Adaptation below). Drop any item whose
    `surfaced[id.toString()]` exists and `(now - last) < ttl`. Surfaced map is keyed by
    the prediction id as a STRING (JSON object keys are strings; mirrors the
    `season_surfaced` map in EmotionalSeasons).
- `buildProphecyBlock(items: List<ProphecyItem>): String` — returns `""` when empty;
  otherwise `"\n\n" + header + "\n" + items.joinToString("\n") { "- ${it.fact}" }` using
  the exact header string from the web source above.

### 2. MemoryStore.kt

- `getOpenPredictions(slug: String, limit: Int = 12): List<MemoryRow>` — rawQuery
  `SELECT * FROM memories WHERE reader_slug = ? AND type = 'prediction' AND status = 'open' ORDER BY created_at DESC LIMIT ?`,
  `Cursor.use {}` + the existing `rowFrom`. (Returns `MemoryRow`; `findProphecyCallbacks`
  reads `id`, `content`, `createdAt`.)

### 3. ProphecyWeaving.kt (NEW — mirrors EmotionalSeasons.kt structure)

- `class ProphecyWeaving(private val store: MemoryStore)` — shares MemoryEngine's single
  `MemoryStore`.
- `prophecyTtlS = 21L * 86400`.
- `pending(slug: String, cardNames: List<String>, question: String?, now: Long): ProphecyResult`
  — best-effort `try { val surfaced = readSurfaced(slug); val items = findProphecyCallbacks(store.getResolvedPredictions(slug, 12), store.getOpenPredictions(slug, 12), cardNames, question, surfaced, now); ProphecyResult(buildProphecyBlock(items), items.map { it.id }) } catch (e) { Log.w + ProphecyResult("", emptyList()) }`.
- `markSurfaced(slug: String, shownIds: List<Long>, now: Long)` — prune entries with
  `(now - value) >= prophecyTtlS`, stamp each `id.toString() -> now`, write
  `prophecy_surfaced:<slug>` meta. (Same readSurfaced/writeSurfaced JSON-object pattern
  as EmotionalSeasons.)
- private `readSurfaced(slug): Map<String, Long>` / `writeSurfaced(slug, map)` — JSON
  object in `prophecy_surfaced:<slug>`; tolerant parse -> empty map on any error.

### 4. MemoryEngine.kt

- `private val prophecy = ProphecyWeaving(store)`
- `fun prophecyBlock(slug, cardNames, question, now): ProphecyResult = prophecy.pending(slug, cardNames, question, now)`
- `fun markProphecySurfaced(slug, ids, now) = prophecy.markSurfaced(slug, ids, now)`

### 5. TarotServer.kt — `handleInterpret`

- Extract card names: `val cardNames = (0 until cards.length()).mapNotNull { cards.optJSONObject(it)?.optString("name")?.ifEmpty { null } }`.
- `val pNow = System.currentTimeMillis() / 1000`
- `val prophecy = memory.prophecyBlock(slug, cardNames, question, pNow)`
- Append `prophecy.block` to the system prompt AFTER `buildPatternBlock(slug, cards)`
  (the web order is patternBlock then prophecyBlock).
- After the interpretation text is obtained successfully (the LLM call returned), call
  `if (prophecy.shownIds.isNotEmpty()) memory.markProphecySurfaced(slug, prophecy.shownIds, pNow)`.
  Best-effort: a failure here must never break the already-produced reading.
- Version bump: `versionCode` 6 -> 7, `versionName` "1.6" -> "1.7".

## Adaptations (Android vs web)

1. **Reuse `tokenize`.** The web module duplicates the tokenizer only to avoid a
   `require` cycle; Android's existing `tokenize` is identical, so reuse it. Add a
   prophecy-specific UNCAPPED `prophecyOverlap` (the existing `keywordOverlap` is capped
   and would change ranking).
2. **Seconds, not milliseconds.** `prophecy-recall.js` uses `Date.now()` ms and
   `DAY = 86400*1000`. The Android memory layer is unix seconds. So `now` is
   `System.currentTimeMillis()/1000`, the TTL is `21*86400` seconds, and the
   `prophecy_surfaced` map stores seconds — exactly how Slice B handled `season_surfaced`.
   Behavior is identical; only the unit base differs, and it is internally consistent.

## Data flow

`handleInterpret` -> gather card names + question -> `memory.prophecyBlock` reads
`prophecy_surfaced` + resolved(12)/open(12) predictions -> `findProphecyCallbacks`
ranks + dedups + caps to 3 -> `buildProphecyBlock` -> appended to persona -> LLM
interprets -> on success, `markProphecySurfaced` stamps the shown ids.

## Error handling

- `pending` is best-effort: any DB/parse failure returns `ProphecyResult("", [])` and
  logs — the block degrades to empty and never throws into a reading (same contract as
  `recurringThemeBlock` and `buildPatternBlock`).
- `markSurfaced` is best-effort and runs only after the interpretation succeeded, so a
  foretelling is never marked surfaced when the reading itself failed (faithful to web,
  which stamps after `res.json`).

## Testing

- **JVM unit tests** (the core):
  - `findProphecyCallbacks`: resolved sort by verdict weight (came_to_pass > partly >
    did_not) then overlap then recency; open sorted by overlap then recency; resolved
    always precede open; cap at 3; `fact` strings correct per kind/outcome.
  - `filterProphecySurfaced`: an id within TTL is dropped; outside TTL is kept; empty
    surfaced / passthrough behavior.
  - `buildProphecyBlock`: empty list -> "", non-empty -> exact header + `- <fact>` lines.
  - `prophecyOverlap`: distinct-token counting, uncapped (3 hits -> 3, not 1).
- **Compile gate:** `assembleDebug` each task; `testDebugUnitTest` for Task 1.
- **On-device smoke (real data, device provisioned from web):** `matt` has 11 real
  OPEN predictions and 0 resolved. (1) Run an interpret whose question/cards overlap a
  real open prediction; confirm the prophecy block reaches the persona (the reading
  succeeds with the block present; ideally Miriel references the foretelling). (2) To
  exercise the verdict-weighted resolved arm, resolve one foretelling (via the threshold
  answer flow or a one-off seed of a resolved prediction + outcome event + 'resolves'
  link) and confirm it leads. (3) Repeat the reading and confirm `prophecy_surfaced`
  dedup suppresses the same foretelling within the TTL.

## Global constraints (carried from Slices A/B/C)

- **ASCII only** in all added/model-facing lines (the one allowed em dash is the
  pre-existing persona em-dash-ban sentence; out of scope here).
- **Local only** — never push tarot or TarotApp git history (API key in tarot history).
  TarotApp has no remote.
- **One SQLite connection** — `ProphecyWeaving` shares MemoryEngine's single `MemoryStore`.
- **Time is unix SECONDS** in the memory layer.
- **Mirror web exactly** — `prophecy-recall.js` + the `server.js` block/dedup are the
  source of truth; the canonical verdicts are `came_to_pass`/`did_not`/`partly`.

## Task split (subagent-driven)

- **Task 1:** MemoryModel pure port (`ProphecyItem`, `ProphecyResult`, constants,
  `resolvedFact`/`openFact`, `prophecyOverlap`, `findProphecyCallbacks`,
  `filterProphecySurfaced`, `buildProphecyBlock`) + JVM tests; `MemoryStore.getOpenPredictions`.
  Ends with `testDebugUnitTest` + `assembleDebug`.
- **Task 2:** `ProphecyWeaving.kt` + MemoryEngine delegators. Ends with `assembleDebug`.
- **Task 3:** TarotServer `handleInterpret` wiring (prophecy block into prompt +
  `markProphecySurfaced` after success) + version bump. Ends with `assembleDebug`.

## Out of scope

- The web `overclaimGuard` paragraph (Android's interpret does not currently include it;
  a separate concern, not required for prophecy weaving).
- Temporal callbacks and the profile-notebook persona — separate deferrals.
