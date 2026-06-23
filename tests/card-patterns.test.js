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
