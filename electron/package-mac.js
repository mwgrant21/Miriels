'use strict';
const { packager } = require('@electron/packager');
const path = require('path');

(async () => {
  const appRoot = path.join(__dirname, '..');

  console.log('Packaging for macOS (arm64 + x64)...');
  const result = await packager({
    dir: appRoot,
    name: 'Tarot & Oracle',
    platform: 'darwin',
    arch: ['x64', 'arm64'],
    out: path.join(appRoot, 'dist'),
    icon: path.join(__dirname, 'icon.icns'),
    overwrite: true,
    ignore: [
      'dist',
      '\\.git',
      'electron/icon-source\\.jpg',
      'electron/icon\\.png',
      'electron/make-icon\\.js',
      'electron/package-mac\\.js',
      'generate-.*\\.js'
    ],
    appBundleId: 'com.tarot.oracle',
    appCategoryType: 'public.app-category.lifestyle',
    darwinDarkModeSupport: true,
    buildVersion: '1.0.0',
    appVersion: '1.0.0'
  });

  console.log('Built:', result);
})().catch(err => { console.error(err); process.exit(1); });
