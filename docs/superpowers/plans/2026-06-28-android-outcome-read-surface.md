# Android Outcome-Loop Read Surface (Slice C) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the `/api/foretellings/<slug>` stub on Android with the real query so the notebook's "Foretellings" section shows Miriel's resolved predictions.

**Architecture:** Faithful port of the web read path. A pure verdict-tag parser + a `ResolvedPrediction` data class go in `MemoryModel.kt` (JVM-unit-testable); a single new SQL join goes in `MemoryStore.kt`; a thin delegator in `MemoryEngine.kt`; a real handler replaces the stub route in `TarotServer.kt`. No schema change, no migration, no frontend change (the bundled `app.js` already renders foretellings).

**Tech Stack:** Kotlin, Android SQLite (`SQLiteOpenHelper`, `rawQuery`), NanoHTTPD, `org.json`, JUnit4. Build via Android Studio's bundled JBR from CLI.

## Global Constraints

- **ASCII only** in every added or model-facing line. No em dashes, no smart/curly quotes. (Pre-existing non-ASCII in `TarotServer.kt` is out of scope; only added lines must be ASCII.)
- **Local only** — never push tarot or TarotApp git history (the API key is in tarot history). TarotApp has no remote. All commits stay local.
- **One SQLite connection** — the new query uses the shared `MemoryStore` instance already held by `MemoryEngine`.
- **Time is unix SECONDS** in the memory layer.
- **Mirror web exactly** — `data/memory-store.js` `getResolvedPredictions` and `server.js` `GET /api/foretellings/:slug` are the source of truth.
- **Build/test commands (Windows PowerShell):**
  - Set JDK once per shell: `$env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"`
  - Unit tests: `& "C:\Users\Matt\projects\TarotApp\gradlew.bat" -p "C:\Users\Matt\projects\TarotApp" testDebugUnitTest`
  - Compile gate: `& "C:\Users\Matt\projects\TarotApp\gradlew.bat" -p "C:\Users\Matt\projects\TarotApp" assembleDebug`
  - Use `gradlew.bat` only (no unix `gradlew`).

---

## File Structure

- `app/src/main/java/com/matt/tarot/MemoryModel.kt` (MODIFY) — PURE: add `ResolvedPrediction` data class + `parseVerdictTag`. No `android.*` imports.
- `app/src/test/java/com/matt/tarot/MemoryModelTest.kt` (MODIFY) — add `parseVerdictTag` unit tests.
- `app/src/main/java/com/matt/tarot/MemoryStore.kt` (MODIFY) — add `getResolvedPredictions`.
- `app/src/main/java/com/matt/tarot/MemoryEngine.kt` (MODIFY) — add `resolvedPredictions` delegator.
- `app/src/main/java/com/matt/tarot/TarotServer.kt` (MODIFY) — replace the foretellings stub route with `handleForetellings`.
- `app/build.gradle` (MODIFY) — version bump.

---

## Task 1: ResolvedPrediction model, verdict parser, and store query

**Files:**
- Modify: `app/src/main/java/com/matt/tarot/MemoryModel.kt`
- Test: `app/src/test/java/com/matt/tarot/MemoryModelTest.kt`
- Modify: `app/src/main/java/com/matt/tarot/MemoryStore.kt`
- Modify: `app/src/main/java/com/matt/tarot/MemoryEngine.kt`

**Interfaces:**
- Produces (consumed by Task 2):
  - `data class ResolvedPrediction(val predictionId: Long, val foretelling: String, val outcome: String, val verdict: String?, val resolvedAt: Long)`
  - `fun parseVerdictTag(subject: String?): String?`  (in MemoryModel.kt)
  - `MemoryStore.getResolvedPredictions(slug: String, limit: Int = 20): List<ResolvedPrediction>`
  - `MemoryEngine.resolvedPredictions(slug: String, limit: Int = 20): List<ResolvedPrediction>`

- [ ] **Step 1: Write the failing tests for `parseVerdictTag`**

Add to the end of `app/src/test/java/com/matt/tarot/MemoryModelTest.kt`, just before the closing brace of `class MemoryModelTest`:

```kotlin
    @Test fun parseVerdictTag_strips_prefix() {
        assertEquals("came_true", parseVerdictTag("verdict:came_true"))
    }

    @Test fun parseVerdictTag_empty_after_prefix_is_empty_string() {
        assertEquals("", parseVerdictTag("verdict:"))
    }

    @Test fun parseVerdictTag_no_prefix_is_null() {
        assertEquals(null, parseVerdictTag("resolves"))
    }

    @Test fun parseVerdictTag_null_is_null() {
        assertEquals(null, parseVerdictTag(null))
    }
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `& "C:\Users\Matt\projects\TarotApp\gradlew.bat" -p "C:\Users\Matt\projects\TarotApp" testDebugUnitTest`
Expected: FAIL — compile error / unresolved reference `parseVerdictTag`.

- [ ] **Step 3: Implement `ResolvedPrediction` + `parseVerdictTag` in MemoryModel.kt**

Append to `app/src/main/java/com/matt/tarot/MemoryModel.kt` (end of file, top-level — no `android.*` imports needed):

```kotlin
// ── Outcome-loop read surface (Slice C) ──────────────────────────────────────
// PURE port of data/memory-store.js getResolvedPredictions row shape.
data class ResolvedPrediction(
    val predictionId: Long,
    val foretelling: String,
    val outcome: String,
    val verdict: String?,
    val resolvedAt: Long
)

// The outcome event's subject is "verdict:<tag>" when a prediction resolved with a
// verdict; return the tag after the prefix, else null. Faithful to the web
// startsWith('verdict:') / slice('verdict:'.length) logic (empty tag stays "").
private const val VERDICT_PREFIX = "verdict:"
fun parseVerdictTag(subject: String?): String? =
    if (subject != null && subject.startsWith(VERDICT_PREFIX)) subject.substring(VERDICT_PREFIX.length)
    else null
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `& "C:\Users\Matt\projects\TarotApp\gradlew.bat" -p "C:\Users\Matt\projects\TarotApp" testDebugUnitTest`
Expected: PASS — all `parseVerdictTag_*` tests green, plus the pre-existing suite (38+ tests) still green.

- [ ] **Step 5: Add `getResolvedPredictions` to MemoryStore.kt**

Insert after the `listMemories` function (currently around lines 187-193) in `app/src/main/java/com/matt/tarot/MemoryStore.kt`:

```kotlin
    // Resolved predictions joined to their outcome event via the 'resolves' link.
    // Faithful port of data/memory-store.js stmtResolvedPredictions + mapping.
    fun getResolvedPredictions(slug: String, limit: Int = 20): List<ResolvedPrediction> {
        val out = ArrayList<ResolvedPrediction>()
        readableDatabase.rawQuery(
            """
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
            """.trimIndent(),
            arrayOf(slug, limit.toString())
        ).use { c ->
            while (c.moveToNext()) {
                out.add(
                    ResolvedPrediction(
                        predictionId = c.getLong(c.getColumnIndexOrThrow("prediction_id")),
                        foretelling = c.getString(c.getColumnIndexOrThrow("foretelling")),
                        outcome = c.getString(c.getColumnIndexOrThrow("outcome")),
                        verdict = parseVerdictTag(c.strOrNull("verdict_tag")),
                        resolvedAt = c.getLong(c.getColumnIndexOrThrow("resolved_at"))
                    )
                )
            }
        }
        return out
    }
```

Note: `strOrNull` is the existing private `Cursor` extension in this file (lines 53-55).

- [ ] **Step 6: Add the `resolvedPredictions` delegator to MemoryEngine.kt**

In `app/src/main/java/com/matt/tarot/MemoryEngine.kt`, add this method alongside the other delegators (e.g. after `recurringThemeBlock`, before the closing brace of the class):

```kotlin
    fun resolvedPredictions(slug: String, limit: Int = 20): List<ResolvedPrediction> =
        store.getResolvedPredictions(slug, limit)
```

- [ ] **Step 7: Compile gate**

Run: `& "C:\Users\Matt\projects\TarotApp\gradlew.bat" -p "C:\Users\Matt\projects\TarotApp" assembleDebug`
Expected: BUILD SUCCESSFUL.

- [ ] **Step 8: Verify added lines are ASCII-clean**

Run (Git Bash): `LC_ALL=C grep -nP '[^\x00-\x7F]' app/src/main/java/com/matt/tarot/MemoryModel.kt app/src/main/java/com/matt/tarot/MemoryStore.kt app/src/main/java/com/matt/tarot/MemoryEngine.kt`
Expected: no matches among the lines you added (MemoryModel.kt has no pre-existing non-ASCII; MemoryStore.kt / MemoryEngine.kt may have pre-existing box-drawing comment dividers — confirm any hit is NOT a line you added).

- [ ] **Step 9: Commit**

```bash
git add app/src/main/java/com/matt/tarot/MemoryModel.kt \
        app/src/test/java/com/matt/tarot/MemoryModelTest.kt \
        app/src/main/java/com/matt/tarot/MemoryStore.kt \
        app/src/main/java/com/matt/tarot/MemoryEngine.kt
git commit -m "feat(android): getResolvedPredictions read query + verdict parser (Slice C task 1)"
```

---

## Task 2: Real `/api/foretellings/<slug>` endpoint + version bump

**Files:**
- Modify: `app/src/main/java/com/matt/tarot/TarotServer.kt` (route near lines 210-211; add `handleForetellings`)
- Modify: `app/build.gradle:14-15` (version bump)

**Interfaces:**
- Consumes (from Task 1): `MemoryEngine.resolvedPredictions(slug, limit): List<ResolvedPrediction>`, `ResolvedPrediction(predictionId, foretelling, outcome, verdict, resolvedAt)`.

- [ ] **Step 1: Replace the stub route**

In `app/src/main/java/com/matt/tarot/TarotServer.kt`, find the current stub route (around lines 210-211):

```kotlin
            uri.startsWith("/api/foretellings/") && method == Method.GET ->
                jsonResponse(JSONObject().put("foretellings", JSONArray()))
```

Replace it with:

```kotlin
            uri.startsWith("/api/foretellings/") && method == Method.GET ->
                handleForetellings(uri.removePrefix("/api/foretellings/"))
```

- [ ] **Step 2: Add the `handleForetellings` function**

Add this private method to `TarotServer` near the other handlers (e.g. just after `handleThreshold`/`handleThresholdAnswer`). It mirrors the web endpoint: best-effort, degrades to an empty list on any throw, and returns web's exact JSON keys.

```kotlin
    private fun handleForetellings(slug: String): Response {
        val list = try {
            memory.resolvedPredictions(slug, 20)
        } catch (e: Exception) {
            Log.w(TAG, "foretellings failed: ${e.message}")
            emptyList()
        }
        val arr = JSONArray()
        for (f in list) {
            arr.put(
                JSONObject()
                    .put("prediction_id", f.predictionId)
                    .put("foretelling", f.foretelling)
                    .put("outcome", f.outcome)
                    .put("verdict", f.verdict ?: JSONObject.NULL)
                    .put("resolved_at", f.resolvedAt)
            )
        }
        return jsonResponse(JSONObject().put("foretellings", arr))
    }
```

Notes for the implementer:
- `TAG`, `jsonResponse(JSONObject)`, `memory` (the `MemoryEngine`), `Response`, `Method`, `JSONArray`, and `JSONObject` are all already in scope in this file (used by neighbouring handlers like `handleThreshold` at ~line 650).
- The route extracts the slug with `removePrefix` exactly like the adjacent `/api/profiles/` route (`handleProfileStub(uri.removePrefix("/api/profiles/"))`). Slugs are simple lowercase identifiers; no decoding needed (parity with the profiles route).

- [ ] **Step 3: Bump the version**

In `app/build.gradle`, change lines 14-15:

```groovy
        versionCode 6
        versionName "1.6"
```

(from `versionCode 5` / `versionName "1.5"`.)

- [ ] **Step 4: Compile gate**

Run: `& "C:\Users\Matt\projects\TarotApp\gradlew.bat" -p "C:\Users\Matt\projects\TarotApp" assembleDebug`
Expected: BUILD SUCCESSFUL.

- [ ] **Step 5: Verify added lines are ASCII-clean**

Run (Git Bash): `LC_ALL=C grep -nP '[^\x00-\x7F]' app/src/main/java/com/matt/tarot/TarotServer.kt`
Expected: any hits are PRE-EXISTING (persona em dash, box-drawing comment dividers) and NOT among the lines you added (`handleForetellings`, the replaced route, `foretellings failed` log).

- [ ] **Step 6: Commit**

```bash
git add app/src/main/java/com/matt/tarot/TarotServer.kt app/build.gradle
git commit -m "feat(android): real /api/foretellings endpoint + bump to 1.6 (Slice C task 2)"
```

---

## Self-Review (completed)

**1. Spec coverage:**
- `ResolvedPrediction` + `parseVerdictTag` → Task 1, Steps 1-4. ✓
- `MemoryStore.getResolvedPredictions` (verbatim SQL) → Task 1, Step 5. ✓
- `MemoryEngine.resolvedPredictions` delegator → Task 1, Step 6. ✓
- `handleForetellings` replacing the stub, web JSON keys, best-effort empty fallback → Task 2, Steps 1-2. ✓
- Version bump 5→6 / 1.5→1.6 → Task 2, Step 3. ✓
- No frontend change (renderForetellings already bundled) → correctly absent. ✓
- On-device smoke (resolved-prediction seed if absent) → human gate after merge, not a code task. ✓

**2. Placeholder scan:** No TBD/TODO/"handle edge cases"/vague steps; every code step shows complete code. ✓

**3. Type consistency:** `ResolvedPrediction` field names (`predictionId`, `foretelling`, `outcome`, `verdict`, `resolvedAt`) are identical in Task 1's data class, the store mapping, and Task 2's JSON build. `parseVerdictTag(String?): String?` and `resolvedPredictions(slug, limit)` signatures match between definition and use. ✓
