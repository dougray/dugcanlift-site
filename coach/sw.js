/* Service worker for LIFT Coach.
 *
 * Caches the app shell so it opens with no connection. Bump CACHE when any
 * shell file changes, or browsers will keep serving the old one.
 */

const CACHE = 'coach-v39';

const SHELL = [
  '/coach/',
  '/coach/index.html',
  '/coach/style.css',
  '/coach/fonts/source-sans-3-latin.woff2',
  '/coach/fonts/source-sans-3-latin-ext.woff2',
  '/coach/parser.js',
  '/coach/recipe-import.js',
  '/coach/recipe-link.js',
  '/coach/appearance.js',
  '/coach/route.js',
  '/coach/nutrients.js',
  '/coach/sides.js',
  '/coach/prescriptions.js',
  '/coach/recipe-nutrition.js',
  '/coach/recipe-catalogue.js',
  '/coach/share-import.js',
  '/coach/client-removal.js',
  '/coach/road-picks.js',
  '/coach/plan-log.js',
  '/coach/app.js',
  '/coach/foods.js',
  '/coach/exercises.json',
  // 4.7 KB, and Cook's "Send recipes from your browser" shows it, so it is in
  // the install bundle rather than fetched on first use like the big three.
  '/coach/bookmarklets.json',
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
  // Road Food's menus are the same story, at 37 KB: fetched the first time
  // the Road section is opened, then kept. The recipe catalogue too, at 1 MB
  // (200 KB on the wire): fetched the first time the catalogue is opened,
  // never at install, since most coaches write their own recipes and should
  // not pay for 622 they never browse. All three are cache-first, so a new
  // copy of any reaches a coach only with a CACHE bump.
  if (url.pathname === '/coach/foods.json' || url.pathname === '/coach/road-food.json'
      || url.pathname === '/coach/recipes.json') {
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
