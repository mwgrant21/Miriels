(function (root) {
  'use strict';

  // Cross-fade only on a real phase change: both phases set, and different.
  // Pure and DOM-free so it can be unit-tested in node and reused in the browser.
  function shouldCrossfade(prev, next) {
    return Boolean(prev) && Boolean(next) && prev !== next;
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { shouldCrossfade };
  } else {
    root.shouldCrossfade = shouldCrossfade;
  }
})(typeof window !== 'undefined' ? window : globalThis);
