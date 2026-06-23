'use strict';
const { Jimp, JimpMime } = require('jimp');
const png2icons = require('png2icons');
const fs = require('fs');
const path = require('path');

(async () => {
  const srcPath = path.join(__dirname, 'icon-source.jpg');
  const icnsPath = path.join(__dirname, 'icon.icns');
  const pngPath = path.join(__dirname, 'icon.png');

  console.log('Reading source image...');
  const img = await Jimp.read(srcPath);

  // Center-crop to square then resize to 1024x1024
  const size = Math.min(img.width, img.height);
  img
    .crop({ x: Math.floor((img.width - size) / 2), y: Math.floor((img.height - size) / 2), w: size, h: size })
    .resize({ w: 1024, h: 1024 });

  const pngBuffer = await img.getBuffer(JimpMime.png);
  fs.writeFileSync(pngPath, pngBuffer);
  console.log('Saved icon.png (1024x1024)');

  console.log('Creating icon.icns...');
  const icns = png2icons.createICNS(pngBuffer, png2icons.BILINEAR, 0);
  if (!icns) { console.error('ICNS creation failed'); process.exit(1); }
  fs.writeFileSync(icnsPath, icns);
  console.log('Saved icon.icns');
})().catch(err => { console.error(err); process.exit(1); });
