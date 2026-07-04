# Architecture

Miriel's Readings is a single-user, local-first tarot app: an Express server on
loopback, a vanilla-JS frontend, and an accumulating "memory engine" that lets the
reader (Miriel) remember the querent across sessions. It ships as a local web app,
an Electron desktop app, and has a sibling Android (Kotlin) implementation.

## Layers

```
public/  (vanilla JS, no framework)         — UI, deck/draw animation, reading flow
  └─ public/js/ (12 ES modules) + 5-line app.js entry point
   │  fetch /api/*
server.js (Express, loopback only)          — wiring: config, middleware, mounts
   │  require()
routes/*.js (9 modules)                     — route handlers, LLM prompt assembly
   │  require()
data/*.js (service layer, node:test suites) — memory engine, profiles, notebook,
   │                                          patterns, prophecy recall, prompt
   │                                          safety, LLM client, reader store
storage                                     — better-sqlite3 (memory.db,
                                              interpretations.db) + JSON files
                                              (readings, profiles, patterns, daily)
```

- **Frontend** (`public/`): vanilla JS split into 12 native ES modules under
  `public/js/` (bootstrap, reading-flow, reader-identity, content-library,
  session-export, card-render, spreads-data, deck, utils, theme, overlay,
  state), loaded via a 5-line `app.js` entry point
  (`<script type="module">`). Two classic scripts (`theme-transition.js`,
  `ambient-lines.js`) stay plain `<script>`s, reused by Node tests. The
  migration's `app.js`↔module cycles were dissolved by promoting shared
  mutable state into `state.js` (a zero-import leaf); the only remaining
  cycles are two TDZ-safe function-level pairs within the reading-flow
  cluster (reading-flow↔session-export, reading-flow↔reader-identity),
  where imports are referenced only at call time. Zero build step, no
  framework by deliberate choice — see
  `docs/adr/001-no-frontend-framework.md`.
- **Server** (`server.js`): ~77 lines of wiring. Routes live in `routes/` (9
  modules: cache, cards, config, daily, interpret, profiles, readers, readings,
  threshold); route handlers assemble LLM prompts from service-layer data. All
  untrusted text entering prompts is fenced via `data/prompt-safety.js`.
- **Service layer** (`data/*.js`): 14 CommonJS modules backed by 17 node:test
  suites in `tests/`, including `data/llm-client.js` (Claude primary, Ollama
  fallback) and `data/reader-store.js`. This is where the product's real
  complexity lives.
- **Storage**: better-sqlite3 for the memory engine and interpretation cache
  (synchronous, zero-config, single-user — see `docs/adr/003-storage.md`);
  JSON files for readings/profiles/caches. All personal data stays local and
  gitignored.

## The memory engine

Readings feed an extraction pass that stores memory "atoms" (facts, threads,
feelings) in SQLite. Later readings query these for: threshold greetings,
temporal callbacks, emotional seasons, prophecy recall, and reader-profile
synthesis. Modules: `data/memory-store.js` (persistence),
`data/memory-engine.js` (extraction/recall), plus consumers
(`reader-profile.js`, `notebook.js`, `prophecy-recall.js`, `temporal-recall.js`,
`emotional-seasons.js`).

## Security posture

Single-user local app: server binds 127.0.0.1 only; CSP on the page; no CDN
scripts (html2canvas vendored); LLM prompt injection mitigated by fencing all
querent-provided text in named tags the model is instructed to treat as data.
API key lives in `data/config.json` (gitignored, never published).

## Decisions

Deliberate non-choices are documented as ADRs in `docs/adr/`:
001 no frontend framework · 002 no TypeScript · 003 storage design.
