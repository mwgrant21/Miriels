import { state } from './state.js';
import { shuffle, riffleOnce, cutDeck } from './utils.js';

export function getDeck() {
  if (state.currentDeck === 'mixed') {
    return [...state.allCards['veil-arcana'], ...state.allCards['drowned-ephemeris'], ...state.allCards.tarot, ...state.allCards.thoth, ...state.allCards['miriel-lunar'], ...state.allCards.lenormand, ...state.allCards.runic, ...state.allCards.iching, ...state.allCards.oracle];
  }
  return [...(state.allCards[state.currentDeck] || [])];
}

// Identify which deck key a single card object belongs to
export function cardDeckKey(card) {
  if (!card) return null;
  if (card.deckType === 'VeilArcana') return 'veil-arcana';
  if (card.deckType === 'DrownedEphemeris') return 'drowned-ephemeris';
  if (card.deckType === 'Lenormand') return 'lenormand';
  if (card.deckType === 'Thoth') return 'thoth';
  if (card.deckType === 'Runic') return 'runic';
  if (card.deckType === 'IChing') return 'iching';
  if (card.arcana || card.suit) return 'tarot';
  return 'oracle';
}

// Return a shuffled pool from the same deck(s) as the cards actually on the table
export function getClarifierPool() {
  if (!state.drawnCards.length) return getDeck();
  const key = cardDeckKey(state.drawnCards[0]);
  // If mixed reading, draw from whatever deck the first card came from
  const pool = state.allCards[key] || [];
  return shuffle([...pool]);
}

// Runes with symmetric shapes have no merkstave; Lenormand and I Ching skip reversals
const NON_REVERSIBLE_RUNES = new Set(['rune-07','rune-09','rune-11','rune-12','rune-16','rune-22','rune-23']);
export function noReversal(card) {
  if (!card) return false;
  if (card.deckType === 'Lenormand' || card.deckType === 'IChing') return true;
  if (card.deckType === 'Runic' && NON_REVERSIBLE_RUNES.has(card.id)) return true;
  return false;
}

// The living deck: restore this deck's persisted order, shuffle it the way
// hands would (seven riffles + a cut), persist the new order, hand it over.
export function getShuffledDeck() {
  const cards = getDeck();
  if (!cards.length) return cards;
  const storageKey = `tarot-deck-order:${state.currentDeck}`;

  // Reconcile saved order with the current card set — keep known cards in
  // their resting order, fold newcomers in, silently drop removed ones.
  const byId = new Map(cards.map(c => [c.id, c]));
  let deck = [];
  try {
    const savedIds = JSON.parse(localStorage.getItem(storageKey)) || [];
    deck = savedIds.map(id => byId.get(id)).filter(Boolean);
  } catch {}
  const inDeck = new Set(deck.map(c => c.id));
  const newcomers = cards.filter(c => !inDeck.has(c.id));
  if (newcomers.length) deck = deck.concat(shuffle(newcomers));

  for (let i = 0; i < 7; i++) deck = riffleOnce(deck);
  deck = cutDeck(deck);

  try { localStorage.setItem(storageKey, JSON.stringify(deck.map(c => c.id))); } catch {}
  return deck;
}

export function buildSelectOptions() {
  const frag = document.createDocumentFragment();
  const blank = document.createElement('option');
  blank.value = '';
  blank.textContent = '— Name your card —';
  frag.appendChild(blank);

  const groups = [
    { label: 'Veil Arcana',       cards: state.allCards['veil-arcana'] },
    { label: 'Drowned Ephemeris', cards: state.allCards['drowned-ephemeris'] },
    { label: 'Moon Oracle',       cards: state.allCards['miriel-lunar'] },
    { label: 'Rider-Waite Tarot', cards: state.allCards.tarot },
    { label: 'Thoth Tarot',       cards: state.allCards.thoth },
    { label: 'Lenormand Oracle',    cards: state.allCards.lenormand },
    { label: 'Elder Futhark Runes', cards: state.allCards.runic },
    { label: 'I Ching',             cards: state.allCards.iching },
    { label: 'My Oracle',           cards: state.allCards.oracle }
  ];

  groups.forEach(({ label, cards }) => {
    const g = document.createElement('optgroup');
    g.label = label;
    cards.forEach(c => {
      const o = document.createElement('option');
      o.value = c.id;
      o.textContent = c.name;
      g.appendChild(o);
    });
    frag.appendChild(g);
  });

  return frag;
}

export function findCardById(id) {
  return [
    ...state.allCards['veil-arcana'], ...state.allCards.tarot, ...state.allCards.thoth,
    ...state.allCards['miriel-lunar'], ...state.allCards.lenormand,
    ...state.allCards.runic, ...state.allCards.iching, ...state.allCards.oracle
  ].find(c => c.id === id);
}

export function findCardByName(name) {
  return [
    ...state.allCards['veil-arcana'], ...state.allCards.tarot, ...state.allCards.thoth,
    ...state.allCards['miriel-lunar'], ...state.allCards.lenormand,
    ...state.allCards.runic, ...state.allCards.iching, ...state.allCards.oracle
  ].find(c => c.name === name);
}

// Runes and I Ching pieces are physical objects (stones, coins), not cards —
// they have no back and always land face up. Only carded decks flip.
export function isAlwaysFaceUp(card) {
  return card.deckType === 'Runic' || card.deckType === 'IChing';
}

export function cardBackUrl(card) {
  if (card && card.deckType === 'MirielLunar') {
    return '/images/miriel-lunar/card-back.webp';
  }
  if (card && card.deckType === 'VeilArcana') {
    return '/images/veil-arcana/card-back.webp';
  }
  if (card && card.deckType === 'Runic') {
    return '/images/runic/card-back.svg';
  }
  if (card && card.deckType === 'IChing') {
    return '/images/iching/card-back.webp';
  }
  return '/images/tarot/card-back.webp';
}

export function cardImageUrl(card) {
  if (!card.id) return null;
  const deckKey = card.deckType === 'Runic'           ? 'runic' :
                  card.deckType === 'IChing'          ? 'iching' :
                  card.deckType === 'Thoth'           ? 'thoth' :
                  card.deckType === 'Lenormand'       ? null :
                  card.deckType === 'VeilArcana'         ? 'veil-arcana' :
                  card.deckType === 'DrownedEphemeris'  ? 'drowned-ephemeris' :
                  card.deckType === 'MirielLunar'        ? 'miriel-lunar' :
                  card.id.startsWith('oracle-')          ? 'oracle' :
                                                        'tarot';
  return (deckKey && state.imageManifest[deckKey] && state.imageManifest[deckKey][card.id]) || null;
}
