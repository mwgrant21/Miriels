'use strict';

const { fence } = require('./prompt-safety');

const DAY = 86400000; // ms

function near(age, target, windowMs) { return Math.abs(age - target) <= windowMs; }

function cardNames(r) {
  return (r.cards || []).map(c => c.name).filter(Boolean).join(', ') || 'the cards';
}

function describeGap(days) {
  if (days >= 330) return 'a year';
  if (days >= 60)  return `${Math.round(days / 30)} months`;
  if (days >= 21)  return `${Math.round(days / 7)} weeks`;
  return `${Math.round(days)} days`;
}

function addMonths(ts, months) {
  const d = new Date(ts);
  d.setMonth(d.getMonth() + months);
  return d.getTime();
}

function findTemporalCallbacks({ readings, lastVisitTs, now }) {
  const list = (Array.isArray(readings) ? readings : []).filter(r => r && typeof r.timestamp === 'number');
  const count = list.length;
  const out = [];
  const ANNIV_WINDOW = 3 * DAY;

  // Only the 1-year anniversary — the 1-month tier was too weak and was being
  // misread as "you were last here a month ago" (it is about a PAST READING).
  for (const r of list) {
    const age = now - r.timestamp;
    if (age <= 0) continue;
    if (near(age, 365 * DAY, ANNIV_WINDOW)) {
      out.push({ kind: 'anniversary', strength: 5, signature: `anniversary:1y:${r.id}`,
        fact: `Exactly one year ago, in a past reading (not their last visit), they asked: ${r.question ? fence('querent_question', r.question, 300) : '(no question)'} (${cardNames(r)}).`,
        ref: { date: r.date, question: r.question, cards: r.cards } });
    }
  }

  if (lastVisitTs != null) {
    const gapDays = (now - Number(lastVisitTs)) / DAY;
    if (gapDays >= 21) {
      out.push({ kind: 'elapsed', strength: Math.min(5, 3 + Math.floor(gapDays / 30)),
        signature: `elapsed:${Math.round(gapDays)}d`,
        fact: `It has been about ${describeGap(gapDays)} since they last sat with you.` });
    }
  }

  // Seasonal echo: same calendar month, a prior year, not already a 1y anniversary.
  // Pick the MOST RECENT such reading (closest prior year) — the most resonant.
  const nowD = new Date(now);
  const nowMonth = nowD.getMonth();
  const nowYear = nowD.getFullYear();
  let seasonalBest = null;
  for (const r of list) {
    const d = new Date(r.timestamp);
    const age = now - r.timestamp;
    if (d.getMonth() === nowMonth && d.getFullYear() < nowYear && !near(age, 365 * DAY, ANNIV_WINDOW)) {
      if (!seasonalBest || r.timestamp > seasonalBest.timestamp) seasonalBest = r;
    }
  }
  if (seasonalBest) {
    const yrs = nowYear - new Date(seasonalBest.timestamp).getFullYear();
    out.push({ kind: 'seasonal', strength: 2, signature: `seasonal:${new Date(seasonalBest.timestamp).getFullYear()}:${seasonalBest.id}`,
      fact: `Around this time ${yrs} year${yrs > 1 ? 's' : ''} ago they asked: ${seasonalBest.question ? fence('querent_question', seasonalBest.question, 300) : '(no question)'} (${cardNames(seasonalBest)}).`,
      ref: { date: seasonalBest.date, question: seasonalBest.question, cards: seasonalBest.cards } });
  }

  // Milestone: round reading-count totals. NOTE: surfaced via filterSurfaced's
  // TTL — if the querent lingers at exactly a multiple of 50 for >TTL days it
  // could resurface; acceptable since counts normally advance with use.
  if (count > 0 && count % 50 === 0) {
    out.push({ kind: 'milestone', strength: 4, signature: `milestone:count:${count}`,
      fact: `They have now sat with you around ${count} times.` });
  }
  if (count > 0) {
    const firstTs = list.reduce((a, r) => Math.min(a, r.timestamp), Infinity);
    for (const m of [6, 12, 24, 36, 48]) {
      if (near(now - addMonths(firstTs, m), 0, ANNIV_WINDOW)) {
        const years = m % 12 === 0 ? `${m / 12} year${m / 12 > 1 ? 's' : ''}` : `${m} months`;
        out.push({ kind: 'milestone', strength: 4, signature: `milestone:met:${m}m`,
          fact: `It has been ${years} since they first sat down with you.` });
        break;
      }
    }
  }

  out.sort((a, b) => b.strength - a.strength);
  return out;
}

function filterSurfaced(candidates, surfacedMap, now, ttlDays) {
  const map = surfacedMap || {};
  const ttl = ttlDays * DAY;
  return (candidates || []).filter(c => {
    const last = map[c.signature];
    return !(last && (now - last) < ttl);
  });
}

module.exports = { findTemporalCallbacks, filterSurfaced };
