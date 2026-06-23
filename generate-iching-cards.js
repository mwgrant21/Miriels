/**
 * Generates SVG card images for the I Ching deck.
 * Each card displays the hexagram Unicode symbol, number, Chinese name, and trigrams.
 * Output: public/images/iching/{id}.svg
 *
 * Run: node generate-iching-cards.js
 */

const fs   = require('fs');
const path = require('path');
const data = require('./data/iching.json');

// ── Trigram → element palette ─────────────────────────────────────────────────
// Each hexagram is composed of two trigrams (upper + lower).
// We tint the card based on the upper trigram for visual variety.

const TRIGRAM_TINT = {
  'Heaven':   { accent: '#c8a84c', glow: '#e0c060', catColor: '#5a4a10' },
  'Earth':    { accent: '#8a7040', glow: '#b09050', catColor: '#3a2a10' },
  'Thunder':  { accent: '#6060d0', glow: '#8080f0', catColor: '#1a1a60' },
  'Water':    { accent: '#4090c0', glow: '#60b0e0', catColor: '#103050' },
  'Mountain': { accent: '#807060', glow: '#a09080', catColor: '#302820' },
  'Wind':     { accent: '#50a070', glow: '#70c090', catColor: '#103020' },
  'Fire':     { accent: '#c06030', glow: '#e08040', catColor: '#501a08' },
  'Lake':     { accent: '#5090a0', glow: '#70b0c0', catColor: '#103040' },
};

const BASE = {
  bgBase:      '#080810',
  bgMid:       '#0e0e1c',
  borderOuter: '#2a2a40',
  borderInner: '#1c1c2e',
  cornerBase:  '#3a3a58',
  nameColor:   '#d8d0e8',
  numColor:    '#6a6080',
};

// ── SVG builder ──────────────────────────────────────────────────────────────

function generateSVG(card) {
  const W  = 280;
  const H  = 486;
  const CX = W / 2;

  const upperTrigram = card.trigrams ? card.trigrams.upper : 'Heaven';
  const lowerTrigram = card.trigrams ? card.trigrams.lower : 'Heaven';
  const tint = TRIGRAM_TINT[upperTrigram] || TRIGRAM_TINT['Heaven'];

  const nameLen  = card.name.length;
  const nameFontSize  = nameLen > 24 ? '12' : nameLen > 18 ? '14' : nameLen > 12 ? '17' : '20';
  const nameLetterSpc = nameLen > 18 ? '1' : nameLen > 12 ? '2' : '3';

  // Number formatted as Roman numeral-ish with leading zero
  const numStr = String(card.number).padStart(2, '0');

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
  <defs>

    <!-- Parchment / noise texture -->
    <filter id="noise" x="0%" y="0%" width="100%" height="100%" color-interpolation-filters="sRGB">
      <feTurbulence type="fractalNoise" baseFrequency="0.65 0.60" numOctaves="3"
                    stitchTiles="stitch" result="nz"/>
      <feColorMatrix type="saturate" values="0" in="nz" result="mono"/>
      <feComponentTransfer in="mono" result="dimmed">
        <feFuncA type="linear" slope="0.15"/>
      </feComponentTransfer>
      <feBlend in="SourceGraphic" in2="dimmed" mode="screen"/>
    </filter>

    <!-- Hexagram glow -->
    <filter id="hex-glow" x="-25%" y="-25%" width="150%" height="150%">
      <feDropShadow dx="0" dy="0" stdDeviation="16"
                    flood-color="${tint.glow}" flood-opacity="0.45"/>
      <feDropShadow dx="0" dy="0" stdDeviation="5"
                    flood-color="${tint.glow}" flood-opacity="0.25"/>
    </filter>

    <!-- Vignette -->
    <radialGradient id="vig" cx="50%" cy="44%" r="60%">
      <stop offset="0%"   stop-color="${BASE.bgMid}"  stop-opacity="0"/>
      <stop offset="100%" stop-color="#020204"          stop-opacity="0.82"/>
    </radialGradient>

    <!-- Subtle radial halo behind hexagram -->
    <radialGradient id="halo" cx="50%" cy="50%" r="50%">
      <stop offset="0%"   stop-color="${tint.glow}" stop-opacity="0.10"/>
      <stop offset="100%" stop-color="${tint.glow}" stop-opacity="0"/>
    </radialGradient>

    <!-- Thin horizontal rule gradient -->
    <linearGradient id="rule-grad" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%"   stop-color="${tint.accent}" stop-opacity="0"/>
      <stop offset="30%"  stop-color="${tint.accent}" stop-opacity="0.6"/>
      <stop offset="70%"  stop-color="${tint.accent}" stop-opacity="0.6"/>
      <stop offset="100%" stop-color="${tint.accent}" stop-opacity="0"/>
    </linearGradient>

  </defs>

  <!-- ── Background ── -->
  <rect width="${W}" height="${H}" rx="14" fill="${BASE.bgBase}"/>
  <rect width="${W}" height="${H}" rx="14" fill="${BASE.bgMid}" filter="url(#noise)"/>
  <rect width="${W}" height="${H}" rx="14" fill="url(#vig)"/>

  <!-- ── Borders ── -->
  <rect x="7"  y="7"  width="266" height="472" rx="10" fill="none"
        stroke="${BASE.borderOuter}" stroke-width="1.5"/>
  <rect x="15" y="15" width="250" height="456" rx="7"  fill="none"
        stroke="${BASE.borderInner}" stroke-width="0.75"/>

  <!-- ── Corner accents ── -->
  <polyline points="15,34 15,15 34,15"       fill="none" stroke="${tint.accent}" stroke-width="1.5" stroke-linecap="round" opacity="0.55"/>
  <polyline points="246,15 265,15 265,34"    fill="none" stroke="${tint.accent}" stroke-width="1.5" stroke-linecap="round" opacity="0.55"/>
  <polyline points="15,452 15,471 34,471"    fill="none" stroke="${tint.accent}" stroke-width="1.5" stroke-linecap="round" opacity="0.55"/>
  <polyline points="246,471 265,471 265,452" fill="none" stroke="${tint.accent}" stroke-width="1.5" stroke-linecap="round" opacity="0.55"/>

  <!-- ── Hexagram number (top) ── -->
  <text x="${CX}" y="42"
    font-family="Georgia, 'Palatino Linotype', serif"
    font-size="11" fill="${BASE.numColor}"
    text-anchor="middle" letter-spacing="4">HEXAGRAM ${numStr}</text>

  <!-- ── Halo behind symbol ── -->
  <ellipse cx="${CX}" cy="228" rx="82" ry="80" fill="url(#halo)"/>

  <!-- ── Hexagram Unicode symbol (main visual) ── -->
  <text x="${CX}" y="248"
    font-family="'Segoe UI Symbol', 'Apple Symbols', 'Noto Sans CJK SC', 'Source Han Sans', sans-serif"
    font-size="140" text-anchor="middle" dominant-baseline="middle"
    fill="${tint.accent}"
    filter="url(#hex-glow)">${card.symbol}</text>

  <!-- ── Trigram labels ── -->
  <text x="${CX}" y="330"
    font-family="Georgia, 'Palatino Linotype', serif"
    font-size="10" fill="${tint.catColor}"
    text-anchor="middle" letter-spacing="2.5">${upperTrigram.toUpperCase()} / ${lowerTrigram.toUpperCase()}</text>

  <!-- ── Decorative rule ── -->
  <line x1="50" y1="353" x2="230" y2="353" stroke="url(#rule-grad)" stroke-width="0.75"/>

  <!-- ── Chinese name ── -->
  <text x="${CX}" y="378"
    font-family="Georgia, 'Palatino Linotype', serif"
    font-size="13" fill="${tint.accent}"
    text-anchor="middle" letter-spacing="3" opacity="0.75">${card.chineseName.toUpperCase()}</text>

  <!-- ── English name ── -->
  <text x="${CX}" y="408"
    font-family="Georgia, 'Palatino Linotype', serif"
    font-size="${nameFontSize}" fill="${BASE.nameColor}"
    text-anchor="middle" letter-spacing="${nameLetterSpc}">${card.name.toUpperCase()}</text>

</svg>`;
}

// ── Write files ──────────────────────────────────────────────────────────────

const outDir = path.join(__dirname, 'public', 'images', 'iching');
fs.mkdirSync(outDir, { recursive: true });

let count = 0;
for (const card of data) {
  const filePath = path.join(outDir, `${card.id}.svg`);
  fs.writeFileSync(filePath, generateSVG(card), 'utf8');
  count++;
}

console.log(`Generated ${count} SVG I Ching cards → public/images/iching/`);
