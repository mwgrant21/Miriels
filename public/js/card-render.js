import { state } from './state.js';
import { DEAL_INTERVAL, SHUFFLE_MS, DEAL_FLIP_DELAY, SPREAD_LAYOUTS } from './spreads-data.js';
import { isAlwaysFaceUp, cardBackUrl } from './deck.js';

export let lastRenderDealt = false; // snapshot of state.dealAnimActive captured in renderSpread; read by autoReveal

export function renderSpread() {
  const area = document.getElementById('spread-area');
  area.innerHTML = '';

  lastRenderDealt = state.dealAnimActive;
  state.dealAnimActive  = false; // consume immediately — only this render uses it

  if (lastRenderDealt) {
    const isRunic = state.drawnCards[0] && state.drawnCards[0].deckType === 'Runic';

    if (isRunic) {
      // Runes come from a pouch: it rummages while the stones are mixed,
      // then gives a little toss as each rune tumbles out.
      const pouch = document.createElement('div');
      pouch.className = 'rune-pouch rummaging';
      pouch.innerHTML = '<div class="rune-pouch-neck"></div><div class="rune-pouch-body">ᚠ</div>';
      const note = document.createElement('div');
      note.className = 'spread-shuffle-note';
      note.textContent = 'mixing the stones…';
      pouch.appendChild(note);
      area.appendChild(pouch);

      setTimeout(() => {
        pouch.classList.remove('rummaging');
        note.textContent = 'drawing…';
      }, SHUFFLE_MS - 150);

      state.drawnCards.forEach((_, i) => {
        setTimeout(() => {
          pouch.classList.remove('tossing');
          void pouch.offsetWidth; // restart the toss animation
          pouch.classList.add('tossing');
        }, SHUFFLE_MS + i * DEAL_INTERVAL);
      });
      setTimeout(() => {
        pouch.style.opacity = '0';
        setTimeout(() => pouch.remove(), 350);
      }, SHUFFLE_MS + state.drawnCards.length * DEAL_INTERVAL + 200);

    } else {
      const pile = document.createElement('div');
      pile.className = 'spread-pile shuffling';
      for (let j = state.drawnCards.length - 1; j >= 0; j--) {
        const pc = document.createElement('div');
        pc.className = 'spread-pile-card';
        pc.textContent = '☽';
        pc.style.transform = `translateY(${j * -1.8}px)`;
        pile.appendChild(pc);
      }
      const shuffleNote = document.createElement('div');
      shuffleNote.className = 'spread-shuffle-note';
      shuffleNote.textContent = 'shuffling…';
      pile.appendChild(shuffleNote);
      area.appendChild(pile);

      // Riffle visibly, then settle and deal
      setTimeout(() => {
        pile.classList.remove('shuffling');
        shuffleNote.remove();
      }, SHUFFLE_MS - 150);

      state.drawnCards.forEach((_, i) => {
        setTimeout(() => {
          const card = pile.querySelector('.spread-pile-card:last-of-type');
          if (card) card.remove();
          if (!pile.querySelector('.spread-pile-card')) {
            pile.style.opacity = '0';
            setTimeout(() => pile.remove(), 350);
          }
        }, SHUFFLE_MS + i * DEAL_INTERVAL + 150);
      });
    }
  }

  const layout = SPREAD_LAYOUTS[state.currentSpread];

  if (layout) {
    area.className = `spread-area ${layout.gridClass}`;
    state.drawnCards.forEach((card, i) => {
      const slot = document.createElement('div');
      slot.className = `card-slot ${layout.cardClasses[i] || ''}`.trim();
      if (layout.labelClass && card.positionLabel) {
        const lbl = document.createElement('div');
        lbl.className = `position-label ${layout.labelClass}`;
        lbl.textContent = card.positionLabel;
        slot.appendChild(lbl);
      }
      slot.appendChild(makeCardEl(card, i));
      area.appendChild(slot);
    });
  } else {
    area.className = 'spread-area';
    state.drawnCards.forEach((card, i) => {
      const slot = document.createElement('div');
      slot.className = 'card-slot';
      if (card.positionLabel) {
        const lbl = document.createElement('div');
        lbl.className = 'position-label';
        lbl.textContent = card.positionLabel;
        slot.appendChild(lbl);
      }
      slot.appendChild(makeCardEl(card, i));
      area.appendChild(slot);
    });
  }
}

export function renderThemeCard() {
  const area = document.getElementById('theme-card-area');
  if (!state.themeCard) {
    area.classList.add('hidden');
    area.innerHTML = '';
    return;
  }
  area.classList.remove('hidden');
  area.innerHTML = '';

  const label = document.createElement('div');
  label.className = 'theme-card-label';
  label.textContent = 'Overall Theme';
  area.appendChild(label);

  const cardEl = makeThemeCardEl(state.themeCard);
  area.appendChild(cardEl);
}

export function makeThemeCardEl(card) {
  const suitClass = card.arcana === 'major' ? 'suit-major' :
                    card.suit ? `suit-${card.suit.toLowerCase()}` : 'suit-oracle';
  const arcanaLabel = card.arcana === 'major' ? 'Major Arcana' :
                      card.suit ? card.suit :
                      card.deckType === 'Runic' ? (card.aett || 'Rune') :
                      card.deckType === 'IChing' ? `Hexagram ${card.number}` :
                      card.deckType || 'Oracle';

  const container = document.createElement('div');
  container.className = 'card-container theme-card-container';

  const inner = document.createElement('div');
  inner.className = 'card-inner';

  const face = document.createElement('div');
  face.className = `card-face ${suitClass}${card.isReversed ? ' reversed' : ''}`;
  buildCardFace(face, card, arcanaLabel);

  if (isAlwaysFaceUp(card)) {
    inner.classList.add('flipped');
  } else {
    const back = document.createElement('div');
    const backUrl = cardBackUrl(card);
    back.className = 'card-back' + (backUrl !== '/images/tarot/card-back.jpg' ? ' has-image-back' : '');
    back.style.backgroundImage = `url('${backUrl}')`;
    back.style.backgroundSize = 'cover';
    back.style.backgroundPosition = 'center';
    inner.appendChild(back);
    // Flip after a short delay
    setTimeout(() => inner.classList.add('flipped'), 100);
  }

  inner.appendChild(face);
  container.appendChild(inner);

  return container;
}

export function showThemeMeaning() {
  if (!state.themeCard) return;
  const area = document.getElementById('theme-card-area');
  if (area.querySelector('.theme-meaning')) return; // already shown

  const meaningDiv = document.createElement('div');
  meaningDiv.className = 'theme-meaning';
  meaningDiv.innerHTML = `
    <div class="theme-meaning-name">${state.themeCard.name}${state.themeCard.isReversed ? ' <span class="theme-reversed">(Reversed)</span>' : ''}</div>
    <div class="theme-meaning-keywords">${(state.themeCard.keywords || []).join(' · ')}</div>
    <div class="theme-meaning-text">${state.themeCard.isReversed ? state.themeCard.reversed : state.themeCard.upright}</div>
  `;
  area.appendChild(meaningDiv);
}

// Populate a card face element — uses an image if one exists in the manifest,
// otherwise falls back to the styled text display.
export function buildCardFace(face, card, arcanaLabel) {
  const deckKey = card.deckType === 'MirielLunar'        ? 'miriel-lunar' :
                  card.deckType === 'DrownedEphemeris'  ? 'drowned-ephemeris' :
                  card.deckType === 'Lenormand'         ? null :
                  card.deckType === 'Thoth'             ? 'thoth' :
                  card.deckType === 'Runic'             ? 'runic' :
                  card.deckType === 'IChing'            ? 'iching' :
                  card.deckType === 'VeilArcana'        ? 'veil-arcana' :
                  (!card.arcana && !card.suit) ? 'oracle' :
                  card.arcana ? 'tarot' : null;
  const imgSrc  = deckKey && state.imageManifest[deckKey] && state.imageManifest[deckKey][card.id];

  if (imgSrc && card.deckType === 'MirielLunar') {
    face.classList.add('has-image');
    const wrapper = document.createElement('div');
    wrapper.className = 'miriel-lunar-card';

    const img = document.createElement('img');
    img.className = 'miriel-lunar-img' + (card.isReversed ? ' miriel-reversed' : '');
    img.alt = card.name;
    img.src = imgSrc;
    img.onerror = () => {
      face.classList.remove('has-image');
      face.innerHTML = cardTextHTML(card, arcanaLabel);
    };
    wrapper.appendChild(img);

    const overlay = document.createElement('div');
    overlay.className = 'miriel-lunar-overlay';

    const title = document.createElement('div');
    title.className = 'miriel-lunar-title';
    title.textContent = card.name;
    overlay.appendChild(title);

    if (card.keyword_line) {
      const kw = document.createElement('div');
      kw.className = 'miriel-lunar-keyword';
      kw.textContent = card.keyword_line;
      overlay.appendChild(kw);
    }

    if (card.isReversed) {
      const badge = document.createElement('div');
      badge.className = 'miriel-lunar-badge';
      badge.textContent = 'Reversed';
      overlay.appendChild(badge);
    }

    wrapper.appendChild(overlay);
    face.appendChild(wrapper);
    return;
  }

  if (imgSrc) {
    face.classList.add('has-image');
    if (card.deckType === 'Runic') face.classList.add('rune-stone');
    if (card.deckType === 'IChing') face.classList.add('iching-hex');
    const img = document.createElement('img');
    img.className = 'card-image';
    img.alt = card.name;
    img.src = imgSrc;
    img.onerror = () => {
      face.classList.remove('has-image');
      face.innerHTML = cardTextHTML(card, arcanaLabel);
    };
    face.appendChild(img);
    if (card.isReversed) {
      const badge = document.createElement('div');
      badge.className = 'card-reversed-badge card-img-badge';
      badge.textContent = 'Reversed';
      face.appendChild(badge);
    }
  } else {
    face.innerHTML = cardTextHTML(card, arcanaLabel);
  }
}

export function cardTextHTML(card, arcanaLabel) {
  return `
    <div class="card-symbol">${card.symbol || '✦'}</div>
    <div class="card-name">${card.name}</div>
    <div class="card-arcana">${arcanaLabel}</div>
    ${card.isReversed ? '<div class="card-reversed-badge">Reversed</div>' : ''}
  `;
}

export function makeCardEl(card, index) {
  const suitClass = card.arcana === 'major' ? 'suit-major' :
                    card.suit ? `suit-${card.suit.toLowerCase()}` : 'suit-oracle';

  const container = document.createElement('div');
  container.className = 'card-container';

  const inner = document.createElement('div');
  inner.className = 'card-inner';

  const faceUp = isAlwaysFaceUp(card);

  if (faceUp) {
    inner.classList.add('flipped');
  } else {
    const back = document.createElement('div');
    const backUrl = cardBackUrl(card);
    back.className = 'card-back' + (backUrl !== '/images/tarot/card-back.jpg' ? ' has-image-back' : '');
    back.style.backgroundImage = `url('${backUrl}')`;
    back.style.backgroundSize = 'cover';
    back.style.backgroundPosition = 'center';
    inner.appendChild(back);
  }

  const arcanaLabel = card.arcana === 'major' ? 'Major Arcana' :
                      card.suit ? card.suit :
                      card.deckType === 'Runic' ? (card.aett || 'Rune') :
                      card.deckType === 'IChing' ? `Hexagram ${card.number}` :
                      card.deckType || 'Oracle';

  const face = document.createElement('div');
  // isReversed is the boolean orientation; card.reversed is the text meaning
  face.className = `card-face ${suitClass}${card.isReversed ? ' reversed' : ''}`;
  buildCardFace(face, card, arcanaLabel);

  inner.appendChild(face);
  container.appendChild(inner);

  // Click still toggles flip manually (face-up pieces just open the meaning)
  container.addEventListener('click', () => {
    if (faceUp) { showMeaning(index); return; }
    inner.classList.toggle('flipped');
    if (inner.classList.contains('flipped')) showMeaning(index);
  });

  const isRune = card.deckType === 'Runic';
  function runScatter() {
    const SCATTER_ANGLES = [-12, 8, -5, 14, -9, 6, -13, 10, -3, 11, -7, 4, -15, 9, -2, 13, -8, 5, -11, 7];
    const tilt = SCATTER_ANGLES[index % SCATTER_ANGLES.length];
    container.style.transition = 'transform 0.22s ease-out';
    container.style.transform = `rotate(${tilt}deg)`;
    if (card.isReversed) {
      const badge = container.querySelector('.card-img-badge');
      if (badge) badge.style.transform = `translateX(-50%) rotate(${180 - tilt}deg)`;
    }
  }

  if (lastRenderDealt && window.__asyncDeal) {
    // JS-sequenced deal: the loop calls dealNow() when it's this card's turn.
    container.dealNow = () => {
      container.classList.add(isRune ? 'deal-drop' : 'deal-in');
      container.style.animationDelay = '0ms';
      // Only the container's own deal animation should clear the deal classes —
      // child face animations (the deal shimmer) bubble animationend too.
      const onDealEnd = (e) => {
        if (e.target !== container) return;
        container.removeEventListener('animationend', onDealEnd);
        container.classList.remove('deal-in', 'deal-drop');
        container.style.animationDelay = '';
      };
      container.addEventListener('animationend', onDealEnd);
      if (!faceUp) setTimeout(() => inner.classList.add('flipped'), DEAL_FLIP_DELAY);
      if (isRune) setTimeout(runScatter, DEAL_FLIP_DELAY - 80);
    };
  } else if (lastRenderDealt) {
    container.classList.add(isRune ? 'deal-drop' : 'deal-in');
    container.style.animationDelay = `${SHUFFLE_MS + index * DEAL_INTERVAL}ms`;
    // Only the container's own deal animation should clear the deal classes —
    // child face animations (the deal shimmer) bubble animationend too.
    const onDealEnd = (e) => {
      if (e.target !== container) return;
      container.removeEventListener('animationend', onDealEnd);
      container.classList.remove('deal-in', 'deal-drop');
      container.style.animationDelay = '';
    };
    container.addEventListener('animationend', onDealEnd);
    const flipAt = SHUFFLE_MS + index * DEAL_INTERVAL + DEAL_FLIP_DELAY;
    if (!faceUp) setTimeout(() => inner.classList.add('flipped'), flipAt);
    if (isRune) setTimeout(runScatter, flipAt - 80);
  } else if (!faceUp) {
    setTimeout(() => inner.classList.add('flipped'), 300 + index * 150);
  }

  return container;
}

export function showMeaning(index) {
  const panel = document.getElementById('meaning-panel');
  const content = document.getElementById('meaning-content');

  const card = state.drawnCards[index];
  // Use isReversed (boolean) to choose between card.reversed (text) and card.upright (text)
  const meaningText = card.isReversed ? card.reversed : card.upright;
  const orientation = card.isReversed ? 'Reversed' : 'Upright';

  const existing = content.querySelector(`[data-index="${index}"]`);
  if (existing) return;

  const div = document.createElement('div');
  div.className = 'meaning-card';
  div.dataset.index = index;
  div.innerHTML = `
    ${card.positionLabel ? `<div class="meaning-position">${card.positionLabel}</div>` : ''}
    <div class="meaning-title">${card.name} &mdash; ${orientation}</div>
    <div class="meaning-keywords">${
      (card.keywords || []).map(kw =>
        `<span class="keyword-pill${card.isReversed ? ' keyword-pill-rev' : ''}">${kw}</span>`
      ).join('')
    }</div>
    <div class="meaning-text">${meaningText}</div>
  `;

  content.appendChild(div);
  panel.classList.remove('hidden');
}

export function hideMeaningPanel() {
  document.getElementById('meaning-panel').classList.add('hidden');
  document.getElementById('meaning-content').innerHTML = '';
  document.getElementById('claude-response').classList.add('hidden');
  document.getElementById('card-reflections').classList.add('hidden');
  document.getElementById('overall-synopsis').classList.add('hidden');
  document.getElementById('clarifier-prompt').classList.add('hidden');
  document.getElementById('clarifier-result').classList.add('hidden');
  document.getElementById('clarifier-chooser').classList.add('hidden');
  document.getElementById('clarifier-card-area').innerHTML = '';
  document.getElementById('reflections-text').textContent = '';
  document.getElementById('synopsis-text').textContent = '';
  document.getElementById('clarifier-suggestion').textContent = '';
  document.getElementById('clarifier-reading-text').textContent = '';
  document.getElementById('continue-reading').classList.add('hidden');
  // Clear theme card meaning (keep card visible, just remove the meaning block)
  const themeArea = document.getElementById('theme-card-area');
  const tm = themeArea.querySelector('.theme-meaning');
  if (tm) tm.remove();
  state.lastReadingContext = null;
  state.lastSynopsis = '';
  const exportBtn = document.getElementById('export-reading-btn');
  if (exportBtn) exportBtn.classList.add('hidden');
  document.getElementById('copy-reading-btn')?.classList.add('hidden');
  document.getElementById('share-image-btn')?.classList.add('hidden');
  const btn = document.getElementById('ask-claude-btn');
  btn.disabled = false;
  btn.textContent = '✨ Open the reading';
}

export function makeClarifierCardEl(card) {
  const suitClass = card.arcana === 'major' ? 'suit-major' :
                    card.suit ? `suit-${card.suit.toLowerCase()}` : 'suit-oracle';
  const arcanaLabel = card.arcana === 'major' ? 'Major Arcana' :
                      card.suit ? card.suit :
                      card.deckType === 'Runic' ? (card.aett || 'Rune') :
                      card.deckType === 'IChing' ? `Hexagram ${card.number}` :
                      card.deckType || 'Oracle';

  const wrapper = document.createElement('div');
  wrapper.className = 'clarifier-card-wrapper';

  const container = document.createElement('div');
  container.className = 'card-container';

  const inner = document.createElement('div');
  inner.className = 'card-inner';

  const face = document.createElement('div');
  face.className = `card-face ${suitClass}${card.isReversed ? ' reversed' : ''}`;
  buildCardFace(face, card, arcanaLabel);

  if (isAlwaysFaceUp(card)) {
    inner.classList.add('flipped');
  } else {
    const back = document.createElement('div');
    const backUrl = cardBackUrl(card);
    back.className = 'card-back' + (backUrl !== '/images/tarot/card-back.jpg' ? ' has-image-back' : '');
    back.style.backgroundImage = `url('${backUrl}')`;
    back.style.backgroundSize = 'cover';
    back.style.backgroundPosition = 'center';
    inner.appendChild(back);
    setTimeout(() => inner.classList.add('flipped'), 200);
  }

  inner.appendChild(face);
  container.appendChild(inner);

  const label = document.createElement('div');
  label.className = 'clarifier-card-label';
  label.textContent = 'Clarifier Card';

  wrapper.appendChild(label);
  wrapper.appendChild(container);
  return wrapper;
}
