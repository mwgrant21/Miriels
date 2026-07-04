'use strict';
const fs = require('fs');
const express = require('express');

module.exports = function createConfigRoutes(ctx) {
  const router = express.Router();

  router.get('/api/config-status', async (req, res) => {
    const hasKey = !!ctx.llm.getApiKey();
    let hasLocalModel = false;
    try {
      const r = await fetch(`${ctx.llm.OLLAMA_BASE}/api/tags`, { signal: AbortSignal.timeout(1500) });
      if (r.ok) {
        const d = await r.json();
        hasLocalModel = (d.models || []).some(m => m.name.startsWith(ctx.llm.LOCAL_MODEL.split(':')[0]));
      }
    } catch {}
    res.json({ hasKey, hasLocalModel });
  });

  router.post('/api/config', (req, res) => {
    const { apiKey } = req.body;
    if (!apiKey || !apiKey.startsWith('sk-ant-')) {
      return res.status(400).json({ error: 'Invalid API key format. Should start with sk-ant-' });
    }
    try {
      fs.writeFileSync(ctx.llm.configPath, JSON.stringify({ apiKey }, null, 2));
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
};
