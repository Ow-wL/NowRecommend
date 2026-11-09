/* The app shell offline. Pages and the page's own hashed assets only: pictures from other hosts and the API are never cached
   here, so what the person sees is always what the server said, or the app's own offline mode. Navigations go to the network
   first and fall back to the last page we served; hashed assets never change, so they come from the cache first. */
const VERSION = 'nowrecommend-shell-v1';
const PAGE = new URL('./index.html', self.registration.scope).href;

self.addEventListener('install', () => { self.skipWaiting(); });
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== VERSION).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || !url.pathname.startsWith(new URL(self.registration.scope).pathname)) return;
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).then(response => {
      if (response.ok) { const copy = response.clone(); caches.open(VERSION).then(cache => cache.put(PAGE, copy)); }
      return response;
    }).catch(() => caches.match(PAGE).then(hit => hit || Response.error())));
    return;
  }
  if (/\/assets\/[^/]+\.[a-z0-9]+$/i.test(url.pathname) || /\.(?:svg|webmanifest)$/.test(url.pathname)) {
    event.respondWith(caches.match(request).then(hit => hit || fetch(request).then(response => {
      if (response.ok) { const copy = response.clone(); caches.open(VERSION).then(cache => cache.put(request, copy)); }
      return response;
    })));
  }
});
