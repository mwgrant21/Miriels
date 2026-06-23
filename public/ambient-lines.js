(function (root) {
  'use strict';

  var AMBIENT_LINES = {
    dawn: [
      'First light filters through the trees.',
      'The forest wakes in pale gold.',
      'Morning mist lifts from the clearing.',
      'Dawn settles soft over the woods.',
    ],
    day: [
      'Sunlight rests on the clearing.',
      'The woods are bright and still.',
      'Light pools warm among the leaves.',
      'The day holds steady over the trees.',
    ],
    dusk: [
      'The woods turn gold, then violet.',
      'Long shadows gather between the trees.',
      'The last light slips below the branches.',
      'Evening settles amber over the clearing.',
    ],
    night: [
      'All is quiet under the moon.',
      'Starlight threads the canopy.',
      'The forest rests in moonlit hush.',
      'The woods keep their secrets in the dark.',
    ],
  };

  // Pure: returns one scene line for the phase. Unknown/missing phase falls back to
  // night. rng is injectable for deterministic tests.
  function ambientLineFor(phase, rng) {
    var pool = AMBIENT_LINES[phase] || AMBIENT_LINES.night;
    var r = typeof rng === 'function' ? rng() : Math.random();
    var i = Math.floor(r * pool.length) % pool.length;
    return pool[i];
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { ambientLineFor: ambientLineFor, AMBIENT_LINES: AMBIENT_LINES };
  } else {
    root.ambientLineFor = ambientLineFor;
    root.AMBIENT_LINES = AMBIENT_LINES;
  }
})(typeof window !== 'undefined' ? window : globalThis);
