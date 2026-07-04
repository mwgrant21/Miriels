// @ts-check
'use strict';
const path = require('path');
const fs   = require('fs');

const IMG_EXTS = ['.jpg', '.jpeg', '.png', '.webp', '.svg'];

// Profile card_ids are LLM-invented during synthesis (e.g. "major_09") and do
// not reliably match real deck ids ("major-9"), so images resolve by card name
// against tarot.json. Unresolvable cards get imageUrl null and the frontend
// renders a styled placeholder.
function resolveCardImage(cardName, dataDir, imagesDir) {
  let cards;
  try {
    cards = JSON.parse(fs.readFileSync(path.join(dataDir, 'tarot.json'), 'utf8'));
  } catch {
    return null;
  }
  if (!Array.isArray(cards)) return null;
  const wanted = String(cardName || '').trim().toLowerCase();
  const match  = cards.find(c => String(c.name).toLowerCase() === wanted);
  if (!match) return null;
  for (const ext of IMG_EXTS) {
    const file = `${match.id}${ext}`;
    if (fs.existsSync(path.join(imagesDir, 'tarot', file))) {
      return `/images/tarot/${encodeURIComponent(file)}`;
    }
  }
  return null;
}

function buildNotebookPayload({ profile, readingCount, getTier, dataDir, imagesDir }) {
  const tier = getTier(readingCount);
  let out = profile;
  if (profile && Array.isArray(profile.recurring_cards)) {
    out = {
      ...profile,
      recurring_cards: profile.recurring_cards.map(rc => ({
        ...rc,
        imageUrl: resolveCardImage(rc.card, dataDir, imagesDir)
      }))
    };
  }
  return { profile: out || null, readingCount, tier };
}

module.exports = { buildNotebookPayload, resolveCardImage };
