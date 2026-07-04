import { state } from './state.js';
import { cryptoRandom } from './utils.js';

const MIRIEL_LINES = [
  'The threads of fate reveal themselves…',
  'I feel the cards stirring…',
  'The veil between worlds grows thin…',
  'Something calls to me through the cards…',
  'The paths ahead are becoming clear…',
  'Let the cards speak what words cannot…',
  'I sense what the cards must show you…',
  'The answer is already written in the cards…',
];

const MIRIEL_DECKS = ['tarot', 'thoth', 'veil-arcana', 'drowned-ephemeris', 'miriel-lunar', 'lenormand', 'runic', 'iching', 'oracle', 'mixed'];

export function mirielPickDeck() {
  const pick = MIRIEL_DECKS[Math.floor(cryptoRandom() * MIRIEL_DECKS.length)];
  const sel = document.getElementById('deck-select');
  if (sel) sel.value = pick;
  state.currentDeck = pick;
}

export function showMirielTakeover(onComplete) {
  const overlay = document.getElementById('miriel-takeover');
  const textEl  = document.getElementById('miriel-takeover-text');
  textEl.textContent = MIRIEL_LINES[Math.floor(Math.random() * MIRIEL_LINES.length)];

  overlay.classList.remove('hidden');
  requestAnimationFrame(() => {
    requestAnimationFrame(() => overlay.classList.add('visible'));
  });

  setTimeout(() => {
    overlay.classList.remove('visible');
    overlay.addEventListener('transitionend', function onFadeOut() {
      overlay.classList.add('hidden');
      overlay.removeEventListener('transitionend', onFadeOut);
      onComplete();
    }, { once: true });
  }, 2800);
}

// A "thinking" beat that reuses the takeover overlay but stays up for as long as
// the caller needs (unlike showMirielTakeover's fixed hold). Pair with
// hideThinkingTakeover() once the work is done.
export function showThinkingTakeover(line) {
  const overlay = document.getElementById('miriel-takeover');
  const textEl  = document.getElementById('miriel-takeover-text');
  if (!overlay || !textEl) return;
  textEl.textContent = line;
  overlay.classList.remove('hidden');
  requestAnimationFrame(() => {
    requestAnimationFrame(() => overlay.classList.add('visible'));
  });
}

export function hideThinkingTakeover() {
  return new Promise(resolve => {
    const overlay = document.getElementById('miriel-takeover');
    if (!overlay || !overlay.classList.contains('visible')) {
      overlay && overlay.classList.add('hidden');
      resolve();
      return;
    }
    overlay.classList.remove('visible');
    overlay.addEventListener('transitionend', function onFade(e) {
      if (e.target !== overlay || e.propertyName !== 'opacity') return;
      overlay.removeEventListener('transitionend', onFade);
      overlay.classList.add('hidden');
      resolve();
    });
  });
}
