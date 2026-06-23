'use strict';
const { test } = require('node:test');
const assert   = require('node:assert/strict');
const os   = require('os');
const path = require('path');
const fs   = require('fs');
const { buildNotebookPayload, resolveCardImage } = require('../data/notebook');

// Build a throwaway data dir with a 2-card tarot.json and one image on disk
function makeFixture() {
  const dataDir   = fs.mkdtempSync(path.join(os.tmpdir(), 'tarot-nb-data-'));
  const imagesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tarot-nb-img-'));
  fs.writeFileSync(path.join(dataDir, 'tarot.json'), JSON.stringify([
    { id: 'major-9',  name: 'The Hermit' },
    { id: 'cups-8',   name: 'Eight of Cups' }
  ]));
  fs.mkdirSync(path.join(imagesDir, 'tarot'));
  fs.writeFileSync(path.join(imagesDir, 'tarot', 'major-9.jpg'), 'x');
  return { dataDir, imagesDir };
}

function getTier(n) { return n >= 30 ? 3 : n >= 10 ? 2 : 1; }

test('resolveCardImage matches by name, case-insensitively', () => {
  const { dataDir, imagesDir } = makeFixture();
  assert.equal(resolveCardImage('the hermit', dataDir, imagesDir), '/images/tarot/major-9.jpg');
});

test('resolveCardImage returns null when image file is missing', () => {
  const { dataDir, imagesDir } = makeFixture();
  assert.equal(resolveCardImage('Eight of Cups', dataDir, imagesDir), null);
});

test('resolveCardImage returns null for unknown card name', () => {
  const { dataDir, imagesDir } = makeFixture();
  assert.equal(resolveCardImage('Wunjo', dataDir, imagesDir), null);
});

test('buildNotebookPayload returns null profile and tier 1 for a new reader', () => {
  const { dataDir, imagesDir } = makeFixture();
  const out = buildNotebookPayload({ profile: null, readingCount: 3, getTier, dataDir, imagesDir });
  assert.deepEqual(out, { profile: null, readingCount: 3, tier: 1 });
});

test('buildNotebookPayload enriches recurring cards with imageUrl', () => {
  const { dataDir, imagesDir } = makeFixture();
  const profile = {
    miriel_notes: 'Notes.',
    recurring_cards: [
      { card: 'The Hermit',    card_id: 'major_09', count: 6, note: 'foundation' },
      { card: 'Eight of Cups', card_id: 'cups_08',  count: 3, note: 'departure' }
    ]
  };
  const out = buildNotebookPayload({ profile, readingCount: 66, getTier, dataDir, imagesDir });
  assert.equal(out.tier, 3);
  assert.equal(out.profile.recurring_cards[0].imageUrl, '/images/tarot/major-9.jpg');
  assert.equal(out.profile.recurring_cards[1].imageUrl, null);
  // original profile object is not mutated
  assert.equal(profile.recurring_cards[0].imageUrl, undefined);
});

test('buildNotebookPayload tolerates profile without recurring_cards', () => {
  const { dataDir, imagesDir } = makeFixture();
  const out = buildNotebookPayload({ profile: { miriel_notes: 'n' }, readingCount: 12, getTier, dataDir, imagesDir });
  assert.equal(out.tier, 2);
  assert.equal(out.profile.miriel_notes, 'n');
});
