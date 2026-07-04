const express = require('express');
const path = require('path');

const app = express();
const PORT = parseInt(process.env.PORT, 10) || 3000;
const DATA_DIR      = process.env.DATA_DIR || path.join(__dirname, 'data');

const createCache = require('./data/interpretation-cache');
const cache = createCache(DATA_DIR);

const createProfileManager = require('./data/reader-profile');
const profiles = createProfileManager(DATA_DIR);

const createMemoryEngine = require('./data/memory-engine');
const memory = createMemoryEngine(DATA_DIR);
const createEmotionalSeasons = require('./data/emotional-seasons');
const seasons = createEmotionalSeasons(memory);

const { READER_PERSONA } = require('./data/persona');

const createReaderStore = require('./data/reader-store');
const store = createReaderStore(DATA_DIR);
const { loadReaders, loadReadings } = store;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

store.migrateIfNeeded();

// Seed Miriel's memory from existing history once per reader (deferred, non-blocking).
setImmediate(() => {
  for (const r of loadReaders()) {
    memory.backfill(r.slug, loadReadings, callLLM)
      .then(res => { if (res && res.added) console.log(`  + Memory back-filled for ${r.slug} (${res.added} memories)`); })
      .catch(err => console.warn(`  ⚠  Memory back-fill failed for ${r.slug}:`, err.message));
    seasons.backfillSeasons(r.slug, callLLM)
      .then(res => { if (res && res.added) console.log(`  + Emotional seasons back-filled for ${r.slug} (${res.added})`); })
      .catch(err => console.warn(`  ⚠  Season back-fill failed for ${r.slug}:`, err.message));
  }
});

const createLlmClient = require('./data/llm-client');
const llm = createLlmClient(DATA_DIR);
const { getApiKey, callLLM } = llm;

const ctx = {
  DATA_DIR,
  PUBLIC_DIR: path.join(__dirname, 'public'),
  store, llm, cache, profiles, memory, seasons,
  READER_PERSONA,
};

app.use(require('./routes/config')(ctx));
app.use(require('./routes/cards')(ctx));
app.use(require('./routes/cache')(ctx));
app.use(require('./routes/readers')(ctx));
app.use(require('./routes/daily')(ctx));
app.use(require('./routes/readings')(ctx));
app.use(require('./routes/threshold')(ctx));
app.use(require('./routes/profiles')(ctx));
app.use(require('./routes/interpret')(ctx));

// Bind loopback only. This is a single-user local app; the server must never be
// reachable from the LAN. On-device testing goes through `adb reverse tcp:PORT tcp:PORT`,
// which delivers phone traffic to 127.0.0.1, so loopback binding does not affect it.
// Listen only when run directly (npm start, Electron's fork of server.js);
// requiring this file (tests) gets the app without a bound port.
if (require.main === module) {
  app.listen(PORT, '127.0.0.1', () => {
    console.log(`\n  Tarot is running at http://localhost:${PORT}\n`);
    if (!getApiKey()) {
      console.log('  ⚠  No API key found. Open the app and use ⚙ Settings to add one.\n');
    }
  });
}

module.exports = app;
