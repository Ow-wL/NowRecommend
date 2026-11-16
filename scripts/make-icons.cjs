// Draws the PNG icons from the SVG sources: `node scripts/make-icons.cjs`. Run again whenever public/icon.svg or
// public/icon-maskable.svg changes. iOS takes no SVG for the home screen icon and Android wants 192 and 512 pixel PNGs to
// offer installing; the SVGs stay the source and stay in the manifest.
const { chromium } = require('@playwright/test');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const root = join(__dirname, '..', 'public');
const targets = [
  { from: 'icon.svg', to: 'icon-192.png', size: 192, transparent: true },
  { from: 'icon.svg', to: 'icon-512.png', size: 512, transparent: true },
  { from: 'icon-maskable.svg', to: 'icon-maskable-512.png', size: 512, transparent: false },
  { from: 'icon-maskable.svg', to: 'apple-touch-icon.png', size: 180, transparent: false },  // iOS rounds the corners itself
];

(async () => {
  const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || 'msedge', headless: true });
  for (const { from, to, size, transparent } of targets) {
    const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
    const svg = readFileSync(join(root, from), 'utf8').replace(/width="\d+" height="\d+"/, `width="${size}" height="${size}"`);
    await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block}</style>${svg}`);
    await page.screenshot({ path: join(root, to), omitBackground: transparent, clip: { x: 0, y: 0, width: size, height: size } });
    await page.close();
    console.log(`${to} ${size}x${size}`);
  }
  await browser.close();
})();
