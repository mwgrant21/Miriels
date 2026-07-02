'use strict';

const DAY = 86400000; // ms
const RETURN_GAP_MS = 90 * DAY;
const SUIT_RE = /\bof\s+(wands|cups|swords|pentacles|disks|coins)\b/i;

function norm(name) { return String(name || '').trim().toLowerCase(); }

function suitOf(name) {
  const m = SUIT_RE.exec(name || '');
  if (!m) return null;
  let s = m[1].toLowerCase();
  if (s === 'disks' || s === 'coins') s = 'pentacles';
  return s;
}

function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function describeGap(ms) {
  const days = ms / DAY;
  if (days >= 330) return 'almost a year';
  if (days >= 60)  return `about ${Math.round(days / 30)} months`;
  if (days >= 21)  return `about ${Math.round(days / 7)} weeks`;
  return `about ${Math.round(days)} days`;
}

// IMPORTANT: `readings` must be the reader's history WITHOUT the current draw
// (the reading being interpreted is saved only after interpretation). Counts are
// computed as historical + 1 for the current draw; passing post-save readings
// would double-count the current cards in both recurrence and suit-skew.
function findCardPatterns({ readings, currentCards, now }) {
  const sorted = (Array.isArray(readings) ? readings : [])
    .filter(r => r && typeof r.timestamp === 'number')
    .sort((a, b) => a.timestamp - b.timestamp);

  const appearances = [];
  for (const r of sorted) for (const c of (r.cards || [])) {
    appearances.push({ name: norm(c.name), reversed: !!c.isReversed, ts: r.timestamp });
  }

  const cur = Array.isArray(currentCards) ? currentCards : [];
  const lastN = sorted.slice(-8);
  const byCard = new Map();

  for (const c of cur) {
    const nm = norm(c.name);
    if (!nm || byCard.has(nm)) continue;
    const hist = appearances.filter(a => a.name === nm);
    const total = hist.length;
    const last30 = hist.filter(a => now - a.ts <= 30 * DAY).length;
    const inLastN = lastN.filter(r => (r.cards || []).some(x => norm(x.name) === nm)).length;

    if (c.isReversed && total >= 3) {
      const revShare = hist.filter(a => a.reversed).length / total;
      if (revShare >= 0.7) {
        byCard.set(nm, {
          kind: 'reversal',
          strength: 4 + (revShare >= 0.9 ? 1 : 0),
          fact: `${c.name}, reversed again, it almost never lands upright for you (${Math.round(revShare * 100)}% of the times it's come).`,
        });
        continue;
      }
    }

    if (total >= 3) {
      const lastPriorTs = Math.max(...hist.map(a => a.ts));
      const gapMs = now - lastPriorTs;
      if (gapMs >= RETURN_GAP_MS) {
        byCard.set(nm, {
          kind: 'returning',
          strength: 4 + (gapMs >= 180 * DAY ? 1 : 0),
          fact: `${c.name} returns, you haven't drawn it in ${describeGap(gapMs)}.`,
        });
        continue;
      }
    }

    if (total >= 3 || last30 >= 2 || inLastN >= 4) {
      const ever = total + 1;
      const month = last30 + 1;
      const bits = [];
      if (last30 >= 2) bits.push(`${month} times this past month`);
      bits.push(`the ${ordinal(ever)} time you've drawn it`);
      byCard.set(nm, {
        kind: 'recurrence',
        strength: (last30 >= 2 ? 2 : 0) + Math.min(3, ever),
        fact: `${c.name} again, ${bits.join(', ')}.`,
      });
    }
  }

  const facts = [...byCard.values()];

  const windowCards = [
    ...cur.map(c => c.name),
    ...sorted.slice(-5).flatMap(r => (r.cards || []).map(x => x.name)),
  ];
  const suits = windowCards.map(suitOf).filter(Boolean);
  if (suits.length >= 4) {
    const counts = {};
    for (const s of suits) counts[s] = (counts[s] || 0) + 1;
    let top = null;
    for (const s of Object.keys(counts)) if (!top || counts[s] > counts[top]) top = s;
    if (top && counts[top] / suits.length >= 0.5) {
      facts.push({
        kind: 'skew',
        strength: 2,
        fact: `${top.charAt(0).toUpperCase() + top.slice(1)} keep crowding your spreads lately.`,
      });
    }
  }

  facts.sort((a, b) => b.strength - a.strength);
  return facts.slice(0, 3);
}

module.exports = { findCardPatterns };
