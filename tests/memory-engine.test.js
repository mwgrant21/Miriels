'use strict';
const { test } = require('node:test');
const assert   = require('node:assert/strict');
const os   = require('os');
const path = require('path');
const fs   = require('fs');
const createMemoryEngine = require('../data/memory-engine');
const { parseExtractorOutput } = require('../data/memory-engine');

function tmpDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'tarot-engine-')); }

test('parseExtractorOutput reads operations from a clean object', () => {
  const ops = parseExtractorOutput('{"operations":[{"op":"ADD","type":"fact","content":"x"}]}');
  assert.equal(ops.length, 1);
  assert.equal(ops[0].type, 'fact');
});

test('parseExtractorOutput tolerates prose around the JSON', () => {
  const ops = parseExtractorOutput('Sure!\n{"operations":[{"op":"TOUCH","id":3}]}\nDone.');
  assert.equal(ops[0].op, 'TOUCH');
});

test('parseExtractorOutput accepts a bare array', () => {
  const ops = parseExtractorOutput('[{"op":"ADD","type":"fact","content":"y"}]');
  assert.equal(ops.length, 1);
});

test('parseExtractorOutput returns [] on garbage or empty', () => {
  assert.deepEqual(parseExtractorOutput('no json here'), []);
  assert.deepEqual(parseExtractorOutput(''), []);
  assert.deepEqual(parseExtractorOutput('{"operations": not json}'), []);
});

const { scoreCandidates, formatRecallBlock } = require('../data/memory-engine');

function mem(o) {
  return Object.assign({
    id: 1, type: 'thread', content: '', status: 'open', salience: 3,
    subject: null, last_referenced_at: null, reference_count: 0,
  }, o);
}

test('scoreCandidates ranks open + keyword-matching + salient highest', () => {
  const cands = [
    mem({ id: 1, content: 'enjoys hiking on weekends', status: 'dormant', salience: 2 }),
    mem({ id: 2, content: 'anxious about the job interview at work', status: 'open', salience: 5, subject: 'work' }),
  ];
  const ranked = scoreCandidates(cands, {
    question: 'should I take the job?', cards: [{ name: 'The Tower' }], now: 1000000,
  });
  assert.equal(ranked[0].memory.id, 2);
});

test('scoreCandidates penalizes recently-referenced, over-exposed memories', () => {
  const now = 1000000;
  const fresh = mem({ id: 1, content: 'topic alpha beta', salience: 3, last_referenced_at: null, reference_count: 0 });
  const stale = mem({ id: 2, content: 'topic alpha beta', salience: 3, last_referenced_at: now - 60, reference_count: 9 });
  const ranked = scoreCandidates([stale, fresh], { question: 'topic alpha beta', cards: [], now });
  assert.equal(ranked[0].memory.id, 1);
});

test('formatRecallBlock returns empty string for no memories', () => {
  assert.equal(formatRecallBlock([]), '');
});

test('formatRecallBlock lists contents under the framing line', () => {
  const block = formatRecallBlock([{ content: 'afraid of being seen' }]);
  assert.ok(block.includes('afraid of being seen'));
});

test('recall returns empty block when the store is empty', () => {
  const engine = createMemoryEngine(tmpDir());
  const r = engine.recall('matt', { question: 'x', cards: [] });
  assert.equal(r.block, '');
  assert.deepEqual(r.memories, []);
});

test('recall surfaces a relevant memory and marks it referenced', () => {
  const engine = createMemoryEngine(tmpDir());
  engine._store.addMemory('matt', {
    type: 'thread', content: 'anxious about the job interview',
    status: 'open', salience: 5, subject: 'work',
  });
  const r = engine.recall('matt', { question: 'will the job work out?', cards: [{ name: 'The Tower' }] });
  assert.ok(r.block.includes('job interview'));
  assert.equal(r.memories.length, 1);
  assert.equal(engine._store.getMemory(r.memories[0].id).reference_count, 1);
});

test('captureFromReading applies extractor ops to the store', async () => {
  const engine = createMemoryEngine(tmpDir());
  const fakeLLM = async () =>
    '{"operations":[{"op":"ADD","type":"thread","content":"starting a new job soon","status":"open","salience":4,"subject":"work"}]}';
  const res = await engine.captureFromReading('matt',
    { id: 7, question: 'new job?', cards: [{ name: 'Ace of Pentacles' }], synopsis: 'beginnings' }, fakeLLM);
  assert.equal(res.added, 1);
  const all = engine.listMemories('matt');
  assert.equal(all.length, 1);
  assert.equal(all[0].source_kind, 'reading');
  assert.equal(all[0].source_id, '7');
});

test('captureFromReading persists nothing when output is unparseable', async () => {
  const engine = createMemoryEngine(tmpDir());
  const fakeLLM = async () => 'I could not find anything.';
  const res = await engine.captureFromReading('matt', { id: 8, cards: [] }, fakeLLM);
  assert.equal(res.added, 0);
  assert.equal(engine.listMemories('matt').length, 0);
});

test('captureFromReading swallows LLM errors without throwing', async () => {
  const engine = createMemoryEngine(tmpDir());
  const fakeLLM = async () => { throw new Error('network down'); };
  const res = await engine.captureFromReading('matt', { id: 9, cards: [] }, fakeLLM);
  assert.equal(res.added, 0);
  assert.ok(res.error);
});

test('backfill seeds memories from history then is idempotent', async () => {
  const engine = createMemoryEngine(tmpDir());
  const readings = [
    { id: 1, question: 'career?', cards: [{ name: 'Ace of Pentacles' }], synopsis: 'a new beginning at work' },
    { id: 2, question: 'love?',   cards: [{ name: 'The Lovers' }],       synopsis: 'a choice in the heart' },
  ];
  let calls = 0;
  const fakeLLM = async () => { calls++; return '{"operations":[{"op":"ADD","type":"thread","content":"seeded note","status":"open","salience":3}]}'; };

  const r1 = await engine.backfill('matt', () => readings, fakeLLM);
  assert.ok(r1.added >= 1);
  const after = calls;

  const r2 = await engine.backfill('matt', () => readings, fakeLLM);
  assert.equal(r2.skipped, true);
  assert.equal(calls, after); // no further LLM calls once flagged done
});

test('backfill with no readings marks done without calling the LLM', async () => {
  const engine = createMemoryEngine(tmpDir());
  let calls = 0;
  const fakeLLM = async () => { calls++; return '{"operations":[]}'; };
  await engine.backfill('matt', () => [], fakeLLM);
  assert.equal(calls, 0);
  const r2 = await engine.backfill('matt', () => [], fakeLLM);
  assert.equal(r2.skipped, true);
});

test('backfill does not set the done flag when a chunk fails', async () => {
  const engine = createMemoryEngine(tmpDir());
  const loadReadings = () => [{ id: 1, cards: [], synopsis: 'x' }];
  const failLLM = async () => { throw new Error('boom'); };
  await assert.rejects(() => engine.backfill('matt', loadReadings, failLLM));
  // flag stays unset, so a retry with a working LLM proceeds
  const okLLM = async () => '{"operations":[{"op":"ADD","type":"fact","content":"recovered"}]}';
  const r = await engine.backfill('matt', loadReadings, okLLM);
  assert.ok(r.added >= 1);
});

const { decideThresholdMode } = require('../data/memory-engine');

const DAY = 86400;
function thread(o) { return Object.assign({ id: 1, type: 'thread', content: 't', status: 'open', salience: 4 }, o); }

test('decideThresholdMode: none when no threads', () => {
  assert.equal(decideThresholdMode(1000000, [], 1000000), 'none');
});
test('decideThresholdMode: reunion when gap >= 2 days', () => {
  const now = 1000000;
  assert.equal(decideThresholdMode(now - 3 * DAY, [thread()], now), 'reunion');
});
test('decideThresholdMode: gentle when gap < 2 days', () => {
  const now = 1000000;
  assert.equal(decideThresholdMode(now - 1 * DAY, [thread()], now), 'gentle');
});
test('decideThresholdMode: null last-visit counts as reunion (first visit after backfill)', () => {
  assert.equal(decideThresholdMode(null, [thread()], 1000000), 'reunion');
});

const { buildGreetingPrompt, buildReplyPrompt, buildThresholdCapturePrompt } = require('../data/memory-engine');

test('buildGreetingPrompt includes the gap and the thread contents (reunion)', () => {
  const p = buildGreetingPrompt('reunion', [{ id: 1, content: 'the Portland job' }], 11);
  assert.ok(p.includes('the Portland job'));
  assert.ok(p.includes('11'));
  assert.ok(/reunion|returned|been a while|across the|away/i.test(p));
});
test('buildGreetingPrompt gentle is single-thread and mentions the thread', () => {
  const p = buildGreetingPrompt('gentle', [{ id: 1, content: 'the Portland job' }], 1);
  assert.ok(p.includes('the Portland job'));
});
test('buildReplyPrompt includes the answer and the threads', () => {
  const p = buildReplyPrompt([{ id: 1, content: 'the Portland job' }], 'I took it and moved');
  assert.ok(p.includes('I took it and moved'));
  assert.ok(p.includes('the Portland job'));
});
test('buildThresholdCapturePrompt lists threads by id and asks for ops including RESOLVE', () => {
  const p = buildThresholdCapturePrompt([{ id: 7, content: 'the Portland job', status: 'open' }], 'I took it');
  assert.ok(p.includes('#7'));
  assert.ok(p.includes('I took it'));
  assert.ok(p.includes('RESOLVE'));
});

test('captureThresholdAnswer applies RESOLVE ops attributed to the threads', async () => {
  const engine = createMemoryEngine(tmpDir());
  const id = engine._store.addMemory('matt', { type: 'thread', content: 'the Portland job', status: 'open', salience: 4 });
  const fakeLLM = async () => `{"operations":[{"op":"RESOLVE","id":${id},"outcome":"took the job"}]}`;
  const res = await engine.captureThresholdAnswer('matt', 'I took it', [id], fakeLLM);
  assert.equal(res.resolved, 1);
  assert.equal(engine._store.getMemory(id).status, 'resolved');
  const outcome = engine.listMemories('matt').find(m => m.type === 'event' && m.content === 'took the job');
  assert.ok(outcome && outcome.source_kind === 'threshold');
});

test('captureThresholdAnswer swallows LLM errors', async () => {
  const engine = createMemoryEngine(tmpDir());
  const id = engine._store.addMemory('matt', { type: 'thread', content: 't', status: 'open', salience: 4 });
  const res = await engine.captureThresholdAnswer('matt', 'x', [id], async () => { throw new Error('down'); });
  assert.ok(res.error);
});

test('engine exposes getOpenUnaskedThreads, markAsked, getMeta/setMeta pass-throughs', () => {
  const engine = createMemoryEngine(tmpDir());
  engine._store.addMemory('matt', { type: 'thread', content: 'open', status: 'open', salience: 4 });
  assert.equal(engine.getOpenUnaskedThreads('matt', 3, 3).length, 1);
  engine.setMeta('last_visit:matt', '123');
  assert.equal(engine.getMeta('last_visit:matt'), '123');
  const t = engine.getOpenUnaskedThreads('matt', 3, 3)[0];
  engine.markAsked([t.id]);
  assert.equal(engine.getOpenUnaskedThreads('matt', 3, 3).length, 0);
});

const { parseCuriosityOutput } = require('../data/memory-engine');

test('parseCuriosityOutput reads questions from a clean object', () => {
  const q = parseCuriosityOutput('{"questions":[{"card_id":"major-18","question":"Is your sister ok?","thread_ids":[7]}]}');
  assert.equal(q.length, 1);
  assert.equal(q[0].card_id, 'major-18');
});
test('parseCuriosityOutput tolerates prose around the JSON', () => {
  const q = parseCuriosityOutput('Sure:\n{"questions":[{"card_id":"x","question":"y","thread_ids":[1]}]}\ndone');
  assert.equal(q[0].question, 'y');
});
test('parseCuriosityOutput accepts a bare array', () => {
  const q = parseCuriosityOutput('[{"card_id":"x","question":"y","thread_ids":[1]}]');
  assert.equal(q.length, 1);
});
test('parseCuriosityOutput returns [] on garbage/empty', () => {
  assert.deepEqual(parseCuriosityOutput('nope'), []);
  assert.deepEqual(parseCuriosityOutput(''), []);
  assert.deepEqual(parseCuriosityOutput('{"questions": broken}'), []);
});

const { buildCuriosityPrompt } = require('../data/memory-engine');

test('buildCuriosityPrompt includes card ids/names and thread ids and asks for JSON questions', () => {
  const p = buildCuriosityPrompt(
    [{ id: 'major-18', name: 'The Moon', position: 'Present', isReversed: false }],
    [{ id: 7, content: 'tension with his sister' }]
  );
  assert.ok(p.includes('The Moon'));
  assert.ok(p.includes('major-18'));
  assert.ok(p.includes('#7'));
  assert.ok(p.includes('tension with his sister'));
  assert.ok(/questions/.test(p));
  assert.ok(/0 to 2|0-2|conservative/i.test(p));
});

test('buildCuriosityPrompt instructs second-person address (you, not name/third person)', () => {
  const p = buildCuriosityPrompt(
    [{ id: 'major-18', name: 'The Moon' }],
    [{ id: 7, content: 'tension with his sister' }]
  );
  assert.ok(/"you"/.test(p));
  assert.ok(/third person|do not name|never name|not name/i.test(p));
});

test('detectCuriosity folds the addressing note (reader name + "you") into the system prompt', async () => {
  const engine = createMemoryEngine(tmpDir());
  engine._store.addMemory('matt', { type: 'thread', content: 'tension with his sister', status: 'open', salience: 4 });
  let seenSystem = '';
  const fakeLLM = async (system) => { seenSystem = system; return '{"questions":[]}'; };
  await engine.detectCuriosity('matt', [{ id: 'major-18', name: 'The Moon' }], fakeLLM, 'Matt');
  assert.ok(seenSystem.includes('Matt'));
  assert.ok(/speak to them as "you/i.test(seenSystem));
});

test('detectCuriosity returns [] and makes NO llm call when there are no open threads', async () => {
  const engine = createMemoryEngine(tmpDir());
  let called = false;
  await engine.detectCuriosity('matt', [{ id: 'major-18', name: 'The Moon' }], async () => { called = true; return '{}'; });
  assert.equal(called, false);
});

test('detectCuriosity returns a normalized trigger for a valid resonance', async () => {
  const engine = createMemoryEngine(tmpDir());
  const tid = engine._store.addMemory('matt', { type: 'thread', content: 'tension with his sister', status: 'open', salience: 4 });
  const fakeLLM = async () => `{"questions":[{"card_id":"major-18","question":"Is your sister still upset?","thread_ids":[${tid}]}]}`;
  const out = await engine.detectCuriosity('matt', [{ id: 'major-18', name: 'The Moon' }], fakeLLM);
  assert.equal(out.length, 1);
  assert.equal(out[0].cardId, 'major-18');
  assert.equal(out[0].question, 'Is your sister still upset?');
  assert.deepEqual(out[0].threadIds, [tid]);
});

test('detectCuriosity drops triggers with unknown card or thread ids', async () => {
  const engine = createMemoryEngine(tmpDir());
  const tid = engine._store.addMemory('matt', { type: 'thread', content: 't', status: 'open', salience: 4 });
  const fakeLLM = async () =>
    `{"questions":[{"card_id":"NOT-IN-SPREAD","question":"q","thread_ids":[${tid}]},{"card_id":"major-0","question":"q2","thread_ids":[9999]}]}`;
  const out = await engine.detectCuriosity('matt', [{ id: 'major-0', name: 'The Fool' }], fakeLLM);
  assert.equal(out.length, 0);
});

test('detectCuriosity swallows LLM errors', async () => {
  const engine = createMemoryEngine(tmpDir());
  engine._store.addMemory('matt', { type: 'thread', content: 't', status: 'open', salience: 4 });
  const out = await engine.detectCuriosity('matt', [{ id: 'major-0', name: 'The Fool' }], async () => { throw new Error('down'); });
  assert.deepEqual(out, []);
});

test('captureAnswer records atoms under the given source_kind', async () => {
  const engine = createMemoryEngine(tmpDir());
  const id = engine._store.addMemory('matt', { type: 'thread', content: 'the move', status: 'open', salience: 4 });
  const fakeLLM = async () => `{"operations":[{"op":"RESOLVE","id":${id},"outcome":"the move happened"}]}`;
  const res = await engine.captureAnswer('matt', 'we moved', [id], fakeLLM, 'curiosity');
  assert.equal(res.resolved, 1);
  const outcome = engine.listMemories('matt').find(m => m.type === 'event' && m.content === 'the move happened');
  assert.ok(outcome && outcome.source_kind === 'curiosity');
});

test('captureThresholdAnswer still records under threshold', async () => {
  const engine = createMemoryEngine(tmpDir());
  const id = engine._store.addMemory('matt', { type: 'thread', content: 'x', status: 'open', salience: 4 });
  const fakeLLM = async () => `{"operations":[{"op":"ADD","type":"event","content":"a thing","salience":3}]}`;
  await engine.captureThresholdAnswer('matt', 'a thing happened', [id], fakeLLM);
  const ev = engine.listMemories('matt').find(m => m.content === 'a thing');
  assert.ok(ev && ev.source_kind === 'threshold');
});

test('buildThresholdCapturePrompt asks for verdicts on predictions', () => {
  const p = buildThresholdCapturePrompt(
    [{ id: 5, type: 'prediction', content: 'friction in the move', status: 'open' }],
    'it did happen'
  );
  assert.ok(p.includes('friction in the move'));
  assert.ok(/verdict/i.test(p));
  assert.ok(p.includes('came_to_pass'));
  assert.ok(p.includes('too_soon'));
});

const { buildCapturePrompt } = require('../data/memory-engine');

test('buildCapturePrompt instructs conservative prediction capture', () => {
  const p = buildCapturePrompt(
    { date: '2026-06-14', cards: [], question: 'work?', synopsis: 'expect friction in that move' },
    []
  );
  assert.ok(/prediction/i.test(p));
  assert.ok(/foretelling|checkable/i.test(p));
  assert.ok(/not a prediction/i.test(p));
});

test('decideThresholdMode triggers on ripe predictions even with no threads', () => {
  const now = 1000000;
  const pred = [{ id: 1, content: 'the move would bring friction' }];
  assert.equal(decideThresholdMode(now - 5 * 86400, [], now, undefined, pred), 'reunion');
  assert.equal(decideThresholdMode(now, [], now, undefined, []), 'none');
});

test('buildGreetingPrompt weaves in a ripe prediction', () => {
  const p = buildGreetingPrompt('reunion', [], 11, [{ id: 1, content: 'the move would bring friction' }]);
  assert.ok(p.includes('the move would bring friction'));
  assert.ok(/foretold|foretelling|cards spoke|come to pass/i.test(p));
});

test('engine.getRipePredictions passes through to the store', () => {
  const engine = createMemoryEngine(tmpDir());
  const now = engine._store._now();
  const id  = engine._store.addMemory('matt', { type: 'prediction', content: 'p', status: 'open', salience: 4 });
  engine._store._db.prepare('UPDATE memories SET created_at = ? WHERE id = ?').run(now - 30 * 86400, id);
  assert.equal(engine.getRipePredictions('matt', 5, now).length, 1);
});

test('recall ranking: a query-relevant memory outranks a more-salient unrelated one', () => {
  const now = Math.floor(Date.now() / 1000);
  const salientUnrelated = { id: 1, content: 'they love hiking in the mountains', subject: 'hobbies', status: 'open', salience: 5, last_referenced_at: null, reference_count: 0 };
  // salience 1 vs 5: under the OLD weights (salience 2.0 > overlap 1.5) the
  // unrelated salient memory wins; the new relevance-led weighting must flip it.
  const relevant         = { id: 2, content: 'they keep wrestling with whether to leave their job', subject: 'work', status: 'open', salience: 1, last_referenced_at: null, reference_count: 0 };
  const ranked = scoreCandidates([salientUnrelated, relevant], { question: 'should I leave my job?', cards: [{ name: 'The Tower' }], now });
  assert.equal(ranked[0].memory.id, 2, 'the job-relevant memory ranks first despite far lower salience');
});

test('recall ranking: with no query overlap, salience still orders results', () => {
  const now = Math.floor(Date.now() / 1000);
  const a = { id: 1, content: 'unrelated alpha', subject: '', status: 'open', salience: 5, last_referenced_at: null, reference_count: 0 };
  const b = { id: 2, content: 'unrelated beta',  subject: '', status: 'open', salience: 2, last_referenced_at: null, reference_count: 0 };
  const ranked = scoreCandidates([b, a], { question: 'nothing in common here', cards: [], now });
  assert.equal(ranked[0].memory.id, 1, 'higher salience wins when neither overlaps');
});

test('formatRecallBlock uses the concrete-use framing and includes contents', () => {
  const block = formatRecallBlock([{ content: 'they fear repeating their mother\'s path' }]);
  assert.match(block, /name it specifically|genuinely connects/i);
  assert.match(block, /mother's path/);
});

test('getOpenPredictions returns only open predictions, newest first, respecting limit', () => {
  const engine = createMemoryEngine(tmpDir());
  const now = engine._store._now();
  const setCreated = (id, ts) =>
    engine._store._db.prepare('UPDATE memories SET created_at = ? WHERE id = ?').run(ts, id);

  const older = engine._store.addMemory('matt', { type: 'prediction', content: 'old foretelling', status: 'open', salience: 4 });
  const newer = engine._store.addMemory('matt', { type: 'prediction', content: 'new foretelling', status: 'open', salience: 4 });
  setCreated(older, now - 50 * 86400);
  setCreated(newer, now - 2 * 86400);

  // excluded: a resolved prediction and a non-prediction thread
  const resolved = engine._store.addMemory('matt', { type: 'prediction', content: 'done', status: 'resolved', salience: 4 });
  engine._store.addMemory('matt', { type: 'thread', content: 'a thread', status: 'open', salience: 4 });

  const out = engine.getOpenPredictions('matt', 12);
  assert.equal(out.length, 2, 'only the two open predictions');
  assert.equal(out[0].id, newer, 'newest first');
  assert.equal(out[1].id, older);
  assert.ok(!out.some(p => p.id === resolved), 'resolved prediction excluded');

  const limited = engine.getOpenPredictions('matt', 1);
  assert.equal(limited.length, 1, 'limit respected');
  assert.equal(limited[0].id, newer);
});

test('buildGreetingPrompt weaves in the hour when timeOfDay is given', () => {
  const p = buildGreetingPrompt('reunion', [{ content: 'the move' }], 30, [], [], 'dusk');
  assert.match(p, /dusk/);
  assert.match(p, /let the hour gently color your greeting/i);
});

test('buildGreetingPrompt omits any time reference when timeOfDay is empty', () => {
  const p = buildGreetingPrompt('reunion', [{ content: 'the move' }], 30, [], []);
  assert.doesNotMatch(p, /let the hour gently color your greeting/i);
});
