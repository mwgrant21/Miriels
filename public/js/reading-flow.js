// ── reading-flow.js ──────────────────────────────────────────────────────────
// Merged reading-session + claude-reading + clarifier cluster. Kept as ONE
// module (not split further) because the three sub-features form a genuine
// 3-way call cycle at runtime: dealAndReveal → askClaude →
// showClarifierPrompt/showContinueReading → drawWithReaderChoice → back.
// See .superpowers/sdd/appjs-map.md §6/§7 and task-6-brief.md.
import { state } from './state.js';
import { DEAL_INTERVAL, SHUFFLE_MS, DEAL_FLIP_DELAY, SPREADS } from './spreads-data.js';
import { dealPaceMs, jittered, sleep, moonPhaseInfo, cryptoRandom, typewriterInto, replaceEl } from './utils.js';
import {
  noReversal, getShuffledDeck, buildSelectOptions, findCardById, findCardByName, getClarifierPool,
} from './deck.js';
import {
  renderSpread, renderThemeCard, showThemeMeaning, showMeaning, hideMeaningPanel,
  makeClarifierCardEl, lastRenderDealt,
} from './card-render.js';
import { mirielPickDeck, showMirielTakeover, showThinkingTakeover, hideThinkingTakeover } from './overlay.js';
import {
  askSessionSummary, saveSessionDoc, exportCurrentReading, copyReadingText, exportReadingAsImage,
} from './session-export.js';
import { dismissGreeting } from './reader-identity.js';

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
      if (key === state.currentSpread) opt.selected = true;
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
  if (state.currentSpread === 'reader-choice') mirielOpt.selected = true;
  sel.appendChild(mirielOpt);

  if (!sel.value || !SPREADS[sel.value] || SPREADS[sel.value].category !== category) {
    sel.selectedIndex = 0;
    state.currentSpread = sel.value;
  }
}

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

function launchMirielsChoice() {
  showMirielTakeover(() => {
    mirielPickDeck();
    state.currentSpread = 'reader-choice';
    state.manualMode = false;
    drawCards();
  });
}

// ── Draw ────────────────────────────────────────────────────────────────────

function drawCards() {
  dismissGreeting();
  document.getElementById('resume-panel').classList.add('hidden');
  if (state.manualMode) {
    state.themeCard = null;
    archiveCurrentReading();
    showManualForm();
    scrollToNewReading();
    return;
  }
  if (state.currentSpread === 'reader-choice') {
    drawWithReaderChoice();
    return;
  }
  if (state.currentSpread === 'compatibility' && (!state.compatPersonA || !state.compatPersonB)) {
    document.getElementById('compat-modal').classList.remove('hidden');
    return;
  }
  archiveCurrentReading();
  document.getElementById('reader-note').classList.add('hidden');
  const spreadDef = (SPREADS[state.currentSpread] && SPREADS[state.currentSpread].slots) || SPREADS['single'].slots;
  const deck = getShuffledDeck();
  // NOTE: isReversed (boolean) is separate from card.reversed (text meaning)
  // Lenormand and I Ching do not use reversals; some runes are non-reversible
  state.drawnCards = spreadDef.map((slot, i) => ({
    ...deck[i],
    isReversed: noReversal(deck[i]) ? false : cryptoRandom() < 0.3,
    positionLabel: slot.label,
    position: slot.position
  }));

  // Bottom-of-deck card = overall theme (random mode only)
  const bottomCard = deck[deck.length - 1];
  state.themeCard = { ...bottomCard, isReversed: cryptoRandom() < 0.3, positionLabel: 'Overall Theme', position: 'theme' };

  cancelRevealTimers();
  dealToken++;
  state.dealAnimActive = true;
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
  // set state.currentDeck after the user last changed the dropdown.
  state.currentDeck = document.getElementById('deck-select').value || state.currentDeck;
  const snapshotDeck = state.currentDeck;

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
      body: JSON.stringify({ question: state.currentQuestion, moonPhase: moonPhaseInfo().name })
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
    state.currentSpread = chosenSpread;
    if (SPREADS[chosenSpread]) activateTab(SPREADS[chosenSpread].category);

    // Highlight chosen spread in the dropdown
    const spreadSel = document.getElementById('spread-select');
    if (spreadSel) {
      spreadSel.value = chosenSpread;
      state.currentSpread = spreadSel.value || state.currentSpread;
    }

    // Show the reader's note
    const spreadNames = {
      'single': 'Single Card', 'three-card': 'Three-Card',
      'four-card': 'Four-Card', 'five-card': 'Five-Card',
      'six-card': 'Six-Card', 'nine-card': 'Nine-Card', 'celtic': 'Celtic Cross'
    };
    // chosenReason is raw model output; build the note with textContent so it can
    // never inject markup/script (the label is a controlled whitelist, but treated
    // as text here too for consistency).
    const noteLabel = spreadNames[chosenSpread] || (SPREADS[chosenSpread] && SPREADS[chosenSpread].label) || chosenSpread;
    noteEl.textContent = '';
    const labelSpan = document.createElement('span');
    labelSpan.className = 'reader-note-label';
    labelSpan.textContent = noteLabel;
    noteEl.appendChild(labelSpan);
    if (chosenReason) noteEl.appendChild(document.createTextNode(' \u2014 ' + chosenReason));
    noteEl.classList.remove('hidden');
    scrollToNewReading();

    // Brief pause so the user can read the note before cards appear
    await new Promise(r => setTimeout(r, 1100));

    const spreadDef = (SPREADS[state.currentSpread] && SPREADS[state.currentSpread].slots) || SPREADS['single'].slots;
    // Use snapshotDeck (captured before phase-1 await) so deck-select changes
    // during the network call don't silently swap decks.
    state.currentDeck = snapshotDeck;
    const deck = getShuffledDeck();
    state.drawnCards = spreadDef.map((slot, i) => ({
      ...deck[i],
      isReversed: noReversal(deck[i]) ? false : cryptoRandom() < 0.3,
      positionLabel: slot.label,
      position: slot.position
    }));

    const bottomCard = deck[deck.length - 1];
    state.themeCard = { ...bottomCard, isReversed: cryptoRandom() < 0.3, positionLabel: 'Overall Theme', position: 'theme' };

    cancelRevealTimers();
    dealToken++;
    state.dealAnimActive = true;
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

let revealTimers = [];        // track pending auto-reveal timeouts so we can cancel on new draw
let dealToken = 0; // bumped on each new draw so an in-flight async deal can abort

function cancelRevealTimers() {
  revealTimers.forEach(t => clearTimeout(t));
  revealTimers = [];
}

// JS-sequenced paced deal for auto draws. onCard(i) may return a Promise to pause
// the deal after card i is laid; defaults to curiosityPauseForCard when omitted.
let pendingCuriosity = [];   // [{cardId, question, threadIds}] detected for the current deal
let curiosityAnswers = [];   // [{question, answer, threadIds}] collected during the deal

function curiosityPauseForCard(cardIndex) {
  const card = state.drawnCards[cardIndex];
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
  const n = state.drawnCards.length;
  const per = dealPaceMs(n);

  // Detect curiosity during the shuffle beat (fires only if the reader has open threads).
  pendingCuriosity = [];
  curiosityAnswers = [];
  const detectP = (async () => {
    try {
      const r = await fetch('/api/reading-questions', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reader: state.currentReader.slug,
          cards: state.drawnCards.map(c => ({ id: c.id || '', name: c.name, position: c.positionLabel || '', isReversed: !!c.isReversed })),
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
  if (state.themeCard) showThemeMeaning();
  await sleep(900);
  if (dealToken !== myToken) return;
  askClaude();
}

// After cards flip, automatically reveal each meaning then trigger Claude
function autoReveal() {
  const n = state.drawnCards.length;
  // Theme card flips at 100ms; reveal its meaning at 800ms
  if (state.themeCard) {
    const t = setTimeout(() => showThemeMeaning(), 800);
    revealTimers.push(t);
  }
  // Show meaning after each card's flip completes (timing depends on whether deal anim ran)
  state.drawnCards.forEach((_, i) => {
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

function showManualForm() {
  const area = document.getElementById('spread-area');
  area.className = 'spread-area';
  cancelRevealTimers();
  hideMeaningPanel();

  const spreadSlots = (SPREADS[state.currentSpread] && SPREADS[state.currentSpread].slots) || SPREADS['single'].slots;

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

// ── Resume prior session ─────────────────────────────────────────────────────

async function checkForPriorSession() {
  // Hide any existing banner before checking for the new reader's history
  document.getElementById('resume-panel').classList.add('hidden');
  try {
    const r = await fetch(`/api/readings?reader=${encodeURIComponent(state.currentReader.slug)}`);
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
  state.currentDeck     = reading.deck || 'tarot';
  state.currentSpread   = spreadKeyByLabel[reading.spread] || legacyAliases[reading.spread] || 'single';
  state.currentQuestion = reading.question || '';

  document.getElementById('deck-select').value    = state.currentDeck;
  document.getElementById('question-input').value = state.currentQuestion;
  const spreadSel = document.getElementById('spread-select');
  if (spreadSel && SPREADS[state.currentSpread]) {
    activateTab(SPREADS[state.currentSpread].category);
  }

  // Rebuild state.drawnCards — look up full card objects by name
  const spreadDef = (SPREADS[state.currentSpread] && SPREADS[state.currentSpread].slots) || [];
  state.drawnCards = (reading.cards || []).map((hCard, i) => {
    const cardObj = findCardByName(hCard.name) || {};
    return {
      ...cardObj,
      name:          hCard.name,
      isReversed:    hCard.isReversed,
      positionLabel: hCard.position || (spreadDef[i] ? spreadDef[i].label : ''),
      position:      spreadDef[i] ? spreadDef[i].position : ''
    };
  });

  state.themeCard = null; // resumed readings don't restore the theme card
  cancelRevealTimers();
  state.dealAnimActive = false;
  renderSpread();
  renderThemeCard();
  hideMeaningPanel();

  // Reveal each card meaning with the same stagger as a live draw
  const n = state.drawnCards.length;
  state.drawnCards.forEach((_, i) => {
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

      state.lastReadingContext = {
        originalCards: state.drawnCards.map(c => ({
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
        question:  state.currentQuestion
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

  state.drawnCards = entries.map(s => ({
    ...findCardById(s.id),
    isReversed: s.isReversed,
    positionLabel: s.slot.label,
    position: s.slot.position
  }));

  state.themeCard = null; // no bottom-of-deck in manual mode
  cancelRevealTimers();
  state.dealAnimActive = false;
  renderSpread();
  renderThemeCard();
  hideMeaningPanel();
  autoReveal();
}

// ── Reading history ───────────────────────────────────────────────────────────

async function fetchPriorReadings() {
  try {
    const r = await fetch(`/api/readings?reader=${encodeURIComponent(state.currentReader.slug)}`);
    if (r.ok) return await r.json();
  } catch {}
  return [];
}

async function saveReading(synopsisText) {
  const date = new Date().toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  });
  const deckLabels = {
    'veil-arcana': 'Veil Arcana', 'drowned-ephemeris': 'Drowned Ephemeris', tarot: 'Rider-Waite Tarot',
    'miriel-lunar': 'Moon Oracle',
    lenormand: 'Lenormand Oracle', thoth: 'Thoth Tarot',
    runic: 'Elder Futhark Runes', iching: 'I Ching', oracle: 'My Oracle', mixed: 'All Decks'
  };
  const spreadLabels = Object.fromEntries(
    Object.entries(SPREADS).map(([key, s]) => [key, s.label])
  );
  const entry = {
    date,
    timestamp: Date.now(),
    reader: state.currentReader.slug,
    deck: state.currentDeck,
    deckLabel: deckLabels[state.currentDeck] || state.currentDeck,
    spread: spreadLabels[state.currentSpread] || state.currentSpread,
    question: state.currentQuestion || '',
    cards: state.drawnCards.map(c => ({
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
  if (!state.drawnCards.length) return;

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
    spread_type: state.currentSpread,
    question: state.currentQuestion,
    cards: state.drawnCards.map(c => ({
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
    themeCard: state.themeCard ? {
      name: state.themeCard.name,
      isReversed: state.themeCard.isReversed,
      meaning: state.themeCard.isReversed ? state.themeCard.reversed : state.themeCard.upright,
      keywords: (state.themeCard.keywords || []).join(', '),
      element: state.themeCard.element || '',
      astro: state.themeCard.astro || ''
    } : null,
    priorReadings,
    readerName: state.currentReader.name,
    moonPhase: moonPhaseInfo().name,
    curiosityAnswers: curiosityAnswers,
  };

  const isCompatibility = state.currentSpread === 'compatibility';
  if (isCompatibility && state.compatPersonA && state.compatPersonB) {
    payload.personA = state.compatPersonA;
    payload.personB = state.compatPersonB;
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
    state.lastReadingContext = {
      originalCards: payload.cards,
      synopsis: synopsisForContext,
      question: state.currentQuestion
    };

    // Persist this reading to history (fire and forget)
    saveReading(synopsisForContext);

    // Track for session summary (include id + deckType for image lookup in save doc)
    state.sessionReadings.push({
      spread: payload.spread_type,
      question: state.currentQuestion,
      cards: state.drawnCards.map(c => ({
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
      state.lastSynopsis = finalText || '';
      if (clarifier.text) showClarifierPrompt(clarifier.text, clarifier.suggestsSpread);
      showContinueReading();
      const exportBtn = document.getElementById('export-reading-btn');
      if (exportBtn) exportBtn.classList.remove('hidden');
      document.getElementById('copy-reading-btn')?.classList.remove('hidden');
      document.getElementById('share-image-btn')?.classList.remove('hidden');
    };

    await reveal(() => {
      if (reflections && state.drawnCards.length > 1) {
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
    state.currentQuestion = threadText;
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
    state.currentQuestion = newQ;
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
  if (!document.getElementById('session-summary-section') && state.sessionReadings.length >= 1) {
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

async function askClarify(card, readingEl) {
  if (!readingEl) readingEl = document.getElementById('clarifier-reading-text');

  const payload = {
    originalCards: state.lastReadingContext.originalCards,
    synopsis: state.lastReadingContext.synopsis,
    question: state.lastReadingContext.question,
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
    readerName: state.currentReader.name,
    reader: state.currentReader.slug
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
    state.lastReadingContext.synopsis += `\n\nClarifier — ${cardDesc}:\n${readingText}`;

    // Record in the session reading so it appears in the saved HTML
    const lastR = state.sessionReadings[state.sessionReadings.length - 1];
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

export {
  initSpreadButtons, activateTab, captureActiveSlotTemplate,
  drawCards, askClaude, launchMirielsChoice, checkForPriorSession, fetchPriorReadings,
};
