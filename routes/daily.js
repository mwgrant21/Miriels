'use strict';
const fs = require('fs');
const path = require('path');
const express = require('express');

// Lenormand and I Ching skip reversals; symmetric runes have no merkstave
const NON_REVERSIBLE_RUNE_IDS = new Set(['rune-07','rune-09','rune-11','rune-12','rune-16','rune-22','rune-23']);
function dailyNoReversal(card) {
  if (card.deckType === 'Lenormand' || card.deckType === 'IChing') return true;
  return NON_REVERSIBLE_RUNE_IDS.has(card.id);
}

function localDateKey(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

module.exports = function createDailyRoutes(ctx) {
  const router = express.Router();
  const DAILY_DIR = path.join(ctx.DATA_DIR, 'daily');

  function loadDaily(slug) {
    try {
      const p = path.join(DAILY_DIR, `${slug}.json`);
      if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'));
    } catch {}
    return { current: null, streak: 0, history: [] };
  }

  function saveDaily(slug, doc) {
    fs.mkdirSync(DAILY_DIR, { recursive: true });
    fs.writeFileSync(path.join(DAILY_DIR, `${slug}.json`), JSON.stringify(doc, null, 2));
  }

  function loadAllDeckCards() {
    const deckFiles = ['tarot', 'thoth', 'veil-arcana', 'miriel-lunar', 'drowned-ephemeris', 'lenormand', 'runic', 'iching', 'oracle'];
    const decks = {};
    for (const d of deckFiles) {
      try { decks[d] = JSON.parse(fs.readFileSync(path.join(ctx.DATA_DIR, `${d}.json`), 'utf8')); }
      catch { decks[d] = []; }
    }
    return decks;
  }

  router.get('/api/daily-card', async (req, res) => {
    const readers = ctx.store.loadReaders();
    const slug = req.query.reader || (readers[0] && readers[0].slug) || 'matt';
    const today = localDateKey();
    const doc = loadDaily(slug);

    // Same card all day, return the persisted draw
    if (doc.current && doc.current.dateKey === today) {
      return res.json({ ...doc.current, streak: doc.streak, history: doc.history.slice(-7) });
    }

    // New day, draw a fresh card from across all decks
    const decks = loadAllDeckCards();
    const requestedDeck = req.query.deck && decks[req.query.deck] ? req.query.deck : null;
    const pool = requestedDeck
      ? decks[requestedDeck].map(c => ({ ...c, _deck: requestedDeck }))
      : Object.entries(decks).flatMap(([k, cards]) => cards.map(c => ({ ...c, _deck: k })));
    if (!pool.length) return res.status(500).json({ error: 'No cards available' });

    const pick = pool[Math.floor(Math.random() * pool.length)];
    const isReversed = dailyNoReversal(pick) ? false : Math.random() < 0.3;

    // Streak: consecutive days of visiting the daily card
    const yesterday = localDateKey(new Date(Date.now() - 86400000));
    const lastKey = doc.current ? doc.current.dateKey : null;
    const streak = lastKey === yesterday ? (doc.streak || 0) + 1 : 1;

    // Miriel's short morning reflection (cached for the day; null if LLM unreachable)
    let reflection = null;
    try {
      const meaning = isReversed ? (pick.reversed || pick.upright || '') : (pick.upright || pick.meaning || '');
      const prompt = `Today's card of the day is ${pick.name}${isReversed ? ', reversed' : ''} (${pick.deckType || 'Tarot'} deck). Traditional meaning, for your eyes only: "${String(meaning).slice(0, 400)}"

Offer a short reflection for the day ahead, two or three sentences, the kind of thing you'd say while sliding the morning's single card across the table. No question was asked; this is a daily touchstone. Don't recite the meaning, speak to the day. Words only, no stage directions or asterisked actions.`;
      reflection = (await ctx.llm.callLLM(ctx.READER_PERSONA, prompt, 220, 'claude-haiku-4-5-20251001')).trim();
    } catch (err) {
      console.warn('  ⚠  Daily reflection failed:', err.message);
    }

    const current = {
      dateKey: today,
      card: {
        id: pick.id, name: pick.name, deckType: pick.deckType || null,
        deck: pick._deck, isReversed
      },
      reflection
    };
    doc.current = current;
    doc.streak = streak;
    doc.history = [...(doc.history || []), { dateKey: today, id: pick.id, name: pick.name, deck: pick._deck, isReversed }].slice(-60);
    saveDaily(slug, doc);
    console.log(`  ✓ Card of the day for ${slug}: ${pick.name}${isReversed ? ' (reversed)' : ''} [${pick._deck}]`);

    res.json({ ...current, streak, history: doc.history.slice(-7) });
  });

  return router;
};
