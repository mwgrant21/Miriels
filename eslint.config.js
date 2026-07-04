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
    // Frontend ES modules (app.js entry + extracted modules)
    files: ['public/app.js', 'public/js/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.browser, html2canvas: 'readonly' },
    },
  },
  {
    // Classic scripts kept dual-consumable (browser global + node require for tests)
    files: ['public/theme-transition.js', 'public/ambient-lines.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: { ...globals.browser, module: 'readonly' },
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
