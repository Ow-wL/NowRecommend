// Draws the link-preview picture public/og.png (1200x630): `node scripts/make-og.cjs`. Run again when the words change;
// they should say the same as og:title / og:description in index.html (2026-11-26: the service itself, not only the type
// test). Drawn by the browser the tests already use, like make-icons.cjs, with the site's own font (Pretendard).
const { chromium } = require('@playwright/test');
const { join } = require('node:path');

const html = `<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css">
<style>
  html, body { margin: 0; width: 1200px; height: 630px; background: #f2f2f6; font-family: 'Pretendard Variable', Pretendard, sans-serif; }
  .text { position: absolute; left: 64px; top: 150px; color: #1c1c1e; }
  h1 { margin: 0; font-size: 60px; line-height: 1.22; font-weight: 800; letter-spacing: -0.02em; }
  p { margin: 34px 0 0; font-size: 29px; line-height: 1.45; color: #3a3a3c; font-weight: 500; }
  .brand { margin-top: 44px; font-size: 25px; font-weight: 700; color: #a8481e; }
  .tile { position: absolute; border-radius: 40px; display: flex; align-items: center; justify-content: center; }
</style></head><body>
  <div class="text">
    <h1>지금 기분에 맞는<br>음식과 음악</h1>
    <p>상황을 한 문장으로 말하면<br>딱 맞게 골라 드려요</p>
    <div class="brand">지금 추천</div>
  </div>
  <div class="tile" style="left:736px;top:74px;width:190px;height:232px;background:#fde3da">
    <svg width="160" height="160" viewBox="0 0 160 160">
      <circle cx="80" cy="80" r="78" fill="#fff"/><circle cx="80" cy="80" r="58" fill="#f2a48c"/>
      <circle cx="80" cy="80" r="36" fill="#fffaf0"/><circle cx="80" cy="80" r="15" fill="#f5d28a"/>
      <line x1="98" y1="78" x2="132" y2="4" stroke="#a8481e" stroke-width="6" stroke-linecap="round"/>
      <line x1="112" y1="84" x2="150" y2="10" stroke="#a8481e" stroke-width="6" stroke-linecap="round"/>
    </svg>
  </div>
  <div class="tile" style="left:946px;top:74px;width:190px;height:232px;background:#dde8f9">
    <svg width="160" height="160" viewBox="0 0 160 160">
      <circle cx="80" cy="80" r="78" fill="#9ec0ec"/>
      <circle cx="80" cy="80" r="64" fill="none" stroke="#fff" stroke-opacity=".55" stroke-width="1.5"/>
      <circle cx="80" cy="80" r="54" fill="none" stroke="#fff" stroke-opacity=".55" stroke-width="1.5"/>
      <circle cx="80" cy="80" r="44" fill="none" stroke="#fff" stroke-opacity=".55" stroke-width="1.5"/>
      <circle cx="80" cy="80" r="30" fill="#fff"/><circle cx="80" cy="80" r="6" fill="#9ec0ec"/>
    </svg>
  </div>
  <div class="tile" style="left:736px;top:324px;width:400px;height:232px;background:#fdf0cc">
    <svg width="180" height="120" viewBox="0 0 180 120">
      <circle cx="60" cy="60" r="54" fill="#f2a48c" fill-opacity=".9"/><circle cx="116" cy="60" r="54" fill="#9ec0ec" fill-opacity=".8"/>
    </svg>
  </div>
</body></html>`;

(async () => {
  const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || 'msedge', headless: true });
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
  await page.setContent(html, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  const out = join(__dirname, '..', 'public', 'og.png');
  await page.screenshot({ path: out, clip: { x: 0, y: 0, width: 1200, height: 630 } });
  await browser.close();
  console.log(`og.png 1200x630`);
})();
