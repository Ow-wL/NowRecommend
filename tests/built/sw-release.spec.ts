import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { copyFileSync, cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join, normalize } from 'node:path';

// The offline copy across a release (public/sw.js, 2026-11-26). Two releases of the built site are served in turn from one
// address: A is dist/ as built, B is a copy of it with new file names and a new build mark, as the next release would have.
// The worker of A must never keep B's page without B's files, and a tab open on A keeps A until it is closed.
const legal = JSON.parse(readFileSync(new URL('../../shared/legal.json', import.meta.url), 'utf8')) as { version: string };
const DIST = new URL('../../dist/', import.meta.url).pathname.replace(/^\/(\w:)/, '$1');
const HEADING = '오늘 뭐 먹지? 한 문장이면 끝.';
const types: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.txt': 'text/plain', '.jpg': 'image/jpeg', '.webp': 'image/webp' };

let release = { A: '', B: '' }, scripts = { A: '', B: '' }, dirB = '';
// What the host does right now: which release it serves, and whether it answers at all (down) or answers the page only
// (pageOnly: the connection drops after the page, before its files, as on a train going into a tunnel), and where the page
// itself comes from when that differs (pageRoot: an edge cache still serving the page of the release before).
const host = { root: DIST, down: false, pageOnly: false, pageRoot: '' };
let server: Server, origin = '', dirOld = '';
const seen: string[] = [];  // what reached the host, as 'path' or 'path dropped'

test.beforeAll(async () => {
  const worker = readFileSync(join(DIST, 'sw.js'), 'utf8');
  // (Also the worker before the fix, which named only VERSION: the same specs run against it fail, as they should.)
  release.A = (worker.match(/const BUILD = '([0-9a-z]+)'/) ?? worker.match(/PREFIX \+ '([0-9a-z]+)'/))?.[1] ?? '';
  expect(release.A, 'the built worker names its build').not.toBe('');
  release.B = release.A.slice(0, 10) + 'zz';
  dirB = mkdtempSync(join(tmpdir(), 'nowrec-release-b-'));
  cpSync(DIST, dirB, { recursive: true });
  // B: the page's own script and stylesheet under new names, and the build mark changed in the page and the worker. A's
  // files stay next to them, as on a host or edge cache that still has the release before.
  let page = readFileSync(join(dirB, 'index.html'), 'utf8');
  for (const file of readdirSync(join(dirB, 'assets')).filter(name => /^index-.+\.(js|css)$/.test(name))) {
    const renamed = file.replace(/\.(js|css)$/, 'b.$1');
    copyFileSync(join(dirB, 'assets', file), join(dirB, 'assets', renamed));
    page = page.replaceAll(`assets/${file}`, `assets/${renamed}`);
  }
  writeFileSync(join(dirB, 'index.html'), page.replaceAll(release.A, release.B));
  writeFileSync(join(dirB, 'sw.js'), worker.replaceAll(release.A, release.B));
  scripts.A = readFileSync(join(DIST, 'index.html'), 'utf8').match(/src="\.\/assets\/(index-[^"]+\.js)"/)![1];
  scripts.B = page.match(/src="\.\/assets\/(index-[^"]+\.js)"/)![1];
  server = createServer((request, response) => {
    if (host.down) { request.socket.destroy(); return; }
    let path = decodeURIComponent(new URL(request.url ?? '/', 'http://x').pathname);
    if (path.endsWith('/')) path += 'index.html';
    if (host.pageOnly && path !== '/index.html') { seen.push(`${path} dropped`); request.socket.destroy(); return; }
    seen.push(path);
    const root = path === '/index.html' && host.pageRoot ? host.pageRoot : host.root;
    const file = normalize(join(root, path));
    if (!file.startsWith(normalize(root)) || !existsSync(file)) { response.writeHead(404).end(); return; }
    response.writeHead(200, { 'Content-Type': types[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-cache' }).end(readFileSync(file));
  });
  // The release before the fix: A's page and files with the worker as it was deployed until then.
  dirOld = mkdtempSync(join(tmpdir(), 'nowrec-release-old-'));
  cpSync(DIST, dirOld, { recursive: true });
  writeFileSync(join(dirOld, 'sw.js'), readFileSync(new URL('./fixtures/sw-before-2026-11-26.js', import.meta.url), 'utf8').replaceAll('__BUILD__', 'old1'));
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  origin = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
});
test.afterAll(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
  for (const dir of [dirB, dirOld]) if (dir) rmSync(dir, { recursive: true, force: true });
});
test.beforeEach(() => { Object.assign(host, { root: DIST, down: false, pageOnly: false, pageRoot: '' }); seen.length = 0; });

async function open(context: BrowserContext) {
  const page = await context.newPage();
  await page.addInitScript(version => {
    localStorage.setItem('nowrecommend-adult-v1', version);
    localStorage.setItem('nowrecommend-prototype-v1', JSON.stringify({ version: 2, name: '검증', profiles: { food: { selected: ['f01', 'f02', 'f03', 'f04', 'f05'], tags: [], disliked: [] }, music: { selected: ['m01'], tags: [], disliked: [] } }, favorites: [], history: [] }));
  }, legal.version);
  // The API is another host: nothing answers it here, as when it is down; the app has its own offline mode for that.
  await page.route('http://127.0.0.1:5999/**', route => route.abort());
  await page.route('https://**', route => route.abort());
  return page;
}
const controlled = (page: Page) => expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null), { timeout: 15000 }).toBe(true);
const cacheKeys = (page: Page) => page.evaluate(() => caches.keys());
const loadedScript = (page: Page) => page.evaluate(() => document.querySelector<HTMLScriptElement>('script[type="module"]')?.getAttribute('src') ?? '');
async function offline(context: BrowserContext) { host.down = true; await context.setOffline(true); }

test('the offline page stays the one the worker has the files for, when a release arrives with a bad connection', async ({ context }) => {
  const page = await open(context);
  await page.goto(`${origin}/`);
  await expect(page.getByRole('heading', { name: HEADING })).toBeVisible();
  await controlled(page);
  // Release B is out. The page arrives, then the connection drops before its script and stylesheet (and the new worker).
  Object.assign(host, { root: dirB, pageOnly: true });
  await page.reload().catch(() => { /* the page itself may fail to draw: its files did not come */ });
  expect(await loadedScript(page)).toContain(scripts.B);
  expect(seen).toContain(`/assets/${scripts.B} dropped`);  // B's page came, B's script did not
  await page.waitForTimeout(800);  // the worker had time to store whatever it stores (the worker before the fix stored B's page here)
  // Now fully offline: the worker of A must give A's page, whose files it has, not B's page without B's files.
  await offline(context);
  await page.reload();
  await expect(page.getByRole('heading', { name: HEADING })).toBeVisible();
  expect(await loadedScript(page)).toContain(scripts.A);
});

test('a tab open on one release keeps its files until it is closed, then the next release takes over', async ({ context }) => {
  const first = await open(context);
  await first.goto(`${origin}/`);
  await expect(first.getByRole('heading', { name: HEADING })).toBeVisible();
  await controlled(first);
  expect(await cacheKeys(first)).toEqual([`nowrecommend-shell-${release.A}`]);
  // Release B is out and the browser looks for a new worker while the tab is open: B is fetched whole, then waits.
  host.root = dirB;
  await first.evaluate(async () => { await (await navigator.serviceWorker.getRegistration())!.update(); });
  await expect.poll(() => first.evaluate(async () => (await navigator.serviceWorker.getRegistration())!.waiting?.state ?? ''), { timeout: 15000 }).toBe('installed');
  expect((await cacheKeys(first)).sort()).toEqual([`nowrecommend-shell-${release.A}`, `nowrecommend-shell-${release.B}`].sort());
  // Offline in the open tab: still release A as a whole.
  await offline(context);
  await first.reload();
  expect(await loadedScript(first)).toContain(scripts.A);
  await expect(first.getByRole('heading', { name: HEADING })).toBeVisible();
  // Back online, the tab is closed: B takes over and A's files go. Offline again, B's page comes with B's files.
  host.down = false; await context.setOffline(false);
  await first.close();
  const second = await open(context);
  await second.goto(`${origin}/`);
  await expect.poll(() => cacheKeys(second), { timeout: 15000 }).toEqual([`nowrecommend-shell-${release.B}`]);
  await controlled(second);
  await offline(context);
  await second.reload();
  expect(await loadedScript(second)).toContain(scripts.B);
  await expect(second.getByRole('heading', { name: HEADING })).toBeVisible();
});

test('a worker does not take the page of another release as its own', async ({ context }) => {
  // B's worker, but the page still A's (an edge cache behind): the install fails and nothing is stored as the offline page.
  Object.assign(host, { root: dirB, pageRoot: DIST });
  const page = await open(context);
  await page.goto(`${origin}/`);
  await expect(page.getByRole('heading', { name: HEADING })).toBeVisible();
  expect(await loadedScript(page)).toContain(scripts.A);
  // A first install that fails takes its registration with it. The worker was fetched and asked for the page itself (a
  // second time, after the visit); then nothing is in place.
  await expect.poll(() => seen.filter(path => path === '/index.html').length, { timeout: 15000 }).toBeGreaterThanOrEqual(2);
  expect(seen).toContain('/sw.js');
  await expect.poll(() => page.evaluate(async () => { const r = await navigator.serviceWorker.getRegistration(); return r ? (r.installing ? 'installing' : r.waiting || r.active ? 'kept' : 'none') : 'none'; }), { timeout: 15000 }).toBe('none');
  expect(await page.evaluate(async () => (await caches.match(new URL('./index.html', location.href).href)) !== undefined)).toBe(false);
  expect(await page.evaluate(() => navigator.serviceWorker.controller)).toBeNull();
  // The edge catches up: the next visit installs B with B's own page, and offline that page comes with its files.
  host.pageRoot = '';
  await page.reload();
  await controlled(page);
  expect(await cacheKeys(page)).toEqual([`nowrecommend-shell-${release.B}`]);
  await offline(context);
  await page.reload();
  await expect(page.getByRole('heading', { name: HEADING })).toBeVisible();
  expect(await loadedScript(page)).toContain(scripts.B);
});

test('the first release with the fix, over the worker deployed before it, is whole offline once it is installed', async ({ context }) => {
  // The worker before the fix still stores every page it is given, and it is the one in place when this release lands.
  host.root = dirOld;
  const page = await open(context);
  await page.goto(`${origin}/`);
  await expect(page.getByRole('heading', { name: HEADING })).toBeVisible();
  await controlled(page);
  // B arrives: the old worker stores B's page; B's worker installs (B's page and files in B's cache) and waits for the tab.
  host.root = dirB;
  await page.reload();
  await expect(page.getByRole('heading', { name: HEADING })).toBeVisible();
  await expect.poll(() => page.evaluate(async () => (await navigator.serviceWorker.getRegistration())!.waiting?.state ?? ''), { timeout: 15000 }).toBe('installed');
  // Offline under the old worker: B's page it stored finds B's files in B's cache, so the screen is whole. (Before B has
  // installed, nothing this release does can help: that window stays until the old worker is gone.)
  await offline(context);
  await page.reload();
  await expect(page.getByRole('heading', { name: HEADING })).toBeVisible();
  expect(await loadedScript(page)).toContain(scripts.B);
});
