import { LUNAR_SYNODIC, moonPhaseInfo } from './utils.js';

// Time-of-day background theme.
// Mode is one of 'auto' | 'dawn' | 'day' | 'dusk' | 'night' (persisted in localStorage).
// 'auto' follows the local clock (dawn 5-8, day 8-17, dusk 17-20, night 20-5);
// each phase has its own forest image + accent treatment.
const THEME_MODES = ['auto', 'dawn', 'day', 'dusk', 'night'];
const PHASE_GLYPHS = { auto: '◑', dawn: '🌅', day: '☀', dusk: '🌆', night: '🌙' };

export function getThemeMode() {
  const m = localStorage.getItem('themeMode');
  return THEME_MODES.includes(m) ? m : 'auto';
}

// Clock windows: dawn 05-08, day 08-17, dusk 17-20, night 20-05.
export function resolveThemeTime(mode, date = new Date()) {
  if (mode !== 'auto') return mode;
  const h = date.getHours();
  if (h >= 5 && h < 8) return 'dawn';
  if (h >= 8 && h < 17) return 'day';
  if (h >= 17 && h < 20) return 'dusk';
  return 'night';
}

// Apply the resolved phase to <body data-time>. When the phase genuinely changes
// (and motion is allowed), cross-fade the background scene: paint a transient layer
// with the OUTGOING scene at full opacity, switch the phase so the new photo is live
// underneath, then dissolve the outgoing layer out over ~1.2s. Any failure falls back
// to the instant swap so theming never breaks.
export function applyTimeOfDayTheme() {
  const mode = getThemeMode();
  const next = resolveThemeTime(mode);
  const prev = document.body.dataset.time || null;
  const reduceMotion = window.matchMedia
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  let faded = false;
  if (typeof shouldCrossfade === 'function' && window.shouldCrossfade(prev, next) && !reduceMotion) {
    try {
      const forest = document.querySelector('.cosmos-forest');
      const fade   = document.querySelector('.cosmos-forest-fade');
      if (forest && fade) {
        const cs = getComputedStyle(forest);
        fade.style.backgroundImage    = cs.backgroundImage;
        fade.style.backgroundSize     = cs.backgroundSize;
        fade.style.backgroundPosition = cs.backgroundPosition;
        fade.style.transition = 'none';   // snap to the visible (outgoing) scene
        fade.style.opacity = '1';
        void fade.offsetWidth;             // commit the opacity:1 start point
        fade.style.transition = '';        // restore the CSS 1.2s ease-in-out
        document.body.dataset.time = next; // new photo now live under the fade layer
        fade.addEventListener('transitionend', function onEnd(e) {
          if (e.propertyName !== 'opacity') return;
          fade.style.backgroundImage = '';
        }, { once: true });
        requestAnimationFrame(() => { fade.style.opacity = '0'; });
        faded = true;
      }
    } catch {
      faded = false; // fall through to the instant swap below
    }
  }

  if (!faded) document.body.dataset.time = next;
  updateAmbientLine(prev, next);
  updateThemeButton(mode);
}

// Phase-keyed atmospheric scene line under the header. First paint sets it
// immediately; a real phase change fades it out, swaps the copy, and fades it back;
// an unchanged phase leaves it alone. Guarded so a missing script/element never
// breaks theming.
function updateAmbientLine(prev, next) {
  if (typeof ambientLineFor !== 'function') return;
  const el = document.getElementById('header-ambient');
  if (!el) return;
  const reduceMotion = window.matchMedia
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!prev) { el.textContent = window.ambientLineFor(next); return; }   // first paint
  if (prev === next) return;                                      // no change
  if (reduceMotion) { el.textContent = window.ambientLineFor(next); return; }
  el.style.opacity = '0';
  setTimeout(() => {
    el.textContent = window.ambientLineFor(next);
    el.style.opacity = '1';
  }, 250);
}

function updateThemeButton(mode) {
  const btn = document.getElementById('theme-btn');
  if (!btn) return;
  btn.textContent = PHASE_GLYPHS[mode] || PHASE_GLYPHS.auto;
  const label = mode.charAt(0).toUpperCase() + mode.slice(1);
  btn.title = `Theme: ${label}${mode === 'auto' ? ' (follows the clock)' : ''}`;
}

export function cycleTheme() {
  const cur = getThemeMode();
  const next = THEME_MODES[(THEME_MODES.indexOf(cur) + 1) % THEME_MODES.length];
  localStorage.setItem('themeMode', next);
  applyTimeOfDayTheme();
}

export function renderHeaderMoon() {
  const el = document.getElementById('header-moon');
  if (!el) return;
  const { name, glyph, age } = moonPhaseInfo();
  el.textContent = `${glyph} ${name.toLowerCase()}`;
  el.title = `Moon age: ${age.toFixed(1)} days`;
}

export function renderCosmosMoon() {
  const el = document.getElementById('cosmos-moon');
  if (!el) return;
  const { age, name } = moonPhaseInfo();
  // Illumination 0 (new) .. 1 (full) .. 0 (new) across the lunar cycle.
  const illum = (1 - Math.cos((age / LUNAR_SYNODIC) * 2 * Math.PI)) / 2;
  // Dim the glow toward new moon, brighten toward full.
  // Glow color mirrors --starlight / --glow-moon in style.css — keep in sync.
  el.style.opacity = String(0.45 + illum * 0.55);
  el.style.boxShadow = `0 0 ${30 + illum * 50}px rgba(205, 188, 255, ${0.35 + illum * 0.4})`;
  el.title = name;
}
