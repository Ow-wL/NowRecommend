// Moves the food photos that still load from Unsplash's host into the site (public/food), like the Pexels ones.
//
//   node scripts/host-unsplash.cjs           lists what would be downloaded and changes nothing (no network)
//   node scripts/host-unsplash.cjs --write   downloads each photo once and points src/media.json at the saved file
//
// Why: the photos are free to use (Unsplash License), but loading them straight from images.unsplash.com is meant for
// apps on Unsplash's API, sends every visitor's address to one more company, and breaks if a photo is removed.
// Each entry keeps its `source` and `credit`; only `image` changes, from the https address to `food/<id>.jpg`
// (src/media.ts serves that from the site's base path). A photo that fails is left as it was and reported; running
// again picks up only what is still remote. After --write: `node scripts/make-tiles.cjs` (the small copies the grids load),
// `npm test`, look at the cards, then commit.
const { readFileSync, writeFileSync, existsSync, mkdirSync } = require('node:fs');
const { join } = require('node:path');

const root = join(__dirname, '..');
const mediaPath = join(root, 'src', 'media.json');
const outDir = join(root, 'public', 'food');
const write = process.argv.includes('--write');
const MAX_BYTES = 1_500_000;  // a 960x960 JPEG at q=75 is 100-300 kB; anything far beyond is not what was asked for
const HOST = 'images.unsplash.com';

/** The same crop as the page shows today, as a JPEG whatever the client: `auto=format` would hand Node an AVIF or WebP. */
function jpegAddress(image) {
  const url = new URL(image);
  if (url.protocol !== 'https:' || url.hostname !== HOST) throw new Error(`not an Unsplash image address: ${image}`);
  url.searchParams.delete('auto');
  url.searchParams.set('fm', 'jpg');
  return url.href;
}
const isJpeg = bytes => bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;

async function main() {
  const text = readFileSync(mediaPath, 'utf8');
  const media = JSON.parse(text);
  const remote = Object.entries(media).filter(([, entry]) => entry.source === 'unsplash' && /^https:\/\//.test(entry.image));
  console.log(`${remote.length} Unsplash photo(s) still load from ${HOST}`);
  if (!write) {
    for (const [id, entry] of remote) console.log(`  ${id}: ${jpegAddress(entry.image)}  ->  public/food/${id}.jpg`);
    console.log('nothing was downloaded or changed. Run again with --write to do it.');
    return;
  }
  mkdirSync(outDir, { recursive: true });
  let saved = 0, total = 0;
  const failed = [];
  for (const [id, entry] of remote) {
    if (!/^[\w-]+$/.test(id)) { failed.push(`${id}: not a usable file name`); continue; }
    const file = join(outDir, `${id}.jpg`);
    try {
      if (existsSync(file)) throw new Error('a file with this name is already there');
      const response = await fetch(jpegAddress(entry.image), { redirect: 'error', signal: AbortSignal.timeout(20000) });
      if (!response.ok) throw new Error(`answered ${response.status}`);
      const bytes = Buffer.from(await response.arrayBuffer());
      if (!isJpeg(bytes)) throw new Error(`not a JPEG (${response.headers.get('content-type')})`);
      if (bytes.length > MAX_BYTES) throw new Error(`${bytes.length} bytes is larger than expected`);
      writeFileSync(file, bytes);
      entry.image = `food/${id}.jpg`;
      saved += 1; total += bytes.length;
      console.log(`  ${id}: ${Math.round(bytes.length / 1024)} kB`);
    } catch (error) { failed.push(`${id}: ${error.message}`); }
  }
  if (saved) {
    // Same shape as the file had: the indentation it was written with and its final newline.
    const indent = (text.match(/\n( +)"/) || [, '  '])[1].length;
    writeFileSync(mediaPath, JSON.stringify(media, null, indent) + (text.endsWith('\n') ? '\n' : ''));
  }
  console.log(`saved ${saved} photo(s), ${Math.round(total / 1024)} kB in all` + (failed.length ? `; ${failed.length} left as they were:` : ''));
  failed.forEach(line => console.log(`  ${line}`));
  if (failed.length) process.exitCode = 1;
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
