// ── bootstrap.js ─────────────────────────────────────────────────────────────
// App startup: init(), setupButtons() (+ its nested modal/settings helpers),
// checkKeyStatus(). Extracted from app.js so app.js can be a pure entry
// module. See .superpowers/sdd/task-8-brief.md.
import { state } from './state.js';
import { SPREADS } from './spreads-data.js';
import { birthDateToZodiac } from './utils.js';
import { applyTimeOfDayTheme, cycleTheme, renderHeaderMoon, renderCosmosMoon } from './theme.js';
import {
  initSpreadButtons, activateTab, captureActiveSlotTemplate,
  drawCards, askClaude, launchMirielsChoice, checkForPriorSession,
} from './reading-flow.js';
import { exportCurrentReading, copyReadingText, exportReadingAsImage } from './session-export.js';
import { buildReaderUI, closeNotebook, buildGreeting, checkThreshold } from './reader-identity.js';
import {
  openJournal, closeJournal, openGrimoire, closeGrimoire, buildDailyCardBar,
} from './content-library.js';

// ── Init ────────────────────────────────────────────────────────────────────

export async function init() {
  applyTimeOfDayTheme();   // set background theme immediately, before any await
  // Re-evaluate live so the phase shifts during a long-open session (Auto mode
  // crossing a clock boundary). No-op when a phase is forced via the toggle.
  setInterval(applyTimeOfDayTheme, 60000);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) applyTimeOfDayTheme();
  });
  captureActiveSlotTemplate();
  // Load readers first so state.currentReader is set before any reading fetch
  try {
    const readersRes = await fetch('/api/readers');
    if (readersRes.ok) {
      const readers = await readersRes.json();
      if (readers.length) state.currentReader = readers[0];
    }
  } catch {}

  const [cardsRes, imagesRes] = await Promise.all([
    fetch('/api/cards'),
    fetch('/api/images').catch(() => null)
  ]);
  state.allCards = await cardsRes.json();
  try {
    if (imagesRes && imagesRes.ok) state.imageManifest = await imagesRes.json();
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

function setupButtons() {
  document.getElementById('deck-select').addEventListener('change', e => {
    state.currentDeck = e.target.value;
  });

  document.getElementById('question-input').addEventListener('input', e => {
    state.currentQuestion = e.target.value.trim();
  });

  document.getElementById('question-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') drawCards();
  });

  document.getElementById('mode-random').addEventListener('click', () => {
    state.manualMode = false;
    document.getElementById('mode-random').classList.add('active');
    document.getElementById('mode-manual').classList.remove('active');
    document.getElementById('draw-btn').textContent = 'Lay the Cards';
  });

  document.getElementById('mode-manual').addEventListener('click', () => {
    state.manualMode = true;
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
      this.value = state.currentSpread;
      showCompatModal();
      return;
    }
    state.currentSpread = this.value;
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
    state.compatPersonA = { name: nameA, zodiac: zodiacA };
    state.compatPersonB = { name: nameB, zodiac: zodiacB };
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
