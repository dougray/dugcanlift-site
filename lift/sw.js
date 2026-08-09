/* Caches the app shell so LIFT opens with no signal — which is most gyms.
 *
 * Bump CACHE when you change any shell file, or phones will keep serving the
 * old one. That's the single most common way a PWA appears not to update.
 */
const CACHE = 'lift-v1';

const SHELL = [
  './',
  'index.html',
  'style.css',
  'app.js',
  'manifest.webmanifest',
  'icon-192.png',
  'icon-512.png',
  'icon-180.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Never cache Open Food Facts — stale nutrition data would be worse than
  // no result, and those responses aren't part of the shell.
  if (url.hostname.endsWith('openfoodfacts.org')) return;

  if (event.request.method !== 'GET') return;

  event.respondWith(
    caches.match(event.request).then((hit) => hit || fetch(event.request).catch(() => {
      // Offline and not cached: fall back to the shell so navigation still works.
      if (event.request.mode === 'navigate') return caches.match('index.html');
      throw new Error('offline');
    }))
  );
});
