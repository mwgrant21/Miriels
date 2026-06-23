# Interpretation Cache & Reader Profile Design
**Date:** 2026-05-25
**Status:** Approved, ready for implementation

---

## Overview

Two complementary features that work together to deepen the reading experience:

1. **Interpretation Cache** — a SQLite-backed third fallback tier (Claude → Ollama → Cache) that stores high-fidelity card interpretations locally. Grows organically with every Claude response and can be pre-seeded on demand.

2. **Reader Profile** — a living document Miriel maintains per reader, synthesized from full reading history. Enables a graduated intimacy model: new readers get the base Miriel experience; long-term readers get Miriel as a true oracle who knows their arc.

---

## Section 1: Architecture Overview

### New files
- `data/interpretation-cache.js` — owns all SQLite DB operations (init, read, write, stats). Nothing else touches the DB directly.
- `data/interpretations.db` — SQLite database alongside existing data files. Added to `.gitignore`.
- `scripts/seed-cache.js` — standalone CLI script for pre-generating single-card interpretations per deck.

### Modified files
- `server.js` — two changes only:
  1. After a successful Claude interpretation, write to cache (fire-and-forget, never blocks response)
  2. Fallback chain extended: Claude → Ollama → Cache lookup
  3. Profile loading and injection into system prompt for `/api/interpret` and `/api/compatibility`
  4. Auto-trigger profile refresh in `POST /api/readings`

### New endpoints
- `POST /api/profiles/:slug/refresh` — manual profile regeneration for a reader
- `GET /api/cache/stats` — cache coverage and hit rate per deck

---

## Section 2: Database Schema & Cache Key

### Schema

```sql
CREATE TABLE IF NOT EXISTS interpretations (
  key         TEXT PRIMARY KEY,
  deck        TEXT NOT NULL,
  spread_type TEXT NOT NULL,
  card_count  INTEGER NOT NULL,
  interpretation TEXT NOT NULL,
  source      TEXT NOT NULL,      -- 'claude' | 'ollama'
  created_at  INTEGER NOT NULL,   -- unix timestamp
  hit_count   INTEGER DEFAULT 0,
  last_hit    INTEGER             -- unix timestamp, nullable
);

CREATE INDEX idx_deck_spread ON interpretations(deck, spread_type);
CREATE INDEX idx_deck_source  ON interpretations(deck, source);
```

### Cache key format

```
{deck}:{spread_type}:{pos}:{card_id}:{orientation}|{pos}:{card_id}:{orientation}|...
```

**Example** — three-card Rider-Waite spread:
```
tarot:three-card:past:major-0:upright|present:major-16:reversed|future:major-17:upright
```

**Single-card (seeded) entries** use `spread_type = single` and position `single`:
```
tarot:single:single:major-0:upright
```

### Key rules
- Position labels come from `c.position` (what the frontend already sends)
- Orientation is `upright` or `reversed`
- Question, reader name, and theme card are excluded from the key (vary per reading)
- Assembly fallback looks up each card as `{deck}:single:single:{card_id}:{orientation}`

### Write rules
- Claude entries always overwrite Ollama entries for the same key
- Claude entries overwrite older Claude entries (most recent wins — quality improves over time)
- Ollama entries only write if no entry exists for that key

---

## Section 3: Reader Profile (Graduated Oracle Model)

### Storage
`data/profiles/{slug}.json` — one file per reader, same slug as reading history files.

### Profile structure

```json
{
  "slug": "matt",
  "last_updated": 1716000000,
  "readings_synthesized": 47,
  "miriel_notes": "2-3 paragraphs in Miriel's voice. Not a summary — her actual knowledge of this person after all this time. The texture of their inner world, what they carry, how they move through questions.",
  "recurring_cards": [
    { "card": "The Tower", "card_id": "major-16", "count": 8, "note": "almost always in hidden or outcome positions" },
    { "card": "Eight of Cups",  "card_id": "cups-8",   "count": 5, "note": "pairs consistently with transition questions" }
  ],
  "life_arc": {
    "current_chapter": "Something about what you have been unwilling to release.",
    "key_threads": [
      { "theme": "creative work and fear of being seen", "status": "unresolved, intensifying" },
      { "theme": "a relationship that needed ending",    "status": "moved through, largely resolved" }
    ],
    "inflection_points": "Around November, the Tower stopped appearing. The Star showed up twice in three months. Something shifted."
  },
  "unresolved_thread": "The one thing that keeps surfacing without resolution across readings."
}
```

### Tier model

| Tier | Threshold | What Miriel knows | Profile injection |
|------|-----------|-------------------|-------------------|
| 1 | < 10 readings | Cards only | None — runs exactly as before |
| 2 | 10–29 readings | Patterns emerging | `miriel_notes` + recurring card note if current draw matches |
| 3 | 30+ readings | Full arc, long memory | `miriel_notes` + `life_arc.current_chapter` + `unresolved_thread` + recurring card notes + relationship framing line |

**Tier 3 persona addition:**
> "You have known this person through many readings. You don't establish yourself here — you already have a relationship. You know their arc. Read accordingly."

### Profile synthesis prompt (Tier 3)

```
You are Miriel. You have been reading for [name] across [N] sessions over [time period].
Below is the complete history of their readings with you.

Read this the way you would read a long relationship — not as data, but as a story.
Write your notes in four parts:

MIRIEL_NOTES: 2-3 paragraphs in your own voice. What do you actually know about
this person from the cards? What texture does their inner world have?

LIFE_ARC: The current chapter they are in. One or two sentences. What is this period about?

KEY_THREADS: The 2-3 most significant ongoing themes and their status (open / moving / resolved).

UNRESOLVED_THREAD: The one thing that keeps surfacing without resolution.

Don't summarize. Write the way you think after knowing someone this long.
```

Tier 2 uses a shorter version of this prompt: asks only for `MIRIEL_NOTES` (what patterns are you starting to notice?) and `RECURRING_CARDS`. No `LIFE_ARC` or `UNRESOLVED_THREAD` until Tier 3.

### Profile regeneration cadence
- Auto-triggered (fire-and-forget) in `POST /api/readings` after appending the reading
- Cadence: every 5 new readings in Tier 2; every 10 in Tier 3 (less churn once the picture is stable)
- Manual trigger available via `POST /api/profiles/:slug/refresh`
- Synthesis always reads the full reading history (up to 200 entries) — depth compounds over time

### Separation of concerns
- Profile is compact distilled knowledge — injected into live readings
- Raw reading history is never sent to Claude during a live reading
- Profile generation is the only time full history is processed by Claude

---

## Section 4: Changes to `server.js`

### Profile injection

In `/api/interpret` and `/api/compatibility`, after determining `slug`:

```javascript
const profile = loadReaderProfile(slug);        // reads data/profiles/{slug}.json or returns null
const readingCount = loadReadings(slug).length;
const tier = readingCount >= 30 ? 3 : readingCount >= 10 ? 2 : 1;
const enrichedPersona = buildPersonaWithProfile(READER_PERSONA, readerName, profile, tier, cards);
```

`buildPersonaWithProfile` appends to the base persona based on tier (see tier table above).
Recurring card notes only injected when the current draw contains a card from `profile.recurring_cards`.

### Cache fallback chain

```javascript
async function callLLM(system, userPrompt, maxTokens, model, cacheKey) {
  const apiKey = getApiKey();
  if (apiKey) {
    try { return await callClaude(apiKey, system, userPrompt, maxTokens, model); }
    catch (err) { console.warn(`Claude failed (${err.httpStatus || err.message}), trying local model`); }
  }
  try { return await callOllama(system, userPrompt, maxTokens); }
  catch (err) { console.warn(`Ollama failed (${err.message}), checking cache`); }
  if (cacheKey) {
    const cached = lookupCache(cacheKey);
    if (cached) return cached;
  }
  throw new Error('No interpretation available — all sources offline');
}
```

### Fire-and-forget cache save (in `/api/interpret` handler)

```javascript
const text = await callLLM(enrichedPersona, prompt, 3000, 'claude-sonnet-4-6', cacheKey);
saveToCache(cacheKey, deck, spreadType, cards, text, 'claude').catch(() => {});
res.json({ interpretation: text });
```

### Profile auto-refresh (in `POST /api/readings`)

```javascript
// After appendReading():
const count = loadReadings(slug).length;
const profile = loadReaderProfile(slug);
const lastSynth = profile?.readings_synthesized || 0;
const cadence = count >= 30 ? 10 : 5;
if (count - lastSynth >= cadence) {
  refreshReaderProfile(slug, callLLM).catch(() => {});
}
```

---

## Section 5: Cache Population & Seeding Tool

### Assembled fallback (multi-card, no exact match)

When both Claude and Ollama fail and the exact spread key is not cached:
1. Look up each card individually as `{deck}:single:single:{card_id}:{orientation}`
2. Concatenate found entries, separated by a clear divider
3. Prepend: `"[Reading assembled from individual card interpretations — no exact spread match found offline]"`
4. Return result — imperfect but far better than an error

### Seeding tool CLI

```
node scripts/seed-cache.js --deck tarot
node scripts/seed-cache.js --deck thoth --delay 1500
node scripts/seed-cache.js --all
node scripts/seed-cache.js --deck runic --force
```

- Generates single-card interpretations for every card × upright/reversed in the target deck
- Throttled: configurable delay between calls (default 2000ms) to avoid rate limits
- Progress display: `Seeding tarot: 45/156 — The Chariot (reversed)`
- Skips cards already cached with Claude source unless `--force` is passed
- Requires API key in `data/config.json`

### Cache stats endpoint

`GET /api/cache/stats` returns:

```json
{
  "decks": {
    "tarot":  { "total": 156, "cached": 112, "coverage": 0.72, "claude": 98, "ollama": 14, "hits": 340 },
    "thoth":  { "total": 156, "cached":  22, "coverage": 0.14, "claude": 22, "ollama":  0, "hits":  41 }
  }
}
```

---

## Implementation Notes

- `better-sqlite3` is the only new npm dependency. It is synchronous — no async complexity added to existing handlers.
- `data/interpretations.db` and `data/profiles/` added to `.gitignore` — personal reading data stays local.
- All new behavior is additive and non-breaking. Tier 1 readers and readers without profiles experience zero change.
- The `callLLM` signature gains an optional `cacheKey` parameter — all existing call sites without it continue to work unchanged.
- Cache key requires a `deck` identifier. The frontend already has deck context; the `/api/interpret` request body should be extended to include a `deck` field (e.g. `"tarot"`, `"thoth"`). Alternatively, deck can be inferred from `cards[0].deckType` if that field is reliably populated. Implementation to confirm which is cleaner.
