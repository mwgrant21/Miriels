'use strict';

const DAY = 86400; // seconds
const MIN_FEELINGS_PER_SEASON = 4;
const SEASON_WINDOW_DAYS = 30;
const SEASON_CADENCE = 8;
const SHIFT_THRESHOLD = 2;
const THEME_MIN_SEASONS = 2;

function themesPhrase(themes) {
  const t = (themes || []).filter(Boolean);
  return t.length ? ` (${t.join(', ')})` : '';
}

// PURE: compare the latest season to the most-contrasting earlier one. Returns a
// fact string for Miriel to voice, or null when there is no real shift. Mirrors
// findTemporalCallbacks (pure, emits text only). `now` is unix seconds.
function detectSeasonShift(seasons, now) {
  if (!Array.isArray(seasons) || seasons.length < 2) return null;
  const latest = seasons[seasons.length - 1];
  let earlier = null;
  let bestDelta = -1;
  for (let i = 0; i < seasons.length - 1; i++) {
    const s = seasons[i];
    const delta = Math.abs((latest.valence || 0) - (s.valence || 0));
    if (delta > bestDelta || (delta === bestDelta && earlier && s.index > earlier.index)) {
      bestDelta = delta;
      earlier = s;
    }
  }
  if (!earlier || bestDelta < SHIFT_THRESHOLD) return null;
  const monthsAgo = Math.max(1, Math.round((now - earlier.ended_at) / (30 * DAY)));
  const fact =
    `About ${monthsAgo} month${monthsAgo === 1 ? '' : 's'} ago they were in "${earlier.label}"` +
    `${themesPhrase(earlier.themes)}; now they are in "${latest.label}"${themesPhrase(latest.themes)}. ` +
    `The emotional weather has shifted between these.`;
  return { kind: 'season-shift', signature: `season-shift:${earlier.index}->${latest.index}`, fact };
}

// PURE: find the emotional theme that recurs across the most seasons. Returns the
// single strongest recurring theme, or null when none reaches THEME_MIN_SEASONS
// distinct seasons. Ranked by distinct-season count, then total occurrences, then
// recency (highest season index). Mirrors detectSeasonShift's pure, text-emitting shape.
function detectRecurringTheme(seasons) {
  if (!Array.isArray(seasons) || seasons.length < 2) return null;
  const tally = new Map(); // theme -> { distinct, occ, lastIndex }
  seasons.forEach((s) => {
    const seenThisSeason = new Set();
    for (const raw of (s.themes || [])) {
      const t = String(raw || '').trim().toLowerCase();
      if (!t) continue;
      const e = tally.get(t) || { distinct: 0, occ: 0, lastIndex: -1 };
      e.occ += 1;
      if (!seenThisSeason.has(t)) { e.distinct += 1; seenThisSeason.add(t); }
      e.lastIndex = Math.max(e.lastIndex, s.index);
      tally.set(t, e);
    }
  });
  const candidates = [];
  for (const [theme, e] of tally) {
    if (e.distinct >= THEME_MIN_SEASONS) candidates.push({ theme, ...e });
  }
  if (!candidates.length) return null;
  candidates.sort((a, b) => b.distinct - a.distinct || b.occ - a.occ || b.lastIndex - a.lastIndex);
  const top = candidates[0];
  return {
    theme: top.theme,
    seasons: top.distinct,
    fact: `The emotional thread of "${top.theme}" keeps returning across their record, present in ${top.distinct} of the seasons you have witnessed in them.`,
  };
}

const SEASON_SYSTEM =
  'You are Miriel, an experienced tarot reader keeping a private record of the emotional ' +
  'seasons of the person you read for. Given the things they have felt over one stretch of ' +
  'time, characterize that season. Respond with ONLY a JSON object: ' +
  '{"label": short evocative name, "valence": integer from -2 (heavy) to 2 (light), ' +
  '"themes": array of 1-4 short lowercase words, "summary": one or two sentences in the ' +
  'second person ("you")}. ASCII only. No em dashes. No text outside the JSON.';

function buildSeasonPrompt(feelings) {
  const lines = feelings.map(f => `- ${f.content}`).join('\n');
  return `Things they have felt during one stretch of time:\n${lines}\n\n` +
         `Characterize this emotional season now. Return only the JSON object.`;
}

function parseSeasonOutput(raw) {
  if (!raw) return null;
  const s = String(raw);
  const a = s.indexOf('{');
  const b = s.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  let obj;
  try { obj = JSON.parse(s.slice(a, b + 1)); } catch { return null; }
  if (!obj || typeof obj !== 'object') return null;
  const label = typeof obj.label === 'string' ? obj.label.trim() : '';
  const summary = typeof obj.summary === 'string' ? obj.summary.trim() : '';
  if (!label || !summary) return null;
  let valence = parseInt(obj.valence, 10);
  if (Number.isNaN(valence)) valence = 0;
  valence = Math.max(-2, Math.min(2, valence));
  const themes = Array.isArray(obj.themes)
    ? obj.themes.filter(t => typeof t === 'string' && t.trim()).map(t => t.trim().toLowerCase()).slice(0, 4)
    : [];
  return { label, valence, themes, summary };
}

module.exports = function createEmotionalSeasons(store) {
  function listFeelings(slug) {
    return (store.listMemories(slug) || [])
      .filter(m => m.type === 'feeling')
      .map(m => ({ content: m.content, salience: m.salience, created_at: m.created_at }))
      .sort((a, b) => a.created_at - b.created_at);
  }

  function readTimeline(slug) {
    try { return JSON.parse(store.getMeta(`seasons:${slug}`) || '[]'); } catch { return []; }
  }
  function writeTimeline(slug, timeline) {
    store.setMeta(`seasons:${slug}`, JSON.stringify(timeline));
  }

  // Async, best-effort. Characterizes feelings newer than the last season's
  // ended_at into ONE new record. Never throws into the caller (mirrors
  // profiles.updateLivingNote). Cadence gating happens at the call site.
  async function updateSeasons(slug, callLLM) {
    try {
      const timeline = readTimeline(slug);
      const windowStart = timeline.length ? timeline[timeline.length - 1].ended_at : 0;
      const feelings = listFeelings(slug).filter(f => f.created_at > windowStart);
      if (feelings.length < MIN_FEELINGS_PER_SEASON) return { added: 0 };
      const raw = await callLLM(SEASON_SYSTEM, buildSeasonPrompt(feelings), 300, 'claude-haiku-4-5-20251001');
      const parsed = parseSeasonOutput(raw);
      if (!parsed) return { added: 0 };
      timeline.push({ index: timeline.length, started_at: feelings[0].created_at, ended_at: feelings[feelings.length - 1].created_at, ...parsed });
      writeTimeline(slug, timeline);
      return { added: 1 };
    } catch {
      return { added: 0 };
    }
  }

  // Group consecutive feelings (ascending) into windows of at most windowDays,
  // measured from each window's first feeling.
  function bucketWindows(feelings, windowDays) {
    const span = windowDays * DAY;
    const windows = [];
    let cur = [];
    let start = null;
    for (const f of feelings) {
      if (start === null) { start = f.created_at; cur = [f]; continue; }
      if (f.created_at - start <= span) { cur.push(f); }
      else { windows.push(cur); cur = [f]; start = f.created_at; }
    }
    if (cur.length) windows.push(cur);
    return windows;
  }

  // One-time, idempotent. Lets a callLLM throw propagate so the flag is never set
  // and the next boot retries from scratch (same contract as memory backfill()).
  async function backfillSeasons(slug, callLLM) {
    if (store.getMeta(`seasons_backfilled:${slug}`)) return { skipped: true };
    if (readTimeline(slug).length) { store.setMeta(`seasons_backfilled:${slug}`, '1'); return { skipped: true }; }
    const windows = bucketWindows(listFeelings(slug), SEASON_WINDOW_DAYS);
    const timeline = [];
    for (const w of windows) {
      if (w.length < MIN_FEELINGS_PER_SEASON) continue;
      const raw = await callLLM(SEASON_SYSTEM, buildSeasonPrompt(w), 300, 'claude-haiku-4-5-20251001');
      const parsed = parseSeasonOutput(raw);
      if (!parsed) continue;
      timeline.push({ index: timeline.length, started_at: w[0].created_at, ended_at: w[w.length - 1].created_at, ...parsed });
    }
    if (timeline.length) writeTimeline(slug, timeline);
    store.setMeta(`seasons_backfilled:${slug}`, '1');
    return { added: timeline.length };
  }

  return { listFeelings, updateSeasons, backfillSeasons, SEASON_CADENCE };
};

module.exports.detectSeasonShift = detectSeasonShift;
module.exports.detectRecurringTheme = detectRecurringTheme;
module.exports.SEASON_CADENCE = SEASON_CADENCE;
module.exports.MIN_FEELINGS_PER_SEASON = MIN_FEELINGS_PER_SEASON;
module.exports.SEASON_WINDOW_DAYS = SEASON_WINDOW_DAYS;
module.exports.SHIFT_THRESHOLD = SHIFT_THRESHOLD;
module.exports.THEME_MIN_SEASONS = THEME_MIN_SEASONS;
