# Portfolio Hardening Phase 3 — app.js ES-Module Split Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split public/app.js (4,243 lines, classic script) into 12 ES modules under `public/js/` with app.js as a thin entry module — behavior identical, verified after every extraction by a headless-browser smoke harness plus module-aware lint.

**Architecture:** Strangler in two moves: (1) flip the still-monolithic app.js to `type="module"` first, so module semantics (strict mode, deferral, module scope) are validated in ONE smoke-verified step; (2) extract modules leaf-first with explicit imports/exports, one commit per module, smoke + lint after each. `theme-transition.js` and `ambient-lines.js` stay classic scripts (Node tests `require()` them); module code references them as explicit `window.*` calls.

**Tech Stack:** Native ES modules (no bundler — zero-build-step is ADR-001 policy), puppeteer-core + system Chrome/Edge for the smoke harness, ESLint `sourceType: 'module'` as the import-completeness checker.

**Spec:** `docs/superpowers/specs/2026-07-03-portfolio-hardening-design.md` (Phase 3)
**REQUIRED READING for every implementer:** `.superpowers/sdd/appjs-map.md` — the authoritative structural map (sections, line ranges, shared state, module boundaries, risks). The plan references it as "the map" throughout; its line numbers are the source of truth.

## Global Constraints

- Repo: `C:\Users\Matt\projects\tarot`. Branch `portfolio-phase3` off master (4be6feb). 220 tests green, lint clean at start.
- **Behavior identical.** Moved code is verbatim except the sanctioned edits in the Reference Mapping below. No renames, no "improvements," no dead-code removal beyond what a move makes syntactically necessary.
- After EVERY task: `npm run lint` (0), `npm test` (220 — backend suites must never be touched), `npm run smoke` (headless browser boots the app with zero console/page errors).
- One commit per extracted module, message format: `Extract <name> module (<n> functions, verified)`.
- `public/theme-transition.js` and `public/ambient-lines.js` are UNTOUCHABLE this phase (dual-consumed by Node tests).
- No new runtime dependencies; `puppeteer-core` is devDependencies only.
- ASCII only in new code; moved code keeps its bytes exactly.
- LLM note: the smoke harness runs the server WITHOUT an API key on a scratch DATA_DIR, so no Claude calls ever fire from automation; Ollama fallback calls are tolerated (fire-and-forget).

## Reference Mapping (the ONLY allowed edits inside moved code)

| Change | Rule |
|---|---|
| `shouldCrossfade(` → `window.shouldCrossfade(` | classic-script global, made explicit (2 call sites per map §3) |
| `ambientLineFor(` → `window.ambientLineFor(` | same |
| `export` keywords added | on every function/const another module imports (per map §6 export lists) |
| `import { ... } from './x.js';` lines added | at top of each module, exactly covering its external references — ESLint `no-undef` is the completeness proof |
| Top-level `let` shared across modules | moves into `js/state.js` as `export let` ONLY if written via setter, else convert to exported object property per map §2 guidance — the map marks which; follow it exactly |
| `window.__asyncDeal` | KEEP as-is (explicit window global; documented coupling, not converted) |
| `SPREADS` | exported as live `const` object from `js/spreads-data.js` (runtime-mutated by compat modal — do NOT freeze/copy) |
| `el.dealNow = ...` DOM-property coupling | KEEP as-is (runtime coupling, module-safe) |

**ES-module live-binding caveat:** `export let x` re-assigned from another module is illegal. The map's §2 lists every shared mutable binding and its writers. For any binding written by 2+ modules, `js/state.js` holds it as a property of one exported `state` object (`export const state = { ... }`), and moved code's bare references change `x` → `state.x` (this substitution IS sanctioned, listed per-binding in the map). Bindings written only by their home module export normally.

---

### Task 1: Branch, tag, smoke harness

**Files:**
- Create: `scripts/smoke-frontend.js`
- Modify: `package.json` (devDependency `puppeteer-core`, script `"smoke": "node scripts/smoke-frontend.js"`)

**Interfaces:**
- Produces: `npm run smoke` — exits 0 iff the app boots headlessly with no console errors and core UI renders. Every later task's gate.

- [ ] **Step 1: Branch and tag**

```bash
git checkout -b portfolio-phase3
git tag pre-frontend-split master
```

- [ ] **Step 2: Install puppeteer-core**

Run: `npm install --save-dev puppeteer-core`
Expected: no Chromium download (that's full `puppeteer`; `-core` uses the system browser).

- [ ] **Step 3: Create `scripts/smoke-frontend.js`**

```js
'use strict';
// Headless-browser smoke for the frontend. Boots the server on a scratch
// DATA_DIR (deck JSONs copied in, NO api key so Claude is never called),
// loads the app in system Chrome/Edge, fails on any console error or page
// error, asserts core UI rendered, saves a screenshot next to the repo.
// Run: npm run smoke
const { spawn } = require('child_process');
const fs   = require('fs');
const os   = require('os');
const path = require('path');
const puppeteer = require('puppeteer-core');

const PORT = 3105;
const ROOT = path.join(__dirname, '..');
const BROWSERS = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
];
// Baseline noise observed BEFORE the refactor started (Task 1). Add entries
// only with a comment saying why they are benign; never to silence a new error.
const ALLOWED_ERRORS = [];

function wait(ms) { return new Promise(r => setTimeout(r, ms)); }

async function waitForServer(url, tries = 40) {
  for (let i = 0; i < tries; i++) {
    try { const r = await fetch(url); if (r.ok) return; } catch {}
    await wait(250);
  }
  throw new Error('server did not come up');
}

async function main() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tarot-smoke-'));
  for (const f of fs.readdirSync(path.join(ROOT, 'data'))) {
    if (f.endsWith('.json') && f !== 'config.json') {
      fs.copyFileSync(path.join(ROOT, 'data', f), path.join(dataDir, f));
    }
  }

  const server = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT), DATA_DIR: dataDir, ANTHROPIC_API_KEY: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stderr.on('data', d => process.stderr.write('[server] ' + d));

  let browser;
  try {
    await waitForServer(`http://127.0.0.1:${PORT}/api/config-status`);

    const exePath = BROWSERS.find(p => fs.existsSync(p));
    if (!exePath) throw new Error('no system Chrome/Edge found');
    browser = await puppeteer.launch({ executablePath: exePath, headless: true });
    const page = await browser.newPage();

    const errors = [];
    page.on('pageerror', e => errors.push('pageerror: ' + e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
    page.on('requestfailed', r => errors.push('requestfailed: ' + r.url() + ' ' + (r.failure() || {}).errorText));

    await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'load', timeout: 30000 });
    // ASSERTION SELECTORS: derive from public/index.html at implementation time —
    // pick three stable hooks: (1) the app header/title element, (2) the deck
    // picker / deck buttons container, (3) the draw controls. waitForSelector
    // each with 15s timeout, and assert deck options/buttons count > 0 via $$eval.
    // Give the app 3 extra seconds for async init (images manifest, threshold).
    await wait(3000);

    fs.mkdirSync(path.join(ROOT, 'screenshots'), { recursive: true });
    await page.screenshot({ path: path.join(ROOT, 'screenshots', 'smoke-latest.png'), fullPage: false });

    const real = errors.filter(e => !ALLOWED_ERRORS.some(a => e.includes(a)));
    if (real.length) {
      console.error('SMOKE FAIL — frontend errors:');
      for (const e of real) console.error('  ' + e);
      process.exitCode = 1;
    } else {
      console.log('SMOKE PASS — app booted clean, UI rendered, screenshot saved.');
    }
  } finally {
    if (browser) await browser.close().catch(() => {});
    server.kill();
  }
}

main().catch(err => { console.error('SMOKE ERROR:', err.message); process.exit(1); });
```

Replace the ASSERTION SELECTORS comment block with real `waitForSelector`/`$$eval` assertions after reading `public/index.html` — three stable, load-bearing selectors minimum. If the baseline run surfaces pre-existing console errors, add them to `ALLOWED_ERRORS` with a one-line justification comment each; the pre-refactor app defines "clean".

- [ ] **Step 4: Add the npm script** — `"smoke": "node scripts/smoke-frontend.js"` in package.json scripts.

- [ ] **Step 5: Verify against the CURRENT (pre-refactor) app**

Run: `npm run smoke`
Expected: `SMOKE PASS`, screenshot written. This is the baseline; iterate on selectors/allowlist until it passes deterministically (run it twice to confirm).

- [ ] **Step 6: Also confirm** `npm test` (220) and `npm run lint` (0) — `scripts/` is already in the eslint backend glob.

- [ ] **Step 7: Commit**

```bash
git add scripts/smoke-frontend.js package.json package-lock.json
git commit -m "test: headless-browser smoke harness for the frontend (pre-split baseline)"
```

Also gitignore `screenshots/` if it is not already ignored (check; add if needed, include in this commit).

### Task 2: Flip app.js to an ES module (still monolithic)

**Files:**
- Modify: `public/index.html` (one script tag), `public/app.js` (2 call sites), `eslint.config.js` (override split)

- [ ] **Step 1:** In `public/index.html`, change `<script src="app.js"></script>` to `<script type="module" src="app.js"></script>`. theme-transition.js and ambient-lines.js script tags stay classic and stay ABOVE app.js.

- [ ] **Step 2:** In `public/app.js`, change the two cross-file call sites (map §3): `shouldCrossfade(` → `window.shouldCrossfade(` and `ambientLineFor(` → `window.ambientLineFor(` (all occurrences of each).

- [ ] **Step 3:** In `eslint.config.js`, split the `public/**/*.js` override into two:

```js
  {
    // Frontend ES modules (app.js entry + extracted modules)
    files: ['public/app.js', 'public/js/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.browser, html2canvas: 'readonly' },
    },
  },
  {
    // Classic scripts kept dual-consumable (browser global + node require for tests)
    files: ['public/theme-transition.js', 'public/ambient-lines.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: { ...globals.browser, module: 'readonly' },
    },
  },
```

(The `shouldCrossfade`/`ambientLineFor` global whitelist entries are deleted — call sites are now explicit `window.*`.)

- [ ] **Step 4:** Run `npm run lint` (0), `npm test` (220), `npm run smoke` (PASS). The smoke run here is the load-bearing check: it proves the whole 4,243-line file survives strict mode + module scope + deferred execution.

- [ ] **Step 5:** Commit: `git commit -am "refactor: load app.js as an ES module (monolith unchanged)"`

### Tasks 3–7: Extract the modules, leaf-first

Each task extracts the listed modules IN ORDER; for each module: create `public/js/<name>.js`, move the map §6-listed functions/consts verbatim (+ `export`), add the import block the movers need, add corresponding `import` lines to `public/app.js`, then run the full gate (`npm run lint && npm test && npm run smoke`) and commit `Extract <name> module (<n> functions, verified)`. ESLint `no-undef` under `sourceType: 'module'` is the proof that every moved reference is either imported or a browser/window global — a clean lint means no dangling names.

**Task 3 — foundation leaves:** `js/state.js` (shared mutable state per map §2 + the mapping-table rule), `js/spreads-data.js` (SPREADS + related const data; live export), `js/utils.js` (map's shared helpers used by 3+ features).
**Task 4 — presentation leaves:** `js/theme.js` (day-cycle/theme code that lives in app.js — NOT theme-transition.js which stays put), `js/deck.js` (deck selection/definitions: getDeck, noReversal, etc. per map).
**Task 5 — card surfaces:** `js/card-render.js` (makeCardEl, dealNow attachment, flip/animation), `js/overlay.js` (Miriel's-Choice takeover overlay + generic overlay plumbing per map).
**Task 6 — the big one:** `js/reading-flow.js` — the MERGED reading-session + claude-reading + clarifier cluster (map risk #1: these three form a genuine dependency cycle; merging them into one cohesive module is the deliberate resolution — do NOT split them or introduce an event bus). Largest single move; take it slowly, lint after every sub-section if helpful.
**Task 7 — remaining features:** `js/session-export.js` (save/export/html2canvas usage), `js/reader-identity.js` (reader picker/profile UI), `js/content-library.js` (journal/archive/notebook/grimoire surfaces per map).

Per-task footer (applies to Tasks 3–7): after the last module of the task, `git log --oneline` should show one commit per module; report the modules' line counts.

### Task 8: app.js becomes the entry module

**Files:**
- Modify: `public/app.js`

- [ ] **Step 1:** What remains in app.js after Task 7 should be: the import block, top-level wiring/event registrations the map §5 assigns to bootstrap, and `init()`. Move any straggler helpers to their map-assigned module (with the standard gate + commit per move). app.js target: under ~150 lines.
- [ ] **Step 2:** Confirm init order matches map §5 exactly (module import order + remaining top-level statements).
- [ ] **Step 3:** Full gate: `npm run lint && npm test && npm run smoke`. Then run smoke a second time (determinism).
- [ ] **Step 4:** `wc -l public/app.js public/js/*.js` — record counts. No module should exceed ~900 lines except reading-flow.js (the merged cycle; expected ~1,200-1,500).
- [ ] **Step 5:** Commit: `refactor: app.js reduced to entry module`

### Task 9: Docs + Electron packaged-build verification

**Files:**
- Modify: `ARCHITECTURE.md`, `docs/adr/001-no-frontend-framework.md`

- [ ] **Step 1:** ARCHITECTURE.md frontend bullet: replace "classic scripts today; ES-module split planned" with the reality (entry module + 12 modules under public/js/; theme-transition/ambient-lines deliberately classic for Node-test dual-consumption). Update the layer diagram's frontend line. Verify any counts stated (`ls public/js/*.js | wc -l`).
- [ ] **Step 2:** ADR-001: update the Decision/Consequences to note the split landed (structure via ES modules + ESLint, still no framework, still zero build step). Status line gains `Amended 2026-07-03: ES-module split shipped.`
- [ ] **Step 3:** Electron packaged-build check (the ABI-incident precedent demands it): run `npm run dist:win` (several minutes). Then launch the portable exe from `dist/` in the background, wait 15 seconds, verify the process is still alive (an ABI/module failure crashes within seconds), verify a new node/electron process is listening on a loopback port, then kill it. Record PID/port evidence in the report.
- [ ] **Step 4:** Full gate one more time: `npm run lint && npm test && npm run smoke`.
- [ ] **Step 5:** Commit docs: `docs: architecture + ADR-001 reflect ES-module frontend`

### Task 10 (controller): Final review, merge, publish, user smoke

Controller-run: whole-branch review package → final reviewer (most capable model) with the map + ledger; then `git checkout master && git merge --no-ff portfolio-phase3`; `npm test` on master; publish snapshot via `pwsh ./scripts/publish-to-cloud.ps1`; verify Miriels CI green; THEN ask the user for the single live-reading verification (post-publish; if it fails, fix-forward on master).

---

## Self-review notes

- Spec coverage: strangler protocol (tag → leaf-first extraction → one commit per module → smoke each step → packaged Electron build before merge) → Tasks 1–9; risk register's mitigations are embedded (no frontend tests → smoke harness; hidden shared state → state.js + map §2; init order → Task 2 early flip + map §5; Electron → Task 9 Step 3).
- Spec deviation, deliberate: spec's smoke checklist was manual per-extraction; replaced by the automated headless harness (stronger, and honors the user's no-stalls directive). The user's single manual smoke moves to after publish (Task 10).
- Spec's indicative module list (api-client, state, ...) superseded by the map's evidence-based 12-module set; the merged reading-flow.js resolves the discovered cycle — YAGNI over event-bus indirection.
- Placeholder scan: Task 1's selector block is an explicit derive-at-implementation instruction bounded by concrete acceptance (3 selectors, deterministic double-pass) — the implementer has index.html in hand; acceptable. Tasks 3–7 reference map §6 for exact function lists — the map is a committed-to-disk artifact, single source of truth by design.
- Type consistency: gate command identical everywhere; module names consistent between Tasks 3–7, 8, 9.
