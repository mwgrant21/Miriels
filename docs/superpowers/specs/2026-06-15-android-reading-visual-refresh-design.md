# Android App — Reading + Visual Refresh — Design Spec

**Date:** 2026-06-15
**Status:** Approved (design), pending implementation plan
**Target project:** `C:\Users\Matt\projects\TarotApp` (native Android, Kotlin)
**Companion to:** the web app at `C:\Users\Matt\projects\tarot` (source of truth for frontend + prompts)

## Summary

The Android app has not been updated since April 2026 and is far behind the web
app. Bring it **current for reading quality and visuals** without porting the
memory engine. Concretely: refresh the bundled frontend + decks, modernize the
Kotlin reading prompts to the current Miriel voice (persona + second-person
addressing + the Year Ahead chronological fix), port the three non-memory feature
endpoints the refreshed UI needs (compatibility, daily-card, patterns), and add
graceful stubs for the memory-moat endpoints so the new frontend degrades cleanly.

**Explicitly out of scope:** the memory engine (atoms/recall/capture), Threshold
reunion, in-reading curiosity, outcome-loop/foretellings, reader-profile notebook,
and living note. These were chosen to be skipped to avoid a Kotlin + Android-SQLite
port and a permanent dual-maintenance tax. They degrade gracefully via stubs.

## Architecture (unchanged)

`MainActivity` (WebView) → on first run extracts image zips from `res/raw` and
copies `assets/tarot-server/data/*` into `filesDir/data` (preserving user data),
then starts `TarotServer` (NanoHTTPD on localhost:3000) and loads the WebView at
`http://127.0.0.1:3000`. The **frontend is served straight from `assets`**, so
replacing the asset files updates the app on rebuild with no migration. The Kotlin
server reimplements the API and calls the Anthropic API directly via OkHttp using
the user's stored key (`config.json`). Data is flat JSON files (no SQLite).

This spec changes only: the bundled asset files, `TarotServer.kt`, and the version
in `app/build.gradle`. `MainActivity.kt`, the image zips, gradle wrapper, and the
release signing config are untouched.

## Components & Changes

### 1. Asset refresh
- Copy current web files into the app:
  - `tarot/public/index.html` → `TarotApp/app/src/main/assets/tarot-server/public/index.html`
  - `tarot/public/app.js` → `.../public/app.js`
  - `tarot/public/style.css` → `.../public/style.css`
  - `tarot/data/*.json` (the 8 deck files: tarot, oracle, moonology, celtic-dragon,
    lenormand, thoth, runic, iching) → `.../assets/tarot-server/data/`
- Do NOT copy: `config.json` (API key), `readers.json` is bundled as a seed only
  (existing copy preserved by `copyDataFiles`'s `!dest.exists()` guard), `memory.db`,
  `profiles/`, `readings/`, `patterns/`, `daily/`, `interpretation-cache.js` or any
  `data/*.js` module (those are Node-only; the Kotlin server is the Android backend).
- Images: untouched. The existing `res/raw` zips cover the same 8 decks. (If card art
  was added since April, those cards fall back to the frontend's styled placeholder —
  acceptable; re-zipping 644MB of art is a separate task.)

**Caveat to document for the implementer:** `copyDataFiles` only copies a deck file
if it doesn't already exist in `filesDir/data`, and the whole first-run block is
gated by `KEY_SETUP_DONE`. So on an *upgrade install* the decks in `filesDir` are
not refreshed. `handleGetCards` falls back to reading from `assets` when a file is
missing, but an existing file wins. This is acceptable (decks rarely change); no
change required, just be aware fresh installs get current decks and upgrades keep
theirs.

### 2. Modernize reading prompts in `TarotServer.kt`
Port the current web `server.js` behavior into the existing Kotlin handlers:

- **Persona:** replace the hardcoded `READER_PERSONA` with the current Miriel persona
  string from `server.js` (`const READER_PERSONA = ...`, the "Your name is Miriel…"
  version).
- **Addressing note:** add a Kotlin `buildAddressingNote(readerName)` mirroring
  `data/addressing.js` — returns the "speak to them as 'you', never third person,
  name at most once" block, prefixed with `\n\n`. Append it to the system prompt for
  `interpret`, `clarify`, `session-summary` (and `compatibility`, §3). Empty string
  when `readerName` is blank.
- **`handleInterpret`:**
  - Build the system prompt as `READER_PERSONA + buildAddressingNote(readerName)`
    (read `readerName` from the body).
  - Add `spread_type == "year-ahead"` to the spread-label `when`:
    `"Year Ahead (one card per month)"`.
  - **Year Ahead chronological reorder + dating** (port of the `server.js` block):
    when `spread_type == "year-ahead"`, reorder the cards so they start at the
    current month and wrap into next year, renumbering each position
    `"{n} of 12 — {MonthName} {year}"` (current year for months ≥ current month,
    next year for the wrapped months). Match each card's month by the first three
    letters of its `position` (handles both `"January"` and `"jan"`). Use the
    reordered list to build the card block. The movement instruction for year-ahead
    must tell her the months are pre-numbered and to read them strictly in that order
    (port the `movementInstruction` year-ahead branch); all other spreads keep the
    existing free-order instruction.
  - The two-part `|||` output contract and `[SINGLE]`/`[SPREAD]` tags stay as they
    already are in the Kotlin handler (they match the web app).
- **`handleClarify`, `handleSessionSummary`, `handleSuggestSpread`:** rebuild the
  system prompt with the Miriel persona (+ addressing where a `readerName` is
  available); keep their existing prompt bodies, which already match `server.js`.

### 3. New non-memory endpoints (port into `TarotServer.kt`)
Add routes in `handleApi` and handlers. All are LLM-only (OkHttp → Anthropic) with no
SQLite.

- **`POST /api/compatibility`** — the relationship spread. Like `handleInterpret`
  but with two named people: read `personA`, `personB`, `readerName`; build a
  `buildCompatAddressingNote(readerName, aName, bName)` (port of the web helper:
  address the reader-as-participant as "you", name the other; general note if the
  reader is neither). Otherwise format cards + prompt as the six-card relationship
  reading the web `/api/compatibility` produces. Return `{"interpretation": text}`.
- **`GET /api/daily-card?reader=<slug>`** — pick the day's card and a short reflection.
  Port of web `/api/daily-card`: deterministic-per-day card selection seeded by date
  (mirror the web selection so the same day yields the same card), optional reversal
  per the web's `dailyNoReversal` rule, a short Haiku reflection via Claude, and a
  streak counter persisted to `filesDir/data/daily/<slug>.json`. Return the same JSON
  shape the frontend expects (inspect the web handler + the frontend consumer at
  `app.js` ~line 1339 for the exact fields).
- **`POST /api/patterns`** — LLM analysis over the reader's stored readings. Port of
  web `/api/patterns`: read the reader's `readings/<slug>.json`, build the web prompt,
  call Claude, persist/return per the web shape (inspect web handler + frontend
  consumer at `app.js` ~line 1072). No SQLite — file-backed.

The implementer MUST read the exact web `server.js` handlers for these three and the
matching frontend consumers to reproduce request/response shapes faithfully.

### 4. Graceful stubs for memory-moat endpoints
Add routes returning benign payloads so the refreshed frontend never hits the
"Unknown endpoint" error path:

- `GET /api/threshold` → `{"mode":"none"}` (also no side effects)
- `POST /api/threshold/answer` → `{"reply":"Thank you for telling me. Let us see what the cards have for you now."}`
- `POST /api/reading-questions` → `{"questions":[]}`
- `GET /api/foretellings/<slug>` → `{"foretellings":[]}`
- `GET /api/profiles/<slug>` → `{"profile":null,"readingCount":<count from readings file>,"tier":1}`

These match what the web endpoints return in the "nothing to show" case, which the
frontend already handles (`if (r.ok)` guards, empty arrays, tier-1 teaser). Routing
note: `/api/foretellings/` and `/api/profiles/` are path-param style — match by
prefix in `handleApi` (like the existing `/api/readers/` DELETE).

### 5. Version & build
- `app/build.gradle`: `versionCode 1 → 2`, `versionName "1.0" → "1.2"`.
- Build/sign in Android Studio (release signing config already present). Not buildable
  or testable from the CLI environment (no SDK/emulator wired up here).

## Data flow (reading, unchanged shape)
WebView (refreshed `app.js`) → `localhost:3000` → `TarotServer.serve` → `handleApi`
→ handler builds prompt (Miriel persona + addressing) → OkHttp → Anthropic → parse →
JSON back to the WebView. Readings persist to `filesDir/data/readings/<slug>.json`.

## Error handling
- Keep the existing Kotlin patterns: `getApiKey()` null → `NO_KEY` 500; Claude failure
  → 500 with logged error; malformed body → 400. New endpoints follow the same.
- Stubs never error; they return their benign payloads regardless of state.
- Daily/patterns file reads use the existing try/catch-returns-empty idioms.

## Testing
No Android unit tests exist or are practical in this environment. Verification is an
Android Studio build + on-device smoke test. Checklist (to ship with the plan):
1. App launches; WebView loads; no console errors for missing endpoints.
2. A multi-card reading returns in Miriel's voice, second person ("you").
3. **Year Ahead** reads month-by-month from the current month forward, dated with real
   years, not Jan→Dec.
4. Daily card returns a card + reflection; streak persists across days.
5. Patterns returns an analysis over stored readings.
6. Compatibility spread returns a two-person reading.
7. Journal/grimoire (readings history) and session summary work.
8. Memory features are simply absent (no Threshold overlay, no curiosity pause, empty
   Foretellings, tier-1 notebook) — no errors.
9. Session export (`AndroidBridge.saveFile`) still writes to Downloads.

## Out of scope (YAGNI)
- Memory engine / SQLite on Android.
- Threshold, curiosity, foretellings, profile notebook, living note (stubbed).
- Re-zipping/refreshing card art images.
- CI / automated Android tests.
- Any change to `MainActivity.kt`, boot flow, or image extraction.
