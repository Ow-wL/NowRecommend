// Makes the smaller copies of each food photo saved with the site:
//   public/food/<id>.jpg -> public/food/tile/<id>.jpg (420 px) and public/food/mid/<id>.jpg (720 px).
//
//   node scripts/make-tiles.cjs           makes the copies that are missing
//   node scripts/make-tiles.cjs --all     makes every copy again
//
// Why: the grids (choosing tastes, pairs, favourites) and the small thumbnails show a photo at about 200 CSS pixels or less.
// A photo on a picture host is asked for at that size (src/media.ts `tileImage`); a photo saved here has nobody to resize
// it, so the 960 pixel file would be loaded for every tile. The 720 pixel copy (2026-11-26) is for the result cards, which
// are 335-390 CSS pixels wide: a phone at 2x needs ~700 pixels, so the browser picks it from `srcset` and only a 3x phone
// or a wide screen still takes the 960 pixel photo (src/media.ts `midImage`, src/components/ItemArt.tsx).
// Run after adding a photo to public/food; tests/built/built-site.spec.ts fails while a copy is missing.
// Drawn by the browser the tests already use, like make-icons.cjs, so no image library is needed.
const { chromium } = require('@playwright/test');
const { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } = require('node:fs');
const { join } = require('node:path');

const from = join(__dirname, '..', 'public', 'food');
const SIZES = [{ folder: 'tile', size: 420, quality: 0.8 }, { folder: 'mid', size: 720, quality: 0.82 }];
const all = process.argv.includes('--all');

(async () => {
  const photos = readdirSync(from).filter(name => /^[\w-]+\.jpg$/.test(name));
  const jobs = SIZES.flatMap(target => {
    mkdirSync(join(from, target.folder), { recursive: true });
    return photos.filter(name => all || !existsSync(join(from, target.folder, name))).map(name => ({ ...target, name }));
  });
  if (!jobs.length) { console.log('every photo has its smaller copies'); return; }
  const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || 'msedge', headless: true });
  const page = await browser.newPage();
  let total = 0;
  for (const { folder, size, quality, name } of jobs) {
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
    }, { source, size, quality });
    const bytes = Buffer.from(drawn.data.split(',')[1], 'base64');
    writeFileSync(join(from, folder, name), bytes);
    total += bytes.length;
    console.log(`  ${folder}/${name}: ${drawn.width}x${drawn.height} -> ${size}x${size}, ${Math.round(bytes.length / 1024)} kB`);
  }
  await browser.close();
  console.log(`made ${jobs.length} cop${jobs.length === 1 ? 'y' : 'ies'}, ${Math.round(total / 1024)} kB in all`);
})().catch(error => { console.error(error.message); process.exitCode = 1; });
