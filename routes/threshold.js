'use strict';
const express = require('express');
const createMemoryEngine = require('../data/memory-engine');
const {
  decideThresholdMode, buildGreetingPrompt, buildReplyPrompt,
  REUNION_MAX_THREADS, THRESHOLD_SALIENCE_BAR, REUNION_GAP_DAYS,
} = createMemoryEngine;
const { detectSeasonShift } = require('../data/emotional-seasons');
const { findTemporalCallbacks, filterSurfaced } = require('../data/temporal-recall');
const { buildAddressingNote } = require('../data/addressing');

module.exports = function createThresholdRoutes(ctx) {
  const router = express.Router();

  // ── The Threshold, Miriel greets you across the gap ─────────────────────────

  router.get('/api/threshold', async (req, res) => {
    try {
      const readers = ctx.store.loadReaders();
      const slug = req.query.reader || (readers[0] && readers[0].slug) || 'matt';
      const reader = readers.find(r => r.slug === slug) || readers[0] || { name: 'you', slug };
      const ALLOWED_PHASES = ['dawn', 'day', 'dusk', 'night'];
      const phase = ALLOWED_PHASES.includes(req.query.phase) ? req.query.phase : '';
      const now = Math.floor(Date.now() / 1000);

      const threads     = ctx.memory.getOpenUnaskedThreads(slug, REUNION_MAX_THREADS, THRESHOLD_SALIENCE_BAR);
      const predictions = ctx.memory.getRipePredictions(slug, REUNION_MAX_THREADS, now);
      const dormant = ctx.memory.getDormantThreads(slug, 2, now);
      const dormantIds = new Set(dormant.map(t => t.id));
      const freshThreads = threads.filter(t => !dormantIds.has(t.id));
      const lastVisit = ctx.memory.getMeta(`last_visit:${slug}`);

      // Temporal callbacks (rare, resonant). Detector + readings use MILLISECONDS;
      // the engine stores now/last_visit in SECONDS, convert at the boundary.
      const nowMs = now * 1000;
      const lastVisitMs = lastVisit == null ? null : Number(lastVisit) * 1000;
      let surfacedMap = {};
      try { surfacedMap = JSON.parse(ctx.memory.getMeta(`temporal_surfaced:${slug}`) || '{}'); } catch {}
      const allCallbacks = findTemporalCallbacks({ readings: ctx.store.loadReadings(slug), lastVisitTs: lastVisitMs, now: nowMs });
      const temporalCallbacks = filterSurfaced(allCallbacks, surfacedMap, nowMs, 30).slice(0, 1);

      let seasonSurfaced = {};
      try { seasonSurfaced = JSON.parse(ctx.memory.getMeta(`season_surfaced:${slug}`) || '{}'); } catch {}
      const rawShift = detectSeasonShift(JSON.parse(ctx.memory.getMeta(`seasons:${slug}`) || '[]'), now);
      const SEASON_TTL_S = 30 * 86400;
      const seasonShift = (rawShift && !(seasonSurfaced[rawShift.signature] && (now - seasonSurfaced[rawShift.signature]) < SEASON_TTL_S))
        ? rawShift : null;

      const mode      = decideThresholdMode(lastVisit, freshThreads, now, REUNION_GAP_DAYS, predictions, temporalCallbacks, dormant, seasonShift);

      if (mode === 'none') {
        ctx.memory.setMeta(`last_visit:${slug}`, String(now));
        return res.json({ mode: 'none' });
      }

      const shownThreads  = mode === 'gentle' ? freshThreads.slice(0, 1) : freshThreads;
      const shownDormant  = mode === 'gentle'
        ? (shownThreads.length ? [] : dormant.slice(0, 1))
        : dormant;
      const shownPredictions = mode === 'gentle'
        ? ((shownThreads.length || shownDormant.length) ? [] : predictions.slice(0, 1))
        : predictions;
      const shown = [...shownThreads, ...shownDormant, ...shownPredictions];
      const gapDays = lastVisit == null ? Infinity : (now - Number(lastVisit)) / 86400;

      const readerProfile = ctx.profiles.loadReaderProfile(slug);
      const readingCount = ctx.store.loadReadings(slug).length;
      const persona = ctx.profiles.buildPersonaWithProfile(
        `${ctx.READER_PERSONA}${buildAddressingNote(reader.name)}`,
        readerProfile, readingCount, []
      );
      let greeting;
      try {
        greeting = await ctx.llm.callLLM(persona, buildGreetingPrompt(mode, shownThreads, gapDays, shownPredictions, temporalCallbacks, phase, shownDormant, seasonShift), 700, 'claude-sonnet-4-6');
      } catch (err) {
        // Do NOT advance last_visit on a generation failure, a transient LLM blip
        // (e.g. Claude hiccup with no Ollama fallback) must retry the full reunion on
        // the next open, not silently downgrade it to a gentle ask or skip it.
        console.warn('  ⚠  Threshold greeting failed (will retry next open):', err.message);
        return res.json({ mode: 'none' }); // no wooden template reunion
      }

      ctx.memory.markAsked(shown.map(t => t.id));
      if (temporalCallbacks.length) {
        // Prune entries past the dedup window so the map stays bounded (elapsed
        // signatures are unique per gap and would otherwise accumulate forever).
        const ttlMs = 30 * 86400000;
        for (const sig of Object.keys(surfacedMap)) {
          if (nowMs - surfacedMap[sig] >= ttlMs) delete surfacedMap[sig];
        }
        for (const c of temporalCallbacks) surfacedMap[c.signature] = nowMs;
        ctx.memory.setMeta(`temporal_surfaced:${slug}`, JSON.stringify(surfacedMap));
      }
      if (seasonShift) {
        const ttlS = 30 * 86400;
        for (const sig of Object.keys(seasonSurfaced)) {
          if (now - seasonSurfaced[sig] >= ttlS) delete seasonSurfaced[sig];
        }
        seasonSurfaced[seasonShift.signature] = now;
        ctx.memory.setMeta(`season_surfaced:${slug}`, JSON.stringify(seasonSurfaced));
      }
      ctx.memory.setMeta(`last_visit:${slug}`, String(now));
      res.json({ mode, greeting, threadIds: shown.map(t => t.id) });
    } catch (err) {
      console.warn('  ⚠  Threshold failed:', err.message);
      res.json({ mode: 'none' });
    }
  });

  router.post('/api/threshold/answer', async (req, res) => {
    try {
      const readers = ctx.store.loadReaders();
      const slug = req.body.reader || (readers[0] && readers[0].slug) || 'matt';
      const reader = readers.find(r => r.slug === slug) || readers[0] || { name: 'you', slug };
      const { answer, threadIds } = req.body;

      const threads = (threadIds || []).map(id => ctx.memory._store.getMemory(id)).filter(Boolean);

      let reply = 'Thank you for telling me. Let us see what the cards have for you now.';
      try {
        const persona = ctx.profiles.buildPersonaWithProfile(
          `${ctx.READER_PERSONA}${buildAddressingNote(reader.name)}`,
          ctx.profiles.loadReaderProfile(slug), ctx.store.loadReadings(slug).length, []
        );
        reply = await ctx.llm.callLLM(persona, buildReplyPrompt(threads, answer), 400, 'claude-sonnet-4-6');
      } catch (err) {
        console.warn('  ⚠  Threshold reply failed (using fallback):', err.message);
      }

      ctx.memory.captureThresholdAnswer(slug, answer, threadIds || [], ctx.llm.callLLM)
        .catch(err => console.warn('  ⚠  Threshold capture failed:', err.message));

      res.json({ reply });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── In-reading curiosity, a card stops her ──────────────────────────────────

  router.post('/api/reading-questions', async (req, res) => {
    try {
      const readers = ctx.store.loadReaders();
      const slug = req.body.reader || (readers[0] && readers[0].slug) || 'matt';
      const reader = readers.find(r => r.slug === slug) || readers[0] || { name: '' };
      const cards = Array.isArray(req.body.cards) ? req.body.cards : [];
      const questions = await ctx.memory.detectCuriosity(slug, cards, ctx.llm.callLLM, reader.name);
      ctx.memory.markAsked(questions.flatMap(q => q.threadIds));
      res.json({ questions });
    } catch (err) {
      console.warn('  ⚠  reading-questions failed:', err.message);
      res.json({ questions: [] });
    }
  });

  return router;
};
