# Dormant Thread Resurrection — Design

**Date:** 2026-06-26
**Status:** Approved (design); pending implementation plan
**Capability area:** Memory engine (the moat)

## Summary

Miriel notices a salient life-thread that was once active and has gone quiet for
a long stretch, and gently circles back to it in the Threshold greeting:

> "Before we turn the cards — you haven't spoken of the move since spring. Did it
> ever settle?"

This is the missing complement to the existing open-thread greeting. Today, once
an open thread is surfaced in a greeting, `markAsked` stamps `asked_at` and
`getOpenUnaskedThreads` (which filters `asked_at IS NULL`) never returns it again.
A thread mentioned once and then left quiet for months currently has **no path
back to the surface**. Dormant-thread resurrection restores that path.

## Behavioral decisions (locked)

| Decision | Choice |
|---|---|
| Surface | Threshold greeting (reuses existing greeting system) |
| Dormancy window | 60 days untouched |
| Persistence | Ask once, then 60-day cooldown before it may resurface ("ask once, then rest") |
| Salience bar | >= 3 (same bar as open-thread greeting) |
| Max per greeting | 2 in reunion mode, 1 in gentle mode |

## Non-goals (YAGNI)

- No new UI or "checking in" screen — it rides the existing greeting.
- No status-flip batch job that mutates `open/moving → dormant` in the DB.
- No salience-scaled window (flat 60 days).
- No new memory-capture path — the querent's reply uses the existing
  threshold-capture LLM.

## Architecture

Mirrors the established `getRipePredictions` / prophecy pattern already in the
codebase: a pure SQL detector + a pure prompt builder, both unit-testable in
isolation, wired together in `server.js`.

### §1 Detection — `data/memory-store.js`

New method `getDormantThreads(slug, limit = 2, nowTs = now())`:

```sql
SELECT * FROM memories
WHERE reader_slug = ? AND type = 'thread'
  AND status IN ('open','moving')
  AND salience >= ?                              -- DORMANT_SALIENCE_BAR = 3
  AND (? - COALESCE(asked_at, updated_at)) >= (60 + (id % 7) - 3) * 86400
ORDER BY salience DESC, updated_at ASC           -- quietest, most salient first
LIMIT ?
```

- **Age basis `COALESCE(asked_at, updated_at)`:** a never-asked thread qualifies
  via `updated_at`; a thread already raised once re-ripens 60 days after
  `asked_at`. This makes "ask once, then rest" fall out for free, because the
  greeting flow already calls `markAsked` on everything it surfaces.
- **Jitter `(id % 7) - 3`:** yields a stable per-row 57–63 day threshold so a
  thread never flickers in and out across same-day calls. Identical mechanism to
  `getRipePredictions`' `(14 + (id % 7) - 3)`.
- **`ORDER BY updated_at ASC`:** surfaces the longest-quiet thread first.
- New exported constants: `DORMANT_DAYS = 60`, `DORMANT_SALIENCE_BAR = 3`
  (matching how `THRESHOLD_SALIENCE_BAR` etc. are surfaced).

The query is the deliberate complement of `getOpenUnaskedThreads`:
`getOpenUnaskedThreads` returns fresh, never-asked, recently-touched threads;
`getDormantThreads` returns salient threads gone quiet past the window (whether
never asked, or asked and now past cooldown).

### §2 Greeting integration — `server.js` (~line 1050)

1. Fetch dormant threads **first**:
   `const dormant = memory.getDormantThreads(slug, 2, now);`
2. Build `const dormantIds = new Set(dormant.map(t => t.id));` and filter them out
   of the fresh `threads` list so a thread never appears in both blocks in the
   same greeting (a never-asked thread that is also 60+ days old is treated as
   dormant, not fresh).
3. Pass `dormant` through `decideThresholdMode` so dormant threads alone can
   trigger a reunion even when no open threads / predictions / temporal callbacks
   are pending.
4. Pass `dormant` (capped to 1 in gentle mode) into `buildGreetingPrompt`.
5. Include dormant ids in the existing `markAsked` call (~line 1094):
   `memory.markAsked([...shown, ...shownDormant].map(t => t.id));`
   — this stamps the 60-day cooldown. No new persistence code.

### §3 Greeting prompt — `data/memory-engine.js`

`decideThresholdMode(lastVisitTs, threads, now, gapDays, predictions,
temporalCallbacks, dormantThreads = [])` — add `dormantThreads` to the
`hasMaterial` check so they can independently drive a greeting.

`buildGreetingPrompt(...)` gains a `dormantThreads = []` parameter and emits a
distinct block when present, with a softer, more tentative voice than the
open-thread "what came of it" ask:

> Thread(s) that have gone quiet between you — they spoke of these once, but not
> for a long while now:
> - {content}
>
> You have been quietly holding {this/these}. If it feels natural, gently wonder
> aloud whether it ever settled — not as a checklist, but the way you would ask
> after something a friend once carried, and might no longer be carrying. Do not
> press; if they do not take it up, let it rest.

The open-thread ask and the dormant wondering may coexist in one greeting; the
instruction directs Miriel to give the long-quiet thread a softer, more tentative
weight than a currently-open one.

### §4 Resolution — no new code

The querent's reply already routes through `buildThresholdCapturePrompt` →
threshold-capture LLM, which issues UPDATE / RESOLVE ops:

- They report it resolved → `status='resolved'` → permanently drops out of
  `getDormantThreads` (which requires `open`/`moving`).
- They re-engage but it stays open → `updated_at` bumps → no longer past the
  60-day window → naturally rests for another cycle.
- They ignore it → `asked_at` (stamped at surface time) holds the 60-day cooldown
  before it may resurface once more.

## Data flow

```
greeting request
  -> getDormantThreads(slug)            [§1 store, pure SQL]
  -> filter dormant ids out of fresh threads   [§2 server]
  -> decideThresholdMode(..., dormant)  [§3 engine, pure]
  -> buildGreetingPrompt(..., dormant)  [§3 engine, pure]
  -> callLLM -> greeting text
  -> markAsked(shown + shownDormant)    [§2 server -> store; stamps cooldown]

querent reply
  -> buildThresholdCapturePrompt        [existing]
  -> capture LLM -> UPDATE/RESOLVE ops   [existing applyOps]
```

## Testing

**`tests/memory-store.test.js`** (new `getDormantThreads` cases):
- old `updated_at`, salient, open → returned
- fresh `updated_at` → not returned
- `status='resolved'` and `status='dormant'` → not returned
- salience below bar → not returned
- `asked_at` within cooldown → excluded; `asked_at` past cooldown → re-included
- type other than `thread` → not returned

**`tests/memory-engine.test.js`**:
- `buildGreetingPrompt` emits the dormant block containing the thread content
- `decideThresholdMode` returns `reunion`/`gentle` when only dormant threads exist
- existing greeting tests still pass with the new trailing parameter

**Bar:** all current tests remain green + ~6–8 new tests.

## Risks & mitigations

- **Overlap with open-thread block** → server-side id de-dup (§2 step 2).
- **Nagging** → 60-day cooldown via `asked_at` (§1, §2 step 5); cap of 2/1.
- **Existing call signatures** → `dormantThreads` added as a trailing optional
  parameter on both `decideThresholdMode` and `buildGreetingPrompt`, defaulting
  to `[]`, so existing callers/tests are unaffected.
