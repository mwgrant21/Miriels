# Miriel Threshold — Design Spec (Phase 2)

**Date:** 2026-06-14
**Status:** Approved direction, pre-implementation
**Builds on:** `2026-06-13-miriel-memory-engine-design.md` (Phase 1, shipped & merged)
**Author:** Matt + Claude (brainstorming session)

---

## 1. Vision

When you return to the app, Miriel meets you across the gap — she remembers an
open thread from a past reading and asks what came of it, *before* you say
anything. You answer; she responds in her voice; the reading begins. The
emotional target Matt named: **"a greeting you'd get visiting someone well
known"** — you walk in, sit down, and someone who knows you speaks first.

This is the visible payoff of the Phase-1 memory engine and the home of the
**outcome loop** ("I remember — did this happen?"), which is the single most
"she's psychic" move a reader can make. It is also the return hook: a reason to
come back and tell her what happened.

The "wow" mockup chosen during brainstorming is the **Returning Ritual**
(Option B): a cinematic full-takeover reunion, not a banner or a form.

---

## 2. Scope

**In scope (this spec):** the Threshold — Miriel's memory-aware greeting on app
open, the two-beat exchange (she asks → you answer → she responds), and capturing
your answer back into memory.

**Explicitly out of scope (next spec):** *in-reading curiosity* — Miriel pausing
mid-reading when a drawn card resonates with a remembered thread ("this card makes
me think of the situation with your sister — is she still upset?"). It is a
distinct feature that touches the reading-generation flow and will reuse the
memory-question-and-capture machinery built here. It gets its own spec after this
ships.

---

## 3. Behavior & triggering

On app open, after the active reader is known, the app asks the backend what to do.

**Decision (`decideThresholdMode`), given the reader's last-visit time, the set of
open un-asked threads, and now:**

| Condition | Mode |
|-----------|------|
| Has ≥1 qualifying open thread **and** gap since last visit ≥ `REUNION_GAP_DAYS` (2) | `reunion` — full cinematic takeover |
| Has ≥1 qualifying open thread **and** gap < 2 days | `gentle` — inline ask in the normal greeting |
| No qualifying thread / brand-new reader / no memory | `none` — today's greeting, unchanged |

**Qualifying thread:** `type='thread'`, `status` in (`open`,`moving`), `asked_at IS
NULL`, and `salience >= THRESHOLD_SALIENCE_BAR` (3) — only threads weighty enough
to genuinely pull at her.

**How many she surfaces:**
- `reunion`: up to `REUNION_MAX_THREADS` (3), highest-salience first.
- `gentle`: 1 (the single most salient).

**Rotation / no re-asking:** every surfaced thread is marked `asked_at = now` when
shown (see §6 on the show-time trade-off). She therefore rotates through open
threads across visits and never re-asks the same one.

---

## 4. The exchange (two-beat)

1. **She speaks.** A greeting generated in Miriel's voice that:
   - acknowledges the elapsed gap in her own words (e.g. "eleven days — the moon
     has turned since you sat with me"),
   - surfaces the qualifying thread(s) as remembered moments,
   - asks, in one breath, what came of them.
   One open free-text reply field.
2. **You answer** — a single open response addressing whatever she raised — **or
   skip** ("Not now" / empty).
3. **She responds** (only if you answered) — a generated reflection on your answer
   that may bridge into today's reading. Simultaneously, your answer is **captured
   to memory**, attributed to the surfaced threads:
   - threads you report as concluded → `status='resolved'` (linked to a new
     outcome atom via a `resolves` link),
   - threads still in motion → `status='moving'` with refined detail,
   - anything new you mention → new atoms,
   - all tagged `source_kind='threshold'`.
4. **Into the reading.** Overlay dismisses; the active reader/name is already set;
   normal reading flow resumes.

**Skip path:** dismiss immediately; threads are already marked asked; nothing is
captured; no reply beat.

---

## 5. LLM usage

| Beat | Model | Rationale |
|------|-------|-----------|
| Greeting generation | Sonnet (`claude-sonnet-4-6`) | Signature emotional moment; voice quality matters. Latency is hidden by the takeover animation. |
| Reply beat | Sonnet | Same — she must sound like herself reacting to you. |
| Answer capture / attribution | Haiku (`claude-haiku-4-5-20251001`) | Structured extraction, same as Phase-1 capture; cheap, async-friendly. |

All calls go through the existing `callLLM(system, prompt, maxTokens, model)` with
its Claude→Ollama fallback. The persona base is the existing `READER_PERSONA` +
`buildAddressingNote(readerName)` so the voice and "speak to you as 'you'" rules
are consistent with the rest of the app.

---

## 6. Backend components

### Store (`data/memory-store.js`)

- **New column** `asked_at INTEGER` (nullable) on `memories`. Because
  `CREATE TABLE IF NOT EXISTS` does not alter an existing table, add a **guarded
  one-time migration** at store init: read `PRAGMA table_info(memories)`, and if
  `asked_at` is absent, `ALTER TABLE memories ADD COLUMN asked_at INTEGER`.
  Idempotent and safe on both fresh and existing `memory.db`.
- **`getOpenUnaskedThreads(slug, limit)`** — `WHERE reader_slug=? AND type='thread'
  AND status IN ('open','moving') AND asked_at IS NULL AND salience >= ?` ORDER BY
  `salience DESC, updated_at DESC` LIMIT `?`. (Salience bar passed in.)
- **`markAsked(ids)`** — set `asked_at = now` for the given ids (transaction, like
  `markReferenced`).
- Last-visit uses the existing `memory_meta` via `getMeta`/`setMeta` under key
  `last_visit:{slug}`.

### Engine (`data/memory-engine.js`)

- **`decideThresholdMode(lastVisitTs, threads, now)`** — pure function returning
  `'reunion' | 'gentle' | 'none'` per §3. No DB, fully unit-testable. Constants
  `REUNION_GAP_DAYS=2`, `THRESHOLD_SALIENCE_BAR=3`, `REUNION_MAX_THREADS=3` live
  here.
- **Prompt builders** (pure, exported for test): `buildGreetingPrompt(mode,
  threads, gapDays)` and `buildReplyPrompt(threads, answer)`.
- **`captureThresholdAnswer(slug, answer, threadIds, callLLM)`** — builds an
  attribution prompt (here are the threads by id + the user's answer; decide
  UPDATE status / ADD new), parses via the existing `parseExtractorOutput`, and
  applies via `store.applyOps(slug, ops, 'threshold', null)`. For any thread the
  ops mark `resolved`, create a `resolves` link from the new outcome atom (best
  effort). Returns the applyOps result. Swallows LLM errors like
  `captureFromReading` (returns `{...,error}` rather than throwing).
- The engine exposes thin pass-throughs as needed (`getOpenUnaskedThreads`,
  `markAsked`) so `server.js` talks only to the engine, not the store directly
  (consistent with how recall/capture are exposed today).

### Endpoints (`server.js`)

- **`GET /api/threshold?reader=<slug>`**
  1. resolve slug (same default logic as other endpoints),
  2. `threads = memory.getOpenUnaskedThreads(slug, REUNION_MAX_THREADS)`,
  3. `lastVisit = memory.getMeta('last_visit:'+slug)`,
  4. `mode = decideThresholdMode(lastVisit, threads, now)`,
  5. if `mode==='none'` → return `{ mode:'none' }` (and still update last_visit),
  6. else generate the greeting (Sonnet) for the chosen threads (1 for gentle, ≤3
     for reunion); on LLM failure → return `{ mode:'none' }` (no wooden reunion),
  7. `memory.markAsked(shownIds)`, `memory.setMeta('last_visit:'+slug, now)`,
  8. return `{ mode, greeting, threadIds: shownIds }`.
- **`POST /api/threshold/answer`** — body `{ reader, answer, threadIds }`:
  1. generate the reply beat (Sonnet) from the answer + those threads; on failure
     fall back to a short warm generic line,
  2. `memory.captureThresholdAnswer(slug, answer, threadIds, callLLM)` (best
     effort; logged on failure),
  3. return `{ reply }`.

Both endpoints wrap their work so a failure degrades gracefully and never 500s the
app open. `GET` marks asked + updates last_visit **only when it actually shows
something** (mode reunion/gentle); for `none` it still updates last_visit.

**Show-time marking trade-off (resolved):** threads are marked `asked_at` when
shown, not when answered. This honors "never re-ask the same thread" and keeps
rotation simple; the cost is that a surfaced-but-ignored thread won't return. Per
Matt this is acceptable. (A future refinement could re-surface an unanswered
thread once; out of scope.)

---

## 7. Frontend (`public/app.js`, `public/style.css`)

- In `init()`, **before `buildGreeting()`**, `await` `GET /api/threshold`.
  - `mode==='reunion'` → render the **cinematic takeover** reusing the existing
    Miriel's-Choice overlay styling: the greeting text, one reply field, a single
    "Continue" action (and a quiet "Not now"). On submit → `POST
    /api/threshold/answer` → reveal her reply beat in the same overlay → a final
    "Begin" dismisses into the app.
  - `mode==='gentle'` → augment the existing `greeting-panel` with the surfaced
    thread line + a reply field; submit posts the answer, then proceeds.
  - `mode==='none'` (or any fetch error) → call `buildGreeting()` as today.
- The reunion overlay suppresses the default greeting panel (don't show both).
- Animation covers greeting-generation latency (the takeover fades in while the
  request is in flight; render text when it lands; on failure, fall through to the
  normal greeting).

No change to the reading, journal, daily-card, compatibility, or notebook flows.

---

## 8. Error handling

- **LLM offline / greeting generation fails** → `mode:'none'`; normal greeting.
  We never fabricate the reunion from a template (a wooden "the moon has turned"
  would cheapen the moment).
- **Answer capture fails** → the exchange still completes; reply beat falls back to
  a short warm generic line if its own generation also failed; threads remain
  marked asked; logged, not surfaced to the user.
- **`/api/threshold` unreachable** → frontend catches and shows the normal
  greeting. App open never blocks on the Threshold.
- All new DB reads are slug-scoped (no cross-reader bleed), consistent with
  Phase 1.

---

## 9. Testing

**Unit (node:test, tmpdir, LLM mocked):**
- `decideThresholdMode`: reunion when gap≥2d & threads present; gentle when gap<2d
  & threads; none when no threads; none when lastVisit null + ... (define: a
  first-ever visit with threads from backfill → treat as reunion? **Decision:**
  null last_visit counts as a large gap → `reunion` if qualifying threads exist).
- `getOpenUnaskedThreads`: excludes `asked_at` set, excludes resolved/dormant,
  excludes below salience bar, excludes non-thread types, respects limit & order.
- `markAsked`: sets `asked_at`; a subsequently-fetched thread is excluded.
- migration: `asked_at` added on an existing db built without it; idempotent on
  re-open; fresh db already has it.
- `captureThresholdAnswer`: mocked extractor ops → threads updated to
  resolved/moving, new atoms added, all `source_kind='threshold'`; `resolves` link
  created for resolved threads; LLM throw → `{...,error}`, nothing persisted on
  unparseable output.
- prompt builders: include the gap and the thread contents; deterministic.

**Manual smoke (project convention — server.js untested by suite):** drive a real
return: seed an open thread, set `last_visit` to 3 days ago, hit `GET
/api/threshold` (expect reunion + greeting naming the thread), `POST .../answer`
(expect reply + the thread resolved/updated with a `threshold` atom), reload
(expect `none` — thread now asked).

---

## 10. Key decisions (resolved)

1. **Option B (cinematic reunion)** for the gap case; **gentle inline ask** for
   quick returns; **none** otherwise.
2. **Two-beat**: she responds to your answer before the reading.
3. **Up to 3 threads, salience-gated** at reunion; 1 at gentle; rotate via
   `asked_at`; never re-ask.
4. **Gap threshold = 2 days**; **null last_visit = reunion** (first visit after
   backfill is itself a reunion).
5. **Sonnet for greeting + reply, Haiku for capture.**
6. **Mark asked on show**, not on answer.
7. **No template reunion when LLM is down** — fall back to the normal greeting.
8. `asked_at` as a **new nullable column** with a guarded migration (not a
   meta-set or status overload).

---

## 11. Open questions

None blocking. In-reading curiosity (the "is your sister still upset?" mid-reading
moment) is deferred to its own spec and will reuse this spec's
`captureThresholdAnswer`/attribution machinery and prompt-builder patterns.
