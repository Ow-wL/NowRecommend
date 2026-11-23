// Keeps a version of the terms and the privacy policy as it was shown: `node scripts/legal-snapshot.cjs <version> [site]`.
// Run it on the live site BEFORE a new version is deployed, while the old one is still there: it opens the two pages in a
// browser, takes their text as rendered (with the operator's name and every switch as the site has them), and writes
// public/legal/<version>/terms.html and privacy.html. The pages list the kept versions (src/legal.ts PREVIOUS_VERSIONS).
// The privacy rules ask that earlier versions stay readable (개인정보 처리방침 작성지침, 2026. 4.: 변경 이력과 이전 판).
const { chromium } = require('@playwright/test');
const { mkdirSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');

const [version, site = 'https://nowrec.kr/'] = process.argv.slice(2);
if (!/^\d{4}-\d{2}-\d{2}(\.\d+)?$/.test(version || '')) { console.error('usage: node scripts/legal-snapshot.cjs <YYYY-MM-DD[.N]> [site]'); process.exit(2); }
const out = join(__dirname, '..', 'public', 'legal', version);
const escape = text => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

(async () => {
  const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || 'msedge', headless: true });
  const page = await browser.newPage();
  await page.addInitScript(v => { try { localStorage.setItem('nowrecommend-adult-v1', v); } catch { /* the gate shows; the text is still there */ } }, version);
  mkdirSync(out, { recursive: true });
  for (const kind of ['terms', 'privacy']) {
    await page.goto(`${site.replace(/\/?$/, '/')}?snapshot=${Date.now()}#/${kind}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.legal-page h1');
    const doc = await page.evaluate(() => {
      const root = document.querySelector('.legal-page');
      const title = root.querySelector('h1').textContent.trim();
      const effective = (root.querySelector('h1 + p') || {}).textContent || '';
      // Headings, paragraphs and lists, as text: what the page said, without the app around it.
      const blocks = [...root.querySelectorAll('section')].map(section => ({
        heading: section.querySelector('h2').textContent.trim(),
        parts: [...section.children].filter(node => node.tagName !== 'H2').map(node => node.tagName === 'UL'
          ? { list: [...node.querySelectorAll('li')].map(li => li.textContent.trim()) } : { text: node.textContent.trim() }),
      }));
      return { title, effective: effective.trim(), blocks };
    });
    // A second version of a day shows as "2026-11-18 (그날 두 번째 판)" (src/legal.ts versionLabel).
    const [day, nth] = version.split('.');
    const shown = !nth ? doc.effective.includes(day) && !doc.effective.includes('번째 판') : doc.effective.includes(day) && doc.effective.includes(`${nth === '2' ? '두' : nth} 번째 판`);
    if (!shown) throw new Error(`${kind}: the site shows "${doc.effective}", not ${version}`);
    const link = text => escape(text).replace(/(https:\/\/[^\s)<&]*[^\s)<&.,])/g, '<a href="$1" rel="noopener noreferrer">$1</a>');
    const body = doc.blocks.map(block => `<section><h2>${escape(block.heading)}</h2>\n${block.parts.map(part => part.list
      ? `<ul>\n${part.list.map(item => `<li>${link(item)}</li>`).join('\n')}\n</ul>` : `<p>${link(part.text)}</p>`).join('\n')}</section>`).join('\n');
    writeFileSync(join(out, `${kind}.html`), `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>${escape(doc.title)} (${version} 판) - 지금 추천</title>
<style>body{max-width:760px;margin:0 auto;padding:32px 20px 64px;font:16px/1.7 -apple-system,'Apple SD Gothic Neo','Malgun Gothic',sans-serif;color:#1C1C1E;background:#F2F2F7}
h1{font-size:28px;margin:0 0 4px}h2{font-size:19px;margin:32px 0 8px}.old{padding:12px 16px;border-radius:12px;background:#FFF6DF;color:#6B4A00}a{color:#2F5F9E}</style></head>
<body><p class="old">이 문서는 지난 판(${version})입니다. 지금 적용되는 내용은 <a href="../../#/${kind}">현재 ${escape(doc.title)}</a>에서 볼 수 있습니다.</p>
<h1>${escape(doc.title)}</h1><p>${escape(doc.effective)} · ${new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10)}에 보관</p>
${body}
</body></html>
`);
    console.log(`${kind}: ${doc.blocks.length} sections → public/legal/${version}/${kind}.html`);
  }
  await browser.close();
})().catch(error => { console.error(error); process.exit(1); });
