/**
 * Generates SVG card images for the Moonology Oracle deck.
 * Output: public/images/moonology/{id}.svg
 *
 * Run: node generate-moonology-cards.js
 */

const fs   = require('fs');
const path = require('path');
const data = require('./data/moonology.json');

// ── Category palette ─────────────────────────────────────────────────────────

function categoryOf(card) {
  if (card.id.startsWith('nm-'))       return 'new-sign';
  if (card.id.startsWith('fm-'))       return 'full-sign';
  if (card.id.startsWith('eclipse-'))  return 'eclipse';
  if (card.id.startsWith('special-'))  return 'special';
  return 'phase';
}

const PALETTES = {
  'phase': {
    bgBase:      '#0b0e1a',
    bgMid:       '#111728',
    borderOuter: '#2e3a5a',
    borderInner: '#1e2840',
    cornerAccent:'#4a5f90',
    glowColor:   '#8ba4d8',
    symbolColor: '#dde8ff',
    nameColor:   '#a8bce8',
    catColor:    '#3a4a70',
    divColor:    '#2e3a5a',
    catLabel:    'LUNAR PHASE',
  },
  'new-sign': {
    bgBase:      '#0f0b1a',
    bgMid:       '#16102a',
    borderOuter: '#3a2a5a',
    borderInner: '#281e40',
    cornerAccent:'#6040a0',
    glowColor:   '#9060e0',
    symbolColor: '#d8ccff',
    nameColor:   '#b090e8',
    catColor:    '#4a3070',
    divColor:    '#3a2a5a',
    catLabel:    'NEW MOON',
  },
  'full-sign': {
    bgBase:      '#1a1408',
    bgMid:       '#261e0e',
    borderOuter: '#5a4820',
    borderInner: '#3e3216',
    cornerAccent:'#9a7830',
    glowColor:   '#d4a830',
    symbolColor: '#fff0b0',
    nameColor:   '#ddc070',
    catColor:    '#6a5220',
    divColor:    '#5a4820',
    catLabel:    'FULL MOON',
  },
  'eclipse': {
    bgBase:      '#180808',
    bgMid:       '#220e0e',
    borderOuter: '#5a1818',
    borderInner: '#3e1010',
    cornerAccent:'#a02020',
    glowColor:   '#e04040',
    symbolColor: '#ffd0d0',
    nameColor:   '#e08080',
    catColor:    '#6a1818',
    divColor:    '#5a1818',
    catLabel:    'ECLIPSE',
  },
  'special': {
    bgBase:      '#081418',
    bgMid:       '#0e1e24',
    borderOuter: '#1e4850',
    borderInner: '#163440',
    cornerAccent:'#2a7080',
    glowColor:   '#40b0c0',
    symbolColor: '#b8f0f8',
    nameColor:   '#70c8d8',
    catColor:    '#1e5060',
    divColor:    '#1e4850',
    catLabel:    'SPECIAL MOON',
  },
};

// ── SVG builder ───────────────────────────────────────────────────────────────

function generateSVG(card) {
  const cat = categoryOf(card);
  const p   = PALETTES[cat];
  const W   = 280;
  const H   = 486;
  const CX  = W / 2;

  // For compound symbols (e.g. 🌑♈) split into moon + sign
  const symbols = [...card.symbol]; // Unicode-aware split
  const moonSym = symbols[0] || '🌙';
  const signSym = symbols.slice(1).join('') || '';

  const nameLen = card.name.length;
  const fontSize   = nameLen > 20 ? '15' : nameLen > 14 ? '18' : '22';
  const letterSpc  = nameLen > 20 ? '1'  : nameLen > 14 ? '2'  : '4';

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
  <defs>

    <!-- Starfield noise -->
    <filter id="stars" x="0%" y="0%" width="100%" height="100%" color-interpolation-filters="sRGB">
      <feTurbulence type="fractalNoise" baseFrequency="0.85 0.80" numOctaves="3"
                    stitchTiles="stitch" result="noise"/>
      <feColorMatrix type="saturate" values="0" in="noise" result="mono"/>
      <feComponentTransfer in="mono" result="dimmed">
        <feFuncA type="linear" slope="0.22"/>
      </feComponentTransfer>
      <feBlend in="SourceGraphic" in2="dimmed" mode="screen"/>
    </filter>

    <!-- Moon glow -->
    <filter id="moon-glow" x="-30%" y="-30%" width="160%" height="160%">
      <feDropShadow dx="0" dy="0" stdDeviation="14"
                    flood-color="${p.glowColor}" flood-opacity="0.5"/>
      <feDropShadow dx="0" dy="0" stdDeviation="5"
                    flood-color="${p.glowColor}" flood-opacity="0.3"/>
    </filter>

    <!-- Vignette -->
    <radialGradient id="vig" cx="50%" cy="45%" r="62%">
      <stop offset="0%"   stop-color="${p.bgMid}"  stop-opacity="0"/>
      <stop offset="100%" stop-color="#020408"     stop-opacity="0.80"/>
    </radialGradient>

    <!-- Subtle halo ring behind moon symbol -->
    <radialGradient id="halo" cx="50%" cy="50%" r="50%">
      <stop offset="0%"   stop-color="${p.glowColor}" stop-opacity="0.12"/>
      <stop offset="100%" stop-color="${p.glowColor}" stop-opacity="0"/>
    </radialGradient>

  </defs>

  <!-- ── Background ── -->
  <rect width="${W}" height="${H}" rx="14" fill="${p.bgBase}"/>
  <rect width="${W}" height="${H}" rx="14" fill="${p.bgMid}" filter="url(#stars)"/>
  <rect width="${W}" height="${H}" rx="14" fill="url(#vig)"/>

  <!-- ── Borders ── -->
  <rect x="7"  y="7"  width="266" height="472" rx="10" fill="none"
        stroke="${p.borderOuter}" stroke-width="1.5"/>
  <rect x="15" y="15" width="250" height="456" rx="7"  fill="none"
        stroke="${p.borderInner}" stroke-width="0.75"/>

  <!-- ── Corner accents ── -->
  <polyline points="15,34 15,15 34,15"       fill="none" stroke="${p.cornerAccent}" stroke-width="2" stroke-linecap="round"/>
  <polyline points="246,15 265,15 265,34"    fill="none" stroke="${p.cornerAccent}" stroke-width="2" stroke-linecap="round"/>
  <polyline points="15,452 15,471 34,471"    fill="none" stroke="${p.cornerAccent}" stroke-width="2" stroke-linecap="round"/>
  <polyline points="246,471 265,471 265,452" fill="none" stroke="${p.cornerAccent}" stroke-width="2" stroke-linecap="round"/>

  <!-- ── Category label (top) ── -->
  <text x="${CX}" y="40"
    font-family="Georgia, 'Palatino Linotype', serif"
    font-size="11" fill="${p.catColor}"
    text-anchor="middle" letter-spacing="3">${p.catLabel}</text>

  <!-- ── Halo behind moon ── -->
  <ellipse cx="${CX}" cy="234" rx="90" ry="88" fill="url(#halo)"/>

  <!-- ── Moon / phase symbol ── -->
  <text x="${CX}" y="248"
    font-family="'Segoe UI Emoji', 'Apple Color Emoji', 'Noto Color Emoji', sans-serif"
    font-size="130" text-anchor="middle" dominant-baseline="middle"
    filter="url(#moon-glow)">${moonSym}</text>

  <!-- ── Zodiac sign (if present) ── -->
  ${signSym ? `<text x="${CX}" y="330"
    font-family="'Segoe UI Symbol', 'Apple Symbols', sans-serif"
    font-size="36" fill="${p.symbolColor}" text-anchor="middle"
    filter="url(#moon-glow)">${signSym}</text>` : ''}

  <!-- ── Decorative divider ── -->
  <line x1="68" y1="${signSym ? '370' : '358'}" x2="${CX - 10}" y2="${signSym ? '370' : '358'}"
        stroke="${p.divColor}" stroke-width="0.75"/>
  <circle cx="${CX}" cy="${signSym ? '370' : '358'}" r="2.5" fill="${p.divColor}"/>
  <line x1="${CX + 10}" y1="${signSym ? '370' : '358'}" x2="212" y2="${signSym ? '370' : '358'}"
        stroke="${p.divColor}" stroke-width="0.75"/>

  <!-- ── Card name ── -->
  <text x="${CX}" y="${signSym ? '408' : '396'}"
    font-family="Georgia, 'Palatino Linotype', serif"
    font-size="${fontSize}" fill="${p.nameColor}"
    text-anchor="middle" letter-spacing="${letterSpc}">${card.name.toUpperCase()}</text>

  <!-- ── Lunar phase sublabel ── -->
  ${card.lunar_phase && card.lunar_phase !== card.name ? `<text x="${CX}" y="${signSym ? '434' : '422'}"
    font-family="Georgia, 'Palatino Linotype', serif"
    font-size="11" fill="${p.catColor}"
    text-anchor="middle" letter-spacing="2">${card.lunar_phase.toUpperCase()}</text>` : ''}

</svg>`;
}

// ── Write files ──────────────────────────────────────────────────────────────

const outDir = path.join(__dirname, 'public', 'images', 'moonology');
fs.mkdirSync(outDir, { recursive: true });

let count = 0;
for (const card of data) {
  const filePath = path.join(outDir, `${card.id}.svg`);
  fs.writeFileSync(filePath, generateSVG(card), 'utf8');
  count++;
}

console.log(`Generated ${count} SVG moonology cards → public/images/moonology/`);
