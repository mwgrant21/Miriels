// Reader + reading-history persistence (JSON files under the data dir).
// Extracted from server.js unchanged.
'use strict';
const fs = require('fs');
const path = require('path');

module.exports = function createReaderStore(dataDir) {
  const READERS_PATH = path.join(dataDir, 'readers.json');
  const READINGS_DIR = path.join(dataDir, 'readings');
  const LEGACY_PATH  = path.join(dataDir, 'readings.json'); // pre-profiles

  function slugify(name) {
    return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'reader';
  }

  function loadReaders() {
    try {
      if (fs.existsSync(READERS_PATH)) return JSON.parse(fs.readFileSync(READERS_PATH, 'utf8'));
    } catch {}
    return [];
  }

  function saveReaders(readers) {
    fs.writeFileSync(READERS_PATH, JSON.stringify(readers, null, 2));
  }

  function readerReadingsPath(slug) {
    return path.join(READINGS_DIR, `${slug}.json`);
  }

  function loadReadings(slug) {
    try {
      const p = readerReadingsPath(slug);
      if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'));
    } catch {}
    return [];
  }

  function appendReading(entry, slug) {
    const readings = loadReadings(slug);
    readings.push(entry);
    if (readings.length > 200) readings.splice(0, readings.length - 200);
    fs.mkdirSync(READINGS_DIR, { recursive: true });
    fs.writeFileSync(readerReadingsPath(slug), JSON.stringify(readings, null, 2));
  }

  // ── One-time migration: readings.json → data/readings/matt.json ──────────────

  function migrateIfNeeded() {
    fs.mkdirSync(READINGS_DIR, { recursive: true });

    // Ensure at least one reader exists (Matt is the default)
    let readers = loadReaders();
    if (!readers.length) {
      readers = [{ name: 'Matt', slug: 'matt' }];
      saveReaders(readers);
      console.log('  ✓ Created default reader: Matt');
    }

    // Migrate legacy readings.json → data/readings/matt.json (once only)
    const mattPath = readerReadingsPath('matt');
    if (fs.existsSync(LEGACY_PATH) && !fs.existsSync(mattPath)) {
      try {
        fs.copyFileSync(LEGACY_PATH, mattPath);
        console.log('  ✓ Migrated readings.json → data/readings/matt.json');
      } catch (err) {
        console.error('  ✗ Migration failed:', err.message);
      }
    }
  }

  return { slugify, loadReaders, saveReaders, readerReadingsPath, loadReadings, appendReading, migrateIfNeeded };
};
