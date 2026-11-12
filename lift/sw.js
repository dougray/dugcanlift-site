/* Service worker for LIFT.
 *
 * Caches the app shell so it opens with no connection. Bump CACHE when any
 * shell file changes, or browsers will keep serving the old one.
 */

const CACHE = 'lift-v65';

// Street maps (map/, dugcanlift-kit's map files). Two caches here are not the
// shell's, and an app update must leave both alone:
//
//  - 'lift-map-tiles' holds the streets a person downloaded. This file never
//    writes it, and the tiles cannot be fetched again without the person asking.
//  - the map-owned asset cache holds what is large and optional: the 1 MB
//    engine and Noto Sans's glyph ranges (map/maplibre-gl.js, map/fonts/*.pbf).
//    They are not in SHELL, where one 404 would fail the whole install and
//    every install would pay for them: they are kept the first time a map
//    asks, and survive shell bumps. The cache is named for the first 8 hex of
//    the engine's sha256 (VENDOR.md), so a new engine starts a new cache and
//    the old one is pruned (cachesToDelete). map.test.mjs pins the name.
//
// Cache Storage is per origin, and www.dugcanlift.com serves /coach/ too, so an
// update deletes only this app's own old shells: nothing that is not lift-.
const MAP_CACHE_PREFIX = 'lift-map-';
const MAP_ASSETS = 'lift-map-assets-45a9b07a';

const SHELL = [
  '/lift/',
  '/lift/index.html',
  '/lift/style.css',
  '/lift/fonts/source-sans-3-latin.woff2',
  '/lift/fonts/source-sans-3-latin-ext.woff2',
  '/lift/appearance.js',
  '/lift/app.js',
  '/lift/nutrients.js',
  '/lift/foods.js',
  '/lift/food-amount.js',
  '/lift/backup.js',
  '/lift/routines.js',
  '/lift/my-equipment.js',
  '/lift/rotation.js',
  '/lift/progression.js',
  '/lift/sides.js',
  '/lift/set-types.js',
  '/lift/plates.js',
  '/lift/live-session.js',
  '/lift/plan-log.js',
  '/lift/outdoor.js',
  '/lift/workout-csv.js',
  '/lift/progress.js',
  '/lift/road-food.js',
  '/lift/recipe-import.js',
  '/lift/recipe-link.js',
  '/lift/bookmarklets.json',
  '/lift/recipe-catalog.js',
  '/lift/splits.json',
  '/lift/jsqr.js',
  '/lift/map/map.js',
  '/lift/map/maplibre-gl.css',
  '/lift/map/style-light.json',
  '/lift/map/style-dark.json',
  '/lift/map/LICENSE-maplibre.txt',
  '/lift/map/fonts/OFL.txt',
  '/lift/watch-scan.js',
  '/lift/exercises.json',
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

/* The caches an update deletes: this app's own old shells, and the asset
 * caches of an engine no longer in use. Never the tiles, never the current
 * asset cache, and never a key that is not this app's (Coach's, for one). */
function cachesToDelete(keys, current) {
  return keys.filter((k) => k.startsWith('lift-') && k !== current && (
    k.startsWith('lift-map-assets-') ? k !== MAP_ASSETS : !k.startsWith(MAP_CACHE_PREFIX)));
}

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        cachesToDelete(keys, CACHE).map((k) => caches.delete(k))
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

  // The ingredient database is 718 KB, so it is not in the install bundle —
  // but it is cached the first time it is actually used, which is what makes
  // the lookup work in a gym with no signal. Road Food's menus are the same:
  // fetched when Road Food first opens, then kept for the interstate. So is the
  // recipe catalogue (1 MB): most people never open it, and an install that
  // fetched it for everyone would be the largest file in the app. All three
  // are cache-first, so a new copy reaches people only with a CACHE bump.
  if (url.pathname === '/lift/foods.json' || url.pathname === '/lift/road-food.json'
      || url.pathname === '/lift/recipes.json') {
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

  // The engine and the glyph ranges: kept on first use, in the map-owned cache,
  // and a miss while offline is a 404, never the shell page (a script or a
  // font answered with HTML is worse than no answer).
  if (url.pathname.startsWith('/lift/map/') && !SHELL.includes(url.pathname)) {
    event.respondWith(
      caches.open(MAP_ASSETS)
        .then((cache) => cache.match(event.request).then((hit) => hit || fetch(event.request).then((response) => {
          if (response.ok) cache.put(event.request, response.clone());
          return response;
        })))
        .catch(() => new Response('', { status: 404 }))
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then((hit) => {
      if (hit) return hit;
      return fetch(event.request).catch(() => caches.match('/lift/index.html'));
    })
  );
});
