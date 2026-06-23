# Miriel Memory Engine — Design Spec

**Date:** 2026-06-13
**Status:** Approved direction, pre-implementation
**Author:** Matt + Claude (brainstorming session)

---

## 1. Vision

Make Miriel a reader who *knows you* — with enough depth and continuity that a
reading feels less like a generated interpretation and more like being seen by
someone who remembers your life. The emotional target: **"how did she know
that?"** plus **"I want to come back and tell her what happened."**

This is the differentiator. Almost no tarot app on the market has any memory at
all; the AI ones do single-shot readings. A reader who accumulates a real,
specific, outcome-aware memory of you — and whose knowledge of you visibly
deepens over time — is a category-defining moat and the core retention hook.

Three experiences ride on this, and all three are just different readers/writers
of one thing — *what Miriel knows about you*:

- **A — Living memory + outcome loop:** she remembers specifics and learns what
  came true ("last spring the Tower pointed at that job — and here you are").
- **B — Talking back:** within a reading you can respond, and that deepens her.
- **C — The Threshold:** when you return, she greets you across the gap — "I'm
  glad you came back; I've been wondering about something" — which is also the
  warm, non-spammy home for the outcome question.

**This spec covers the foundation that all three require: the Memory Engine.**
A, the Threshold (C), and conversation (B) are later phases that become small,
clean additions once this exists.

---

## 2. The problem with today's design

Miriel's current memory is `data/profiles/{slug}.json`: a single blob of LLM
prose, re-synthesized from scratch every 5–10 readings (`data/reader-profile.js`),
derived **only from reading history** (cards, questions, Miriel's own synopsis).

Four ceilings, each of which is exactly what separates "nice AI tarot app" from
"she's psychic":

1. **She only knows your cards, not your life.** Everything you *say* (beyond the
   one-line `question`) evaporates after the reading. The richest signal is lost.
2. **No outcome loop.** She never learns what came true, so the single most
   uncanny move a real reader makes is impossible.
3. **Memory is a summary, not a memory.** Each refresh re-summarizes from
   scratch, so fine detail is averaged away instead of accumulating. Intimacy
   lives in specifics.
4. **She dumps everything, recalls nothing.** The whole blob is pasted in every
   time; she never reaches for *the one relevant thing* for this question. With a
   long history the perfect callback gets buried.

The root cause of all four is the data structure: **a summary is the wrong shape
for memory.** The fix is to store memory as discrete, structured, accumulating
pieces.

---

## 3. Architecture overview

A **Memory Engine** with four layers, built on the SQLite already in the project
(`better-sqlite3` is wired in via `data/interpretation-cache.js` — no new native
dependency, no ABI risk).

```
                       ┌─────────────────────────────┐
   reading saved  ───► │ 1. CAPTURE                   │
   (POST /readings)    │   extract atoms (Haiku),     │
   [later: checkin,    │   ADD/UPDATE/TOUCH ops       │
    threshold, convo]  └──────────────┬──────────────┘
                                      ▼
                       ┌─────────────────────────────┐
                       │ 2. STORE   (data/memory.db)  │
                       │   memories + memory_links    │◄── one-time BACK-FILL
                       │   source of truth            │    from existing readings
                       └──────────────┬──────────────┘
                                      ▼
   reading starts  ───► ┌─────────────────────────────┐
   (POST /interpret)    │ 3. RECALL                    │
                        │   score → top 3–5 relevant   │
                        │   → persona injection block  │
                        └──────────────┬──────────────┘
                                      ▼
                       ┌─────────────────────────────┐
                       │ 4. SYNTHESIS (derived view)  │
                       │   notebook / story-so-far    │
                       │   assembled from atoms       │
                       └─────────────────────────────┘
```

The atoms are the source of truth. The existing prose profile becomes a
*derived view*, not the master record.

---

## 4. Data model

New database: **`data/memory.db`**, separate from `interpretations.db`.

Rationale for a separate file: `interpretations.db` is a *regenerable cache*
(disposable). Memory is *irreplaceable user data* — different lifecycle, different
backup posture. Keep them apart. (Add `memory.db` to the same backup discipline
as `tarot-release-key.jks`.)

### `memories`

| column               | type    | notes                                                              |
|----------------------|---------|-------------------------------------------------------------------|
| `id`                 | INTEGER | PK, autoincrement                                                 |
| `reader_slug`        | TEXT    | every query is scoped by this; never cross readers                |
| `type`               | TEXT    | `person` · `thread` · `event` · `feeling` · `prediction` · `fact` · `preference` |
| `content`            | TEXT    | the atom in plain language ("the job interview she was anxious about") |
| `status`             | TEXT    | `open` · `moving` · `resolved` · `dormant`; NULL for static facts |
| `salience`           | INTEGER | 1–5, how central; keeps trivia from crowding out what matters     |
| `subject`            | TEXT    | optional entity this is about (a person/topic), for grouping      |
| `source_kind`        | TEXT    | `reading` · `checkin` · `threshold` · `conversation` · `backfill` |
| `source_id`          | TEXT    | e.g. the reading `id`                                              |
| `created_at`         | INTEGER | unix seconds                                                      |
| `updated_at`         | INTEGER | unix seconds                                                      |
| `last_referenced_at` | INTEGER | when recall last surfaced it                                      |
| `reference_count`    | INTEGER | how often Miriel has reached for it                               |

Indexes: `(reader_slug)`, `(reader_slug, type)`, `(reader_slug, status)`,
`(reader_slug, salience)`.

### `memory_links`

| column     | type    | notes                                         |
|------------|---------|-----------------------------------------------|
| `from_id`  | INTEGER | memory id                                     |
| `to_id`    | INTEGER | memory id                                     |
| `relation` | TEXT    | `relates` · `resolves` · `contradicts` · `about` |

PK `(from_id, to_id, relation)`. Lets a `resolved` outcome point back at the
`prediction`/`thread` it closed — the spine of the outcome loop.

### `memory_meta`

Small key/value table for engine bookkeeping (e.g. `backfilled:{slug} = 1`,
schema version). Keeps back-fill idempotent without scanning.

### Status lifecycle (threads & predictions)

```
open ──► moving ──► resolved
  └──────────────► dormant   (faded, not resolved; recall de-prioritizes)
```

Phase 1 sets `open`/`moving` at capture. `resolved` transitions are *authored* by
the Threshold/outcome loop in phase 2 — but the column and the `resolves` link
exist now so phase 2 adds no schema change.

---

## 5. Capture flow

**Trigger:** `POST /api/readings`, immediately after `appendReading(...)`
(`server.js:257`). Fire-and-forget (async, never blocks the response), mirroring
how `refreshReaderProfile` is already called there.

**Input to the extractor:**
- the reading just saved (`question`, `cards`, `synopsis`, `spread`, `date`)
- the reader's current **open + high-salience** memories (so the model can update
  existing atoms instead of duplicating them)

**Model:** Haiku (`claude-haiku-4-5-20251001`) via `callLLM(...)` — cheap, and
already the model used for `/api/clarify`.

**Output contract — a list of operations, not a fresh summary:**

```
ADD     {type, content, status?, salience, subject?}
UPDATE  {id, content?, status?, salience?}      // refine/append detail, change status
TOUCH   {id}                                     // seen again, bump reference_count
```

This op-based contract is what makes memory *accumulate* rather than reset:
recurring material updates an existing atom; genuinely new material adds one;
nothing is re-summarized from zero.

**Extraction discipline (anti-hallucination — critical):**
- Record only what is *explicitly present* in the reading or the querent's words.
- Inferences allowed but marked low salience (1–2) and phrased tentatively.
- Never invent names, dates, or events. When in doubt, omit.

Parsing reuses the labelled-block + `JSON.parse` approach already proven in
`reader-profile.js` (`extract`/`extractJSON`). If parsing fails, **apply
nothing** — never persist a degraded result (same guard as the existing
`if (!profile.miriel_notes) return;`).

> Phase 1 capture sources: `reading` and `backfill`. The `checkin`, `threshold`,
> and `conversation` sources use the *identical* op contract — they're new
> callers in later phases, not new machinery.

---

## 6. Recall flow

**Trigger:** `POST /api/interpret`, replacing the recurring-card dump inside the
persona assembly at `server.js:587`.

**`recall(slug, { question, cards })` → `{ memories, block }`**

**Selection — deterministic scorer, no LLM on the critical path** (decision: see
§11). Gather candidates (open threads, high-salience atoms, atoms whose `subject`
or `content` overlaps the question keywords or the drawn card names, recently
referenced atoms), then score each:

```
score =  2.0 * salience_normalized
       + 1.5 * (status == open ? 1 : status == moving ? 0.6 : 0)
       + 1.5 * keyword_overlap(question + card_names, content + subject)
       + 0.5 * recency_decay(last_referenced_at)   // mild; favors fresh recall
       - 0.4 * overexposure(reference_count)        // avoid repeating the same line every time
```

Take the top **3–5**. Format into a persona-injection block, framed so Miriel
holds them lightly rather than reciting a file:

> *"Things you remember about this person, that may bear on what's in front of
> you now — hold them lightly, bring them in only if the cards genuinely point
> there: …"*

Then `markReferenced(ids)` (bump `last_referenced_at`, `reference_count`).

**Why deterministic, not an LLM rerank, in phase 1:** keeps `/api/interpret`
latency and cost unchanged, makes recall **testable and reproducible**, and is
plenty given open-thread priority + salience + keyword/card overlap. An optional
Haiku rerank for large candidate sets is a clean phase-1.5 enhancement behind a
flag — it changes ranking only, not the schema or the contract.

**Resilience:** recall must never break a reading. Empty store → empty block →
interpret behaves exactly as today. Any error in recall is caught and degrades to
the empty block.

---

## 7. Synthesis (derived view)

The "Your Story So Far" notebook overlay currently reads the prose profile
(`miriel_notes`, `recurring_cards`, `life_arc`). Phase 1 keeps that working with
**minimal disruption**:

- `reader-profile.js` continues to produce the prose profile as today (harmless,
  feeds the notebook). It is no longer Miriel's *only* memory — recall is now the
  precise layer; the prose is ambient "general sense of this person."
- The recall block and the prose notes **coexist** in the persona: prose = broad
  sense, recall = specifically-relevant-now. Low risk, additive.

Migrating the notebook/story view to render directly from atoms (a true timeline
of the relationship) is **phase 2**, alongside the Threshold. `listMemories(slug,
filter)` is provided now so that view has its data source ready.

---

## 8. Back-fill (one-time migration)

So Matt (real history) doesn't start from zero.

`backfill(slug, loadReadings, callLLM)`:
- Runs once per reader; guarded by `memory_meta` `backfilled:{slug}`.
- Iterates existing readings in **chunks** (e.g. 10–15 at a time) through the same
  Haiku extractor, applying ADD ops with `source_kind='backfill'`.
- Bounded cost: ≤ 200 readings (the `appendReading` cap) → a handful of Haiku
  calls, one time, ever.
- Idempotent and resumable: set the meta flag only after a full successful pass;
  partial failure leaves the flag unset and is retried next start.

**When:** lazily, like `migrateIfNeeded()` at startup — but run async/deferred so
it never delays server boot or the first request. If a reading is captured before
back-fill finishes, no harm: both append to the same store.

---

## 9. New module & integration points

### New file: `data/memory-engine.js`

Factory mirroring `interpretation-cache.js` (`createX(dataDir)` returning bound
functions over prepared statements):

```js
module.exports = function createMemoryEngine(dataDir) {
  // opens data/memory.db, CREATE TABLE IF NOT EXISTS ...
  return {
    captureFromReading(slug, reading, callLLM),   // async; extract + apply ops
    recall(slug, { question, cards }),            // { memories, block }
    markReferenced(ids),
    backfill(slug, loadReadings, callLLM),        // async; one-time per slug
    listMemories(slug, filter),                   // for notebook/story view
    applyOps(slug, ops, source),                  // internal, also unit-tested
    getStats(slug),                               // counts by type/status (debug)
  };
};
```

### Touch points in `server.js` (small, surgical)

| location | change |
|----------|--------|
| top (with other `require`s, ~line 17) | `const memory = require('./data/memory-engine')(DATA_DIR);` |
| `migrateIfNeeded()` / startup | kick off deferred `memory.backfill(...)` per reader if not yet done |
| `POST /api/readings` (~line 257) | after `appendReading`, fire-and-forget `memory.captureFromReading(slug, reading, callLLM)` |
| `POST /api/interpret` (~line 587) | `const { block } = await memory.recall(slug, { question, cards })` and append `block` to the persona (alongside existing `buildPersonaWithProfile`) |

No existing endpoint changes shape. No frontend change required in phase 1 (the
win is invisible-but-felt: readings get more specific).

---

## 10. What phase 1 ships (scope)

A true end-to-end vertical slice:

- ✅ `memory.db` schema (`memories`, `memory_links`, `memory_meta`)
- ✅ `data/memory-engine.js` with the API above
- ✅ Capture from `POST /api/readings` (op-based, accumulating, anti-hallucination)
- ✅ One-time back-fill from existing readings
- ✅ Deterministic recall injected into `POST /api/interpret`
- ✅ Outcome-loop **data model** in place (status lifecycle + `resolves` links)
- ✅ Tests (see §12)
- ✅ **Visible win even now:** readings reach for the right specifics instead of
  dumping a blob.

### Explicitly OUT of scope for phase 1 (deferred, by design)

- ❌ The Threshold UI / greeting on return (phase 2)
- ❌ Author-side `resolved` transitions / the "did this happen?" exchange (phase 2)
- ❌ Pre-reading check-in & post-reading reflection capture UI (phase 2)
- ❌ Conversational/talk-back readings (phase 3)
- ❌ Notebook/story view rendered from atoms (phase 2)
- ❌ LLM rerank of recall candidates (phase 1.5, optional)
- ❌ Semantic/embedding recall (future; schema already supports adding it)

---

## 11. Key decisions (resolved)

1. **Separate `memory.db`, not a table in `interpretations.db`** — precious data
   vs. disposable cache; different lifecycle and backup posture.
2. **Op-based capture (ADD/UPDATE/TOUCH), not re-summarization** — this is the
   mechanism that makes memory accumulate; it's the whole point.
3. **Deterministic recall in phase 1, no LLM on the interpret critical path** —
   *(changed from the initial "cheap Haiku selection pass" idea during write-up)*
   for unchanged latency, no added cost, and reproducible/testable ranking. LLM
   rerank is a later optional refinement, ranking-only.
4. **Recall augments, does not replace, the existing prose profile** — minimal
   disruption; prose = broad sense, atoms = precise now.
5. **Haiku for capture/back-fill** — cheap; capture is async post-save so latency
   is irrelevant.
6. **Everything scoped by `reader_slug`** — no cross-reader bleed.

---

## 12. Testing strategy

Follow the project's existing test harness (currently green at 32/32). Use a
temp `DATA_DIR` so tests get a throwaway `memory.db`.

- **Store unit tests:** add/query atoms; `applyOps` correctly performs ADD vs.
  UPDATE vs. TOUCH; links created and queried; meta flag gates back-fill.
- **Capture tests:** feed a mocked extractor output (fixed op JSON) → assert the
  resulting store state. Assert the degraded-parse guard persists nothing.
- **Recall tests (deterministic — easy to assert):** seed atoms with known
  salience/status/keywords → assert which top-N are selected and in what order;
  assert empty store → empty block → interpret unaffected; assert `markReferenced`
  bumps counters.
- **Back-fill tests:** idempotency (second run is a no-op via meta flag); partial
  failure leaves flag unset.
- **Integration:** `POST /api/readings` triggers capture without blocking the
  response; `POST /api/interpret` includes the recall block when atoms exist.

LLM calls are mocked in tests — no network, deterministic.

---

## 13. Risks & mitigations

| risk | mitigation |
|------|------------|
| Extractor records a false "fact" → Miriel asserts it confidently → creepy/wrong | Conservative extraction (explicit-only); low salience for inferences; recall framing tells her to hold memories lightly and only use if cards point there |
| Duplicate / contradictory atoms pile up | UPDATE/TOUCH ops + `contradicts` link; periodic compaction is a later concern, not phase 1 |
| Added latency on `/api/interpret` | recall is deterministic, in-process, no LLM call |
| Cost creep | Haiku only; capture async post-save; back-fill one-time and bounded |
| Privacy — memory is intimate personal data | local-first; `memory.db` never leaves the machine except as LLM context to the *already-configured* provider (Claude/Ollama); add to backup discipline |
| Recall bug breaks a reading | fully wrapped; any failure → empty block → today's behavior |

---

## 14. Phases beyond this spec (for context only)

- **Phase 2 — The Threshold + outcome loop (the visible "wow"):** on return,
  Miriel greets across the gap, surfaces one `open` thread, asks what came of it;
  the answer is captured (`source_kind='threshold'`) and can mark the thread
  `resolved` via a `resolves` link. Notebook/story view re-rendered from atoms.
- **Phase 3 — Talking back:** extend `/api/clarify` into threaded in-reading
  dialogue; harvest atoms from the conversation (`source_kind='conversation'`).

Both are additions on top of this foundation — same store, same op contract, same
recall.

---

## 15. Open questions

None blocking. Phase-2 UX details (exact Threshold copy, how often to ask an
outcome question, check-in placement in the ritual) are deferred to that phase's
own brainstorm.
