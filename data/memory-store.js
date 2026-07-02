'use strict';
const path = require('path');
const Database = require('better-sqlite3');

// Allowed values, exported so callers (applyOps, added in a later task) can validate.
const TYPES    = ['person', 'thread', 'event', 'feeling', 'prediction', 'fact', 'preference'];
const STATUSES = ['open', 'moving', 'resolved', 'dormant'];
const VERDICTS = ['came_to_pass', 'did_not', 'partly'];
const DORMANT_DAYS         = 60;
const DORMANT_SALIENCE_BAR = 3;

function clampSalience(n) {
  const v = parseInt(n, 10);
  if (Number.isNaN(v)) return 3;
  return Math.min(5, Math.max(1, v));
}

module.exports = function createMemoryStore(dataDir) {
  const db = new Database(path.join(dataDir, 'memory.db'));
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS memories (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      reader_slug        TEXT NOT NULL,
      type               TEXT NOT NULL,
      content            TEXT NOT NULL,
      status             TEXT,
      salience           INTEGER NOT NULL DEFAULT 3,
      subject            TEXT,
      source_kind        TEXT NOT NULL,
      source_id          TEXT,
      created_at         INTEGER NOT NULL,
      updated_at         INTEGER NOT NULL,
      last_referenced_at INTEGER,
      reference_count    INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_mem_slug        ON memories(reader_slug);
    CREATE INDEX IF NOT EXISTS idx_mem_slug_type   ON memories(reader_slug, type);
    CREATE INDEX IF NOT EXISTS idx_mem_slug_status ON memories(reader_slug, status);
    CREATE INDEX IF NOT EXISTS idx_mem_slug_sal    ON memories(reader_slug, salience);

    CREATE TABLE IF NOT EXISTS memory_links (
      from_id  INTEGER NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
      to_id    INTEGER NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
      relation TEXT NOT NULL,
      PRIMARY KEY (from_id, to_id, relation)
    );

    CREATE TABLE IF NOT EXISTS memory_meta (
      key   TEXT PRIMARY KEY,
      value TEXT
    );
  `);

  // Phase-2 migration: add asked_at to pre-existing dbs (CREATE TABLE IF NOT EXISTS
  // never alters an existing table).
  const cols = db.prepare(`PRAGMA table_info(memories)`).all().map(c => c.name);
  if (!cols.includes('asked_at')) {
    db.exec(`ALTER TABLE memories ADD COLUMN asked_at INTEGER`);
  }

  const now = () => Math.floor(Date.now() / 1000);

  const stmtAdd = db.prepare(`
    INSERT INTO memories
      (reader_slug, type, content, status, salience, subject, source_kind, source_id, created_at, updated_at)
    VALUES
      (@reader_slug, @type, @content, @status, @salience, @subject, @source_kind, @source_id, @created_at, @updated_at)
  `);
  const stmtGet = db.prepare('SELECT * FROM memories WHERE id = ?');
  const stmtGetForSlug = db.prepare('SELECT * FROM memories WHERE id = ? AND reader_slug = ?');
  const stmtUpdate = db.prepare(`
    UPDATE memories SET
      content    = COALESCE(@content,  content),
      status     = COALESCE(@status,   status),
      salience   = COALESCE(@salience, salience),
      subject    = COALESCE(@subject,  subject),
      updated_at = @updated_at
    WHERE id = @id AND reader_slug = @reader_slug
  `);
  const stmtTouch = db.prepare(`
    UPDATE memories SET reference_count = reference_count + 1, updated_at = ?
    WHERE id = ? AND reader_slug = ?
  `);
  const stmtList = db.prepare('SELECT * FROM memories WHERE reader_slug = ? ORDER BY created_at DESC');
  const stmtOpenSalient = db.prepare(`
    SELECT * FROM memories
    WHERE reader_slug = ?
    ORDER BY (status = 'open') DESC, salience DESC, updated_at DESC
    LIMIT ?
  `);
  const stmtMarkRef = db.prepare(`
    UPDATE memories SET reference_count = reference_count + 1, last_referenced_at = ?
    WHERE id = ?
  `);
  const stmtLink     = db.prepare('INSERT OR IGNORE INTO memory_links (from_id, to_id, relation) VALUES (?, ?, ?)');
  const stmtGetLinks = db.prepare('SELECT * FROM memory_links WHERE from_id = ?');
  const stmtGetMeta  = db.prepare('SELECT value FROM memory_meta WHERE key = ?');
  const stmtSetMeta  = db.prepare(`
    INSERT INTO memory_meta (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `);
  const stmtStats = db.prepare('SELECT type, COUNT(*) AS cnt FROM memories WHERE reader_slug = ? GROUP BY type');
  const stmtOpenUnasked = db.prepare(`
    SELECT * FROM memories
    WHERE reader_slug = ? AND type = 'thread'
      AND status IN ('open','moving') AND asked_at IS NULL AND salience >= ?
    ORDER BY salience DESC, updated_at DESC
    LIMIT ?
  `);
  const stmtMarkAsked = db.prepare(`UPDATE memories SET asked_at = ? WHERE id = ?`);
  // Ripe = open prediction aged past a per-id jittered window: base 14 days, +/-3
  // jitter from (id % 7) -> an 11..17 day threshold, stable per row so it never
  // flickers. Measured from COALESCE(asked_at, created_at) so a deferred ('too_soon')
  // prediction re-ripens a fresh window after it was last asked, not its birth.
  const stmtRipePredictions = db.prepare(`
    SELECT * FROM memories
    WHERE reader_slug = ? AND type = 'prediction' AND status = 'open'
      AND (? - COALESCE(asked_at, created_at)) >= (14 + (id % 7) - 3) * 86400
    ORDER BY salience DESC, updated_at DESC
    LIMIT ?
  `);
  // Dormant = an open/moving, salient thread untouched past a per-id jittered
  // window: base 60 days, +/-3 from (id % 7) -> 57..63 days, stable per row so it
  // never flickers. Measured from MAX(asked_at, updated_at) -- the more recent of
  // the last ask and the last touch -- so re-engaging a thread (a fresh updated_at)
  // rests it for another window, and asking about it (asked_at) also rests it
  // (ask-once-then-rest). Quietest, most salient first. Mirrors stmtRipePredictions.
  const stmtDormantThreads = db.prepare(`
    SELECT * FROM memories
    WHERE reader_slug = ? AND type = 'thread'
      AND status IN ('open','moving') AND salience >= ${DORMANT_SALIENCE_BAR}
      AND (? - MAX(IFNULL(asked_at, 0), updated_at)) >= (${DORMANT_DAYS} + (id % 7) - 3) * 86400
    ORDER BY salience DESC, updated_at ASC
    LIMIT ?
  `);
  const stmtResolveStatus = db.prepare(`UPDATE memories SET status = 'resolved', updated_at = ? WHERE id = ? AND reader_slug = ?`);
  const stmtResolvedPredictions = db.prepare(`
    SELECT p.id AS prediction_id,
           p.content AS foretelling,
           p.updated_at AS resolved_at,
           e.content AS outcome,
           e.subject AS verdict_tag
    FROM memories p
    JOIN memory_links l ON l.to_id = p.id AND l.relation = 'resolves'
    JOIN memories e ON e.id = l.from_id
    WHERE p.reader_slug = ? AND p.type = 'prediction' AND p.status = 'resolved'
    ORDER BY p.updated_at DESC
    LIMIT ?
  `);

  const stmtOpenPredictions = db.prepare(`
    SELECT id, content, created_at, salience
    FROM memories
    WHERE reader_slug = ? AND type = 'prediction' AND status = 'open'
    ORDER BY created_at DESC
    LIMIT ?
  `);

  function addMemory(slug, m) {
    const t = now();
    const info = stmtAdd.run({
      reader_slug: slug,
      type:        m.type,
      content:     m.content,
      status:      m.status || null,
      salience:    clampSalience(m.salience),
      subject:     m.subject || null,
      source_kind: m.source_kind || 'reading',
      source_id:   m.source_id != null ? String(m.source_id) : null,
      created_at:  t,
      updated_at:  t,
    });
    return Number(info.lastInsertRowid);
  }

  function getMemory(id) { return stmtGet.get(id) || null; }

  function applyOps(slug, ops, sourceKind, sourceId) {
    const result = { added: 0, updated: 0, touched: 0, resolved: 0, deferred: 0 };
    if (!Array.isArray(ops)) return result;
    const t = now();
    for (const op of ops) {
      if (!op || typeof op !== 'object') continue;
      const kind = String(op.op || '').toUpperCase();
      if (kind === 'ADD') {
        if (!TYPES.includes(op.type)) continue;
        if (!op.content || !String(op.content).trim()) continue;
        addMemory(slug, {
          type:        op.type,
          content:     String(op.content).trim(),
          status:      STATUSES.includes(op.status) ? op.status : null,
          salience:    op.salience,
          subject:     op.subject,
          source_kind: sourceKind,
          source_id:   sourceId,
        });
        result.added++;
      } else if (kind === 'UPDATE') {
        if (!stmtGetForSlug.get(op.id, slug)) continue;
        stmtUpdate.run({
          id:          op.id,
          reader_slug: slug,
          content:     op.content != null && String(op.content).trim() ? String(op.content).trim() : null,
          status:      STATUSES.includes(op.status) ? op.status : null,
          salience:    op.salience != null ? clampSalience(op.salience) : null,
          subject:     op.subject  != null ? String(op.subject) : null,
          updated_at:  t,
        });
        result.updated++;
      } else if (kind === 'TOUCH') {
        if (stmtTouch.run(t, op.id, slug).changes) result.touched++;
      } else if (kind === 'RESOLVE') {
        const row = stmtGetForSlug.get(op.id, slug);
        if (!row) continue;
        const verdict = typeof op.verdict === 'string' ? op.verdict : null;
        if (verdict === 'too_soon') {
          // Defer: re-stamp asked_at (leave status open); op.outcome is intentionally
          // dropped — nothing concluded yet, so there is no outcome to record.
          markAsked([op.id]);
          result.deferred++;
          continue;
        }
        stmtResolveStatus.run(t, op.id, slug);
        if (op.outcome && String(op.outcome).trim()) {
          const outcomeId = addMemory(slug, {
            type: 'event', content: String(op.outcome).trim(),
            subject: VERDICTS.includes(verdict) ? `verdict:${verdict}` : null,
            salience: op.salience, source_kind: sourceKind, source_id: sourceId,
          });
          stmtLink.run(outcomeId, op.id, 'resolves');
        }
        result.resolved++;
      }
    }
    return result;
  }

  function listMemories(slug) { return stmtList.all(slug); }

  function getOpenAndSalient(slug, limit = 40) { return stmtOpenSalient.all(slug, limit); }

  function markReferenced(ids) {
    if (!Array.isArray(ids) || !ids.length) return;
    const t = now();
    const tx = db.transaction((arr) => { for (const id of arr) stmtMarkRef.run(t, id); });
    tx(ids);
  }

  function linkMemories(fromId, toId, relation) { stmtLink.run(fromId, toId, relation); }
  function getLinks(fromId) { return stmtGetLinks.all(fromId); }

  function getMeta(key) { const r = stmtGetMeta.get(key); return r ? r.value : null; }
  function setMeta(key, value) { stmtSetMeta.run(key, String(value)); }

  function getStats(slug) {
    const out = {};
    for (const r of stmtStats.all(slug)) out[r.type] = r.cnt;
    return out;
  }

  function getResolvedPredictions(slug, limit = 20) {
    return stmtResolvedPredictions.all(slug, limit).map(r => ({
      prediction_id: r.prediction_id,
      foretelling:   r.foretelling,
      outcome:       r.outcome,
      verdict:       typeof r.verdict_tag === 'string' && r.verdict_tag.startsWith('verdict:')
                       ? r.verdict_tag.slice('verdict:'.length)
                       : null,
      resolved_at:   r.resolved_at,
    }));
  }

  function getOpenPredictions(slug, limit = 12) {
    return stmtOpenPredictions.all(slug, limit);
  }

  function getOpenUnaskedThreads(slug, limit = 3, minSalience = 3) {
    return stmtOpenUnasked.all(slug, minSalience, limit);
  }

  function getRipePredictions(slug, limit = 3, nowTs = now()) {
    return stmtRipePredictions.all(slug, nowTs, limit);
  }

  function getDormantThreads(slug, limit = 2, nowTs = now()) {
    return stmtDormantThreads.all(slug, nowTs, limit);
  }

  function markAsked(ids) {
    if (!Array.isArray(ids) || !ids.length) return;
    const t = now();
    const tx = db.transaction((arr) => { for (const id of arr) stmtMarkAsked.run(t, id); });
    tx(ids);
  }

  return {
    addMemory, getMemory, applyOps, listMemories,
    getOpenAndSalient, markReferenced,
    getOpenUnaskedThreads, getRipePredictions, getDormantThreads, markAsked,
    getResolvedPredictions, getOpenPredictions,
    linkMemories, getLinks, getMeta, setMeta, getStats,
    _db: db, _now: now, TYPES, STATUSES, VERDICTS, clampSalience,
    DORMANT_DAYS, DORMANT_SALIENCE_BAR,
  };
};
