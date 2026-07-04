// ── Shared pure helpers / generic utilities ──
// Used by 3+ downstream feature modules; no dependency on app state.

export function dealPaceMs(n) { return Math.min(2000, Math.max(1100, Math.round(14000 / n))); }
export function jittered(ms) { return ms + (Math.random() * 500 - 250); }
export function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

export function notebookEl(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text) el.textContent = text;
  return el;
}

// Local computation — synodic month from a known new moon (2000-01-06 18:14 UTC)
export const LUNAR_SYNODIC = 29.53058867; // mean synodic month in days
export function moonPhaseInfo(date = new Date()) {
  const SYNODIC = LUNAR_SYNODIC;
  const KNOWN_NEW = Date.UTC(2000, 0, 6, 18, 14);
  const days = (date.getTime() - KNOWN_NEW) / 86400000;
  const age = ((days % SYNODIC) + SYNODIC) % SYNODIC;

  const PHASES = [
    [1.84566,  'New Moon',        '🌑'],
    [5.53699,  'Waxing Crescent', '🌒'],
    [9.22831,  'First Quarter',   '🌓'],
    [12.91963, 'Waxing Gibbous',  '🌔'],
    [16.61096, 'Full Moon',       '🌕'],
    [20.30228, 'Waning Gibbous',  '🌖'],
    [23.99361, 'Last Quarter',    '🌗'],
    [27.68493, 'Waning Crescent', '🌘'],
    [Infinity, 'New Moon',        '🌑'],
  ];
  const [, name, glyph] = PHASES.find(([limit]) => age < limit);
  return { name, glyph, age };
}

export function cryptoRandom() {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0] / 4294967296;
}

export function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(cryptoRandom() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// One Gilbert–Shannon–Reeds riffle: binomial cut, then interleave packets
// with probability proportional to their remaining sizes.
export function riffleOnce(cards) {
  const n = cards.length;
  let cut = 0;
  for (let i = 0; i < n; i++) if (cryptoRandom() < 0.5) cut++;
  const left = cards.slice(0, cut);
  const right = cards.slice(cut);
  const out = [];
  while (left.length || right.length) {
    if (cryptoRandom() < left.length / (left.length + right.length)) out.push(left.shift());
    else out.push(right.shift());
  }
  return out;
}

export function cutDeck(cards) {
  if (cards.length < 2) return cards;
  const at = 1 + Math.floor(cryptoRandom() * (cards.length - 1));
  return [...cards.slice(at), ...cards.slice(0, at)];
}

export function typewriterInto(el, text, speed, onDone) {
  const words = text.split(' ');
  let i = 0;
  const interval = setInterval(() => {
    if (i >= words.length) {
      clearInterval(interval);
      if (onDone) onDone();
      return;
    }
    el.textContent += (i === 0 ? '' : ' ') + words[i];
    i++;
  }, speed);
}

export function birthDateToZodiac(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T12:00:00'); // noon avoids DST edge cases
  const m = d.getMonth() + 1;
  const day = d.getDate();
  if ((m === 3 && day >= 21) || (m === 4 && day <= 19)) return 'Aries';
  if ((m === 4 && day >= 20) || (m === 5 && day <= 20)) return 'Taurus';
  if ((m === 5 && day >= 21) || (m === 6 && day <= 20)) return 'Gemini';
  if ((m === 6 && day >= 21) || (m === 7 && day <= 22)) return 'Cancer';
  if ((m === 7 && day >= 23) || (m === 8 && day <= 22)) return 'Leo';
  if ((m === 8 && day >= 23) || (m === 9 && day <= 22)) return 'Virgo';
  if ((m === 9 && day >= 23) || (m === 10 && day <= 22)) return 'Libra';
  if ((m === 10 && day >= 23) || (m === 11 && day <= 21)) return 'Scorpio';
  if ((m === 11 && day >= 22) || (m === 12 && day <= 21)) return 'Sagittarius';
  if ((m === 12 && day >= 22) || (m === 1 && day <= 19)) return 'Capricorn';
  if ((m === 1 && day >= 20) || (m === 2 && day <= 18)) return 'Aquarius';
  return 'Pisces';
}

export async function toDataUri(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    return new Promise(resolve => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch { return null; }
}

export function escHtml(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function replaceEl(id) {
  const old = document.getElementById(id);
  const clone = old.cloneNode(true);
  old.parentNode.replaceChild(clone, old);
  return clone;
}
