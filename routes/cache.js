'use strict';
const fs = require('fs');
const path = require('path');
const express = require('express');

module.exports = function createCacheRoutes(ctx) {
  const router = express.Router();

  router.get('/api/cache/stats', (req, res) => {
    const deckNames = ['tarot', 'thoth', 'lenormand', 'veil-arcana', 'drowned-ephemeris', 'runic', 'iching', 'oracle'];
    const deckCardCounts = {};
    for (const deck of deckNames) {
      try {
        const file = path.join(ctx.DATA_DIR, `${deck}.json`);
        const data = JSON.parse(fs.readFileSync(file, 'utf8'));
        deckCardCounts[deck] = Array.isArray(data) ? data.length * 2 : 0;
      } catch { deckCardCounts[deck] = 0; }
    }
    res.json(ctx.cache.getCacheStats(deckCardCounts));
  });

  return router;
};
