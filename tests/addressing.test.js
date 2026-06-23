'use strict';
const { test } = require('node:test');
const assert   = require('node:assert/strict');
const { buildAddressingNote, buildCompatAddressingNote } = require('../data/addressing');

test('buildAddressingNote names the reader and instructs second-person address', () => {
  const note = buildAddressingNote('Matt');
  assert.ok(note.includes('Matt'));
  assert.ok(note.includes('speak to them as "you," always'));
  assert.ok(note.includes('at most once'));
});

test('buildAddressingNote returns empty string when no reader name', () => {
  assert.equal(buildAddressingNote(''), '');
  assert.equal(buildAddressingNote(null), '');
  assert.equal(buildAddressingNote(undefined), '');
});

test('compat note: active reader matched case-insensitively, partner named', () => {
  const note = buildCompatAddressingNote('  matt ', 'Matt', 'Maggie');
  assert.ok(note.includes('Matt is the one sitting across from you'));
  assert.ok(note.includes('speak about Maggie by name'));
});

test('compat note: reader matching person B', () => {
  const note = buildCompatAddressingNote('Maggie', 'Matt', 'Maggie');
  assert.ok(note.includes('Maggie is the one sitting across from you'));
  assert.ok(note.includes('speak about Matt by name'));
});

test('compat note: falls back to general note when reader is neither person', () => {
  const note = buildCompatAddressingNote('Chris', 'Matt', 'Maggie');
  assert.ok(note.includes('The person sitting across from you is Chris'));
});

test('compat note: empty string when no reader name', () => {
  assert.equal(buildCompatAddressingNote('', 'Matt', 'Maggie'), '');
});
