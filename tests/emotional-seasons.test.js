'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const createMemoryStore = require('../data/memory-store');
const createEmotionalSeasons = require('../data/emotional-seasons');
const { detectSeasonShift, detectRecurringTheme } = require('../data/emotional-seasons');

function tmpDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'tarot-seasons-')); }
const DAY = 86400;

function season(index, valence, label, themes, endedDaysAgo, now) {
  return { index, valence, label, themes: themes || [], summary: `${label} summary`,
           started_at: now - (endedDaysAgo + 25) * DAY, ended_at: now - endedDaysAgo * DAY };
}

test('listFeelings returns only feeling atoms, ascending by created_at', () => {
  const store = createMemoryStore(tmpDir());
  const now = store._now();
  const a = store.addMemory('matt', { type: 'feeling', content: 'older feeling', salience: 3 });
  const b = store.addMemory('matt', { type: 'feeling', content: 'newer feeling', salience: 3 });
  store.addMemory('matt', { type: 'thread', content: 'not a feeling', status: 'open', salience: 4 });
  store._db.prepare('UPDATE memories SET created_at = ? WHERE id = ?').run(now - 10 * DAY, a);
  store._db.prepare('UPDATE memories SET created_at = ? WHERE id = ?').run(now - 2 * DAY, b);
  const seasons = createEmotionalSeasons(store);
  const got = seasons.listFeelings('matt');
  assert.deepEqual(got.map(f => f.content), ['older feeling', 'newer feeling']);
});

test('detectSeasonShift returns null with fewer than 2 seasons', () => {
  const now = 1_000_000_000;
  assert.equal(detectSeasonShift([], now), null);
  assert.equal(detectSeasonShift([season(0, -2, 'a', [], 100, now)], now), null);
});

test('detectSeasonShift returns null when the valence delta is below threshold', () => {
  const now = 1_000_000_000;
  const seasons = [season(0, 0, 'flat', [], 100, now), season(1, 1, 'slightly up', [], 10, now)];
  assert.equal(detectSeasonShift(seasons, now), null);
});

test('detectSeasonShift emits a shift with correct signature when delta >= 2', () => {
  const now = 1_000_000_000;
  const seasons = [season(0, -2, 'the heavy winter', ['fear'], 120, now),
                   season(1, 2, 'the lighter spring', ['hope'], 10, now)];
  const shift = detectSeasonShift(seasons, now);
  assert.ok(shift);
  assert.equal(shift.kind, 'season-shift');
  assert.equal(shift.signature, 'season-shift:0->1');
  assert.match(shift.fact, /heavy winter/);
  assert.match(shift.fact, /lighter spring/);
});

test('detectSeasonShift picks the most-contrasting earlier season', () => {
  const now = 1_000_000_000;
  const seasons = [season(0, 1, 'mild', [], 200, now),
                   season(1, -2, 'the low', [], 120, now),
                   season(2, 2, 'now', [], 10, now)];
  const shift = detectSeasonShift(seasons, now);
  assert.equal(shift.signature, 'season-shift:1->2'); // |2-(-2)|=4 beats |2-1|=1
});

test('detectSeasonShift tie-breaks toward the more recent earlier season', () => {
  const now = 1_000_000_000;
  const seasons = [season(0, 0, 'first', [], 200, now),
                   season(1, 0, 'second', [], 100, now),
                   season(2, 2, 'now', [], 10, now)];
  const shift = detectSeasonShift(seasons, now); // both deltas == 2; pick index 1
  assert.equal(shift.signature, 'season-shift:1->2');
});

// A fake callLLM returning a fixed season JSON; records how many times it is called.
function fakeLLM(record) {
  return async () => {
    if (record) record.calls++;
    return JSON.stringify({ label: 'the heavy winter', valence: -2, themes: ['fear', 'the move'], summary: 'You carry a weight right now.' });
  };
}

function addFeeling(store, slug, content, daysAgo, now) {
  const id = store.addMemory(slug, { type: 'feeling', content, salience: 3 });
  store._db.prepare('UPDATE memories SET created_at = ? WHERE id = ?').run(now - daysAgo * DAY, id);
  return id;
}

test('updateSeasons appends one record when >= 4 new feelings exist', async () => {
  const store = createMemoryStore(tmpDir());
  const now = store._now();
  for (let i = 0; i < 4; i++) addFeeling(store, 'matt', `feeling ${i}`, 20 - i, now);
  const seasons = createEmotionalSeasons(store);
  const res = await seasons.updateSeasons('matt', fakeLLM());
  assert.equal(res.added, 1);
  const timeline = JSON.parse(store.getMeta('seasons:matt'));
  assert.equal(timeline.length, 1);
  assert.equal(timeline[0].index, 0);
  assert.equal(timeline[0].valence, -2);
  assert.deepEqual(timeline[0].themes, ['fear', 'the move']);
});

test('updateSeasons does nothing with fewer than 4 new feelings', async () => {
  const store = createMemoryStore(tmpDir());
  const now = store._now();
  for (let i = 0; i < 3; i++) addFeeling(store, 'matt', `feeling ${i}`, 10 - i, now);
  const seasons = createEmotionalSeasons(store);
  const res = await seasons.updateSeasons('matt', fakeLLM());
  assert.equal(res.added, 0);
  assert.equal(store.getMeta('seasons:matt'), null);
});

test('updateSeasons only considers feelings newer than the last season ended_at', async () => {
  const store = createMemoryStore(tmpDir());
  const now = store._now();
  // Pre-seed a timeline whose last season ended 5 days ago.
  store.setMeta('seasons:matt', JSON.stringify([{ index: 0, started_at: now - 40 * DAY, ended_at: now - 5 * DAY, label: 'old', valence: 0, themes: [], summary: 'x' }]));
  // 3 feelings AFTER the window end -> not enough -> no new record.
  for (let i = 0; i < 3; i++) addFeeling(store, 'matt', `recent ${i}`, 4 - i, now);
  const seasons = createEmotionalSeasons(store);
  assert.equal((await seasons.updateSeasons('matt', fakeLLM())).added, 0);
});

test('updateSeasons is best-effort: a callLLM throw leaves the timeline unchanged', async () => {
  const store = createMemoryStore(tmpDir());
  const now = store._now();
  for (let i = 0; i < 4; i++) addFeeling(store, 'matt', `feeling ${i}`, 20 - i, now);
  const seasons = createEmotionalSeasons(store);
  const throwing = async () => { throw new Error('llm down'); };
  const res = await seasons.updateSeasons('matt', throwing);
  assert.equal(res.added, 0);
  assert.equal(store.getMeta('seasons:matt'), null);
});

test('backfillSeasons buckets history into windows and is idempotent', async () => {
  const store = createMemoryStore(tmpDir());
  const now = store._now();
  // Window A ~around 120 days ago (4 feelings within 30d), Window B ~recent (4 feelings).
  for (let i = 0; i < 4; i++) addFeeling(store, 'matt', `old ${i}`, 120 - i, now);
  for (let i = 0; i < 4; i++) addFeeling(store, 'matt', `new ${i}`, 10 - i, now);
  const seasons = createEmotionalSeasons(store);
  const rec = { calls: 0 };
  const res = await seasons.backfillSeasons('matt', fakeLLM(rec));
  assert.equal(res.added, 2);
  assert.equal(rec.calls, 2);
  const timeline = JSON.parse(store.getMeta('seasons:matt'));
  assert.equal(timeline.length, 2);
  assert.equal(timeline[0].index, 0);
  assert.equal(timeline[1].index, 1);
  // Idempotent: a second run skips.
  const again = await seasons.backfillSeasons('matt', fakeLLM(rec));
  assert.deepEqual(again, { skipped: true });
  assert.equal(rec.calls, 2);
});

test('backfillSeasons: a callLLM throw propagates and does not set the flag', async () => {
  const store = createMemoryStore(tmpDir());
  const now = store._now();
  for (let i = 0; i < 4; i++) addFeeling(store, 'matt', `f ${i}`, 10 - i, now);
  const seasons = createEmotionalSeasons(store);
  const throwing = async () => { throw new Error('llm down'); };
  await assert.rejects(() => seasons.backfillSeasons('matt', throwing));
  assert.equal(store.getMeta('seasons_backfilled:matt'), null); // flag NOT set -> retries next boot
});

test('updateSeasons excludes a feeling exactly AT the last season ended_at (strictly greater)', async () => {
  const store = createMemoryStore(tmpDir());
  const now = store._now();
  const endedAt = now - 5 * DAY;
  store.setMeta('seasons:matt', JSON.stringify([{ index: 0, started_at: now - 40 * DAY, ended_at: endedAt, label: 'old', valence: 0, themes: [], summary: 'x' }]));
  // Four feelings: three strictly AFTER endedAt, one EXACTLY at endedAt (must be excluded -> only 3 qualify -> no new season).
  const ids = [];
  for (let i = 0; i < 4; i++) ids.push(store.addMemory('matt', { type: 'feeling', content: `f ${i}`, salience: 3 }));
  store._db.prepare('UPDATE memories SET created_at = ? WHERE id = ?').run(endedAt, ids[0]);          // exactly at -> excluded
  store._db.prepare('UPDATE memories SET created_at = ? WHERE id = ?').run(endedAt + 1 * DAY, ids[1]);
  store._db.prepare('UPDATE memories SET created_at = ? WHERE id = ?').run(endedAt + 2 * DAY, ids[2]);
  store._db.prepare('UPDATE memories SET created_at = ? WHERE id = ?').run(endedAt + 3 * DAY, ids[3]);
  const seasons = createEmotionalSeasons(store);
  const fake = async () => JSON.stringify({ label: 'x', valence: 0, themes: [], summary: 'y' });
  assert.equal((await seasons.updateSeasons('matt', fake)).added, 0); // only 3 strictly-after -> below the 4 gate
});

function seasonWithThemes(index, themes) {
  return { index, valence: 0, label: `s${index}`, themes, summary: 'x',
           started_at: 0, ended_at: 0 };
}

test('detectRecurringTheme returns null with fewer than 2 seasons', () => {
  assert.equal(detectRecurringTheme([]), null);
  assert.equal(detectRecurringTheme([seasonWithThemes(0, ['fear', 'hope'])]), null);
});

test('detectRecurringTheme returns null when no theme repeats across seasons', () => {
  const seasons = [seasonWithThemes(0, ['fear']), seasonWithThemes(1, ['hope'])];
  assert.equal(detectRecurringTheme(seasons), null);
});

test('detectRecurringTheme emits a theme present in >= 2 distinct seasons', () => {
  const seasons = [seasonWithThemes(0, ['fear', 'the move']),
                   seasonWithThemes(1, ['hope']),
                   seasonWithThemes(2, ['fear'])];
  const got = detectRecurringTheme(seasons);
  assert.ok(got);
  assert.equal(got.theme, 'fear');
  assert.equal(got.seasons, 2);
  assert.match(got.fact, /fear/);
  // eslint-disable-next-line no-control-regex -- intentional: asserts output is ASCII-only
  assert.ok(/^[\x00-\x7F]*$/.test(got.fact), 'fact must be ASCII only');
});

test('detectRecurringTheme is case-insensitive when tallying', () => {
  const seasons = [seasonWithThemes(0, ['Fear']), seasonWithThemes(1, ['FEAR'])];
  const got = detectRecurringTheme(seasons);
  assert.equal(got.theme, 'fear');
  assert.equal(got.seasons, 2);
});

test('detectRecurringTheme ranks by distinct-season count first', () => {
  const seasons = [seasonWithThemes(0, ['fear', 'doubt']),
                   seasonWithThemes(1, ['fear', 'doubt']),
                   seasonWithThemes(2, ['fear'])];
  // fear in 3 seasons, doubt in 2 -> fear wins.
  assert.equal(detectRecurringTheme(seasons).theme, 'fear');
});

test('detectRecurringTheme tie-breaks equal distinct counts by recency', () => {
  // both 'old' and 'new' appear in exactly 2 distinct seasons with equal total occurrences;
  // 'new' recurs in the more recent seasons -> wins on recency.
  const seasons = [seasonWithThemes(0, ['old']),
                   seasonWithThemes(1, ['old']),
                   seasonWithThemes(2, ['new']),
                   seasonWithThemes(3, ['new'])];
  assert.equal(detectRecurringTheme(seasons).theme, 'new');
});
