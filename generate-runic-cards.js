/**
 * Generates SVG runestone card images for the Elder Futhark deck.
 * Output: public/images/runic/rune-01.svg through rune-24.svg
 *
 * Run: node generate-runic-cards.js
 */

const fs   = require('fs');
const path = require('path');

const runes = [
  { id: 'rune-01', name: 'Fehu',     symbol: '\u16A0', aett: "Freyr's Aett",  num: 'I'      },
  { id: 'rune-02', name: 'Uruz',     symbol: '\u16A2', aett: "Freyr's Aett",  num: 'II'     },
  { id: 'rune-03', name: 'Thurisaz', symbol: '\u16A6', aett: "Freyr's Aett",  num: 'III'    },
  { id: 'rune-04', name: 'Ansuz',    symbol: '\u16A8', aett: "Freyr's Aett",  num: 'IV'     },
  { id: 'rune-05', name: 'Raidho',   symbol: '\u16B1', aett: "Freyr's Aett",  num: 'V'      },
  { id: 'rune-06', name: 'Kenaz',    symbol: '\u16B2', aett: "Freyr's Aett",  num: 'VI'     },
  { id: 'rune-07', name: 'Gebo',     symbol: '\u16B7', aett: "Freyr's Aett",  num: 'VII'    },
  { id: 'rune-08', name: 'Wunjo',    symbol: '\u16B9', aett: "Freyr's Aett",  num: 'VIII'   },
  { id: 'rune-09', name: 'Hagalaz',  symbol: '\u16BA', aett: "Hagal's Aett",  num: 'IX'     },
  { id: 'rune-10', name: 'Nauthiz',  symbol: '\u16BE', aett: "Hagal's Aett",  num: 'X'      },
  { id: 'rune-11', name: 'Isa',      symbol: '\u16C1', aett: "Hagal's Aett",  num: 'XI'     },
  { id: 'rune-12', name: 'Jera',     symbol: '\u16C3', aett: "Hagal's Aett",  num: 'XII'    },
  { id: 'rune-13', name: 'Eihwaz',   symbol: '\u16C7', aett: "Hagal's Aett",  num: 'XIII'   },
  { id: 'rune-14', name: 'Perthro',  symbol: '\u16C8', aett: "Hagal's Aett",  num: 'XIV'    },
  { id: 'rune-15', name: 'Algiz',    symbol: '\u16C9', aett: "Hagal's Aett",  num: 'XV'     },
  { id: 'rune-16', name: 'Sowilo',   symbol: '\u16CA', aett: "Hagal's Aett",  num: 'XVI'    },
  { id: 'rune-17', name: 'Tiwaz',    symbol: '\u16CF', aett: "Tyr's Aett",    num: 'XVII'   },
  { id: 'rune-18', name: 'Berkano',  symbol: '\u16D2', aett: "Tyr's Aett",    num: 'XVIII'  },
  { id: 'rune-19', name: 'Ehwaz',    symbol: '\u16D6', aett: "Tyr's Aett",    num: 'XIX'    },
  { id: 'rune-20', name: 'Mannaz',   symbol: '\u16D7', aett: "Tyr's Aett",    num: 'XX'     },
  { id: 'rune-21', name: 'Laguz',    symbol: '\u16DA', aett: "Tyr's Aett",    num: 'XXI'    },
  { id: 'rune-22', name: 'Ingwaz',   symbol: '\u16DC', aett: "Tyr's Aett",    num: 'XXII'   },
  { id: 'rune-23', name: 'Dagaz',    symbol: '\u16DE', aett: "Tyr's Aett",    num: 'XXIII'  },
  { id: 'rune-24', name: 'Othala',   symbol: '\u16DF', aett: "Tyr's Aett",    num: 'XXIV'   },
];

// Color palette per aett
const AETT_PALETTE = {
  "Freyr's Aett": {
    bgBase:     '#2b1f14',
    bgMid:      '#3a2a1a',
    borderOuter:'#7a5530',
    borderInner:'#5c3f22',
    cornerAccent:'#9a6f42',
    glowColor:  '#c4954a',
    runeColor:  '#e8d0a0',
    nameColor:  '#c8a870',
    aettColor:  '#7a5530',
    divColor:   '#5c3f22',
  },
  "Hagal's Aett": {
    bgBase:     '#171e22',
    bgMid:      '#222d33',
    borderOuter:'#3d5560',
    borderInner:'#2d404a',
    cornerAccent:'#4e7080',
    glowColor:  '#7ab0c0',
    runeColor:  '#c8dde4',
    nameColor:  '#96c0cc',
    aettColor:  '#3d6070',
    divColor:   '#2d404a',
  },
  "Tyr's Aett": {
    bgBase:     '#1a1622',
    bgMid:      '#251f30',
    borderOuter:'#504060',
    borderInner:'#3a2e48',
    cornerAccent:'#7060a0',
    glowColor:  '#9080c8',
    runeColor:  '#d0c8e8',
    nameColor:  '#a898d0',
    aettColor:  '#504060',
    divColor:   '#3a2e48',
  },
};

function generateSVG(rune) {
  const p   = AETT_PALETTE[rune.aett];
  const W   = 280;
  const H   = 486;
  const CX  = W / 2;

  // How many chars in the name (for letter-spacing)
  const nameSpacing = rune.name.length > 6 ? '4' : '6';

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
  <defs>

    <!-- Stone noise texture -->
    <filter id="stone" x="0%" y="0%" width="100%" height="100%" color-interpolation-filters="sRGB">
      <feTurbulence type="fractalNoise" baseFrequency="0.72 0.68" numOctaves="4"
                    stitchTiles="stitch" result="noise"/>
      <feColorMatrix type="saturate" values="0" in="noise" result="mono"/>
      <feComponentTransfer in="mono" result="dimmed">
        <feFuncA type="linear" slope="0.28"/>
      </feComponentTransfer>
      <feBlend in="SourceGraphic" in2="dimmed" mode="multiply"/>
    </filter>

    <!-- Subtle glow around the rune -->
    <filter id="rune-glow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="0" stdDeviation="10"
                    flood-color="${p.glowColor}" flood-opacity="0.45"/>
      <feDropShadow dx="0" dy="2" stdDeviation="3"
                    flood-color="#000000" flood-opacity="0.6"/>
    </filter>

    <!-- Vignette: dark edges -->
    <radialGradient id="vig" cx="50%" cy="48%" r="65%">
      <stop offset="0%"   stop-color="${p.bgMid}"  stop-opacity="0"/>
      <stop offset="100%" stop-color="#060406"     stop-opacity="0.75"/>
    </radialGradient>

    <!-- Subtle vertical gradient on bg to give slab feel -->
    <linearGradient id="slab" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%"   stop-color="${p.bgMid}"  stop-opacity="0.4"/>
      <stop offset="50%"  stop-color="transparent"/>
      <stop offset="100%" stop-color="#000000"     stop-opacity="0.35"/>
    </linearGradient>

  </defs>

  <!-- ── Background ── -->
  <rect width="${W}" height="${H}" rx="14" fill="${p.bgBase}"/>
  <rect width="${W}" height="${H}" rx="14" fill="${p.bgMid}" filter="url(#stone)"/>
  <rect width="${W}" height="${H}" rx="14" fill="url(#slab)"/>
  <rect width="${W}" height="${H}" rx="14" fill="url(#vig)"/>

  <!-- ── Borders ── -->
  <rect x="7"  y="7"  width="266" height="472" rx="10" fill="none"
        stroke="${p.borderOuter}" stroke-width="1.5"/>
  <rect x="15" y="15" width="250" height="456" rx="7"  fill="none"
        stroke="${p.borderInner}" stroke-width="0.75"/>

  <!-- ── Corner accents (L-shaped) ── -->
  <!-- top-left -->
  <polyline points="15,34 15,15 34,15"     fill="none" stroke="${p.cornerAccent}" stroke-width="2" stroke-linecap="round"/>
  <!-- top-right -->
  <polyline points="246,15 265,15 265,34"  fill="none" stroke="${p.cornerAccent}" stroke-width="2" stroke-linecap="round"/>
  <!-- bottom-left -->
  <polyline points="15,452 15,471 34,471"  fill="none" stroke="${p.cornerAccent}" stroke-width="2" stroke-linecap="round"/>
  <!-- bottom-right -->
  <polyline points="246,471 265,471 265,452" fill="none" stroke="${p.cornerAccent}" stroke-width="2" stroke-linecap="round"/>

  <!-- ── Roman numeral (top-center, subtle) ── -->
  <text x="${CX}" y="40"
    font-family="Georgia, 'Palatino Linotype', Palatino, serif"
    font-size="13" fill="${p.aettColor}"
    text-anchor="middle" letter-spacing="3">${rune.num}</text>

  <!-- ── Rune symbol ── -->
  <text x="${CX}" y="242"
    font-family="'Segoe UI Symbol', 'Apple Symbols', 'Noto Sans Runic', 'FreeMono', serif"
    font-size="190" fill="${p.runeColor}"
    text-anchor="middle" dominant-baseline="middle"
    filter="url(#rune-glow)">${rune.symbol}</text>

  <!-- ── Decorative divider ── -->
  <line x1="68" y1="380" x2="${CX - 10}" y2="380" stroke="${p.divColor}" stroke-width="0.75"/>
  <circle cx="${CX}" cy="380" r="2.5" fill="${p.divColor}"/>
  <line x1="${CX + 10}" y1="380" x2="212" y2="380" stroke="${p.divColor}" stroke-width="0.75"/>

  <!-- ── Rune name ── -->
  <text x="${CX}" y="418"
    font-family="Georgia, 'Palatino Linotype', Palatino, serif"
    font-size="24" fill="${p.nameColor}"
    text-anchor="middle" letter-spacing="${nameSpacing}">${rune.name.toUpperCase()}</text>

  <!-- ── Aett label ── -->
  <text x="${CX}" y="448"
    font-family="Georgia, 'Palatino Linotype', Palatino, serif"
    font-size="11" fill="${p.aettColor}"
    text-anchor="middle" letter-spacing="2">${rune.aett.toUpperCase()}</text>

</svg>`;
}

// ── Write files ──────────────────────────────────────────────────────────────

const outDir = path.join(__dirname, 'public', 'images', 'runic');
fs.mkdirSync(outDir, { recursive: true });

for (const rune of runes) {
  const filePath = path.join(outDir, `${rune.id}.svg`);
  fs.writeFileSync(filePath, generateSVG(rune), 'utf8');
}

console.log(`Generated ${runes.length} SVG runestone cards → public/images/runic/`);
