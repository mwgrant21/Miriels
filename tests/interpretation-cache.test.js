'use strict';
const { test } = require('node:test');
const assert   = require('node:assert/strict');
const os   = require('os');
const path = require('path');
const fs   = require('fs');
const createCache = require('../data/interpretation-cache');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'tarot-cache-'));
}

test('buildCacheKey produces consistent key', () => {
  const cache = createCache(tmpDir());
  const cards = [
    { id: 'major-0',  position: 'past',    isReversed: false },
    { id: 'major-16', position: 'present', isReversed: true  },
  ];
  assert.equal(
    cache.buildCacheKey('tarot', 'three-card', cards),
    'tarot:three-card:past:major-0:upright|present:major-16:reversed'
  );
});

test('saveToCache and exact lookupCache', () => {
  const cache = createCache(tmpDir());
  const cards = [{ id: 'major-0', position: 'single', isReversed: false }];
  const key   = cache.buildCacheKey('tarot', 'single', cards);
  cache.saveToCache(key, 'tarot', 'single', cards, 'The Fool speaks.', 'claude');
  assert.equal(cache.lookupCache(key, 'tarot', cards), 'The Fool speaks.');
});

test('Claude overwrites Ollama; Ollama does not overwrite Claude', () => {
  const cache = createCache(tmpDir());
  const cards = [{ id: 'major-1', position: 'single', isReversed: false }];
  const key   = cache.buildCacheKey('tarot', 'single', cards);
  cache.saveToCache(key, 'tarot', 'single', cards, 'Ollama text.',  'ollama');
  cache.saveToCache(key, 'tarot', 'single', cards, 'Claude text.',  'claude');
  assert.equal(cache.lookupCache(key, 'tarot', cards), 'Claude text.');
  cache.saveToCache(key, 'tarot', 'single', cards, 'Ollama again.', 'ollama');
  assert.equal(cache.lookupCache(key, 'tarot', cards), 'Claude text.');
});

test('assembled fallback when no exact match exists', () => {
  const cache = createCache(tmpDir());
  const c0 = { id: 'major-0', position: 'single', isReversed: false };
  const c1 = { id: 'major-1', position: 'single', isReversed: false };
  cache.saveToCache(cache.buildCacheKey('tarot', 'single', [c0]), 'tarot', 'single', [c0], 'Fool.', 'claude');
  cache.saveToCache(cache.buildCacheKey('tarot', 'single', [c1]), 'tarot', 'single', [c1], 'Magician.', 'claude');

  const spreadCards = [
    { id: 'major-0', position: 'past',    isReversed: false },
    { id: 'major-1', position: 'present', isReversed: false },
  ];
  const result = cache.lookupCache(cache.buildCacheKey('tarot', 'three-card', spreadCards), 'tarot', spreadCards);
  assert.ok(result.includes('[Reading assembled'));
  assert.ok(result.includes('Fool.'));
  assert.ok(result.includes('Magician.'));
});

test('lookupCache returns null when nothing cached', () => {
  const cache = createCache(tmpDir());
  const cards = [{ id: 'major-99', position: 'single', isReversed: false }];
  assert.equal(cache.lookupCache(cache.buildCacheKey('tarot', 'single', cards), 'tarot', cards), null);
});
