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
    return `[Reading assembled from individual card interpretations - no exact spread match found offline]\n\n${parts.join('\n\n---\n\n')}`;
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
