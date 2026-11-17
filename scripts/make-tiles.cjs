// Makes the small copy of each food photo saved with the site: public/food/<id>.jpg -> public/food/tile/<id>.jpg.
//
//   node scripts/make-tiles.cjs           makes the tiles that are missing
//   node scripts/make-tiles.cjs --all     makes every tile again
//
// Why: the grids (choosing tastes, pairs, favourites) show a photo at about 200 CSS pixels. A photo on a picture host is
// asked for at that size (src/media.ts `tileImage`); a photo saved here has nobody to resize it, so the 960 pixel file
// would be loaded for every tile. Run after adding a photo to public/food; src/photos.test.ts fails while one is missing.
// Drawn by the browser the tests already use, like make-icons.cjs, so no image library is needed.
const { chromium } = require('@playwright/test');
const { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } = require('node:fs');
const { join } = require('node:path');

const from = join(__dirname, '..', 'public', 'food');
const to = join(from, 'tile');
const SIZE = 420, QUALITY = 0.8;
const all = process.argv.includes('--all');

(async () => {
  mkdirSync(to, { recursive: true });
  const names = readdirSync(from).filter(name => /^[\w-]+\.jpg$/.test(name)).filter(name => all || !existsSync(join(to, name)));
  if (!names.length) { console.log('every photo has its tile'); return; }
  const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || 'msedge', headless: true });
  const page = await browser.newPage();
  let total = 0;
  for (const name of names) {
    const source = `data:image/jpeg;base64,${readFileSync(join(from, name)).toString('base64')}`;
    const drawn = await page.evaluate(async ({ source, size, quality }) => {
      const image = new Image();
      image.src = source;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = size;
      const context = canvas.getContext('2d');
      context.imageSmoothingQuality = 'high';
      const side = Math.min(image.naturalWidth, image.naturalHeight);  // the middle square, as the page crops it
      context.drawImage(image, (image.naturalWidth - side) / 2, (image.naturalHeight - side) / 2, side, side, 0, 0, size, size);
      return { data: canvas.toDataURL('image/jpeg', quality), width: image.naturalWidth, height: image.naturalHeight };
    }, { source, size: SIZE, quality: QUALITY });
    const bytes = Buffer.from(drawn.data.split(',')[1], 'base64');
    writeFileSync(join(to, name), bytes);
    total += bytes.length;
    console.log(`  ${name}: ${drawn.width}x${drawn.height} -> ${SIZE}x${SIZE}, ${Math.round(bytes.length / 1024)} kB`);
  }
  await browser.close();
  console.log(`made ${names.length} tile(s), ${Math.round(total / 1024)} kB in all`);
})().catch(error => { console.error(error.message); process.exitCode = 1; });
