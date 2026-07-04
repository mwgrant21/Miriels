// ── Spread & deck-layout data ──
// SPREADS is runtime-mutated (compat modal writes
// SPREADS['compatibility'].slots[0].label) -- exported as the live const
// object so property mutation through the import binding keeps working.

export const DEAL_INTERVAL   = 480;  // ms between each card starting to deal
export const SHUFFLE_MS      = 1400; // visible riffle of the pile before dealing begins
export const DEAL_FLIP_DELAY = 640;  // ms from card start until flip (520ms flight + 120 buffer)

export const SPREADS = {
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

export const CELTIC_CLASSES = [
  'celtic-center', 'celtic-cross', 'celtic-top', 'celtic-bottom',
  'celtic-left', 'celtic-right', 'celtic-extra4', 'celtic-extra3',
  'celtic-extra2', 'celtic-extra1'
];

// Six-card grid: draw order maps to visual position (A left, B right)
export const SIX_CARD_CLASSES = ['six-r1c1', 'six-r2c1', 'six-r1c2', 'six-r2c2', 'six-r3c1', 'six-r3c2'];

// Nine-card grid: 3×3 top, then 2 side-by-side, then 1 center
export const NINE_CARD_CLASSES = [
  'nine-r1c1', 'nine-r1c2', 'nine-r1c3',
  'nine-r2c1', 'nine-r2c2', 'nine-r2c3',
  'nine-r3c1', 'nine-r3c3',
  'nine-r4c2'
];

export const HORSESHOE_CLASSES = ['hs-1', 'hs-2', 'hs-3', 'hs-4', 'hs-5', 'hs-6', 'hs-7'];

export const YEAR_CLASSES = [
  'yr-1', 'yr-2', 'yr-3', 'yr-4',
  'yr-5', 'yr-6', 'yr-7', 'yr-8',
  'yr-9', 'yr-10', 'yr-11', 'yr-12'
];

export const CHAKRA_CLASSES = [
  'chakra-root', 'chakra-sacral', 'chakra-solar', 'chakra-heart',
  'chakra-throat', 'chakra-third-eye', 'chakra-crown'
];

// Columns: 1=Situation(span 2 rows), 2=PathA1, 3=PathA2, 4=PathB1, 5=PathB2, 6=Outcome(span 2 rows)
export const DECISION_CLASSES = ['dc-situation', 'dc-pa1', 'dc-pa2', 'dc-pb1', 'dc-pb2', 'dc-outcome'];

// Slot order: Earth(lower-left), Air(upper-right), Fire(lower-right), Water(upper-left), Spirit(top)
export const STAR_CLASSES = ['star-earth', 'star-air', 'star-fire', 'star-water', 'star-spirit'];

export const SPREAD_LAYOUTS = {
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
