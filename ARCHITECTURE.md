# Architecture

Miriel's Readings is a single-user, local-first tarot app: an Express server on
loopback, a vanilla-JS frontend, and an accumulating "memory engine" that lets the
reader (Miriel) remember the querent across sessions. It ships as a local web app,
an Electron desktop app, and has a sibling Android (Kotlin) implementation.

## Layers

```
public/  (vanilla JS, no framework)         — UI, deck/draw animation, reading flow
   │  fetch /api/*
server.js (Express, loopback only)          — routes + LLM prompt assembly
   │  require()
data/*.js (service layer, node:test suites) — memory engine, profiles, notebook,
   │                                          patterns, prophecy recall, prompt safety
storage                                     — better-sqlite3 (memory.db,
                                              interpretations.db) + JSON files
                                              (readings, profiles, patterns, daily)
```

- **Frontend** (`public/`): classic scripts today; ES-module split planned (see
  the portfolio-hardening spec in `docs/superpowers/specs/`). No framework by
  deliberate choice — see `docs/adr/001-no-frontend-framework.md`.
- **Server** (`server.js`): ~23 routes. Route handlers assemble LLM prompts from
  service-layer data; a route-module split is planned. All untrusted text entering
  prompts is fenced via `data/prompt-safety.js`.
- **Service layer** (`data/*.js`): 11 CommonJS modules backed by 14 node:test
  suites in `tests/`. This is where the product's real complexity lives.
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
