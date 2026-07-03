# Portfolio Hardening & Structural Refactor — Design Spec

**Date:** 2026-07-03
**Status:** Approved pending user review
**Branch strategy:** each phase on its own branch, merged to master when verified

## Goal

Respond to external portfolio review feedback by (a) improving the real structural
integrity and efficiency of the app, (b) making the repo read credibly to a hiring
manager, and (c) documenting every deliberate *non-change* so that departures from
reviewer expectations read as engineering judgment, not neglect.

The feedback being addressed:

1. `server.js` — 1,263-line monolith, all routes in one file, "no service layer"
2. `public/app.js` — 4,245 lines of vanilla JS, no module boundaries
3. No CI config, no linter config
4. No TypeScript

Finding that reframes item 1: a tested service layer **already exists** — 11 modules
under `data/` (memory-store, memory-engine, reader-profile, notebook, etc.) with 13
`node:test` suites. The monolith problem is confined to the route handlers and the
frontend.

## Non-goals (each gets an ADR, not code)

- **No frontend framework rewrite** (React/Vue/etc.) — single-user local app; zero
  build step keeps Electron and Android packaging simple. → ADR-001
- **No TypeScript conversion** — 5,500+ lines of working, tested JS; poor
  risk/benefit. Optional later: `// @ts-check` + JSDoc on `data/` modules with
  `tsc --noEmit` in CI as a cheap typing signal. → ADR-002
- **No storage rework** — better-sqlite3 + JSON hybrid stays; document the
  native-ABI trade-off that made tests fail in the reviewer's Linux sandbox. → ADR-003
- **No speculative optimization** — efficiency fixes only where found opportunistically
  during the splits.

## Phase 0 — Land the security-hardening work (prerequisite)

The `security-hardening` branch has **zero commits**; the entire effort exists as
uncommitted working-tree changes (~30 lines across `server.js`, `public/app.js`,
`public/index.html`, plus untracked `data/prompt-safety.js` and `public/vendor/`).

1. Review the pending diff; decide whether `Miriel - Overview & Updates.pdf` and log
   files belong in the repo (expect: no — gitignore them).
2. Run the full test suite.
3. Commit on `security-hardening`.
4. Perform the owed live-LLM smoke test (per project memory).
5. Merge to master.

Nothing else proceeds on top of uncommitted changes.

## Phase 1 — Cheap, high-signal wins

Branch: `portfolio-phase1`

1. **Test script:** `"test": "node --test tests/"` in package.json.
2. **ESLint 9 flat config** (`eslint.config.js`) + `"lint"` script. Rules tuned to the
   existing code style — this is a linter adoption, not a reformat. Warnings triaged;
   rules that would demand mass rewrites get disabled with a comment saying why.
3. **GitHub Actions CI** (`.github/workflows/ci.yml`): Ubuntu, Node 18 + 20 matrix,
   `npm ci` → lint → test. `npm ci` compiles better-sqlite3 for the runner, so the
   ABI mismatch the reviewer hit cannot occur in CI.
4. **ARCHITECTURE.md** at repo root: layer map (routes → services in `data/` →
   storage), the memory-engine pipeline, pointers to ADRs.
5. **`docs/adr/`** with ADR-001 (no framework), ADR-002 (no TypeScript), ADR-003
   (storage + native-ABI trade-off). Standard ADR format: Context / Decision /
   Consequences.

Note: CI only runs on the GitHub snapshot repo (Miriels). The publish flow
(`publish-to-cloud.ps1`, clean-snapshot bridge) must carry `.github/` and `docs/`
through to the snapshot.

## Phase 2 — Split server.js

Branch: `portfolio-phase2`

23 routes move from `server.js` into `routes/` modules grouped by domain:

| Module | Routes |
|---|---|
| `routes/config.js` | config-status, config |
| `routes/readers.js` | readers CRUD |
| `routes/readings.js` | readings, patterns, session-summary |
| `routes/interpret.js` | interpret, clarify, compatibility, suggest-spread, reading-questions |
| `routes/threshold.js` | threshold, threshold/answer |
| `routes/profiles.js` | profiles/:slug, profiles/:slug/refresh, foretellings/:slug |
| `routes/daily.js` | daily-card |
| `routes/cards.js` | cards, images |
| `routes/cache.js` | cache/stats |

Plus: extract the shared LLM-call plumbing used by the interpret-family handlers into
one module (e.g. `data/llm-client.js`) — the largest handlers (`/api/interpret` is
~270 lines) shrink to orchestration. `data/` remains the service layer; no service
logic is rewritten.

End state: `server.js` ≈ 100 lines of app wiring (middleware, route mounting, static
serving, listen). API behavior byte-identical; all 13 test suites pass unchanged;
manual smoke of the running app.

## Phase 3 — Split public/app.js

Branch: `portfolio-phase3`

4,245 lines → ES modules under `public/js/`, loaded via `<script type="module">`.
Indicative module set (final boundaries decided during planning): api-client, state,
constants/data, deck & draw animation, reading flow, journal, notebook, threshold,
theme/ambient cycle, utils.

**Verified prerequisites (checked 2026-07-03):**
- `index.html` contains zero inline event handlers — nothing depends on global scope.
- Electron loads the app via `http://127.0.0.1:<port>` (`loadFile` is only the splash
  screen), so ES modules work identically in browser and packaged app.
- CSP (added in Phase 0's hardening work) must permit `script-src 'self'` module
  loads — verify, don't assume.

**Risk register:**

| Risk | Mitigation |
|---|---|
| No frontend tests — regressions invisible | Strangler protocol below; smoke checklist run after every extraction |
| Hidden shared state between features | Extractions surface coupling as explicit imports; a shared `state.js` module holds genuinely-shared state |
| Initialization/load-order bugs | Extract leaf modules first (no dependents); keep a single entry module controlling init order |
| Electron portable build breakage | Full `dist:win` build + launch test before merge (ABI incident precedent) |

**Strangler protocol (this is also the portfolio evidence):**
1. Tag `pre-frontend-split` on master.
2. Extract one module at a time, leaf modules first.
3. After each extraction: hard-reload the running app, run the smoke checklist
   (draw a reading, journal, notebook, threshold greeting, theme cycle).
4. One commit per module: `Extract <name> module (<n> functions, verified)`.
5. app.js ends as a thin bootstrap/entry module.
6. Before merge: full test suite, packaged Electron build launched and smoked.

## Portfolio evidence strategy

The disciplined commit narrative (feedback → ADRs → small verified refactor commits →
CI green throughout) is itself the strongest signal. Because the public Miriels repo
receives clean snapshots (deliberate — API-key incident), the story must be made
visible there: publish a snapshot per phase, and summarize the refactor narrative in
ARCHITECTURE.md so it survives snapshotting.

## Success criteria

- All 13 existing test suites pass after every phase; no behavior changes.
- CI green on the snapshot repo.
- `server.js` ≈ 100 lines; no route file > ~300 lines; app.js reduced to bootstrap.
- Packaged Electron build verified after Phase 3.
- ADRs + ARCHITECTURE.md present and accurate.
- Each phase independently mergeable; stopping after any phase leaves the repo better
  than before.
