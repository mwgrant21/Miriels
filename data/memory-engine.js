// @ts-check
'use strict';
const createMemoryStore = require('./memory-store');
const { buildAddressingNote } = require('./addressing');
const { fence, sanitizeUntrusted } = require('./prompt-safety');

function parseExtractorOutput(raw) {
  if (!raw) return [];
  const text = String(raw);
  const objStart = text.indexOf('{');
  const arrStart = text.indexOf('[');
  try {
    if (objStart !== -1 && (arrStart === -1 || objStart < arrStart)) {
      const parsed = JSON.parse(text.slice(objStart, text.lastIndexOf('}') + 1));
      if (Array.isArray(parsed)) return parsed;
      if (parsed && Array.isArray(parsed.operations)) return parsed.operations;
      return [];
    }
    if (arrStart !== -1) {
      const parsed = JSON.parse(text.slice(arrStart, text.lastIndexOf(']') + 1));
      return Array.isArray(parsed) ? parsed : [];
    }
  } catch {
    return [];
  }
  return [];
}

function parseCuriosityOutput(raw) {
  if (!raw) return [];
  const text = String(raw);
  const objStart = text.indexOf('{');
  const arrStart = text.indexOf('[');
  try {
    if (objStart !== -1 && (arrStart === -1 || objStart < arrStart)) {
      const parsed = JSON.parse(text.slice(objStart, text.lastIndexOf('}') + 1));
      if (Array.isArray(parsed)) return parsed;
      if (parsed && Array.isArray(parsed.questions)) return parsed.questions;
      return [];
    }
    if (arrStart !== -1) {
      const parsed = JSON.parse(text.slice(arrStart, text.lastIndexOf(']') + 1));
      return Array.isArray(parsed) ? parsed : [];
    }
  } catch {
    return [];
  }
  return [];
}

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

function keywordOverlap(queryTokens, memTokens) {
  if (!queryTokens.size || !memTokens.length) return 0;
  const seen = new Set();
  let hits = 0;
  for (const w of memTokens) {
    if (queryTokens.has(w) && !seen.has(w)) { hits++; seen.add(w); }
  }
  return Math.min(1, hits / 3); // 3+ shared salient words = full marks
}

// Higher when we have NOT surfaced this memory recently -- discourages repeating
// the same line every reading. Never-referenced memories score a full 1.
function freshness(lastRef, now) {
  if (!lastRef) return 1;
  const days = (now - lastRef) / 86400;
  return Math.min(1, days / 30);
}

function scoreMemory(m, queryTokens, now) {
  const statusW = m.status === 'open' ? 1 : m.status === 'moving' ? 0.6 : 0;
  const sal     = Math.min(5, Math.max(1, m.salience || 3)) / 5;
  const overlap = keywordOverlap(queryTokens, tokenize(`${m.content} ${m.subject || ''}`));
  const fresh   = freshness(m.last_referenced_at, now);
  const over    = Math.min(1, (m.reference_count || 0) / 5);
  return 3.0 * overlap + 1.5 * sal + 1.5 * statusW + 0.5 * fresh - 0.4 * over;
}

/**
 * @param {Array<any>} candidates
 * @param {object} [opts]
 * @param {string} [opts.question]
 * @param {Array<{ name?: string }>} [opts.cards]
 * @param {number} [opts.now]
 */
function scoreCandidates(candidates, { question, cards, now } = {}) {
  const cardNames   = (cards || []).map(c => c.name).join(' ');
  const queryTokens = new Set(tokenize(`${question || ''} ${cardNames}`));
  const t = now || Math.floor(Date.now() / 1000);
  return candidates
    .map(m => ({ memory: m, score: scoreMemory(m, queryTokens, t) }))
    .sort((a, b) => b.score - a.score);
}

const RECALL_LIMIT = 10;

function formatRecallBlock(memories) {
  if (!memories || !memories.length) return '';
  const lines = memories.map(m => `- ${sanitizeUntrusted(m.content, 0)}`).join('\n');
  return `\n\nWhat you know about this person that may bear on what's in front of them now. ` +
         `Draw on whatever genuinely connects to their question or these cards, and when you do, ` +
         `name it specifically (the actual moment or thread), not a vague gesture. Don't force in ` +
         `memories that don't fit; say nothing rather than reach:\n${lines}`;
}

const REUNION_GAP_DAYS      = 2;
const THRESHOLD_SALIENCE_BAR = 3;
const REUNION_MAX_THREADS   = 3;

function decideThresholdMode(lastVisitTs, threads, now, gapDays = REUNION_GAP_DAYS, predictions = [], temporalCallbacks = [], dormantThreads = [], seasonShift = null) {
  const hasMaterial = (threads && threads.length) || (predictions && predictions.length) || (temporalCallbacks && temporalCallbacks.length) || (dormantThreads && dormantThreads.length) || !!seasonShift;
  if (!hasMaterial) return 'none';
  const gap = (lastVisitTs == null) ? Infinity : (now - Number(lastVisitTs)) / 86400;
  return gap >= gapDays ? 'reunion' : 'gentle';
}

function threadLines(threads) {
  return (threads || []).map(t => `- ${sanitizeUntrusted(t.content, 0)}`).join('\n');
}

function predictionLines(predictions) {
  return (predictions || []).map(p => `- ${sanitizeUntrusted(p.content, 0)}`).join('\n');
}

function buildGreetingPrompt(mode, threads, gapDays, predictions = [], temporalCallbacks = [], timeOfDay = '', dormantThreads = [], seasonShift = null) {
  const gap = Math.max(0, Math.round(gapDays));
  const gapPhrase = !isFinite(gapDays)
    ? 'It has been some time since they last sat with you.'
    : `About ${gap} day${gap === 1 ? '' : 's'} have passed since they last sat with you.`;

  const hasThreads = threads && threads.length;
  const hasPreds   = predictions && predictions.length;

  const threadBlock = hasThreads
    ? `Open thread${threads.length > 1 ? 's' : ''} still between you:\n${threadLines(threads)}`
    : '';
  const predBlock = hasPreds
    ? `Thing${predictions.length > 1 ? 's' : ''} the cards once foretold through you, which may have come to pass by now:\n${predictionLines(predictions)}`
    : '';
  const hasDormant = dormantThreads && dormantThreads.length;
  const dormantBlock = hasDormant
    ? `Thread${dormantThreads.length > 1 ? 's' : ''} that ${dormantThreads.length > 1 ? 'have' : 'has'} gone quiet between you. They spoke of ${dormantThreads.length > 1 ? 'these' : 'this'} once, but not for a long while now:\n${dormantThreads.map(t => `- ${t.content}`).join('\n')}\n\nYou have been quietly holding ${dormantThreads.length > 1 ? 'these' : 'this'}. If it feels natural, gently wonder aloud whether ${dormantThreads.length > 1 ? 'they ever settled' : 'it ever settled'}, not as a checklist, but the way you would ask after something a friend once carried and may no longer be carrying. Do not press; if they do not take it up, let it rest.`
    : '';
  const seasonBlock = seasonShift
    ? `The emotional weather you have watched move through them over time:\n${seasonShift.fact}\n\n` +
      `If it feels true and kind, reflect this change back to them in your own voice, gently and specifically, ` +
      `as someone who has sat with them across these seasons. Notice it; do not diagnose or explain it.`
    : '';
  const temporalBlock = (temporalCallbacks && temporalCallbacks.length)
    ? `What you notice about the timing, in your own words:\n${temporalCallbacks.map(c => `- ${c.fact}`).join('\n')}\n\nIf this carries real history (a question they actually asked, the cards that fell), recall it concretely and specifically. Name it. Let them feel that you genuinely remember them and what they were carrying, then let it lead into now. If it is only a span of time (how long it has been, a milestone), simply acknowledge it warmly without inventing detail. IMPORTANT: these are facts about PAST READINGS, not about when they last visited. Do not say it has been a month or a year since they were here unless the gap line above actually says so. Honor the real recency stated above.`
    : '';
  const timeHint = timeOfDay
    ? `It is currently ${timeOfDay} where they are. You may let the hour gently color your greeting (a passing nod to the light or the time), but only if it feels natural; never force it and never make it the focus.`
    : '';
  const material = [temporalBlock, threadBlock, dormantBlock, seasonBlock, predBlock, timeHint].filter(Boolean).join('\n\n');
  const both = hasThreads && hasPreds;

  const askParts = [];
  if (hasThreads) askParts.push(`what came of ${threads.length > 1 ? 'them' : 'it'}`);
  if (hasPreds)   askParts.push('whether what the cards foretold has come to pass');
  const ask = askParts.join(', and ');

  if (mode === 'gentle') {
    // When only a temporal callback drives the greeting (no threads/predictions),
    // there is nothing to "ask what came of", pivot to letting the timing speak.
    const instruction = ask
      ? `Greet them warmly and briefly, in your own voice, and gently ask ${ask}, woven in naturally, not as a form.`
      : `Greet them warmly and briefly, in your own voice, letting what you notice about the timing surface naturally if it feels right, no question is needed.`;
    return `This person has just returned for a reading. ${gapPhrase}
${material}

${instruction} Two or three sentences. Do not begin the reading yet. Speak only your greeting.`;
  }
  const instruction = ask
    ? `Greet them the way you would greet someone you know well who has been away, acknowledge the gap as you naturally would, then say you have been holding ${both ? 'these' : 'this'} for them, and ask ${ask}.`
    : `Greet them the way you would greet someone you know well who has been away, acknowledge the gap, and let what you notice about the timing surface if it feels right.`;
  return `This person has just returned to you after a real absence. ${gapPhrase}
${material}

${instruction} Warm, unhurried, unmistakably you. Three to five sentences. Do not begin the reading. Speak only your greeting${ask ? ' and your question' : ''}.`;
}

function buildReplyPrompt(threads, answer) {
  return `Moments ago you asked this person what had come of:
${threadLines(threads)}

They answered: ${fence('answer', answer, 800)}

Respond as Miriel, take in what they said and reflect it back briefly, with warmth and honesty, and let it settle into a single quiet bridge toward the reading to come. One or two sentences. Do not read the cards yet.`;
}

const THRESHOLD_CAPTURE_SYSTEM =
  'You are the memory keeper for a tarot reader named Miriel. The querent has just told Miriel ' +
  'what came of the open threads and foretellings she remembered. Update her memory from their answer, ' +
  'resolving a prediction with a verdict when they report how it turned out. Be conservative: ' +
  'only what they actually said. Never invent.';

function buildThresholdCapturePrompt(items, answer) {
  const block = (items || [])
    .map(t => `#${t.id} [${t.type || 'thread'}/${t.status || '-'}] ${sanitizeUntrusted(t.content, 0)}`).join('\n');
  return `WHAT MIRIEL ASKED ABOUT:
${block}

WHAT THE PERSON SAID:
${fence('answer', answer, 1000)}

Update memory. Respond with ONLY a JSON object:

{"operations":[
  {"op":"RESOLVE","id":7,"verdict":"came_to_pass","outcome":"one short line in Miriel's voice on how it concluded"},
  {"op":"UPDATE","id":8,"status":"moving","content":"refined one-sentence state"},
  {"op":"ADD","type":"event","content":"a new specific thing they mentioned","salience":3}
]}

Rules:
- For a PREDICTION (type prediction) the person reports on, emit RESOLVE with:
    "verdict": one of "came_to_pass", "did_not", "partly", or "too_soon" (use too_soon ONLY if it genuinely cannot be judged yet);
    "outcome": a single short line in Miriel's own voice (e.g. "The time with Maggie has ended."). Omit "outcome" when the verdict is too_soon.
- For a THREAD (type thread) the person reports as concluded, emit RESOLVE with an "outcome" line (no verdict needed).
- UPDATE a thread or prediction still in motion, set status "moving" and optionally refine content.
- ADD a new memory only for genuinely new specifics they mentioned (type: person|thread|event|feeling|prediction|fact|preference; salience 1-5).
- If they were vague or skipped, return {"operations":[]}.
- Record only what they actually said. Do not invent.`;
}

const CURIOSITY_SYSTEM =
  'You are the quiet intuition of a tarot reader named Miriel. As she lays a spread, a single card ' +
  'will sometimes stop her because it stirs something she remembers about this person. You decide, ' +
  'conservatively, whether any card genuinely does that. Never force a connection; most spreads stir nothing.';

function buildCuriosityCardLines(cards) {
  return (cards || [])
    .map(c => `[${c.id || '?'}] ${c.position ? c.position + ': ' : ''}${c.name}${c.isReversed ? ' (reversed)' : ''}`)
    .join('\n');
}

function buildCuriosityPrompt(cards, threads) {
  const cardBlock   = buildCuriosityCardLines(cards);
  const threadBlock = (threads || []).map(t => `#${t.id} ${sanitizeUntrusted(t.content, 0)}`).join('\n');
  return `THE SPREAD JUST LAID (id in brackets):
${cardBlock}

OPEN THREADS MIRIEL REMEMBERS ABOUT THIS PERSON:
${threadBlock}

Decide whether any single card genuinely and strikingly pulls her toward one of these remembered threads, especially a surprising, less-obvious connection to another part of their life. Respond with ONLY a JSON object:

{"questions":[
  {"card_id":"<id of the card that stopped her>","question":"one sentence in Miriel's voice, as if she paused mid-reading on that card","thread_ids":[<id>]}
]}

Rules:
- 0 to 2 questions. Most readings: {"questions":[]}.
- Be conservative, only a real, striking resonance, never a forced one.
- Favor the less-obvious / off-topic pull; a natural on-topic one is also fine.
- The question is one sentence and names or clearly refers to that card.
- Speak the question directly TO the querent as "you", do not name them or describe them in the third person. (Other people in their life may still be named where the cards point to them.)
- card_id MUST be one of the spread ids above; thread_ids MUST come from the list above.
- Never invent facts.`;
}

const EXTRACT_MODEL = 'claude-haiku-4-5-20251001';

function summarizeReading(reading) {
  const cards = (reading.cards || [])
    .map(c => `${c.position ? c.position + ': ' : ''}${c.name}${c.isReversed ? ' (reversed)' : ''}`)
    .join(', ');
  const syn = reading.synopsis ? String(reading.synopsis).slice(0, 1200) : '';
  return `Date: ${reading.date || 'unknown'}\n` +
         `Spread: ${reading.spread || 'unknown'}\n` +
         `Question: ${reading.question ? fence('querent_question', reading.question, 500) : 'none'}\n` +
         `Cards: ${cards}\n` +
         `What Miriel said: ${syn}`;
}

const EXTRACT_SYSTEM =
  'You are the memory keeper for a tarot reader named Miriel. From a reading you extract durable, ' +
  'specific things worth remembering about the querent and their life, so Miriel can recall them in ' +
  'future readings. Be conservative: record only what is explicitly present in the question or in what ' +
  'Miriel observed. Never invent names, dates, or events. When unsure, leave it out.';

function buildCapturePrompt(reading, existing) {
  const existingBlock = existing.length
    ? existing.map(m => `#${m.id} [${m.type}/${m.status || '-'}] ${sanitizeUntrusted(m.content, 0)}`).join('\n')
    : '(none yet)';
  return `READING:
${summarizeReading(reading)}

WHAT MIRIEL ALREADY REMEMBERS ABOUT THIS PERSON:
${existingBlock}

Decide what, if anything, to remember from this reading. Respond with ONLY a JSON object of this exact shape and nothing else:

{"operations":[
  {"op":"ADD","type":"thread","content":"one specific sentence","status":"open","salience":4,"subject":"optional short tag"},
  {"op":"UPDATE","id":12,"status":"moving"},
  {"op":"TOUCH","id":7}
]}

Rules:
- ADD a NEW memory only for something not already listed above. type is one of: person, thread, event, feeling, prediction, fact, preference. status (open|moving|resolved|dormant) applies to threads and predictions; omit it otherwise. salience is 1-5 (5 = central to their life). content is one specific sentence.
- UPDATE an existing memory by its #id when this reading adds detail or changes its status.
- TOUCH an existing memory by its #id when it simply came up again with nothing new.
- A PREDICTION is special: when Miriel's own words contain a specific, checkable foretelling about the future (e.g. "expect friction in that move", "this connection won't last the season"), ADD it as type "prediction", status "open", salience 3 or higher, with content phrased as the claim itself so it reads back cleanly later. Vague encouragement ("good things are coming") is NOT a prediction, leave it out.
- If there is genuinely nothing worth remembering, return {"operations":[]}.
- Record only what is explicitly present. Do not invent.`;
}

const BACKFILL_CHUNK = 12;

const BACKFILL_SYSTEM =
  'You are the memory keeper for a tarot reader named Miriel. You are reviewing a batch of past ' +
  'readings to seed her memory of this querent. Extract durable, specific things worth remembering. ' +
  'Be conservative: only what is explicitly present. Never invent names, dates, or events.';

function buildBackfillPrompt(readings) {
  const block = readings.map((r, i) => `--- Reading ${i + 1} ---\n${summarizeReading(r)}`).join('\n\n');
  return `PAST READINGS:
${block}

Extract what is worth remembering about this person. Respond with ONLY a JSON object:

{"operations":[
  {"op":"ADD","type":"thread","content":"one specific sentence","status":"open","salience":3,"subject":"optional tag"}
]}

Rules:
- Only ADD operations. type is one of: person, thread, event, feeling, prediction, fact, preference. status (open|moving|resolved|dormant) for threads and predictions only. salience 1-5. content is one specific sentence.
- Merge duplicates across readings into a single memory.
- Record only what is explicitly present. Do not invent. If nothing, return {"operations":[]}.`;
}

module.exports = function createMemoryEngine(dataDir) {
  const store = createMemoryStore(dataDir);

  /**
   * @param {string} slug
   * @param {object} [opts]
   * @param {string} [opts.question]
   * @param {Array<{ name?: string }>} [opts.cards]
   */
  function recall(slug, { question, cards } = {}) {
    let candidates;
    try { candidates = store.getOpenAndSalient(slug, 200); } catch { candidates = []; }
    if (!candidates.length) return { memories: [], block: '' };
    const chosen = scoreCandidates(candidates, { question, cards })
      .filter(r => r.score > 0)
      .slice(0, RECALL_LIMIT)
      .map(r => r.memory);
    if (!chosen.length) return { memories: [], block: '' };
    store.markReferenced(chosen.map(m => m.id));
    return { memories: chosen, block: formatRecallBlock(chosen) };
  }

  async function captureFromReading(slug, reading, callLLM) {
    const existing = store.getOpenAndSalient(slug, 30);
    let raw;
    try {
      raw = await callLLM(EXTRACT_SYSTEM, buildCapturePrompt(reading, existing), 800, EXTRACT_MODEL);
    } catch (e) {
      return { added: 0, updated: 0, touched: 0, error: e.message };
    }
    const ops = parseExtractorOutput(raw);
    return store.applyOps(slug, ops, 'reading', reading && reading.id);
  }

  async function captureAnswer(slug, answer, threadIds, callLLM, sourceKind = 'threshold') {
    const threads = (threadIds || []).map(id => store.getMemory(id)).filter(Boolean);
    let raw;
    try {
      raw = await callLLM(THRESHOLD_CAPTURE_SYSTEM, buildThresholdCapturePrompt(threads, answer), 600, EXTRACT_MODEL);
    } catch (e) {
      return { added: 0, updated: 0, touched: 0, resolved: 0, error: e.message };
    }
    const ops = parseExtractorOutput(raw);
    return store.applyOps(slug, ops, sourceKind, null);
  }

  async function captureThresholdAnswer(slug, answer, threadIds, callLLM) {
    return captureAnswer(slug, answer, threadIds, callLLM, 'threshold');
  }

  async function detectCuriosity(slug, cards, callLLM, readerName) {
    const threads = store.getOpenUnaskedThreads(slug, 8, THRESHOLD_SALIENCE_BAR);
    if (!threads.length) return [];
    const system = CURIOSITY_SYSTEM + buildAddressingNote(readerName);
    let raw;
    try {
      raw = await callLLM(system, buildCuriosityPrompt(cards, threads), 500, EXTRACT_MODEL);
    } catch {
      return [];
    }
    const cardIds   = new Set((cards || []).map(c => c.id));
    const threadIds = new Set(threads.map(t => t.id));
    return parseCuriosityOutput(raw)
      .filter(q => q && q.question && cardIds.has(q.card_id) &&
                   Array.isArray(q.thread_ids) && q.thread_ids.some(id => threadIds.has(id)))
      .slice(0, 2)
      .map(q => ({
        cardId:    q.card_id,
        question:  String(q.question),
        threadIds: q.thread_ids.filter(id => threadIds.has(id)),
      }));
  }

  async function backfill(slug, loadReadings, callLLM) {
    const flag = `backfilled:${slug}`;
    if (store.getMeta(flag)) return { skipped: true };

    const readings = loadReadings(slug) || [];
    if (!readings.length) { store.setMeta(flag, '1'); return { added: 0 }; }

    let added = 0;
    for (let i = 0; i < readings.length; i += BACKFILL_CHUNK) {
      const chunk = readings.slice(i, i + BACKFILL_CHUNK);
      // If this throws, the flag is never set, so a later run retries from scratch.
      const raw = await callLLM(BACKFILL_SYSTEM, buildBackfillPrompt(chunk), 1200, EXTRACT_MODEL);
      const ops = parseExtractorOutput(raw).filter(o => o && String(o.op).toUpperCase() === 'ADD');
      added += store.applyOps(slug, ops, 'backfill', null).added;
    }
    store.setMeta(flag, '1');
    return { added };
  }

  return {
    recall, captureFromReading, backfill, captureThresholdAnswer, captureAnswer, detectCuriosity,
    getOpenUnaskedThreads: (slug, limit, minSal) => store.getOpenUnaskedThreads(slug, limit, minSal),
    getDormantThreads: (slug, limit, nowTs) => store.getDormantThreads(slug, limit, nowTs),
    markAsked: (ids) => store.markAsked(ids),
    getRipePredictions: (slug, limit, nowTs) => store.getRipePredictions(slug, limit, nowTs),
    getMeta: (k) => store.getMeta(k),
    setMeta: (k, v) => store.setMeta(k, v),
    listMemories: (slug) => store.listMemories(slug),
    getStats:     (slug) => store.getStats(slug),
    getResolvedPredictions: (slug, limit) => store.getResolvedPredictions(slug, limit),
    getOpenPredictions: (slug, limit) => store.getOpenPredictions(slug, limit),
    _store: store,
  };
};

module.exports.parseExtractorOutput = parseExtractorOutput;
module.exports.scoreCandidates = scoreCandidates;
module.exports.tokenize = tokenize;
module.exports.formatRecallBlock = formatRecallBlock;
module.exports.decideThresholdMode = decideThresholdMode;
module.exports.REUNION_GAP_DAYS = REUNION_GAP_DAYS;
module.exports.THRESHOLD_SALIENCE_BAR = THRESHOLD_SALIENCE_BAR;
module.exports.REUNION_MAX_THREADS = REUNION_MAX_THREADS;
module.exports.buildGreetingPrompt = buildGreetingPrompt;
module.exports.buildReplyPrompt = buildReplyPrompt;
module.exports.buildThresholdCapturePrompt = buildThresholdCapturePrompt;
module.exports.parseCuriosityOutput = parseCuriosityOutput;
module.exports.buildCuriosityPrompt = buildCuriosityPrompt;
module.exports.buildCapturePrompt = buildCapturePrompt;
