// ── session-export.js ────────────────────────────────────────────────────────
// Save/export/session-summary functions. See .superpowers/sdd/appjs-map.md §6
// (module 11) and task-7-brief.md.
import { state } from './state.js';
import { SPREADS } from './spreads-data.js';
import { escHtml, toDataUri, typewriterInto } from './utils.js';
import { cardImageUrl } from './deck.js';
import { showThinkingTakeover, hideThinkingTakeover } from './overlay.js';
import { fetchPriorReadings } from './reading-flow.js';

export async function askSessionSummary() {
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
    ...state.sessionReadings.filter(r => !priorSynopses.has(r.synopsis))
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
        readerName: state.currentReader.name
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

    state.sessionSummaryText = data.summary;
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


export async function saveSessionDoc() {
  const saveBtn = document.getElementById('session-save-btn');
  if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Preparing\u2026'; }

  const spreadLabels = Object.fromEntries(
    Object.entries(SPREADS).map(([key, s]) => [key, s.label])
  );

  const dateStr = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

  // Collect all unique image URLs across all readings (main cards + clarifiers)
  const urlSet = new Map(); // url → null (will be filled with data URI)
  for (const r of state.sessionReadings) {
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

  const readingsSections = state.sessionReadings.map((r, i) => {
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

  const threadSection = state.sessionSummaryText ? `
    <section class="thread">
      <h2>The Thread</h2>
      ${state.sessionSummaryText.split('\n').filter(p => p.trim()).map(p => `<p>${escHtml(p)}</p>`).join('')}
    </section>` : '';

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Miriel's Readings &mdash; ${escHtml(state.currentReader.name)} &mdash; ${dateStr}</title>
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
  <p class="meta">Reader: ${escHtml(state.currentReader.name)} &nbsp;&bull;&nbsp; ${dateStr}</p>

  ${readingsSections}
  ${threadSection}

  <footer>Generated by Miriel's Readings &bull; ${dateStr}</footer>
</body>
</html>`;

  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const slug = state.currentReader.slug || 'reading';
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


export async function copyReadingText() {
  const btn = document.getElementById('copy-reading-btn');
  const deckLabels = {
    'veil-arcana': 'Veil Arcana', 'drowned-ephemeris': 'Drowned Ephemeris', tarot: 'Rider-Waite Tarot',
    'miriel-lunar': 'Moon Oracle',
    lenormand: 'Lenormand Oracle', thoth: 'Thoth Tarot',
    runic: 'Elder Futhark Runes', iching: 'I Ching', oracle: 'My Oracle', mixed: 'All Decks'
  };
  const spreadLabels = Object.fromEntries(
    Object.entries(SPREADS).map(([key, s]) => [key, s.label])
  );

  const date = new Date().toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  });
  const deckLabel = deckLabels[state.currentDeck] || state.currentDeck;
  const spreadLabel = spreadLabels[state.currentSpread] || state.currentSpread;

  let lines = [`\u{1F319} Tarot Reading \u2014 ${date}`];
  lines.push(`Deck: ${deckLabel} | Spread: ${spreadLabel}`);
  if (state.currentQuestion) lines.push(`Question: \u201C${state.currentQuestion}\u201D`);
  lines.push('');

  for (const c of state.drawnCards) {
    const pos = c.positionLabel || c.position || '';
    const rev = c.isReversed ? ' (Reversed)' : '';
    lines.push(pos ? `${pos.toUpperCase()} \u2014 ${c.name}${rev}` : `${c.name}${rev}`);
  }

  if (state.lastSynopsis) {
    lines.push('');
    lines.push("Claude's interpretation:");
    lines.push(state.lastSynopsis);
  }

  try {
    await navigator.clipboard.writeText(lines.join('\n'));
    if (btn) { btn.textContent = 'Copied!'; setTimeout(() => { btn.innerHTML = '&#128203; Copy text'; }, 2000); }
  } catch {
    alert('Could not copy to clipboard. Try selecting and copying the text manually.');
  }
}

export async function exportReadingAsImage() {
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
    const filename = `tarot-${state.currentReader.slug}-${date}.png`;

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

export async function exportCurrentReading() {
  const btn = document.getElementById('export-reading-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Preparing\u2026'; }

  const spreadLabels = Object.fromEntries(
    Object.entries(SPREADS).map(([key, s]) => [key, s.label])
  );

  const dateStr = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const spreadLabel = spreadLabels[state.currentSpread] || state.currentSpread || 'Reading';
  const questionLine = state.currentQuestion
    ? `<p class="question"><em>Question:</em> ${escHtml(state.currentQuestion)}</p>`
    : '<p class="question no-question"><em>No question asked</em></p>';

  const urlSet = new Map();
  for (const c of state.drawnCards) {
    const u = cardImageUrl(c);
    if (u && !urlSet.has(u)) urlSet.set(u, null);
  }
  await Promise.all([...urlSet.keys()].map(async url => {
    urlSet.set(url, await toDataUri(url));
  }));

  const cardItems = state.drawnCards.map(c => {
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

  const synopsis = state.lastReadingContext ? state.lastReadingContext.synopsis || '' : '';
  const synopsisParas = synopsis.split('\n').filter(p => p.trim()).map(p => `<p>${escHtml(p)}</p>`).join('');

  const compatLine = (state.currentSpread === 'compatibility' && state.compatPersonA && state.compatPersonB)
    ? `<p class="compat-meta"><em>${escHtml(state.compatPersonA.name)} (${escHtml(state.compatPersonA.zodiac)}) &amp; ${escHtml(state.compatPersonB.name)} (${escHtml(state.compatPersonB.zodiac)})</em></p>`
    : '';

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Miriel's Readings &mdash; ${escHtml(state.currentReader.name)} &mdash; ${dateStr}</title>
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
  <p class="meta">Reader: ${escHtml(state.currentReader.name)} &nbsp;&bull;&nbsp; ${dateStr}</p>
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
  const slug = state.currentReader.slug || 'reading';
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
