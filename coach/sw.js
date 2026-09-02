/* Service worker for LIFT Coach.
 *
 * Caches the app shell so it opens with no connection. Bump CACHE when any
 * shell file changes, or browsers will keep serving the old one.
 */

const CACHE = 'coach-v7';

const SHELL = [
  '/coach/',
  '/coach/index.html',
  '/coach/style.css',
  '/coach/parser.js',
  '/coach/app.js',
  '/coach/foods.js',
  '/coach/exercises.json',
  '/coach/manifest.webmanifest',
  '/coach/icon-180.png',
  '/coach/icon-192.png',
  '/coach/icon-512.png',
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

  // Only ever handle our own shell.
  if (url.origin !== self.location.origin || !url.pathname.startsWith('/coach/')) {
    return;
  }

  // The ingredient database is 634 KB, so it is not in the install bundle —
  // but it is cached the first time it is actually used, which is what makes
  // the lookup work in a gym with no signal.
  if (url.pathname === '/coach/foods.json') {
    event.respondWith(
      caches.match(event.request).then((hit) => hit || fetch(event.request).then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(event.request, copy));
        }
        return response;
      }))
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then((hit) => {
      if (hit) return hit;
      return fetch(event.request).catch(() => caches.match('/coach/index.html'));
    })
  );
});
