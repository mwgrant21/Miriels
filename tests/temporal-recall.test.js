'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { findTemporalCallbacks, filterSurfaced } = require('../data/temporal-recall');

const DAY = 86400000;
// Fixed "now": 2026-06-20T12:00:00Z
const NOW = Date.UTC(2026, 5, 20, 12, 0, 0);
function daysAgo(n) { return NOW - n * DAY; }
function reading(ts, extra = {}) {
  return { timestamp: ts, id: extra.id || String(ts), question: extra.question || 'q', cards: extra.cards || [{ name: 'The Tower' }], date: extra.date || 'somedate' };
}

test('anniversary: a reading ~1 year ago today yields a 1y anniversary candidate', () => {
  const oneYear = reading(daysAgo(365), { id: 'r1', question: 'should I leave the job?' });
  const out = findTemporalCallbacks({ readings: [oneYear], lastVisitTs: daysAgo(2), now: NOW });
  const anniv = out.find(c => c.kind === 'anniversary');
  assert.ok(anniv, 'anniversary candidate present');
  assert.match(anniv.signature, /^anniversary:1y:r1$/);
  assert.match(anniv.fact, /should I leave the job/);
});

test('anniversary window: 10 days off does NOT match', () => {
  const off = reading(daysAgo(365 - 10), { id: 'r2' });
  const out = findTemporalCallbacks({ readings: [off], lastVisitTs: daysAgo(1), now: NOW });
  assert.equal(out.find(c => c.kind === 'anniversary'), undefined);
});

test('elapsed: a long gap since last visit yields an elapsed candidate', () => {
  const out = findTemporalCallbacks({ readings: [reading(daysAgo(400))], lastVisitTs: daysAgo(90), now: NOW });
  const el = out.find(c => c.kind === 'elapsed');
  assert.ok(el, 'elapsed candidate present');
  assert.match(el.signature, /^elapsed:/);
});

test('elapsed: a short gap (3 days) yields NO elapsed candidate', () => {
  const out = findTemporalCallbacks({ readings: [reading(daysAgo(400))], lastVisitTs: daysAgo(3), now: NOW });
  assert.equal(out.find(c => c.kind === 'elapsed'), undefined);
});

test('milestone: reading count at a round 50 yields a milestone candidate', () => {
  const readings = Array.from({ length: 100 }, (_, i) => reading(daysAgo(500 - i * 3), { id: 'm' + i }));
  const out = findTemporalCallbacks({ readings, lastVisitTs: daysAgo(1), now: NOW });
  const ms = out.find(c => c.kind === 'milestone');
  assert.ok(ms, 'milestone present at count 100');
  assert.match(ms.signature, /milestone:count:100/);
});

test('ordinary visit with no matches returns []', () => {
  const out = findTemporalCallbacks({ readings: [reading(daysAgo(200)), reading(daysAgo(5))], lastVisitTs: daysAgo(2), now: NOW });
  assert.deepEqual(out, []);
});

test('candidates are sorted strongest-first', () => {
  const readings = [reading(daysAgo(365), { id: 'a' })];
  const out = findTemporalCallbacks({ readings, lastVisitTs: daysAgo(90), now: NOW });
  assert.ok(out.length >= 2);
  for (let i = 1; i < out.length; i++) assert.ok(out[i - 1].strength >= out[i].strength);
});

test('filterSurfaced drops candidates whose signature was recently surfaced', () => {
  const cands = [{ kind: 'milestone', strength: 4, signature: 'milestone:count:100', fact: 'x' }];
  const surfaced = { 'milestone:count:100': NOW - 2 * DAY };
  assert.deepEqual(filterSurfaced(cands, surfaced, NOW, 30), []);
  const stale = { 'milestone:count:100': NOW - 60 * DAY };
  assert.equal(filterSurfaced(cands, stale, NOW, 30).length, 1);
});

test('seasonal: same month a prior year (not ~1y) yields a seasonal candidate, most recent chosen', () => {
  // now = June 2026. Two June readings: June 2024 and June 2023. Neither is ~365d.
  const june2024 = reading(Date.UTC(2024, 5, 10, 12), { id: 's2024', question: 'older june' });
  const june2023 = reading(Date.UTC(2023, 5, 10, 12), { id: 's2023', question: 'oldest june' });
  const out = findTemporalCallbacks({ readings: [june2023, june2024], lastVisitTs: daysAgo(2), now: NOW });
  const s = out.find(c => c.kind === 'seasonal');
  assert.ok(s, 'seasonal candidate present');
  assert.match(s.signature, /^seasonal:2024:s2024$/, 'picks most recent prior-year June');
});

test('milestone-met: ~12 months since first reading yields a met milestone', () => {
  // first reading ~1 year ago; add a recent one so it is not the only/anniversary-dominant case
  const first = reading(daysAgo(365), { id: 'f1' });
  const recent = reading(daysAgo(2), { id: 'f2' });
  const out = findTemporalCallbacks({ readings: [first, recent], lastVisitTs: daysAgo(2), now: NOW });
  const met = out.find(c => c.kind === 'milestone' && /met:12m/.test(c.signature));
  assert.ok(met, 'met:12m milestone present');
  assert.match(met.fact, /1 year/);
});

test('elapsed skipped cleanly when lastVisitTs is null', () => {
  const out = findTemporalCallbacks({ readings: [reading(daysAgo(200))], lastVisitTs: null, now: NOW });
  assert.equal(out.find(c => c.kind === 'elapsed'), undefined);
});

const engine = require('../data/memory-engine');

test('decideThresholdMode fires on a temporal callback even with no threads/predictions', () => {
  const cb = [{ kind: 'anniversary', strength: 5, signature: 'x', fact: 'f' }];
  assert.equal(engine.decideThresholdMode(NOW - 90 * DAY, [], NOW, 14, [], cb), 'reunion');
  assert.equal(engine.decideThresholdMode(NOW - 90 * DAY, [], NOW, 14, [], []), 'none');
});

test('buildGreetingPrompt has no dangling "ask" when only a temporal callback drives it', () => {
  const cb = [{ kind: 'anniversary', strength: 5, signature: 'x', fact: 'One year ago today...' }];
  const gentle = engine.buildGreetingPrompt('gentle', [], 5, [], cb);
  const reunion = engine.buildGreetingPrompt('reunion', [], 90, [], cb);
  assert.ok(!/ask\s+—/.test(gentle) && !/ask\s+\./.test(gentle), 'no empty ask in gentle');
  assert.ok(!/ask\s+\./.test(reunion), 'no empty ask in reunion');
  assert.ok(!/your question/.test(reunion), 'no phantom "your question" suffix on temporal-only reunion');
  assert.match(gentle + reunion, /timing/, 'pivots to timing language');
});
