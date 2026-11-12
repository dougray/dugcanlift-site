/* Service worker for LIFT.
 *
 * Caches the app shell so it opens with no connection. Bump CACHE when any
 * shell file changes, or browsers will keep serving the old one.
 */

const CACHE = 'lift-v65';

// Street maps (map/, dugcanlift-kit's map files). The tiles a person downloads
// live in their own cache, 'lift-map-tiles', which this file never writes: it
// is the one cache an app update must leave alone, because the tiles cannot
// be fetched again without the person asking for them (see cachesToDelete).
const MAP_CACHE_PREFIX = 'lift-map-';

// Noto Sans Regular's glyph ranges, 0-255 to 65280-65535. A map asks for the
// ranges its labels need, and offline it can ask for any of them; 251 are
// empty files, so the whole set costs a few requests' worth of bytes.
const MAP_GLYPHS = Array.from({ length: 256 }, (_, i) =>
  `/lift/map/fonts/Noto%20Sans%20Regular/${i * 256}-${i * 256 + 255}.pbf`);

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
  '/lift/map/maplibre-gl.js',
  '/lift/map/maplibre-gl.css',
  '/lift/map/style-light.json',
  '/lift/map/style-dark.json',
  '/lift/map/LICENSE-maplibre.txt',
  '/lift/map/fonts/OFL.txt',
  ...MAP_GLYPHS,
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

/* The caches an update deletes: every old shell, and nothing the person
 * downloaded. */
function cachesToDelete(keys, current) {
  return keys.filter((k) => k !== current && !k.startsWith(MAP_CACHE_PREFIX));
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

  event.respondWith(
    caches.match(event.request).then((hit) => {
      if (hit) return hit;
      return fetch(event.request).catch(() => caches.match('/lift/index.html'));
    })
  );
});
