'use strict';
const path = require('path');
const express = require('express');
const { buildNotebookPayload } = require('../data/notebook');

module.exports = function createProfilesRoutes(ctx) {
  const router = express.Router();

  // ── Foretellings, Miriel's record of predictions that came due ───────────────

  router.get('/api/foretellings/:slug', (req, res) => {
    try {
      const slug = req.params.slug;
      const foretellings = ctx.memory.getResolvedPredictions(slug, 20);
      res.json({ foretellings });
    } catch (err) {
      console.warn('  ⚠  foretellings failed:', err.message);
      res.json({ foretellings: [] });
    }
  });

  router.get('/api/profiles/:slug', (req, res) => {
    const { slug } = req.params;
    const readers = ctx.store.loadReaders();
    if (!readers.find(r => r.slug === slug)) {
      return res.status(404).json({ error: 'Reader not found' });
    }
    res.json(buildNotebookPayload({
      profile:      ctx.profiles.loadReaderProfile(slug),
      readingCount: ctx.store.loadReadings(slug).length,
      getTier:      ctx.profiles.getTier,
      dataDir:      ctx.DATA_DIR,
      imagesDir:    path.join(ctx.PUBLIC_DIR, 'images')
    }));
  });

  router.post('/api/profiles/:slug/refresh', async (req, res) => {
    const { slug } = req.params;
    const readers = ctx.store.loadReaders();
    if (!readers.find(r => r.slug === slug)) {
      return res.status(404).json({ error: 'Reader not found' });
    }
    try {
      await ctx.profiles.refreshReaderProfile(slug, ctx.llm.callLLM, ctx.store.loadReadings);
      const profile = ctx.profiles.loadReaderProfile(slug);
      res.json({ ok: true, readings_synthesized: profile ? profile.readings_synthesized : 0 });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
};
