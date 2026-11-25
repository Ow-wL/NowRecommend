/* The app shell offline. Pages and the page's own hashed assets only: pictures from other hosts and the API are never cached
   here, so what the person sees is always what the server said, or the app's own offline mode. Navigations go to the network
   first and fall back to the page this worker installed; hashed assets never change, so they come from the cache first.
   The cache is named after the build (the build replaces __BUILD__ here and puts the same mark in the page), so a release
   starts a fresh one: the files of the release before are dropped, and the icons and the manifest are fetched again.

   One worker, one release (2026-11-26). The offline page is only ever the page of this worker's own build, stored with its
   script and stylesheet when the worker installs; a page that comes from the network later is shown but never stored. It
   used to be stored, so a worker of release A could keep release B's page without B's files and, offline, draw nothing.
   A new worker waits until no tab runs the old one (no skipWaiting): a tab open on A keeps A's worker and A's files, and
   A's cache is dropped only once nothing uses it. Pages still come from the network first, so being online is never
   held back by a waiting worker. */
const PREFIX = 'nowrecommend-shell-';
const BUILD = '__BUILD__';
const VERSION = PREFIX + BUILD;
const PAGE = new URL('./index.html', self.registration.scope).href;
const SCOPE = new URL(self.registration.scope).pathname;

// The release is fetched whole before this worker can take over: the page, and the script and stylesheet it names. The page
// must be this build's (its mark): a host or edge cache still serving another release's page fails the install, and the
// browser tries again later with the worker from before still in place. The page goes in last, so a cache with the page
// always has its files. If anything fails (offline while updating), the install fails and the worker from before stays.
self.addEventListener('install', event => {
  event.waitUntil(fetch(PAGE, { cache: 'no-store' }).then(async response => {
    if (!response.ok) throw new Error(`page ${response.status}`);
    const html = await response.clone().text();
    if (!html.includes(`<meta name="nowrecommend-build" content="${BUILD}"`)) throw new Error('page of another release');
    const assets = [...html.matchAll(/(?:src|href)="([^"]*assets\/[^"]+)"/g)].map(match => new URL(match[1], PAGE).href);
    const cache = await caches.open(VERSION);
    await cache.addAll(assets);
    await cache.put(PAGE, response);
    // A worker activating meanwhile leaves this cache alone (it is not marked as having been in charge); should it be gone
    // all the same, this install did not take, and is tried again.
    if (!(await caches.has(VERSION))) throw new Error('cache dropped while installing');
  }));
});
// Put in a worker's cache when it takes over: the cache of a worker that was in charge, as opposed to one a newer release is
// still filling (or has filled and waits with).
const ACTIVE = new URL('./.sw-active', self.registration.scope).href;
self.addEventListener('activate', event => {
  // Only this app's own older caches: another site on the same address (other pages of the same host) keeps its own. No tab
  // runs the old worker any more (it waited for that), so the caches of workers that were in charge go: marked, or from
  // before the mark (a page without the build mark). Any other cache belongs to a newer release installing or waiting and
  // is left alone; one left behind by a failed install goes once nothing is installing or waiting.
  event.waitUntil(caches.open(VERSION).then(cache => cache.put(ACTIVE, new Response(''))).then(() => caches.keys()).then(keys => Promise.all(keys.filter(key => key.startsWith(PREFIX) && key !== VERSION).map(async key => {
    const cache = await caches.open(key), page = await cache.match(PAGE);
    const wasActive = Boolean(await cache.match(ACTIVE)) || (page !== undefined && !(await page.text()).includes('<meta name="nowrecommend-build"'));
    if (wasActive || (!self.registration.installing && !self.registration.waiting)) await caches.delete(key);
  }))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || !url.pathname.startsWith(SCOPE)) return;
  if (request.mode === 'navigate') {
    // Only the app's own page is kept for offline use. Another page under the same address (an archived version of the
    // documents, public/legal/) goes to the network as usual. Offline, the page is this worker's own, from its own cache:
    // never another release's page, whose files this worker may not have.
    if (url.pathname !== SCOPE && url.pathname !== SCOPE + 'index.html') return;
    event.respondWith(fetch(request).catch(() => caches.open(VERSION).then(cache => cache.match(PAGE)).then(hit => hit || Response.error())));
    return;
  }
  if (/\/assets\/[^/]+\.[a-z0-9]+$/i.test(url.pathname) || /\.(?:svg|png|webmanifest)$/.test(url.pathname)) {
    event.respondWith(caches.match(request).then(hit => hit || fetch(request).then(response => {
      if (response.ok) { const copy = response.clone(); caches.open(VERSION).then(cache => cache.put(request, copy)); }
      return response;
    })));
  }
});
