# Android Outcome-Loop Read Surface (Slice C) — Design

**Date:** 2026-06-28
**Target:** TarotApp (Android, Kotlin)
**Status:** Approved

## Goal

Replace the `/api/foretellings/<slug>` stub with the real query so the notebook
overlay's "Foretellings" section shows Miriel's resolved predictions on Android.
Faithful port of the web read path (`memory-store.js` `getResolvedPredictions` +
`server.js` `GET /api/foretellings/:slug`). Mirror web exactly.

## Background / Why this is small

This is the third memory-parity slice for Android. Slice A (Threshold greeting)
already built the prediction RESOLVE write path on Android: resolving a prediction
sets its `status='resolved'`, writes an outcome `event` whose `subject='verdict:<v>'`,
and links the event to the prediction with a `memory_links` row `relation='resolves'`.
That is precisely the shape the read query joins over, so **no schema change and no
migration are required** — only the read query and the endpoint are missing.

The frontend is also already in place: the bundled `app.js` contains
`renderForetellings(inner, foretellings)` (notebook overlay), which reads
`f.outcome`, `f.foretelling`, and `f.verdict` (mapped through `VERDICT_LABELS`:
`came_true` → "came true", `did_not` → "didn't come", `partly` → "came in part").
So **no frontend work** is needed; the endpoint just needs to return real data.

Scope decision (user-approved): **read surface only.** Prophecy weaving
(`prophecy-recall.js` `findProphecyCallbacks`, `getOpenPredictions`, the
`prophecyBlock` injected into the interpret persona, and `prophecy_surfaced`
dedup) is a separate deferred feature (its own web spec
`2026-06-21-prophecy-weaving-design.md`) and will be a later slice (D). It is
explicitly OUT OF SCOPE here.

## Web reference (source of truth)

`data/memory-store.js`:

```js
const stmtResolvedPredictions = db.prepare(`
  SELECT p.id AS prediction_id,
         p.content AS foretelling,
         p.updated_at AS resolved_at,
         e.content AS outcome,
         e.subject AS verdict_tag
  FROM memories p
  JOIN memory_links l ON l.to_id = p.id AND l.relation = 'resolves'
  JOIN memories e ON e.id = l.from_id
  WHERE p.reader_slug = ? AND p.type = 'prediction' AND p.status = 'resolved'
  ORDER BY p.updated_at DESC
  LIMIT ?
`);

function getResolvedPredictions(slug, limit = 20) {
  return stmtResolvedPredictions.all(slug, limit).map(r => ({
    prediction_id: r.prediction_id,
    foretelling:   r.foretelling,
    outcome:       r.outcome,
    verdict:       typeof r.verdict_tag === 'string' && r.verdict_tag.startsWith('verdict:')
                     ? r.verdict_tag.slice('verdict:'.length)
                     : null,
    resolved_at:   r.resolved_at,
  }));
}
```

`server.js`:

```js
app.get('/api/foretellings/:slug', (req, res) => {
  try {
    const foretellings = memory.getResolvedPredictions(req.params.slug, 20);
    res.json({ foretellings });
  } catch (err) {
    res.json({ foretellings: [] });
  }
});
```

## Architecture / Components

### 1. MemoryModel.kt (PURE — no android.* imports, JVM-unit-testable)

- `data class ResolvedPrediction(val predictionId: Long, val foretelling: String, val outcome: String, val verdict: String?, val resolvedAt: Long)`
- `fun parseVerdictTag(subject: String?): String?` — returns the substring after
  the literal prefix `"verdict:"` when `subject` starts with it; otherwise `null`.
  (Faithful to the web `.startsWith('verdict:')` / `.slice(...)` logic.)

### 2. MemoryStore.kt

- `fun getResolvedPredictions(slug: String, limit: Int = 20): List<ResolvedPrediction>`
  - rawQuery with the verbatim SQL above (parameters `slug`, `limit`),
    `Cursor.use {}` like the existing queries.
  - Map each row → `ResolvedPrediction(predictionId = prediction_id,
    foretelling = content, outcome = e.content, verdict = parseVerdictTag(e.subject),
    resolvedAt = updated_at)`.
  - Column types: ids/`updated_at` are INTEGER (Long); content/subject are TEXT.

### 3. MemoryEngine.kt

- Thin delegator: `fun resolvedPredictions(slug: String, limit: Int = 20): List<ResolvedPrediction> = store.getResolvedPredictions(slug, limit)`
  (keeps TarotServer talking to MemoryEngine, not MemoryStore directly — consistent
  with the other delegators).

### 4. TarotServer.kt

- Replace the stub route (currently
  `uri.startsWith("/api/foretellings/") && method == GET -> jsonResponse(... foretellings: [] )`)
  with a call to a new `handleForetellings(slug)`.
- `handleForetellings(slug: String): Response`:
  - `val list = try { memory.resolvedPredictions(slug, 20) } catch (e: Exception) { Log.w(TAG, "foretellings failed: ${e.message}"); emptyList() }`
  - Build a `JSONArray` of objects with web's exact keys:
    `prediction_id`, `foretelling`, `outcome`, `verdict` (JSONObject.NULL when null),
    `resolved_at`.
  - Return `jsonResponse(JSONObject().put("foretellings", arr))`.
- Version bump: `versionCode` 5 → 6, `versionName` "1.5" → "1.6".

## Data flow

Notebook overlay opens → frontend fetches `GET /api/foretellings/<slug>` →
`handleForetellings` → `memory.resolvedPredictions` → `store.getResolvedPredictions`
(SQL join over resolved predictions + their `resolves`-linked outcome events) →
JSON `{foretellings:[...]}` → `renderForetellings` paints the section.

## Error handling

- The endpoint never throws into the response: any failure degrades to
  `{"foretellings":[]}` (web parity). A cold/empty db naturally yields `[]`.
- The store query is the only new SQL. No writes, so no concurrency concern beyond
  the existing single-connection serialization.

## Testing

- **JVM unit tests** (`MemoryModelTest` or equivalent) for `parseVerdictTag`:
  - `"verdict:came_true"` → `"came_true"`
  - `"verdict:"` → `""` (empty string after prefix — faithful to web `.slice`)
  - `"resolves"` (no prefix) → `null`
  - `null` → `null`
- **Compile gate:** `assembleDebug` for every task; `testDebugUnitTest` for Task 1.
- **On-device smoke:** verify the Foretellings section renders. The device may not
  have a resolved *prediction* yet (Slice A's smoke resolved a *thread*); if none
  exists, seed a resolved prediction + linked outcome event with
  `subject='verdict:came_true'` (same adb push + run-as dd technique as Slice B) and
  confirm `GET /api/foretellings/matt` returns it and the notebook renders the row.

## Global constraints (carried from Slices A/B)

- **ASCII only** in all added/model-facing lines (the one allowed em dash is the
  pre-existing persona em-dash-ban sentence; out of scope here).
- **Local only** — never push tarot or TarotApp git history (API key is in tarot
  history). TarotApp has no remote.
- **One SQLite connection** — new query uses the shared MemoryStore instance.
- **Time is unix seconds** in the memory layer.

## Task split (subagent-driven)

- **Task 1:** MemoryModel `ResolvedPrediction` + `parseVerdictTag` + JVM tests;
  MemoryStore `getResolvedPredictions`; MemoryEngine `resolvedPredictions` delegator.
  Ends with `testDebugUnitTest` + `assembleDebug`.
- **Task 2:** TarotServer `handleForetellings` (replace stub) + version bump.
  Ends with `assembleDebug`.

## Out of scope

- Prophecy weaving (interpret-time `prophecyBlock`, `getOpenPredictions`,
  `findProphecyCallbacks`, `prophecy_surfaced` dedup) — deferred to Slice D.
- Profile notebook persona (`/api/profiles/*` remains stubbed) — separate deferral;
  the Foretellings section renders independently of the profile half of the overlay.
- Temporal callbacks — separate deferral.
