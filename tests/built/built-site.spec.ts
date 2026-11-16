import { test, expect, type Route } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { items } from '../../src/data';

// The site as built (playwright.dist.config.ts): the security policy must let the app do everything it does, and the
// things a release adds (icons, link-preview address, the offline cache's name) must be in what is shipped.
const API = 'http://127.0.0.1:5999';
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, Authorization' };
const fulfill = (route: Route, body: unknown) =>
  route.request().method() === 'OPTIONS' ? route.fulfill({ status: 204, headers: cors }) : route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify(body) });
const legal = JSON.parse(readFileSync(new URL('../../shared/legal.json', import.meta.url), 'utf8')) as { version: string };

test('the security policy lets the app work and stops a script from elsewhere', async ({ page }) => {
  const blocked: string[] = [], failures: string[] = [];
  page.on('console', message => { if (/Content Security Policy|Refused to/.test(message.text())) blocked.push(message.text()); });
  page.on('pageerror', error => failures.push(error.message));
  await page.addInitScript(version => { localStorage.setItem('nowrecommend-adult-v1', version);
    localStorage.setItem('nowrecommend-prototype-v1', JSON.stringify({ version: 2, name: '검증', profiles: { food: { selected: ['f01', 'f02', 'f03', 'f04', 'f05'], tags: [], disliked: [] }, music: { selected: ['m01'], tags: [], disliked: [] } }, favorites: [], history: [], appearance: { mode: 'dark' } })); }, legal.version);
  await page.route('https://itunes.apple.com/**', route => route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: '{"results":[]}' }));
  await page.route(`${API}/api/catalog**`, route => fulfill(route, { catalogVersion: 'db-test', items }));
  await page.route(`${API}/api/parse`, route => fulfill(route, { conditions: { tags: [], excluded: [], maxPrice: null }, unparsed: [], source: 'rule', ai: 'not_needed' }));
  await page.route(`${API}/api/recommend`, route => fulfill(route, {
    results: ['f02', 'f12', 'f09'].map(id => ({ item: items.find(i => i.id === id)!, tasteReason: '이유', contextReason: '상황' })),
    meta: { mode: 'retrieval_only', eligibleCount: 17, newCount: 3, catalogVersion: 'db-test', requestId: 'r' } }));
  await page.goto('/');
  // The policy is in the page, names the API, and the inline theme script ran under it (dark mode from the stored setting).
  const policy = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content');
  expect(policy).toContain("default-src 'self'");
  expect(policy).toContain(API);
  expect(policy).toMatch(/script-src 'self' 'sha256-[A-Za-z0-9+/=]+'/);
  expect(policy).not.toMatch(/script-src[^;]*unsafe/);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.getByRole('heading', { name: '오늘 뭐 먹고, 뭐 들을까요?' })).toBeVisible();
  // A walk through what talks to other hosts: the API, the font, pictures, the documents.
  await page.goto('/#/recommend/food');
  await page.getByRole('button', { name: /추천받기$/ }).click();
  await expect(page.locator('.result-grid h3')).toHaveCount(3);
  await expect(page).toHaveURL(/#\/recommend\/food\/results$/);  // the address has caught up with the screen before the next move
  await page.goto('/#/privacy');
  await expect(page.getByRole('heading', { name: '개인정보 처리방침', level: 1 })).toBeVisible();
  await page.goto('/#/login');
  await expect(page.getByRole('button', { name: '비밀번호를 잊으셨나요?' })).toBeVisible();
  expect(failures).toEqual([]);
  expect(blocked).toEqual([]);
  // And what it is for: a script injected from elsewhere, or inline, does not run.
  const ran = await page.evaluate(async () => {
    const inline = document.createElement('script'); inline.textContent = 'window.__injected = 1'; document.head.append(inline);
    const remote = document.createElement('script'); remote.src = 'https://example.com/x.js'; document.head.append(remote);
    await new Promise(resolve => setTimeout(resolve, 300));
    return (window as any).__injected ?? 0;
  });
  expect(ran).toBe(0);
  await expect.poll(() => blocked.length).toBeGreaterThan(0);  // the browser's refusal is reported a moment later
});

test('a release ships its icons, its own address in link previews and a cache named after the build', async ({ page, request }) => {
  await page.goto('/');
  for (const file of ['apple-touch-icon.png', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'robots.txt', 'manifest.webmanifest'])
    expect((await request.get(`/${file}`)).status(), file).toBe(200);
  const manifest = await (await request.get('/manifest.webmanifest')).json();
  expect(manifest.icons.map((i: { sizes: string }) => i.sizes)).toEqual(expect.arrayContaining(['192x192', '512x512']));
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveCount(1);
  const image = await page.locator('meta[property="og:image"]').getAttribute('content');
  expect(image).toMatch(/^https:\/\/.+\/og\.png$/);
  expect(image).not.toContain('__PUBLIC_URL__');
  const worker = await (await request.get('/sw.js')).text();
  expect(worker).not.toContain('__BUILD__');
  expect(worker).toMatch(/const VERSION = PREFIX \+ '[0-9a-z]+'/);
});

test('a browser a few years old still gets the app, not the error page', async ({ page }) => {
  // What Safari before 15.4 and Chrome before 92-103 lack (src/polyfills.ts). The build lowers syntax only, so the first
  // call to one of these used to replace the whole screen with the error page (seen in the error log, 2026-11-17).
  const failures: string[] = [];
  page.on('pageerror', error => failures.push(error.message));
  await page.addInitScript(version => {
    localStorage.setItem('nowrecommend-adult-v1', version);
    localStorage.setItem('nowrecommend-prototype-v1', JSON.stringify({ version: 2, name: '검증', profiles: { food: { selected: ['f01', 'f02', 'f03', 'f04', 'f05'], tags: [], disliked: [] }, music: { selected: ['m01'], tags: [], disliked: [] } }, favorites: [], history: [], appearance: { mode: 'light' } }));
    Object.defineProperty(Crypto.prototype, 'randomUUID', { value: undefined, configurable: true, writable: true });
    Object.defineProperty(window, 'structuredClone', { value: undefined, configurable: true, writable: true });
    Object.defineProperty(Array.prototype, 'at', { value: undefined, configurable: true, writable: true });
    Object.defineProperty(String.prototype, 'at', { value: undefined, configurable: true, writable: true });
    Object.defineProperty(AbortSignal, 'timeout', { value: undefined, configurable: true, writable: true });
  }, legal.version);
  await page.route('https://itunes.apple.com/**', route => route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: '{"results":[]}' }));
  await page.route(`${API}/api/catalog**`, route => fulfill(route, { catalogVersion: 'db-test', items }));
  await page.route(`${API}/api/parse`, route => fulfill(route, { conditions: { tags: [], excluded: [], maxPrice: null }, unparsed: [], source: 'rule', ai: 'not_needed' }));
  await page.route(`${API}/api/client-errors`, route => fulfill(route, {}));
  await page.route(`${API}/api/recommend`, route => fulfill(route, {
    results: ['f02', 'f12', 'f09'].map(id => ({ item: items.find(i => i.id === id)!, tasteReason: '이유', contextReason: '상황' })),
    meta: { mode: 'retrieval_only', eligibleCount: 17, newCount: 3, catalogVersion: 'db-test', requestId: 'r' } }));
  await page.goto('/');
  expect(await page.evaluate(() => [typeof crypto.randomUUID, typeof structuredClone, typeof [].at, typeof ''.at, typeof AbortSignal.timeout])).toEqual(Array(5).fill('function'));
  await expect(page.getByRole('heading', { name: '오늘 뭐 먹고, 뭐 들을까요?' })).toBeVisible();
  // A round of recommendations makes ids and copies conditions; choosing one writes a history entry.
  await page.goto('/#/recommend/food');
  await page.getByRole('button', { name: /추천받기$/ }).click();
  await expect(page.locator('.result-grid h3')).toHaveCount(3);
  await expect(page).toHaveURL(/#\/recommend\/food\/results$/);
  await page.goto('/#/recommend/music');
  await expect(page.getByRole('button', { name: /추천받기$/ })).toBeVisible();
  expect(failures).toEqual([]);
});

test('the security policy lets Apple Music\'s player into a frame, and no other page', async ({ page }) => {
  const blocked: string[] = [], asked: string[] = [];
  page.on('console', message => { if (/Content Security Policy|Refused to/.test(message.text())) blocked.push(message.text()); });
  await page.addInitScript(version => { localStorage.setItem('nowrecommend-adult-v1', version);
    localStorage.setItem('nowrecommend-prototype-v1', JSON.stringify({ version: 2, name: '검증', profiles: { food: { selected: ['f01', 'f02', 'f03', 'f04', 'f05'], tags: [], disliked: [] }, music: { selected: ['m01'], tags: [], disliked: [] } }, favorites: ['m06'], history: [] })); }, legal.version);
  await page.route('https://itunes.apple.com/**', route => route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: '{"results":[]}' }));
  await page.route(`${API}/api/**`, route => fulfill(route, { catalogVersion: 'db-test', items }));
  await page.route('https://embed.music.apple.com/**', route => { asked.push(route.request().url()); return route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><p>Apple Music player</p>' }); });
  await page.route('https://frames.example/**', route => { asked.push(route.request().url()); return route.fulfill({ status: 200, contentType: 'text/html', body: '<p>not allowed</p>' }); });
  await page.goto('/#/favorites');
  expect(await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content')).toContain('frame-src https://embed.music.apple.com;');
  await page.getByRole('button', { name: 'River Flows in You 상세 보기' }).click();
  await page.getByRole('button', { name: 'Apple Music 플레이어 열기' }).click();
  const frame = page.getByRole('dialog').locator('iframe');
  await expect(frame).toHaveAttribute('src', /^https:\/\/embed\.music\.apple\.com\/[a-z]{2}\/song\/river-flows-in-you\/\d+$/);
  await expect(frame.contentFrame().getByText('Apple Music player')).toBeVisible();
  expect(blocked).toEqual([]);
  // A frame from anywhere else is refused by the policy before any request is made.
  await page.evaluate(() => { const other = document.createElement('iframe'); other.src = 'https://frames.example/page'; document.body.append(other); });
  await expect.poll(() => blocked.filter(text => /frames\.example/.test(text)).length).toBeGreaterThan(0);
  expect(asked.filter(url => /frames\.example/.test(url))).toEqual([]);
});
