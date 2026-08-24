/* Service worker for LIFT.
 *
 * Caches the app shell so it opens with no connection. Bump CACHE when any
 * shell file changes, or browsers will keep serving the old one.
 */

const CACHE = 'lift-v4';

const SHELL = [
  '/lift/',
  '/lift/index.html',
  '/lift/style.css',
  '/lift/app.js',
  '/lift/manifest.webmanifest',
  '/lift/icon-192.png',
  '/lift/icon-512.png',
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
      .then((keys) => Promise.all(
        keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Only ever handle our own shell. Open Food Facts requests must go straight
  // to the network — caching food lookups would serve stale nutrition data,
  // and a cached failure would look like the feature is broken.
  if (url.origin !== self.location.origin || !url.pathname.startsWith('/lift/')) {
    return;
  }

  event.respondWith(
    caches.match(event.request).then((hit) => {
      if (hit) return hit;
      return fetch(event.request).catch(() => caches.match('/lift/index.html'));
    })
  );
});
