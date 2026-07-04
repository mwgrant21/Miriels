// ── Shared mutable state ──
// App-wide mutable bindings live here as properties of a single exported
// object, since ES module named-export bindings are read-only to importers
// (a plain `export let x` cannot be reassigned from another module).
// Mutating a property of this shared object is legal from any importer, so
// every module reads and writes through `state.*`.
export const state = {
  currentDeck: 'tarot',
  currentSpread: 'single',
  drawnCards: [],
  manualMode: false,
  currentQuestion: '',
  dealAnimActive: false, // set true before auto-draws; consumed by renderSpread
  lastReadingContext: null, // saved for clarifier calls
  themeCard: null, // bottom-of-deck overall theme (random mode only)
  currentReader: { name: 'Matt', slug: 'matt' }, // active reader profile
  sessionReadings: [], // readings completed this session (for "Read the thread")
  sessionSummaryText: '', // last generated thread summary (for save doc)
  lastSynopsis: '', // most recent interpretation text (for share functions)
  allCards: { 'veil-arcana': [], 'drowned-ephemeris': [], tarot: [], oracle: [], 'miriel-lunar': [], lenormand: [], thoth: [], runic: [], iching: [] },
  imageManifest: {},
  // { name, zodiac } for compatibility readings — sole writer is bootstrap.js's
  // compat-begin-btn handler (setupButtons); read-only elsewhere.
  compatPersonA: null,
  compatPersonB: null,
};
