# Richer In-Reading Recall Design Spec

**Date:** 2026-06-21
**Status:** Approved (design), pending implementation plan
**App:** Miriel's Readings (web/Electron tarot app at `C:\Users\Matt\projects\tarot`)
**Part of:** the Memory-Depth program (sub-project 3 of 4). Sub-projects 1 (temporal callbacks) and 2 (pattern recognition) are merged.
**Builds on:** the memory engine recall path (`data/memory-engine.js`: `recall`, `scoreMemory`, `RECALL_LIMIT`, `formatRecallBlock`) and `/api/interpret`.

## Summary

Make Miriel draw on what she knows about the querent more — and more *relevantly
and specifically* — during readings. Today her memory recall surfaces the wrong
mix (globally-salient over query-relevant), too few items, and frames them so
cautiously she rarely uses them or stays vague. This sub-project re-tunes recall
into a richer, relevance-led dossier and tells her to use it concretely, letting
the reading LLM do the final semantic selection. No new infrastructure, no extra
LLM call, no schema change.

## Problem (from the current code, accurately)

`recall(slug, {question, cards})` scores open+salient atoms with
`scoreMemory = 2.0·salience + 1.5·status + 1.5·overlap + 0.5·freshness − 0.4·overRef`,
keeps `score > 0`, takes the top **5**, and formats them under: *"Things you
remember… hold them lightly, and bring them in only if the cards genuinely point
there."* Consequences mapping to the felt gaps:
- **Misses the relevant bits:** salience weight (2.0) outranks query-overlap (1.5),
  so the 5 chosen skew to the person's *most salient* memories rather than those
  relevant to *this* question/spread.
- **Rarely brings up the past / too vague:** only 5 surface and the instruction
  actively discourages use ("only if the cards genuinely point there") and never
  asks for specificity.

Depth (older/resolved history) is explicitly NOT a target — the user is satisfied
there.

## Decisions (locked during brainstorming)

- **Dossier-first, LLM selects:** surface a richer, relevance-ranked set and let
  the interpret LLM (already reading the spread) choose what genuinely connects —
  no separate relevance call. (A dedicated LLM relevance pass is a possible later
  refinement, not now.)
- Address all three felt gaps: coverage, relevance, specificity.
- No embeddings/vector search; no capture/extraction changes; no schema change.

## Architecture (all in `data/memory-engine.js`)

1. **Relevance-led ranking** — rebalance `scoreMemory` so **query relevance
   (overlap) is weighted at least as high as raw salience**, so memories relevant
   to this question/cards rank into the surfaced set. Concretely: raise the overlap
   coefficient above the salience coefficient (exact values pinned in the plan,
   e.g. overlap 3.0 vs salience 1.5), keeping status/freshness/over-reference terms.
   Salience still matters as a tiebreaker and floor.

2. **More coverage** — raise `RECALL_LIMIT` from 5 to ~10 so relevant memories
   aren't crowded out by a few salient ones, and the reading LLM has a real set to
   select from. Keep the `score > 0` guard (drops resolved + irrelevant +
   over-referenced).

3. **Encourage concrete use** — rewrite `formatRecallBlock`'s framing from "hold
   lightly, bring in only if the cards point there" to something like: *"What you
   know about this person that may bear on what's in front of them. Draw on
   whatever genuinely connects to their question or these cards — and when you do,
   name it specifically (the actual moment or thread), not a vague gesture. Don't
   force in memories that don't fit."* This pairs with the anti-AI-tells persona
   (no recitation) — specific when relevant, silent when not.

4. **Light organization (optional, if it helps the LLM):** the block may group
   ongoing/open threads separately from one-off remembered facts so the LLM reads
   them clearly. Kept simple; no behavior depends on it.

The surfacing point (the `memoryBlock` appended in `/api/interpret`) is unchanged;
this only changes what recall selects and how it's framed. The pattern/temporal
blocks added in sub-projects 1–2 are separate and unaffected.

## Out of Scope

- A separate LLM relevance pre-pass (possible later refinement).
- Embeddings / semantic vector search.
- Capture/extraction changes; reader-profile changes.
- Depth recall of old/resolved history (not a user concern).
- Any schema change.

## How We Verify

- **Unit tests (TDD)** for the re-tuned scoring/selection (pure, deterministic):
  - a memory that overlaps the query ranks **above** a higher-salience memory that
    doesn't — proving relevance now leads;
  - `recall` returns up to the new limit (~10), and fewer when little exists;
  - resolved/irrelevant/over-referenced still excluded by `score > 0`;
  - `formatRecallBlock` emits the new framing and the memory contents.
- **Sample review (live):** run readings for a reader with varied history and a
  pointed question; confirm Miriel now references the *relevant* specific memory
  (not just her most salient one), names it concretely, and stays silent when
  nothing connects.
- **Regression:** `node --test tests/*.test.js` stays green; interpret behaves
  normally when recall returns nothing.

## Success Criteria

- For a question with genuinely relevant history, the relevant memory surfaces and
  Miriel names it specifically in the reading.
- She draws on memory noticeably more often than before (coverage), without
  info-dumping or forcing irrelevant memories.
- Relevance beats raw salience in ranking (proven by unit test).
- Full suite green; no schema change; no extra LLM call.
