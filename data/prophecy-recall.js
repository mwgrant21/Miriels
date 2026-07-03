'use strict';

const { sanitizeUntrusted } = require('./prompt-safety');

// Self-contained tokenizer/overlap (kept dependency-free so this module stays pure
// and unit-testable without loading the sqlite-backed memory engine; prompt-safety
// has no deps of its own, so requiring it does not pull in sqlite). Mirrors the
// tokenizer in data/memory-engine.js intentionally.
const STOPWORDS = new Set(
  ('the a an and or but if then of to in on for with about into your you i me my we our it its this that ' +
   'these those is are was were be been being do does did so as at by from will would can could should ' +
   'what when where who how').split(' ')
);

function tokenize(str) {
  return String(str || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !STOPWORDS.has(w));
}

function overlap(queryTokens, text) {
  if (!queryTokens.size) return 0;
  const seen = new Set();
  let hits = 0;
  for (const w of tokenize(text)) {
    if (queryTokens.has(w) && !seen.has(w)) { hits++; seen.add(w); }
  }
  return hits;
}

const VERDICT_WEIGHT = { came_to_pass: 3, partly: 2, did_not: 1 };
const VERDICT_KIND   = { came_to_pass: 'fulfilled', partly: 'partial', did_not: 'missed' };

function resolvedFact(kind, foretelling, outcome) {
  const tail = kind === 'fulfilled' ? 'It came to pass'
             : kind === 'partial'   ? 'It came partly true'
             : 'It did not come to pass';
  const f = sanitizeUntrusted(foretelling, 0);
  const o = outcome ? sanitizeUntrusted(outcome, 0) : outcome;
  return o
    ? `You foretold: "${f}". ${tail}: "${o}".`
    : `You foretold: "${f}". ${tail}.`;
}

function openFact(foretelling) {
  return `You foretold: "${sanitizeUntrusted(foretelling, 0)}". This is still unfolding, not yet resolved.`;
}

const DAY = 86400 * 1000;
const PROPHECY_SURFACE_TTL_DAYS = 21;

// Suppress foretellings the querent was already shown within the TTL, so the same
// foretelling does not re-surface on every keyword-matching reading. Keyed by the
// prediction id. No-op when no surfaced map / now is supplied (keeps the function
// pure and backward-compatible). Mirrors filterSurfaced in temporal-recall.js.
function filterProphecySurfaced(items, surfaced, now, ttlDays) {
  if (!surfaced || now == null) return items;
  const ttl = (ttlDays || PROPHECY_SURFACE_TTL_DAYS) * DAY;
  return items.filter(it => {
    const last = surfaced[it.id];
    return !(last && (now - last) < ttl);
  });
}

// Build a small dossier (<=3) of the reader's foretellings for the interpret LLM to
// weave in only when a current card/theme genuinely connects. Resolved hits lead
// (verdict weight), broken ties by lexical overlap with the question/cards, then by
// recency. Open (in-motion) predictions follow for continuity. Recently-surfaced
// foretellings are filtered out first (across-visit dedup) when a surfaced map and
// `now` are supplied. Pure: no I/O.
function findProphecyCallbacks({ resolved, open, currentCards, question, surfaced, now, ttlDays } = {}) {
  const cards = Array.isArray(currentCards) ? currentCards : [];
  const cardNames = cards.map(c => c && c.name).filter(Boolean).join(' ');
  const queryTokens = new Set(tokenize(`${question || ''} ${cardNames}`));

  const resolvedItems = (Array.isArray(resolved) ? resolved : [])
    .filter(r => r && r.foretelling)
    .map(r => {
      const verdict = r.verdict || null;
      const kind = VERDICT_KIND[verdict] || 'fulfilled';
      return {
        id: r.prediction_id,
        kind,
        verdict,
        foretelling: r.foretelling,
        outcome: r.outcome || null,
        fact: resolvedFact(kind, r.foretelling, r.outcome),
        _weight: VERDICT_WEIGHT[verdict] || 1,
        _ov: overlap(queryTokens, `${r.foretelling} ${r.outcome || ''}`),
        _ts: r.resolved_at || 0,
      };
    });

  const openItems = (Array.isArray(open) ? open : [])
    .filter(o => o && o.content)
    .map(o => ({
      id: o.id,
      kind: 'open',
      verdict: null,
      foretelling: o.content,
      outcome: null,
      fact: openFact(o.content),
      _weight: 0,
      _ov: overlap(queryTokens, o.content),
      _ts: o.created_at || 0,
    }));

  resolvedItems.sort((a, b) => (b._weight - a._weight) || (b._ov - a._ov) || (b._ts - a._ts));
  openItems.sort((a, b) => (b._ov - a._ov) || (b._ts - a._ts));

  return filterProphecySurfaced([...resolvedItems, ...openItems], surfaced, now, ttlDays)
    .slice(0, 3)
    .map(({ _weight, _ov, _ts, ...item }) => item);
}

module.exports = { findProphecyCallbacks, filterProphecySurfaced, PROPHECY_SURFACE_TTL_DAYS };
