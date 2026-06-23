# Miriel's Voice & Presence (Depth-Scaled) Design Spec

**Date:** 2026-06-20
**Status:** Approved (design), pending implementation plan
**App:** Miriel's Readings (web/Electron tarot app at `C:\Users\Matt\projects\tarot`)
**Builds on:** the memory engine + reader profile (`data/memory-engine.js`, `data/reader-profile.js`) and the shared `READER_PERSONA` in `server.js`.

## Summary

Make Miriel feel like a real oracle who sees into you — not a generated text
field. Two problems break the illusion today: (1) her prose carries LLM "tells"
and her in-the-moment reactions are formulaic (notably a near-identical "this
changes everything" whenever a clarifier/follow-up card is drawn), and (2) her
warmth doesn't grow as a relationship — a 75-reading returning seeker is greeted
much like a stranger.

This is a **voice & presence** project: persona/prompt craft plus a relationship-
depth warmth system and an anti-repetition fix. It is explicitly NOT about adding
new memory data — the recall engine already lands; the gap is how she *sounds*,
*reacts*, and *welcomes*. No schema changes.

## Decisions (locked during brainstorming)

- **Primary voice: uncanny / penetrating.** She names what you didn't say aloud,
  reads the pattern beneath the question, is sometimes a half-step ahead. She uses
  recalled memory as *perception* ("you keep circling this"), not recitation.
- **Warmth scales with relationship depth**, deepening the uncanniness rather than
  replacing it. By many readings she greets you like a long-known friend, glad
  you're back — the accuracy now reads as intimacy.
- **Relationship arc (warmth tiers):** First visit → Early (≈2–5) → Familiar
  (≈6–20) → Returning seeker (≈21–60) → Long-known (≈60+).
- **Anti-AI-tells voice:** no hedging, tidy summaries, rule-of-three, "on one
  hand/on the other," stock transitions, or over-explaining.
- **Reactive variety (clarifier fix):** her reaction to a follow-up card depends on
  what it actually does to the reading — confirm / deepen / complicate / overturn —
  never a stock "this changes everything," and not phrased the same way twice.

## Architecture (where it lives)

All in `server.js` and `data/reader-profile.js`. No new data, no schema change.

### 1. The persona voice — `READER_PERSONA` (server.js ~line 503)

Rewrite/extend the shared system prompt (used by every reading, daily card,
clarifier, suggest-spread, and greeting call) to encode:

- **Uncanny perception** — instructions to read beneath the literal question, name
  the unspoken, surface the pattern, occasionally be a step ahead; treat recalled
  memory as things she *perceives about you*, not facts she recites.
- **Anti-AI-tells** — an explicit "how you do NOT speak" block: no
  "it's important to remember," no summarizing recaps, no rule-of-three triads, no
  balanced "on one hand / on the other," no stock transitions ("this changes
  everything," "with this new card"), no over-explaining the obvious. She speaks
  like one specific person across a table.

This base is constant (relationship-independent). Warmth is layered separately.

### 2. Depth-scaled warmth — `data/reader-profile.js`

**Keep warmth tiers SEPARATE from the existing synthesis tiers.** `getTier()`
(thresholds 10/30) governs *what profile data gets synthesized* (`miriel_notes`,
`life_arc`) and must not change, or the synthesis cadence shifts. Add a new,
independent `getWarmthTier(readingCount)` with the 5-level arc above, used only to
color the voice.

Extend `buildPersonaWithProfile(basePersona, profile, readingCount, currentCards)`
so it always appends a **relationship note** keyed to the warmth tier — even at
First visit (a warm-but-new welcome), which currently returns the bare persona.
Each tier's note guides familiarity, how much shared history she assumes, and how
she greets/addresses. Profile-derived notes (`miriel_notes`, `life_arc`,
`recurring_cards`) continue to layer in **when available** (they only exist once
synthesis has run), so deeper tiers get both warmth guidance and real history.

Tier guidance (intent, not final copy — pinned in the plan):
- **First visit** — warm, welcoming curiosity; a perceptive stranger; no shared
  history claimed.
- **Early (≈2–5)** — beginning to recognize them; light familiarity.
- **Familiar (≈6–20)** — knows their recurring threads; references them naturally.
- **Returning seeker (≈21–60)** — warm familiarity, shared shorthand, inside
  references to past readings.
- **Long-known (≈60+)** — openly warm, glad they're back; doesn't re-establish
  herself; uncanny *because* she knows them.

### 3. The welcome — Threshold / reunion greeting

The greeting Miriel speaks on return is generated through the persona, so the
warmth tier flows into it automatically once `buildPersonaWithProfile` carries the
relationship note. Verify the greeting generation path uses the profile-aware
persona; if it uses only the bare `READER_PERSONA`, route it through
`buildPersonaWithProfile` so the welcome scales with depth.

### 4. Reactive variety — the clarifier/follow-up prompt (server.js ~line 893)

The current clarifier prompt already invites confirm/complicate/redirect, yet the
model (Haiku) defaults to a stock opening. Strengthen it:

- **Forbid stock transitions explicitly** (no "this changes everything," "this
  shifts everything," "with this card," etc.).
- **Ground the reaction in the actual relationship** — instruct her to first sense
  whether the card *confirms / deepens / complicates / overturns* the prior reading,
  and let that determine the response; a clarifier that merely confirms should read
  as quiet confirmation, not upheaval.
- **Anti-repetition** — discourage reusing her own recent phrasing; where feasible,
  pass the openings of recent clarifier responses (already stored with readings) so
  she avoids echoing them.
- The same anti-tell voice from the rewritten persona applies here (the clarifier
  uses `READER_PERSONA`), reinforcing variety.
- **Model consideration:** evaluate whether the clarifier should use a stronger
  model than Haiku for less formulaic prose; keep Haiku if the prompt changes
  suffice (cost-sensitive). Decide during implementation by comparing samples.

## Out of Scope

- New memory/recall data or schema changes (the engine is sufficient).
- The deeper "memory surfacing" feature set (a separate future project).
- Visual work (cross-fade transitions, phase-aware greeting copy) — tracked
  separately as a quick polish batch.
- Changing the synthesis tiers / cadence (`getTier`, `refreshReaderProfile`).

## How We Verify (prose isn't unit-testable)

- **Sample-output review:** generate greetings, a full reading, and clarifier
  reactions at simulated reading counts (first visit / mid ≈15 / long-known ≈75)
  and read them side by side — confirming warmth scales, voice reads as a person,
  and clarifier reactions vary by what the card does. A small dev script that calls
  the prompts with seeded profiles is acceptable.
- **Anti-repetition check:** draw several clarifiers in a row (or simulate) and
  confirm openings differ and none use the forbidden stock transitions.
- **Regression guard:** existing `node --test tests/*.test.js` stays green
  (105/105). Add focused unit tests for the pure logic: `getWarmthTier()` thresholds
  and that `buildPersonaWithProfile` emits the correct relationship note per tier
  (incl. First visit) and still layers profile notes when present.

## Success Criteria

- A first-time visitor gets a warm, perceptive welcome; a 60+ visitor is greeted
  like a long-known friend — clearly different, on the same install.
- Readings read like a specific perceptive person: no hedging, no tidy recaps, no
  rule-of-three, no stock transitions.
- Clarifier/follow-up reactions vary with what the card does and never reuse the
  "this changes everything" formula.
- `getWarmthTier` is independent of `getTier`; synthesis cadence unchanged.
- 105/105 existing tests pass; new tier-logic unit tests pass.
