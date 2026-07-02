# Android Notebook Display Surface (Slice G2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Android profile stub with the real notebook payload (profile + tier + recurring-card image URLs) and add the manual-refresh endpoint -- a faithful port of `data/notebook.js` + the two `server.js` `/api/profiles/*` routes. Closes the memory-engine parity program.

**Architecture:** Two private `TarotServer.kt` helpers (`resolveCardImage`, `buildNotebookPayload`) plus a real `handleProfiles` GET (replacing the stub) and a new `handleProfileRefresh` POST that synchronously calls G1's `readerProfile.refreshReaderProfile`. No new class, no frontend change.

**Tech Stack:** Kotlin, NanoHTTPD, `org.json`, `java.io.File`. Build via Android Studio's bundled JBR from CLI.

## Global Constraints

- **ASCII only** in every added/model-facing line. Verify: `LANG=C.UTF-8 grep -nP '[^\x00-\x7F]' <file>` (plain `LC_ALL=C` errors on `-P` here). TarotServer.kt has PRE-EXISTING non-ASCII (persona em dash, box-drawing, ellipsis) OUT OF SCOPE -- only ADDED lines must be ASCII.
- **Local only** -- never push. TarotApp has no remote. All commits local.
- **Time is unix SECONDS** (no timestamps added in this slice anyway).
- **ReaderProfile stays flat-JSON** (G1) -- G2 only READS via `loadReaderProfile` + calls `refreshReaderProfile`; no SQLite.
- **Faithful port** -- `data/notebook.js` (resolveCardImage, buildNotebookPayload) + `server.js` GET/POST `/api/profiles/*` are the source of truth.
- **Build (Windows):** `JAVA_HOME="C:/Program Files/Android/Android Studio/jbr" "C:/Users/Matt/projects/TarotApp/gradlew.bat" -p "C:/Users/Matt/projects/TarotApp" assembleDebug` (gradlew.bat only; up to 600000 ms). No new JVM tests (file-IO/endpoint glue; getTier tested in G1).

## Existing pieces this plan consumes (already on master)

- TarotServer: `dataDir: File`, `imagesDir: File`, `readingsDir = File(dataDir,"readings")`, `loadReaders(): JSONArray`, `readerProfile` (G1 `ReaderProfile`) with `loadReaderProfile(slug): JSONObject?` and `refreshReaderProfile(slug, callLLM)`, `memoryCallLLM` (matches CallLLM), `jsonResponse(JSONObject)`, `errorResponse(code, msg)`, `TAG`, `context` (for the assets fallback, as in handleGetCards).
- MemoryModel top-level `fun getTier(readingCount: Int): Int` (G1).
- Card art served at `/images/tarot/<file>` from `File(imagesDir, "tarot/<file>")`; `tarot.json` at `File(dataDir,"tarot.json")` (assets fallback `tarot-server/data/tarot.json`).

---

## File Structure

- `app/src/main/java/com/matt/tarot/TarotServer.kt` (MODIFY) -- resolveCardImage, buildNotebookPayload, handleProfiles (replaces handleProfileStub), handleProfileRefresh, route add.
- `app/build.gradle` (MODIFY) -- version 10 -> 11 / "1.10" -> "1.11".

---

## Task 1: Notebook payload + real GET endpoint

**Files:**
- Modify: `app/src/main/java/com/matt/tarot/TarotServer.kt`

**Interfaces (produced, consumed by Task 2 route + the frontend):**
- `private fun resolveCardImage(cardName: String): String?`
- `private fun buildNotebookPayload(slug: String): JSONObject`
- `private fun handleProfiles(slug: String): Response` (replaces `handleProfileStub`)
- `private fun readerExists(slug: String): Boolean` (small helper for the 404 check, reused in Task 2)

- [ ] **Step 1: Add resolveCardImage, buildNotebookPayload, readerExists, and handleProfiles**

Replace the existing `handleProfileStub` method (currently):

```kotlin
    private fun handleProfileStub(slug: String): Response {
        val file = File(readingsDir, "$slug.json")
        val count = try { if (file.exists()) JSONArray(file.readText()).length() else 0 } catch (e: Exception) { 0 }
        return jsonResponse(JSONObject()
            .put("profile", JSONObject.NULL)
            .put("readingCount", count)
            .put("tier", 1))
    }
```

with the real implementation (faithful port of notebook.js + the web GET route):

```kotlin
    private fun readerExists(slug: String): Boolean {
        val readers = loadReaders()
        for (i in 0 until readers.length()) {
            if (readers.optJSONObject(i)?.optString("slug") == slug) return true
        }
        return false
    }

    // Faithful port of notebook.js resolveCardImage. Profile card_ids are LLM-invented and
    // do not reliably match real deck ids, so images resolve by NAME against tarot.json.
    // Unresolvable cards return null and the frontend renders a placeholder.
    private fun resolveCardImage(cardName: String): String? {
        return try {
            val text = try {
                val f = File(dataDir, "tarot.json")
                if (f.exists()) f.readText()
                else context.assets.open("tarot-server/data/tarot.json").bufferedReader().readText()
            } catch (e: Exception) { return null }
            val cards = JSONArray(text)
            val wanted = cardName.trim().lowercase()
            var matchId: String? = null
            for (i in 0 until cards.length()) {
                val c = cards.optJSONObject(i) ?: continue
                if (c.optString("name").lowercase() == wanted) { matchId = c.optString("id"); break }
            }
            if (matchId.isNullOrEmpty()) return null
            for (ext in listOf(".jpg", ".jpeg", ".png", ".webp", ".svg")) {
                val file = "$matchId$ext"
                if (File(imagesDir, "tarot/$file").exists()) {
                    return "/images/tarot/" + java.net.URLEncoder.encode(file, "UTF-8").replace("+", "%20")
                }
            }
            null
        } catch (e: Exception) { null }
    }

    // Faithful port of notebook.js buildNotebookPayload. Passes the whole profile through
    // (including living_note); only augments recurring_cards with a resolved imageUrl.
    private fun buildNotebookPayload(slug: String): JSONObject {
        val readingCount = try {
            val f = File(readingsDir, "$slug.json")
            if (f.exists()) JSONArray(f.readText()).length() else 0
        } catch (e: Exception) { 0 }
        val tier = getTier(readingCount)
        val profile = readerProfile.loadReaderProfile(slug)
        val outProfile: Any = if (profile != null) {
            val recurring = profile.optJSONArray("recurring_cards")
            if (recurring != null) {
                val mapped = JSONArray()
                for (i in 0 until recurring.length()) {
                    val rc = recurring.optJSONObject(i) ?: continue
                    val copy = JSONObject(rc.toString())
                    val url = resolveCardImage(rc.optString("card"))
                    copy.put("imageUrl", if (url != null) url else JSONObject.NULL)
                    mapped.put(copy)
                }
                // shallow copy of the profile with recurring_cards replaced
                val pcopy = JSONObject(profile.toString())
                pcopy.put("recurring_cards", mapped)
                pcopy
            } else profile
        } else JSONObject.NULL
        return JSONObject()
            .put("profile", outProfile)
            .put("readingCount", readingCount)
            .put("tier", tier)
    }

    private fun handleProfiles(slug: String): Response {
        if (!readerExists(slug)) return errorResponse(404, "Reader not found")
        return try {
            jsonResponse(buildNotebookPayload(slug))
        } catch (e: Exception) {
            Log.w(TAG, "profiles GET failed: ${e.message}")
            jsonResponse(JSONObject().put("profile", JSONObject.NULL).put("readingCount", 0).put("tier", 1))
        }
    }
```

- [ ] **Step 2: Point the GET route at handleProfiles**

Find:

```kotlin
            uri.startsWith("/api/profiles/") && method == Method.GET ->
                handleProfileStub(uri.removePrefix("/api/profiles/"))
```

Replace with:

```kotlin
            uri.startsWith("/api/profiles/") && method == Method.GET ->
                handleProfiles(uri.removePrefix("/api/profiles/"))
```

- [ ] **Step 3: Compile gate**

Run: `& "C:\Users\Matt\projects\TarotApp\gradlew.bat" -p "C:\Users\Matt\projects\TarotApp" assembleDebug`
Expected: BUILD SUCCESSFUL. (`errorResponse(404, ...)` already exists and maps to NOT_FOUND; `context` is the existing field used by handleGetCards' assets fallback -- confirm the exact name by reading handleGetCards, and use whatever that method uses.)

- [ ] **Step 4: Verify added lines are ASCII-clean**

Run (Git Bash): `LANG=C.UTF-8 grep -nP '[^\x00-\x7F]' app/src/main/java/com/matt/tarot/TarotServer.kt`
Expected: any hits are PRE-EXISTING (persona em dash, box-drawing, ellipsis), NOT among your added lines.

- [ ] **Step 5: Commit**

```bash
git add app/src/main/java/com/matt/tarot/TarotServer.kt
git commit -m "feat(android): real notebook payload + GET /api/profiles (Slice G2 task 1)"
```

---

## Task 2: POST refresh endpoint + version bump

**Files:**
- Modify: `app/src/main/java/com/matt/tarot/TarotServer.kt`
- Modify: `app/build.gradle`

**Interfaces:**
- Consumes (Task 1): `readerExists`. Consumes (G1): `readerProfile.refreshReaderProfile`, `readerProfile.loadReaderProfile`.

- [ ] **Step 1: Add the refresh route (before the GET profiles branch)**

In the route `when` block, immediately ABOVE the `uri.startsWith("/api/profiles/") && method == Method.GET ->` branch, add:

```kotlin
            uri.startsWith("/api/profiles/") && uri.endsWith("/refresh") && method == Method.POST ->
                handleProfileRefresh(uri.removePrefix("/api/profiles/").removeSuffix("/refresh"))
```

(Placing it above the GET branch is defensive; since this is POST and the other is GET they cannot collide, but keeping profiles routes together is clearer.)

- [ ] **Step 2: Add handleProfileRefresh**

Add this method next to `handleProfiles`:

```kotlin
    private fun handleProfileRefresh(slug: String): Response {
        if (!readerExists(slug)) return errorResponse(404, "Reader not found")
        return try {
            readerProfile.refreshReaderProfile(slug, ::memoryCallLLM)
            val synth = readerProfile.loadReaderProfile(slug)?.optInt("readings_synthesized", 0) ?: 0
            jsonResponse(JSONObject().put("ok", true).put("readings_synthesized", synth))
        } catch (e: Exception) {
            Log.w(TAG, "profile refresh failed: ${e.message}")
            errorResponse(500, e.message ?: "refresh failed")
        }
    }
```

- [ ] **Step 3: Bump the version**

In `app/build.gradle`:

```groovy
        versionCode 11
        versionName "1.11"
```

(from `versionCode 10` / `versionName "1.10"`.)

- [ ] **Step 4: Compile gate**

Run: `& "C:\Users\Matt\projects\TarotApp\gradlew.bat" -p "C:\Users\Matt\projects\TarotApp" assembleDebug`
Expected: BUILD SUCCESSFUL.

- [ ] **Step 5: Verify added lines are ASCII-clean**

Run (Git Bash): `LANG=C.UTF-8 grep -nP '[^\x00-\x7F]' app/src/main/java/com/matt/tarot/TarotServer.kt`
Expected: only pre-existing hits.

- [ ] **Step 6: Commit**

```bash
git add app/src/main/java/com/matt/tarot/TarotServer.kt app/build.gradle
git commit -m "feat(android): POST /api/profiles/:slug/refresh + bump to 1.11 (Slice G2 task 2)"
```

---

## Self-Review (completed)

**1. Spec coverage:**
- resolveCardImage (name-match against tarot.json, image ext scan, URL-encode, best-effort null) -> Task 1 Step 1. Ok.
- buildNotebookPayload (tier + profile passthrough + recurring_cards imageUrl augment) -> Task 1 Step 1. Ok.
- handleProfiles (404 unknown reader; real payload) replacing stub + GET route -> Task 1 Steps 1-2. Ok.
- handleProfileRefresh (404; synchronous refreshReaderProfile; {ok, readings_synthesized}; 500 on throw) + POST route -> Task 2 Steps 1-2. Ok.
- Version bump -> Task 2 Step 3. Ok.

**2. Placeholder scan:** No TBD/TODO; complete code in each step. The one flagged uncertainty (the exact name of the assets-context field) is called out in Task 1 Step 3 with the instruction to match handleGetCards' usage.

**3. Type consistency:** `resolveCardImage(cardName: String): String?`, `buildNotebookPayload(slug: String): JSONObject`, `readerExists(slug: String): Boolean`, `handleProfiles(slug)`, `handleProfileRefresh(slug)` all consistent between definition and call sites. `getTier(Int): Int` and `readerProfile.loadReaderProfile/refreshReaderProfile` match their G1 definitions. `jsonResponse(JSONObject)` / `errorResponse(Int, String)` match existing signatures. Ok.
