'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ambientLineFor, AMBIENT_LINES } = require('../public/ambient-lines');

test('returns the first line of a phase when rng is 0', () => {
  assert.equal(ambientLineFor('dawn', () => 0), AMBIENT_LINES.dawn[0]);
  assert.equal(ambientLineFor('night', () => 0), AMBIENT_LINES.night[0]);
});

test('returned line always belongs to the phase pool', () => {
  for (const phase of ['dawn', 'day', 'dusk', 'night']) {
    for (const r of [0, 0.25, 0.5, 0.75, 0.999]) {
      assert.ok(AMBIENT_LINES[phase].includes(ambientLineFor(phase, () => r)));
    }
  }
});

test('unknown or missing phase falls back to a night line', () => {
  assert.ok(AMBIENT_LINES.night.includes(ambientLineFor('teatime', () => 0)));
  assert.ok(AMBIENT_LINES.night.includes(ambientLineFor(undefined, () => 0)));
});

test('rng returning 1 stays in bounds (no overflow)', () => {
  const line = ambientLineFor('day', () => 1);
  assert.ok(AMBIENT_LINES.day.includes(line));
});
