'use strict';
// Integration suite pinning /api behavior across the Phase 2 route split.
// Tests share one app instance + temp DATA_DIR and run in file order.
// LLM-dependent endpoints are deliberately not exercised (see phase-2 plan).
const os   = require('os');
const path = require('path');
const fs   = require('fs');
const { test, after } = require('node:test');
const assert = require('node:assert/strict');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tarot-routes-'));
process.env.DATA_DIR = tmp;
delete process.env.ANTHROPIC_API_KEY; // never let tests reach the real Claude API

const DECKS = ['tarot', 'oracle', 'miriel-lunar', 'veil-arcana', 'drowned-ephemeris',
               'lenormand', 'thoth', 'runic', 'iching'];
for (const d of DECKS) {
  fs.writeFileSync(path.join(tmp, `${d}.json`),
    JSON.stringify([{ id: `${d}-01`, name: `${d} test card`, upright: 'u', reversed: 'r' }]));
}

const app = require('../server');
const server = app.listen(0, '127.0.0.1');
after(() => server.close());
const base = () => `http://127.0.0.1:${server.address().port}`;

async function j(method, p, body) {
  const res = await fetch(base() + p, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

test('GET /api/readers returns the default reader created by migration', async () => {
  const r = await j('GET', '/api/readers');
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.body));
  assert.equal(r.body[0].slug, 'matt');
});

test('POST /api/readers validates name and creates collision-safe slug', async () => {
  let r = await j('POST', '/api/readers', { name: '   ' });
  assert.equal(r.status, 400);
  r = await j('POST', '/api/readers', { name: 'Matt' });
  assert.equal(r.status, 200);
  assert.equal(r.body.slug, 'matt-2');
  assert.ok(fs.existsSync(path.join(tmp, 'readings', 'matt-2.json')));
});

test('DELETE /api/readers/:slug 404s unknown, deletes existing, refuses last', async () => {
  let r = await j('DELETE', '/api/readers/nope');
  assert.equal(r.status, 404);
  r = await j('DELETE', '/api/readers/matt-2');
  assert.equal(r.status, 200);
  r = await j('DELETE', '/api/readers/matt');
  assert.equal(r.status, 400); // cannot remove the last reader
});

test('POST /api/readings validates payload, persists; GET honors limit', async () => {
  let r = await j('POST', '/api/readings', { nope: true });
  assert.equal(r.status, 400);
  for (let i = 1; i <= 7; i++) {
    r = await j('POST', '/api/readings', {
      reader: 'matt', date: `2026-07-0${i}`, spread: 'single', deck: 'tarot',
      cards: [{ name: 'Test Card', isReversed: false }],
    });
    assert.equal(r.status, 200);
  }
  r = await j('GET', '/api/readings?reader=matt');
  assert.equal(r.body.length, 5);            // default limit 5
  r = await j('GET', '/api/readings?reader=matt&limit=0');
  assert.equal(r.body.length, 7);            // limit=0 → full history
  assert.ok(r.body[0].id);                   // server stamps an id
});

test('GET /api/cards serves all nine decks', async () => {
  const r = await j('GET', '/api/cards');
  assert.equal(r.status, 200);
  for (const d of DECKS) {
    assert.ok(Array.isArray(r.body[d]), `deck ${d} missing`);
    assert.equal(r.body[d][0].name, `${d} test card`);
  }
});

test('GET /api/images returns a manifest keyed by deck', async () => {
  const r = await j('GET', '/api/images');
  assert.equal(r.status, 200);
  for (const k of ['tarot', 'veil-arcana', 'miriel-lunar', 'oracle', 'runic',
                   'iching', 'thoth', 'drowned-ephemeris']) {
    assert.ok(typeof r.body[k] === 'object', `manifest key ${k} missing`);
  }
});

test('GET /api/cache/stats responds with an object', async () => {
  const r = await j('GET', '/api/cache/stats');
  assert.equal(r.status, 200);
  assert.ok(r.body && typeof r.body === 'object');
});

test('GET /api/profiles/:slug 404s unknown reader, returns payload for matt', async () => {
  let r = await j('GET', '/api/profiles/ghost');
  assert.equal(r.status, 404);
  r = await j('GET', '/api/profiles/matt');
  assert.equal(r.status, 200);
  assert.ok(r.body && typeof r.body === 'object');
});

test('GET /api/foretellings/:slug returns an empty list for a fresh store', async () => {
  const r = await j('GET', '/api/foretellings/matt');
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.foretellings, []);
});

test('POST /api/config rejects malformed API keys', async () => {
  const r = await j('POST', '/api/config', { apiKey: 'not-a-key' });
  assert.equal(r.status, 400);
});

test('GET /api/config-status reports boolean flags', async () => {
  const r = await j('GET', '/api/config-status');
  assert.equal(r.status, 200);
  assert.equal(typeof r.body.hasKey, 'boolean');
  assert.equal(typeof r.body.hasLocalModel, 'boolean');
});
