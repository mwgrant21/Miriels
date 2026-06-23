'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { findProphecyCallbacks } = require('../data/prophecy-recall');

const card = (name) => ({ name });
const res = (o) => Object.assign(
  { prediction_id: 1, foretelling: 'f', outcome: 'o', verdict: 'came_to_pass', resolved_at: 1000 }, o);
const opn = (o) => Object.assign(
  { id: 1, content: 'c', created_at: 1000, salience: 3 }, o);

test('a came_to_pass prediction surfaces as fulfilled with its outcome in the fact', () => {
  const out = findProphecyCallbacks({
    resolved: [res({ foretelling: 'friction in the move', outcome: 'the move was hard', verdict: 'came_to_pass' })],
    open: [], currentCards: [card('The Tower')], question: 'the move',
  });
  assert.equal(out.length, 1);
  assert.equal(out[0].kind, 'fulfilled');
  assert.equal(out[0].verdict, 'came_to_pass');
  assert.match(out[0].fact, /friction in the move/);
  assert.match(out[0].fact, /came to pass/i);
  assert.match(out[0].fact, /the move was hard/);
});

test('an open prediction surfaces as kind open, still unfolding', () => {
  const out = findProphecyCallbacks({
    resolved: [], open: [opn({ content: 'this connection will not last the season' })],
    currentCards: [], question: '',
  });
  assert.equal(out.length, 1);
  assert.equal(out[0].kind, 'open');
  assert.equal(out[0].verdict, null);
  assert.match(out[0].fact, /still unfolding/i);
  assert.match(out[0].fact, /connection will not last/);
});

test('hits rank before misses (verdict weight ordering)', () => {
  const out = findProphecyCallbacks({
    resolved: [
      res({ prediction_id: 1, foretelling: 'A', outcome: 'a', verdict: 'did_not', resolved_at: 2000 }),
      res({ prediction_id: 2, foretelling: 'B', outcome: 'b', verdict: 'came_to_pass', resolved_at: 1000 }),
    ],
    open: [], currentCards: [], question: '',
  });
  assert.equal(out[0].verdict, 'came_to_pass', 'the hit leads despite being older');
  assert.equal(out[1].verdict, 'did_not');
});

test('question/card overlap boosts a matching prediction above a non-matching one', () => {
  const out = findProphecyCallbacks({
    resolved: [
      res({ prediction_id: 1, foretelling: 'something about gardening', outcome: 'x', verdict: 'came_to_pass', resolved_at: 2000 }),
      res({ prediction_id: 2, foretelling: 'tension at your workplace', outcome: 'y', verdict: 'came_to_pass', resolved_at: 1000 }),
    ],
    open: [], currentCards: [], question: 'will the workplace tension ease?',
  });
  assert.match(out[0].fact, /workplace/, 'the overlapping foretelling ranks first despite being older');
});

test('caps the combined result at 3', () => {
  const resolved = [];
  for (let i = 1; i <= 5; i++) {
    resolved.push(res({ prediction_id: i, foretelling: 'f' + i, outcome: 'o' + i, verdict: 'came_to_pass', resolved_at: i }));
  }
  const open = [opn({ id: 9, content: 'still going' })];
  const out = findProphecyCallbacks({ resolved, open, currentCards: [], question: '' });
  assert.ok(out.length <= 3, 'no more than 3');
});

test('empty inputs return []', () => {
  assert.deepEqual(findProphecyCallbacks({ resolved: [], open: [], currentCards: [], question: '' }), []);
  assert.deepEqual(findProphecyCallbacks({}), []);
});

test('returned items carry the prediction id (resolved prediction_id, open id)', () => {
  const out = findProphecyCallbacks({
    resolved: [res({ prediction_id: 42, foretelling: 'a', outcome: 'b', verdict: 'came_to_pass' })],
    open: [opn({ id: 99, content: 'c' })],
    currentCards: [], question: '',
  });
  const ids = out.map(i => i.id).sort((a, b) => a - b);
  assert.deepEqual(ids, [42, 99]);
});

test('a recently surfaced foretelling is filtered out within the TTL', () => {
  const now = 1_000_000_000_000;
  const out = findProphecyCallbacks({
    resolved: [
      res({ prediction_id: 1, foretelling: 'workplace tension', outcome: 'x', verdict: 'came_to_pass' }),
      res({ prediction_id: 2, foretelling: 'a move across the country', outcome: 'y', verdict: 'came_to_pass' }),
    ],
    open: [], currentCards: [], question: '',
    surfaced: { 1: now - 1 * 86400 * 1000 }, // id 1 shown yesterday
    now, ttlDays: 21,
  });
  const ids = out.map(i => i.id);
  assert.ok(!ids.includes(1), 'id 1 surfaced yesterday must be suppressed');
  assert.ok(ids.includes(2), 'id 2 never surfaced must remain');
});

test('a foretelling surfaced longer ago than the TTL is allowed back', () => {
  const now = 1_000_000_000_000;
  const out = findProphecyCallbacks({
    resolved: [res({ prediction_id: 1, foretelling: 'workplace tension', outcome: 'x', verdict: 'came_to_pass' })],
    open: [], currentCards: [], question: '',
    surfaced: { 1: now - 40 * 86400 * 1000 }, // shown 40 days ago, past 21d TTL
    now, ttlDays: 21,
  });
  assert.deepEqual(out.map(i => i.id), [1]);
});

test('omitting surfaced/now applies no filtering (backward compatible)', () => {
  const out = findProphecyCallbacks({
    resolved: [res({ prediction_id: 1, foretelling: 'a', outcome: 'b', verdict: 'came_to_pass' })],
    open: [], currentCards: [], question: '',
  });
  assert.equal(out.length, 1);
  assert.equal(out[0].id, 1);
});

test('fact strings contain no em dashes', () => {
  const out = findProphecyCallbacks({
    resolved: [res({ foretelling: 'a', outcome: 'b', verdict: 'partly' })],
    open: [opn({ content: 'c' })],
    currentCards: [], question: '',
  });
  for (const item of out) assert.ok(!item.fact.includes('—'), 'no em dash in: ' + item.fact);
});
