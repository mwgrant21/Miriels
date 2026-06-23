'use strict';
const { test } = require('node:test');
const assert   = require('node:assert/strict');
const os   = require('os');
const path = require('path');
const fs   = require('fs');
const createProfileManager = require('../data/reader-profile');

function tmpDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'tarot-profile-')); }

const BASE = 'You are Miriel.';

test('getTier returns correct tiers', () => {
  const pm = createProfileManager(tmpDir());
  assert.equal(pm.getTier(0),   1);
  assert.equal(pm.getTier(9),   1);
  assert.equal(pm.getTier(10),  2);
  assert.equal(pm.getTier(29),  2);
  assert.equal(pm.getTier(30),  3);
  assert.equal(pm.getTier(100), 3);
});

test('buildPersonaWithProfile always starts with base persona and appends warmth note', () => {
  const pm = createProfileManager(tmpDir());
  // readingCount=0 → warmth tier 1 (first visit); no profile → only warmth note appended
  const result = pm.buildPersonaWithProfile(BASE, null, 0, []);
  assert.ok(result.startsWith(BASE));
  assert.ok(result.length > BASE.length, 'warmth note always appended');
});

test('buildPersonaWithProfile injects miriel_notes at tier 2', () => {
  const pm      = createProfileManager(tmpDir());
  const profile = { miriel_notes: 'You ask about thresholds.', recurring_cards: [] };
  const result  = pm.buildPersonaWithProfile(BASE, profile, 15, []);
  assert.ok(result.includes('You ask about thresholds.'));
  assert.ok(!result.includes('current chapter'));
});

test('buildPersonaWithProfile injects life_arc and unresolved_thread at tier 3', () => {
  const pm      = createProfileManager(tmpDir());
  const profile = {
    miriel_notes:     'Deep patterns.',
    life_arc:         { current_chapter: 'A threshold not crossed.', key_threads: [], inflection_points: '' },
    unresolved_thread: 'Creative fear.',
    recurring_cards:  []
  };
  const result = pm.buildPersonaWithProfile(BASE, profile, 35, []);
  assert.ok(result.includes('A threshold not crossed.'));
  assert.ok(result.includes('Creative fear.'));
  assert.ok(result.length > BASE.length, 'warmth note appended');
});

test('recurring card note injected only when card appears in current draw', () => {
  const pm      = createProfileManager(tmpDir());
  const profile = {
    miriel_notes:    'Notes.',
    recurring_cards: [{ card: 'The Tower', card_id: 'major-16', count: 8, note: 'always outcome' }]
  };
  const withTower    = pm.buildPersonaWithProfile(BASE, profile, 15, [{ id: 'major-16' }]);
  const withoutTower = pm.buildPersonaWithProfile(BASE, profile, 15, [{ id: 'major-0'  }]);
  assert.ok(withTower.includes('The Tower'));
  assert.ok(!withoutTower.includes('The Tower'));
});

test('loadReaderProfile returns null for unknown slug', () => {
  const pm = createProfileManager(tmpDir());
  assert.equal(pm.loadReaderProfile('nobody'), null);
});

test('saveReaderProfile and loadReaderProfile round-trip', () => {
  const pm      = createProfileManager(tmpDir());
  const profile = { slug: 'matt', miriel_notes: 'Test.', recurring_cards: [] };
  pm.saveReaderProfile('matt', profile);
  assert.deepEqual(pm.loadReaderProfile('matt'), profile);
});

test('updateLivingNote writes a note + timestamp and preserves existing profile fields', async () => {
  const pm = createProfileManager(tmpDir());
  pm.saveReaderProfile('matt', { slug: 'matt', miriel_notes: 'old synthesis', recurring_cards: [{ card: 'X' }] });
  const loadReadings = () => [{ date: '2026-06-14', question: 'work?', cards: [{ name: 'The Tower' }], synopsis: 'a hard truth' }];
  const fakeLLM = async () => 'Where you stand: you are letting go of an old story.';
  await pm.updateLivingNote('matt', fakeLLM, loadReadings);
  const p = pm.loadReaderProfile('matt');
  assert.equal(p.living_note, 'Where you stand: you are letting go of an old story.');
  assert.ok(p.living_note_updated > 0);
  assert.equal(p.miriel_notes, 'old synthesis');          // preserved
  assert.deepEqual(p.recurring_cards, [{ card: 'X' }]);   // preserved
});

test('updateLivingNote creates a minimal profile when none exists yet (tier 1)', async () => {
  const pm = createProfileManager(tmpDir());
  const loadReadings = () => [{ date: '2026-06-14', cards: [{ name: 'The Star' }] }];
  await pm.updateLivingNote('newbie', async () => 'You are at a beginning.', loadReadings);
  const p = pm.loadReaderProfile('newbie');
  assert.ok(p);
  assert.equal(p.slug, 'newbie');
  assert.equal(p.living_note, 'You are at a beginning.');
});

test('updateLivingNote does nothing (no LLM call) when there are no readings', async () => {
  const pm = createProfileManager(tmpDir());
  let called = false;
  await pm.updateLivingNote('matt', async () => { called = true; return 'x'; }, () => []);
  assert.equal(called, false);
  assert.equal(pm.loadReaderProfile('matt'), null);
});

test('refreshReaderProfile preserves an existing living_note across full re-synthesis', async () => {
  const pm = createProfileManager(tmpDir());
  pm.saveReaderProfile('matt', { slug: 'matt', living_note: 'You are mid-threshold.', living_note_updated: 123 });
  const readings = Array.from({ length: 10 }, (_, i) => ({ date: 'd' + i, cards: [{ name: 'The Moon' }], synopsis: 's' }));
  const fakeLLM = async () => 'MIRIEL_NOTES:\nA clear pattern emerges.\n\nRECURRING_CARDS:\n[]';
  await pm.refreshReaderProfile('matt', fakeLLM, () => readings);
  const p = pm.loadReaderProfile('matt');
  assert.equal(p.miriel_notes, 'A clear pattern emerges.');
  assert.equal(p.living_note, 'You are mid-threshold.');  // preserved
});

test('buildPersonaWithProfile appends a warmth note at every tier, incl. first visit', () => {
  const pm = createProfileManager(tmpDir());
  const first = pm.buildPersonaWithProfile(BASE, null, 0, []);
  assert.ok(first.startsWith(BASE), 'keeps base persona');
  assert.match(first, /first|don't know them yet/i, 'first-visit warmth note present');
  const longKnown = pm.buildPersonaWithProfile(BASE, null, 75, []);
  assert.match(longKnown, /known this person|years/i, 'long-known warmth note present');
});

test('buildPersonaWithProfile still layers synthesized profile notes when present', () => {
  const pm = createProfileManager(tmpDir());
  const profile = { miriel_notes: 'NOTE_BODY', recurring_cards: [], life_arc: { current_chapter: 'CHAPTER' }, unresolved_thread: 'THREAD' };
  const out = pm.buildPersonaWithProfile('BASE', profile, 75, []);
  assert.match(out, /NOTE_BODY/);
  assert.match(out, /CHAPTER/);
});

test('getWarmthTier maps reading counts to the 5-tier arc', () => {
  const pm = createProfileManager(tmpDir());
  assert.equal(pm.getWarmthTier(0), 1);
  assert.equal(pm.getWarmthTier(1), 1);
  assert.equal(pm.getWarmthTier(2), 2);
  assert.equal(pm.getWarmthTier(5), 2);
  assert.equal(pm.getWarmthTier(6), 3);
  assert.equal(pm.getWarmthTier(20), 3);
  assert.equal(pm.getWarmthTier(21), 4);
  assert.equal(pm.getWarmthTier(59), 4);
  assert.equal(pm.getWarmthTier(60), 5);
  assert.equal(pm.getWarmthTier(200), 5);
});
