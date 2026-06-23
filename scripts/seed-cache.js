#!/usr/bin/env node
'use strict';
/**
 * Usage:
 *   node scripts/seed-cache.js --deck tarot
 *   node scripts/seed-cache.js --all
 *   node scripts/seed-cache.js --deck thoth --delay 1500
 *   node scripts/seed-cache.js --deck runic --force
 */
const path = require('path');
const fs   = require('fs');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');

const createCache = require('../data/interpretation-cache');
const cache = createCache(DATA_DIR);

function getApiKey() {
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'config.json'), 'utf8'));
    if (cfg.apiKey) return cfg.apiKey;
  } catch {}
  return process.env.ANTHROPIC_API_KEY || null;
}

async function callClaude(apiKey, system, userPrompt, maxTokens) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content: userPrompt }]
    })
  });
  if (!res.ok) throw new Error(`Claude ${res.status}: ${await res.text()}`);
  return (await res.json()).content[0].text;
}

const SEED_PERSONA = `Your name is Miriel. You are an experienced tarot reader with an intuitive, direct style -- part psychologist, part poet. You don't perform mysticism or lean on spiritual jargon. You read what's actually in front of you. You speak directly to the person across from you. You never use bullet points, headers, bold text, or numbered lists.`;

const DECK_FILES = {
  tarot:           'tarot.json',
  thoth:           'thoth.json',
  lenormand:       'lenormand.json',
  'celtic-dragon': 'celtic-dragon.json',
  runic:           'runic.json',
  iching:          'iching.json',
  moonology:       'moonology.json',
  oracle:          'oracle.json',
};

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function formatForSeed(card, isReversed) {
  const orient   = isReversed ? 'reversed' : 'upright';
  const kw       = card.keywords ? (Array.isArray(card.keywords) ? card.keywords.join(', ') : card.keywords) : '';
  const meaning  = (isReversed ? card.reversed : card.upright) || card.meaning || '';
  const element  = card.element  ? `\n  Element: ${card.element}`    : '';
  const astro    = card.astro    ? `\n  Astrology: ${card.astro}`     : '';
  const shadow   = card.shadow   ? `\n  Shadow: ${card.shadow}`       : '';
  const waite    = card.waite    ? `\n  Waite: ${card.waite}`         : '';
  return `${card.name} (${orient})\n  Keywords: ${kw}\n  Meaning: ${meaning}${element}${astro}${shadow}${waite}`.trim();
}

async function seedDeck(deck, opts) {
  const apiKey = getApiKey();
  if (!apiKey) {
    console.error('No API key found. Add one via the app settings or set ANTHROPIC_API_KEY env var.');
    process.exit(1);
  }

  const cards = JSON.parse(fs.readFileSync(path.join(DATA_DIR, DECK_FILES[deck]), 'utf8'));
  const total  = cards.length * 2;
  let done = 0, seeded = 0, skipped = 0;

  console.log(`\nSeeding ${deck}: ${total} entries (${cards.length} cards x 2 orientations)\n`);

  for (const card of cards) {
    for (const isReversed of [false, true]) {
      done++;
      const cardObj = { id: card.id, position: 'single', isReversed };
      const key     = cache.buildCacheKey(deck, 'single', [cardObj]);
      const orient  = isReversed ? 'reversed' : 'upright';

      if (!opts.force) {
        const existing = cache.lookupCache(key, deck, [cardObj]);
        if (existing && !existing.startsWith('[Reading assembled')) {
          skipped++;
          process.stdout.write(`\r  ${done}/${total} -- skipped: ${skipped}    `);
          continue;
        }
      }

      process.stdout.write(`\r  ${done}/${total} -- ${card.name} (${orient})                      `);

      const cardBlock = formatForSeed(card, isReversed);
      const prompt    = `Card drawn:\n${cardBlock}\n\nSpeak directly to whoever is sitting across from you. Give a focused, authentic single-card reading -- start wherever your eye lands first, think out loud, let the card lead you somewhere. 2-3 paragraphs.`;

      try {
        const text = await callClaude(apiKey, SEED_PERSONA, prompt, 600);
        cache.saveToCache(key, deck, 'single', [cardObj], text, 'claude');
        seeded++;
      } catch (err) {
        console.error(`\n  x Failed ${card.name} (${orient}): ${err.message}`);
      }

      if (done < total) await sleep(opts.delay);
    }
  }
  console.log(`\n\n  Done. ${seeded} seeded, ${skipped} skipped.\n`);
}

// Parse args
const args = process.argv.slice(2);
const opts = { deck: null, all: false, delay: 2000, force: false };
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--deck')  opts.deck  = args[++i];
  if (args[i] === '--all')   opts.all   = true;
  if (args[i] === '--delay') opts.delay = parseInt(args[++i], 10);
  if (args[i] === '--force') opts.force = true;
}

if (!opts.deck && !opts.all) {
  console.log('Usage: node scripts/seed-cache.js --deck <name> | --all [--delay ms] [--force]');
  console.log('Available decks:', Object.keys(DECK_FILES).join(', '));
  process.exit(0);
}

const decksToSeed = opts.all ? Object.keys(DECK_FILES) : [opts.deck];
for (const d of decksToSeed) {
  if (!DECK_FILES[d]) { console.error(`Unknown deck: ${d}`); process.exit(1); }
  const deckFile = path.join(DATA_DIR, DECK_FILES[d]);
  if (!fs.existsSync(deckFile)) { console.error(`Deck file not found: ${deckFile}`); process.exit(1); }
}

(async () => {
  for (const d of decksToSeed) await seedDeck(d, opts);
  console.log('Seeding complete.');
})().catch(err => { console.error(err.message); process.exit(1); });
