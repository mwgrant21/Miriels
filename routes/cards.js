'use strict';
const fs = require('fs');
const path = require('path');
const express = require('express');

module.exports = function createCardsRoutes(ctx) {
  const router = express.Router();

  router.get('/api/images', (req, res) => {
    const exts = ['.jpg', '.jpeg', '.png', '.webp', '.svg'];
    const manifest = {};
    const imgRoot = process.env.IMAGES_DIR || path.join(ctx.PUBLIC_DIR, 'images');

    // Maps manifest key → subfolder on disk (oracle images live in the moonology folder)
    const deckDirs = {
      'tarot':         'tarot',
      'veil-arcana':   'veil-arcana',
      'miriel-lunar':  'miriel-lunar',
      'oracle':        'moonology',
      'runic':         'runic',
      'iching':           'iching',
      'thoth':            'thoth',
      'drowned-ephemeris':'drowned-ephemeris'
    };

    for (const [deck, folder] of Object.entries(deckDirs)) {
      manifest[deck] = {};
      const dir = path.join(imgRoot, folder);
      try {
        const files = fs.readdirSync(dir);
        for (const file of files) {
          const ext = path.extname(file).toLowerCase();
          if (exts.includes(ext)) {
            const id = path.basename(file, ext);
            manifest[deck][id] = `/images/${folder}/${encodeURIComponent(file)}`;
          }
        }
      } catch {}
    }
    res.json(manifest);
  });

  router.get('/api/cards', (req, res) => {
    const tarot        = JSON.parse(fs.readFileSync(path.join(ctx.DATA_DIR, 'tarot.json'), 'utf8'));
    const oracle       = JSON.parse(fs.readFileSync(path.join(ctx.DATA_DIR, 'oracle.json'), 'utf8'));
    const mirielLunar  = JSON.parse(fs.readFileSync(path.join(ctx.DATA_DIR, 'miriel-lunar.json'), 'utf8'));
    const veilArcana        = JSON.parse(fs.readFileSync(path.join(ctx.DATA_DIR, 'veil-arcana.json'), 'utf8'));
    const drownedEphemeris  = JSON.parse(fs.readFileSync(path.join(ctx.DATA_DIR, 'drowned-ephemeris.json'), 'utf8'));
    const lenormand         = JSON.parse(fs.readFileSync(path.join(ctx.DATA_DIR, 'lenormand.json'), 'utf8'));
    const thoth             = JSON.parse(fs.readFileSync(path.join(ctx.DATA_DIR, 'thoth.json'), 'utf8'));
    const runic             = JSON.parse(fs.readFileSync(path.join(ctx.DATA_DIR, 'runic.json'), 'utf8'));
    const iching            = JSON.parse(fs.readFileSync(path.join(ctx.DATA_DIR, 'iching.json'), 'utf8'));
    res.json({ tarot, oracle, 'miriel-lunar': mirielLunar, 'veil-arcana': veilArcana, 'drowned-ephemeris': drownedEphemeris, lenormand, thoth, runic, iching });
  });

  return router;
};
