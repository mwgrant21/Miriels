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
const ALLOWED_ERRORS = [
  // Chrome's own CSP parser warns that <meta> can't carry frame-ancestors;
  // it silently ignores that one directive and enforces the rest. Cosmetic.
  "The Content Security Policy directive 'frame-ancestors' is ignored when delivered via a <meta> element.",
];

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
    const httpFailures = [];
    page.on('pageerror', e => errors.push('pageerror: ' + e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
    page.on('requestfailed', r => errors.push('requestfailed: ' + r.url() + ' ' + (r.failure() || {}).errorText));
    page.on('response', res => {
      const url = res.url();
      // Browsers auto-request /favicon.ico; the app serves none. That's the
      // one known-benign 404 — every other >=400 response is a real finding.
      if (url.endsWith('/favicon.ico')) return;
      if (res.status() >= 400) httpFailures.push(res.status() + ' ' + url);
    });

    await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'load', timeout: 30000 });

    // ASSERTION 1: app header/title — the h1 that names the app.
    await page.waitForSelector('header h1', { timeout: 15000 });
    const titleText = await page.$eval('header h1', el => el.textContent.trim());
    if (!titleText) throw new Error('header h1 rendered but has no text');

    // ASSERTION 2: deck picker — <select id="deck-select"> must have options.
    await page.waitForSelector('#deck-select', { timeout: 15000 });
    const deckOptionCount = await page.$$eval('#deck-select option', opts => opts.length);
    if (deckOptionCount === 0) throw new Error('deck-select rendered with zero options');

    // ASSERTION 3: draw controls — the primary "Lay the Cards" button.
    await page.waitForSelector('#draw-btn', { timeout: 15000 });
    const drawBtnCount = await page.$$eval('#draw-btn', els => els.length);
    if (drawBtnCount === 0) throw new Error('draw-btn not found');

    // Give the app 3 extra seconds for async init (images manifest, threshold).
    await wait(3000);

    fs.mkdirSync(path.join(ROOT, 'screenshots'), { recursive: true });
    await page.screenshot({ path: path.join(ROOT, 'screenshots', 'smoke-latest.png'), fullPage: false });

    // Console "Failed to load resource" lines are now covered precisely by
    // the response handler above: a real (non-favicon) HTTP failure shows up
    // in httpFailures, so a bare console 404 line is just favicon noise.
    const real = errors
      .filter(e => !e.includes('Failed to load resource'))
      .filter(e => !ALLOWED_ERRORS.some(a => e.includes(a)));
    if (real.length || httpFailures.length) {
      console.error('SMOKE FAIL — frontend errors:');
      for (const e of real) console.error('  ' + e);
      for (const f of httpFailures) console.error('  http: ' + f);
      process.exitCode = 1;
    } else {
      console.log('SMOKE PASS — app booted clean, UI rendered, screenshot saved.');
    }
  } finally {
    if (browser) await browser.close().catch(() => {});
    server.kill();
    // Best-effort cleanup: the server process may hold the scratch dir open
    // briefly on Windows after kill(), so swallow any removal error.
    try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch {}
  }
}

main().catch(err => { console.error('SMOKE ERROR:', err.message); process.exit(1); });
