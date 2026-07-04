// ── reader-identity.js ───────────────────────────────────────────────────────
// Reader picker/profile-selection UI: reader dropdown, "Your Story So Far"
// notebook, and the time-of-day greeting / Threshold reunion overlay. See
// .superpowers/sdd/appjs-map.md §6 (module 12) and task-7-brief.md.
import { state } from './state.js';
import { notebookEl } from './utils.js';
import { hideMeaningPanel } from './card-render.js';
import { checkForPriorSession } from './reading-flow.js';

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
  btn.innerHTML = `&#9789; <span id="reader-name">${state.currentReader.name}</span>`;

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
    opt.className = 'reader-option' + (reader.slug === state.currentReader.slug ? ' active' : '');
    opt.textContent = reader.name;
    opt.addEventListener('click', () => {
      switchReader(reader);
      dropdown.classList.add('hidden');
    });
    row.appendChild(opt);

    // Show delete button only when more than one reader exists and this isn't the active reader
    if (readers.length > 1 && reader.slug !== state.currentReader.slug) {
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
  state.currentReader = reader;
  document.getElementById('reader-name').textContent = reader.name;
  // Clear current session state
  state.drawnCards = [];
  state.themeCard = null;
  state.sessionReadings = [];
  state.sessionSummaryText = '';
  state.currentQuestion = '';
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


async function openNotebook() {
  const overlay = document.getElementById('notebook-overlay');
  const inner   = document.getElementById('notebook-inner');
  if (!overlay || !inner) return;
  inner.innerHTML = '';

  let data = null;
  try {
    const r = await fetch(`/api/profiles/${encodeURIComponent(state.currentReader.slug)}`);
    if (r.ok) data = await r.json();
  } catch {}

  let foretellings = [];
  try {
    const fr = await fetch(`/api/foretellings/${encodeURIComponent(state.currentReader.slug)}`);
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
  const metaBits = [`as Miriel has come to know ${state.currentReader.name}`];
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

export function dismissGreeting() {
  const panel = document.getElementById('greeting-panel');
  if (!panel || panel.classList.contains('greeting-gone')) return;
  panel.classList.add('greeting-gone');
  setTimeout(() => panel.remove(), 400);
}

async function checkThreshold() {
  // Don't intrude on a resumed in-progress session.
  if (state.drawnCards.length) return false;
  let data;
  try {
    const phase = document.body.dataset.time || '';
    const r = await fetch(`/api/threshold?reader=${encodeURIComponent(state.currentReader.slug)}&phase=${encodeURIComponent(phase)}`);
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
          body: JSON.stringify({ reader: state.currentReader.slug, answer, threadIds: data.threadIds }),
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
  if (state.drawnCards.length) return;

  const h = new Date().getHours();
  const [, , headline, body] = getGreetingForHour(h);
  const name = state.currentReader.name;

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
    if (entered && entered !== state.currentReader.name) {
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

export { buildReaderUI, switchReader, openNotebook, closeNotebook, buildGreeting, checkThreshold };
