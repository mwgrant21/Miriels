'use strict';
const os   = require('os');
const path = require('path');
const fs   = require('fs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const createReaderStore = require('../data/reader-store');

function freshStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tarot-store-'));
  return { dir, store: createReaderStore(dir) };
}

test('slugify normalizes names and never returns empty', () => {
  const { store } = freshStore();
  assert.equal(store.slugify('  Matt G.  '), 'matt-g');
  assert.equal(store.slugify('Ünïcode!!'), 'n-code');
  assert.equal(store.slugify('!!!'), 'reader');
});

test('loadReaders returns [] on a fresh dir; saveReaders round-trips', () => {
  const { store } = freshStore();
  assert.deepEqual(store.loadReaders(), []);
  store.saveReaders([{ name: 'A', slug: 'a' }]);
  assert.deepEqual(store.loadReaders(), [{ name: 'A', slug: 'a' }]);
});

test('appendReading persists and caps history at 200', () => {
  const { store } = freshStore();
  for (let i = 0; i < 205; i++) store.appendReading({ id: i }, 'cap');
  const readings = store.loadReadings('cap');
  assert.equal(readings.length, 200);
  assert.equal(readings[0].id, 5);   // oldest 5 trimmed
  assert.equal(readings[199].id, 204);
});

test('migrateIfNeeded creates the default reader and migrates legacy readings.json', () => {
  const { dir, store } = freshStore();
  fs.writeFileSync(path.join(dir, 'readings.json'), JSON.stringify([{ id: 1 }]));
  store.migrateIfNeeded();
  assert.equal(store.loadReaders()[0].slug, 'matt');
  assert.deepEqual(store.loadReadings('matt'), [{ id: 1 }]);
  // idempotent: running again neither duplicates readers nor re-copies
  store.appendReading({ id: 2 }, 'matt');
  store.migrateIfNeeded();
  assert.equal(store.loadReaders().length, 1);
  assert.equal(store.loadReadings('matt').length, 2);
});
