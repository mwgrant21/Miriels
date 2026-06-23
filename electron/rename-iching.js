'use strict';
const fs = require('fs');
const path = require('path');

const imgDir = path.join(__dirname, '..', 'public', 'images', 'iching');

// current filename (no ext) → target iching number (padded to 2 digits)
const mapping = [
  // Disambiguated pairs: plain name = lower hex, suffixed = higher hex
  ['qian',           '01'],  // Qián  — The Creative
  ['kun',            '02'],  // Kūn   — The Receptive
  ['zhun',           '03'],  // Zhūn  — Difficulty at the Beginning
  ['meng',           '04'],  // Méng  — Youthful Folly
  ['xu',             '05'],  // Xū    — Waiting
  ['song',           '06'],  // Sòng  — Conflict
  ['shi',            '07'],  // Shī   — The Army
  ['bi',             '08'],  // Bǐ    — Holding Together
  ['xiao chu',       '09'],  // Xiǎo Xù — Small Taming
  ['lu',             '10'],  // Lǚ    — Treading
  ['tai',            '11'],  // Tài   — Peace
  ['pi',             '12'],  // Pǐ    — Standstill
  ['tong ren',       '13'],  // Tóng Rén — Fellowship
  ['da you',         '14'],  // Dà Yǒu — Great Possession
  ['qian-humbling',  '15'],  // Qiān  — Modesty
  ['yu',             '16'],  // Yù    — Enthusiasm
  ['sui',            '17'],  // Suí   — Following
  ['gu',             '18'],  // Gǔ    — Decay
  ['lin',            '19'],  // Lín   — Approach
  ['guan',           '20'],  // Guān  — Contemplation
  ['shi ke',         '21'],  // Shì Kè — Biting Through
  ['bi-grace',       '22'],  // Bì    — Grace
  ['bo',             '23'],  // Bō    — Splitting Apart
  ['fu',             '24'],  // Fù    — Return
  ['wu wang',        '25'],  // Wú Wàng — Innocence
  ['da xu',          '26'],  // Dà Xù — Great Taming
  ['yi',             '27'],  // Yí    — Nourishment  ← see note below
  ['da guo',         '28'],  // Dà Guò — Great Excess
  ['kan',            '29'],  // Kǎn   — The Abyss
  ['li',             '30'],  // Lí    — The Clinging
  ['xian',           '31'],  // Xián  — Influence
  ['heng',           '32'],  // Héng  — Duration
  ['dun',            '33'],  // Dùn   — Retreat
  ['da zhuang',      '34'],  // Dà Zhuàng — Great Power
  ['jin',            '35'],  // Jìn   — Progress
  ['ming yi',        '36'],  // Míng Yí — Darkening of the Light
  ['jia ren',        '37'],  // Jiā Rén — The Family
  ['kui',            '38'],  // Kuí   — Opposition
  ['jian',           '39'],  // Jiǎn  — Obstruction
  ['jie',            '40'],  // Jiě   — Deliverance
  ['sun',            '41'],  // Sǔn   — Decrease
  // iching-42 (Yì Increase) has no image — see note below
  ['guai',           '43'],  // Guài  — Breakthrough
  ['gou',            '44'],  // Gòu   — Coming to Meet
  ['cui',            '45'],  // Cuì   — Gathering Together
  ['sheng',          '46'],  // Shēng — Ascending
  ['kun-oppression', '47'],  // Kùn   — Oppression
  ['jing',           '48'],  // Jǐng  — The Well
  ['ge',             '49'],  // Gé    — Revolution
  ['ding',           '50'],  // Dǐng  — The Cauldron
  ['zhen',           '51'],  // Zhèn  — Thunder
  ['gen',            '52'],  // Gèn   — Keeping Still
  ['jian-development','53'], // Jiàn  — Gradual Progress
  ['gui mei',        '54'],  // Guī Mèi — The Marrying Maiden
  ['feng',           '55'],  // Fēng  — Abundance
  ['lu-wanderer',    '56'],  // Lǚ    — The Wanderer
  ['xun',            '57'],  // Xùn   — The Gentle
  ['dui',            '58'],  // Duì   — The Joyous
  ['huan',           '59'],  // Huàn  — Dispersion
  ['jie-limitation', '60'],  // Jié   — Limitation
  ['zhong fu',       '61'],  // Zhōng Fú — Inner Truth
  ['xiao guo',       '62'],  // Xiǎo Guò — Small Excess
  ['ji ji',          '63'],  // Jì Jì — After Completion
  ['wei ji',         '64'],  // Wèi Jì — Before Completion
];

// Find extension for a base name
function findFile(base) {
  const exts = ['.jpg', '.jpeg', '.png', '.webp'];
  for (const ext of exts) {
    const f = path.join(imgDir, base + ext);
    if (fs.existsSync(f)) return { full: f, ext };
  }
  return null;
}

let renamed = 0, skipped = 0, missing = [];

for (const [src, num] of mapping) {
  const found = findFile(src);
  if (!found) {
    console.warn(`  MISSING: "${src}" (would be iching-${num})`);
    missing.push({ src, num });
    skipped++;
    continue;
  }
  const target = path.join(imgDir, `iching-${num}${found.ext}`);
  if (found.full === target) {
    console.log(`  OK (already named): iching-${num}${found.ext}`);
    renamed++;
    continue;
  }
  fs.renameSync(found.full, target);
  console.log(`  ${src}${found.ext}  →  iching-${num}${found.ext}`);
  renamed++;
}

// Rename card back (remove space)
const backSrc = path.join(imgDir, 'card back.jpg');
const backDst = path.join(imgDir, 'card-back.jpg');
if (fs.existsSync(backSrc) && !fs.existsSync(backDst)) {
  fs.renameSync(backSrc, backDst);
  console.log('  "card back.jpg"  →  "card-back.jpg"');
}

console.log(`\nDone: ${renamed} renamed, ${skipped} missing.`);
if (missing.length) {
  console.log('\nCards with no image (will show text fallback):');
  missing.forEach(m => console.log(`  iching-${m.num} (${m.src})`));
  console.log('\nNote: "yi.jpg" was mapped to iching-27 (Nourishment).');
  console.log('      iching-42 (Yì Increase) has no image — add a file named iching-42.jpg if you have one.');
}
