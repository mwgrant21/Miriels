'use strict';
const { test } = require('node:test');
const assert   = require('node:assert/strict');

const fs   = require('fs');
const path = require('path');

const appSrc = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');
// Extract the SPREADS object by evaluating up to the closing brace
const spreadsMatch = appSrc.match(/^const SPREADS = \{[\s\S]+?\n\};/m);
assert.ok(spreadsMatch, 'Could not find SPREADS constant in app.js');
const SPREADS = eval(`(${spreadsMatch[0].replace('const SPREADS =', '').replace(/;$/, '')})`);

// Expected spread keys
const ALL_KEYS = [
  'single', 'three-card', 'four-card', 'five-card', 'yes-no',
  'horseshoe', 'year-ahead', 'decision', 'celtic', 'reader-choice',
  'six-card', 'nine-card', 'compatibility', 'rel-cross', 'soulmates', 'rel-future',
  'chakra', 'star'
];

const VALID_CATEGORIES = ['general', 'relationship', 'spiritual'];

test('SPREADS has all expected keys', () => {
  for (const key of ALL_KEYS) {
    assert.ok(SPREADS[key], `Missing spread: ${key}`);
  }
  assert.equal(Object.keys(SPREADS).length, ALL_KEYS.length,
    `Expected ${ALL_KEYS.length} spreads, got ${Object.keys(SPREADS).length}`);
});

test('every spread has required fields: category, label, slots', () => {
  for (const [key, spread] of Object.entries(SPREADS)) {
    assert.ok(spread.category, `${key} missing category`);
    assert.ok(VALID_CATEGORIES.includes(spread.category),
      `${key} has unknown category: ${spread.category}`);
    assert.ok(spread.label && spread.label.length > 0, `${key} missing label`);
    assert.ok(Array.isArray(spread.slots), `${key} slots must be an array`);
  }
});

test('every non-special spread has at least one slot', () => {
  for (const [key, spread] of Object.entries(SPREADS)) {
    if (!spread.special) {
      assert.ok(spread.slots.length > 0, `${key} has no slots`);
    }
  }
});

test('every slot has label and position strings', () => {
  for (const [key, spread] of Object.entries(SPREADS)) {
    spread.slots.forEach((slot, i) => {
      assert.equal(typeof slot.label, 'string', `${key} slot[${i}] missing label`);
      assert.equal(typeof slot.position, 'string', `${key} slot[${i}] missing position`);
    });
  }
});

test('category groupings have correct counts', () => {
  const byCategory = {};
  for (const spread of Object.values(SPREADS)) {
    byCategory[spread.category] = (byCategory[spread.category] || 0) + 1;
  }
  assert.equal(byCategory.general,      10, `Expected 10 general spreads`);
  assert.equal(byCategory.relationship,  6, `Expected 6 relationship spreads`);
  assert.equal(byCategory.spiritual,     2, `Expected 2 spiritual spreads`);
});

test('year-ahead has 12 slots', () => {
  assert.equal(SPREADS['year-ahead'].slots.length, 12);
});

test('chakra has 7 slots', () => {
  assert.equal(SPREADS['chakra'].slots.length, 7);
});

test('server valid array matches all non-special spreads', () => {
  const serverSrc = fs.readFileSync(path.join(__dirname, '../routes/interpret.js'), 'utf8');
  const validMatch = serverSrc.match(/const valid = \[([^\]]+)\]/);
  assert.ok(validMatch, 'Could not find valid array in routes/interpret.js');
  const validKeys = validMatch[1].match(/'([^']+)'/g).map(s => s.replace(/'/g, ''));

  const nonSpecialKeys = Object.entries(SPREADS)
    .filter(([, s]) => !s.special)
    .map(([k]) => k);

  for (const key of nonSpecialKeys) {
    assert.ok(validKeys.includes(key), `server.js valid array missing: ${key}`);
  }
});
