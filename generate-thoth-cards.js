/**
 * Generates SVG card images for the Thoth Tarot deck.
 * Design: Art Deco geometric style — color-keyed by element, Hebrew letters for
 * major arcana, suit symbols + numbers for minors, alchemical glyphs for courts.
 * Output: public/images/thoth/{id}.svg
 *
 * Run: node generate-thoth-cards.js
 */

const fs   = require('fs');
const path = require('path');
const data = require('./data/thoth.json');

// ── Element palettes ─────────────────────────────────────────────────────────

const PALETTES = {
  Fire:  { bgBase: '#0f0301', bgMid: '#190500', accent: '#c03816', glow: '#e05025', text: '#f0c080', dim: '#6a2a10', label: 'FIRE'  },
  Water: { bgBase: '#010710', bgMid: '#020f1e', accent: '#2860b8', glow: '#3888d8', text: '#90c8f0', dim: '#14386a', label: 'WATER' },
  Air:   { bgBase: '#04020c', bgMid: '#080418', accent: '#6828a8', glow: '#9040d8', text: '#c8a8f8', dim: '#2c1250', label: 'AIR'   },
  Earth: { bgBase: '#020602', bgMid: '#050d04', accent: '#387018', glow: '#50a020', text: '#a8d870', dim: '#1a3c0a', label: 'EARTH' },
};

// For compound elements like "Earth of Fire", the suit element drives colour
function paletteFor(element) {
  if (!element) return PALETTES.Air;
  const primary = element.includes(' of ') ? element.split(' of ')[1] : element;
  return PALETTES[primary] || PALETTES.Air;
}

// ── Hebrew letter map ─────────────────────────────────────────────────────────

const HEBREW = {
  Aleph:  'א', Beth:    'ב', Gimel:  'ג', Daleth: 'ד',
  He:     'ה', Heh:     'ה', Vau:    'ו', Vav:    'ו',
  Zayin:  'ז', Cheth:   'ח', Chet:   'ח', Teth:   'ט',
  Tet:    'ט', Yod:     'י', Kaph:   'כ', Kaf:    'כ',
  Lamed:  'ל', Mem:     'מ', Nun:    'נ', Samekh: 'ס',
  Ayin:   'ע', Peh:     'פ', Pe:     'פ', Tzaddi: 'צ',
  Tzaddy: 'צ', Qoph:    'ק', Koph:   'ק', Resh:   'ר',
  Shin:   'ש', Tau:     'ת', Tav:    'ת',
};

function extractHebrew(kabbala) {
  if (!kabbala) return '';
  const m = kabbala.match(/—\s+(\w+)/);
  return m ? (HEBREW[m[1]] || '') : '';
}

function extractLetterName(kabbala) {
  if (!kabbala) return '';
  const m = kabbala.match(/—\s+(\w+)/);
  return m ? m[1].toUpperCase() : '';
}

// ── Astrological glyph map ────────────────────────────────────────────────────

const ASTRO_GLYPH = {
  Sun: '☉', Moon: '☽', Mercury: '☿', Venus: '♀', Mars: '♂',
  Jupiter: '♃', Saturn: '♄', Uranus: '♅', Neptune: '♆', Pluto: '♇',
  Aries: '♈', Taurus: '♉', Gemini: '♊', Cancer: '♋',
  Leo: '♌', Virgo: '♍', Libra: '♎', Scorpio: '♏',
  Sagittarius: '♐', Capricorn: '♑', Aquarius: '♒', Pisces: '♓',
};

// Extract first recognisable glyph from the astro string (e.g. "Mars in Aries" → "♂♈")
function astroGlyphs(astro) {
  if (!astro) return '';
  const glyphs = [];
  for (const [name, glyph] of Object.entries(ASTRO_GLYPH)) {
    if (astro.includes(name)) glyphs.push(glyph);
    if (glyphs.length >= 2) break;
  }
  return glyphs.join('');
}

// ── Suit symbol SVG snippets ──────────────────────────────────────────────────
// All centred at cx=140, vertically around y=225 with span ~80px

function suitSymbol(suit, accent, _glow) {
  const filter = `filter="url(#suit-glow)"`;
  switch ((suit || '').toLowerCase()) {
    case 'wands':
      return `
  <!-- Wand: vertical staff with flame tip and three nodes -->
  <g ${filter} stroke="${accent}" stroke-linecap="round">
    <line x1="140" y1="175" x2="140" y2="285" stroke-width="3.5"/>
    <path d="M140,175 Q128,158 140,142 Q152,158 140,175" fill="${accent}" stroke="none" opacity="0.9"/>
    <rect x="133" y="212" width="14" height="5" rx="2.5" fill="${accent}" stroke="none" opacity="0.55"/>
    <rect x="133" y="238" width="14" height="5" rx="2.5" fill="${accent}" stroke="none" opacity="0.55"/>
    <rect x="133" y="264" width="14" height="5" rx="2.5" fill="${accent}" stroke="none" opacity="0.55"/>
  </g>`;

    case 'cups':
      return `
  <!-- Cup: chalice with wide bowl, thin stem, round base -->
  <g ${filter} fill="none" stroke="${accent}" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round">
    <path d="M116,178 Q110,215 115,228 Q122,248 140,248 Q158,248 165,228 Q170,215 164,178 Z"/>
    <line x1="140" y1="248" x2="140" y2="278"/>
    <path d="M120,278 Q140,272 160,278"/>
    <line x1="112,248" x2="168,248"/>
  </g>`;

    case 'swords':
      return `
  <!-- Sword: tapered blade, straight crossguard, round pommel -->
  <g ${filter}>
    <path d="M140,150 L134,268 L140,280 L146,268 Z" fill="${accent}" opacity="0.88"/>
    <path d="M113,215 Q140,210 167,215" stroke="${accent}" stroke-width="3.5" stroke-linecap="round" fill="none" ${filter}/>
    <ellipse cx="140" cy="280" rx="9" ry="6" fill="${accent}" opacity="0.70"/>
  </g>`;

    case 'disks':
    default:
      // Disk: pentagram inside a circle
      // Pentagram points (r=44 from center 140,225): top, lower-right, upper-left, upper-right, lower-left
      return `
  <!-- Disk: outer ring + pentagram -->
  <g ${filter}>
    <circle cx="140" cy="225" r="48" fill="none" stroke="${accent}" stroke-width="2.2" opacity="0.7"/>
    <circle cx="140" cy="225" r="42" fill="none" stroke="${accent}" stroke-width="0.8" opacity="0.35"/>
    <polygon points="140,183 158.4,237.8 109.4,206.2 170.6,206.2 121.6,237.8"
             fill="none" stroke="${accent}" stroke-width="2.2" stroke-linejoin="round"/>
  </g>`;
  }
}

// ── Court rank glyphs (alchemical element triangles) ─────────────────────────
// Princess = Earth = downward triangle + horizontal bar (⊕-like)
// Prince   = Air   = upward triangle + horizontal bar
// Queen    = Water = downward triangle (plain)
// Knight   = Fire  = upward triangle (plain)

function courtGlyph(name, accent, _glow) {
  const filter = `filter="url(#suit-glow)"`;
  if (name.includes('Knight')) return `
  <!-- Knight: Fire △ -->
  <g ${filter}>
    <polygon points="140,168 180,252 100,252" fill="none" stroke="${accent}" stroke-width="3" stroke-linejoin="round"/>
    <polygon points="140,182 168,240 112,240" fill="${accent}" opacity="0.18"/>
  </g>`;
  if (name.includes('Queen')) return `
  <!-- Queen: Water ▽ -->
  <g ${filter}>
    <polygon points="100,188 180,188 140,272" fill="none" stroke="${accent}" stroke-width="3" stroke-linejoin="round"/>
    <polygon points="112,200 168,200 140,256" fill="${accent}" opacity="0.18"/>
  </g>`;
  if (name.includes('Prince')) return `
  <!-- Prince: Air △ with midline -->
  <g ${filter}>
    <polygon points="140,168 180,252 100,252" fill="none" stroke="${accent}" stroke-width="3" stroke-linejoin="round"/>
    <line x1="100" y1="210" x2="180" y2="210" stroke="${accent}" stroke-width="2.5" opacity="0.8"/>
    <polygon points="140,182 168,240 112,240" fill="${accent}" opacity="0.14"/>
  </g>`;
  // Princess
  return `
  <!-- Princess: Earth ▽ with midline -->
  <g ${filter}>
    <polygon points="100,188 180,188 140,272" fill="none" stroke="${accent}" stroke-width="3" stroke-linejoin="round"/>
    <line x1="100" y1="230" x2="180" y2="230" stroke="${accent}" stroke-width="2.5" opacity="0.8"/>
    <polygon points="112,200 168,200 140,256" fill="${accent}" opacity="0.14"/>
  </g>`;
}

// ── Decorative geometry: diamond motif ───────────────────────────────────────

function diamondAccents(cx, y, accent) {
  return `
  <polygon points="${cx},${y-7} ${cx+5},${y} ${cx},${y+7} ${cx-5},${y}" fill="${accent}" opacity="0.55"/>`;
}

// ── Card name sizing ──────────────────────────────────────────────────────────

function nameFontSize(name) {
  const l = name.length;
  return l > 26 ? 11 : l > 20 ? 13 : l > 14 ? 16 : 19;
}

// ── SVG: MAJOR ARCANA ─────────────────────────────────────────────────────────

function majorSVG(card) {
  const p    = paletteFor(card.element);
  const heb  = extractHebrew(card.kabbala);
  const lname = extractLetterName(card.kabbala);
  const glyph = astroGlyphs(card.astro);
  const W = 280, H = 486, CX = W / 2;
  const numLabel = card.number !== undefined && card.number !== null ? String(card.number) : '';

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
  <defs>
    <filter id="noise" x="0%" y="0%" width="100%" height="100%" color-interpolation-filters="sRGB">
      <feTurbulence type="fractalNoise" baseFrequency="0.70 0.65" numOctaves="3" stitchTiles="stitch" result="nz"/>
      <feColorMatrix type="saturate" values="0" in="nz" result="mono"/>
      <feComponentTransfer in="mono" result="d"><feFuncA type="linear" slope="0.14"/></feComponentTransfer>
      <feBlend in="SourceGraphic" in2="d" mode="screen"/>
    </filter>
    <filter id="hglow" x="-30%" y="-30%" width="160%" height="160%">
      <feDropShadow dx="0" dy="0" stdDeviation="18" flood-color="${p.glow}" flood-opacity="0.50"/>
      <feDropShadow dx="0" dy="0" stdDeviation="6"  flood-color="${p.glow}" flood-opacity="0.30"/>
    </filter>
    <filter id="aglow" x="-40%" y="-40%" width="180%" height="180%">
      <feDropShadow dx="0" dy="0" stdDeviation="8" flood-color="${p.glow}" flood-opacity="0.55"/>
    </filter>
    <radialGradient id="vig" cx="50%" cy="44%" r="60%">
      <stop offset="0%"   stop-color="${p.bgMid}" stop-opacity="0"/>
      <stop offset="100%" stop-color="#010102"     stop-opacity="0.85"/>
    </radialGradient>
    <radialGradient id="halo" cx="50%" cy="50%" r="50%">
      <stop offset="0%"   stop-color="${p.glow}" stop-opacity="0.10"/>
      <stop offset="100%" stop-color="${p.glow}" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="rule" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%"   stop-color="${p.accent}" stop-opacity="0"/>
      <stop offset="30%"  stop-color="${p.accent}" stop-opacity="0.7"/>
      <stop offset="70%"  stop-color="${p.accent}" stop-opacity="0.7"/>
      <stop offset="100%" stop-color="${p.accent}" stop-opacity="0"/>
    </linearGradient>
  </defs>

  <!-- Background -->
  <rect width="${W}" height="${H}" rx="14" fill="${p.bgBase}"/>
  <rect width="${W}" height="${H}" rx="14" fill="${p.bgMid}" filter="url(#noise)"/>
  <rect width="${W}" height="${H}" rx="14" fill="url(#vig)"/>

  <!-- Borders -->
  <rect x="7"  y="7"  width="266" height="472" rx="10" fill="none" stroke="${p.accent}" stroke-width="1.2" opacity="0.5"/>
  <rect x="14" y="14" width="252" height="458" rx="7"  fill="none" stroke="${p.accent}" stroke-width="0.6" opacity="0.25"/>

  <!-- Corner diamonds -->
  <polygon points="21,21 27,15 33,21 27,27" fill="${p.accent}" opacity="0.6"/>
  <polygon points="247,21 253,15 259,21 253,27" fill="${p.accent}" opacity="0.6"/>
  <polygon points="21,465 27,459 33,465 27,471" fill="${p.accent}" opacity="0.6"/>
  <polygon points="247,465 253,459 259,465 253,471" fill="${p.accent}" opacity="0.6"/>

  <!-- Number + element label (top) -->
  <text x="${CX}" y="36" font-family="Georgia, serif" font-size="10" fill="${p.dim}"
        text-anchor="middle" letter-spacing="4">${p.label}</text>
  ${numLabel ? `<text x="${CX}" y="56" font-family="Georgia, serif" font-size="22"
        fill="${p.accent}" text-anchor="middle" opacity="0.75" letter-spacing="2">${numLabel}</text>` : ''}

  <!-- Halo behind Hebrew letter -->
  <ellipse cx="${CX}" cy="228" rx="78" ry="76" fill="url(#halo)"/>

  <!-- Hebrew letter (main glyph) -->
  ${heb ? `<text x="${CX}" y="265" font-family="'Segoe UI Symbol','Noto Sans Hebrew','Arial Hebrew',serif"
        font-size="152" text-anchor="middle" dominant-baseline="middle"
        fill="${p.accent}" filter="url(#hglow)">${heb}</text>` : ''}

  <!-- Astrological glyph -->
  ${glyph ? `<text x="${CX}" y="322" font-family="'Segoe UI Symbol','Apple Symbols',sans-serif"
        font-size="28" fill="${p.text}" text-anchor="middle" opacity="0.80"
        filter="url(#aglow)">${glyph}</text>` : ''}

  <!-- Decorative rule -->
  <line x1="48" y1="348" x2="232" y2="348" stroke="url(#rule)" stroke-width="0.8"/>
  ${diamondAccents(CX, 348, p.accent)}

  <!-- Letter name label -->
  ${lname ? `<text x="${CX}" y="372" font-family="Georgia, serif" font-size="9.5" fill="${p.dim}"
        text-anchor="middle" letter-spacing="3">${lname}</text>` : ''}

  <!-- Card name -->
  <text x="${CX}" y="408" font-family="Georgia, serif"
        font-size="${nameFontSize(card.name)}" fill="${p.text}"
        text-anchor="middle" letter-spacing="2.5">${card.name.toUpperCase()}</text>

  <!-- Astro text label -->
  <text x="${CX}" y="432" font-family="Georgia, serif" font-size="9" fill="${p.dim}"
        text-anchor="middle" letter-spacing="2">${(card.astro || '').toUpperCase()}</text>

</svg>`;
}

// ── SVG: MINOR ARCANA ─────────────────────────────────────────────────────────

function minorSVG(card) {
  const p = paletteFor(card.element);
  const W = 280, H = 486, CX = W / 2;

  // Number label: "ACE" or "2"–"10"
  const numRaw = card.name.split(' ')[0].toUpperCase();
  const numDisplay = numRaw === 'ACE' ? 'ACE' : numRaw;
  const numFontSize = numDisplay === 'ACE' ? 46 : 64;

  // Kabbala label: "KETHER IN FIRE" → trim to fit
  const kabLabel = (card.kabbala || '').toUpperCase();

  // Astro label
  const astroLabel = (card.astro || '').toUpperCase();

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
  <defs>
    <filter id="noise" x="0%" y="0%" width="100%" height="100%" color-interpolation-filters="sRGB">
      <feTurbulence type="fractalNoise" baseFrequency="0.70 0.65" numOctaves="3" stitchTiles="stitch" result="nz"/>
      <feColorMatrix type="saturate" values="0" in="nz" result="mono"/>
      <feComponentTransfer in="mono" result="d"><feFuncA type="linear" slope="0.14"/></feComponentTransfer>
      <feBlend in="SourceGraphic" in2="d" mode="screen"/>
    </filter>
    <filter id="suit-glow" x="-25%" y="-25%" width="150%" height="150%">
      <feDropShadow dx="0" dy="0" stdDeviation="12" flood-color="${p.glow}" flood-opacity="0.45"/>
      <feDropShadow dx="0" dy="0" stdDeviation="4"  flood-color="${p.glow}" flood-opacity="0.25"/>
    </filter>
    <filter id="numglow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="0" stdDeviation="10" flood-color="${p.glow}" flood-opacity="0.40"/>
    </filter>
    <radialGradient id="vig" cx="50%" cy="44%" r="60%">
      <stop offset="0%"   stop-color="${p.bgMid}" stop-opacity="0"/>
      <stop offset="100%" stop-color="#010102"     stop-opacity="0.85"/>
    </radialGradient>
    <linearGradient id="rule" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%"   stop-color="${p.accent}" stop-opacity="0"/>
      <stop offset="30%"  stop-color="${p.accent}" stop-opacity="0.7"/>
      <stop offset="70%"  stop-color="${p.accent}" stop-opacity="0.7"/>
      <stop offset="100%" stop-color="${p.accent}" stop-opacity="0"/>
    </linearGradient>
  </defs>

  <!-- Background -->
  <rect width="${W}" height="${H}" rx="14" fill="${p.bgBase}"/>
  <rect width="${W}" height="${H}" rx="14" fill="${p.bgMid}" filter="url(#noise)"/>
  <rect width="${W}" height="${H}" rx="14" fill="url(#vig)"/>

  <!-- Borders -->
  <rect x="7"  y="7"  width="266" height="472" rx="10" fill="none" stroke="${p.accent}" stroke-width="1.2" opacity="0.5"/>
  <rect x="14" y="14" width="252" height="458" rx="7"  fill="none" stroke="${p.accent}" stroke-width="0.6" opacity="0.25"/>

  <!-- Corner diamonds -->
  <polygon points="21,21 27,15 33,21 27,27" fill="${p.accent}" opacity="0.6"/>
  <polygon points="247,21 253,15 259,21 253,27" fill="${p.accent}" opacity="0.6"/>
  <polygon points="21,465 27,459 33,465 27,471" fill="${p.accent}" opacity="0.6"/>
  <polygon points="247,465 253,459 259,465 253,471" fill="${p.accent}" opacity="0.6"/>

  <!-- Kabbala label (top) -->
  <text x="${CX}" y="36" font-family="Georgia, serif" font-size="9" fill="${p.dim}"
        text-anchor="middle" letter-spacing="2">${kabLabel}</text>

  <!-- Large number -->
  <text x="${CX}" y="${numDisplay === 'ACE' ? 155 : 160}" font-family="Georgia, serif"
        font-size="${numFontSize}" fill="${p.accent}" text-anchor="middle"
        letter-spacing="-1" opacity="0.80" filter="url(#numglow)">${numDisplay}</text>

  <!-- Suit symbol -->
  ${suitSymbol(card.suit, p.accent, p.glow)}

  <!-- Decorative rule -->
  <line x1="48" y1="308" x2="232" y2="308" stroke="url(#rule)" stroke-width="0.8"/>
  ${diamondAccents(CX, 308, p.accent)}

  <!-- Astro label -->
  <text x="${CX}" y="332" font-family="Georgia, serif" font-size="10" fill="${p.dim}"
        text-anchor="middle" letter-spacing="2.5">${astroLabel}</text>

  <!-- Card name -->
  <text x="${CX}" y="370" font-family="Georgia, serif"
        font-size="${nameFontSize(card.name)}" fill="${p.text}"
        text-anchor="middle" letter-spacing="2.5">${card.name.toUpperCase()}</text>

  <!-- Element label -->
  <text x="${CX}" y="394" font-family="Georgia, serif" font-size="9" fill="${p.dim}"
        text-anchor="middle" letter-spacing="3">${(card.element || '').toUpperCase()}</text>

</svg>`;
}

// ── SVG: COURT CARDS ─────────────────────────────────────────────────────────

function courtSVG(card) {
  // Court cards: outer element = suit element, inner = card's specific sub-element
  const p = paletteFor(card.element);
  const W = 280, H = 486, CX = W / 2;

  const rank = card.name.split(' ')[0].toUpperCase(); // PRINCESS / PRINCE / QUEEN / KNIGHT
  const astroLabel = (card.astro || '').toUpperCase();

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
  <defs>
    <filter id="noise" x="0%" y="0%" width="100%" height="100%" color-interpolation-filters="sRGB">
      <feTurbulence type="fractalNoise" baseFrequency="0.70 0.65" numOctaves="3" stitchTiles="stitch" result="nz"/>
      <feColorMatrix type="saturate" values="0" in="nz" result="mono"/>
      <feComponentTransfer in="mono" result="d"><feFuncA type="linear" slope="0.14"/></feComponentTransfer>
      <feBlend in="SourceGraphic" in2="d" mode="screen"/>
    </filter>
    <filter id="suit-glow" x="-25%" y="-25%" width="150%" height="150%">
      <feDropShadow dx="0" dy="0" stdDeviation="14" flood-color="${p.glow}" flood-opacity="0.50"/>
      <feDropShadow dx="0" dy="0" stdDeviation="5"  flood-color="${p.glow}" flood-opacity="0.28"/>
    </filter>
    <radialGradient id="vig" cx="50%" cy="44%" r="60%">
      <stop offset="0%"   stop-color="${p.bgMid}" stop-opacity="0"/>
      <stop offset="100%" stop-color="#010102"     stop-opacity="0.85"/>
    </radialGradient>
    <linearGradient id="rule" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%"   stop-color="${p.accent}" stop-opacity="0"/>
      <stop offset="30%"  stop-color="${p.accent}" stop-opacity="0.7"/>
      <stop offset="70%"  stop-color="${p.accent}" stop-opacity="0.7"/>
      <stop offset="100%" stop-color="${p.accent}" stop-opacity="0"/>
    </linearGradient>
  </defs>

  <!-- Background -->
  <rect width="${W}" height="${H}" rx="14" fill="${p.bgBase}"/>
  <rect width="${W}" height="${H}" rx="14" fill="${p.bgMid}" filter="url(#noise)"/>
  <rect width="${W}" height="${H}" rx="14" fill="url(#vig)"/>

  <!-- Borders -->
  <rect x="7"  y="7"  width="266" height="472" rx="10" fill="none" stroke="${p.accent}" stroke-width="1.2" opacity="0.5"/>
  <rect x="14" y="14" width="252" height="458" rx="7"  fill="none" stroke="${p.accent}" stroke-width="0.6" opacity="0.25"/>

  <!-- Corner diamonds -->
  <polygon points="21,21 27,15 33,21 27,27" fill="${p.accent}" opacity="0.6"/>
  <polygon points="247,21 253,15 259,21 253,27" fill="${p.accent}" opacity="0.6"/>
  <polygon points="21,465 27,459 33,465 27,471" fill="${p.accent}" opacity="0.6"/>
  <polygon points="247,465 253,459 259,465 253,471" fill="${p.accent}" opacity="0.6"/>

  <!-- Element label (top) -->
  <text x="${CX}" y="36" font-family="Georgia, serif" font-size="9" fill="${p.dim}"
        text-anchor="middle" letter-spacing="3">${(card.element || '').toUpperCase()}</text>

  <!-- Rank label (small, above glyph) -->
  <text x="${CX}" y="58" font-family="Georgia, serif" font-size="13" fill="${p.accent}"
        text-anchor="middle" letter-spacing="5" opacity="0.60">${rank}</text>

  <!-- Court glyph (alchemical element symbol) -->
  ${courtGlyph(card.name, p.accent, p.glow)}

  <!-- Decorative rule -->
  <line x1="48" y1="308" x2="232" y2="308" stroke="url(#rule)" stroke-width="0.8"/>
  ${diamondAccents(CX, 308, p.accent)}

  <!-- Astro label -->
  <text x="${CX}" y="332" font-family="Georgia, serif" font-size="9" fill="${p.dim}"
        text-anchor="middle" letter-spacing="2.5">${astroLabel}</text>

  <!-- Card name -->
  <text x="${CX}" y="374" font-family="Georgia, serif"
        font-size="${nameFontSize(card.name)}" fill="${p.text}"
        text-anchor="middle" letter-spacing="2">${card.name.toUpperCase()}</text>

  <!-- Suit label -->
  <text x="${CX}" y="398" font-family="Georgia, serif" font-size="10" fill="${p.dim}"
        text-anchor="middle" letter-spacing="3">${(card.suit || '').toUpperCase()}</text>

</svg>`;
}

// ── Dispatch ──────────────────────────────────────────────────────────────────

function generateSVG(card) {
  if (card.arcana === 'major')  return majorSVG(card);
  if (card.arcana === 'court')  return courtSVG(card);
  return minorSVG(card); // minor (2-10 + ace)
}

// ── Write files ───────────────────────────────────────────────────────────────

const outDir = path.join(__dirname, 'public', 'images', 'thoth');
fs.mkdirSync(outDir, { recursive: true });

let count = 0;
for (const card of data) {
  const filePath = path.join(outDir, `${card.id}.svg`);
  fs.writeFileSync(filePath, generateSVG(card), 'utf8');
  count++;
}

console.log(`Generated ${count} SVG Thoth cards → public/images/thoth/`);
console.log(`  Major arcana: ${data.filter(c => c.arcana === 'major').length}`);
console.log(`  Minor arcana: ${data.filter(c => c.arcana === 'minor').length}`);
console.log(`  Court cards:  ${data.filter(c => c.arcana === 'court').length}`);
