let allCards = { tarot: [], oracle: [], moonology: [], 'celtic-dragon': [], lenormand: [], thoth: [], runic: [], iching: [] };
let imageManifest = {};       // { 'celtic-dragon': { 'cd-major-0': '/images/celtic-dragon/cd-major-0.jpg', ... }, moonology: {...} }
let currentDeck = 'tarot';
let currentSpread = 'single';
let drawnCards = [];
let manualMode = false;
let currentQuestion = '';
let revealTimers = [];        // track pending auto-reveal timeouts so we can cancel on new draw
let dealAnimActive    = false; // set true before auto-draws; consumed by renderSpread
let lastRenderDealt   = false; // snapshot of dealAnimActive captured in renderSpread; read by autoReveal

const DEAL_INTERVAL   = 480;  // ms between each card starting to deal
const SHUFFLE_MS      = 1400; // visible riffle of the pile before dealing begins
const DEAL_DURATION   = 520;  // ms flight duration
const DEAL_FLIP_DELAY = 640;  // ms from card start until flip (DEAL_DURATION + 120 buffer)
let dealToken = 0; // bumped on each new draw so an in-flight async deal can abort
function dealPaceMs(n) { return Math.min(2000, Math.max(1100, Math.round(14000 / n))); }
function jittered(ms) { return ms + (Math.random() * 500 - 250); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
let lastReadingContext = null; // saved for clarifier calls
let themeCard = null;         // bottom-of-deck overall theme (random mode only)
let currentReader = { name: 'Matt', slug: 'matt' }; // active reader profile
let sessionReadings = [];     // readings completed this session (for "Read the thread")
let sessionSummaryText = '';  // last generated thread summary (for save doc)
let lastSynopsis = '';        // most recent interpretation text (for share functions)
let compatPersonA = null;     // { name, zodiac } for compatibility readings
let compatPersonB = null;

const SPREADS = {
  'single': {
    category: 'general', label: 'Single',
    slots: [{ label: 'Card', position: '' }]
  },
  'three-card': {
    category: 'general', label: 'Three Card',
    slots: [
      { label: 'Past',    position: 'past' },
      { label: 'Present', position: 'present' },
      { label: 'Future',  position: 'future' }
    ]
  },
  'four-card': {
    category: 'general', label: 'Four Card',
    slots: [
      { label: 'Past',    position: 'past' },
      { label: 'Present', position: 'present' },
      { label: 'Future',  position: 'future' },
      { label: 'Advice',  position: 'advice' }
    ]
  },
  'five-card': {
    category: 'general', label: 'Five Card',
    slots: [
      { label: 'Past',    position: 'past' },
      { label: 'Present', position: 'present' },
      { label: 'Hidden',  position: 'hidden' },
      { label: 'Advice',  position: 'advice' },
      { label: 'Outcome', position: 'outcome' }
    ]
  },
  'yes-no': {
    category: 'general', label: 'Yes / No',
    slots: [
      { label: 'The Question',  position: 'question' },
      { label: 'The Challenge', position: 'challenge' },
      { label: 'The Answer',    position: 'answer' }
    ]
  },
  'horseshoe': {
    category: 'general', label: 'Horseshoe',
    slots: [
      { label: 'Past',              position: 'past' },
      { label: 'Present',           position: 'present' },
      { label: 'Hidden Influences', position: 'hidden' },
      { label: 'Obstacles',         position: 'obstacles' },
      { label: 'External Forces',   position: 'external' },
      { label: 'Best Action',       position: 'action' },
      { label: 'Outcome',           position: 'outcome' }
    ]
  },
  'year-ahead': {
    category: 'general', label: 'Year Ahead',
    slots: [
      { label: 'January',   position: 'jan' },
      { label: 'February',  position: 'feb' },
      { label: 'March',     position: 'mar' },
      { label: 'April',     position: 'apr' },
      { label: 'May',       position: 'may' },
      { label: 'June',      position: 'jun' },
      { label: 'July',      position: 'jul' },
      { label: 'August',    position: 'aug' },
      { label: 'September', position: 'sep' },
      { label: 'October',   position: 'oct' },
      { label: 'November',  position: 'nov' },
      { label: 'December',  position: 'dec' }
    ]
  },
  'decision': {
    category: 'general', label: 'Decision',
    slots: [
      { label: 'The Situation',  position: 'situation' },
      { label: 'Path A',         position: 'path-a' },
      { label: 'Path A Energy',  position: 'path-a-energy' },
      { label: 'Path B',         position: 'path-b' },
      { label: 'Path B Energy',  position: 'path-b-energy' },
      { label: 'Outcome',        position: 'outcome' }
    ]
  },
  'celtic': {
    category: 'general', label: 'Celtic Cross',
    slots: [
      { label: 'The Heart',     position: 'heart' },
      { label: 'The Cross',     position: 'cross' },
      { label: 'Above',         position: 'above' },
      { label: 'Below',         position: 'below' },
      { label: 'Behind',        position: 'behind' },
      { label: 'Before',        position: 'before' },
      { label: 'Yourself',      position: 'self' },
      { label: 'Environment',   position: 'environment' },
      { label: 'Hopes / Fears', position: 'hopes' },
      { label: 'Outcome',       position: 'outcome' }
    ]
  },
  'reader-choice': {
    category: 'general', label: '✦ Miriel\'s Choice',
    special: 'reader-choice',
    slots: []
  },
  'six-card': {
    category: 'relationship', label: 'Six Card',
    slots: [
      { label: 'A: Intentions', position: 'a-intentions' },
      { label: 'A: Energy',     position: 'a-energy' },
      { label: 'B: Intentions', position: 'b-intentions' },
      { label: 'B: Energy',     position: 'b-energy' },
      { label: 'Shared Energy', position: 'shared' },
      { label: 'Outcome',       position: 'outcome' }
    ]
  },
  'nine-card': {
    category: 'relationship', label: 'Nine Card',
    slots: [
      { label: "Partner's Energy",     position: 'partner-energy' },
      { label: "How Partner Views Me", position: 'partner-view' },
      { label: "Partner's Feelings",   position: 'partner-feelings' },
      { label: "My Energy",            position: 'my-energy' },
      { label: "How I View Partner",   position: 'my-view' },
      { label: "My Feelings",          position: 'my-feelings' },
      { label: 'Strengths',            position: 'strengths' },
      { label: 'Weakness',             position: 'weakness' },
      { label: 'Outcome',              position: 'outcome' }
    ]
  },
  'compatibility': {
    category: 'relationship', label: '♥ Compatibility',
    special: 'modal',
    slots: [
      { label: "Person A's Energy", position: 'a-energy' },
      { label: "Person B's Energy", position: 'b-energy' },
      { label: 'The Connection',    position: 'connection' },
      { label: 'The Tension',       position: 'tension' },
      { label: 'What to Nurture',   position: 'nurture' },
      { label: 'Outcome',           position: 'outcome' }
    ]
  },
  'rel-cross': {
    category: 'relationship', label: 'Relationship Cross',
    slots: [
      { label: 'You',            position: 'you' },
      { label: 'Your Partner',   position: 'partner' },
      { label: 'Dynamics',       position: 'dynamics' },
      { label: 'Challenges',     position: 'challenges' },
      { label: 'Strengths',      position: 'strengths' },
      { label: 'Future Outlook', position: 'future' }
    ]
  },
  'soulmates': {
    category: 'relationship', label: 'Soulmates / Twin Flames',
    slots: [
      { label: 'Soul Connection',     position: 'soul' },
      { label: 'Past Life',           position: 'past-life' },
      { label: 'Present Connection',  position: 'present' },
      { label: 'Purpose & Journey',   position: 'purpose' },
      { label: 'Challenges & Growth', position: 'challenges' },
      { label: 'Divine Union',        position: 'union' }
    ]
  },
  'rel-future': {
    category: 'relationship', label: 'Future of Relationship',
    slots: [
      { label: 'Current Status',   position: 'status' },
      { label: 'Near Future',      position: 'near-future' },
      { label: 'Potential Growth', position: 'growth' },
      { label: 'Communication',    position: 'communication' },
      { label: 'Challenges',       position: 'challenges' },
      { label: 'Path Forward',     position: 'path' }
    ]
  },
  'chakra': {
    category: 'spiritual', label: 'Chakra',
    slots: [
      { label: 'Root',         position: 'root' },
      { label: 'Sacral',       position: 'sacral' },
      { label: 'Solar Plexus', position: 'solar-plexus' },
      { label: 'Heart',        position: 'heart' },
      { label: 'Throat',       position: 'throat' },
      { label: 'Third Eye',    position: 'third-eye' },
      { label: 'Crown',        position: 'crown' }
    ]
  },
  'star': {
    category: 'spiritual', label: 'Star / Pentagram',
    slots: [
      { label: 'Earth',  position: 'earth' },
      { label: 'Air',    position: 'air' },
      { label: 'Fire',   position: 'fire' },
      { label: 'Water',  position: 'water' },
      { label: 'Spirit', position: 'spirit' }
    ]
  }
};

const CELTIC_CLASSES = [
  'celtic-center', 'celtic-cross', 'celtic-top', 'celtic-bottom',
  'celtic-left', 'celtic-right', 'celtic-extra4', 'celtic-extra3',
  'celtic-extra2', 'celtic-extra1'
];

// Six-card grid: draw order maps to visual position (A left, B right)
const SIX_CARD_CLASSES = ['six-r1c1', 'six-r2c1', 'six-r1c2', 'six-r2c2', 'six-r3c1', 'six-r3c2'];

// Nine-card grid: 3×3 top, then 2 side-by-side, then 1 center
const NINE_CARD_CLASSES = [
  'nine-r1c1', 'nine-r1c2', 'nine-r1c3',
  'nine-r2c1', 'nine-r2c2', 'nine-r2c3',
  'nine-r3c1', 'nine-r3c3',
  'nine-r4c2'
];

const HORSESHOE_CLASSES = ['hs-1', 'hs-2', 'hs-3', 'hs-4', 'hs-5', 'hs-6', 'hs-7'];

const YEAR_CLASSES = [
  'yr-1', 'yr-2', 'yr-3', 'yr-4',
  'yr-5', 'yr-6', 'yr-7', 'yr-8',
  'yr-9', 'yr-10', 'yr-11', 'yr-12'
];

const CHAKRA_CLASSES = [
  'chakra-root', 'chakra-sacral', 'chakra-solar', 'chakra-heart',
  'chakra-throat', 'chakra-third-eye', 'chakra-crown'
];

// Columns: 1=Situation(span 2 rows), 2=PathA1, 3=PathA2, 4=PathB1, 5=PathB2, 6=Outcome(span 2 rows)
const DECISION_CLASSES = ['dc-situation', 'dc-pa1', 'dc-pa2', 'dc-pb1', 'dc-pb2', 'dc-outcome'];

// Slot order: Earth(lower-left), Air(upper-right), Fire(lower-right), Water(upper-left), Spirit(top)
const STAR_CLASSES = ['star-earth', 'star-air', 'star-fire', 'star-water', 'star-spirit'];

const SPREAD_LAYOUTS = {
  'celtic':        { gridClass: 'celtic-grid',    cardClasses: CELTIC_CLASSES,    labelClass: null },
  'six-card':      { gridClass: 'six-grid',        cardClasses: SIX_CARD_CLASSES,  labelClass: 'position-label-sm' },
  'compatibility': { gridClass: 'six-grid',        cardClasses: SIX_CARD_CLASSES,  labelClass: 'position-label-sm' },
  'nine-card':     { gridClass: 'nine-grid',       cardClasses: NINE_CARD_CLASSES, labelClass: 'position-label-sm' },
  'horseshoe':     { gridClass: 'horseshoe-grid',  cardClasses: HORSESHOE_CLASSES, labelClass: 'position-label-sm' },
  'year-ahead':    { gridClass: 'year-grid',       cardClasses: YEAR_CLASSES,      labelClass: 'position-label-sm' },
  'chakra':        { gridClass: 'chakra-grid',     cardClasses: CHAKRA_CLASSES,    labelClass: 'position-label-sm' },
  'decision':      { gridClass: 'decision-grid',   cardClasses: DECISION_CLASSES,  labelClass: 'position-label-sm' },
  'star':          { gridClass: 'star-grid',       cardClasses: STAR_CLASSES,      labelClass: 'position-label-sm' },
};

function initSpreadButtons() {
  activateTab('general');
}

function activateTab(category) {
  document.querySelectorAll('#spread-tabs .tab').forEach(t => {
    t.classList.toggle('active', t.dataset.tab === category);
  });
  const sel = document.getElementById('spread-select');
  if (!sel) return;
  sel.innerHTML = '';
  // Regular spreads for this category (excluding reader-choice and modal — added manually below)
  Object.entries(SPREADS)
    .filter(([, s]) => s.category === category && s.special !== 'reader-choice' && s.special !== 'modal')
    .forEach(([key, spread]) => {
      const opt = document.createElement('option');
      opt.value = key;
      opt.textContent = spread.label;
      if (key === currentSpread) opt.selected = true;
      sel.appendChild(opt);
    });
  // Compatibility appears at the bottom of the Relationship tab
  if (category === 'relationship') {
    const compatOpt = document.createElement('option');
    compatOpt.value = 'compatibility';
    compatOpt.textContent = '♥ Compatibility';
    sel.appendChild(compatOpt);
  }
  // Miriel's Choice appears at the bottom of every category
  const mirielOpt = document.createElement('option');
  mirielOpt.value = 'reader-choice';
  mirielOpt.textContent = '⋯ Miriel\'s Choice';
  if (currentSpread === 'reader-choice') mirielOpt.selected = true;
  sel.appendChild(mirielOpt);

  if (!sel.value || !SPREADS[sel.value] || SPREADS[sel.value].category !== category) {
    sel.selectedIndex = 0;
    currentSpread = sel.value;
  }
}

// ── Init ────────────────────────────────────────────────────────────────────

// Pristine HTML of the active reading slot (#reader-note, #theme-card-area,
// #spread-area, #meaning-panel). Captured at page load and reused to recreate
// the slot at the bottom of <main> each time a new reading begins, so prior
// readings stay in place above instead of being shuffled out.
let ACTIVE_SLOT_TEMPLATE = '';
function captureActiveSlotTemplate() {
  const ids = ['reader-note', 'theme-card-area', 'spread-area', 'meaning-panel'];
  ACTIVE_SLOT_TEMPLATE = ids
    .map(id => document.getElementById(id))
    .filter(Boolean)
    .map(el => el.outerHTML)
    .join('\n');
}

async function init() {
  applyTimeOfDayTheme();   // set background theme immediately, before any await
  // Re-evaluate live so the phase shifts during a long-open session (Auto mode
  // crossing a clock boundary). No-op when a phase is forced via the toggle.
  setInterval(applyTimeOfDayTheme, 60000);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) applyTimeOfDayTheme();
  });
  captureActiveSlotTemplate();
  // Load readers first so currentReader is set before any reading fetch
  try {
    const readersRes = await fetch('/api/readers');
    if (readersRes.ok) {
      const readers = await readersRes.json();
      if (readers.length) currentReader = readers[0];
    }
  } catch {}

  const [cardsRes, imagesRes] = await Promise.all([
    fetch('/api/cards'),
    fetch('/api/images').catch(() => null)
  ]);
  allCards = await cardsRes.json();
  try {
    if (imagesRes && imagesRes.ok) imageManifest = await imagesRes.json();
  } catch {}
  setupButtons();
  buildReaderUI();
  checkKeyStatus();
  checkForPriorSession();
  const tookOver = await checkThreshold();
  if (!tookOver) buildGreeting();
  buildDailyCardBar();
  renderHeaderMoon();
  renderCosmosMoon();
}

// Time-of-day background theme.
// Mode is one of 'auto' | 'dawn' | 'day' | 'dusk' | 'night' (persisted in localStorage).
// 'auto' follows the local clock (dawn 5-8, day 8-17, dusk 17-20, night 20-5);
// each phase has its own forest image + accent treatment.
const THEME_MODES = ['auto', 'dawn', 'day', 'dusk', 'night'];
const PHASE_GLYPHS = { auto: '◑', dawn: '🌅', day: '☀', dusk: '🌆', night: '🌙' };

function getThemeMode() {
  const m = localStorage.getItem('themeMode');
  return THEME_MODES.includes(m) ? m : 'auto';
}

// Clock windows: dawn 05-08, day 08-17, dusk 17-20, night 20-05.
function resolveThemeTime(mode, date = new Date()) {
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
function applyTimeOfDayTheme() {
  const mode = getThemeMode();
  const next = resolveThemeTime(mode);
  const prev = document.body.dataset.time || null;
  const reduceMotion = window.matchMedia
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  let faded = false;
  if (typeof shouldCrossfade === 'function' && shouldCrossfade(prev, next) && !reduceMotion) {
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
    } catch (err) {
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
  if (!prev) { el.textContent = ambientLineFor(next); return; }   // first paint
  if (prev === next) return;                                      // no change
  if (reduceMotion) { el.textContent = ambientLineFor(next); return; }
  el.style.opacity = '0';
  setTimeout(() => {
    el.textContent = ambientLineFor(next);
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

function cycleTheme() {
  const cur = getThemeMode();
  const next = THEME_MODES[(THEME_MODES.indexOf(cur) + 1) % THEME_MODES.length];
  localStorage.setItem('themeMode', next);
  applyTimeOfDayTheme();
}

function setupButtons() {
  document.getElementById('deck-select').addEventListener('change', e => {
    currentDeck = e.target.value;
  });

  document.getElementById('question-input').addEventListener('input', e => {
    currentQuestion = e.target.value.trim();
  });

  document.getElementById('question-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') drawCards();
  });

  document.getElementById('mode-random').addEventListener('click', () => {
    manualMode = false;
    document.getElementById('mode-random').classList.add('active');
    document.getElementById('mode-manual').classList.remove('active');
    document.getElementById('draw-btn').textContent = 'Lay the Cards';
  });

  document.getElementById('mode-manual').addEventListener('click', () => {
    manualMode = true;
    document.getElementById('mode-manual').classList.add('active');
    document.getElementById('mode-random').classList.remove('active');
    document.getElementById('draw-btn').textContent = 'Begin the Reading';
  });

  document.getElementById('mode-miriel').addEventListener('click', () => {
    launchMirielsChoice();
  });

  initSpreadButtons();
  document.querySelectorAll('#spread-tabs .tab').forEach(tab => {
    tab.addEventListener('click', () => activateTab(tab.dataset.tab));
  });

  document.getElementById('spread-select').addEventListener('change', function () {
    if (SPREADS[this.value]?.special === 'modal') {
      // Reset dropdown to previous value — compat is launched via its modal, not drawCards
      this.value = currentSpread;
      showCompatModal();
      return;
    }
    currentSpread = this.value;
  });

  document.getElementById('draw-btn').addEventListener('click', drawCards);
  document.getElementById('ask-claude-btn').addEventListener('click', askClaude);
  document.getElementById('export-reading-btn').addEventListener('click', exportCurrentReading);
  document.getElementById('copy-reading-btn').addEventListener('click', copyReadingText);
  document.getElementById('share-image-btn').addEventListener('click', exportReadingAsImage);

  // Compatibility modal
  const compatModal = document.getElementById('compat-modal');
  function showCompatModal() { compatModal.classList.remove('hidden'); }
  function hideCompatModal() { compatModal.classList.add('hidden'); }

  document.getElementById('compat-close-btn').addEventListener('click', hideCompatModal);
  document.getElementById('compat-backdrop').addEventListener('click', hideCompatModal);

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !compatModal.classList.contains('hidden')) hideCompatModal();
  });

  // Live zodiac preview from birth date
  ['a', 'b'].forEach(person => {
    const bdate = document.getElementById(`compat-${person}-bdate`);
    const zodiacSel = document.getElementById(`compat-${person}-zodiac`);
    const preview = document.getElementById(`compat-${person}-preview`);
    bdate.addEventListener('input', () => {
      const sign = birthDateToZodiac(bdate.value);
      if (sign) {
        zodiacSel.value = sign;
        preview.textContent = sign + ' detected';
      } else {
        preview.textContent = '';
      }
    });
    zodiacSel.addEventListener('change', () => { preview.textContent = ''; });
  });

  document.getElementById('compat-begin-btn').addEventListener('click', () => {
    const nameA = document.getElementById('compat-a-name').value.trim();
    const nameB = document.getElementById('compat-b-name').value.trim();
    const zodiacA = document.getElementById('compat-a-zodiac').value;
    const zodiacB = document.getElementById('compat-b-zodiac').value;
    if (!nameA || !nameB) { alert('Please enter names for both people.'); return; }
    if (!zodiacA || !zodiacB) { alert('Please select or enter a birth date for both people.'); return; }
    compatPersonA = { name: nameA, zodiac: zodiacA };
    compatPersonB = { name: nameB, zodiac: zodiacB };
    SPREADS['compatibility'].slots[0].label = `${nameA}'s Energy`;
    SPREADS['compatibility'].slots[1].label = `${nameB}'s Energy`;
    hideCompatModal();
    drawCards();
  });

  // Settings modal — open/close
  const settingsPanel = document.getElementById('settings-panel');

  function openSettings() { settingsPanel.classList.remove('hidden'); }
  function closeSettings() {
    settingsPanel.classList.add('hidden');
    document.getElementById('key-status').textContent = '';
    document.getElementById('key-status').className = 'key-status';
  }

  document.getElementById('settings-btn').addEventListener('click', openSettings);
  document.getElementById('settings-close-btn').addEventListener('click', closeSettings);
  document.getElementById('settings-backdrop').addEventListener('click', closeSettings);
  document.getElementById('notebook-close').addEventListener('click', closeNotebook);
  document.getElementById('notebook-backdrop').addEventListener('click', closeNotebook);
  document.getElementById('journal-btn').addEventListener('click', openJournal);
  document.getElementById('journal-close').addEventListener('click', closeJournal);
  document.getElementById('journal-backdrop').addEventListener('click', closeJournal);
  document.getElementById('theme-btn').addEventListener('click', cycleTheme);
  document.getElementById('grimoire-btn').addEventListener('click', openGrimoire);
  document.getElementById('grimoire-close').addEventListener('click', closeGrimoire);
  document.getElementById('grimoire-backdrop').addEventListener('click', closeGrimoire);

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !settingsPanel.classList.contains('hidden')) closeSettings();
  });

  document.getElementById('save-key-btn').addEventListener('click', async () => {
    const key = document.getElementById('api-key-input').value.trim();
    const status = document.getElementById('key-status');
    if (!key) return;
    const btn = document.getElementById('save-key-btn');
    btn.disabled = true;
    btn.textContent = 'Saving…';
    try {
      const r = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: key })
      });
      const d = await r.json();
      if (d.ok) {
        status.textContent = '✓ Key saved';
        status.className = 'key-status key-ok';
        document.getElementById('api-key-input').value = '';
        document.getElementById('settings-btn').classList.remove('settings-needs-key');
        document.getElementById('settings-btn').title = 'Settings';
        setTimeout(closeSettings, 800);
      } else {
        status.textContent = '✗ ' + (d.error || 'Failed');
        status.className = 'key-status key-err';
      }
    } catch {
      status.textContent = '✗ Network error';
      status.className = 'key-status key-err';
    }
    btn.disabled = false;
    btn.textContent = 'Save';
  });
}

async function checkKeyStatus() {
  try {
    const r = await fetch('/api/config-status');
    const d = await r.json();
    const btn = document.getElementById('settings-btn');
    if (!d.hasKey && !d.hasLocalModel) {
      btn.classList.add('settings-needs-key');
      btn.title = 'API key required — click to add';
    } else if (!d.hasKey && d.hasLocalModel) {
      btn.title = 'Running on local AI model (Ollama)';
    }
  } catch {}
}

// ── Reader profiles ──────────────────────────────────────────────────────────

function buildReaderUI() {
  // Build selector element and inject into .controls-row-1 before settings btn
  const controlsRow = document.querySelector('.controls-row-1');
  const settingsBtn = document.getElementById('settings-btn');

  const selector = document.createElement('div');
  selector.className = 'reader-selector';
  selector.id = 'reader-selector';

  const btn = document.createElement('button');
  btn.className = 'reader-btn';
  btn.id = 'reader-btn';
  btn.innerHTML = `&#9789; <span id="reader-name">${currentReader.name}</span>`;

  const dropdown = document.createElement('div');
  dropdown.className = 'reader-dropdown hidden';
  dropdown.id = 'reader-dropdown';

  selector.appendChild(btn);
  selector.appendChild(dropdown);
  controlsRow.insertBefore(selector, settingsBtn);

  // Toggle dropdown
  btn.addEventListener('click', e => {
    e.stopPropagation();
    const isHidden = dropdown.classList.contains('hidden');
    dropdown.classList.toggle('hidden', !isHidden);
    if (isHidden) populateReaderDropdown(dropdown);
  });

  // Close on outside click
  document.addEventListener('click', () => dropdown.classList.add('hidden'));
  dropdown.addEventListener('click', e => e.stopPropagation());
}

async function populateReaderDropdown(dropdown) {
  dropdown.innerHTML = '';
  let readers = [];
  try {
    const r = await fetch('/api/readers');
    if (r.ok) readers = await r.json();
  } catch {}

  readers.forEach(reader => {
    const row = document.createElement('div');
    row.className = 'reader-row';

    const opt = document.createElement('button');
    opt.className = 'reader-option' + (reader.slug === currentReader.slug ? ' active' : '');
    opt.textContent = reader.name;
    opt.addEventListener('click', () => {
      switchReader(reader);
      dropdown.classList.add('hidden');
    });
    row.appendChild(opt);

    // Show delete button only when more than one reader exists and this isn't the active reader
    if (readers.length > 1 && reader.slug !== currentReader.slug) {
      const delBtn = document.createElement('button');
      delBtn.className = 'reader-delete-btn';
      delBtn.title = `Remove ${reader.name}`;
      delBtn.textContent = '×';

      // Inline confirm: click once to arm, again to confirm
      delBtn.addEventListener('click', async e => {
        e.stopPropagation();
        if (delBtn.dataset.armed) {
          delBtn.disabled = true;
          try {
            const r = await fetch(`/api/readers/${encodeURIComponent(reader.slug)}`, { method: 'DELETE' });
            if (r.ok) {
              row.remove();
              // If only one reader remains hide all remaining delete buttons
              const remaining = dropdown.querySelectorAll('.reader-row');
              if (remaining.length === 1) {
                remaining[0].querySelector('.reader-delete-btn')?.remove();
              }
            }
          } catch {}
          delBtn.disabled = false;
          delete delBtn.dataset.armed;
          delBtn.textContent = '×';
          delBtn.classList.remove('armed');
        } else {
          delBtn.dataset.armed = '1';
          delBtn.textContent = '✓';
          delBtn.classList.add('armed');
          // Auto-disarm after 3 seconds
          setTimeout(() => {
            if (delBtn.dataset.armed) {
              delete delBtn.dataset.armed;
              delBtn.textContent = '×';
              delBtn.classList.remove('armed');
            }
          }, 3000);
        }
      });
      row.appendChild(delBtn);
    }

    dropdown.appendChild(row);
  });

  // Your Story So Far — Miriel's notebook on the active reader
  const storyBtn = document.createElement('button');
  storyBtn.className = 'reader-option reader-option-story';
  storyBtn.textContent = '✦ Your Story So Far';
  storyBtn.addEventListener('click', () => {
    dropdown.classList.add('hidden');
    openNotebook();
  });
  dropdown.appendChild(storyBtn);

  // Add new reader button + form
  const addBtn = document.createElement('button');
  addBtn.className = 'reader-option reader-option-add';
  addBtn.id = 'reader-add-btn';
  addBtn.textContent = '＋ New reader';

  const form = document.createElement('div');
  form.className = 'reader-new-form hidden';
  form.id = 'reader-new-form';

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'reader-new-input';
  input.placeholder = 'Name…';
  input.maxLength = 40;

  const saveBtn = document.createElement('button');
  saveBtn.className = 'reader-new-save';
  saveBtn.textContent = 'Add';

  form.appendChild(input);
  form.appendChild(saveBtn);
  dropdown.appendChild(addBtn);
  dropdown.appendChild(form);

  addBtn.addEventListener('click', () => {
    form.classList.toggle('hidden');
    if (!form.classList.contains('hidden')) input.focus();
  });

  const doAdd = async () => {
    const name = input.value.trim();
    if (!name) return;
    saveBtn.disabled = true;
    try {
      const r = await fetch('/api/readers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name })
      });
      if (r.ok) {
        const reader = await r.json();
        switchReader(reader);
        dropdown.classList.add('hidden');
      }
    } catch {}
    saveBtn.disabled = false;
  };

  saveBtn.addEventListener('click', doAdd);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') doAdd(); });
}

function switchReader(reader) {
  currentReader = reader;
  document.getElementById('reader-name').textContent = reader.name;
  // Clear current session state
  drawnCards = [];
  themeCard = null;
  sessionReadings = [];
  sessionSummaryText = '';
  currentQuestion = '';
  document.getElementById('question-input').value = '';
  document.getElementById('spread-area').innerHTML = '';
  document.getElementById('spread-area').className = 'spread-area';
  document.getElementById('theme-card-area').classList.add('hidden');
  document.getElementById('theme-card-area').innerHTML = '';
  hideMeaningPanel();
  // Remove any session summary section so it rebuilds fresh
  const existing = document.getElementById('session-summary-section');
  if (existing) existing.remove();
  // Load this reader's prior session
  checkForPriorSession();
}

// ── Your Story So Far (reader profile notebook) ──────────────────────────────

function notebookEl(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text) el.textContent = text;
  return el;
}

async function openNotebook() {
  const overlay = document.getElementById('notebook-overlay');
  const inner   = document.getElementById('notebook-inner');
  if (!overlay || !inner) return;
  inner.innerHTML = '';

  let data = null;
  try {
    const r = await fetch(`/api/profiles/${encodeURIComponent(currentReader.slug)}`);
    if (r.ok) data = await r.json();
  } catch {}

  let foretellings = [];
  try {
    const fr = await fetch(`/api/foretellings/${encodeURIComponent(currentReader.slug)}`);
    if (fr.ok) foretellings = (await fr.json()).foretellings || [];
  } catch {}

  // Header (always shown)
  inner.appendChild(notebookEl('div', 'notebook-ornament', '✦ · ✦ · ✦'));
  inner.appendChild(notebookEl('div', 'notebook-title', 'YOUR STORY SO FAR'));

  // The living note updates after every reading — shown regardless of tier so the
  // notebook visibly keeps up even before the periodic synthesis kicks in.
  renderLivingNote(inner, data && data.profile);

  if (!data) {
    renderNotebookTeaser(inner, null, "I couldn't reach her notebook just now.");
  } else if (data.tier === 1 || !data.profile) {
    renderNotebookTeaser(inner, data.readingCount, null);
  } else {
    renderNotebookProfile(inner, data);
  }

  renderForetellings(inner, foretellings);
  inner.appendChild(notebookEl('div', 'notebook-hint', 'esc · return to the table'));

  overlay.classList.remove('hidden');
  requestAnimationFrame(() => overlay.classList.add('visible'));
  document.body.style.overflow = 'hidden';
  document.addEventListener('keydown', notebookEscHandler);
}

function renderLivingNote(inner, profile) {
  if (!profile || !profile.living_note) return;
  inner.appendChild(notebookEl('div', 'notebook-eyebrow', 'Where things stand'));
  inner.appendChild(notebookEl('div', 'notebook-living-note', profile.living_note));
  if (profile.living_note_updated) {
    const d = new Date(profile.living_note_updated * 1000)
      .toLocaleString(undefined, { month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    inner.appendChild(notebookEl('div', 'notebook-living-note-date', `updated ${d}`));
  }
}

function renderNotebookTeaser(inner, readingCount, errorNote) {
  const teaser = notebookEl('div', 'notebook-teaser',
    errorNote || "I'm still getting to know you. Sit with me a few more times — the cards will tell me who you are.");
  inner.appendChild(teaser);
  if (readingCount !== null && readingCount !== undefined) {
    const remaining = Math.max(1, 10 - readingCount);
    inner.appendChild(notebookEl('div', 'notebook-teaser-count',
      `${remaining} more reading${remaining === 1 ? '' : 's'} until she opens it`));
  }
}

function renderNotebookProfile(inner, data) {
  const p = data.profile;

  // Meta line
  const updated = p.last_updated
    ? new Date(p.last_updated * 1000).toLocaleDateString(undefined, { month: 'long', day: 'numeric' })
    : null;
  const metaBits = [`as Miriel has come to know ${currentReader.name}`];
  if (p.readings_synthesized) metaBits.push(`${p.readings_synthesized} readings`);
  if (updated) metaBits.push(`last updated ${updated}`);
  inner.appendChild(notebookEl('div', 'notebook-meta', metaBits.join(' · ')));

  // Chapter quote (tier 3 only — life_arc absent at tier 2)
  if (p.life_arc && p.life_arc.current_chapter) {
    inner.appendChild(notebookEl('div', 'notebook-quote', `"${p.life_arc.current_chapter}"`));
  }

  // Her notes, verbatim
  if (p.miriel_notes) {
    inner.appendChild(notebookEl('div', 'notebook-eyebrow', 'From her notebook'));
    const notes = notebookEl('div', 'notebook-notes');
    p.miriel_notes.split(/\n\s*\n/).forEach(par => {
      if (par.trim()) notes.appendChild(notebookEl('p', null, par.trim()));
    });
    inner.appendChild(notes);
  }

  // Recurring cards
  if (Array.isArray(p.recurring_cards) && p.recurring_cards.length) {
    inner.appendChild(notebookEl('div', 'notebook-eyebrow', 'The cards that keep finding you'));
    const row = notebookEl('div', 'notebook-cards');
    p.recurring_cards.forEach(rc => {
      const cell = notebookEl('div', 'notebook-card');
      if (rc.imageUrl) {
        const img = document.createElement('img');
        img.className = 'notebook-card-img';
        img.src = rc.imageUrl;
        img.alt = rc.card;
        cell.appendChild(img);
      } else {
        cell.appendChild(notebookEl('div', 'notebook-card-placeholder', '✦'));
      }
      cell.appendChild(notebookEl('div', 'notebook-card-name', `${rc.card} ×${rc.count}`));
      if (rc.note) cell.appendChild(notebookEl('div', 'notebook-card-note', rc.note));
      row.appendChild(cell);
    });
    inner.appendChild(row);
  }

  // Threads (tier 3)
  const threads = p.life_arc && Array.isArray(p.life_arc.key_threads) ? p.life_arc.key_threads : [];
  if (threads.length) {
    inner.appendChild(notebookEl('div', 'notebook-eyebrow', 'The threads'));
    const list = notebookEl('div', 'notebook-threads');
    const glyphs = { open: '○', moving: '◐', resolved: '●' };
    threads.forEach(t => {
      const status = String(t.status || 'open').toLowerCase();
      const line = notebookEl('div', null);
      line.appendChild(document.createTextNode(`${glyphs[status] || '○'} `));
      line.appendChild(notebookEl('span', `notebook-thread-status ${status}`, status));
      line.appendChild(document.createTextNode(` — ${t.theme}`));
      list.appendChild(line);
    });
    inner.appendChild(list);
  }

  // What keeps surfacing (tier 3)
  if (p.unresolved_thread || (p.life_arc && p.life_arc.inflection_points)) {
    const box = notebookEl('div', 'notebook-unresolved');
    box.appendChild(notebookEl('div', 'notebook-eyebrow', 'What keeps surfacing'));
    if (p.unresolved_thread) {
      box.appendChild(notebookEl('div', 'notebook-unresolved-text', p.unresolved_thread));
    }
    if (p.life_arc && p.life_arc.inflection_points) {
      box.appendChild(notebookEl('div', 'notebook-unresolved-text', p.life_arc.inflection_points));
    }
    inner.appendChild(box);
  }
}

const VERDICT_LABELS = {
  came_to_pass: 'came to pass',
  did_not:      "didn't come",
  partly:       'came in part',
};

function renderForetellings(inner, foretellings) {
  if (!Array.isArray(foretellings) || !foretellings.length) return;
  inner.appendChild(notebookEl('div', 'notebook-eyebrow', 'Foretellings'));
  const list = notebookEl('div', 'notebook-foretellings');
  foretellings.forEach(f => {
    const row = notebookEl('div', 'notebook-foretelling');
    if (f.outcome) row.appendChild(notebookEl('p', 'notebook-foretelling-outcome', f.outcome));
    if (f.foretelling) row.appendChild(notebookEl('p', 'notebook-foretelling-claim', `She foretold: ${f.foretelling}`));
    const label = VERDICT_LABELS[f.verdict];
    if (label) row.appendChild(notebookEl('div', `notebook-foretelling-verdict verdict-${f.verdict}`, label));
    list.appendChild(row);
  });
  inner.appendChild(list);
}

function notebookEscHandler(e) {
  if (e.key === 'Escape') closeNotebook();
}

function closeNotebook() {
  const overlay = document.getElementById('notebook-overlay');
  overlay.classList.remove('visible');
  document.body.style.overflow = '';
  document.removeEventListener('keydown', notebookEscHandler);
  setTimeout(() => overlay.classList.add('hidden'), 600);
}

// ── Reading Journal ──────────────────────────────────────────────────────────

let journalReadings = [];   // full history, newest first

// Resolve a saved journal card to a live card object so we can show its image.
// Newer readings store the card id directly; older ones only have the name,
// so fall back to a name match scoped to the reading's deck.
function resolveJournalCard(saved, deckKey) {
  if (saved.id) {
    const pools = deckKey === 'mixed' ? Object.values(allCards) : [allCards[deckKey] || []];
    for (const pool of pools) {
      const hit = pool.find(c => c.id === saved.id);
      if (hit) return hit;
    }
  }
  const name = (saved.name || '').toLowerCase();
  const searchPools = deckKey && deckKey !== 'mixed' && allCards[deckKey]
    ? [allCards[deckKey], ...Object.values(allCards)]
    : Object.values(allCards);
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
    const r = await fetch(`/api/readings?reader=${encodeURIComponent(currentReader.slug)}&limit=0`);
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
        body: JSON.stringify({ reader: currentReader.slug })
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
  ['tarot',         'Rider-Waite'],
  ['thoth',         'Thoth'],
  ['celtic-dragon', 'Celtic Dragon'],
  ['moonology',     'Moonology'],
  ['lenormand',     'Lenormand'],
  ['runic',         'Runes'],
  ['iching',        'I Ching'],
  ['oracle',        'My Oracle'],
];

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
      for (const c of (allCards[key] || [])) {
        const hay = [c.name, ...(c.keywords || []), c.chineseName || ''].join(' ').toLowerCase();
        if (hay.includes(query)) cards.push(c);
      }
    }
  } else {
    cards = allCards[grimoireDeck] || [];
  }

  if (!cards.length) {
    grid.appendChild(notebookEl('div', 'journal-empty', query
      ? 'No card answers to that. Try another word.'
      : 'This deck is still being unpacked.'));
    return;
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
    const r = await fetch(`/api/daily-card?reader=${encodeURIComponent(currentReader.slug)}`);
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

// ── Moon phase ───────────────────────────────────────────────────────────────

// Local computation — synodic month from a known new moon (2000-01-06 18:14 UTC)
const LUNAR_SYNODIC = 29.53058867; // mean synodic month in days
function moonPhaseInfo(date = new Date()) {
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

function renderHeaderMoon() {
  const el = document.getElementById('header-moon');
  if (!el) return;
  const { name, glyph, age } = moonPhaseInfo();
  el.textContent = `${glyph} ${name.toLowerCase()}`;
  el.title = `Moon age: ${age.toFixed(1)} days`;
}

function renderCosmosMoon() {
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

// ── Time-of-day greeting ──────────────────────────────────────────────────────

const GREETINGS = [
  // [startHour, endHour, headline, body]
  [5,  8,  'The world is still quiet.',
           'You\'ve come before the day has made its demands of you. There\'s something worth listening to in that stillness.'],
  [8,  12, 'Good morning.',
           'Something brought you to the cards at the start of your day. Let\'s see what wants your attention.'],
  [12, 17, 'The day is full around you.',
           'You\'ve paused in the middle of it. The cards have a way of cutting through the noise.'],
  [17, 21, 'The day is settling.',
           'A good time to look at what it\'s left behind — what carried through, what got lost, what still needs tending.'],
  [21, 24, 'The night has its own kind of clarity.',
           'Whatever brought you to the cards at this hour, I\'m here. Let\'s see what the cards have to say.'],
  [0,  5,  'You\'re awake when most aren\'t.',
           'Something is weighing on you, or calling to you from the edges of sleep. The cards are listening.'],
];

function getGreetingForHour(h) {
  return GREETINGS.find(([s, e]) => h >= s && h < e) || GREETINGS[1];
}

function dismissGreeting() {
  const panel = document.getElementById('greeting-panel');
  if (!panel || panel.classList.contains('greeting-gone')) return;
  panel.classList.add('greeting-gone');
  setTimeout(() => panel.remove(), 400);
}

async function checkThreshold() {
  // Don't intrude on a resumed in-progress session.
  if (drawnCards.length) return false;
  let data;
  try {
    const phase = document.body.dataset.time || '';
    const r = await fetch(`/api/threshold?reader=${encodeURIComponent(currentReader.slug)}&phase=${encodeURIComponent(phase)}`);
    if (!r.ok) return false;
    data = await r.json();
  } catch { return false; }
  if (!data || data.mode === 'none' || !data.greeting) return false;

  const overlay  = document.getElementById('threshold-overlay');
  const greetEl  = document.getElementById('threshold-greeting');
  const answerEl = document.getElementById('threshold-answer');
  const replyEl  = document.getElementById('threshold-reply');
  const contBtn  = document.getElementById('threshold-continue');
  const skipBtn  = document.getElementById('threshold-skip');
  if (!overlay) return false;

  greetEl.textContent = data.greeting;
  answerEl.value = '';
  answerEl.hidden = false;
  replyEl.hidden = true; replyEl.textContent = '';
  skipBtn.hidden = false;
  contBtn.textContent = 'Continue';
  contBtn.disabled = false;

  overlay.classList.remove('hidden');
  requestAnimationFrame(() => requestAnimationFrame(() => overlay.classList.add('visible')));

  const dismiss = () => {
    overlay.classList.remove('visible');
    overlay.addEventListener('transitionend', function done() {
      overlay.classList.add('hidden');
      overlay.removeEventListener('transitionend', done);
    }, { once: true });
  };

  return await new Promise(resolve => {
    let replied = false;
    skipBtn.onclick = () => { dismiss(); resolve(true); };
    contBtn.onclick = async () => {
      if (replied) { dismiss(); resolve(true); return; }     // second press = begin
      const answer = answerEl.value.trim();
      if (!answer) { dismiss(); resolve(true); return; }      // empty = skip
      contBtn.disabled = true; contBtn.textContent = 'Speaking…';
      let reply = '';
      try {
        const r = await fetch('/api/threshold/answer', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reader: currentReader.slug, answer, threadIds: data.threadIds }),
        });
        if (r.ok) reply = (await r.json()).reply || '';
      } catch {}
      replied = true;
      answerEl.hidden = true;
      skipBtn.hidden = true;
      if (reply) { replyEl.textContent = reply; replyEl.hidden = false; }
      contBtn.disabled = false; contBtn.textContent = 'Begin';
    };
  });
}

function buildGreeting() {
  // Don't show if already drawn into session
  if (drawnCards.length) return;

  const h = new Date().getHours();
  const [, , headline, body] = getGreetingForHour(h);
  const name = currentReader.name;

  const panel = document.createElement('div');
  panel.id = 'greeting-panel';
  panel.className = 'greeting-panel';

  const hl = document.createElement('div');
  hl.className = 'greeting-headline';
  hl.textContent = headline;

  const bd = document.createElement('div');
  bd.className = 'greeting-body';
  bd.textContent = body;

  const nameRow = document.createElement('div');
  nameRow.className = 'greeting-name-row';

  const nameLabel = document.createElement('label');
  nameLabel.className = 'greeting-name-label';
  nameLabel.textContent = 'Who am I reading for?';

  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.className = 'greeting-name-input';
  nameInput.value = name;
  nameInput.maxLength = 40;
  nameInput.spellcheck = false;
  nameInput.setAttribute('autocomplete', 'off');

  const beginBtn = document.createElement('button');
  beginBtn.className = 'greeting-begin-btn';
  beginBtn.textContent = 'Begin';

  nameRow.appendChild(nameLabel);
  nameRow.appendChild(nameInput);
  nameRow.appendChild(beginBtn);

  panel.appendChild(hl);
  panel.appendChild(bd);
  panel.appendChild(nameRow);

  // Insert at top of <main>, before resume panel and spread area
  const main = document.querySelector('main');
  main.insertBefore(panel, main.firstChild);

  const commit = async () => {
    const entered = nameInput.value.trim();
    if (entered && entered !== currentReader.name) {
      // Try to find an existing reader with this name
      try {
        const res = await fetch('/api/readers');
        if (res.ok) {
          const readers = await res.json();
          const match = readers.find(r => r.name.toLowerCase() === entered.toLowerCase());
          if (match) {
            switchReader(match);
          } else {
            // Create a new reader profile — show Miriel's intro before proceeding
            const cr = await fetch('/api/readers', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ name: entered })
            });
            if (cr.ok) {
              const newReader = await cr.json();
              switchReader(newReader);
              showMirielIntro(panel, entered);
              return;
            }
          }
        }
      } catch {}
    }
    dismissGreeting();
  };

  beginBtn.addEventListener('click', commit);
  nameInput.addEventListener('keydown', e => { if (e.key === 'Enter') commit(); });

  // Greeting fades when the user starts a reading anyway
  document.getElementById('draw-btn').addEventListener('click', dismissGreeting, { once: true });
}

function showMirielIntro(panel, readerName) {
  panel.innerHTML = '';

  const hl = document.createElement('div');
  hl.className = 'greeting-headline';
  hl.textContent = 'I am Miriel.';

  const bd = document.createElement('div');
  bd.className = 'greeting-body';
  bd.textContent = `I'm glad you're here, ${readerName}. Before we draw the first card — take a moment. Think about what you actually want to know. Not the surface question, but the one underneath it. When it comes into focus, we'll begin.`;

  const readyBtn = document.createElement('button');
  readyBtn.className = 'greeting-begin-btn';
  readyBtn.textContent = "I'm ready";
  readyBtn.addEventListener('click', dismissGreeting);

  panel.appendChild(hl);
  panel.appendChild(bd);
  panel.appendChild(readyBtn);
}

function getDeck() {
  if (currentDeck === 'mixed') {
    return [...allCards.tarot, ...allCards.thoth, ...allCards['celtic-dragon'], ...allCards.moonology, ...allCards.lenormand, ...allCards.runic, ...allCards.iching, ...allCards.oracle];
  }
  return [...(allCards[currentDeck] || [])];
}

// Identify which deck key a single card object belongs to
function cardDeckKey(card) {
  if (!card) return null;
  if (card.deckType === 'CelticDragon') return 'celtic-dragon';
  if (card.id && card.id.startsWith('cd-')) return 'celtic-dragon';
  if (card.deckType === 'Moonology') return 'moonology';
  if (card.deckType === 'Lenormand') return 'lenormand';
  if (card.deckType === 'Thoth') return 'thoth';
  if (card.deckType === 'Runic') return 'runic';
  if (card.deckType === 'IChing') return 'iching';
  if (card.arcana || card.suit) return 'tarot';
  return 'oracle';
}

// Return a shuffled pool from the same deck(s) as the cards actually on the table
function getClarifierPool() {
  if (!drawnCards.length) return getDeck();
  const key = cardDeckKey(drawnCards[0]);
  // If mixed reading, draw from whatever deck the first card came from
  const pool = allCards[key] || [];
  return shuffle([...pool]);
}

// Runes with symmetric shapes have no merkstave; Lenormand and I Ching skip reversals
const NON_REVERSIBLE_RUNES = new Set(['rune-07','rune-09','rune-11','rune-12','rune-16','rune-22','rune-23']);
function noReversal(card) {
  if (!card) return false;
  if (card.deckType === 'Lenormand' || card.deckType === 'IChing') return true;
  if (card.deckType === 'Runic' && NON_REVERSIBLE_RUNES.has(card.id)) return true;
  return false;
}

// ── Shuffling ────────────────────────────────────────────────────────────────
// Three layers of honesty:
//  1. cryptoRandom() — OS-level entropy, not Math.random()'s seeded PRNG
//  2. A persistent deck: each deck's order lives in localStorage between
//     readings. Draws don't conjure a fresh ordering for the question — they
//     riffle and cut the same deck you left on the table last time.
//  3. The riffles follow the Gilbert–Shannon–Reeds model of how physical
//     hands actually interleave cards; seven riffles is the classic threshold
//     for a fully mixed deck.

function cryptoRandom() {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0] / 4294967296;
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(cryptoRandom() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// One Gilbert–Shannon–Reeds riffle: binomial cut, then interleave packets
// with probability proportional to their remaining sizes.
function riffleOnce(cards) {
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

function cutDeck(cards) {
  if (cards.length < 2) return cards;
  const at = 1 + Math.floor(cryptoRandom() * (cards.length - 1));
  return [...cards.slice(at), ...cards.slice(0, at)];
}

// The living deck: restore this deck's persisted order, shuffle it the way
// hands would (seven riffles + a cut), persist the new order, hand it over.
function getShuffledDeck() {
  const cards = getDeck();
  if (!cards.length) return cards;
  const storageKey = `tarot-deck-order:${currentDeck}`;

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

// ── Archive ──────────────────────────────────────────────────────────────────

// Freeze the current reading in place as an archive block, then create a fresh
// active reading slot at the bottom of <main> so the next draw appears below.
function archiveCurrentReading() {
  const spreadArea = document.getElementById('spread-area');
  // Nothing to archive if no cards were drawn yet
  if (!spreadArea || !spreadArea.children.length) return;

  const main = document.querySelector('main');
  const ids = ['reader-note', 'theme-card-area', 'spread-area', 'meaning-panel'];
  const liveEls = ids.map(id => document.getElementById(id)).filter(Boolean);
  if (!liveEls.length) return;

  // Build archive wrapper at the live elements' position. We MOVE the live
  // elements (instead of cloning) so the archive stays where the reading
  // visually was, and the next active slot can be appended fresh below.
  const archive = document.createElement('div');
  archive.className = 'reading-archive';
  main.insertBefore(archive, liveEls[0]);
  liveEls.forEach(el => archive.appendChild(el));

  // Strip elements that were hidden when active. Their visibility relied on
  // #id.hidden CSS rules which no longer match once the id is gone, so they
  // would otherwise pop into view inside the archive.
  archive.querySelectorAll('.hidden').forEach(el => el.remove());
  // Strip interactive controls — listeners are stale and they're not usable here.
  archive.querySelectorAll('button, input, select, textarea').forEach(el => el.remove());
  // Strip ids so they don't collide with the freshly recreated active slot below.
  archive.querySelectorAll('[id]').forEach(el => el.removeAttribute('id'));

  // Divider marking the end of this archived reading.
  const divider = document.createElement('div');
  divider.className = 'reading-divider';
  divider.innerHTML = '<span class="reading-divider-ornament">✦ ✦ ✦</span>';
  archive.appendChild(divider);

  // Recreate the active slot at the END of <main> — new readings appear below.
  const wrapper = document.createElement('div');
  wrapper.innerHTML = ACTIVE_SLOT_TEMPLATE;
  while (wrapper.firstChild) main.appendChild(wrapper.firstChild);

  // Re-bind listeners that setupButtons() attached at init to the buttons that
  // have just been replaced.
  rebindActiveSlotListeners();

  // Keep session-summary-section pinned below the latest active reading.
  const summary = document.getElementById('session-summary-section');
  if (summary) main.appendChild(summary);
}

function rebindActiveSlotListeners() {
  document.getElementById('ask-claude-btn').addEventListener('click', askClaude);
  document.getElementById('export-reading-btn').addEventListener('click', exportCurrentReading);
  document.getElementById('copy-reading-btn').addEventListener('click', copyReadingText);
  document.getElementById('share-image-btn').addEventListener('click', exportReadingAsImage);
}

function scrollToNewReading() {
  const note = document.getElementById('reader-note');
  const target = note || document.getElementById('spread-area');
  if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

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

const MIRIEL_DECKS = ['tarot', 'thoth', 'celtic-dragon', 'moonology', 'lenormand', 'runic', 'iching', 'oracle', 'mixed'];

function mirielPickDeck() {
  const pick = MIRIEL_DECKS[Math.floor(cryptoRandom() * MIRIEL_DECKS.length)];
  const sel = document.getElementById('deck-select');
  if (sel) sel.value = pick;
  currentDeck = pick;
}

function showMirielTakeover(onComplete) {
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

function launchMirielsChoice() {
  showMirielTakeover(() => {
    mirielPickDeck();
    currentSpread = 'reader-choice';
    manualMode = false;
    drawCards();
  });
}

// A "thinking" beat that reuses the takeover overlay but stays up for as long as
// the caller needs (unlike showMirielTakeover's fixed hold). Pair with
// hideThinkingTakeover() once the work is done.
function showThinkingTakeover(line) {
  const overlay = document.getElementById('miriel-takeover');
  const textEl  = document.getElementById('miriel-takeover-text');
  if (!overlay || !textEl) return;
  textEl.textContent = line;
  overlay.classList.remove('hidden');
  requestAnimationFrame(() => {
    requestAnimationFrame(() => overlay.classList.add('visible'));
  });
}

function hideThinkingTakeover() {
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

// ── Draw ────────────────────────────────────────────────────────────────────

function drawCards() {
  dismissGreeting();
  document.getElementById('resume-panel').classList.add('hidden');
  if (manualMode) {
    themeCard = null;
    archiveCurrentReading();
    showManualForm();
    scrollToNewReading();
    return;
  }
  if (currentSpread === 'reader-choice') {
    drawWithReaderChoice();
    return;
  }
  if (currentSpread === 'compatibility' && (!compatPersonA || !compatPersonB)) {
    document.getElementById('compat-modal').classList.remove('hidden');
    return;
  }
  archiveCurrentReading();
  document.getElementById('reader-note').classList.add('hidden');
  const spreadDef = (SPREADS[currentSpread] && SPREADS[currentSpread].slots) || SPREADS['single'].slots;
  const deck = getShuffledDeck();
  // NOTE: isReversed (boolean) is separate from card.reversed (text meaning)
  // Lenormand and I Ching do not use reversals; some runes are non-reversible
  drawnCards = spreadDef.map((slot, i) => ({
    ...deck[i],
    isReversed: noReversal(deck[i]) ? false : cryptoRandom() < 0.3,
    positionLabel: slot.label,
    position: slot.position
  }));

  // Bottom-of-deck card = overall theme (random mode only)
  const bottomCard = deck[deck.length - 1];
  themeCard = { ...bottomCard, isReversed: cryptoRandom() < 0.3, positionLabel: 'Overall Theme', position: 'theme' };

  cancelRevealTimers();
  dealToken++;
  dealAnimActive = true;
  window.__asyncDeal = true;
  renderSpread();
  window.__asyncDeal = false;
  renderThemeCard();
  hideMeaningPanel();
  scrollToNewReading();
  dealAndReveal();
}

async function drawWithReaderChoice() {
  const drawBtn = document.getElementById('draw-btn');

  // Snapshot deck NOW (before any awaits) so async phase-1 fetch can't race
  // against a deck-select change. Also re-sync from DOM in case resumeReading()
  // set currentDeck after the user last changed the dropdown.
  currentDeck = document.getElementById('deck-select').value || currentDeck;
  const snapshotDeck = currentDeck;

  // Archive the current reading BEFORE clearing the spread, so the archive
  // captures actual cards rather than the loading placeholder. This may also
  // recreate the active slot at the bottom of <main>, so refs to #reader-note
  // and #spread-area must be taken AFTER this call.
  archiveCurrentReading();

  const noteEl     = document.getElementById('reader-note');
  const spreadArea = document.getElementById('spread-area');

  drawBtn.disabled = true;
  drawBtn.textContent = 'Consulting the cards\u2026';
  spreadArea.className = 'spread-area';
  spreadArea.innerHTML = '<div class="reader-choice-loading">' +
    '<div class="mini-shuffle"><i></i><i></i><i></i></div>' +
    '<span class="loading">Miriel is reading your question</span></div>';
  noteEl.classList.add('hidden');

  // ── Phase 1: ask for a spread suggestion (failure always falls back gracefully) ──
  let chosenSpread = 'three-card';
  let chosenReason = '';

  try {
    const res = await fetch('/api/suggest-spread', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: currentQuestion, moonPhase: moonPhaseInfo().name })
    });

    if (res.ok) {
      const data = await res.json();
      if (data.spread && SPREADS[data.spread]) {
        chosenSpread = data.spread;
        chosenReason = data.reason || '';
      } else if (data.error) {
        console.warn('[tarot] suggest-spread error:', data.error);
      }
    } else {
      console.warn('[tarot] suggest-spread HTTP', res.status, '— server may need restarting');
    }
  } catch (err) {
    console.warn('[tarot] suggest-spread fetch failed:', err.message);
  }

  // ── Phase 2: draw cards — this always runs regardless of phase 1 outcome ──
  try {
    currentSpread = chosenSpread;
    if (SPREADS[chosenSpread]) activateTab(SPREADS[chosenSpread].category);

    // Highlight chosen spread in the dropdown
    const spreadSel = document.getElementById('spread-select');
    if (spreadSel) {
      spreadSel.value = chosenSpread;
      currentSpread = spreadSel.value || currentSpread;
    }

    // Show the reader's note
    const spreadNames = {
      'single': 'Single Card', 'three-card': 'Three-Card',
      'four-card': 'Four-Card', 'five-card': 'Five-Card',
      'six-card': 'Six-Card', 'nine-card': 'Nine-Card', 'celtic': 'Celtic Cross'
    };
    noteEl.innerHTML = `<span class="reader-note-label">${spreadNames[chosenSpread] || (SPREADS[chosenSpread] && SPREADS[chosenSpread].label) || chosenSpread}</span>${chosenReason ? ' \u2014 ' + chosenReason : ''}`;
    noteEl.classList.remove('hidden');
    scrollToNewReading();

    // Brief pause so the user can read the note before cards appear
    await new Promise(r => setTimeout(r, 1100));

    const spreadDef = (SPREADS[currentSpread] && SPREADS[currentSpread].slots) || SPREADS['single'].slots;
    // Use snapshotDeck (captured before phase-1 await) so deck-select changes
    // during the network call don't silently swap decks.
    currentDeck = snapshotDeck;
    const deck = getShuffledDeck();
    drawnCards = spreadDef.map((slot, i) => ({
      ...deck[i],
      isReversed: noReversal(deck[i]) ? false : cryptoRandom() < 0.3,
      positionLabel: slot.label,
      position: slot.position
    }));

    const bottomCard = deck[deck.length - 1];
    themeCard = { ...bottomCard, isReversed: cryptoRandom() < 0.3, positionLabel: 'Overall Theme', position: 'theme' };

    cancelRevealTimers();
    dealToken++;
    dealAnimActive = true;
    window.__asyncDeal = true;
    renderSpread();
    window.__asyncDeal = false;
    renderThemeCard();
    hideMeaningPanel();
    noteEl.classList.remove('hidden');
    dealAndReveal();

  } catch (err) {
    console.error('[tarot] drawWithReaderChoice draw error:', err);
    spreadArea.innerHTML = '<p style="text-align:center;color:var(--text-dim);padding:2rem 1rem">Something went wrong — try again.</p>';
  } finally {
    drawBtn.disabled = false;
    drawBtn.textContent = 'Lay the Cards';
  }
}

function cancelRevealTimers() {
  revealTimers.forEach(t => clearTimeout(t));
  revealTimers = [];
}

// JS-sequenced paced deal for auto draws. onCard(i) may return a Promise to pause
// the deal after card i is laid; defaults to curiosityPauseForCard when omitted.
let pendingCuriosity = [];   // [{cardId, question, threadIds}] detected for the current deal
let curiosityAnswers = [];   // [{question, answer, threadIds}] collected during the deal

function curiosityPauseForCard(cardIndex) {
  const card = drawnCards[cardIndex];
  const trigger = card && pendingCuriosity.find(q => q.cardId === (card.id || ''));
  if (!trigger) return null;
  return new Promise(resolve => {
    const containers = document.querySelectorAll('#spread-area .card-container');
    const el      = containers[cardIndex];
    const area    = document.getElementById('spread-area');
    const panel   = document.getElementById('curiosity-panel');
    const qEl     = document.getElementById('curiosity-q');
    const eyebrow = document.getElementById('curiosity-eyebrow');
    const answerEl = document.getElementById('curiosity-answer');
    const answerBtn = document.getElementById('curiosity-answer-btn');
    const skipBtn   = document.getElementById('curiosity-skip');
    if (!el || !panel) { resolve(); return; }

    if (area) area.classList.add('curiosity-dim');
    el.classList.add('curiosity-focus');
    eyebrow.textContent = `☾  she lingers on ${card.name}`;
    qEl.textContent = trigger.question;
    answerEl.value = '';
    answerEl.hidden = false;
    answerBtn.disabled = false;
    answerBtn.textContent = 'Answer';
    // place the panel right after the spread so it reads as attached to it
    if (area && area.parentNode) area.parentNode.insertBefore(panel, area.nextSibling);
    panel.classList.remove('hidden');
    requestAnimationFrame(() => panel.classList.add('visible'));

    const started = Date.now();
    const finish = (answer) => {
      if (answer && answer.trim()) {
        curiosityAnswers.push({ question: trigger.question, answer: answer.trim(), threadIds: trigger.threadIds });
      }
      panel.classList.remove('visible');
      el.classList.remove('curiosity-focus');
      if (area) area.classList.remove('curiosity-dim');
      setTimeout(() => panel.classList.add('hidden'), 500);
      resolve();
    };
    // enforce a ~3.2s minimum glow even if the user is instant, so it reads as a real beat
    const guard = (answer) => {
      answerBtn.disabled = true;
      const wait = Math.max(0, 3200 - (Date.now() - started));
      setTimeout(() => finish(answer), wait);
    };
    answerBtn.onclick = () => guard(answerEl.value);
    skipBtn.onclick   = () => guard('');
  });
}

async function dealAndReveal(onCard) {
  const myToken = dealToken;
  const n = drawnCards.length;
  const per = dealPaceMs(n);

  // Detect curiosity during the shuffle beat (fires only if the reader has open threads).
  pendingCuriosity = [];
  curiosityAnswers = [];
  const detectP = (async () => {
    try {
      const r = await fetch('/api/reading-questions', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reader: currentReader.slug,
          cards: drawnCards.map(c => ({ id: c.id || '', name: c.name, position: c.positionLabel || '', isReversed: !!c.isReversed })),
        }),
      });
      if (r.ok && dealToken === myToken) pendingCuriosity = (await r.json()).questions || [];
    } catch {}
  })();

  await sleep(SHUFFLE_MS);
  await detectP;
  if (dealToken !== myToken) return;

  for (let i = 0; i < n; i++) {
    if (dealToken !== myToken) return;            // a new draw superseded this one
    const containers = document.querySelectorAll('#spread-area .card-container');
    const el = containers[i];
    if (el && el.dealNow) el.dealNow();
    setTimeout(() => { if (dealToken === myToken) showMeaning(i); }, DEAL_FLIP_DELAY + 250);
    const hook = onCard || curiosityPauseForCard;
    const maybePause = hook(i);
    if (maybePause && typeof maybePause.then === 'function') await maybePause;
    await sleep(jittered(per));
  }
  if (dealToken !== myToken) return;
  if (themeCard) showThemeMeaning();
  await sleep(900);
  if (dealToken !== myToken) return;
  askClaude();
}

// After cards flip, automatically reveal each meaning then trigger Claude
function autoReveal() {
  const n = drawnCards.length;
  // Theme card flips at 100ms; reveal its meaning at 800ms
  if (themeCard) {
    const t = setTimeout(() => showThemeMeaning(), 800);
    revealTimers.push(t);
  }
  // Show meaning after each card's flip completes (timing depends on whether deal anim ran)
  drawnCards.forEach((_, i) => {
    const flipDone = lastRenderDealt
      ? SHUFFLE_MS + i * DEAL_INTERVAL + DEAL_FLIP_DELAY + 700
      : 300 + i * 150 + 700;
    const t = setTimeout(() => showMeaning(i), flipDone);
    revealTimers.push(t);
  });
  // Start Claude after all meanings visible + short pause
  const lastFlip = lastRenderDealt
    ? SHUFFLE_MS + (n - 1) * DEAL_INTERVAL + DEAL_FLIP_DELAY
    : 300 + (n - 1) * 150;
  const claudeDelay = lastFlip + 1300;
  const t = setTimeout(() => askClaude(), claudeDelay);
  revealTimers.push(t);
}

// ── Manual entry ─────────────────────────────────────────────────────────────

function buildSelectOptions() {
  const frag = document.createDocumentFragment();
  const blank = document.createElement('option');
  blank.value = '';
  blank.textContent = '— Name your card —';
  frag.appendChild(blank);

  const groups = [
    { label: 'Rider-Waite Tarot',   cards: allCards.tarot },
    { label: 'Thoth Tarot',         cards: allCards.thoth },
    { label: 'Celtic Dragon Tarot', cards: allCards['celtic-dragon'] },
    { label: 'Moonology Oracle',    cards: allCards.moonology },
    { label: 'Lenormand Oracle',    cards: allCards.lenormand },
    { label: 'Elder Futhark Runes', cards: allCards.runic },
    { label: 'I Ching',             cards: allCards.iching },
    { label: 'My Oracle',           cards: allCards.oracle }
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

function showManualForm() {
  const area = document.getElementById('spread-area');
  area.className = 'spread-area';
  cancelRevealTimers();
  hideMeaningPanel();

  const spreadSlots = (SPREADS[currentSpread] && SPREADS[currentSpread].slots) || SPREADS['single'].slots;
  const isFlexible = currentSpread === 'single'; // single allows any card count

  const form = document.createElement('div');
  form.className = 'manual-form';

  const hint = document.createElement('div');
  hint.className = 'manual-form-title';
  hint.textContent = `Name the cards before you${spreadSlots.length > 1 ? ` — ${spreadSlots.length}-card spread` : ''}, from any deck`;
  form.appendChild(hint);

  const selects = [];
  const checks = [];

  spreadSlots.forEach(slot => {
    const row = document.createElement('div');
    row.className = 'manual-row';

    const lbl = document.createElement('span');
    lbl.className = 'manual-label';
    lbl.textContent = slot.label;

    const sel = document.createElement('select');
    sel.className = 'manual-select';
    sel.appendChild(buildSelectOptions());
    selects.push(sel);

    const revLabel = document.createElement('label');
    revLabel.className = 'manual-rev-label';
    const revCheck = document.createElement('input');
    revCheck.type = 'checkbox';
    revCheck.className = 'manual-rev-check';
    checks.push(revCheck);
    revLabel.appendChild(revCheck);
    revLabel.append(' Rev');

    row.appendChild(lbl);
    row.appendChild(sel);
    row.appendChild(revLabel);
    form.appendChild(row);
  });

  const submitBtn = document.createElement('button');
  submitBtn.className = 'draw-btn';
  submitBtn.style.marginTop = '0.5rem';
  submitBtn.textContent = 'Begin the Reading';
  submitBtn.addEventListener('click', () => submitManualCards(selects, checks, spreadSlots));
  form.appendChild(submitBtn);

  area.innerHTML = '';
  area.appendChild(form);
}

function findCardById(id) {
  return [
    ...allCards.tarot, ...allCards.thoth, ...allCards['celtic-dragon'],
    ...allCards.moonology, ...allCards.lenormand,
    ...allCards.runic, ...allCards.iching, ...allCards.oracle
  ].find(c => c.id === id);
}

function findCardByName(name) {
  return [
    ...allCards.tarot, ...allCards.thoth, ...allCards['celtic-dragon'],
    ...allCards.moonology, ...allCards.lenormand,
    ...allCards.runic, ...allCards.iching, ...allCards.oracle
  ].find(c => c.name === name);
}

// ── Resume prior session ─────────────────────────────────────────────────────

async function checkForPriorSession() {
  // Hide any existing banner before checking for the new reader's history
  document.getElementById('resume-panel').classList.add('hidden');
  try {
    const r = await fetch(`/api/readings?reader=${encodeURIComponent(currentReader.slug)}`);
    if (!r.ok) return;
    const readings = await r.json();
    if (!readings.length) return;
    showResumeBanner(readings[readings.length - 1]);
  } catch (err) {
    console.error('[tarot] checkForPriorSession error:', err);
  }
}

function showResumeBanner(reading) {
  document.getElementById('resume-date').textContent = reading.date || '';
  document.getElementById('resume-meta').textContent =
    [reading.deckLabel || reading.deck, reading.spread].filter(Boolean).join(' · ');

  const qEl = document.getElementById('resume-question');
  qEl.textContent = reading.question ? `"${reading.question}"` : '';
  qEl.classList.toggle('hidden', !reading.question);

  document.getElementById('resume-cards').textContent =
    (reading.cards || []).map(c => `${c.position ? c.position + ': ' : ''}${c.name}${c.isReversed ? ' (rev)' : ''}`).join(' · ');

  const panel = document.getElementById('resume-panel');
  panel.classList.remove('hidden');

  document.getElementById('resume-btn').addEventListener('click', () => {
    panel.classList.add('hidden');
    resumeReading(reading);
  });

  document.getElementById('resume-dismiss-btn').addEventListener('click', () => {
    panel.classList.add('hidden');
  });
}

function resumeReading(reading) {
  const spreadKeyByLabel = Object.fromEntries(
    Object.entries(SPREADS).map(([key, s]) => [s.label, key])
  );
  // Legacy label aliases for readings saved before this refactor
  const legacyAliases = {
    'Single Card': 'single', 'Three-Card': 'three-card',
    'Four-Card': 'four-card', 'Five-Card': 'five-card',
    'Six-Card': 'six-card', 'Nine-Card': 'nine-card',
    'Celtic Cross': 'celtic', 'Compatibility': 'compatibility'
  };

  // Restore settings
  currentDeck     = reading.deck || 'tarot';
  currentSpread   = spreadKeyByLabel[reading.spread] || legacyAliases[reading.spread] || 'single';
  currentQuestion = reading.question || '';

  document.getElementById('deck-select').value    = currentDeck;
  document.getElementById('question-input').value = currentQuestion;
  const spreadSel = document.getElementById('spread-select');
  if (spreadSel && SPREADS[currentSpread]) {
    activateTab(SPREADS[currentSpread].category);
  }

  // Rebuild drawnCards — look up full card objects by name
  const spreadDef = (SPREADS[currentSpread] && SPREADS[currentSpread].slots) || [];
  drawnCards = (reading.cards || []).map((hCard, i) => {
    const cardObj = findCardByName(hCard.name) || {};
    return {
      ...cardObj,
      name:          hCard.name,
      isReversed:    hCard.isReversed,
      positionLabel: hCard.position || (spreadDef[i] ? spreadDef[i].label : ''),
      position:      spreadDef[i] ? spreadDef[i].position : ''
    };
  });

  themeCard = null; // resumed readings don't restore the theme card
  cancelRevealTimers();
  dealAnimActive = false;
  renderSpread();
  renderThemeCard();
  hideMeaningPanel();

  // Reveal each card meaning with the same stagger as a live draw
  const n = drawnCards.length;
  drawnCards.forEach((_, i) => {
    const t = setTimeout(() => showMeaning(i), 300 + i * 150 + 700);
    revealTimers.push(t);
  });

  // After meanings are visible, restore the saved synopsis (no API call)
  if (reading.synopsis) {
    const synopsisDelay = 300 + (n - 1) * 150 + 700 + 500;
    const t = setTimeout(() => {
      const responseDiv  = document.getElementById('claude-response');
      const synopsisDiv  = document.getElementById('overall-synopsis');
      const synopsisText = document.getElementById('synopsis-text');
      const btn          = document.getElementById('ask-claude-btn');

      responseDiv.classList.remove('hidden');
      synopsisDiv.classList.remove('hidden');
      synopsisText.textContent = reading.synopsis;

      btn.textContent = '✨ Read again';
      btn.disabled    = false;

      lastReadingContext = {
        originalCards: drawnCards.map(c => ({
          name:         c.name,
          position:     c.positionLabel || '',
          isReversed:   c.isReversed,
          meaning:      c.isReversed ? c.reversed : c.upright,
          keywords:     (c.keywords || []).join(', '),
          element:      c.element || '',
          astro:        c.astro || '',
          numerology:   c.numerology || '',
          shadow:       c.shadow || '',
          waite:        c.waite || '',
          celtic_lore:  c.celtic_lore || '',
          lunar_phase:  c.lunar_phase || '',
          lore:         c.lore || '',
          combinations: c.combinations || ''
        })),
        synopsis: reading.synopsis,
        question:  currentQuestion
      };

      showContinueReading();
    }, synopsisDelay);
    revealTimers.push(t);
  }
}

function submitManualCards(selects, checks, spreadSlots) {
  const entries = selects.map((sel, i) => ({
    id: sel.value,
    isReversed: checks[i].checked,
    slot: spreadSlots[i]
  })).filter(s => s.id !== '');

  if (entries.length === 0) { selects[0].focus(); return; }

  drawnCards = entries.map(s => ({
    ...findCardById(s.id),
    isReversed: s.isReversed,
    positionLabel: s.slot.label,
    position: s.slot.position
  }));

  themeCard = null; // no bottom-of-deck in manual mode
  cancelRevealTimers();
  dealAnimActive = false;
  renderSpread();
  renderThemeCard();
  hideMeaningPanel();
  autoReveal();
}

// ── Render ───────────────────────────────────────────────────────────────────

function renderSpread() {
  const area = document.getElementById('spread-area');
  area.innerHTML = '';

  lastRenderDealt = dealAnimActive;
  dealAnimActive  = false; // consume immediately — only this render uses it

  if (lastRenderDealt) {
    const isRunic = drawnCards[0] && drawnCards[0].deckType === 'Runic';

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

      drawnCards.forEach((_, i) => {
        setTimeout(() => {
          pouch.classList.remove('tossing');
          void pouch.offsetWidth; // restart the toss animation
          pouch.classList.add('tossing');
        }, SHUFFLE_MS + i * DEAL_INTERVAL);
      });
      setTimeout(() => {
        pouch.style.opacity = '0';
        setTimeout(() => pouch.remove(), 350);
      }, SHUFFLE_MS + drawnCards.length * DEAL_INTERVAL + 200);

    } else {
      const pile = document.createElement('div');
      pile.className = 'spread-pile shuffling';
      for (let j = drawnCards.length - 1; j >= 0; j--) {
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

      drawnCards.forEach((_, i) => {
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

  const layout = SPREAD_LAYOUTS[currentSpread];

  if (layout) {
    area.className = `spread-area ${layout.gridClass}`;
    drawnCards.forEach((card, i) => {
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
    drawnCards.forEach((card, i) => {
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

function renderThemeCard() {
  const area = document.getElementById('theme-card-area');
  if (!themeCard) {
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

  const cardEl = makeThemeCardEl(themeCard);
  area.appendChild(cardEl);
}

// Runes and I Ching pieces are physical objects (stones, coins), not cards —
// they have no back and always land face up. Only carded decks flip.
function isAlwaysFaceUp(card) {
  return card.deckType === 'Runic' || card.deckType === 'IChing';
}

function makeThemeCardEl(card) {
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

function showThemeMeaning() {
  if (!themeCard) return;
  const area = document.getElementById('theme-card-area');
  if (area.querySelector('.theme-meaning')) return; // already shown

  const meaningDiv = document.createElement('div');
  meaningDiv.className = 'theme-meaning';
  meaningDiv.innerHTML = `
    <div class="theme-meaning-name">${themeCard.name}${themeCard.isReversed ? ' <span class="theme-reversed">(Reversed)</span>' : ''}</div>
    <div class="theme-meaning-keywords">${(themeCard.keywords || []).join(' · ')}</div>
    <div class="theme-meaning-text">${themeCard.isReversed ? themeCard.reversed : themeCard.upright}</div>
  `;
  area.appendChild(meaningDiv);
}

// Populate a card face element — uses an image if one exists in the manifest,
// otherwise falls back to the styled text display.
function cardBackUrl(card) {
  if (card && card.deckType === 'Moonology') {
    return '/images/moonology/card%20back%204.jpg';
  }
  if (card && card.deckType === 'CelticDragon') {
    return '/images/celtic-dragon/card%20backing.png';
  }
  if (card && card.deckType === 'Runic') {
    return '/images/runic/card-back.svg';
  }
  if (card && card.deckType === 'IChing') {
    return '/images/iching/card-back.jpg';
  }
  return '/images/tarot/card-back.jpg';
}

function buildCardFace(face, card, arcanaLabel) {
  const deckKey = card.deckType === 'Moonology'  ? 'moonology' :
                  card.deckType === 'Lenormand'  ? null :
                  card.deckType === 'Thoth'      ? 'thoth' :
                  card.deckType === 'Runic'      ? 'runic' :
                  card.deckType === 'IChing'     ? 'iching' :
                  card.deckType === 'CelticDragon' ? 'celtic-dragon' :
                  (card.id && card.id.startsWith('cd-')) ? 'celtic-dragon' :
                  (!card.arcana && !card.suit) ? 'oracle' :
                  card.arcana ? 'tarot' : null;
  const imgSrc  = deckKey && imageManifest[deckKey] && imageManifest[deckKey][card.id];

  if (imgSrc) {
    face.classList.add('has-image');
    if (card.deckType === 'Runic') face.classList.add('rune-stone');
    if (card.deckType === 'IChing') face.classList.add('iching-hex');
    const img = document.createElement('img');
    img.className = 'card-image';
    img.alt = card.name;
    img.src = imgSrc;
    img.onerror = () => {
      // Image file missing or broken — fall back to text
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

function cardTextHTML(card, arcanaLabel) {
  return `
    <div class="card-symbol">${card.symbol || '✦'}</div>
    <div class="card-name">${card.name}</div>
    <div class="card-arcana">${arcanaLabel}</div>
    ${card.isReversed ? '<div class="card-reversed-badge">Reversed</div>' : ''}
  `;
}

function makeCardEl(card, index) {
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

// ── Meaning panel ────────────────────────────────────────────────────────────

function showMeaning(index) {
  const panel = document.getElementById('meaning-panel');
  const content = document.getElementById('meaning-content');

  const card = drawnCards[index];
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

function hideMeaningPanel() {
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
  lastReadingContext = null;
  lastSynopsis = '';
  const exportBtn = document.getElementById('export-reading-btn');
  if (exportBtn) exportBtn.classList.add('hidden');
  document.getElementById('copy-reading-btn')?.classList.add('hidden');
  document.getElementById('share-image-btn')?.classList.add('hidden');
  const btn = document.getElementById('ask-claude-btn');
  btn.disabled = false;
  btn.textContent = '✨ Open the reading';
}

// ── Reading history ───────────────────────────────────────────────────────────

async function fetchPriorReadings() {
  try {
    const r = await fetch(`/api/readings?reader=${encodeURIComponent(currentReader.slug)}`);
    if (r.ok) return await r.json();
  } catch {}
  return [];
}

async function saveReading(synopsisText) {
  const date = new Date().toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  });
  const deckLabels = {
    tarot: 'Rider-Waite Tarot', 'celtic-dragon': 'Celtic Dragon Tarot',
    moonology: 'Moonology Oracle', lenormand: 'Lenormand Oracle',
    thoth: 'Thoth Tarot', runic: 'Elder Futhark Runes',
    iching: 'I Ching', oracle: 'My Oracle', mixed: 'All Decks'
  };
  const spreadLabels = Object.fromEntries(
    Object.entries(SPREADS).map(([key, s]) => [key, s.label])
  );
  const entry = {
    date,
    timestamp: Date.now(),
    reader: currentReader.slug,
    deck: currentDeck,
    deckLabel: deckLabels[currentDeck] || currentDeck,
    spread: spreadLabels[currentSpread] || currentSpread,
    question: currentQuestion || '',
    cards: drawnCards.map(c => ({
      id: c.id || undefined,
      deckType: c.deckType || undefined,
      name: c.name,
      position: c.positionLabel || '',
      isReversed: c.isReversed
    })),
    synopsis: synopsisText || ''
  };
  try {
    const r = await fetch('/api/readings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(entry)
    });
    if (!r.ok) console.error('[tarot] save failed:', r.status, await r.text());
  } catch (err) {
    console.error('[tarot] save error:', err);
  }
}

// ── Claude reading ───────────────────────────────────────────────────────────

async function askClaude() {
  if (!drawnCards.length) return;

  const btn = document.getElementById('ask-claude-btn');
  // Don't fire if already in progress
  if (btn.disabled) return;

  btn.disabled = true;
  btn.textContent = 'The cards are speaking…';

  const responseDiv   = document.getElementById('claude-response');
  const reflDiv       = document.getElementById('card-reflections');
  const synopsisDiv   = document.getElementById('overall-synopsis');
  const reflText      = document.getElementById('reflections-text');
  const synopsisText  = document.getElementById('synopsis-text');

  responseDiv.classList.remove('hidden');
  reflDiv.classList.add('hidden');
  synopsisDiv.classList.add('hidden');
  reflText.textContent = '';
  synopsisText.innerHTML = '<span class="loading">Listening to the cards</span>';
  synopsisDiv.classList.remove('hidden');

  // Cinematic "thinking" beat while she reads — stays up until the interpretation
  // is ready (min 1.8s so a fast response doesn't flash), then fades to reveal it.
  showThinkingTakeover('Miriel sits with your cards for a moment…');
  const minHold = new Promise(r => setTimeout(r, 1800));
  const reveal = async (render) => {
    await minHold;
    await hideThinkingTakeover();
    render();
  };

  const priorReadings = await fetchPriorReadings();

  const payload = {
    spread_type: currentSpread,
    question: currentQuestion,
    cards: drawnCards.map(c => ({
      name: c.name,
      position: c.positionLabel || c.position || '',
      isReversed: c.isReversed,
      meaning: c.isReversed ? c.reversed : c.upright,
      keywords: (c.keywords || []).join(', '),
      element: c.element || '',
      astro: c.astro || '',
      numerology: c.numerology || '',
      shadow: c.shadow || '',
      waite: c.waite || '',
      celtic_lore: c.celtic_lore || '',
      lunar_phase: c.lunar_phase || '',
      lore: c.lore || '',
      combinations: c.combinations || '',
      kabbala:      c.kabbala || '',
      aett:         c.aett || '',
      trigrams:     c.trigrams || null,
      chineseName:  c.chineseName || ''
    })),
    themeCard: themeCard ? {
      name: themeCard.name,
      isReversed: themeCard.isReversed,
      meaning: themeCard.isReversed ? themeCard.reversed : themeCard.upright,
      keywords: (themeCard.keywords || []).join(', '),
      element: themeCard.element || '',
      astro: themeCard.astro || ''
    } : null,
    priorReadings,
    readerName: currentReader.name,
    moonPhase: moonPhaseInfo().name,
    curiosityAnswers: curiosityAnswers,
  };

  const isCompatibility = currentSpread === 'compatibility';
  if (isCompatibility && compatPersonA && compatPersonB) {
    payload.personA = compatPersonA;
    payload.personB = compatPersonB;
  }

  try {
    const endpoint = isCompatibility ? '/api/compatibility' : '/api/interpret';
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await res.json();

    if (data.error) {
      if (data.error === 'NO_KEY') {
        synopsisText.innerHTML = '<em>The oracle is silent — no API key found. Click ⚙ to add your Anthropic key.</em>';
        document.getElementById('settings-btn').classList.add('settings-needs-key');
      } else {
        synopsisText.textContent = 'Error: ' + data.error;
      }
      btn.disabled = false;
      btn.textContent = '✨ Try once more';
      await minHold;
      await hideThinkingTakeover();
      return;
    }

    // Parse the two-section response
    const raw = data.interpretation;
    const { reflections, synopsis, clarifier } = parseReading(raw);

    synopsisText.textContent = '';

    // Save context for potential clarifier call
    const synopsisForContext = synopsis || raw;
    lastReadingContext = {
      originalCards: payload.cards,
      synopsis: synopsisForContext,
      question: currentQuestion
    };

    // Persist this reading to history (fire and forget)
    saveReading(synopsisForContext);

    // Track for session summary (include id + deckType for image lookup in save doc)
    sessionReadings.push({
      spread: payload.spread_type,
      question: currentQuestion,
      cards: drawnCards.map(c => ({
        name: c.name,
        position: c.positionLabel || c.position || '',
        isReversed: c.isReversed,
        id: c.id,
        deckType: c.deckType
      })),
      reflections: reflections || null,
      synopsis: synopsisForContext,
      clarifiers: []
    });

    const afterSynopsis = (finalText) => {
      lastSynopsis = finalText || '';
      if (clarifier.text) showClarifierPrompt(clarifier.text, clarifier.suggestsSpread);
      showContinueReading();
      const exportBtn = document.getElementById('export-reading-btn');
      if (exportBtn) exportBtn.classList.remove('hidden');
      document.getElementById('copy-reading-btn')?.classList.remove('hidden');
      document.getElementById('share-image-btn')?.classList.remove('hidden');
    };

    await reveal(() => {
      if (reflections && drawnCards.length > 1) {
        reflText.textContent = '';
        reflDiv.classList.remove('hidden');
        typewriterInto(reflText, reflections, 25, () => {
          typewriterInto(synopsisText, synopsis, 30, () => afterSynopsis(synopsis));
        });
      } else {
        const finalText = synopsis || raw;
        typewriterInto(synopsisText, finalText, 30, () => afterSynopsis(finalText));
      }
      btn.textContent = '✨ Read again';
      btn.disabled = false;
    });
  } catch (err) {
    await minHold;
    await hideThinkingTakeover();
    synopsisText.textContent = 'Network error: ' + err.message;
    btn.disabled = false;
    btn.textContent = '✨ Try once more';
  }
}

// Strip the [SINGLE] or [SPREAD] tag Claude appends to clarifier suggestions
function parseClarifierTag(raw) {
  if (!raw) return { text: null, suggestsSpread: false };
  const match = raw.match(/\[(SINGLE|SPREAD)\]\s*$/i);
  return {
    text: raw.replace(/\[(SINGLE|SPREAD)\]\s*$/i, '').trim(),
    suggestsSpread: !!(match && match[1].toUpperCase() === 'SPREAD')
  };
}

// Split Claude's response at ||| separators into up to 3 sections
function parseReading(text) {
  const parts = text.split(/\n\s*\|\|\|\s*\n/);
  if (parts.length >= 3) {
    // multi-card: reflections ||| synopsis ||| clarifier
    return { reflections: parts[0].trim(), synopsis: parts[1].trim(), clarifier: parseClarifierTag(parts[2]) };
  } else if (parts.length === 2) {
    // single card: reading ||| clarifier
    return { reflections: null, synopsis: parts[0].trim(), clarifier: parseClarifierTag(parts[1]) };
  }
  return { reflections: null, synopsis: text.trim(), clarifier: { text: null, suggestsSpread: false } };
}

function typewriterInto(el, text, speed, onDone) {
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

// ── Clarifier ────────────────────────────────────────────────────────────────

function showClarifierPrompt(suggestionText, suggestsSpread = false) {
  const promptEl  = document.getElementById('clarifier-prompt');
  const suggestEl = document.getElementById('clarifier-suggestion');

  suggestEl.textContent = '';
  promptEl.classList.remove('hidden');

  typewriterInto(suggestEl, suggestionText, 35);

  // Wire up single-card buttons (replace to clear stale listeners)
  const drawBtn   = replaceEl('clarifier-draw-btn');
  const chooseBtn = replaceEl('clarifier-choose-btn');
  drawBtn.disabled   = false;
  chooseBtn.disabled = false;

  drawBtn.addEventListener('click', () => {
    document.getElementById('clarifier-chooser').classList.add('hidden');
    drawClarifierCard();
  });

  chooseBtn.addEventListener('click', () => {
    const chooser = document.getElementById('clarifier-chooser');
    chooser.classList.toggle('hidden');
    if (!chooser.classList.contains('hidden')) buildClarifierChooser();
  });

  // Show "Lay a spread" button only when Claude recommends it
  const actionsEl = drawBtn.closest('.clarifier-actions');
  const existing  = document.getElementById('clarifier-spread-btn');
  if (existing) existing.remove();

  if (suggestsSpread) {
    const spreadBtn = document.createElement('button');
    spreadBtn.id = 'clarifier-spread-btn';
    spreadBtn.className = 'clarifier-btn clarifier-btn-spread';
    spreadBtn.textContent = '\u2736 Lay a spread for this';
    actionsEl.appendChild(spreadBtn);
    spreadBtn.addEventListener('click', () => layClarifierSpread(suggestionText));
  }
}

// Launch a full Miriel's Choice spread rooted in a clarifier thread
function layClarifierSpread(threadText) {
  showMirielTakeover(() => {
    mirielPickDeck();
    currentQuestion = threadText;
    document.getElementById('question-input').value = threadText;
    drawWithReaderChoice();
  });
}

function showContinueReading() {
  document.getElementById('continue-reading').classList.remove('hidden');

  // Replace both elements to clear any stale listeners from prior reads
  const btn   = replaceEl('continue-draw-btn');
  const input = replaceEl('continue-question');

  const trigger = () => {
    const newQ = input.value.trim();
    currentQuestion = newQ;
    document.getElementById('question-input').value = newQ;
    drawCards();
  };

  // Auto-grow the textarea as content expands
  input.addEventListener('input', () => {
    input.style.height = 'auto';
    input.style.height = input.scrollHeight + 'px';
  });

  btn.addEventListener('click', trigger);
  input.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) trigger(); });

  // Inject session summary section once per session (after first Claude reading)
  if (!document.getElementById('session-summary-section') && sessionReadings.length >= 1) {
    const section = document.createElement('div');
    section.id = 'session-summary-section';
    section.className = 'session-summary-section';

    const eyebrow = document.createElement('div');
    eyebrow.className = 'session-summary-eyebrow';
    eyebrow.textContent = 'The whole of it';

    const summaryBtn = document.createElement('button');
    summaryBtn.id = 'session-summary-btn';
    summaryBtn.className = 'session-summary-btn';
    summaryBtn.textContent = '\u2736 Read the thread';

    const summaryText = document.createElement('div');
    summaryText.id = 'session-summary-text';
    summaryText.className = 'session-summary-text';

    const saveBtn = document.createElement('button');
    saveBtn.id = 'session-save-btn';
    saveBtn.className = 'session-save-btn';
    saveBtn.textContent = '\u2193 Save this session';

    section.appendChild(eyebrow);
    section.appendChild(summaryBtn);
    section.appendChild(summaryText);
    section.appendChild(saveBtn);

    // Append directly to <main> so it persists across readings and isn't constrained by the meaning panel
    document.querySelector('main').appendChild(section);

    summaryBtn.addEventListener('click', askSessionSummary);
    saveBtn.addEventListener('click', saveSessionDoc);
  }
}

async function askSessionSummary() {
  const btn  = document.getElementById('session-summary-btn');
  const text = document.getElementById('session-summary-text');
  if (!btn || !text) return;
  if (btn.disabled) return;

  btn.disabled = true;
  btn.textContent = 'Listening\u2026';
  text.innerHTML = '';

  // Cinematic "thinking" beat over the whole screen while she synthesizes the
  // session. Stays up until the summary is ready, with a minimum hold so a fast
  // (or cached) response doesn't flash past. Pairs with hideThinkingTakeover().
  showThinkingTakeover('Miriel thinks about this reading for a moment\u2026');
  const minHold = new Promise(r => setTimeout(r, 1800));
  const reveal = async (render) => {
    await minHold;
    await hideThinkingTakeover();
    render();
  };

  // Merge session readings with prior stored readings for full context
  const priorReadings = await fetchPriorReadings();

  // Combine: prior readings first, then session (deduplicated by synopsis)
  const priorSynopses = new Set(priorReadings.map(r => r.synopsis));
  const allReadings = [
    ...priorReadings,
    ...sessionReadings.filter(r => !priorSynopses.has(r.synopsis))
  ];

  const spreadLabels = Object.fromEntries(
    Object.entries(SPREADS).map(([key, s]) => [key, s.label])
  );

  const readingsPayload = allReadings.map(r => ({
    date: r.date || '',
    spread: spreadLabels[r.spread] || r.spread || '',
    question: r.question || '',
    cards: (r.cards || []).map(c => ({
      name: c.name,
      position: c.position || c.positionLabel || '',
      isReversed: c.isReversed
    })),
    synopsis: r.synopsis || ''
  }));

  try {
    const res = await fetch('/api/session-summary', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        readings: readingsPayload,
        readerName: currentReader.name
      })
    });

    const data = await res.json();

    if (data.error) {
      if (data.error === 'NO_KEY') {
        text.innerHTML = '<em style="color:var(--text-dim)">The oracle is silent — no API key found.</em>';
      } else {
        text.textContent = 'Error: ' + data.error;
      }
      btn.disabled = false;
      btn.textContent = '\u2736 Read the thread';
      await minHold;
      await hideThinkingTakeover();
      return;
    }

    sessionSummaryText = data.summary;
    await reveal(() => {
      btn.textContent = '\u2736 Read again';
      btn.disabled = false;
      typewriterInto(text, data.summary, 28, () => {
        text.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      });
    });
  } catch (err) {
    await reveal(() => {
      text.textContent = 'Network error: ' + err.message;
      btn.disabled = false;
      btn.textContent = '\u2736 Read the thread';
    });
  }
}

function birthDateToZodiac(dateStr) {
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

function cardImageUrl(card) {
  if (!card.id) return null;
  const deckKey = card.deckType === 'Moonology'      ? 'moonology' :
                  card.deckType === 'Runic'           ? 'runic' :
                  card.deckType === 'IChing'          ? 'iching' :
                  card.deckType === 'Thoth'           ? 'thoth' :
                  card.deckType === 'Lenormand'       ? null :
                  card.deckType === 'CelticDragon'    ? 'celtic-dragon' :
                  card.id.startsWith('cd-')           ? 'celtic-dragon' :
                  card.id.startsWith('oracle-')       ? 'oracle' :
                                                        'tarot';
  return (deckKey && imageManifest[deckKey] && imageManifest[deckKey][card.id]) || null;
}

async function toDataUri(url) {
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

async function saveSessionDoc() {
  const saveBtn = document.getElementById('session-save-btn');
  if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Preparing\u2026'; }

  const spreadLabels = Object.fromEntries(
    Object.entries(SPREADS).map(([key, s]) => [key, s.label])
  );

  const dateStr = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

  // Collect all unique image URLs across all readings (main cards + clarifiers)
  const urlSet = new Map(); // url → null (will be filled with data URI)
  for (const r of sessionReadings) {
    for (const c of (r.cards || [])) {
      const u = cardImageUrl(c);
      if (u && !urlSet.has(u)) urlSet.set(u, null);
    }
    for (const cl of (r.clarifiers || [])) {
      const u = cardImageUrl(cl.card);
      if (u && !urlSet.has(u)) urlSet.set(u, null);
    }
  }

  // Fetch all images in parallel
  await Promise.all([...urlSet.keys()].map(async url => {
    urlSet.set(url, await toDataUri(url));
  }));

  const readingsSections = sessionReadings.map((r, i) => {
    const spreadLabel = spreadLabels[r.spread] || r.spread || 'Reading';
    const questionLine = r.question
      ? `<p class="question"><em>Question:</em> ${escHtml(r.question)}</p>`
      : '<p class="question no-question"><em>No question asked</em></p>';

    const cardItems = (r.cards || []).map(c => {
      const imgUrl = cardImageUrl(c);
      const dataUri = imgUrl && urlSet.get(imgUrl);
      const imgTag = dataUri
        ? `<img class="card-thumb${c.isReversed ? ' card-thumb-rev' : ''}" src="${dataUri}" alt="${escHtml(c.name)}">`
        : '';
      const posLabel = c.position || c.positionLabel || '';
      return `
        <div class="card-item">
          ${imgTag}
          <div class="card-item-text">
            ${posLabel ? `<div class="pos">${escHtml(posLabel)}</div>` : ''}
            <div class="cname">${escHtml(c.name)}${c.isReversed ? ' <span class="rev">(Reversed)</span>' : ''}</div>
          </div>
        </div>`;
    }).join('');

    const reflectionsParas = (r.reflections || '').split('\n').filter(p => p.trim()).map(p =>
      `<p>${escHtml(p)}</p>`).join('');

    const synopsisParas = (r.synopsis || '').split('\n').filter(p => p.trim()).map(p =>
      `<p>${escHtml(p)}</p>`).join('');

    const clarifierItems = (r.clarifiers || []).map((cl, ci) => {
      const clarImgUrl  = cardImageUrl(cl.card);
      const clarDataUri = clarImgUrl && urlSet.get(clarImgUrl);
      const clarImgTag  = clarDataUri
        ? `<img class="card-thumb${cl.card.isReversed ? ' card-thumb-rev' : ''}" src="${clarDataUri}" alt="${escHtml(cl.card.name)}">`
        : '';
      const clarParas = (cl.text || '').split('\n').filter(p => p.trim()).map(p =>
        `<p>${escHtml(p)}</p>`).join('');
      return `
      <div class="clarifier-item">
        <div class="clarifier-header">
          ${clarImgTag}
          <div class="clarifier-name">Clarifier ${ci + 1}: ${escHtml(cl.card.name)}${cl.card.isReversed ? ' <span class="rev">(Reversed)</span>' : ''}</div>
        </div>
        <div class="clarifier-text">${clarParas}</div>
      </div>`;
    }).join('');

    return `
    <section class="reading">
      <h2>Reading ${i + 1} &mdash; ${escHtml(spreadLabel)}</h2>
      ${questionLine}
      ${cardItems ? `<div class="cards">${cardItems}</div>` : ''}
      ${reflectionsParas ? `<div class="reflections"><div class="section-label">What the cards say</div>${reflectionsParas}</div>` : ''}
      ${synopsisParas ? `<div class="synopsis"><div class="section-label">Miriel's reading</div>${synopsisParas}</div>` : ''}
      ${clarifierItems ? `<div class="clarifiers">${clarifierItems}</div>` : ''}
    </section>`;
  }).join('\n');

  const threadSection = sessionSummaryText ? `
    <section class="thread">
      <h2>The Thread</h2>
      ${sessionSummaryText.split('\n').filter(p => p.trim()).map(p => `<p>${escHtml(p)}</p>`).join('')}
    </section>` : '';

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Miriel's Readings &mdash; ${escHtml(currentReader.name)} &mdash; ${dateStr}</title>
  <style>
    body { font-family: Georgia, 'Palatino Linotype', serif; max-width: 760px; margin: 2.5rem auto; padding: 0 1.5rem; color: #1a1a2e; background: #fff; line-height: 1.7; }
    h1 { font-size: 1.6rem; font-weight: normal; color: #2a1a5e; letter-spacing: 0.06em; border-bottom: 2px solid #c9a84c; padding-bottom: 0.5rem; margin-bottom: 0.3rem; }
    .meta { font-size: 0.82rem; color: #6a5a8a; margin-bottom: 2rem; letter-spacing: 0.04em; }
    h2 { font-size: 1.1rem; font-weight: normal; color: #4a3080; letter-spacing: 0.05em; margin: 0 0 0.5rem; }
    .reading { border-top: 1px solid #d0c8e0; padding: 1.6rem 0 0.8rem; margin-bottom: 0.5rem; }
    .question { color: #3a2a60; font-size: 0.95rem; margin: 0.3rem 0 0.8rem; }
    .no-question { color: #9a90b0; }
    .cards { display: flex; flex-wrap: wrap; gap: 1rem; margin: 0.6rem 0 1.2rem; }
    .card-item { display: flex; align-items: flex-start; gap: 0.7rem; min-width: 160px; flex: 1 1 160px; max-width: 220px; }
    .card-thumb { width: 80px; height: auto; border-radius: 5px; box-shadow: 0 2px 8px rgba(0,0,0,0.18); flex-shrink: 0; }
    .card-thumb-rev { transform: rotate(180deg); }
    .card-item-text { padding-top: 0.2rem; }
    .pos { color: #7a6a9a; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.07em; margin-bottom: 0.15rem; }
    .cname { color: #1a1a2e; font-size: 0.92rem; }
    .rev { color: #9060b0; font-size: 0.82em; font-style: italic; }
    .section-label { font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.1em; color: #9a88c0; margin-bottom: 0.4rem; }
    .reflections { background: #f3f6fc; border-left: 3px solid #8ab0d8; padding: 0.9rem 1.1rem; margin: 0.6rem 0 0.4rem; border-radius: 0 4px 4px 0; }
    .reflections p { margin: 0.5rem 0; color: #1a2a4e; font-size: 0.93rem; }
    .synopsis { background: #f7f4fc; border-left: 3px solid #c9a84c; padding: 0.9rem 1.1rem; margin: 0.4rem 0 0.6rem; border-radius: 0 4px 4px 0; }
    .synopsis p { margin: 0.4rem 0; color: #2a1a4e; font-size: 0.93rem; }
    .clarifiers { margin-top: 1rem; }
    .clarifier-item { border-top: 1px dashed #c8b8e8; padding: 0.9rem 0 0.4rem; }
    .clarifier-header { display: flex; align-items: center; gap: 0.8rem; margin-bottom: 0.6rem; }
    .clarifier-name { font-size: 0.88rem; color: #4a2080; font-style: italic; }
    .clarifier-text p { margin: 0.4rem 0; color: #2a1a4e; font-size: 0.93rem; }
    .thread { border-top: 2px solid #c9a84c; padding: 1.8rem 0 0.5rem; margin-top: 1rem; }
    .thread h2 { font-size: 1.2rem; color: #7a5000; letter-spacing: 0.08em; margin-bottom: 1rem; }
    .thread p { color: #2a1a0e; font-size: 0.97rem; margin: 0.6rem 0; }
    footer { margin-top: 3rem; font-size: 0.7rem; color: #bbb; text-align: center; border-top: 1px solid #eee; padding-top: 0.8rem; }
    @media print { body { margin: 1rem auto; } }
  </style>
</head>
<body>
  <h1>&#9790; Miriel's Readings</h1>
  <p class="meta">Reader: ${escHtml(currentReader.name)} &nbsp;&bull;&nbsp; ${dateStr}</p>

  ${readingsSections}
  ${threadSection}

  <footer>Generated by Miriel's Readings &bull; ${dateStr}</footer>
</body>
</html>`;

  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const slug = currentReader.slug || 'reading';
  const fileDateStr = new Date().toISOString().slice(0, 10);
  const filename = `tarot-${slug}-${fileDateStr}.html`;

  if (/Android/i.test(navigator.userAgent) && window.AndroidBridge?.saveFile) {
    window.AndroidBridge.saveFile(filename, html);
  } else {
    const url = URL.createObjectURL(blob);
    const a   = document.createElement('a');
    a.href     = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = '\u2193 Save this session'; }
}

function escHtml(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function replaceEl(id) {
  const old = document.getElementById(id);
  const clone = old.cloneNode(true);
  old.parentNode.replaceChild(clone, old);
  return clone;
}

async function copyReadingText() {
  const btn = document.getElementById('copy-reading-btn');
  const deckLabels = {
    tarot: 'Rider-Waite Tarot', 'celtic-dragon': 'Celtic Dragon Tarot',
    moonology: 'Moonology Oracle', lenormand: 'Lenormand Oracle',
    thoth: 'Thoth Tarot', runic: 'Elder Futhark Runes',
    iching: 'I Ching', oracle: 'My Oracle', mixed: 'All Decks'
  };
  const spreadLabels = Object.fromEntries(
    Object.entries(SPREADS).map(([key, s]) => [key, s.label])
  );

  const date = new Date().toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  });
  const deckLabel = deckLabels[currentDeck] || currentDeck;
  const spreadLabel = spreadLabels[currentSpread] || currentSpread;

  let lines = [`\u{1F319} Tarot Reading \u2014 ${date}`];
  lines.push(`Deck: ${deckLabel} | Spread: ${spreadLabel}`);
  if (currentQuestion) lines.push(`Question: \u201C${currentQuestion}\u201D`);
  lines.push('');

  for (const c of drawnCards) {
    const pos = c.positionLabel || c.position || '';
    const rev = c.isReversed ? ' (Reversed)' : '';
    lines.push(pos ? `${pos.toUpperCase()} \u2014 ${c.name}${rev}` : `${c.name}${rev}`);
  }

  if (lastSynopsis) {
    lines.push('');
    lines.push("Claude's interpretation:");
    lines.push(lastSynopsis);
  }

  try {
    await navigator.clipboard.writeText(lines.join('\n'));
    if (btn) { btn.textContent = 'Copied!'; setTimeout(() => { btn.innerHTML = '&#128203; Copy text'; }, 2000); }
  } catch {
    alert('Could not copy to clipboard. Try selecting and copying the text manually.');
  }
}

async function exportReadingAsImage() {
  const btn = document.getElementById('share-image-btn');
  const panel = document.getElementById('meaning-panel');
  if (!panel) return;

  if (typeof html2canvas === 'undefined') {
    alert('Image export library not loaded. Check your internet connection.');
    return;
  }

  if (btn) { btn.disabled = true; btn.textContent = 'Preparing\u2026'; }

  try {
    const canvas = await html2canvas(panel, {
      scale: 2,
      useCORS: true,
      backgroundColor: getComputedStyle(document.body).getPropertyValue('background-color') || '#1a1025'
    });

    const date = new Date().toISOString().slice(0, 10);
    const filename = `tarot-${currentReader.slug}-${date}.png`;

    canvas.toBlob(blob => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    }, 'image/png');
  } catch (err) {
    console.error('[tarot] image export error:', err);
    alert('Could not create image: ' + err.message);
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = '&#128247; Save as image'; }
  }
}

async function exportCurrentReading() {
  const btn = document.getElementById('export-reading-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Preparing\u2026'; }

  const spreadLabels = Object.fromEntries(
    Object.entries(SPREADS).map(([key, s]) => [key, s.label])
  );

  const dateStr = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const spreadLabel = spreadLabels[currentSpread] || currentSpread || 'Reading';
  const questionLine = currentQuestion
    ? `<p class="question"><em>Question:</em> ${escHtml(currentQuestion)}</p>`
    : '<p class="question no-question"><em>No question asked</em></p>';

  const urlSet = new Map();
  for (const c of drawnCards) {
    const u = cardImageUrl(c);
    if (u && !urlSet.has(u)) urlSet.set(u, null);
  }
  await Promise.all([...urlSet.keys()].map(async url => {
    urlSet.set(url, await toDataUri(url));
  }));

  const cardItems = drawnCards.map(c => {
    const imgUrl = cardImageUrl(c);
    const dataUri = imgUrl && urlSet.get(imgUrl);
    const imgTag = dataUri
      ? `<img class="card-thumb${c.isReversed ? ' card-thumb-rev' : ''}" src="${dataUri}" alt="${escHtml(c.name)}">`
      : '';
    const posLabel = c.positionLabel || c.position || '';
    return `
      <div class="card-item">
        ${imgTag}
        <div class="card-item-text">
          ${posLabel ? `<div class="pos">${escHtml(posLabel)}</div>` : ''}
          <div class="cname">${escHtml(c.name)}${c.isReversed ? ' <span class="rev">(Reversed)</span>' : ''}</div>
        </div>
      </div>`;
  }).join('');

  const synopsis = lastReadingContext ? lastReadingContext.synopsis || '' : '';
  const synopsisParas = synopsis.split('\n').filter(p => p.trim()).map(p => `<p>${escHtml(p)}</p>`).join('');

  const compatLine = (currentSpread === 'compatibility' && compatPersonA && compatPersonB)
    ? `<p class="compat-meta"><em>${escHtml(compatPersonA.name)} (${escHtml(compatPersonA.zodiac)}) &amp; ${escHtml(compatPersonB.name)} (${escHtml(compatPersonB.zodiac)})</em></p>`
    : '';

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Miriel's Readings &mdash; ${escHtml(currentReader.name)} &mdash; ${dateStr}</title>
  <style>
    body { font-family: Georgia, 'Palatino Linotype', serif; max-width: 760px; margin: 2.5rem auto; padding: 0 1.5rem; color: #1a1a2e; background: #fff; line-height: 1.7; }
    h1 { font-size: 1.6rem; font-weight: normal; color: #2a1a5e; letter-spacing: 0.06em; border-bottom: 2px solid #c9a84c; padding-bottom: 0.5rem; margin-bottom: 0.3rem; }
    .meta { font-size: 0.82rem; color: #6a5a8a; margin-bottom: 1rem; letter-spacing: 0.04em; }
    h2 { font-size: 1.1rem; font-weight: normal; color: #4a3080; letter-spacing: 0.05em; margin: 0 0 0.5rem; }
    .reading { padding: 1.2rem 0 0.8rem; }
    .question { color: #3a2a60; font-size: 0.95rem; margin: 0.3rem 0 0.8rem; }
    .no-question { color: #9a90b0; }
    .compat-meta { color: #803060; font-size: 0.9rem; margin: 0.2rem 0 0.8rem; }
    .cards { display: flex; flex-wrap: wrap; gap: 1rem; margin: 0.6rem 0 1.2rem; }
    .card-item { display: flex; align-items: flex-start; gap: 0.7rem; min-width: 160px; flex: 1 1 160px; max-width: 220px; }
    .card-thumb { width: 80px; height: auto; border-radius: 5px; box-shadow: 0 2px 8px rgba(0,0,0,0.18); flex-shrink: 0; }
    .card-thumb-rev { transform: rotate(180deg); }
    .card-item-text { padding-top: 0.2rem; }
    .pos { color: #7a6a9a; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.07em; margin-bottom: 0.15rem; }
    .cname { color: #1a1a2e; font-size: 0.92rem; }
    .rev { color: #9060b0; font-size: 0.82em; font-style: italic; }
    .synopsis { background: #f7f4fc; border-left: 3px solid #c9a84c; padding: 0.9rem 1.1rem; margin: 0.6rem 0; border-radius: 0 4px 4px 0; }
    .synopsis p { margin: 0.4rem 0; color: #2a1a4e; font-size: 0.93rem; }
    footer { margin-top: 3rem; font-size: 0.7rem; color: #bbb; text-align: center; border-top: 1px solid #eee; padding-top: 0.8rem; }
    @media print { body { margin: 1rem auto; } button { display: none; } }
  </style>
</head>
<body>
  <h1>&#9790; Miriel's Readings</h1>
  <p class="meta">Reader: ${escHtml(currentReader.name)} &nbsp;&bull;&nbsp; ${dateStr}</p>
  <section class="reading">
    <h2>${escHtml(spreadLabel)}</h2>
    ${compatLine}
    ${questionLine}
    ${cardItems ? `<div class="cards">${cardItems}</div>` : ''}
    ${synopsisParas ? `<div class="synopsis">${synopsisParas}</div>` : ''}
  </section>
  <footer>Generated by Miriel's Readings &bull; ${dateStr}</footer>
</body>
</html>`;

  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const slug = currentReader.slug || 'reading';
  const fileDateStr = new Date().toISOString().slice(0, 10);
  const filename = `tarot-${slug}-${fileDateStr}-single.html`;

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);

  if (btn) { btn.disabled = false; btn.textContent = '\u2713 Saved'; setTimeout(() => { btn.textContent = '\u2193 Save this reading'; }, 2000); }
}

function buildClarifierChooser() {
  const sel = document.getElementById('clarifier-select');
  sel.innerHTML = '';
  sel.appendChild(buildSelectOptions());

  // Hide the now-unused Tarot/Oracle tabs in the clarifier chooser
  document.getElementById('clarifier-tabs').classList.add('hidden');

  const submitBtn = replaceEl('clarifier-submit-btn');
  submitBtn.addEventListener('click', () => {
    const id = sel.value;
    if (!id) return;
    const isReversed = document.getElementById('clarifier-reversed').checked;
    const card = findCardById(id);
    if (!card) return;
    submitClarifierCard({ ...card, isReversed });
  });
}

function drawClarifierCard() {
  const pool = getClarifierPool();
  const base = pool[0];
  const card = { ...base, isReversed: noReversal(base) ? false : cryptoRandom() < 0.3 };
  submitClarifierCard(card);
}

function submitClarifierCard(card) {
  // Hide the chooser/buttons
  document.getElementById('clarifier-chooser').classList.add('hidden');
  document.getElementById('clarifier-draw-btn').disabled = true;
  document.getElementById('clarifier-choose-btn').disabled = true;
  const spreadBtnEl = document.getElementById('clarifier-spread-btn');
  if (spreadBtnEl) spreadBtnEl.disabled = true;

  // Show the card visually in its own mini area
  const area = document.getElementById('clarifier-card-area');
  area.innerHTML = '';
  area.appendChild(makeClarifierCardEl(card));

  // Show result section with loading state
  const resultEl  = document.getElementById('clarifier-result');
  const readingEl = document.getElementById('clarifier-reading-text');
  resultEl.classList.remove('hidden');
  readingEl.innerHTML = '<span class="loading">Drawing the thread deeper</span>';

  // Scroll result into view
  setTimeout(() => resultEl.scrollIntoView({ behavior: 'smooth', block: 'start' }), 300);

  askClarify(card);
}

function makeClarifierCardEl(card) {
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

async function askClarify(card, readingEl) {
  if (!readingEl) readingEl = document.getElementById('clarifier-reading-text');

  const payload = {
    originalCards: lastReadingContext.originalCards,
    synopsis: lastReadingContext.synopsis,
    question: lastReadingContext.question,
    clarifierCard: {
      name: card.name,
      isReversed: card.isReversed,
      keywords: (card.keywords || []).join(', '),
      meaning: card.isReversed ? card.reversed : card.upright,
      element: card.element || '',
      astro: card.astro || '',
      shadow: card.shadow || '',
      waite: card.waite || '',
      celtic_lore: card.celtic_lore || '',
      lunar_phase: card.lunar_phase || '',
      lore: card.lore || '',
      combinations: card.combinations || '',
      kabbala: card.kabbala || '',
      aett: card.aett || '',
      trigrams: card.trigrams || null,
      chineseName: card.chineseName || ''
    },
    readerName: currentReader.name,
    reader: currentReader.slug
  };

  try {
    const res = await fetch('/api/clarify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await res.json();

    if (data.error) {
      readingEl.textContent = data.error === 'NO_KEY'
        ? 'The oracle is silent — click ⚙ to add your API key.'
        : 'Error: ' + data.error;
      return;
    }

    const parts = data.interpretation.split(/\n\s*\|\|\|\s*\n/);
    const readingText = parts[0].trim();
    const followUp    = parseClarifierTag(parts[1] || null);

    readingEl.textContent = '';

    // Accumulate this clarifier into the reading context for subsequent calls
    const cardDesc = `${card.name} (${card.isReversed ? 'reversed' : 'upright'})`;
    lastReadingContext.synopsis += `\n\nClarifier — ${cardDesc}:\n${readingText}`;

    // Record in the session reading so it appears in the saved HTML
    const lastR = sessionReadings[sessionReadings.length - 1];
    if (lastR) {
      if (!lastR.clarifiers) lastR.clarifiers = [];
      lastR.clarifiers.push({
        card: { name: card.name, isReversed: card.isReversed, id: card.id, deckType: card.deckType },
        text: readingText
      });
    }

    const onDone = () => {
      if (followUp.text && followUp.text.toUpperCase() !== 'COMPLETE') {
        showFollowUpPrompt(followUp.text, followUp.suggestsSpread);
      }
    };

    typewriterInto(readingEl, readingText, 35, onDone);
  } catch (err) {
    readingEl.textContent = 'Network error: ' + err.message;
  }
}

// ── Chained clarifier ─────────────────────────────────────────────────────────

function showFollowUpPrompt(suggestionText, suggestsSpread = false) {
  const result = document.getElementById('clarifier-result');

  const section = document.createElement('div');
  section.className = 'follow-up-section';

  // Suggestion text
  const suggestEl = document.createElement('div');
  suggestEl.className = 'follow-up-suggestion';
  section.appendChild(suggestEl);

  // Draw / Choose buttons
  const actions = document.createElement('div');
  actions.className = 'clarifier-actions';

  const drawBtn   = document.createElement('button');
  drawBtn.className = 'clarifier-btn';
  drawBtn.textContent = '🃏 Draw one for me';

  const chooseBtn = document.createElement('button');
  chooseBtn.className = 'clarifier-btn clarifier-btn-alt';
  chooseBtn.textContent = '✏ I\'ll pick one';

  actions.appendChild(drawBtn);
  actions.appendChild(chooseBtn);

  if (suggestsSpread) {
    const spreadBtn = document.createElement('button');
    spreadBtn.className = 'clarifier-btn clarifier-btn-spread';
    spreadBtn.textContent = '\u2736 Lay a spread for this';
    spreadBtn.addEventListener('click', () => layClarifierSpread(suggestionText));
    actions.appendChild(spreadBtn);
  }

  section.appendChild(actions);

  // Inline chooser (hidden until Choose is clicked)
  const chooser = document.createElement('div');
  chooser.className = 'follow-up-chooser hidden';
  section.appendChild(chooser);

  result.appendChild(section);
  setTimeout(() => section.scrollIntoView({ behavior: 'smooth', block: 'start' }), 200);

  typewriterInto(suggestEl, suggestionText, 35);

  drawBtn.addEventListener('click', () => {
    drawBtn.disabled   = true;
    chooseBtn.disabled = true;
    chooser.classList.add('hidden');
    const base2 = getClarifierPool()[0];
    const card = { ...base2, isReversed: noReversal(base2) ? false : cryptoRandom() < 0.3 };
    submitFollowUpCard(card, section);
  });

  chooseBtn.addEventListener('click', () => {
    if (!chooser.classList.contains('hidden')) { chooser.classList.add('hidden'); return; }
    buildFollowUpChooser(chooser, section, drawBtn, chooseBtn);
    chooser.classList.remove('hidden');
  });
}

function buildFollowUpChooser(chooser, section, drawBtn, chooseBtn) {
  chooser.innerHTML = '';

  const row = document.createElement('div');
  row.className = 'clarifier-chooser-row';

  const sel = document.createElement('select');
  sel.className = 'manual-select';
  sel.appendChild(buildSelectOptions());

  const revLabel = document.createElement('label');
  revLabel.className = 'manual-rev-label';
  const revCheck = document.createElement('input');
  revCheck.type = 'checkbox'; revCheck.className = 'manual-rev-check';
  revLabel.appendChild(revCheck); revLabel.append(' Reversed');

  const readBtn = document.createElement('button');
  readBtn.className = 'clarifier-btn'; readBtn.textContent = 'Read this card';

  row.appendChild(sel); row.appendChild(revLabel); row.appendChild(readBtn);
  chooser.appendChild(row);

  readBtn.addEventListener('click', () => {
    const id = sel.value;
    if (!id) return;
    const card = findCardById(id);
    if (!card) return;
    drawBtn.disabled = true; chooseBtn.disabled = true;
    chooser.classList.add('hidden');
    submitFollowUpCard({ ...card, isReversed: revCheck.checked }, section);
  });
}

function submitFollowUpCard(card, section) {
  // Card display
  const cardArea = document.createElement('div');
  cardArea.className = 'clarifier-card-area';
  cardArea.appendChild(makeClarifierCardEl(card));
  section.appendChild(cardArea);

  // Reading label + text
  const label = document.createElement('div');
  label.className = 'clarifier-reading-label';
  label.textContent = 'What it reveals';
  section.appendChild(label);

  const readingEl = document.createElement('div');
  readingEl.className = 'follow-up-reading';
  readingEl.innerHTML = '<span class="loading">Drawing the thread deeper</span>';
  section.appendChild(readingEl);

  setTimeout(() => cardArea.scrollIntoView({ behavior: 'smooth', block: 'start' }), 300);

  askClarify(card, readingEl);
}

// ── Voice: TTS + STT ─────────────────────────────────────────────────────────


init();
