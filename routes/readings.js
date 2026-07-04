'use strict';
const fs = require('fs');
const path = require('path');
const express = require('express');
const { fence, sanitizeUntrusted } = require('../data/prompt-safety');
const { buildAddressingNote } = require('../data/addressing');

module.exports = function createReadingsRoutes(ctx) {
  const router = express.Router();

  // ── Reading history ──────────────────────────────────────────────────────────

  router.get('/api/readings', (req, res) => {
    const readers = ctx.store.loadReaders();
    const slug = req.query.reader || (readers[0] && readers[0].slug) || 'matt';
    const readings = ctx.store.loadReadings(slug);
    // ?limit=0 → full history (journal); otherwise last N (default 5, resume panel)
    const limit = req.query.limit !== undefined ? parseInt(req.query.limit, 10) : 5;
    res.json(limit > 0 ? readings.slice(-limit) : readings);
  });

  router.post('/api/readings', (req, res) => {
    try {
      if (!req.body || !req.body.cards) {
        return res.status(400).json({ error: 'Invalid reading payload' });
      }
      const readers = ctx.store.loadReaders();
      const slug = req.body.reader || (readers[0] && readers[0].slug) || 'matt';
      const entry = { ...req.body, id: Date.now() };
      ctx.store.appendReading(entry, slug);
      console.log(`  ✓ Reading saved for ${slug} (${req.body.date || 'no date'}, ${(req.body.cards || []).length} cards)`);
      const totalReadings  = ctx.store.loadReadings(slug).length;
      const currentProfile = ctx.profiles.loadReaderProfile(slug);
      const lastSynth      = currentProfile ? (currentProfile.readings_synthesized || 0) : 0;
      const cadence        = totalReadings >= 30 ? 10 : 5;
      if (totalReadings - lastSynth >= cadence) {
        ctx.profiles.refreshReaderProfile(slug, ctx.llm.callLLM, ctx.store.loadReadings)
          .catch(err => console.warn('  ⚠  Profile refresh failed:', err.message));
      }
      ctx.memory.captureFromReading(slug, entry, ctx.llm.callLLM)
        .catch(err => console.warn('  ⚠  Memory capture failed:', err.message));
      ctx.profiles.updateLivingNote(slug, ctx.llm.callLLM, ctx.store.loadReadings)
        .catch(err => console.warn('  ⚠  Living note update failed:', err.message));
      if (totalReadings % ctx.seasons.SEASON_CADENCE === 0) {
        ctx.seasons.updateSeasons(slug, ctx.llm.callLLM)
          .then(res => { if (res && res.added) console.log(`  + Emotional season recorded for ${slug}`); })
          .catch(err => console.warn('  ⚠  Season update failed:', err.message));
      }
      res.json({ ok: true });
    } catch (err) {
      console.error('  ✗ Failed to save reading:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // ── Pattern weaving, Miriel reflects across the journal ────────────────────

  const PATTERNS_DIR = path.join(ctx.DATA_DIR, 'patterns');

  router.post('/api/patterns', async (req, res) => {
    const readers = ctx.store.loadReaders();
    const slug = (req.body && req.body.reader) || (readers[0] && readers[0].slug) || 'matt';
    const readings = ctx.store.loadReadings(slug);

    if (readings.length < 5) {
      return res.json({ text: null, tooFew: true, readingCount: readings.length });
    }

    // Cached until a new reading is saved
    const cachePath = path.join(PATTERNS_DIR, `${slug}.json`);
    try {
      if (fs.existsSync(cachePath)) {
        const cached = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
        if (cached.readingCount === readings.length && cached.text) return res.json(cached);
      }
    } catch {}

    // Card frequencies across the full history
    const freq = {};
    for (const rd of readings) for (const c of (rd.cards || [])) {
      freq[c.name] = (freq[c.name] || 0) + 1;
    }
    const recurring = Object.entries(freq)
      .filter(([, n]) => n >= 2)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12)
      .map(([name, count]) => ({ name, count }));

    // Recent readings digest for the prompt
    const digest = readings.slice(-15).map(rd => {
      const cards = (rd.cards || []).map(c => c.name + (c.isReversed ? ' (reversed)' : '')).join(', ');
      return `${rd.date},${rd.deckLabel || rd.deck}, ${rd.spread}${rd.question ? `, question: ${fence('querent_question', rd.question, 300)}` : ''}\n  Cards: ${cards}`;
    }).join('\n');

    const recurringLine = recurring.map(r => `${r.name} ×${r.count}`).join(', ');

    const prompt = `You are looking back through your journal of readings for this person,${readings.length} readings in all.

Cards that keep returning across the whole journal: ${recurringLine || 'none repeat yet'}.

Their last fifteen readings:
${digest}

Reflect on what you see moving across these pages, the cards that keep finding them, the questions that circle back, the threads that have shifted or stayed stuck. Two to four short paragraphs, speaking directly to them. Don't summarize reading by reading; weave. If something has visibly moved or resolved since the earlier entries, name it. If something keeps surfacing that they haven't faced, name that too, kindly.`;

    try {
      const text = (await ctx.llm.callLLM(ctx.READER_PERSONA, prompt, 800, 'claude-sonnet-4-6')).trim();
      const payload = { text, recurring, readingCount: readings.length, generatedAt: Date.now() };
      fs.mkdirSync(PATTERNS_DIR, { recursive: true });
      fs.writeFileSync(cachePath, JSON.stringify(payload, null, 2));
      console.log(`  ✓ Pattern weaving generated for ${slug} (${readings.length} readings)`);
      res.json(payload);
    } catch (err) {
      console.error('  ✗ Pattern weaving failed:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // ── Session summary ──────────────────────────────────────────────────────────

  router.post('/api/session-summary', async (req, res) => {
    const { readings, readerName } = req.body;
    if (!readings || !readings.length) {
      return res.status(400).json({ error: 'No readings provided.' });
    }

    const name = sanitizeUntrusted(readerName, 80) || 'you';
    const n = readings.length;

    const readingBlock = readings.map((r, i) => {
      const cardList = (r.cards || []).map(c =>
        `${c.position ? c.position + ': ' : ''}${c.name}${c.isReversed ? ' (reversed)' : ''}`
      ).join(', ');
      const synopsis = r.synopsis ? fence('prior_reading', r.synopsis, 400) : '';
      const q = r.question ? fence('querent_question', r.question, 1500) : 'no specific question';
      return `Reading ${i + 1}${r.date ? `,${r.date}` : ''}: ${r.spread || 'spread'}, ${q}\nCards: ${cardList}${synopsis ? `\nWhat came up: ${synopsis}` : ''}`;
    }).join('\n\n');

    const prompt = `You've been sitting with ${name} through ${n} reading${n === 1 ? '' : 's'}.

Here is what has come up:

${readingBlock}

Now step all the way back. Don't revisit individual card positions or meanings. Look at the whole of it, what has this person been circling? What keeps appearing, directly or in disguise? What is the real question underneath the questions they asked?

Speak to them directly, as if the reading is over and you've been quiet for a moment and now have one true thing to say. Give them something to sit with, not an answer, but a lens. Something they can carry into their day or week and turn over quietly. 2–4 paragraphs. No lists, no headers, no card names as the focus, just the truth of what you see.`;

    try {
      const text = await ctx.llm.callLLM(`${ctx.READER_PERSONA}${buildAddressingNote(readerName)}`, prompt, 1200);
      res.json({ summary: text });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
};
