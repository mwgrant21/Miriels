// ── content-library.js ───────────────────────────────────────────────────────
// Journal/archive/notebook/grimoire surfaces: the Reading Journal, the
// Grimoire card encyclopedia, and the Card of the Day widget. See
// .superpowers/sdd/appjs-map.md §6 (module 13) and task-7-brief.md.
import { state } from './state.js';
import { notebookEl } from './utils.js';
import { cardImageUrl } from './deck.js';

// ── Reading Journal ──────────────────────────────────────────────────────────

let journalReadings = [];   // full history, newest first

// Resolve a saved journal card to a live card object so we can show its image.
// Newer readings store the card id directly; older ones only have the name,
// so fall back to a name match scoped to the reading's deck.
function resolveJournalCard(saved, deckKey) {
  if (saved.id) {
    const pools = deckKey === 'mixed' ? Object.values(state.allCards) : [state.allCards[deckKey] || []];
    for (const pool of pools) {
      const hit = pool.find(c => c.id === saved.id);
      if (hit) return hit;
    }
  }
  const name = (saved.name || '').toLowerCase();
  const searchPools = deckKey && deckKey !== 'mixed' && state.allCards[deckKey]
    ? [state.allCards[deckKey], ...Object.values(state.allCards)]
    : Object.values(state.allCards);
  for (const pool of searchPools) {
    const hit = pool.find(c => c.name.toLowerCase() === name);
    if (hit) return hit;
  }
  return null;
}

async function openJournal() {
  const overlay = document.getElementById('journal-overlay');
  const inner   = document.getElementById('journal-inner');
  if (!overlay || !inner) return;
  inner.innerHTML = '';

  inner.appendChild(notebookEl('div', 'notebook-ornament', '✦ · ✦ · ✦'));
  inner.appendChild(notebookEl('div', 'notebook-title', 'THE JOURNAL'));
  inner.appendChild(notebookEl('div', 'notebook-meta', 'every reading, kept'));

  try {
    const r = await fetch(`/api/readings?reader=${encodeURIComponent(state.currentReader.slug)}&limit=0`);
    journalReadings = r.ok ? (await r.json()).slice().reverse() : [];
  } catch {
    journalReadings = [];
  }

  if (!journalReadings.length) {
    inner.appendChild(notebookEl('div', 'notebook-teaser',
      'Nothing here yet. When you save a reading, it will wait for you in these pages.'));
  } else {
    // Search box
    const searchWrap = notebookEl('div', 'journal-search-wrap');
    const search = document.createElement('input');
    search.type = 'text';
    search.id = 'journal-search';
    search.className = 'journal-search';
    search.placeholder = 'Search by card, question, or deck…';
    search.autocomplete = 'off';
    searchWrap.appendChild(search);
    const count = notebookEl('div', 'journal-count');
    searchWrap.appendChild(count);
    inner.appendChild(searchWrap);

    // Pattern weaving — Miriel reads across the pages
    if (journalReadings.length >= 5) inner.appendChild(buildPatternsSection());

    const list = notebookEl('div', 'journal-list');
    list.id = 'journal-list';
    inner.appendChild(list);

    const render = () => renderJournalEntries(list, count, search.value.trim().toLowerCase());
    search.addEventListener('input', render);
    render();
  }

  inner.appendChild(notebookEl('div', 'notebook-hint', 'esc · return to the table'));

  overlay.classList.remove('hidden');
  requestAnimationFrame(() => overlay.classList.add('visible'));
  document.body.style.overflow = 'hidden';
  document.addEventListener('keydown', journalEscHandler);
}

function renderJournalEntries(list, countEl, query) {
  list.innerHTML = '';

  const matches = !query ? journalReadings : journalReadings.filter(rd => {
    const hay = [
      rd.question, rd.synopsis, rd.deckLabel, rd.deck, rd.spread, rd.date,
      ...(rd.cards || []).map(c => c.name)
    ].join(' ').toLowerCase();
    return hay.includes(query);
  });

  countEl.textContent = query
    ? `${matches.length} of ${journalReadings.length} readings`
    : `${journalReadings.length} reading${journalReadings.length === 1 ? '' : 's'}`;

  if (!matches.length) {
    list.appendChild(notebookEl('div', 'journal-empty', 'No readings match. The cards remember differently.'));
    return;
  }

  for (const rd of matches) {
    const entry = notebookEl('div', 'journal-entry');

    // Header: date + deck/spread meta
    const head = notebookEl('div', 'journal-entry-head');
    head.appendChild(notebookEl('span', 'journal-entry-date', rd.date || ''));
    const metaBits = [rd.deckLabel || rd.deck, rd.spread].filter(Boolean).join(' · ');
    head.appendChild(notebookEl('span', 'journal-entry-meta', metaBits));
    entry.appendChild(head);

    // Question
    if (rd.question) {
      entry.appendChild(notebookEl('div', 'journal-entry-question', `“${rd.question}”`));
    }

    // Card chips
    const cardsRow = notebookEl('div', 'journal-entry-cards');
    for (const c of (rd.cards || [])) {
      const chip = notebookEl('div', 'journal-card-chip');
      const live = resolveJournalCard(c, rd.deck);
      const url  = live ? cardImageUrl(live) : null;
      if (url) {
        const img = document.createElement('img');
        img.className = 'journal-card-img' + (c.isReversed ? ' reversed' : '');
        img.src = url;
        img.alt = c.name;
        img.loading = 'lazy';
        chip.appendChild(img);
      } else {
        chip.appendChild(notebookEl('div', 'journal-card-placeholder', '✦'));
      }
      const label = notebookEl('div', 'journal-card-label', c.name + (c.isReversed ? ' ⟲' : ''));
      chip.appendChild(label);
      if (c.position) chip.appendChild(notebookEl('div', 'journal-card-pos', c.position));
      cardsRow.appendChild(chip);
    }
    entry.appendChild(cardsRow);

    // Synopsis — collapsed preview, expandable
    if (rd.synopsis) {
      const syn = notebookEl('div', 'journal-entry-synopsis collapsed');
      rd.synopsis.split(/\n\s*\n/).forEach(par => {
        if (par.trim()) syn.appendChild(notebookEl('p', null, par.trim()));
      });
      entry.appendChild(syn);
      const toggle = notebookEl('button', 'journal-expand-btn', 'Read the full telling ↓');
      toggle.addEventListener('click', () => {
        const open = !syn.classList.contains('collapsed');
        syn.classList.toggle('collapsed', open);
        toggle.textContent = open ? 'Read the full telling ↓' : 'Fold it away ↑';
      });
      entry.appendChild(toggle);
    }

    list.appendChild(entry);
  }
}

function buildPatternsSection() {
  const section = notebookEl('div', 'journal-patterns');
  const btn = notebookEl('button', 'patterns-btn', '✦ Ask Miriel what she sees across these pages');
  section.appendChild(btn);

  btn.addEventListener('click', async () => {
    btn.disabled = true;
    btn.textContent = 'She is turning the pages…';
    let data = null;
    try {
      const r = await fetch('/api/patterns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reader: state.currentReader.slug })
      });
      if (r.ok) data = await r.json();
    } catch {}

    if (!data || !data.text) {
      btn.disabled = false;
      btn.textContent = '✦ Ask Miriel what she sees across these pages';
      const note = notebookEl('div', 'patterns-error', 'She couldn’t reach her notebook just now — try again in a moment.');
      section.appendChild(note);
      setTimeout(() => note.remove(), 4000);
      return;
    }

    btn.remove();
    if (Array.isArray(data.recurring) && data.recurring.length) {
      const chips = notebookEl('div', 'patterns-recurring');
      data.recurring.slice(0, 8).forEach(rc => {
        chips.appendChild(notebookEl('span', 'patterns-chip', `${rc.name} ×${rc.count}`));
      });
      section.appendChild(chips);
    }
    const textBox = notebookEl('div', 'patterns-text');
    data.text.split(/\n\s*\n/).forEach(par => {
      if (par.trim()) textBox.appendChild(notebookEl('p', null, par.trim()));
    });
    section.appendChild(textBox);
  });

  return section;
}

function journalEscHandler(e) {
  if (e.key === 'Escape') closeJournal();
}

function closeJournal() {
  const overlay = document.getElementById('journal-overlay');
  overlay.classList.remove('visible');
  document.body.style.overflow = '';
  document.removeEventListener('keydown', journalEscHandler);
  setTimeout(() => overlay.classList.add('hidden'), 600);
}

// ── Grimoire — card encyclopedia / study mode ────────────────────────────────

const GRIMOIRE_DECKS = [
  ['veil-arcana',        'Veil Arcana'],
  ['drowned-ephemeris',  'Drowned Ephemeris'],
  ['miriel-lunar',       'Moon Oracle'],
  ['tarot',              'Rider-Waite'],
  ['thoth',              'Thoth'],
  ['lenormand',     'Lenormand'],
  ['runic',         'Runes'],
  ['iching',        'I Ching'],
  ['oracle',        'My Oracle'],
];

const GRIMOIRE_DECK_INTROS = {
  'veil-arcana': {
    eyebrow: 'Provenance',
    title: 'Veil Arcana',
    paragraphs: [
      'Long before I built anything, I read from what other people gave me. A deck pressed into my hands by a teacher who thought I was ready before I did. A deck won in a wager I still do not fully remember agreeing to. A deck bought for almost nothing from someone who only wanted it gone. Not everything that has come to me over the years arrived kindly, but that is a different story than this one.',
      "What all of them gave me, kindly gotten or not, was the same seventy eight shapes wearing different clothes. A fool standing at a different cliff depending on which land drew him. A tower struck by lightning that meant something slightly different in every tradition that kept it. A devil who always seemed to know something about me personally, no matter whose hand had carved his face. I started keeping notes on where the traditions agreed and where they quietly disagreed with each other, and it was the disagreements that taught me the most.",
      "I did not decide to test any of this. I simply started reading the disagreements instead of the cards, quietly, without telling anyone I was doing something different. When the standard meaning of a card did not feel true for the person in front of me, I tried my own reconciled version instead and watched whether it landed. It almost always landed better. I did this for years before I noticed I had stopped consulting the decks I owned at all, and had built, without meaning to, seventy eight readings of my own that I trusted more than any single tradition's original.",
      "I call it Veil Arcana because that is what every tradition had actually handed me: a veil, the same figure dressed in whatever cloth its culture had on hand. Lift the Roman veil and there is a Greek figure underneath it. Lift that one and there is something older still. The myths were never different stories. They were the same handful of truths, veiled differently so each age could recognize itself in them. Reading well, I decided, is knowing which veil to lift for the person sitting across from you, and which to leave alone.",
      'It behaves nothing like the Ephemeris. That deck is unfriendly on purpose, correcting me even when I would rather it stayed quiet. Veil Arcana is worn soft at the corners now, handled so often the varnish has dulled in the same places on every court card, wherever people\'s thumbs find it without meaning to. It does not measure anything. It simply agrees to be read, over and over, and has never once refused to tell me something because I was not ready to hear it.',
      'This is the deck I would hand you first, if you only ever read with one of mine. Not because it is gentler, though it is, but because it took me the longest to trust, and I do not offer that lightly. Read it the way I built it, one veil at a time, and let it show you the same truth in whatever clothing you need it to wear today.',
    ],
  },
  'drowned-ephemeris': {
    eyebrow: 'Provenance',
    title: 'The Drowned Ephemeris',
    paragraphs: [
      'I did not find this deck in one place, at one time, from one hand. I found it in pieces, across years and lands I no longer have names for, and it took me a long while to understand that what I kept finding was a single thing.',
      "Some pieces I was drawn to the way you're pulled toward a smell before you know why, or a compass needle finds a wreck it was never told about. No summons, no vision, just a pull that did not let go until I had gone somewhere I would not otherwise have gone. Other pieces would not come to me until I had given something up first, and never anything that could be counted or spent. Time, mostly. Once, someone. I do not tell people what any of it was, not because it is shameful the way debts are usually shameful, but because saying it aloud would make it smaller than it was, and I will not do that to what it cost me. I will say only that I do not go by the name I was born with anymore, and that this is not unrelated to any single piece of it so much as to the whole of what it took, across all that time, to bring it together.",
      'I do not know who made any of it, and I have stopped expecting to. Whoever handed me each piece either did not know its maker or would not say, and nothing about the pieces agrees on an origin. Driftwood does not come from where hammered iron comes from, and glass fused by lightning comes from neither. Five materials, no mark, no lineage, no one hand I can point to. I have read enough decks to know when something is hiding its maker on purpose. This one is.',
      'What I got, piece by piece, was not power, not exactly. It was a way of listening to the parts of a person, a season, a question, that live below where light usually reaches. The absence underneath a question someone thinks they\'ve already answered. The pull beneath a choice they believe they\'ve already made. I have used it since on people who needed to hear what was actually working on them, not what they asked me about.',
      'It does not behave like my other decks. It does not comfort. It measures. I have learned to trust what it finds even when I would rather it had found something kinder.',
      'I am telling you this much and no more. Some of what this deck knows, I only know because I was willing to lose something to learn it, more than once. I would not ask that of you. I am only asking that you trust what it shows you, the way I have had to.',
    ],
  },
};

let grimoireDeck = 'tarot';

function openGrimoire() {
  const overlay = document.getElementById('grimoire-overlay');
  const inner   = document.getElementById('grimoire-inner');
  if (!overlay || !inner) return;
  inner.innerHTML = '';

  inner.appendChild(notebookEl('div', 'notebook-ornament', '✦ · ✦ · ✦'));
  inner.appendChild(notebookEl('div', 'notebook-title', 'THE GRIMOIRE'));
  inner.appendChild(notebookEl('div', 'notebook-meta', 'every card, waiting to be known'));

  // Search across all decks
  const searchWrap = notebookEl('div', 'journal-search-wrap');
  const search = document.createElement('input');
  search.type = 'text';
  search.className = 'journal-search';
  search.placeholder = 'Search every deck — name or keyword, e.g. “patience”…';
  search.autocomplete = 'off';
  searchWrap.appendChild(search);
  inner.appendChild(searchWrap);

  // Deck tabs
  const tabs = notebookEl('div', 'grimoire-tabs');
  for (const [key, label] of GRIMOIRE_DECKS) {
    const tab = notebookEl('button', 'grimoire-tab' + (key === grimoireDeck ? ' active' : ''), label);
    tab.dataset.deck = key;
    tab.addEventListener('click', () => {
      grimoireDeck = key;
      search.value = '';
      tabs.querySelectorAll('.grimoire-tab').forEach(t =>
        t.classList.toggle('active', t.dataset.deck === key));
      renderGrimoireGrid(grid, detail, null);
    });
    tabs.appendChild(tab);
  }
  inner.appendChild(tabs);

  // Detail panel (filled when a card is chosen) + grid
  const detail = notebookEl('div', 'grimoire-detail hidden');
  inner.appendChild(detail);
  const grid = notebookEl('div', 'grimoire-grid');
  inner.appendChild(grid);

  search.addEventListener('input', () => {
    const q = search.value.trim().toLowerCase();
    tabs.classList.toggle('searching', !!q);
    renderGrimoireGrid(grid, detail, q || null);
  });

  renderGrimoireGrid(grid, detail, null);

  inner.appendChild(notebookEl('div', 'notebook-hint', 'esc · return to the table'));

  overlay.classList.remove('hidden');
  requestAnimationFrame(() => overlay.classList.add('visible'));
  document.body.style.overflow = 'hidden';
  document.addEventListener('keydown', grimoireEscHandler);
}

function renderGrimoireGrid(grid, detail, query) {
  grid.innerHTML = '';
  detail.classList.add('hidden');

  // With a query: search every deck. Without: show the active deck.
  let cards;
  if (query) {
    cards = [];
    for (const [key] of GRIMOIRE_DECKS) {
      for (const c of (state.allCards[key] || [])) {
        const hay = [c.name, ...(c.keywords || []), c.chineseName || ''].join(' ').toLowerCase();
        if (hay.includes(query)) cards.push(c);
      }
    }
  } else {
    cards = state.allCards[grimoireDeck] || [];
  }

  if (!cards.length) {
    grid.appendChild(notebookEl('div', 'journal-empty', query
      ? 'No card answers to that. Try another word.'
      : 'This deck is still being unpacked.'));
    return;
  }

  // Deck provenance / intro block (shown only when browsing a specific deck, not searching)
  if (!query && GRIMOIRE_DECK_INTROS[grimoireDeck]) {
    const intro = GRIMOIRE_DECK_INTROS[grimoireDeck];
    const block = notebookEl('div', 'grimoire-deck-intro');
    block.appendChild(notebookEl('div', 'grimoire-detail-eyebrow', intro.eyebrow));
    block.appendChild(notebookEl('div', 'grimoire-intro-title', intro.title));
    intro.paragraphs.forEach(p => block.appendChild(notebookEl('p', 'grimoire-detail-para', p)));
    grid.appendChild(block);
  }

  for (const card of cards) {
    const cell = notebookEl('div', 'grimoire-cell');
    const url = cardImageUrl(card);
    if (url) {
      const img = document.createElement('img');
      img.className = 'grimoire-cell-img';
      img.src = url;
      img.alt = card.name;
      img.loading = 'lazy';
      cell.appendChild(img);
    } else {
      const ph = notebookEl('div', 'grimoire-cell-placeholder', card.symbol || '✦');
      cell.appendChild(ph);
    }
    cell.appendChild(notebookEl('div', 'grimoire-cell-name', card.name));
    cell.addEventListener('click', () => {
      renderGrimoireDetail(detail, card);
      detail.classList.remove('hidden');
      detail.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
    grid.appendChild(cell);
  }
}

function renderGrimoireDetail(detail, card) {
  detail.innerHTML = '';

  const close = notebookEl('button', 'grimoire-detail-close', '✕');
  close.addEventListener('click', () => detail.classList.add('hidden'));
  detail.appendChild(close);

  const body = notebookEl('div', 'grimoire-detail-body');

  // Image column
  const imgCol = notebookEl('div', 'grimoire-detail-imgcol');
  const url = cardImageUrl(card);
  if (url) {
    const img = document.createElement('img');
    img.className = 'grimoire-detail-img';
    img.src = url;
    img.alt = card.name;
    imgCol.appendChild(img);
  } else {
    imgCol.appendChild(notebookEl('div', 'grimoire-cell-placeholder large', card.symbol || '✦'));
  }
  body.appendChild(imgCol);

  // Text column
  const textCol = notebookEl('div', 'grimoire-detail-text');
  textCol.appendChild(notebookEl('div', 'grimoire-detail-name', card.name));

  const subBits = [];
  if (card.chineseName) subBits.push(card.chineseName);
  if (card.arcana)      subBits.push(card.arcana + (card.suit ? ` · ${card.suit}` : ''));
  else if (card.suit)   subBits.push(card.suit);
  if (card.aett)        subBits.push(`${card.aett} aett`);
  if (card.trigrams)    subBits.push(`${card.trigrams.upper} over ${card.trigrams.lower}`);
  if (card.lunar_phase) subBits.push(card.lunar_phase);
  if (card.element)     subBits.push(card.element);
  if (card.astro)       subBits.push(card.astro);
  if (subBits.length) textCol.appendChild(notebookEl('div', 'grimoire-detail-sub', subBits.join(' · ')));

  if (card.keywords && card.keywords.length) {
    const chips = notebookEl('div', 'patterns-recurring grimoire-keywords');
    card.keywords.forEach(k => chips.appendChild(notebookEl('span', 'patterns-chip', k)));
    textCol.appendChild(chips);
  }

  const sections = [
    ['Upright',  card.upright],
    ['Reversed', card.reversed],
    ['Shadow',   card.shadow],
    ['Lore',     card.lore || card.waite || card.thoth_lore || card.celtic_lore],
    ['Combinations', card.combinations],
  ];
  for (const [label, text] of sections) {
    if (!text) continue;
    textCol.appendChild(notebookEl('div', 'grimoire-detail-eyebrow', label));
    textCol.appendChild(notebookEl('p', 'grimoire-detail-para', text));
  }
  body.appendChild(textCol);
  detail.appendChild(body);
}

function grimoireEscHandler(e) {
  if (e.key === 'Escape') closeGrimoire();
}

function closeGrimoire() {
  const overlay = document.getElementById('grimoire-overlay');
  overlay.classList.remove('visible');
  document.body.style.overflow = '';
  document.removeEventListener('keydown', grimoireEscHandler);
  setTimeout(() => overlay.classList.add('hidden'), 600);
}

// ── Card of the Day ──────────────────────────────────────────────────────────

function buildDailyCardBar() {
  const area = document.getElementById('daily-card-area');
  if (!area) return;
  area.innerHTML = '';

  const bar = notebookEl('button', 'daily-card-bar', '');
  bar.id = 'daily-card-bar';
  bar.appendChild(notebookEl('span', 'daily-bar-glyph', '☀'));
  bar.appendChild(notebookEl('span', 'daily-bar-text', 'Card of the Day'));
  bar.appendChild(notebookEl('span', 'daily-bar-hint', 'tap to reveal'));
  bar.addEventListener('click', revealDailyCard);
  area.appendChild(bar);
  area.classList.remove('hidden');
}

async function revealDailyCard() {
  const area = document.getElementById('daily-card-area');
  const bar  = document.getElementById('daily-card-bar');
  if (!area || !bar || bar.disabled) return;
  bar.disabled = true;
  bar.querySelector('.daily-bar-hint').textContent = 'turning the card…';

  let data = null;
  try {
    const r = await fetch(`/api/daily-card?reader=${encodeURIComponent(state.currentReader.slug)}`);
    if (r.ok) data = await r.json();
  } catch {}

  if (!data || !data.card) {
    bar.disabled = false;
    bar.querySelector('.daily-bar-hint').textContent = 'the cards are quiet — try again';
    return;
  }

  area.innerHTML = '';
  const panel = notebookEl('div', 'daily-card-panel');

  // Header line: date + streak
  const head = notebookEl('div', 'daily-panel-head');
  head.appendChild(notebookEl('span', 'daily-panel-title', '☀ Card of the Day'));
  if (data.streak > 1) {
    head.appendChild(notebookEl('span', 'daily-panel-streak', `${data.streak} days running`));
  }
  panel.appendChild(head);

  const body = notebookEl('div', 'daily-panel-body');

  // Card image (resolve via live card object for the manifest lookup)
  const live = resolveJournalCard(data.card, data.card.deck);
  const url  = live ? cardImageUrl(live) : null;
  const cardCell = notebookEl('div', 'daily-panel-card');
  if (url) {
    const img = document.createElement('img');
    img.className = 'daily-card-img' + (data.card.isReversed ? ' reversed' : '');
    img.src = url;
    img.alt = data.card.name;
    cardCell.appendChild(img);
  } else {
    cardCell.appendChild(notebookEl('div', 'daily-card-placeholder', '✦'));
  }
  cardCell.appendChild(notebookEl('div', 'daily-card-name',
    data.card.name + (data.card.isReversed ? ' ⟲' : '')));
  body.appendChild(cardCell);

  // Reflection text — Miriel's words, or the card's own meaning as fallback
  const textCol = notebookEl('div', 'daily-panel-text');
  let reflection = data.reflection;
  if (!reflection && live) {
    reflection = data.card.isReversed ? (live.reversed || live.upright) : (live.upright || live.meaning);
  }
  if (reflection) {
    String(reflection).split(/\n\s*\n/).forEach(par => {
      if (par.trim()) textCol.appendChild(notebookEl('p', null, par.trim()));
    });
  }

  // The week so far — small trail of recent daily cards
  if (Array.isArray(data.history) && data.history.length > 1) {
    const trail = notebookEl('div', 'daily-panel-trail');
    trail.appendChild(notebookEl('span', 'daily-trail-label', 'this week · '));
    trail.appendChild(notebookEl('span', null,
      data.history.slice(0, -1).map(h => h.name).join(' · ')));
    textCol.appendChild(trail);
  }
  body.appendChild(textCol);
  panel.appendChild(body);

  // Fold away
  const fold = notebookEl('button', 'journal-expand-btn', 'Fold it away ↑');
  fold.addEventListener('click', buildDailyCardBar);
  panel.appendChild(fold);

  area.appendChild(panel);
}

export { openJournal, closeJournal, openGrimoire, closeGrimoire, buildDailyCardBar, revealDailyCard };
