/* Service Worker for PEA Bill App
 * Cache-first for static assets so the app works fully offline.
 * Bump CACHE_VERSION whenever you update files to force refresh.
 */
const CACHE_VERSION = 'pea-bill-v1.3.0';
const CRITICAL_ASSETS = [
  './',
  './index.html',
  './app.js',
  './manifest.json',
  './items.json'
];
const OPTIONAL_ASSETS = [
  './icons/icon-72.png',
  './icons/icon-96.png',
  './icons/icon-128.png',
  './icons/icon-144.png',
  './icons/icon-152.png',
  './icons/icon-192.png',
  './icons/icon-384.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
  './icons/favicon-32.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_VERSION);
    // Critical assets must succeed
    await cache.addAll(CRITICAL_ASSETS);
    // Optional assets — best effort, ignore failures (e.g., missing icons)
    await Promise.all(OPTIONAL_ASSETS.map(async (url) => {
      try {
        const res = await fetch(url);
        if (res.ok) await cache.put(url, res);
      } catch (e) { /* ignore */ }
    }));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter(k => k !== CACHE_VERSION).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  // Don't cache Apps Script API calls — always go to network
  if (req.url.includes('script.google.com') || req.url.includes('script.googleusercontent.com')) {
    return;
  }

  // Network-first for items.json (so price updates can flow through)
  if (req.url.endsWith('/items.json') || req.url.endsWith('items.json')) {
    event.respondWith(
      fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE_VERSION).then(c => c.put(req, copy));
        return res;
      }).catch(() => caches.match(req))
    );
    return;
  }

  // Cache-first for everything else
  event.respondWith(
    caches.match(req).then((cached) => cached || fetch(req).then((res) => {
      // Only cache same-origin successful responses
      if (res && res.status === 200 && res.type === 'basic') {
        const copy = res.clone();
        caches.open(CACHE_VERSION).then(c => c.put(req, copy));
      }
      return res;
    }).catch(() => cached))
  );
});
