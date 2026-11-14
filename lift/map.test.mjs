import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import vm from 'node:vm';

// Street maps in LIFT web. The map module, MapLibre GL JS, the styles and the
// glyphs are dugcanlift-kit's map/ folder, copied here byte for byte (the web/
// folder's files flattened into lift/map/, where map.js looks for its
// stylesheet, styles and fonts). They are pinned the way road-food.json is.

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const MAP = 'lift/map/';

/** The kit's manifest, "<sha256>  <path>" per line, as { 'web/map.js': hash, ... }. */
function manifest() {
  const rows = readFileSync(`${MAP}map-files.sha256`, 'utf8').trim().split('\n');
  return new Map(rows.map((line) => {
    assert.match(line, /^[0-9a-f]{64} {2}\S/, `a manifest line: ${line}`);
    return [line.slice(66), line.slice(0, 64)];
  }));
}

/** The manifest names the kit's layout; the web/ files sit one level up here. */
const here = (kitPath) => MAP + kitPath.replace(/^web\//, '');

function walk(dir) {
  return readdirSync(dir).flatMap((n) => {
    const p = `${dir}${n}`;
    return statSync(p).isDirectory() ? walk(`${p}/`) : [p];
  });
}

test('the map files are the kit\'s, byte for byte', () => {
  const m = manifest();
  assert.ok(m.size > 260, 'the manifest lists the styles, the 256 glyph ranges and the web files');
  for (const [kitPath, hash] of m) {
    assert.ok(existsSync(here(kitPath)), `${here(kitPath)} is missing`);
    assert.equal(sha256(readFileSync(here(kitPath))), hash,
      `${here(kitPath)} does not match map-files.sha256.\n` +
      'Copy dugcanlift-kit\'s map/ over together (web/ files flattened into lift/map/) with its\n' +
      'map-files.sha256. Never edit a file here, and never re-write the checksum by hand:\n' +
      'node map/write-checksum.mjs in the kit writes it, and the other apps pin the same one.');
  }
  // Nothing else rides along in the folder: every file is listed.
  const listed = new Set([...m.keys()].map(here));
  listed.add(`${MAP}map-files.sha256`);
  const stray = walk(MAP).filter((f) => !listed.has(f) && !f.endsWith('/.DS_Store'));
  assert.deepEqual(stray, [], 'files in lift/map/ that map-files.sha256 does not list');
});

test('the manifest carries all 256 glyph ranges, the empty ones too', () => {
  const fonts = [...manifest().keys()].filter((k) => k.startsWith('fonts/Noto Sans Regular/') && k.endsWith('.pbf'));
  assert.equal(fonts.length, 256);
  assert.deepEqual(fonts.map((f) => f.replace(/^.*\//, '')).sort(),
    Array.from({ length: 256 }, (_, i) => `${i * 256}-${i * 256 + 255}.pbf`).sort());
});

test('the tile-size fixture rides along as evidence, pinned and never loaded', () => {
  const m = manifest();
  assert.ok(m.has('tile-size-sample.json'), 'listed in the kit\'s manifest');
  assert.ok(existsSync(`${MAP}tile-size-sample.json`));
  assert.ok(!readFileSync('lift/sw.js', 'utf8').includes('tile-size-sample'), 'not cached: nothing asks for it');
  assert.ok(!readFileSync(`${MAP}map.js`, 'utf8').includes("'tile-size-sample"), 'map.js only names it in a comment');
});

// MARK: - The service worker

/** sw.js as the browser runs it: its functions and constants, and the listeners it registered. */
function serviceWorker(extra = {}) {
  const listeners = {};
  const sandbox = {
    self: { addEventListener(type, fn) { listeners[type] = fn; }, location: { origin: 'https://example.test' } },
    URL, Response, ...extra,
  };
  vm.createContext(sandbox);
  vm.runInContext(readFileSync('lift/sw.js', 'utf8')
    + '\nthis.__sw = { CACHE, SHELL, cachesToDelete, MAP_ASSETS };', sandbox);
  return { ...sandbox.__sw, listeners };
}

/** The engine's sha256 as VENDOR.md pins it, which names the map-owned asset cache. */
const enginePin = () =>
  /^\| `maplibre-gl\.js` \| `[^`]+` \| `([0-9a-f]{64})` \|$/m.exec(readFileSync(`${MAP}VENDOR.md`, 'utf8'))[1];

test('the map tile cache survives an app update', () => {
  const { cachesToDelete, MAP_ASSETS } = serviceWorker();
  assert.deepEqual(cachesToDelete(['lift-v64', 'lift-v65', 'lift-map-tiles'], 'lift-v65'), ['lift-v64']);
  assert.deepEqual(cachesToDelete(['lift-v1', 'lift-map-tiles', MAP_ASSETS], 'lift-v2'), ['lift-v1']);
  assert.deepEqual(cachesToDelete([], 'lift-v2'), []);
});

test('an update deletes LIFT\'s own old shells and nothing that is Coach\'s', () => {
  // Cache Storage is per origin and www.dugcanlift.com serves /lift/ and /coach/:
  // Coach's streets and Coach's shell are not this worker's to delete.
  const { cachesToDelete, MAP_ASSETS } = serviceWorker();
  const keys = ['lift-v64', 'lift-v65', 'lift-map-tiles', MAP_ASSETS, 'coach-v44', 'coach-map-tiles',
    'coach-map-assets-0a1b2c3d', 'other'];
  assert.deepEqual(cachesToDelete(keys, 'lift-v65'), ['lift-v64']);
});

test('the map-owned asset cache is named for the engine\'s hash, and an old one is pruned', () => {
  const { cachesToDelete, MAP_ASSETS } = serviceWorker();
  assert.equal(MAP_ASSETS, `lift-map-assets-${enginePin().slice(0, 8)}`);
  assert.deepEqual(cachesToDelete(['lift-v65', 'lift-map-assets-deadbeef', MAP_ASSETS, 'lift-map-tiles'], 'lift-v65'),
    ['lift-map-assets-deadbeef']);
});

test('the shell holds the small map files and not the engine or the glyph ranges', () => {
  const { SHELL } = serviceWorker();
  for (const path of SHELL) {
    if (path === '/lift/') continue;
    assert.ok(existsSync(`lift${decodeURI(path).slice('/lift'.length)}`), `${path} is in the shell but not on disk`);
  }
  const inShell = new Set(SHELL.map((p) => decodeURI(p)));
  for (const f of ['map.js', 'maplibre-gl.css', 'style-light.json', 'style-dark.json', 'LICENSE-maplibre.txt', 'fonts/OFL.txt']) {
    assert.ok(inShell.has(`/lift/map/${f}`), `${f} is cached with the shell`);
  }
  assert.ok(!SHELL.some((p) => p.includes('maplibre-gl.js')), 'the 1 MB engine is cached on first use');
  assert.ok(!SHELL.some((p) => p.endsWith('.pbf')), 'glyph ranges are cached on first use');
});

/** A Cache Storage with just open() and match(), and a log of what was put where. */
function fakeCaches() {
  const stores = new Map();
  const store = (name) => { if (!stores.has(name)) stores.set(name, new Map()); return stores.get(name); };
  return {
    stores,
    open: async (name) => ({
      match: async (req) => store(name).get(typeof req === 'string' ? req : req.url)?.clone(),
      put: async (req, res) => { store(name).set(typeof req === 'string' ? req : req.url, res); },
    }),
    match: async (req) => {
      for (const m of stores.values()) { const hit = m.get(typeof req === 'string' ? req : req.url); if (hit) return hit.clone(); }
      return undefined;
    },
  };
}

/** Sends a GET to the worker's fetch listener and resolves to what it answered, or undefined if it let it go. */
async function ask(listener, url) {
  let answer;
  listener({ request: { url, method: 'GET' }, respondWith(p) { answer = p; } });
  return answer && await answer;
}

test('the engine and the glyphs are cached on first use, in the map-owned cache, offline after', async () => {
  const caches = fakeCaches();
  let network = 0;
  let offline = false;
  const fetch = async () => { network += 1; if (offline) throw new TypeError('offline'); return new Response('x', { status: 200 }); };
  const { listeners, MAP_ASSETS, CACHE } = serviceWorker({ caches, fetch });
  const engine = 'https://example.test/lift/map/maplibre-gl.js';
  const glyph = 'https://example.test/lift/map/fonts/Noto%20Sans%20Regular/0-255.pbf';

  assert.equal((await ask(listeners.fetch, engine)).status, 200);
  assert.equal((await ask(listeners.fetch, glyph)).status, 200);
  assert.equal(network, 2);
  assert.deepEqual([...caches.stores.keys()], [MAP_ASSETS], 'both went to the map-owned cache and nowhere else');
  assert.ok(!caches.stores.has(CACHE));

  offline = true;
  assert.equal(await (await ask(listeners.fetch, engine)).text(), 'x', 'kept for offline');
  assert.equal(network, 2, 'a kept file is not asked for again');
  const missing = await ask(listeners.fetch, 'https://example.test/lift/map/fonts/Noto%20Sans%20Regular/256-511.pbf');
  assert.equal(missing.status, 404, 'a miss while offline is a 404, never the shell page');
});

test('a map file in the shell is answered by the shell, not the asset cache', async () => {
  const caches = fakeCaches();
  await (await caches.open('lift-v65')).put('https://example.test/lift/map/map.js', new Response('shell copy'));
  const { listeners } = serviceWorker({ caches, fetch: async () => { throw new Error('no network'); } });
  assert.equal(await (await ask(listeners.fetch, 'https://example.test/lift/map/map.js')).text(), 'shell copy');
});

test('the cache name moved, so an installed copy takes the new shell', () => {
  const { CACHE } = serviceWorker();
  const n = Number(/^lift-v(\d+)$/.exec(CACHE)?.[1]);
  assert.ok(n > 64, `CACHE is ${CACHE}; it was lift-v64 before maps`);
});

// MARK: - Only map.js reaches beyond dugcanlift.com

// Patterns, not substrings: the tile server's name, and a fetch of an absolute address.
const BEYOND = [/openfreemap/i, /fetch\(\s*['"`]https?:/i];

/** Every http(s) address written in a script, lower-cased, up to a quote, backtick, backslash or space. */
const urlsIn = (text) => text.toLowerCase().match(/https?:\/\/[^'"`\\\s)]+/g) ?? [];

test('only map.js reaches beyond dugcanlift.com', () => {
  const own = readdirSync('lift').filter((f) => f.endsWith('.js') && f !== 'jsqr.js');
  assert.ok(own.includes('app.js') && own.includes('sw.js'));
  for (const f of own) {
    const text = readFileSync(`lift/${f}`, 'utf8').toLowerCase();
    for (const pattern of BEYOND) assert.ok(!pattern.test(text), `lift/${f} matches ${pattern}`);
  }
  // The map folder: map.js is the one file that names the tile server, and the
  // vendored library is exempt by its pinned hash and nothing else. Any other
  // script there is checked like the app's own.
  const vendor = readFileSync(`${MAP}VENDOR.md`, 'utf8');
  const pinned = /^\| `maplibre-gl\.js` \| `[^`]+` \| `([0-9a-f]{64})` \|$/m.exec(vendor)?.[1];
  assert.ok(pinned, 'VENDOR.md pins maplibre-gl.js');
  for (const f of readdirSync(MAP).filter((n) => n.endsWith('.js'))) {
    const bytes = readFileSync(MAP + f);
    if (f === 'maplibre-gl.js') {
      assert.equal(sha256(bytes), pinned, 'the vendored library is the pinned release');
    } else if (f !== 'map.js') {
      assert.fail(`lift/map/${f} is a script nobody vetted`);
    }
  }
  // The street download's address appears in map.js and nowhere in app.js, so a
  // second place that could ask for tiles cannot appear unnoticed.
  // Every address map.js writes is parsed and its host compared, never searched
  // for as text: https on the tile server, or on this site.
  const found = urlsIn(readFileSync(`${MAP}map.js`, 'utf8'));
  const hosts = found.map((u) => new URL(u));
  assert.ok(hosts.some((u) => u.host === 'tiles.openfreemap.org'), 'map.js names the tile server');
  for (const u of hosts) {
    assert.equal(u.protocol, 'https:', `${u.href} is not https`);
    assert.ok(u.host === 'tiles.openfreemap.org' || u.host === 'www.dugcanlift.com',
      `map.js names ${u.host}, which is neither the tile server nor this site`);
  }
});

// MARK: - Wiring

test('the page loads map.js before app.js, and MapLibre only when a map is first drawn', () => {
  const html = readFileSync('lift/index.html', 'utf8');
  const order = [...html.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(order.indexOf('map/map.js') > -1, 'index.html loads map/map.js');
  assert.ok(order.indexOf('map/map.js') < order.indexOf('app.js'), 'map.js comes before app.js');
  assert.ok(!order.includes('map/maplibre-gl.js'), 'the 1 MB engine is not a startup script');
  const app = readFileSync('lift/app.js', 'utf8');
  assert.ok(app.includes("'map/maplibre-gl.js'"), 'app.js loads the engine on first need');
  assert.match(app, /LiftMap\.configure\(\{\s*cachePrefix: 'lift-map-',\s*storageKey: 'lift\.mapAreas',\s*base: '\/lift\/map\/'/);
});

test('area tiles and the area index stay out of backups', () => {
  const backup = readFileSync('lift/backup.js', 'utf8');
  assert.ok(!/mapAreas|liftmap|lift-map/i.test(backup));
});
