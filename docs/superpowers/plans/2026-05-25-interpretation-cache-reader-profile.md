# Interpretation Cache & Reader Profile Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a SQLite interpretation cache (third fallback tier: Claude → Ollama → Cache) and a graduated reader profile system that enables Miriel to read long-term users with accumulated personal context.

**Architecture:** `data/interpretation-cache.js` and `data/reader-profile.js` are factory-function modules initialized by `server.js` with the runtime `DATA_DIR`. Cache stores LLM-generated interpretations keyed by deck+spread+cards (no question). Reader profile synthesizes full reading history into a compact document Miriel receives at tiers 2 and 3. Both are additive — tier 1 readers and sessions without a profile behave exactly as before.

**Tech Stack:** Node.js 18+ (`node:test` for tests, no new test framework), `better-sqlite3` (synchronous SQLite, one new runtime dependency), existing Express + Fetch stack.

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `data/interpretation-cache.js` | Create | All SQLite operations: init, buildCacheKey, saveToCache, lookupCache, getCacheStats |
| `data/reader-profile.js` | Create | Profile load/save, persona enrichment, LLM synthesis |
| `scripts/seed-cache.js` | Create | CLI tool to pre-generate single-card entries per deck |
| `tests/interpretation-cache.test.js` | Create | Unit tests for cache module |
| `tests/reader-profile.test.js` | Create | Unit tests for profile module |
| `server.js` | Modify | Wire up cache + profile, extend /api/interpret and /api/compatibility, add endpoints |
| `electron/main.js` | Modify | Create `profiles/` directory on app launch |
| `package.json` | Modify | Add better-sqlite3 dep, electron-rebuild devDep, update build files array |
| `.gitignore` | Modify | Exclude interpretations.db and profiles/ |

---

### Task 1: Install Dependencies

**Files:**
- Modify: `C:\Users\Matt\projects\tarot\package.json`

- [ ] **Step 1.1: Install better-sqlite3**

```bash
cd C:\Users\Matt\projects\tarot
npm install better-sqlite3
```

Expected: `better-sqlite3` appears under `dependencies` in `package.json`. Directory `node_modules\better-sqlite3\` exists with a `.node` native binary.

- [ ] **Step 1.2: Install electron-rebuild (for Electron packaging only)**

```bash
npm install --save-dev @electron/rebuild
```

In `package.json` scripts block, add:

```json
"rebuild": "electron-rebuild -f -w better-sqlite3"
```

Note: `npm run rebuild` is only needed before `npm run dist:win` or `npm run dist:dmg`. Normal `node server.js` usage (tarot.bat) does not require it.

- [ ] **Step 1.3: Verify better-sqlite3 loads**

```bash
node -e "const db = require('better-sqlite3')(':memory:'); db.exec('CREATE TABLE t (x TEXT)'); console.log('OK');"
```

Expected: `OK`

- [ ] **Step 1.4: Commit**

```bash
git add package.json package-lock.json
git commit -m "deps: add better-sqlite3 for interpretation cache"
```

---

### Task 2: Create `data/interpretation-cache.js`

**Files:**
- Create: `C:\Users\Matt\projects\tarot\data\interpretation-cache.js`
- Create: `C:\Users\Matt\projects\tarot\tests\interpretation-cache.test.js`

- [ ] **Step 2.1: Write the failing tests**

Create `C:\Users\Matt\projects\tarot\tests\interpretation-cache.test.js`:

```javascript
'use strict';
const { test } = require('node:test');
const assert   = require('node:assert/strict');
const os   = require('os');
const path = require('path');
const fs   = require('fs');
const createCache = require('../data/interpretation-cache');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'tarot-cache-'));
}

test('buildCacheKey produces consistent key', () => {
  const cache = createCache(tmpDir());
  const cards = [
    { id: 'major-0',  position: 'past',    isReversed: false },
    { id: 'major-16', position: 'present', isReversed: true  },
  ];
  assert.equal(
    cache.buildCacheKey('tarot', 'three-card', cards),
    'tarot:three-card:past:major-0:upright|present:major-16:reversed'
  );
});

test('saveToCache and exact lookupCache', () => {
  const cache = createCache(tmpDir());
  const cards = [{ id: 'major-0', position: 'single', isReversed: false }];
  const key   = cache.buildCacheKey('tarot', 'single', cards);
  cache.saveToCache(key, 'tarot', 'single', cards, 'The Fool speaks.', 'claude');
  assert.equal(cache.lookupCache(key, 'tarot', cards), 'The Fool speaks.');
});

test('Claude overwrites Ollama; Ollama does not overwrite Claude', () => {
  const cache = createCache(tmpDir());
  const cards = [{ id: 'major-1', position: 'single', isReversed: false }];
  const key   = cache.buildCacheKey('tarot', 'single', cards);
  cache.saveToCache(key, 'tarot', 'single', cards, 'Ollama text.',  'ollama');
  cache.saveToCache(key, 'tarot', 'single', cards, 'Claude text.',  'claude');
  assert.equal(cache.lookupCache(key, 'tarot', cards), 'Claude text.');
  cache.saveToCache(key, 'tarot', 'single', cards, 'Ollama again.', 'ollama');
  assert.equal(cache.lookupCache(key, 'tarot', cards), 'Claude text.');
});

test('assembled fallback when no exact match exists', () => {
  const cache = createCache(tmpDir());
  const c0 = { id: 'major-0', position: 'single', isReversed: false };
  const c1 = { id: 'major-1', position: 'single', isReversed: false };
  cache.saveToCache(cache.buildCacheKey('tarot', 'single', [c0]), 'tarot', 'single', [c0], 'Fool.', 'claude');
  cache.saveToCache(cache.buildCacheKey('tarot', 'single', [c1]), 'tarot', 'single', [c1], 'Magician.', 'claude');

  const spreadCards = [
    { id: 'major-0', position: 'past',    isReversed: false },
    { id: 'major-1', position: 'present', isReversed: false },
  ];
  const result = cache.lookupCache(cache.buildCacheKey('tarot', 'three-card', spreadCards), 'tarot', spreadCards);
  assert.ok(result.includes('[Reading assembled'));
  assert.ok(result.includes('Fool.'));
  assert.ok(result.includes('Magician.'));
});

test('lookupCache returns null when nothing cached', () => {
  const cache = createCache(tmpDir());
  const cards = [{ id: 'major-99', position: 'single', isReversed: false }];
  assert.equal(cache.lookupCache(cache.buildCacheKey('tarot', 'single', cards), 'tarot', cards), null);
});
```

- [ ] **Step 2.2: Run tests — verify they fail**

```bash
cd C:\Users\Matt\projects\tarot
node --test tests/interpretation-cache.test.js
```

Expected: All 5 tests fail with `Cannot find module '../data/interpretation-cache'`

- [ ] **Step 2.3: Create `data/interpretation-cache.js`**

```javascript
'use strict';
const path = require('path');
const Database = require('better-sqlite3');

module.exports = function createCache(dataDir) {
  const db = new Database(path.join(dataDir, 'interpretations.db'));

  db.exec(`
    CREATE TABLE IF NOT EXISTS interpretations (
      key            TEXT PRIMARY KEY,
      deck           TEXT NOT NULL,
      spread_type    TEXT NOT NULL,
      card_count     INTEGER NOT NULL,
      interpretation TEXT NOT NULL,
      source         TEXT NOT NULL,
      created_at     INTEGER NOT NULL,
      hit_count      INTEGER DEFAULT 0,
      last_hit       INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_deck_spread ON interpretations(deck, spread_type);
    CREATE INDEX IF NOT EXISTS idx_deck_source  ON interpretations(deck, source);
  `);

  const stmtUpsert = db.prepare(`
    INSERT INTO interpretations(key, deck, spread_type, card_count, interpretation, source, created_at)
    VALUES (@key, @deck, @spread_type, @card_count, @interpretation, @source, @created_at)
    ON CONFLICT(key) DO UPDATE SET
      interpretation = CASE
        WHEN excluded.source = 'claude' THEN excluded.interpretation
        WHEN source = 'claude'          THEN interpretation
        ELSE excluded.interpretation
      END,
      source = CASE
        WHEN excluded.source = 'claude' THEN 'claude'
        WHEN source = 'claude'          THEN 'claude'
        ELSE excluded.source
      END,
      created_at = CASE
        WHEN excluded.source = 'claude' THEN excluded.created_at
        WHEN source = 'claude'          THEN created_at
        ELSE excluded.created_at
      END
  `);

  const stmtGet   = db.prepare('SELECT interpretation, source FROM interpretations WHERE key = ?');
  const stmtHit   = db.prepare('UPDATE interpretations SET hit_count = hit_count + 1, last_hit = ? WHERE key = ?');
  const stmtStats = db.prepare(`
    SELECT deck, source, COUNT(*) as cnt, SUM(hit_count) as hits
    FROM interpretations GROUP BY deck, source
  `);

  function buildCacheKey(deck, spreadType, cards) {
    const segs = cards.map(c => {
      const pos = (c.position || 'single').replace(/[:|]/g, '_');
      const id  = (c.id || 'unknown').replace(/[:|]/g, '_');
      const ori = c.isReversed ? 'reversed' : 'upright';
      return `${pos}:${id}:${ori}`;
    }).join('|');
    return `${deck}:${spreadType}:${segs}`;
  }

  function saveToCache(key, deck, spreadType, cards, interpretation, source) {
    try {
      stmtUpsert.run({
        key, deck, spread_type: spreadType, card_count: cards.length,
        interpretation, source, created_at: Math.floor(Date.now() / 1000)
      });
    } catch (err) {
      console.warn('[cache] save failed:', err.message);
    }
  }

  function lookupCache(key, deck, cards) {
    const now = Math.floor(Date.now() / 1000);
    const row = stmtGet.get(key);
    if (row) {
      stmtHit.run(now, key);
      return row.interpretation;
    }
    // Assembled fallback: look up each card as a cached single-card entry
    const parts = [];
    for (const c of cards) {
      const singleKey = buildCacheKey(deck, 'single', [{ ...c, position: 'single' }]);
      const singleRow = stmtGet.get(singleKey);
      if (singleRow) parts.push(singleRow.interpretation);
    }
    if (!parts.length) return null;
    return `[Reading assembled from individual card interpretations — no exact spread match found offline]\n\n${parts.join('\n\n---\n\n')}`;
  }

  function getCacheStats(deckCardCounts) {
    const rows = stmtStats.all();
    const byDeck = {};
    for (const r of rows) {
      if (!byDeck[r.deck]) byDeck[r.deck] = { claude: 0, ollama: 0, hits: 0 };
      byDeck[r.deck][r.source] = (byDeck[r.deck][r.source] || 0) + r.cnt;
      byDeck[r.deck].hits += r.hits || 0;
    }
    const result = {};
    for (const [deck, counts] of Object.entries(byDeck)) {
      const maxCards = deckCardCounts[deck] || 0;
      const cached   = (counts.claude || 0) + (counts.ollama || 0);
      result[deck] = {
        total: maxCards, cached,
        coverage: maxCards ? +(cached / maxCards).toFixed(2) : 0,
        claude: counts.claude || 0, ollama: counts.ollama || 0, hits: counts.hits || 0
      };
    }
    return result;
  }

  return { buildCacheKey, saveToCache, lookupCache, getCacheStats };
};
```

- [ ] **Step 2.4: Run tests — verify they pass**

```bash
node --test tests/interpretation-cache.test.js
```

Expected: All 5 tests pass.

- [ ] **Step 2.5: Commit**

```bash
git add data/interpretation-cache.js tests/interpretation-cache.test.js
git commit -m "feat: add interpretation cache module (SQLite, better-sqlite3)"
```

---

### Task 3: Create `data/reader-profile.js`

**Files:**
- Create: `C:\Users\Matt\projects\tarot\data\reader-profile.js`
- Create: `C:\Users\Matt\projects\tarot\tests\reader-profile.test.js`

- [ ] **Step 3.1: Write the failing tests**

Create `C:\Users\Matt\projects\tarot\tests\reader-profile.test.js`:

```javascript
'use strict';
const { test } = require('node:test');
const assert   = require('node:assert/strict');
const os   = require('os');
const path = require('path');
const fs   = require('fs');
const createProfileManager = require('../data/reader-profile');

function tmpDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'tarot-profile-')); }

const BASE = 'You are Miriel.';

test('getTier returns correct tiers', () => {
  const pm = createProfileManager(tmpDir());
  assert.equal(pm.getTier(0),   1);
  assert.equal(pm.getTier(9),   1);
  assert.equal(pm.getTier(10),  2);
  assert.equal(pm.getTier(29),  2);
  assert.equal(pm.getTier(30),  3);
  assert.equal(pm.getTier(100), 3);
});

test('buildPersonaWithProfile returns base persona unchanged for tier 1', () => {
  const pm = createProfileManager(tmpDir());
  assert.equal(pm.buildPersonaWithProfile(BASE, 'Matt', null, 5, []), BASE);
});

test('buildPersonaWithProfile injects miriel_notes at tier 2', () => {
  const pm      = createProfileManager(tmpDir());
  const profile = { miriel_notes: 'You ask about thresholds.', recurring_cards: [] };
  const result  = pm.buildPersonaWithProfile(BASE, 'Matt', profile, 15, []);
  assert.ok(result.includes('You ask about thresholds.'));
  assert.ok(!result.includes('current chapter'));
});

test('buildPersonaWithProfile injects life_arc and unresolved_thread at tier 3', () => {
  const pm      = createProfileManager(tmpDir());
  const profile = {
    miriel_notes:     'Deep patterns.',
    life_arc:         { current_chapter: 'A threshold not crossed.', key_threads: [], inflection_points: '' },
    unresolved_thread: 'Creative fear.',
    recurring_cards:  []
  };
  const result = pm.buildPersonaWithProfile(BASE, 'Matt', profile, 35, []);
  assert.ok(result.includes('A threshold not crossed.'));
  assert.ok(result.includes('Creative fear.'));
  assert.ok(result.includes('You have known this person through many readings'));
});

test('recurring card note injected only when card appears in current draw', () => {
  const pm      = createProfileManager(tmpDir());
  const profile = {
    miriel_notes:    'Notes.',
    recurring_cards: [{ card: 'The Tower', card_id: 'major-16', count: 8, note: 'always outcome' }]
  };
  const withTower    = pm.buildPersonaWithProfile(BASE, 'Matt', profile, 15, [{ id: 'major-16' }]);
  const withoutTower = pm.buildPersonaWithProfile(BASE, 'Matt', profile, 15, [{ id: 'major-0'  }]);
  assert.ok(withTower.includes('The Tower'));
  assert.ok(!withoutTower.includes('The Tower'));
});

test('loadReaderProfile returns null for unknown slug', () => {
  const pm = createProfileManager(tmpDir());
  assert.equal(pm.loadReaderProfile('nobody'), null);
});

test('saveReaderProfile and loadReaderProfile round-trip', () => {
  const pm      = createProfileManager(tmpDir());
  const profile = { slug: 'matt', miriel_notes: 'Test.', recurring_cards: [] };
  pm.saveReaderProfile('matt', profile);
  assert.deepEqual(pm.loadReaderProfile('matt'), profile);
});
```

- [ ] **Step 3.2: Run tests — verify they fail**

```bash
node --test tests/reader-profile.test.js
```

Expected: All 7 tests fail with `Cannot find module '../data/reader-profile'`

- [ ] **Step 3.3: Create `data/reader-profile.js`**

```javascript
'use strict';
const path = require('path');
const fs   = require('fs');

const T2 = 10;
const T3 = 30;

function getTier(readingCount) {
  if (readingCount >= T3) return 3;
  if (readingCount >= T2) return 2;
  return 1;
}

module.exports = function createProfileManager(dataDir) {
  const profilesDir = path.join(dataDir, 'profiles');
  fs.mkdirSync(profilesDir, { recursive: true });

  function loadReaderProfile(slug) {
    try {
      const p = path.join(profilesDir, `${slug}.json`);
      if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'));
    } catch {}
    return null;
  }

  function saveReaderProfile(slug, profile) {
    fs.writeFileSync(path.join(profilesDir, `${slug}.json`), JSON.stringify(profile, null, 2));
  }

  function buildPersonaWithProfile(basePersona, readerName, profile, readingCount, currentCards) {
    const tier = getTier(readingCount);
    if (tier === 1 || !profile) return basePersona;

    const nameLine = readerName
      ? `\n\nThe person sitting across from you is ${readerName}. Use their name naturally — the way you actually would if you'd just learned it. Not every sentence, but enough that they feel seen and spoken to directly.`
      : '';

    const currentIds = new Set((currentCards || []).map(c => c.id));
    const matching   = (profile.recurring_cards || []).filter(r => currentIds.has(r.card_id));
    const recurringNote = matching.length
      ? `\n\nThis person has drawn these cards many times before: ${matching.map(r => `${r.card} (${r.note})`).join('; ')}. You already know how these cards tend to land for them.`
      : '';

    if (tier === 2) {
      return `${basePersona}${nameLine}\n\nFrom your prior readings with this person:\n${profile.miriel_notes}${recurringNote}`;
    }

    const arcNote = profile.life_arc
      ? `\n\nTheir current chapter: ${profile.life_arc.current_chapter}\n\nWhat has not resolved: ${profile.unresolved_thread || ''}`
      : '';

    return `${basePersona}${nameLine}\n\nYou have known this person through many readings. You don't establish yourself here — you already have a relationship. You know their arc. Read accordingly.\n\nFrom your work together:\n${profile.miriel_notes}${arcNote}${recurringNote}`;
  }

  async function refreshReaderProfile(slug, callLLM, loadReadings) {
    const readings = loadReadings(slug);
    if (readings.length < T2) return;

    const tier = getTier(readings.length);

    const readingsText = readings.map(r => {
      const cardList = (r.cards || [])
        .map(c => `${c.position ? c.position + ': ' : ''}${c.name} (${c.isReversed ? 'reversed' : 'upright'})`)
        .join(', ');
      return `${r.date || 'unknown date'} — ${r.deckLabel || r.deck || 'tarot'}, ${r.spread || 'unknown spread'}${r.question ? `, question: "${r.question}"` : ''}\nCards: ${cardList}${r.synopsis ? `\nNotes: ${r.synopsis.slice(0, 200)}` : ''}`;
    }).join('\n\n');

    const systemPrompt = 'You are Miriel, an experienced tarot reader.';

    let userPrompt;
    if (tier === 2) {
      userPrompt = `You have been reading for this person across ${readings.length} sessions. Below is the complete history of their readings with you.\n\n${readingsText}\n\nWrite your notes using these exact labels:\n\nMIRIEL_NOTES:\n[2 paragraphs in your own voice — what patterns are you starting to notice?]\n\nRECURRING_CARDS:\n[JSON array: [{"card":"name","card_id":"id","count":N,"note":"how it tends to land"}] — top 3 only, or []]`;
    } else {
      userPrompt = `You have been reading for this person across ${readings.length} sessions over time. Read this history the way you would read a long relationship — not as data, but as a story.\n\n${readingsText}\n\nWrite your notes using these exact labels:\n\nMIRIEL_NOTES:\n[2-3 paragraphs in your own voice. What do you actually know about this person from the cards?]\n\nLIFE_ARC_CHAPTER:\n[1-2 sentences: what is the current period about for them?]\n\nKEY_THREADS:\n[JSON array: [{"theme":"...","status":"open|moving|resolved"}] — 2-3 most significant]\n\nINFLECTION_POINTS:\n[1-2 sentences on any clear before/after moment, or leave blank]\n\nUNRESOLVED_THREAD:\n[The one thing that keeps surfacing without resolution]\n\nRECURRING_CARDS:\n[JSON array: [{"card":"name","card_id":"id","count":N,"note":"how it tends to land"}] — top 5, or []]`;
    }

    const raw = await callLLM(systemPrompt, userPrompt, 1500);

    function extract(label) {
      const re = new RegExp(`${label}:\\s*([\\s\\S]*?)(?=\\n[A-Z_]+:|$)`, 'i');
      const m  = raw.match(re);
      return m ? m[1].trim() : '';
    }
    function extractJSON(label) {
      try { return JSON.parse(extract(label)); } catch { return []; }
    }

    const profile = {
      slug,
      last_updated:          Math.floor(Date.now() / 1000),
      readings_synthesized:  readings.length,
      miriel_notes:          extract('MIRIEL_NOTES'),
      recurring_cards:       extractJSON('RECURRING_CARDS'),
    };

    if (tier === 3) {
      profile.life_arc = {
        current_chapter:   extract('LIFE_ARC_CHAPTER'),
        key_threads:       extractJSON('KEY_THREADS'),
        inflection_points: extract('INFLECTION_POINTS'),
      };
      profile.unresolved_thread = extract('UNRESOLVED_THREAD');
    }

    saveReaderProfile(slug, profile);
    console.log(`  ✓ Reader profile refreshed for ${slug} (tier ${tier}, ${readings.length} readings)`);
  }

  return { loadReaderProfile, saveReaderProfile, buildPersonaWithProfile, refreshReaderProfile, getTier };
};
```

- [ ] **Step 3.4: Run tests — verify they pass**

```bash
node --test tests/reader-profile.test.js
```

Expected: All 7 tests pass.

- [ ] **Step 3.5: Commit**

```bash
git add data/reader-profile.js tests/reader-profile.test.js
git commit -m "feat: add reader profile module with graduated tier model"
```

---

### Task 4: Modify `server.js` — Cache Integration

**Files:**
- Modify: `C:\Users\Matt\projects\tarot\server.js`

- [ ] **Step 4.1: Add requires and initialize cache**

After the `const LEGACY_PATH` line near the top of `server.js`, add:

```javascript
const createCache = require('./data/interpretation-cache');
const cache = createCache(DATA_DIR);
```

- [ ] **Step 4.2: Add deriveDeck helper**

After the `migrateIfNeeded()` call, add:

```javascript
function deriveDeck(card) {
  if (!card) return 'tarot';
  const dt = card.deckType;
  if (dt === 'CelticDragon' || (card.id && card.id.startsWith('cd-'))) return 'celtic-dragon';
  if (dt === 'Moonology') return 'moonology';
  if (dt === 'Lenormand') return 'lenormand';
  if (dt === 'Thoth')     return 'thoth';
  if (dt === 'Runic')     return 'runic';
  if (dt === 'IChing')    return 'iching';
  if (card.arcana || card.suit) return 'tarot';
  return 'oracle';
}
```

- [ ] **Step 4.3: Replace the final try/catch in /api/interpret**

Find the existing try/catch block near the end of `/api/interpret` that looks like:

```javascript
  try {
    const text = await callLLM(personaWithName, prompt, 3000);
    res.json({ interpretation: text });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
```

Replace it with:

```javascript
  const deck        = deriveDeck(cards[0]);
  const cacheKeyStr = cache.buildCacheKey(deck, spread_type, cards);

  try {
    let text   = null;
    let source = 'ollama';
    const apiKey = getApiKey();

    if (apiKey) {
      try {
        text   = await callClaude(apiKey, personaWithName, prompt, 3000, 'claude-sonnet-4-6');
        source = 'claude';
      } catch (err) {
        console.warn(`  ⚠  Claude failed (${err.httpStatus || err.message}), trying local model`);
      }
    }
    if (text === null) {
      try {
        text = await callOllama(personaWithName, prompt, 3000);
      } catch (err) {
        console.warn(`  ⚠  Ollama failed (${err.message}), checking cache`);
      }
    }
    if (text === null) {
      text   = cache.lookupCache(cacheKeyStr, deck, cards);
      source = 'cache';
    }
    if (text === null) {
      throw new Error('No interpretation available — all sources offline');
    }
    if (source !== 'cache') {
      try { cache.saveToCache(cacheKeyStr, deck, spread_type, cards, text, source); } catch {}
    }
    res.json({ interpretation: text });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
```

- [ ] **Step 4.4: Add cache stats endpoint**

After the existing reader endpoints and before the server listen call, add:

```javascript
app.get('/api/cache/stats', (req, res) => {
  const deckNames = ['tarot', 'thoth', 'lenormand', 'celtic-dragon', 'runic', 'iching', 'moonology', 'oracle'];
  const deckCardCounts = {};
  for (const deck of deckNames) {
    try {
      const file = path.join(DATA_DIR, `${deck}.json`);
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      deckCardCounts[deck] = Array.isArray(data) ? data.length * 2 : 0;
    } catch { deckCardCounts[deck] = 0; }
  }
  res.json(cache.getCacheStats(deckCardCounts));
});
```

- [ ] **Step 4.5: Test cache integration**

```bash
node server.js
```

In a second terminal, draw a card via the app or via curl:

```bash
curl -s -X POST http://localhost:3000/api/interpret \
  -H "Content-Type: application/json" \
  -d "{\"spread_type\":\"single\",\"cards\":[{\"id\":\"major-0\",\"name\":\"The Fool\",\"isReversed\":false,\"arcana\":\"major\",\"position\":\"single\",\"keywords\":\"beginnings\",\"meaning\":\"New beginnings\"}]}" | head -c 200
```

Then check stats:

```bash
curl http://localhost:3000/api/cache/stats
```

Expected: JSON showing `tarot` deck with `cached: 2` (upright + the one just generated) or more.

- [ ] **Step 4.6: Commit**

```bash
git add server.js
git commit -m "feat: integrate interpretation cache into /api/interpret (Claude→Ollama→Cache fallback)"
```

---

### Task 5: Modify `server.js` — Profile Integration

**Files:**
- Modify: `C:\Users\Matt\projects\tarot\server.js`

- [ ] **Step 5.1: Add require and initialize profile manager**

Directly after the `createCache` lines added in Task 4 Step 4.1, add:

```javascript
const createProfileManager = require('./data/reader-profile');
const profiles = createProfileManager(DATA_DIR);
```

- [ ] **Step 5.2: Enrich persona in /api/interpret**

In `/api/interpret`, after the existing `if (!cards || !cards.length)` guard, add slug and profile lookup:

```javascript
  const readers = loadReaders();
  const slug    = req.body.reader || (readers[0] && readers[0].slug) || 'matt';
  const readerReadingCount = loadReadings(slug).length;
  const readerProfile      = profiles.loadReaderProfile(slug);
```

Then find and replace the `personaWithName` construction:

Find:
```javascript
  const personaWithName = readerName
    ? `${READER_PERSONA}\n\nThe person sitting across from you is ${readerName}. Use their name naturally — the way you actually would if you'd just learned it. Not every sentence, but enough that they feel seen and spoken to directly.`
    : READER_PERSONA;
```

Replace with:
```javascript
  const basePersona = readerName
    ? `${READER_PERSONA}\n\nThe person sitting across from you is ${readerName}. Use their name naturally — the way you actually would if you'd just learned it. Not every sentence, but enough that they feel seen and spoken to directly.`
    : READER_PERSONA;
  const personaWithName = profiles.buildPersonaWithProfile(basePersona, readerName, readerProfile, readerReadingCount, cards);
```

- [ ] **Step 5.3: Apply same profile enrichment in /api/compatibility**

In `/api/compatibility`, find the equivalent `personaWithName` construction:

```javascript
  const personaWithName = readerName
    ? `${READER_PERSONA}\n\nThe reader for this session is ${readerName}. Use their name naturally — the way you actually would if you'd just learned it.`
    : READER_PERSONA;
```

Replace with:

```javascript
  const readers = loadReaders();
  const slug    = req.body.reader || (readers[0] && readers[0].slug) || 'matt';
  const readerReadingCount = loadReadings(slug).length;
  const readerProfile      = profiles.loadReaderProfile(slug);
  const basePersona = readerName
    ? `${READER_PERSONA}\n\nThe reader for this session is ${readerName}. Use their name naturally — the way you actually would if you'd just learned it.`
    : READER_PERSONA;
  const personaWithName = profiles.buildPersonaWithProfile(basePersona, readerName, readerProfile, readerReadingCount, cards);
```

- [ ] **Step 5.4: Add auto-refresh trigger in POST /api/readings**

In `POST /api/readings`, after `console.log(`  ✓ Reading saved...`)`, add:

```javascript
    const totalReadings  = loadReadings(slug).length;
    const currentProfile = profiles.loadReaderProfile(slug);
    const lastSynth      = currentProfile ? (currentProfile.readings_synthesized || 0) : 0;
    const cadence        = totalReadings >= 30 ? 10 : 5;
    if (totalReadings - lastSynth >= cadence) {
      profiles.refreshReaderProfile(slug, callLLM, loadReadings)
        .catch(err => console.warn('  ⚠  Profile refresh failed:', err.message));
    }
```

- [ ] **Step 5.5: Add manual profile refresh endpoint**

After the `GET /api/cache/stats` endpoint, add:

```javascript
app.post('/api/profiles/:slug/refresh', async (req, res) => {
  const { slug } = req.params;
  const readers = loadReaders();
  if (!readers.find(r => r.slug === slug)) {
    return res.status(404).json({ error: 'Reader not found' });
  }
  try {
    await profiles.refreshReaderProfile(slug, callLLM, loadReadings);
    const profile = profiles.loadReaderProfile(slug);
    res.json({ ok: true, readings_synthesized: profile ? profile.readings_synthesized : 0 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
```

- [ ] **Step 5.6: Smoke test profile injection**

Temporarily lower the tier thresholds for testing. In `data/reader-profile.js`, change:

```javascript
const T2 = 10;
const T3 = 30;
```

to:

```javascript
const T2 = 1;
const T3 = 3;
```

Restart `node server.js`. Do a reading. Check server console for:
```
  ✓ Reader profile refreshed for matt (tier 2, N readings)
```

Verify the profile was created:

```bash
node -e "console.log(JSON.stringify(require('fs').existsSync('./data/profiles/matt.json')))"
```

Expected: `true`

Restore the original thresholds (`T2 = 10`, `T3 = 30`) and restart the server.

- [ ] **Step 5.7: Commit**

```bash
git add server.js
git commit -m "feat: integrate reader profile into /api/interpret and /api/compatibility with graduated tier model"
```

---

### Task 6: Create `scripts/seed-cache.js`

**Files:**
- Create: `C:\Users\Matt\projects\tarot\scripts\seed-cache.js`

- [ ] **Step 6.1: Create the scripts directory**

```bash
mkdir C:\Users\Matt\projects\tarot\scripts
```

- [ ] **Step 6.2: Create `scripts/seed-cache.js`**

```javascript
#!/usr/bin/env node
'use strict';
/**
 * Usage:
 *   node scripts/seed-cache.js --deck tarot
 *   node scripts/seed-cache.js --all
 *   node scripts/seed-cache.js --deck thoth --delay 1500
 *   node scripts/seed-cache.js --deck runic --force
 */
const path = require('path');
const fs   = require('fs');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');

const createCache = require('../data/interpretation-cache');
const cache = createCache(DATA_DIR);

function getApiKey() {
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'config.json'), 'utf8'));
    if (cfg.apiKey) return cfg.apiKey;
  } catch {}
  return process.env.ANTHROPIC_API_KEY || null;
}

async function callClaude(apiKey, system, userPrompt, maxTokens) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content: userPrompt }]
    })
  });
  if (!res.ok) throw new Error(`Claude ${res.status}: ${await res.text()}`);
  return (await res.json()).content[0].text;
}

const SEED_PERSONA = `Your name is Miriel. You are an experienced tarot reader with an intuitive, direct style — part psychologist, part poet. You don't perform mysticism or lean on spiritual jargon. You read what's actually in front of you. You speak directly to the person across from you. You never use bullet points, headers, bold text, or numbered lists.`;

const DECK_FILES = {
  tarot:           'tarot.json',
  thoth:           'thoth.json',
  lenormand:       'lenormand.json',
  'celtic-dragon': 'celtic-dragon.json',
  runic:           'runic.json',
  iching:          'iching.json',
  moonology:       'moonology.json',
  oracle:          'oracle.json',
};

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function formatForSeed(card, isReversed) {
  const orient   = isReversed ? 'reversed' : 'upright';
  const kw       = card.keywords ? (Array.isArray(card.keywords) ? card.keywords.join(', ') : card.keywords) : '';
  const meaning  = (isReversed ? card.reversed : card.upright) || card.meaning || '';
  const element  = card.element  ? `\n  Element: ${card.element}`    : '';
  const astro    = card.astro    ? `\n  Astrology: ${card.astro}`     : '';
  const shadow   = card.shadow   ? `\n  Shadow: ${card.shadow}`       : '';
  const waite    = card.waite    ? `\n  Waite: ${card.waite}`         : '';
  return `${card.name} (${orient})\n  Keywords: ${kw}\n  Meaning: ${meaning}${element}${astro}${shadow}${waite}`.trim();
}

async function seedDeck(deck, opts) {
  const apiKey = getApiKey();
  if (!apiKey) {
    console.error('No API key found. Add one via the app settings or set ANTHROPIC_API_KEY env var.');
    process.exit(1);
  }

  const cards = JSON.parse(fs.readFileSync(path.join(DATA_DIR, DECK_FILES[deck]), 'utf8'));
  const total  = cards.length * 2;
  let done = 0, seeded = 0, skipped = 0;

  console.log(`\nSeeding ${deck}: ${total} entries (${cards.length} cards × 2 orientations)\n`);

  for (const card of cards) {
    for (const isReversed of [false, true]) {
      done++;
      const cardObj = { id: card.id, position: 'single', isReversed };
      const key     = cache.buildCacheKey(deck, 'single', [cardObj]);
      const orient  = isReversed ? 'reversed' : 'upright';

      if (!opts.force) {
        const existing = cache.lookupCache(key, deck, [cardObj]);
        if (existing && !existing.startsWith('[Reading assembled')) {
          skipped++;
          process.stdout.write(`\r  ${done}/${total} — skipped: ${skipped}    `);
          continue;
        }
      }

      process.stdout.write(`\r  ${done}/${total} — ${card.name} (${orient})                      `);

      const cardBlock = formatForSeed(card, isReversed);
      const prompt    = `Card drawn:\n${cardBlock}\n\nSpeak directly to whoever is sitting across from you. Give a focused, authentic single-card reading — start wherever your eye lands first, think out loud, let the card lead you somewhere. 2-3 paragraphs.`;

      try {
        const text = await callClaude(apiKey, SEED_PERSONA, prompt, 600);
        cache.saveToCache(key, deck, 'single', [cardObj], text, 'claude');
        seeded++;
      } catch (err) {
        console.error(`\n  ✗ Failed ${card.name} (${orient}): ${err.message}`);
      }

      if (done < total) await sleep(opts.delay);
    }
  }
  console.log(`\n\n  ✓ Done. ${seeded} seeded, ${skipped} skipped.\n`);
}

// Parse args
const args = process.argv.slice(2);
const opts = { deck: null, all: false, delay: 2000, force: false };
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--deck')  opts.deck  = args[++i];
  if (args[i] === '--all')   opts.all   = true;
  if (args[i] === '--delay') opts.delay = parseInt(args[++i], 10);
  if (args[i] === '--force') opts.force = true;
}

if (!opts.deck && !opts.all) {
  console.log('Usage: node scripts/seed-cache.js --deck <name> | --all [--delay ms] [--force]');
  console.log('Available decks:', Object.keys(DECK_FILES).join(', '));
  process.exit(0);
}

const decksToSeed = opts.all ? Object.keys(DECK_FILES) : [opts.deck];
for (const d of decksToSeed) {
  if (!DECK_FILES[d]) { console.error(`Unknown deck: ${d}`); process.exit(1); }
}

(async () => {
  for (const d of decksToSeed) await seedDeck(d, opts);
  console.log('Seeding complete.');
})().catch(err => { console.error(err.message); process.exit(1); });
```

- [ ] **Step 6.3: Test the seeding script (usage message)**

```bash
node scripts/seed-cache.js
```

Expected: Prints usage instructions and lists available decks.

- [ ] **Step 6.4: Seed one deck to verify end-to-end**

```bash
node scripts/seed-cache.js --deck runic --delay 1000
```

Runic has 24 runes × 2 = 48 entries. Wait for it to complete (about 48–96 seconds at 1s delay).

After completion, check stats:

```bash
curl http://localhost:3000/api/cache/stats
```

Expected: `runic` deck shows `cached: 48`, `coverage: 1`, `claude: 48`.

- [ ] **Step 6.5: Commit**

```bash
git add scripts/seed-cache.js
git commit -m "feat: add seed-cache CLI script for pre-generating single-card interpretations"
```

---

### Task 7: Update Config Files

**Files:**
- Modify: `C:\Users\Matt\projects\tarot\.gitignore`
- Modify: `C:\Users\Matt\projects\tarot\electron\main.js`
- Modify: `C:\Users\Matt\projects\tarot\package.json`

- [ ] **Step 7.1: Update .gitignore**

Read the current `.gitignore`, then add to it:

```
# Interpretation cache and reader profiles (personal data, stays local)
data/interpretations.db
data/profiles/
```

- [ ] **Step 7.2: Update electron/main.js — create profiles directory on launch**

In `electron/main.js`, inside the `seedUserData` function, after this line:

```javascript
  fs.mkdirSync(path.join(userDataDir, 'readings'), { recursive: true });
```

Add:

```javascript
  fs.mkdirSync(path.join(userDataDir, 'profiles'), { recursive: true });
```

- [ ] **Step 7.3: Update package.json build files array**

In `package.json`, the `build.files` array contains `"data/**/*.json"`. This excludes the new `.js` modules from the Electron build. After that line, add:

```json
"data/interpretation-cache.js",
"data/reader-profile.js",
"scripts/seed-cache.js",
```

The full `files` array should now look like:

```json
"files": [
  "electron/**/*",
  "public/**/*",
  "data/**/*.json",
  "data/interpretation-cache.js",
  "data/reader-profile.js",
  "scripts/seed-cache.js",
  "server.js",
  "package.json",
  "!node_modules/{electron,electron-builder,@electron,app-builder-lib,jimp,png2icons,@jimp,dmg-builder,dmg-license,app-builder-bin,7zip-bin,builder-util,builder-util-runtime}/**/*",
  "!**/*.{md,map,ts,tsx}",
  "!**/{test,tests,__tests__,example,examples,.github,.nyc_output,coverage,docs}/**"
]
```

- [ ] **Step 7.4: Commit**

```bash
git add .gitignore electron/main.js package.json
git commit -m "chore: update gitignore, Electron build config, and main.js for cache and profiles"
```

---

### Task 8: End-to-End Verification

- [ ] **Step 8.1: Full fallback chain test**

Start the server: `node server.js`

Open `http://localhost:3000` in a browser. Draw a card. Confirm interpretation appears and no errors in console.

Check cache has the entry: `curl http://localhost:3000/api/cache/stats`

- [ ] **Step 8.2: Test cache fallback (offline simulation)**

Temporarily rename the API key entry to disable Claude. Stop Ollama. Draw a card that was previously drawn.

Expected: Interpretation returns from cache. Server console shows `✓ Served from cache`.

Restore config and restart Ollama when done.

- [ ] **Step 8.3: Test manual profile refresh**

```bash
curl -X POST http://localhost:3000/api/profiles/matt/refresh
```

If fewer than 10 readings exist: Expected `{"ok":true,"readings_synthesized":0}` (not enough data, profile not generated — that's correct behavior).

If 10+ readings exist: Expected `{"ok":true,"readings_synthesized":N}` and `data/profiles/matt.json` created with `miriel_notes` populated.

- [ ] **Step 8.4: Run all tests one final time**

```bash
node --test tests/interpretation-cache.test.js
node --test tests/reader-profile.test.js
```

Expected: All 12 tests pass.
