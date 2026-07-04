'use strict';
const fs = require('fs');
const express = require('express');

module.exports = function createReadersRoutes(ctx) {
  const router = express.Router();

  router.get('/api/readers', (req, res) => {
    res.json(ctx.store.loadReaders());
  });

  router.post('/api/readers', (req, res) => {
    const { name } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'Name required' });

    const readers = ctx.store.loadReaders();
    let slug = ctx.store.slugify(name);

    // Collision avoidance
    if (readers.find(r => r.slug === slug)) {
      let n = 2;
      while (readers.find(r => r.slug === `${slug}-${n}`)) n++;
      slug = `${slug}-${n}`;
    }

    const reader = { name: name.trim(), slug };
    readers.push(reader);
    ctx.store.saveReaders(readers);

    // Create empty readings file
    const p = ctx.store.readerReadingsPath(slug);
    if (!fs.existsSync(p)) {
      fs.writeFileSync(p, '[]');
    }

    console.log(`  ✓ Reader added: ${reader.name} (${reader.slug})`);
    res.json(reader);
  });

  router.delete('/api/readers/:slug', (req, res) => {
    const { slug } = req.params;
    const readers = ctx.store.loadReaders();
    if (readers.length <= 1) {
      return res.status(400).json({ error: 'Cannot remove the last reader' });
    }
    const idx = readers.findIndex(r => r.slug === slug);
    if (idx === -1) return res.status(404).json({ error: 'Reader not found' });
    readers.splice(idx, 1);
    ctx.store.saveReaders(readers);
    console.log(`  ✓ Reader removed: ${slug}`);
    res.json({ ok: true });
  });

  return router;
};
