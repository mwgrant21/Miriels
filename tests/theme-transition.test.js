'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { shouldCrossfade } = require('../public/theme-transition');

test('cross-fades on a real phase change', () => {
  assert.equal(shouldCrossfade('day', 'night'), true);
  assert.equal(shouldCrossfade('dawn', 'dusk'), true);
});

test('does not cross-fade when the phase is unchanged', () => {
  assert.equal(shouldCrossfade('night', 'night'), false);
});

test('does not cross-fade on first paint (no previous phase)', () => {
  assert.equal(shouldCrossfade(null, 'day'), false);
  assert.equal(shouldCrossfade(undefined, 'day'), false);
  assert.equal(shouldCrossfade('', 'day'), false);
});

test('does not cross-fade when next is missing', () => {
  assert.equal(shouldCrossfade('day', ''), false);
  assert.equal(shouldCrossfade('day', null), false);
});
