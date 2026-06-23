'use strict';
const { test } = require('node:test');
const assert   = require('node:assert/strict');
const os   = require('os');
const path = require('path');
const fs   = require('fs');
const createMemoryStore = require('../data/memory-store');

function tmpDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'tarot-memory-')); }

test('addMemory then getMemory round-trips core fields', () => {
  const store = createMemoryStore(tmpDir());
  const id = store.addMemory('matt', {
    type: 'thread', content: 'worried about the job interview',
    status: 'open', salience: 4, subject: 'work',
  });
  const m = store.getMemory(id);
  assert.equal(m.reader_slug, 'matt');
  assert.equal(m.type, 'thread');
  assert.equal(m.content, 'worried about the job interview');
  assert.equal(m.status, 'open');
  assert.equal(m.salience, 4);
  assert.equal(m.subject, 'work');
  assert.equal(m.reference_count, 0);
  assert.ok(m.created_at > 0);
});

test('addMemory clamps salience into 1..5 and defaults to 3', () => {
  const store = createMemoryStore(tmpDir());
  const a = store.getMemory(store.addMemory('matt', { type: 'fact', content: 'x', salience: 99 }));
  const b = store.getMemory(store.addMemory('matt', { type: 'fact', content: 'y' }));
  assert.equal(a.salience, 5);
  assert.equal(b.salience, 3);
});

test('getMemory returns null for an unknown id', () => {
  const store = createMemoryStore(tmpDir());
  assert.equal(store.getMemory(99999), null);
});

test('applyOps ADD inserts only valid-typed, non-empty atoms', () => {
  const store = createMemoryStore(tmpDir());
  const res = store.applyOps('matt', [
    { op: 'ADD', type: 'thread', content: 'a real thread', status: 'open', salience: 3 },
    { op: 'ADD', type: 'bogus',  content: 'ignored' },
    { op: 'ADD', type: 'fact',   content: '' },
  ], 'reading', 42);
  assert.equal(res.added, 1);
  const all = store.listMemories('matt');
  assert.equal(all.length, 1);
  assert.equal(all[0].source_kind, 'reading');
  assert.equal(all[0].source_id, '42');
});

test('applyOps UPDATE changes fields only for the matching slug', () => {
  const store = createMemoryStore(tmpDir());
  const id = store.addMemory('matt', { type: 'thread', content: 't', status: 'open' });
  store.applyOps('matt', [{ op: 'UPDATE', id, status: 'moving' }], 'reading', 1);
  assert.equal(store.getMemory(id).status, 'moving');
  store.applyOps('other', [{ op: 'UPDATE', id, status: 'resolved' }], 'reading', 1);
  assert.equal(store.getMemory(id).status, 'moving'); // untouched: wrong slug
});

test('applyOps TOUCH bumps reference_count for matching slug only', () => {
  const store = createMemoryStore(tmpDir());
  const id = store.addMemory('matt', { type: 'fact', content: 'f' });
  assert.equal(store.applyOps('matt', [{ op: 'TOUCH', id }], 'reading', 1).touched, 1);
  assert.equal(store.getMemory(id).reference_count, 1);
  assert.equal(store.applyOps('matt', [{ op: 'TOUCH', id: 9999 }], 'reading', 1).touched, 0);
  // a valid id under the wrong slug must not be touched
  assert.equal(store.applyOps('other', [{ op: 'TOUCH', id }], 'reading', 1).touched, 0);
  assert.equal(store.getMemory(id).reference_count, 1);
});

test('applyOps UPDATE ignores whitespace-only content (keeps existing)', () => {
  const store = createMemoryStore(tmpDir());
  const id = store.addMemory('matt', { type: 'thread', content: 'real content', status: 'open' });
  store.applyOps('matt', [{ op: 'UPDATE', id, content: '   ' }], 'reading', 1);
  assert.equal(store.getMemory(id).content, 'real content');
});

test('applyOps ignores non-array input and junk ops safely', () => {
  const store = createMemoryStore(tmpDir());
  assert.deepEqual(store.applyOps('matt', null, 'reading', 1), { added: 0, updated: 0, touched: 0, resolved: 0, deferred: 0 });
  assert.deepEqual(store.applyOps('matt', [null, 5, {}, { op: 'NOPE' }], 'reading', 1),
                   { added: 0, updated: 0, touched: 0, resolved: 0, deferred: 0 });
});

test('getOpenAndSalient orders open + salient first', () => {
  const store = createMemoryStore(tmpDir());
  store.addMemory('matt', { type: 'fact',   content: 'low fact',     salience: 1 });
  store.addMemory('matt', { type: 'thread', content: 'open big',     status: 'open',     salience: 5 });
  store.addMemory('matt', { type: 'thread', content: 'resolved big', status: 'resolved', salience: 5 });
  const rows = store.getOpenAndSalient('matt', 10);
  assert.equal(rows[0].content, 'open big');
});

test('markReferenced bumps reference_count and last_referenced_at', () => {
  const store = createMemoryStore(tmpDir());
  const id = store.addMemory('matt', { type: 'fact', content: 'f' });
  store.markReferenced([id]);
  const m = store.getMemory(id);
  assert.equal(m.reference_count, 1);
  assert.ok(m.last_referenced_at > 0);
});

test('meta get/set round-trips; links insert idempotently', () => {
  const store = createMemoryStore(tmpDir());
  assert.equal(store.getMeta('k'), null);
  store.setMeta('k', '1');
  assert.equal(store.getMeta('k'), '1');
  const a = store.addMemory('matt', { type: 'prediction', content: 'p', status: 'open' });
  const b = store.addMemory('matt', { type: 'event', content: 'e' });
  store.linkMemories(b, a, 'resolves');
  store.linkMemories(b, a, 'resolves'); // duplicate ignored by PK
  assert.equal(store.getLinks(b).length, 1);
});

test('getStats counts by type for the slug only', () => {
  const store = createMemoryStore(tmpDir());
  store.addMemory('matt',  { type: 'fact',   content: 'a' });
  store.addMemory('matt',  { type: 'fact',   content: 'b' });
  store.addMemory('matt',  { type: 'thread', content: 'c', status: 'open' });
  store.addMemory('other', { type: 'fact',   content: 'd' });
  assert.deepEqual(store.getStats('matt'), { fact: 2, thread: 1 });
});

test('asked_at column exists and migrates onto a pre-existing db', () => {
  const dir = tmpDir();
  // simulate a pre-phase-2 db: create memories table WITHOUT asked_at, then open via factory
  const Database = require('better-sqlite3');
  const raw = new Database(require('path').join(dir, 'memory.db'));
  raw.exec(`CREATE TABLE memories (
    id INTEGER PRIMARY KEY AUTOINCREMENT, reader_slug TEXT NOT NULL, type TEXT NOT NULL,
    content TEXT NOT NULL, status TEXT, salience INTEGER NOT NULL DEFAULT 3, subject TEXT,
    source_kind TEXT NOT NULL, source_id TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
    last_referenced_at INTEGER, reference_count INTEGER NOT NULL DEFAULT 0);`);
  raw.close();
  const store = createMemoryStore(dir); // factory must ALTER TABLE to add asked_at
  const id = store.addMemory('matt', { type: 'thread', content: 't', status: 'open' });
  assert.equal(store.getMemory(id).asked_at, null);
});

test('getOpenUnaskedThreads returns only open/moving, unasked, salient threads', () => {
  const store = createMemoryStore(tmpDir());
  store.addMemory('matt', { type: 'thread',  content: 'open salient',  status: 'open',   salience: 4 });
  store.addMemory('matt', { type: 'thread',  content: 'low salience',  status: 'open',   salience: 1 });
  store.addMemory('matt', { type: 'thread',  content: 'resolved',      status: 'resolved', salience: 5 });
  store.addMemory('matt', { type: 'feeling', content: 'not a thread',  status: 'open',   salience: 5 });
  store.addMemory('matt', { type: 'thread',  content: 'moving ok',     status: 'moving', salience: 3 });
  const rows = store.getOpenUnaskedThreads('matt', 10, 3);
  const contents = rows.map(r => r.content);
  assert.ok(contents.includes('open salient'));
  assert.ok(contents.includes('moving ok'));
  assert.ok(!contents.includes('low salience'));
  assert.ok(!contents.includes('resolved'));
  assert.ok(!contents.includes('not a thread'));
});

test('markAsked sets asked_at and excludes from getOpenUnaskedThreads', () => {
  const store = createMemoryStore(tmpDir());
  const id = store.addMemory('matt', { type: 'thread', content: 'ask me', status: 'open', salience: 4 });
  store.markAsked([id]);
  assert.ok(store.getMemory(id).asked_at > 0);
  assert.equal(store.getOpenUnaskedThreads('matt', 10, 3).length, 0);
});

test('applyOps RESOLVE marks the thread resolved, adds an outcome atom, and links them', () => {
  const store = createMemoryStore(tmpDir());
  const threadId = store.addMemory('matt', { type: 'thread', content: 'the Portland job', status: 'open', salience: 4 });
  const res = store.applyOps('matt',
    [{ op: 'RESOLVE', id: threadId, outcome: 'took the job and moved' }], 'threshold', null);
  assert.equal(res.resolved, 1);
  assert.equal(store.getMemory(threadId).status, 'resolved');
  const all = store.listMemories('matt');
  const outcome = all.find(m => m.type === 'event' && m.content === 'took the job and moved');
  assert.ok(outcome);
  assert.equal(outcome.source_kind, 'threshold');
  assert.equal(outcome.subject, null); // no verdict on a thread RESOLVE -> null, not "verdict:null"
  const links = store.getLinks(outcome.id);
  assert.ok(links.some(l => l.to_id === threadId && l.relation === 'resolves'));
});

test('applyOps RESOLVE ignores unknown id / wrong slug and counts nothing', () => {
  const store = createMemoryStore(tmpDir());
  const id = store.addMemory('matt', { type: 'thread', content: 't', status: 'open', salience: 4 });
  assert.equal(store.applyOps('matt',  [{ op: 'RESOLVE', id: 9999, outcome: 'x' }], 'threshold', null).resolved, 0);
  assert.equal(store.applyOps('other', [{ op: 'RESOLVE', id, outcome: 'x' }], 'threshold', null).resolved, 0);
  assert.equal(store.getMemory(id).status, 'open');
});

test('getRipePredictions includes a matured prediction, excludes a fresh one', () => {
  const store = createMemoryStore(tmpDir());
  const now = store._now();
  const id  = store.addMemory('matt', { type: 'prediction', content: 'friction in the move', status: 'open', salience: 4 });
  const threshold = 14 + (id % 7) - 3; // per-id window, 11..17 days
  const setCreated = (daysAgo) =>
    store._db.prepare('UPDATE memories SET created_at = ? WHERE id = ?').run(now - daysAgo * 86400, id);

  setCreated(threshold + 1);
  assert.equal(store.getRipePredictions('matt', 10, now).length, 1);

  setCreated(threshold - 1);
  assert.equal(store.getRipePredictions('matt', 10, now).length, 0);
});

test('getRipePredictions excludes resolved predictions and non-predictions', () => {
  const store = createMemoryStore(tmpDir());
  const now = store._now();
  const old = now - 60 * 86400;
  const rid = store.addMemory('matt', { type: 'prediction', content: 'resolved one', status: 'resolved', salience: 4 });
  const tid = store.addMemory('matt', { type: 'thread',     content: 'a thread',     status: 'open',     salience: 4 });
  store._db.prepare('UPDATE memories SET created_at = ? WHERE id = ?').run(old, rid);
  store._db.prepare('UPDATE memories SET created_at = ? WHERE id = ?').run(old, tid);
  assert.equal(store.getRipePredictions('matt', 10, now).length, 0);
});

test('getRipePredictions re-ripens a deferred prediction relative to asked_at', () => {
  const store = createMemoryStore(tmpDir());
  const now = store._now();
  const id  = store.addMemory('matt', { type: 'prediction', content: 'x', status: 'open', salience: 4 });
  const threshold = 14 + (id % 7) - 3;
  store._db.prepare('UPDATE memories SET created_at = ?, asked_at = ? WHERE id = ?')
    .run(now - 100 * 86400, now, id);
  assert.equal(store.getRipePredictions('matt', 10, now).length, 0);
  store._db.prepare('UPDATE memories SET asked_at = ? WHERE id = ?')
    .run(now - (threshold + 1) * 86400, id);
  assert.equal(store.getRipePredictions('matt', 10, now).length, 1);
});

test('applyOps RESOLVE with a verdict tags the outcome event', () => {
  const store = createMemoryStore(tmpDir());
  const pid = store.addMemory('matt', { type: 'prediction', content: 'friction in the move', status: 'open', salience: 4 });
  const res = store.applyOps('matt',
    [{ op: 'RESOLVE', id: pid, verdict: 'came_to_pass', outcome: 'The move brought the friction we saw.' }],
    'threshold', null);
  assert.equal(res.resolved, 1);
  assert.equal(store.getMemory(pid).status, 'resolved');
  const outcome = store.listMemories('matt').find(m => m.type === 'event' && m.subject === 'verdict:came_to_pass');
  assert.ok(outcome);
  assert.equal(outcome.content, 'The move brought the friction we saw.');
});

test('applyOps RESOLVE too_soon defers without resolving and creates no outcome', () => {
  const store = createMemoryStore(tmpDir());
  const pid = store.addMemory('matt', { type: 'prediction', content: 'x', status: 'open', salience: 4 });
  const res = store.applyOps('matt',
    [{ op: 'RESOLVE', id: pid, verdict: 'too_soon', outcome: 'ignored' }], 'threshold', null);
  assert.equal(res.resolved, 0);
  assert.equal(res.deferred, 1);
  const m = store.getMemory(pid);
  assert.equal(m.status, 'open');
  assert.ok(m.asked_at > 0);
  assert.equal(store.listMemories('matt').filter(x => x.type === 'event').length, 0);
});

test('getResolvedPredictions joins prediction to its voiced outcome and verdict', () => {
  const store = createMemoryStore(tmpDir());
  const pid = store.addMemory('matt', { type: 'prediction', content: 'the move would bring friction', status: 'open', salience: 4 });
  store.applyOps('matt',
    [{ op: 'RESOLVE', id: pid, verdict: 'came_to_pass', outcome: 'The friction came, as the cards saw.' }],
    'threshold', null);

  const rows = store.getResolvedPredictions('matt', 10);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].foretelling, 'the move would bring friction');
  assert.equal(rows[0].outcome, 'The friction came, as the cards saw.');
  assert.equal(rows[0].verdict, 'came_to_pass');
});

test('getResolvedPredictions returns [] when there are none', () => {
  const store = createMemoryStore(tmpDir());
  assert.deepEqual(store.getResolvedPredictions('matt', 10), []);
});
