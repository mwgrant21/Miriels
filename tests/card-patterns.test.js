'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { findCardPatterns } = require('../data/card-patterns');

const DAY = 86400000;
const NOW = Date.UTC(2026, 5, 20, 12, 0, 0);
function daysAgo(n) { return NOW - n * DAY; }
function rdg(ts, cards) { return { timestamp: ts, cards }; }
function card(name, reversed = false) { return { name, isReversed: reversed }; }

test('recurrence: a card drawn several times this month is noticed with accurate counts', () => {
  const readings = [
    rdg(daysAgo(25), [card('The Tower')]),
    rdg(daysAgo(12), [card('The Tower')]),
    rdg(daysAgo(3),  [card('Three of Cups')]),
  ];
  const out = findCardPatterns({ readings, currentCards: [card('The Tower')], now: NOW });
  const rec = out.find(f => f.kind === 'recurrence');
  assert.ok(rec, 'recurrence fact present');
  assert.match(rec.fact, /The Tower/);
  assert.match(rec.fact, /3 times this past month/);
  assert.match(rec.fact, /3rd time/);
});

test('recurrence: a card seen only once before does NOT fire', () => {
  const readings = [rdg(daysAgo(40), [card('The Star')])];
  const out = findCardPatterns({ readings, currentCards: [card('The Star')], now: NOW });
  assert.equal(out.find(f => f.kind === 'recurrence'), undefined);
});

test('reversal tendency: a card that mostly comes reversed is flagged, not as plain recurrence', () => {
  const readings = [
    rdg(daysAgo(100), [card('The Empress', true)]),
    rdg(daysAgo(70),  [card('The Empress', true)]),
    rdg(daysAgo(40),  [card('The Empress', true)]),
  ];
  const out = findCardPatterns({ readings, currentCards: [card('The Empress', true)], now: NOW });
  const rev = out.find(f => f.kind === 'reversal');
  assert.ok(rev, 'reversal fact present');
  assert.match(rev.fact, /reversed/i);
  assert.equal(out.find(f => f.kind === 'recurrence' && /Empress/.test(f.fact)), undefined, 'no duplicate recurrence fact for same card');
});

test('reversal does not fire when the current draw is upright', () => {
  const readings = [
    rdg(daysAgo(100), [card('The Empress', true)]),
    rdg(daysAgo(70),  [card('The Empress', true)]),
    rdg(daysAgo(40),  [card('The Empress', true)]),
  ];
  const out = findCardPatterns({ readings, currentCards: [card('The Empress', false)], now: NOW });
  assert.equal(out.find(f => f.kind === 'reversal'), undefined);
});

test('suit skew: a window dominated by one suit is noticed (tarot)', () => {
  const readings = [
    rdg(daysAgo(10), [card('Two of Swords'), card('Five of Swords')]),
    rdg(daysAgo(5),  [card('Knight of Swords'), card('The Sun')]),
  ];
  const out = findCardPatterns({ readings, currentCards: [card('Ten of Swords')], now: NOW });
  const skew = out.find(f => f.kind === 'skew');
  assert.ok(skew, 'skew fact present');
  assert.match(skew.fact, /Swords/i);
});

test('suit skew does NOT fire without enough suited cards', () => {
  const readings = [rdg(daysAgo(5), [card('The Sun'), card('The Moon')])];
  const out = findCardPatterns({ readings, currentCards: [card('The Star')], now: NOW });
  assert.equal(out.find(f => f.kind === 'skew'), undefined);
});

test('ordinary draw with no history returns []', () => {
  const out = findCardPatterns({ readings: [], currentCards: [card('The Hermit')], now: NOW });
  assert.deepEqual(out, []);
});

test('caps at 3 facts', () => {
  const many = [];
  for (let i = 0; i < 6; i++) many.push(rdg(daysAgo(20 - i), [card('The Tower'), card('Two of Cups'), card('Three of Cups'), card('Four of Cups')]));
  const out = findCardPatterns({ readings: many, currentCards: [card('The Tower'), card('Two of Cups')], now: NOW });
  assert.ok(out.length <= 3, 'no more than 3 facts');
});

test('returning: a recurring card absent >= 90 days is noticed as a return', () => {
  const readings = [
    rdg(daysAgo(180), [card('The Tower')]),
    rdg(daysAgo(150), [card('The Tower')]),
    rdg(daysAgo(120), [card('The Tower')]), // most-recent prior = 120 days ago
  ];
  const out = findCardPatterns({ readings, currentCards: [card('The Tower')], now: NOW });
  const ret = out.find(f => f.kind === 'returning');
  assert.ok(ret, 'returning fact present');
  assert.match(ret.fact, /The Tower returns/);
  assert.match(ret.fact, /about 4 months/);
  assert.equal(ret.strength, 4); // 120-day gap is < 180 -> base strength, guards against a formula inversion
});

test('returning: a very long absence (>= 180 days) gets strength 5', () => {
  const readings = [
    rdg(daysAgo(360), [card('Death')]),
    rdg(daysAgo(300), [card('Death')]),
    rdg(daysAgo(210), [card('Death')]), // most-recent prior = 210 days ago
  ];
  const out = findCardPatterns({ readings, currentCards: [card('Death')], now: NOW });
  const ret = out.find(f => f.kind === 'returning');
  assert.ok(ret);
  assert.equal(ret.strength, 5);
});

test('returning: an absence of almost a year is phrased as such', () => {
  const readings = [
    rdg(daysAgo(500), [card('The Moon')]),
    rdg(daysAgo(420), [card('The Moon')]),
    rdg(daysAgo(350), [card('The Moon')]), // ~350 days ago
  ];
  const out = findCardPatterns({ readings, currentCards: [card('The Moon')], now: NOW });
  assert.match(out.find(f => f.kind === 'returning').fact, /almost a year/);
});

test('returning does NOT fire when the card appeared recently (falls through to recurrence)', () => {
  const readings = [
    rdg(daysAgo(120), [card('The Tower')]),
    rdg(daysAgo(110), [card('The Tower')]),
    rdg(daysAgo(20),  [card('The Tower')]), // most-recent prior = 20 days ago (< 90)
  ];
  const out = findCardPatterns({ readings, currentCards: [card('The Tower')], now: NOW });
  assert.equal(out.find(f => f.kind === 'returning'), undefined);
  assert.ok(out.find(f => f.kind === 'recurrence'), 'recurrence fires instead');
});

test('returning does NOT fire for a card with fewer than 3 prior appearances', () => {
  const readings = [
    rdg(daysAgo(200), [card('The Star')]),
    rdg(daysAgo(150), [card('The Star')]), // only 2 prior appearances
  ];
  const out = findCardPatterns({ readings, currentCards: [card('The Star')], now: NOW });
  assert.equal(out.find(f => f.kind === 'returning'), undefined);
  assert.equal(out.find(f => f.kind === 'recurrence'), undefined);
});

test('returning takes precedence over recurrence for the same card (no duplicate fact)', () => {
  const readings = [
    rdg(daysAgo(200), [card('Death')]),
    rdg(daysAgo(170), [card('Death')]),
    rdg(daysAgo(140), [card('Death')]),
  ];
  const out = findCardPatterns({ readings, currentCards: [card('Death')], now: NOW });
  assert.ok(out.find(f => f.kind === 'returning'));
  assert.equal(out.find(f => f.kind === 'recurrence' && /Death/.test(f.fact)), undefined);
});

test('reversal still wins over returning for a reversed-heavy returning card', () => {
  const readings = [
    rdg(daysAgo(200), [card('The Empress', true)]),
    rdg(daysAgo(170), [card('The Empress', true)]),
    rdg(daysAgo(140), [card('The Empress', true)]), // gap qualifies for returning too
  ];
  const out = findCardPatterns({ readings, currentCards: [card('The Empress', true)], now: NOW });
  assert.ok(out.find(f => f.kind === 'reversal'), 'reversal fact present');
  assert.equal(out.find(f => f.kind === 'returning'), undefined, 'returning suppressed by reversal');
});
