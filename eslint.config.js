'use strict';
const js = require('@eslint/js');
const globals = require('globals');

module.exports = [
  {
    ignores: [
      'node_modules/',
      'dist/',
      'public/vendor/',      // third-party, vendored as-is
      'Tarot card generation/',
      'docs/',
    ],
  },
  js.configs.recommended,
  {
    // Backend, tooling, Electron main — CommonJS under Node
    files: ['eslint.config.js', 'server.js', 'data/**/*.js', 'routes/**/*.js', 'scripts/**/*.js', 'electron/**/*.js', 'tests/**/*.js', 'generate-*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: { ...globals.node },
    },
  },
  {
    // Frontend — classic scripts sharing the page's global scope until the
    // Phase 3 ES-module split makes these dependencies explicit imports.
    files: ['public/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: {
        ...globals.browser,
        html2canvas: 'readonly',
        // ambient-lines.js/theme-transition.js feature-detect the Node `module`
        // global so they can also be require()'d directly by node --test.
        module: 'readonly',
        // Cross-file globals; become explicit imports in the Phase 3 module split.
        shouldCrossfade: 'readonly',
        ambientLineFor: 'readonly',
      },
    },
  },
  {
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      // Empty catch blocks are an established idiom in this codebase (optional
      // reads/fetches with fallbacks). Other empty blocks still error.
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
];
