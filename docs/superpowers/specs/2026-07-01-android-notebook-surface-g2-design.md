# Android Notebook Display Surface (Slice G2) Design

**Date:** 2026-07-01
**Status:** Approved
**Scope:** G2 of the Slice G split -- the notebook display surface + the two /api/profiles endpoints. This is the LAST memory-engine parity item.

## Summary

Port `data/notebook.js` + the two `server.js` `/api/profiles/*` routes to the Android app. Replace the profile stub with the real notebook payload (profile + tier + recurring cards with resolved image URLs) and add the manual-refresh endpoint. This surfaces the G1-synthesized profile (miriel_notes, life_arc, recurring_cards, and the living_note) to the already-bundled notebook UI. G1 shipped the profile WRITE + persona injection; G2 is the READ/display surface.

Web source of truth: `data/notebook.js` (resolveCardImage, buildNotebookPayload) and `server.js` `GET /api/profiles/:slug` + `POST /api/profiles/:slug/refresh`.

## Current Android state

- `handleProfileStub(slug)` returns `{profile: NULL, readingCount, tier: 1}` for `GET /api/profiles/<slug>`. There is NO POST refresh route (the router only matches `startsWith("/api/profiles/") && GET`).
- Card art: `serveImage` resolves `File(imagesDir, relative)` where the URL is `/images/tarot/<file>`; images live at `imagesDir/tarot/<id>.<ext>` (extracted from res/raw on first run).
- `tarot.json` loads from `File(dataDir, "tarot.json")` (with an assets fallback in handleGetCards).
- G1 shipped: `readerProfile.loadReaderProfile(slug): JSONObject?`, `readerProfile.refreshReaderProfile(slug, callLLM)`, and the top-level pure `getTier(count)`.
- `loadReaders(): JSONArray`, `memoryCallLLM` (matches CallLLM), `jsonResponse`, `errorResponse` all exist.
- The bundled frontend already renders the notebook (fetches `GET /api/profiles/:slug`, POSTs `/refresh`) -- NO frontend work.

## Architecture (2 tasks)

### Task 1 - Notebook payload + real GET endpoint (TarotServer.kt)
- `resolveCardImage(cardName: String): String?` -- faithful port of notebook.js resolveCardImage. Read `tarot.json` (File(dataDir,"tarot.json"), assets fallback); find the card whose `name` equals `cardName` case-insensitively; for each ext in `[jpg, jpeg, png, webp, svg]` check `File(imagesDir, "tarot/<id><ext>")`; return `/images/tarot/<urlEncoded file>` for the first that exists, else null. Best-effort: any error -> null. (Profile card_ids are LLM-invented and do not match real deck ids, so images resolve by NAME; unresolvable cards get imageUrl null and the frontend renders a placeholder.)
- `buildNotebookPayload(slug: String): JSONObject` -- `readingCount` = length of readings/<slug>.json; `tier = getTier(readingCount)`; `profile = readerProfile.loadReaderProfile(slug)`; if profile has a `recurring_cards` array, produce a COPY of the profile whose recurring_cards each gain `imageUrl = resolveCardImage(rc.card)` (leave the rest of the profile, including `living_note`, untouched); return `{profile: <profile-or-JSONObject.NULL>, readingCount, tier}`.
- Replace `handleProfileStub` with `handleProfiles(slug)`: if the slug is not a known reader (not present in loadReaders() by slug), return 404 `{error:"Reader not found"}` (web parity); else `jsonResponse(buildNotebookPayload(slug))`. Route unchanged: `GET /api/profiles/<slug>`.

### Task 2 - POST refresh endpoint + version bump (TarotServer.kt, app/build.gradle)
- Add route: `uri.startsWith("/api/profiles/") && uri.endsWith("/refresh") && method == Method.POST` -> `handleProfileRefresh(slug)` where slug = uri between the prefix and the `/refresh` suffix. Place this BEFORE the existing GET branch (or as its own match) so `/refresh` POSTs are not shadowed.
- `handleProfileRefresh(slug)`: 404 `{error:"Reader not found"}` if unknown reader; else call `readerProfile.refreshReaderProfile(slug, ::memoryCallLLM)` SYNCHRONOUSLY (web awaits it -- this is a user-triggered manual refresh, distinct from G1's background save cadence), then `{ok:true, readings_synthesized: loadReaderProfile(slug)?.optInt("readings_synthesized", 0) ?: 0}`; on any throw return 500 `{error: <message>}` (web parity).
- Version bump `versionCode 10 -> 11`, `versionName "1.10" -> "1.11"`.

## Data flow

notebook UI opens -> GET /api/profiles/<slug> -> {profile (incl. living_note), readingCount, tier, recurring_cards[].imageUrl} -> rendered (placeholder for null imageUrl). Refresh button -> POST /api/profiles/<slug>/refresh -> synchronous Sonnet re-synthesis (G1's refreshReaderProfile) -> UI re-fetches the GET.

## Error handling

- resolveCardImage / buildNotebookPayload best-effort: missing tarot.json or image -> imageUrl null; never throws out.
- Unknown reader -> 404 (both endpoints).
- refresh throw -> 500 {error} (web parity; the synchronous path can surface a real error to the user, unlike the fire-and-forget save cadence).
- No path breaks the app.

## Ambiguity resolutions

1. **Where the helpers live:** `resolveCardImage` + `buildNotebookPayload` are private TarotServer methods (they need imagesDir + dataDir + readerProfile + getTier, all server-owned), not a new class -- mirrors notebook.js's minimal footprint.
2. **Synchronous refresh:** the POST refresh awaits refreshReaderProfile (web `await`), so the user sees the fresh count on return; this differs from G1's background save-cadence refresh. refreshReaderProfile is itself best-effort internally, so a failure returns a profile-unchanged result rather than throwing -- the 500 path is for unexpected errors in the handler.
3. **Route ordering:** the `/refresh` POST branch must be matched before/independently of the GET branch so a POST to `/api/profiles/<slug>/refresh` is not mis-routed.
4. **tarot-only image resolution:** resolveCardImage resolves against tarot.json + images/tarot/ only (faithful to web); recurring cards from other decks won't resolve -> null imageUrl -> placeholder.

## Constraints (binding)

- ASCII-only in every added/model-facing line.
- Local commits only; never push.
- Time is unix SECONDS.
- ReaderProfile stays flat-JSON (no SQLite).
- Build/test via Android Studio's bundled JBR + gradlew.bat (assembleDebug; no new JVM tests -- file-IO/endpoint glue, getTier already tested in G1).

## Testing

- Tasks 1-2: assembleDebug compile gate.
- End: on-device smoke on real data. Write a profile first (a save triggers G1's refresh, as in the G1 smoke). Then: `GET /api/profiles/matt` returns the real profile with `tier:3`, `recurring_cards[].imageUrl` (mix of resolved + null per the card_id caveat), `living_note`, and correct `readingCount`; `POST /api/profiles/matt/refresh` returns `{ok:true, readings_synthesized:N}`. Restore device state after.

## Out of scope

- Any frontend change (notebook UI already bundled).
- The living-note write race noted in G1 (a G1 concern, self-healing; unchanged here).
