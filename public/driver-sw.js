// Offline shell for the driver app. Deliberately tiny and deliberately dumb:
// the queue that protects a driver's work lives in the page (IndexedDB), and a
// service worker that tried to be clever about API responses would be the thing
// that showed somebody yesterday's stops as if they were today's.
//
// Rules:
//   * the page itself: network first, fall back to the last copy we saw, so the
//     app opens in a basement instead of showing a dinosaur;
//   * static build assets: cache first (they're content-hashed);
//   * anything under /api: never cached, never served stale.
const CACHE = 'bb-driver-v1';
const SHELL = '/driver';

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.add(SHELL)).catch(() => {}).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;          // never stale data

  const isShell = url.pathname === SHELL || url.pathname.startsWith('/driver');
  if (isShell) {
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(SHELL, copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match(SHELL).then((r) => r || new Response(
          '<h1>No signal</h1><p>Open this again when you have a bar or two — everything you tapped is saved.</p>',
          { headers: { 'Content-Type': 'text/html' } }
        )))
    );
    return;
  }

  if (url.pathname.startsWith('/_next/static/')) {
    e.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        return res;
      }))
    );
  }
});
