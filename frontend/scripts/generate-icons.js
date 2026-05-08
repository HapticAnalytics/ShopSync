// Run with: node scripts/generate-icons.js
// Generates PWA icon PNGs from public/icon.svg using sharp

import sharp from 'sharp';
import { readFileSync } from 'fs';
import { mkdirSync } from 'fs';

mkdirSync('./public', { recursive: true });

const svg = readFileSync('./public/icon.svg');

const sizes = [
  { size: 512, file: './public/icon-512.png' },
  { size: 192, file: './public/icon-192.png' },
  { size: 180, file: './public/apple-touch-icon.png' },
  { size: 32,  file: './public/favicon-32x32.png' },
  { size: 16,  file: './public/favicon-16x16.png' },
];

for (const { size, file } of sizes) {
  await sharp(svg).resize(size, size).png().toFile(file);
  console.log(`✓ ${file}`);
}

console.log('\nAll icons generated.');
