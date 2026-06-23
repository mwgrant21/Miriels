# Android Reading + Visual Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the Android app (`C:\Users\Matt\projects\TarotApp`) current with the web app's reading quality and visuals — refreshed frontend, Miriel persona + second-person addressing, Year Ahead chronological dating, and the three non-memory endpoints (compatibility, daily-card, patterns) — without porting the memory engine.

**Architecture:** Native Android (Kotlin). A WebView loads an embedded NanoHTTPD server (`TarotServer.kt`) on localhost:3000 that serves bundled assets and reimplements the API, calling Anthropic via OkHttp. Data is flat JSON files in `filesDir/data` (no SQLite). The frontend is served straight from `assets`, so refreshing asset files updates the app on rebuild.

**Tech Stack:** Kotlin, NanoHTTPD 2.3.1, OkHttp 4.12, org.json, Android minSdk 24 / compileSdk 34.

**IMPORTANT — environment & verification:** There is no Android SDK/emulator or Kotlin test runner in the execution environment. You CANNOT compile or run this here. Each task's verification is: (a) the Kotlin matches the cited web `server.js` behavior, and (b) it is syntactically valid Kotlin. The real verification is the user's Android Studio build + on-device smoke test (Task 11 checklist). Keep edits faithful and idiomatic.

**Key source files (read these as you go):**
- Web source of truth: `C:\Users\Matt\projects\tarot\server.js`, `C:\Users\Matt\projects\tarot\data\addressing.js`
- Android target: `C:\Users\Matt\projects\TarotApp\app\src\main\java\com\matt\tarot\TarotServer.kt`
- Assets: `C:\Users\Matt\projects\TarotApp\app\src\main\assets\tarot-server\`

**Commit convention:** TarotApp may or may not be a git repo. Before the first commit run `git -C "C:/Users/Matt/projects/TarotApp" rev-parse --is-inside-work-tree`; if it is NOT a repo, run `git -C "C:/Users/Matt/projects/TarotApp" init` first. Commit after each task inside the TarotApp repo.

---

## Task 1: Refresh bundled frontend assets

**Files:**
- Overwrite: `TarotApp/app/src/main/assets/tarot-server/public/index.html`
- Overwrite: `TarotApp/app/src/main/assets/tarot-server/public/app.js`
- Overwrite: `TarotApp/app/src/main/assets/tarot-server/public/style.css`

- [ ] **Step 1: Copy the three current web frontend files over the bundled ones**

Run (Git Bash):
```bash
SRC=/c/Users/Matt/projects/tarot/public
DST=/c/Users/Matt/projects/TarotApp/app/src/main/assets/tarot-server/public
cp "$SRC/index.html" "$DST/index.html"
cp "$SRC/app.js"     "$DST/app.js"
cp "$SRC/style.css"  "$DST/style.css"
ls -la "$DST"
```

- [ ] **Step 2: Verify the copy**

Run:
```bash
diff -q /c/Users/Matt/projects/tarot/public/app.js /c/Users/Matt/projects/TarotApp/app/src/main/assets/tarot-server/public/app.js && echo "app.js identical"
grep -c "renderLivingNote\|showThinkingTakeover" /c/Users/Matt/projects/TarotApp/app/src/main/assets/tarot-server/public/app.js
```
Expected: "app.js identical"; the grep count > 0 (confirms the new code is present).

- [ ] **Step 3: Commit**

```bash
git -C "C:/Users/Matt/projects/TarotApp" add app/src/main/assets/tarot-server/public
git -C "C:/Users/Matt/projects/TarotApp" commit -m "assets: refresh bundled frontend to current web app"
```

---

## Task 2: Refresh bundled deck JSONs

**Files:**
- Overwrite: `TarotApp/app/src/main/assets/tarot-server/data/{tarot,oracle,moonology,celtic-dragon,lenormand,thoth,runic,iching}.json`

- [ ] **Step 1: Copy the 8 current deck files**

Run:
```bash
SRC=/c/Users/Matt/projects/tarot/data
DST=/c/Users/Matt/projects/TarotApp/app/src/main/assets/tarot-server/data
for f in tarot oracle moonology celtic-dragon lenormand thoth runic iching; do
  cp "$SRC/$f.json" "$DST/$f.json"
done
ls -la "$DST"
```

- [ ] **Step 2: Verify all 8 decks are valid JSON arrays**

Run:
```bash
DST=/c/Users/Matt/projects/TarotApp/app/src/main/assets/tarot-server/data
for f in tarot oracle moonology celtic-dragon lenormand thoth runic iching; do
  node -e "const a=require('$DST/$f.json'); console.log('$f', Array.isArray(a)?a.length+' cards':'NOT ARRAY')"
done
```
Expected: each prints a card count.

- [ ] **Step 3: Commit**

```bash
git -C "C:/Users/Matt/projects/TarotApp" add app/src/main/assets/tarot-server/data
git -C "C:/Users/Matt/projects/TarotApp" commit -m "assets: refresh bundled deck JSON to current"
```

---

## Task 3: Miriel persona + addressing helpers in `TarotServer.kt`

**Files:**
- Modify: `TarotApp/app/src/main/java/com/matt/tarot/TarotServer.kt` (the `READER_PERSONA` constant in `companion object`, ~lines 38-46; add two helper methods)

- [ ] **Step 1: Replace `READER_PERSONA` with the current Miriel persona**

In `TarotServer.kt`, replace the entire `private val READER_PERSONA = """ ... """.trimIndent()` block in the `companion object` with this exact text (note the new first sentence names her):

```kotlin
        private val READER_PERSONA = """
Your name is Miriel. You are an experienced tarot reader with an intuitive, direct style — part psychologist, part poet. You don't perform mysticism or lean on spiritual jargon. You read what's actually in front of you: the energy of the cards, the weight of each position, what a reversal tells you about a person's inner world versus their outer situation.

You speak directly to the person across from you. You witness, you don't narrate. Not "The High Priestess represents hidden knowledge" — but "Something in you already knows the answer. This card is just pointing at it." You're not afraid of difficult cards. You know how to hold space for hard truths without making someone feel hopeless. And you're genuinely warm — curious about this person, not just about what the cards say.

You let the cards surprise you. You notice when cards talk to each other, when one card quietly undercuts another, when something appears that you didn't expect. You give more time to what feels most alive in the spread, not necessarily what the textbook says is most important. When something catches your attention and you can't fully explain why, you say so.

You never use bullet points, headers, bold text, or numbered lists. You speak — the way you actually would if this person were sitting across the table from you.
        """.trimIndent()
```

- [ ] **Step 2: Add addressing helpers as private methods on the class**

Add these two methods to `TarotServer` (e.g., just above `formatCard`). They port `data/addressing.js`. Both return a string starting with `\n\n` (or empty), so callers concatenate directly onto the persona:

```kotlin
    // Port of data/addressing.js — Miriel speaks to the active reader as "you".
    private fun buildAddressingNote(readerName: String?): String {
        if (readerName.isNullOrBlank()) return ""
        return "\n\nThe person sitting across from you is $readerName. They are right there — speak to them as \"you,\" always. Never describe them in the third person or repeat their name back to them as if reading from a file. You may use their name at most once in a reading, only where a real reader would: a quiet greeting, or a single moment that needs weight. Other people in their life — from their question, their prior readings, what you know of them — may be named, but only when the cards genuinely point toward them."
    }

    private fun buildCompatAddressingNote(readerName: String?, personAName: String?, personBName: String?): String {
        if (readerName.isNullOrBlank()) return ""
        val norm = { s: String? -> (s ?: "").trim().lowercase() }
        val isA = norm(readerName) == norm(personAName)
        val isB = norm(readerName) == norm(personBName)
        if (!isA && !isB) return buildAddressingNote(readerName)
        val self  = if (isA) personAName else personBName
        val other = if (isA) personBName else personAName
        return "\n\nOf these two people, $self is the one sitting across from you — address $self as \"you\" throughout, and speak about $other by name. Never describe $self in the third person. You may use $self's own name at most once, where a real reader would: a quiet greeting, or a single moment that needs weight."
    }
```

- [ ] **Step 3: Verify against the web source**

Confirm the persona text matches `tarot/server.js:503-509` and the two notes match `tarot/data/addressing.js:8-25` word for word (escaping aside).

- [ ] **Step 4: Commit**

```bash
git -C "C:/Users/Matt/projects/TarotApp" add app/src/main/java/com/matt/tarot/TarotServer.kt
git -C "C:/Users/Matt/projects/TarotApp" commit -m "feat: Miriel persona + addressing-note helpers"
```

---

## Task 4: Modernize `handleInterpret` (persona, addressing, Year Ahead)

**Files:**
- Modify: `TarotApp/app/src/main/java/com/matt/tarot/TarotServer.kt` (`handleInterpret`, ~lines 411-490)

- [ ] **Step 1: Add `year-ahead` to the spread label**

In `handleInterpret`, in the `spreadLabel` `when (spreadType) { ... }`, add this branch before the `else`:

```kotlin
            "year-ahead" -> "Year Ahead (one card per month)"
```

- [ ] **Step 2: Read `readerName` and build the system prompt with persona + addressing**

In `handleInterpret`, after the existing `val priorReadings = body.optJSONArray("priorReadings")` line, add:

```kotlin
        val readerName = body.optString("readerName")
        val systemPrompt = READER_PERSONA + buildAddressingNote(readerName)
```

- [ ] **Step 3: Reorder + date Year Ahead months, and build the card block from the reordered list**

Replace the existing line that builds `cardBlock`:

```kotlin
        val cardBlock     = (0 until cards.length()).joinToString("\n\n") { formatCard(cards.getJSONObject(it)) }
```

with this block (ports the `server.js` year-ahead reorder; uses `java.util.Calendar` because `java.time` is not available on minSdk 24 without desugaring):

```kotlin
        val isYearAhead = spreadType == "year-ahead"
        val cal = java.util.Calendar.getInstance()
        val curIdx  = cal.get(java.util.Calendar.MONTH)        // 0-11
        val curYear = cal.get(java.util.Calendar.YEAR)
        val months  = arrayOf("January","February","March","April","May","June",
                              "July","August","September","October","November","December")

        val promptCardList: List<JSONObject> = if (isYearAhead) {
            fun monthIdx(c: JSONObject): Int {
                val p = c.optString("position").trim().lowercase().take(3)
                return months.indexOfFirst { it.lowercase().take(3) == p }
            }
            val dated = (0 until cards.length())
                .map { cards.getJSONObject(it) }
                .filter { monthIdx(it) >= 0 }
                .sortedBy { ((monthIdx(it) - curIdx) + 12) % 12 }
                .mapIndexed { i, c ->
                    val mi = monthIdx(c)
                    val yr = if (mi >= curIdx) curYear else curYear + 1
                    // copy with a renumbered, dated position label
                    JSONObject(c.toString()).put("position", "${i + 1} of 12 — ${months[mi]} $yr")
                }
            val leftover = (0 until cards.length())
                .map { cards.getJSONObject(it) }
                .filter { monthIdx(it) < 0 }
            dated + leftover
        } else {
            (0 until cards.length()).map { cards.getJSONObject(it) }
        }

        val cardBlock = promptCardList.joinToString("\n\n") { formatCard(it) }
```

- [ ] **Step 4: Add the year-ahead movement instruction and use it in the multi-card prompt**

Immediately before the `val prompt = if (isSingle)` line, add:

```kotlin
        val movementInstruction = if (isYearAhead)
            "First part — moving through the year in time: This is a Year Ahead spread; each card is a month. The months below are ALREADY listed in chronological order, numbered \"1 of 12\" (${months[curIdx]}, the month of the question) through \"12 of 12\". Read them strictly in that order — start at 1 of 12 (${months[curIdx]}) and move forward one month at a time to 12 of 12. Do NOT begin at January and do NOT reorder by intensity; the forward movement through time from the present moment is the whole point. Name each month as you reach it. You may give more breath to the months doing the most work, and let one month flow into the next when they're in conversation, but never break the numbered order."
        else
            "First part — moving through the cards: Go in whatever order the energy pulls you, not necessarily the layout order. Name each card as you come to it so they can follow you, but don't be mechanical — let one card lead into the next when they're in conversation. Give more space to the cards doing the most work; not every card needs equal time. If two cards are pulling in opposite directions, sit in that tension rather than resolving it too quickly. If a card surprises you or sits in an unexpected way for its position, say so. This section should feel like thinking out loud as the picture builds."
```

Then, in the multi-card branch of the `prompt` (the `else` branch of `if (isSingle)`), replace the hardcoded paragraph that begins `First part — moving through the cards: Go in whatever order the energy pulls you...` (the whole paragraph) with:

```
$movementInstruction
```

(So that line in the template becomes exactly `$movementInstruction`.)

- [ ] **Step 5: Use `systemPrompt` instead of `READER_PERSONA` for the Claude call**

In `handleInterpret`, change the `claudeBody` `.put("system", READER_PERSONA)` to:

```kotlin
            .put("system", systemPrompt)
```

- [ ] **Step 6: Verify**

Re-read the modified `handleInterpret`. Confirm: year-ahead spreads reorder to start at the current month with `"n of 12 — Month Year"` labels; the system prompt is `READER_PERSONA + buildAddressingNote(readerName)`; non-year-ahead behavior is unchanged. Cross-check the reorder logic against `tarot/server.js` (the `isYearAhead` / `promptCards` block).

- [ ] **Step 7: Commit**

```bash
git -C "C:/Users/Matt/projects/TarotApp" add app/src/main/java/com/matt/tarot/TarotServer.kt
git -C "C:/Users/Matt/projects/TarotApp" commit -m "feat: interpret uses Miriel persona/addressing + Year Ahead chronological dating"
```

---

## Task 5: Persona/addressing refresh for clarify, session-summary, suggest-spread

**Files:**
- Modify: `TarotApp/app/src/main/java/com/matt/tarot/TarotServer.kt` (`handleClarify`, `handleSessionSummary`, `handleSuggestSpread`)

These already use `READER_PERSONA` (now the Miriel version after Task 3), so they pick up the persona automatically. Add addressing where a `readerName` is available.

- [ ] **Step 1: `handleClarify` — add addressing**

In `handleClarify`, after `val clarifier = body.optJSONObject("clarifierCard") ?: return errorResponse(400, "No clarifierCard")`, add:

```kotlin
        val readerName = body.optString("readerName")
```

Change its `claudeBody` `.put("system", READER_PERSONA)` to:

```kotlin
            .put("system", READER_PERSONA + buildAddressingNote(readerName))
```

- [ ] **Step 2: `handleSessionSummary` — add addressing**

`handleSessionSummary` already reads `val readerName = body.optString("readerName").ifEmpty { "you" }`. Do NOT pass `"you"` into the addressing note (it would address a person literally named "you"). Instead add a separate raw read near the top of the handler:

```kotlin
        val readerNameRaw = body.optString("readerName")
```

and change its `claudeBody` `.put("system", READER_PERSONA)` to:

```kotlin
            .put("system", READER_PERSONA + buildAddressingNote(readerNameRaw))
```

(Leave the existing `readerName … ifEmpty { "you" }` used in the prompt body as-is.)

- [ ] **Step 3: `handleSuggestSpread` — persona only (no readerName sent)**

`handleSuggestSpread` already uses `READER_PERSONA` and the frontend sends no `readerName` here, so no change is needed beyond the Task-3 persona swap. Confirm it references `READER_PERSONA` and leave it.

- [ ] **Step 4: Verify & commit**

Confirm clarify and session-summary now append `buildAddressingNote(...)`. Commit:

```bash
git -C "C:/Users/Matt/projects/TarotApp" add app/src/main/java/com/matt/tarot/TarotServer.kt
git -C "C:/Users/Matt/projects/TarotApp" commit -m "feat: addressing note on clarify + session-summary"
```

---

## Task 6: Compatibility endpoint

**Files:**
- Modify: `TarotApp/app/src/main/java/com/matt/tarot/TarotServer.kt` (add route in `handleApi`; add `handleCompatibility`)

- [ ] **Step 1: Add the route**

In `handleApi`, add this branch (next to the `/api/interpret` branch):

```kotlin
            uri == "/api/compatibility" && method == Method.POST ->
                handleCompatibility(body)
```

- [ ] **Step 2: Add the handler (port of `server.js` `/api/compatibility`)**

Add this method to `TarotServer` (near `handleInterpret`). It omits `buildPersonaWithProfile` (a memory/profile feature, out of scope) — persona is `READER_PERSONA + buildCompatAddressingNote(...)`:

```kotlin
    private fun handleCompatibility(body: JSONObject?): Response {
        val apiKey = getApiKey() ?: return errorResponse(500, "NO_KEY")
        if (body == null) return errorResponse(400, "No body")
        val cards   = body.optJSONArray("cards") ?: return errorResponse(400, "No cards provided.")
        val personA = body.optJSONObject("personA") ?: return errorResponse(400, "Both persons required.")
        val personB = body.optJSONObject("personB") ?: return errorResponse(400, "Both persons required.")
        val question  = body.optString("question")
        val themeCard = body.optJSONObject("themeCard")
        val readerName = body.optString("readerName")
        val aName = personA.optString("name"); val bName = personB.optString("name")

        val system = READER_PERSONA + buildCompatAddressingNote(readerName, aName, bName)

        val posLabels = mapOf(
            "a-energy"   to "$aName's Energy",
            "b-energy"   to "$bName's Energy",
            "connection" to "The Connection",
            "tension"    to "The Tension",
            "nurture"    to "What to Nurture",
            "outcome"    to "Outcome"
        )
        fun fmt(c: JSONObject): String {
            val orient = if (c.optBoolean("isReversed")) "reversed" else "upright"
            val posLabel = posLabels[c.optString("position")] ?: c.optString("position")
            val pos = if (posLabel.isNotEmpty()) "$posLabel: " else ""
            return buildString {
                append("$pos${c.optString("name")} ($orient)")
                c.optString("keywords").takeIf { it.isNotEmpty() }?.let { append("\n  Keywords: $it") }
                c.optString("meaning").takeIf { it.isNotEmpty() }?.let { append("\n  Meaning: $it") }
                c.optString("element").takeIf { it.isNotEmpty() }?.let { append("\n  Element: $it") }
                c.optString("astro").takeIf { it.isNotEmpty() }?.let { append("\n  Astrology: $it") }
                c.optString("shadow").takeIf { it.isNotEmpty() }?.let { append("\n  Shadow: $it") }
            }.trim()
        }
        val cardBlock = (0 until cards.length()).joinToString("\n\n") { fmt(cards.getJSONObject(it)) }
        val questionLine = if (question.isNotEmpty()) "\nQuestion: \"$question\"\n" else ""
        val themeBlock = if (themeCard != null)
            "\nUnderlying Theme: ${themeCard.optString("name")} (${if (themeCard.optBoolean("isReversed")) "reversed" else "upright"}) — weave this in as a background current.\n"
            else ""

        val zodiacDesc = mapOf(
            "Aries" to "fire, initiative, directness, impulsiveness",
            "Taurus" to "earth, steadiness, sensuality, stubbornness",
            "Gemini" to "air, curiosity, adaptability, restlessness",
            "Cancer" to "water, nurturing, intuition, defensiveness",
            "Leo" to "fire, warmth, confidence, ego",
            "Virgo" to "earth, precision, service, anxiety",
            "Libra" to "air, harmony, diplomacy, indecision",
            "Scorpio" to "water, depth, intensity, control",
            "Sagittarius" to "fire, freedom, philosophy, bluntness",
            "Capricorn" to "earth, discipline, ambition, coldness",
            "Aquarius" to "air, independence, vision, detachment",
            "Pisces" to "water, empathy, imagination, escapism"
        )
        val zA = personA.optString("zodiac"); val zB = personB.optString("zodiac")
        val descA = zodiacDesc[zA] ?: zA
        val descB = zodiacDesc[zB] ?: zB

        val prompt = """${questionLine}${themeBlock}You're reading a compatibility spread for two people.

$aName is a $zA ($descA).
$bName is a $zB ($descB).

The spread — six positions:
$cardBlock

Write this in two parts, separated by the exact token ||| on its own line. Nothing else on that line.

First part — moving through the cards: Read each position as it relates to these two specific people and their energies. Let the astrological nature of each person shape how you interpret their cards — $zA energy looks and feels different from $zB energy, and that matters here. Notice where their cards speak to each other, where they pull against each other, where something unexpected shows up. Give more time to what feels most alive. Speak to both people, not just the one who asked.

Second part — the whole picture: Step back and say what you actually see about this pairing. Not a summary — the moment when the spread comes into focus. What is the essential nature of what these two bring to each other? Where is the real friction, and where is the real gift? What thread runs through the whole reading that they both need to hear? Be honest, be warm, be direct.

Then add one more ||| on its own line. After that, in a sentence or two: name the one thread from this reading that feels most alive or unresolved and invite them to explore it. End with exactly [SINGLE] if one clarifier card would serve it, or [SPREAD] if the thread runs deep enough to warrant its own full reading."""

        val claudeBody = JSONObject()
            .put("model", "claude-sonnet-4-6")
            .put("max_tokens", 3000)
            .put("system", system)
            .put("messages", JSONArray().put(JSONObject().put("role", "user").put("content", prompt)))

        val text = callClaude(apiKey, claudeBody) ?: return errorResponse(500, "Claude API call failed")
        return jsonResponse(JSONObject().put("interpretation", text))
    }
```

- [ ] **Step 3: Verify against `tarot/server.js:786-876` and commit**

Confirm the six position labels, zodiac map, and two-part prompt match. (The web version also injects `priorReadings` history; the Android port omits it to stay simple — acceptable, the reading still works.) Commit:

```bash
git -C "C:/Users/Matt/projects/TarotApp" add app/src/main/java/com/matt/tarot/TarotServer.kt
git -C "C:/Users/Matt/projects/TarotApp" commit -m "feat: compatibility reading endpoint"
```

---

## Task 7: Daily card endpoint

**Files:**
- Modify: `TarotApp/app/src/main/java/com/matt/tarot/TarotServer.kt` (route + handler + helpers; add `dailyDir` field)

- [ ] **Step 1: Add a `dailyDir` field**

Next to the existing `private val readingsDir = File(dataDir, "readings")`, add:

```kotlin
    private val dailyDir = File(dataDir, "daily")
```

- [ ] **Step 2: Add the route**

In `handleApi`, add (next to `/api/cards`):

```kotlin
            uri == "/api/daily-card" && method == Method.GET ->
                handleDailyCard(session.parameters)
```

- [ ] **Step 3: Add the handler + helpers (port of `server.js` `/api/daily-card`)**

Add to `TarotServer`:

```kotlin
    private val NON_REVERSIBLE_RUNE_IDS = setOf("rune-07","rune-09","rune-11","rune-12","rune-16","rune-22","rune-23")
    private fun dailyNoReversal(deckType: String?, id: String?): Boolean {
        if (deckType == "Lenormand" || deckType == "IChing") return true
        return id != null && id in NON_REVERSIBLE_RUNE_IDS
    }

    private fun localDateKey(millis: Long): String {
        val c = java.util.Calendar.getInstance().apply { timeInMillis = millis }
        val y = c.get(java.util.Calendar.YEAR)
        val m = (c.get(java.util.Calendar.MONTH) + 1).toString().padStart(2, '0')
        val d = c.get(java.util.Calendar.DAY_OF_MONTH).toString().padStart(2, '0')
        return "$y-$m-$d"
    }

    private fun loadDaily(slug: String): JSONObject {
        return try {
            val f = File(dailyDir, "$slug.json")
            if (f.exists()) JSONObject(f.readText())
            else JSONObject().put("current", JSONObject.NULL).put("streak", 0).put("history", JSONArray())
        } catch (e: Exception) {
            JSONObject().put("current", JSONObject.NULL).put("streak", 0).put("history", JSONArray())
        }
    }

    private fun saveDaily(slug: String, doc: JSONObject) {
        dailyDir.mkdirs()
        File(dailyDir, "$slug.json").writeText(doc.toString(2))
    }

    private fun allDeckCards(): List<Pair<String, JSONObject>> {
        val deckFiles = listOf("tarot","thoth","celtic-dragon","moonology","lenormand","runic","iching","oracle")
        val out = ArrayList<Pair<String, JSONObject>>()
        for (d in deckFiles) {
            try {
                val file = File(dataDir, "$d.json")
                val text = if (file.exists()) file.readText()
                           else context.assets.open("tarot-server/data/$d.json").bufferedReader().readText()
                val arr = JSONArray(text)
                for (i in 0 until arr.length()) out.add(d to arr.getJSONObject(i))
            } catch (e: Exception) { /* skip deck */ }
        }
        return out
    }

    private fun handleDailyCard(params: Map<String, List<String>>): Response {
        val readers = loadReaders()
        val slug = params["reader"]?.firstOrNull()
            ?: (if (readers.length() > 0) readers.getJSONObject(0).optString("slug") else "matt")
        val today = localDateKey(System.currentTimeMillis())
        val doc = loadDaily(slug)

        val current = doc.optJSONObject("current")
        if (current != null && current.optString("dateKey") == today) {
            val out = JSONObject(current.toString())
                .put("streak", doc.optInt("streak", 0))
                .put("history", lastN(doc.optJSONArray("history"), 7))
            return jsonResponse(out)
        }

        val requestedDeck = params["deck"]?.firstOrNull()
        val pool = allDeckCards().let { all ->
            if (requestedDeck != null && all.any { it.first == requestedDeck }) all.filter { it.first == requestedDeck } else all
        }
        if (pool.isEmpty()) return errorResponse(500, "No cards available")

        val (deckKey, pick) = pool[(Math.random() * pool.size).toInt().coerceIn(0, pool.size - 1)]
        val noRev = dailyNoReversal(pick.optString("deckType").ifEmpty { null }, pick.optString("id"))
        val isReversed = if (noRev) false else Math.random() < 0.3

        val yesterday = localDateKey(System.currentTimeMillis() - 86400000L)
        val lastKey = current?.optString("dateKey")
        val streak = if (lastKey == yesterday) doc.optInt("streak", 0) + 1 else 1

        var reflection: String? = null
        try {
            val apiKey = getApiKey()
            if (apiKey != null) {
                val meaning = if (isReversed) pick.optString("reversed").ifEmpty { pick.optString("upright") }
                              else pick.optString("upright").ifEmpty { pick.optString("meaning") }
                val deckType = pick.optString("deckType").ifEmpty { "Tarot" }
                val prompt = "Today's card of the day is ${pick.optString("name")}${if (isReversed) ", reversed" else ""} ($deckType deck). Traditional meaning, for your eyes only: \"${meaning.take(400)}\"\n\nOffer a short reflection for the day ahead — two or three sentences, the kind of thing you'd say while sliding the morning's single card across the table. No question was asked; this is a daily touchstone. Don't recite the meaning, speak to the day. Words only — no stage directions or asterisked actions."
                val cb = JSONObject()
                    .put("model", "claude-haiku-4-5-20251001").put("max_tokens", 220)
                    .put("system", READER_PERSONA)
                    .put("messages", JSONArray().put(JSONObject().put("role", "user").put("content", prompt)))
                reflection = callClaude(apiKey, cb)?.trim()
            }
        } catch (e: Exception) { Log.w(TAG, "Daily reflection failed: ${e.message}") }

        val card = JSONObject()
            .put("id", pick.optString("id"))
            .put("name", pick.optString("name"))
            .put("deckType", pick.optString("deckType").ifEmpty { null } ?: JSONObject.NULL)
            .put("deck", deckKey)
            .put("isReversed", isReversed)
        val newCurrent = JSONObject()
            .put("dateKey", today).put("card", card)
            .put("reflection", reflection ?: JSONObject.NULL)

        val history = doc.optJSONArray("history") ?: JSONArray()
        history.put(JSONObject().put("dateKey", today).put("id", pick.optString("id"))
            .put("name", pick.optString("name")).put("deck", deckKey).put("isReversed", isReversed))
        doc.put("current", newCurrent).put("streak", streak).put("history", lastN(history, 60))
        saveDaily(slug, doc)

        val out = JSONObject(newCurrent.toString())
            .put("streak", streak)
            .put("history", lastN(history, 7))
        return jsonResponse(out)
    }

    // Returns the last n elements of a JSONArray as a new JSONArray.
    private fun lastN(arr: JSONArray?, n: Int): JSONArray {
        if (arr == null) return JSONArray()
        val start = maxOf(0, arr.length() - n)
        val out = JSONArray()
        for (i in start until arr.length()) out.put(arr.get(i))
        return out
    }
```

- [ ] **Step 4: Verify against `tarot/server.js:358-450` and commit**

Confirm: same card all day; streak increments only when yesterday was the last key; reflection via Haiku (null on failure); response shape `{dateKey, card:{id,name,deckType,deck,isReversed}, reflection, streak, history}`. Commit:

```bash
git -C "C:/Users/Matt/projects/TarotApp" add app/src/main/java/com/matt/tarot/TarotServer.kt
git -C "C:/Users/Matt/projects/TarotApp" commit -m "feat: card of the day endpoint"
```

---

## Task 8: Patterns endpoint

**Files:**
- Modify: `TarotApp/app/src/main/java/com/matt/tarot/TarotServer.kt` (route + handler; add `patternsDir` field)

- [ ] **Step 1: Add a `patternsDir` field**

Next to `readingsDir`:

```kotlin
    private val patternsDir = File(dataDir, "patterns")
```

- [ ] **Step 2: Add the route**

In `handleApi` (next to `/api/readings` POST):

```kotlin
            uri == "/api/patterns" && method == Method.POST ->
                handlePatterns(body)
```

- [ ] **Step 3: Add the handler (port of `server.js` `/api/patterns`)**

```kotlin
    private fun handlePatterns(body: JSONObject?): Response {
        val readers = loadReaders()
        val slug = (body?.optString("reader") ?: "").ifEmpty {
            if (readers.length() > 0) readers.getJSONObject(0).optString("slug") else "matt"
        }
        val file = File(readingsDir, "$slug.json")
        val readings = try { if (file.exists()) JSONArray(file.readText()) else JSONArray() } catch (e: Exception) { JSONArray() }

        if (readings.length() < 5) {
            return jsonResponse(JSONObject().put("text", JSONObject.NULL).put("tooFew", true).put("readingCount", readings.length()))
        }

        val cachePath = File(patternsDir, "$slug.json")
        try {
            if (cachePath.exists()) {
                val cached = JSONObject(cachePath.readText())
                if (cached.optInt("readingCount") == readings.length() && cached.optString("text").isNotEmpty())
                    return jsonResponse(cached)
            }
        } catch (e: Exception) { /* regenerate */ }

        val apiKey = getApiKey() ?: return errorResponse(500, "NO_KEY")

        // Card frequencies across the whole history
        val freq = HashMap<String, Int>()
        for (i in 0 until readings.length()) {
            val cs = readings.getJSONObject(i).optJSONArray("cards") ?: continue
            for (j in 0 until cs.length()) {
                val name = cs.getJSONObject(j).optString("name")
                if (name.isNotEmpty()) freq[name] = (freq[name] ?: 0) + 1
            }
        }
        val recurring = JSONArray()
        freq.entries.filter { it.value >= 2 }.sortedByDescending { it.value }.take(12)
            .forEach { recurring.put(JSONObject().put("name", it.key).put("count", it.value)) }
        val recurringLine = (0 until recurring.length()).joinToString(", ") {
            val r = recurring.getJSONObject(it); "${r.optString("name")} ×${r.optInt("count")}"
        }.ifEmpty { "none repeat yet" }

        val start = maxOf(0, readings.length() - 15)
        val digest = (start until readings.length()).joinToString("\n") { i ->
            val rd = readings.getJSONObject(i)
            val cs = rd.optJSONArray("cards")
            val cards = if (cs == null) "" else (0 until cs.length()).joinToString(", ") { j ->
                val c = cs.getJSONObject(j); c.optString("name") + if (c.optBoolean("isReversed")) " (reversed)" else ""
            }
            val q = rd.optString("question").let { if (it.isNotEmpty()) " — \"$it\"" else "" }
            "${rd.optString("date")} — ${rd.optString("deckLabel").ifEmpty { rd.optString("deck") }}, ${rd.optString("spread")}$q\n  Cards: $cards"
        }

        val prompt = """You are looking back through your journal of readings for this person — ${readings.length()} readings in all.

Cards that keep returning across the whole journal: $recurringLine.

Their last fifteen readings:
$digest

Reflect on what you see moving across these pages — the cards that keep finding them, the questions that circle back, the threads that have shifted or stayed stuck. Two to four short paragraphs, speaking directly to them. Don't summarize reading by reading; weave. If something has visibly moved or resolved since the earlier entries, name it. If something keeps surfacing that they haven't faced, name that too — kindly."""

        val cb = JSONObject()
            .put("model", "claude-sonnet-4-6").put("max_tokens", 800)
            .put("system", READER_PERSONA)
            .put("messages", JSONArray().put(JSONObject().put("role", "user").put("content", prompt)))
        val text = callClaude(apiKey, cb)?.trim() ?: return errorResponse(500, "Claude API call failed")

        val payload = JSONObject()
            .put("text", text).put("recurring", recurring)
            .put("readingCount", readings.length()).put("generatedAt", System.currentTimeMillis())
        try { patternsDir.mkdirs(); cachePath.writeText(payload.toString(2)) } catch (e: Exception) { /* non-fatal */ }
        return jsonResponse(payload)
    }
```

- [ ] **Step 4: Verify against `tarot/server.js:297-356` and commit**

Confirm: `<5` readings → `{text:null, tooFew:true, readingCount}`; cache keyed on `readingCount`; response `{text, recurring:[{name,count}], readingCount, generatedAt}`. Commit:

```bash
git -C "C:/Users/Matt/projects/TarotApp" add app/src/main/java/com/matt/tarot/TarotServer.kt
git -C "C:/Users/Matt/projects/TarotApp" commit -m "feat: pattern weaving endpoint"
```

---

## Task 9: Graceful stubs for memory-moat endpoints

**Files:**
- Modify: `TarotApp/app/src/main/java/com/matt/tarot/TarotServer.kt` (routes in `handleApi`)

- [ ] **Step 1: Add the stub routes**

In `handleApi`, add these branches (place the prefix matches before the `else`):

```kotlin
            uri == "/api/threshold" && method == Method.GET ->
                jsonResponse(JSONObject().put("mode", "none"))

            uri == "/api/threshold/answer" && method == Method.POST ->
                jsonResponse(JSONObject().put("reply", "Thank you for telling me. Let us see what the cards have for you now."))

            uri == "/api/reading-questions" && method == Method.POST ->
                jsonResponse(JSONObject().put("questions", JSONArray()))

            uri.startsWith("/api/foretellings/") && method == Method.GET ->
                jsonResponse(JSONObject().put("foretellings", JSONArray()))

            uri.startsWith("/api/profiles/") && method == Method.GET ->
                handleProfileStub(uri.removePrefix("/api/profiles/"))
```

- [ ] **Step 2: Add the profile stub handler**

```kotlin
    // Memory features are out of scope on Android — return a tier-1 payload so the
    // notebook overlay shows its "still getting to know you" teaser, no living note.
    private fun handleProfileStub(slug: String): Response {
        val file = File(readingsDir, "$slug.json")
        val count = try { if (file.exists()) JSONArray(file.readText()).length() else 0 } catch (e: Exception) { 0 }
        return jsonResponse(JSONObject()
            .put("profile", JSONObject.NULL)
            .put("readingCount", count)
            .put("tier", 1))
    }
```

- [ ] **Step 3: Verify & commit**

Confirm the five stubs return shapes the frontend tolerates (`{mode:'none'}`, `{reply}`, `{questions:[]}`, `{foretellings:[]}`, `{profile:null,readingCount,tier:1}`). Commit:

```bash
git -C "C:/Users/Matt/projects/TarotApp" add app/src/main/java/com/matt/tarot/TarotServer.kt
git -C "C:/Users/Matt/projects/TarotApp" commit -m "feat: graceful stubs for memory-moat endpoints"
```

---

## Task 10: Version bump

**Files:**
- Modify: `TarotApp/app/build.gradle`

- [ ] **Step 1: Bump version**

In `app/build.gradle` `defaultConfig`, change:

```
        versionCode 1
        versionName "1.0"
```
to:
```
        versionCode 2
        versionName "1.2"
```

- [ ] **Step 2: Commit**

```bash
git -C "C:/Users/Matt/projects/TarotApp" add app/build.gradle
git -C "C:/Users/Matt/projects/TarotApp" commit -m "build: bump Android app to versionCode 2 / 1.2"
```

---

## Task 11: Build & on-device smoke test (USER)

**No code.** The implementer cannot build or run Android here. Hand this checklist to the user.

- [ ] **Step 1: Build in Android Studio**

Open `C:\Users\Matt\projects\TarotApp` in Android Studio, let Gradle sync, then **Build → Generate Signed Bundle / APK → APK → release** (the release signing config is already in `app/build.gradle`). Or `Build → Build APK(s)` for a debug build to sideload faster.

- [ ] **Step 2: Install on device and smoke-test**

Sideload the APK. On first launch wait for image extraction (~30s). Then verify:
1. App launches; the WebView loads with the refreshed visuals; no obvious broken UI.
2. Add your API key in settings (⚙) if prompted; `config-status` reports a key.
3. Do a multi-card reading — interpretation arrives in **Miriel's** voice, second person ("you"), not third person.
4. Do a **Year Ahead** reading — she reads month by month **from the current month forward**, dated with real years (e.g., "June 2026 … May 2027"), NOT January→December.
5. **Card of the Day** returns a card + short reflection; the same card persists if reopened the same day.
6. **Patterns** (after ≥5 saved readings) returns a multi-paragraph weave.
7. **Compatibility** spread returns a two-person reading.
8. Journal/grimoire history and **session summary** work.
9. Memory features are simply absent — no Threshold overlay, no mid-deal curiosity pause, the notebook shows the tier-1 teaser, Foretellings is empty — and nothing errors.
10. Export a session (save) — it lands in Downloads.

- [ ] **Step 3: Report results** — note anything that misbehaves for follow-up.

---

## Self-Review notes (for the implementer)
- **Spec coverage:** assets §1 → Tasks 1-2; prompts §2 → Tasks 3-5; new endpoints §3 → Tasks 6-8; stubs §4 → Task 9; version §5 → Task 10; testing → Task 11. All spec sections mapped.
- **No memory engine / SQLite:** every new handler is file-backed or stateless; confirmed.
- **Kotlin string templates:** prompt literals use `$name`/`${expr}` interpolation per existing `TarotServer.kt` style; there are no literal `$` characters in these prompts, so no `${'$'}` escaping is needed.
- **minSdk 24:** date handling uses `java.util.Calendar` (not `java.time`), and `JSONArray` rebuilds avoid `remove()` — consistent with the existing code's constraints.
- **Naming consistency:** `buildAddressingNote`, `buildCompatAddressingNote`, `dailyDir`, `patternsDir`, `lastN`, `handleCompatibility`, `handleDailyCard`, `handlePatterns`, `handleProfileStub` used consistently across tasks.
