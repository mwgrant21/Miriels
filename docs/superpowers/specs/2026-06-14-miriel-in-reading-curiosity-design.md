# Miriel In-Reading Curiosity — Design Spec (Phase 3)

**Date:** 2026-06-14
**Status:** Approved direction, pre-implementation
**Builds on:** Phase 1 (memory engine) and Phase 2 (Threshold), both shipped & merged.
**Author:** Matt + Claude (brainstorming session)

---

## 1. Vision

As the cards are laid — at a human pace, like a hand drawing them — Miriel
sometimes gets *stopped* by a card. It pulls at something she remembers, and she
pauses on it, mid-deal, to ask: *"The Moon, here… wait — this pulls me somewhere
else. Is your sister still upset with you?"* You answer; she takes it in; and the
reading that follows is shaped by what you told her.

This is the most "she's actually reading *me*" moment in the app — cold-reading
made real, because she genuinely remembers. It's the third expression of the
memory engine, after the Threshold's reunion. Where the Threshold fires on
*return*, curiosity fires *inside a reading*, triggered by a specific card.

---

## 2. Scope

**In scope:** detecting when a drawn card genuinely resonates with a remembered
open thread; pausing the deal on that card to ask; capturing the answer into
memory; and feeding the answer into the interpretation so the reading reflects it.
Plus the human-paced deal that makes the pause read as "she got stopped."

**Out of scope:** changes to the core single-shot interpretation generation
(we feed it context, we don't restructure it); the Threshold (done); compatibility
readings (curiosity applies to normal `/api/interpret` readings only).

---

## 3. Behavior

### 3.1 The paced deal
Cards are laid at a human rhythm rather than all at once:
- **~2s between cards**, with **±~250ms jitter** so it never feels metronomic.
- **Soft total cap ~14s**: `perCardMs = clamp(1100, 2000, round(14000 / n))` where
  `n` is the card count. So 1–7 card spreads get the full ~2s/card; a 10-card
  Celtic Cross tightens to ~1.4s/card (~14s total). The cap prevents drag while
  keeping the hand-dealt feel.
- This extends the **existing** deal-from-pile animation (`autoReveal`,
  `SHUFFLE_MS`/`DEAL_INTERVAL`/`DEAL_FLIP_DELAY`), it does not replace it.

### 3.2 The curiosity pause
When a card that the detector flagged is laid, the cadence **breaks**:
- that card **glows and lifts moderately**; the rest of the spread **dims to ~55%**;
- a **thin thread of light** connects it to a **calm, centered panel** that names
  the card and holds the question (the blended UI chosen in brainstorming);
- the question is phrased as an interruption of her own reading ("…wait — this
  pulls me somewhere else.");
- the pause lasts until the querent **answers or skips** (a visible 3–4s minimum
  glow even if they're fast, so it reads as a genuine beat);
- then the deal **resumes** with the remaining cards.

### 3.3 Frequency & triggering
- **0–2 questions per reading, only when genuinely warranted.** Most readings have
  **none.** The detector is instructed to be conservative — a real, striking
  resonance, not a forced connection.
- A card may pull toward **any open thread it resonates with**, **biased toward the
  striking / less-obvious (off-topic) connections** while still allowing a natural
  on-topic follow-up. Naturally mixed, never formulaic.
- Only **open/moving, un-asked** threads (salience ≥ 3) are candidates — reusing the
  Threshold's `asked_at` gate, so she never raises something she's already raised.

### 3.4 After the answer
- The answer is **captured to memory** (resolve/update/add, `source_kind:'curiosity'`)
  and the thread is **marked asked** (so neither curiosity nor the Threshold
  re-raises it).
- The answer is **folded into the interpretation**: the reading is generated *after*
  the deal, with the curiosity Q&A passed in as context, so it genuinely "fleshes
  out the rest of the reading."
- **Skip** → deal resumes, nothing captured, but the thread is **still marked asked**
  (mark-on-show, consistent with the Threshold — she won't nag).

---

## 4. Architecture

The reading already works in two stages on the frontend: **deal/reveal**
(`autoReveal`) then **interpret** (`askClaude` → `POST /api/interpret`). Curiosity
slots between them, and the deal becomes interruptible.

```
drawCards()
  → determine drawnCards (instant, as today)
  → brief "she considers the cards" beat (covers detection latency)
  → POST /api/reading-questions  ──► detector (Haiku): 0–2 {cardId, question, threadIds}
                                     marks those threads asked (mark-on-show)
  → paced async deal loop:
        for each card: wait perCardMs(±jitter); flip + reveal
        if card is a trigger: PAUSE (glow/dim/panel) → await answer|skip
  → askClaude(curiosityAnswers)  ──► POST /api/interpret (answers folded into prompt;
                                     fire-and-forget captureAnswer source_kind 'curiosity')
```

**Why this shape:** detection runs once, up front, so we know *which* card stops
her before the deal reaches it; the deal pause is pure frontend sequencing; the
interpretation stays single-shot and merely receives context. No core-reading
rebuild.

---

## 5. Components

### 5.1 Engine (`data/memory-engine.js`)
- **`buildCuriosityPrompt(cards, threads)`** (pure, exported) — renders the spread
  (name, position, orientation) and the querent's candidate open threads
  (`#id content`), and asks the model to return **only** genuinely striking
  resonances. Output contract:
  ```json
  {"questions":[
    {"card_id":"major-18","question":"one sentence in Miriel's voice, phrased as a mid-deal pause","thread_ids":[7]}
  ]}
  ```
  Rules in the prompt: 0–2 max; conservative (usually `[]`); favor the
  striking/less-obvious; one sentence; reference the specific card; never invent.
- **`parseCuriosityOutput(raw)`** (pure, exported) — tolerant JSON extraction (same
  approach as `parseExtractorOutput`), returns the `questions` array or `[]`.
- **`detectCuriosity(slug, cards, callLLM)`** (factory method, async) — gathers
  candidate threads via `store.getOpenUnaskedThreads(slug, 8, THRESHOLD_SALIENCE_BAR)`;
  if none, returns `[]` **without** an LLM call; else calls Haiku with
  `buildCuriosityPrompt`, parses, and returns validated triggers (drop any whose
  `thread_ids` don't exist or whose `card_id` isn't in the drawn spread). Swallows
  LLM errors → `[]`.
- **Generalize capture:** rename the Phase-2 internal to `captureAnswer(slug, answer,
  threadIds, callLLM, sourceKind = 'threshold')`; keep `captureThresholdAnswer` as a
  thin wrapper (`captureAnswer(..., 'threshold')`) so the Threshold is untouched.
  Curiosity calls `captureAnswer(..., 'curiosity')`.
- Reuse existing `getOpenUnaskedThreads`, `markAsked`, `applyOps` (with the `RESOLVE`
  op), `parseExtractorOutput`, `THRESHOLD_SALIENCE_BAR`.

### 5.2 Server (`server.js`)
- **`POST /api/reading-questions`** — body `{ reader, cards:[{id,name,position,isReversed}] }`.
  Resolves slug; `const qs = await memory.detectCuriosity(slug, cards, callLLM)`;
  `memory.markAsked(qs.flatMap(q => q.threadIds))`; returns `{ questions: qs }`.
  Wrapped so any failure returns `{ questions: [] }` (a reading must never break).
  Detection uses Haiku via `callLLM(system, prompt, 500, 'claude-haiku-4-5-20251001')`.
- **`POST /api/interpret`** — accept an optional `curiosityAnswers: [{question, answer,
  threadIds}]`. When present and non-empty:
  - build a context block and append it to the prompt (after the existing
    `memoryBlock`), e.g. *"As the cards were laid, you paused and asked: '…'; they
    answered: '…'. Let what they shared genuinely shape this reading."*
  - fire-and-forget `memory.captureAnswer(slug, a.answer, a.threadIds, callLLM,
    'curiosity')` for each answered item (skip empty answers).
  No other change to interpret; recall (Phase 1) and persona assembly stay as-is.

### 5.3 Frontend (`public/app.js`, `index.html`, `style.css`)
- **Refactor `autoReveal` into an async, interruptible deal** (`dealAndReveal()`):
  sequential `await delay(perCardMs ± jitter)` per card; reveal each; at a trigger
  index, `await curiosityPause(trigger)`; after all cards, a short beat, then
  `askClaude(curiosityAnswers)`. The current all-timeouts-up-front scheduling is
  replaced for the auto-draw path; `cancelRevealTimers`/new-draw cancellation must
  still abort an in-flight deal (use an incrementing "deal token" checked across
  awaits).
- **Up-front detection:** at the start of `drawCards` (auto path), after the spread
  is rendered face-down and the shuffle beat begins, fire `POST /api/reading-questions`
  with the drawn cards and `await` it before the loop reaches any card (the shuffle
  beat covers it). On failure/empty → normal deal.
- **`curiosityPause(trigger)`** — apply glow/lift to the trigger card, dim others,
  render the centered panel (`#curiosity-panel`, reuses the blended styling) with the
  question + answer field + Answer/Skip; resolve on submit (capture the typed answer
  into the `curiosityAnswers` array) or skip; enforce a 3–4s minimum visible beat;
  restore card styling on resume.
- **Pass `curiosityAnswers`** into the `/api/interpret` payload in `askClaude`.
- `index.html`: add the `#curiosity-panel` markup. `style.css`: the blended pause
  styles (moderate glow/lift, ~55% dim on `.dealt-card` siblings, thread-of-light,
  centered panel).
- New reader / no open threads / detection empty → **today's exact behavior** (no
  detection call when there are no candidate threads).

---

## 6. Error handling
- Detection endpoint failure or LLM error → `{ questions: [] }` → normal deal. A
  reading is **never** blocked by curiosity.
- Capture failure → fire-and-forget, logged, not surfaced.
- If a new draw starts mid-pause, the deal token invalidates the pending pause and
  the overlay is dismissed.
- All new reads slug-scoped (no cross-reader bleed), consistent with Phases 1–2.

---

## 7. Testing
**Unit (node:test, tmpdir, LLM mocked):**
- `buildCuriosityPrompt`: includes each card (name/position) and the candidate
  threads (`#id`); instructs 0–2 / conservative / striking-bias.
- `parseCuriosityOutput`: clean object, prose-wrapped, bare array fallback, garbage → `[]`.
- `detectCuriosity`: no candidate threads → returns `[]` and makes **no** LLM call
  (assert via a throwing mock that is never invoked); with a mock returning a valid
  trigger → returns it; drops triggers referencing unknown thread_ids or cards not in
  the spread; LLM throw → `[]`.
- `captureAnswer`: `sourceKind:'curiosity'` lands on the added atoms; RESOLVE still
  resolves + links; `captureThresholdAnswer` wrapper still writes `'threshold'`.

**Manual smoke (frontend untested by suite, per project convention):** seed an open
thread that a card will resonate with; draw a spread containing that card; verify the
deal paces (~2s/card, jitter), the trigger card glows and the deal pauses, the
question names the card, answering captures to memory (`source_kind:'curiosity'`,
thread resolved/asked) and the subsequent reading reflects the answer; verify skip
resumes and marks asked; verify a reader with no threads deals normally with no pause.

---

## 8. Key decisions (resolved)
1. **Approach A** (detect up front, fold answer into the single-shot reading) with a
   **B-flavored deal pause** for the "stopped mid-deal" feel — no core-reading rebuild.
2. **Paced deal:** ~2s/card, ±250ms jitter, soft cap ~14s (`clamp(1100,2000,14000/n)`).
3. **0–2 questions, conservative;** any resonant open thread, biased to striking/off-topic.
4. **Blended card-anchored UI:** moderate glow/lift, others ~55% dim, thread of light,
   calm centered panel naming the card; "wait —" interruption phrasing; 3–4s min beat.
5. **Mark asked on show** (skip still marks); reuse `asked_at` so curiosity & Threshold
   never double-ask.
6. **Capture generalized** to `captureAnswer(..., sourceKind)`; curiosity = `'curiosity'`.
7. **Detection = Haiku, up front, only when candidate threads exist;** empty/failed →
   normal deal.
8. **Interpretation stays single-shot;** curiosity answers are appended context only.

---

## 9. Open questions
None blocking. Future polish (not this spec): a faint sound cue on the pause; letting
a curiosity answer optionally trigger a follow-up clarifier card.
