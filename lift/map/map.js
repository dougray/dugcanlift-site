/* LIFT street maps, shared by LIFT web and Coach web.
 *
 * The source of truth is dugcanlift-kit's map/web/map.js. Each app copies it,
 * byte for byte, beside the styles, the fonts and MapLibre GL JS, and pins the
 * copy to map/map-files.sha256. Never edit a copy.
 *
 * A port of the kit's Swift LiftMapCore and LiftMap: the same names, numbers
 * and words. What differs is storage. The area index lives in
 * localStorage[storageKey]; tiles live in one Cache Storage cache,
 * `${cachePrefix}tiles`. Cache Storage refuses a key that is not http(s), so a
 * tile is keyed `${location.origin}/__liftmap/tiles/{z}/{x}/{y}`: a key, never
 * a request. Nothing asks for that address. MapLibre reads tiles through the
 * `liftmap://` protocol below, which answers from the cache or with an empty
 * tile, and never from the network.
 *
 * The one request: a street download the person starts, to OpenFreeMap's tile
 * server, from the marked download section below and from nowhere else.
 * Viewing a map asks for nothing but the app's own files.
 *
 * Classic script, no build step: sets window.LiftMap. MapLibre GL JS 5.x is
 * another classic script, maplibre-gl.js in the app's own map folder, which
 * the page loads before this one and which sets window.maplibregl. Its worker
 * is built from a Blob of code inside that file, so it asks for nothing. With
 * no window.maplibregl (or no WebGL) every route is the app's plain line.
 */
(function (window) {
  'use strict';

  var cfg = { cachePrefix: 'lift-map-', storageKey: 'lift.mapAreas', base: '/lift/map/' };

  /** Bumped whenever the set of finished areas changes. */
  var revision = 0;
  var CHANGED = 'liftmap:changed';

  // MARK: - Copy, the iPhone's word for word

  var copy = Object.freeze({
    attribution: '© OpenStreetMap contributors · OpenFreeMap',
    title: 'Download streets',
    streetsWithin: 'Streets within',
    source: 'OpenStreetMap data from OpenFreeMap',
    serverLearns: 'OpenFreeMap learns which area you asked for, once.',
    failure: "Couldn't finish. Try again to pick up where it stopped.",
    downloading: 'Downloading streets',
    download: 'Download',
    cancel: 'Cancel',
    tryAgain: 'Try again',
    maps: 'Maps',
    mapsFooter: 'Streets are drawn from areas you download. Nothing is sent while you look at a map.',
    update: 'Update',
    delete: 'Delete',
    notFinished: 'Not finished',
    noStreets: 'No streets downloaded.',
    aroundHere: 'Download streets around here',
    aroundLastRun: 'Download streets around your last run',
    forThisRoute: 'Download streets for this route',
    routeAreaName: 'Streets for this route',
    deleteMessage: 'You can download it again later.',
    routeLabel: 'Route',
  });

  function deleteTitle(name) { return 'Delete ' + name + '?'; }
  function radiusText(km) { return km + ' km'; }

  /** "Streets around 39.74, -104.99". No place name: finding one would be a request. */
  function nameAround(lat, lon) {
    return 'Streets around ' + lat.toFixed(2) + ', ' + lon.toFixed(2);
  }

  /** Bytes as Apple's file-size formatter writes them, in 1000s: "512 KB", "24.8 MB", "1.25 GB". */
  function bytesText(n) {
    if (!(n > 0)) return 'Zero KB';
    if (n < 1000) return n === 1 ? '1 byte' : n + ' bytes';
    var units = [['KB', 0], ['MB', 1], ['GB', 2], ['TB', 2]];
    for (var i = 0; i < units.length; i++) {
      var digits = units[i][1];
      var scale = Math.pow(10, digits);
      var rounded = Math.round(n / Math.pow(1000, i + 1) * scale) / scale;
      if (rounded < 1000 || i === units.length - 1) {
        return rounded.toLocaleString(undefined, { maximumFractionDigits: digits }) + ' ' + units[i][0];
      }
    }
    return '';
  }

  /** "About 40 MB". */
  function sizeText(bytes) { return 'About ' + bytesText(bytes); }

  /** "24.8 MB · Nov 10, 2026", in the reader's locale. */
  function detailLine(area) {
    var day = new Date(area.downloadedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
    return bytesText(area.bytes) + ' · ' + day;
  }

  // MARK: - Tile maths (StreetTiles)

  var MAX_LAT = 85.0511;
  var KM_PER_DEGREE = 111.32;

  function latLon(p) {
    return Array.isArray(p) ? [p[0], p[1]] : [p.latitude, p.longitude];
  }

  /** A square reaching radiusKm north, south, east and west of the centre. */
  function bounds(lat, lon, radiusKm) {
    var dLat = radiusKm / KM_PER_DEGREE;
    var dLon = radiusKm / (KM_PER_DEGREE * Math.max(0.01, Math.cos(lat * Math.PI / 180)));
    return {
      south: Math.max(-MAX_LAT, lat - dLat), west: Math.max(-180, lon - dLon),
      north: Math.min(MAX_LAT, lat + dLat), east: Math.min(180, lon + dLon),
    };
  }

  function x(lon, z) {
    var n = Math.pow(2, z);
    return Math.min(n - 1, Math.max(0, Math.floor((lon + 180) / 360 * n)));
  }

  function y(lat, z) {
    var n = Math.pow(2, z);
    var r = Math.max(-MAX_LAT, Math.min(MAX_LAT, lat)) * Math.PI / 180;
    return Math.min(n - 1, Math.max(0, Math.floor((1 - Math.asinh(Math.tan(r)) / Math.PI) / 2 * n)));
  }

  /** Number of tiles covering the bounds at one zoom. */
  function count(b, z) {
    return (x(b.east, z) - x(b.west, z) + 1) * (y(b.south, z) - y(b.north, z) + 1);
  }

  /** Every tile covering the bounds at one zoom, as {z, x, y} with y from the top. */
  function tiles(b, z) {
    var x0 = x(b.west, z), x1 = x(b.east, z), y0 = y(b.north, z), y1 = y(b.south, z);
    var out = [];
    for (var tx = x0; tx <= x1; tx++) {
      for (var ty = y0; ty <= y1; ty++) out.push({ z: z, x: tx, y: ty });
    }
    return out;
  }

  /** Typical OpenFreeMap tile size by zoom; real areas vary by half either way. */
  function typicalBytes(z) {
    if (z <= 5) return 250000;
    if (z <= 8) return 120000;
    if (z <= 10) return 30000;
    if (z <= 12) return 40000;
    if (z === 13) return 25000;
    return 15000;
  }

  /** The smallest box holding every point ([lat, lon, ...] or {latitude, longitude}); null for none. */
  function around(points) {
    if (!points || !points.length) return null;
    var f = latLon(points[0]);
    var b = { south: f[0], west: f[1], north: f[0], east: f[1] };
    for (var i = 1; i < points.length; i++) {
      var p = latLon(points[i]);
      b.south = Math.min(b.south, p[0]);
      b.north = Math.max(b.north, p[0]);
      b.west = Math.min(b.west, p[1]);
      b.east = Math.max(b.east, p[1]);
    }
    return b;
  }

  /** True when the boxes overlap; boxes that only touch at an edge do. */
  function intersects(a, b) {
    return a.south <= b.north && a.north >= b.south && a.west <= b.east && a.east >= b.west;
  }

  // MARK: - Plans (StreetAreaPlan)

  var WIDE_KM = 100;
  var WIDE_ZOOMS = [0, 10];
  var DETAIL_ZOOMS = [11, 14];
  var DETAIL_CHOICES = Object.freeze([10, 25, 50]);

  function estimateBytes(p) {
    return p.tiles.reduce(function (t, tile) { return t + typicalBytes(tile.z); }, 0);
  }

  function makePlan(lat, lon, detailKm, wide, detail) {
    var all = [];
    var z;
    for (z = WIDE_ZOOMS[0]; z <= WIDE_ZOOMS[1]; z++) all = all.concat(tiles(wide, z));
    for (z = DETAIL_ZOOMS[0]; z <= DETAIL_ZOOMS[1]; z++) all = all.concat(tiles(detail, z));
    var p = { latitude: lat, longitude: lon, detailKm: detailKm, wide: wide, detail: detail, tiles: all };
    p.estimatedBytes = estimateBytes(p);
    return p;
  }

  /** A wide layer (zoom 0-10) 100 km around the point, and every street (11-14) detailKm around it. */
  function plan(lat, lon, detailKm) {
    return makePlan(lat, lon, detailKm, bounds(lat, lon, WIDE_KM), bounds(lat, lon, detailKm));
  }

  /** Coach: the route's bounds grown 2 km on every side, with the wide layer 100 km around its centre. */
  function planForRoute(b) {
    var lat = (b.south + b.north) / 2;
    var lon = (b.west + b.east) / 2;
    var dLat = 2 / KM_PER_DEGREE;
    var dLon = 2 / (KM_PER_DEGREE * Math.max(0.01, Math.cos(lat * Math.PI / 180)));
    var detail = {
      south: Math.max(-MAX_LAT, b.south - dLat), west: Math.max(-180, b.west - dLon),
      north: Math.min(MAX_LAT, b.north + dLat), east: Math.min(180, b.east + dLon),
    };
    return makePlan(lat, lon, 0, bounds(lat, lon, WIDE_KM), detail);
  }

  /**
   * The plan an area was downloaded with, for an update or a retry
   * (MapsSection.replan). A route area (detailKm 0) stored the route's box
   * already grown 2 km, so it is shrunk back first and planForRoute grows it
   * to the same box.
   */
  function replan(area) {
    var d = area.detail;
    var lat = (d.south + d.north) / 2;
    var lon = (d.west + d.east) / 2;
    if (area.detailKm > 0) return plan(lat, lon, area.detailKm);
    var dLat = 2 / KM_PER_DEGREE;
    var dLon = 2 / (KM_PER_DEGREE * Math.max(0.01, Math.cos(lat * Math.PI / 180)));
    return planForRoute({
      south: Math.min(lat, d.south + dLat), west: Math.min(lon, d.west + dLon),
      north: Math.max(lat, d.north - dLat), east: Math.max(lon, d.east - dLon),
    });
  }

  /** 'map' when downloaded streets cover the route's bounds, else 'line' (RouteMapDecision). */
  function decide(points, covered) {
    if (!points || points.length < 2) return 'line';
    var b = around(points);
    return b && covered(b) ? 'map' : 'line';
  }

  // MARK: - Errors

  /** codes: refusedHost, badTemplate, http (with status), unknownArea, cancelled, noStorage. */
  function fail(code, message, extra) {
    var e = new Error(message || code);
    e.code = code;
    if (code === 'cancelled') e.name = 'AbortError';
    if (extra) Object.keys(extra).forEach(function (k) { e[k] = extra[k]; });
    return e;
  }

  // MARK: - The area index (localStorage)

  var lastRaw;
  var lastIndex = null;
  var ownedSets = new WeakMap();

  function isNumber(v) { return typeof v === 'number' && isFinite(v); }

  function validEntry(e) {
    return !!e && typeof e === 'object' && typeof e.id === 'string' && typeof e.name === 'string' &&
      !!e.detail && isNumber(e.detail.south) && isNumber(e.detail.west) && isNumber(e.detail.north) &&
      isNumber(e.detail.east) && Array.isArray(e.tiles);
  }

  /** The index, parsed once per change of the stored text. */
  function readIndex() {
    var raw = null;
    try { raw = window.localStorage.getItem(cfg.storageKey); } catch (e) { raw = null; }
    if (lastIndex && raw === lastRaw) return lastIndex;
    var list = [];
    try {
      var parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) list = parsed.filter(validEntry);
    } catch (e) { list = []; }
    lastRaw = raw;
    lastIndex = list;
    return list;
  }

  function writeIndex(list) {
    var raw = JSON.stringify(list);
    try {
      window.localStorage.setItem(cfg.storageKey, raw);
    } catch (e) {
      lastIndex = null;
      throw e;
    }
    lastRaw = raw;
    lastIndex = list;
  }

  function findArea(list, id) {
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  /** The area's tile keys as a set, built once per parsed entry. */
  function owned(entry) {
    var s = ownedSets.get(entry);
    if (!s) {
      s = new Set(entry.tiles);
      ownedSets.set(entry, s);
    }
    return s;
  }

  function tileKey(t) { return t.z + '/' + t.x + '/' + t.y; }

  function publicArea(e) {
    return {
      id: e.id, name: e.name,
      detail: { south: e.detail.south, west: e.detail.west, north: e.detail.north, east: e.detail.east },
      detailKm: e.detailKm || 0, downloadedAt: e.downloadedAt || 0, bytes: e.bytes || 0,
    };
  }

  function listed(finished) {
    return readIndex()
      .filter(function (e) { return !!e.finished === finished; })
      .sort(function (a, b) { return (b.downloadedAt || 0) - (a.downloadedAt || 0); })
      .map(publicArea);
  }

  /** Finished areas, newest first: {id, name, detail, detailKm, downloadedAt, bytes}. */
  function areas() { return listed(true); }

  /** Areas begun and not finished (an interrupted download), newest first; resume takes one. */
  function unfinishedAreas() { return listed(false); }

  /** True when any finished area touches the bounds. */
  function covers(b) {
    return readIndex().some(function (e) { return e.finished && intersects(e.detail, b); });
  }

  function hasTile(id, tile) {
    var entry = findArea(readIndex(), id);
    return !!entry && owned(entry).has(tileKey(tile));
  }

  function newId() {
    var c = window.crypto;
    if (c && typeof c.randomUUID === 'function') return c.randomUUID();
    return 'area-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
  }

  /** Records an area before any tile is written for it; it lists as unfinished until finishArea. */
  function beginArea(p, name) {
    var list = readIndex().slice();
    var id = newId();
    list.push({
      id: id, name: name,
      detail: { south: p.detail.south, west: p.detail.west, north: p.detail.north, east: p.detail.east },
      detailKm: p.detailKm, downloadedAt: Date.now(), bytes: 0, finished: false, tiles: [],
    });
    writeIndex(list);
    return id;
  }

  function finishArea(id) {
    var list = readIndex();
    var entry = findArea(list, id);
    if (!entry) throw fail('unknownArea', 'That area is not in the index.');
    entry.finished = true;
    entry.downloadedAt = Date.now();
    writeIndex(list);
    changed();
  }

  /** The finished areas, as one string: what a map's decision depends on, and nothing about tiles. */
  function finishedSignature() {
    return readIndex()
      .filter(function (e) { return e.finished; })
      .map(function (e) { return e.id; })
      .sort()
      .join(',');
  }

  var lastSignature = null;

  /** Says, once, that the finished areas changed; every mounted map decides again. */
  function changed() {
    lastSignature = finishedSignature();
    revision += 1;
    if (typeof window.dispatchEvent !== 'function') return;
    var Ev = window.CustomEvent;
    window.dispatchEvent(typeof Ev === 'function' ? new Ev(CHANGED) : new window.Event(CHANGED));
  }

  // MARK: - Tiles (Cache Storage)

  var TILE_PATH = '/__liftmap/tiles/';
  /** Tiles being written and not yet in the index, by key; a sweep spares them. */
  var writing = new Map();

  function cacheUrl(key) { return window.location.origin + TILE_PATH + key; }

  function keyOfCacheUrl(url) {
    var i = url.indexOf(TILE_PATH);
    return i < 0 ? null : url.slice(i + TILE_PATH.length);
  }

  function openCache() {
    if (!window.caches) return Promise.reject(fail('noStorage', 'This browser keeps no Cache Storage here.'));
    return window.caches.open(cfg.cachePrefix + 'tiles');
  }

  function ownedByAny(key) {
    return readIndex().some(function (e) { return owned(e).has(key); });
  }

  /** Stores one tile for an area in the index. Refused, leaving nothing behind, for an area with no entry. */
  function putTile(id, tile, data) {
    if (!findArea(readIndex(), id)) return Promise.reject(fail('unknownArea', 'That area is not in the index.'));
    var key = tileKey(tile);
    var size = data ? data.byteLength || 0 : 0;
    writing.set(key, (writing.get(key) || 0) + 1);
    var cache = null;
    var gone = false;
    return openCache()
      .then(function (c) {
        cache = c;
        return c.put(cacheUrl(key), new window.Response(data || new ArrayBuffer(0)));
      })
      .then(function () {
        // Deleted while the tile was being written: it must not outlive the area.
        var list = readIndex();
        var entry = findArea(list, id);
        if (!entry) {
          gone = true;
          throw fail('unknownArea', 'That area is not in the index.');
        }
        var set = owned(entry);
        if (!set.has(key)) {
          set.add(key);
          entry.tiles.push(key);
          entry.bytes = (entry.bytes || 0) + size;
          writeIndex(list);
        }
      })
      .finally(function () {
        var n = (writing.get(key) || 1) - 1;
        if (n) writing.set(key, n); else writing.delete(key);
        if (gone && cache && !n && !ownedByAny(key)) return cache.delete(cacheUrl(key));
        return null;
      });
  }

  /** Deletes tiles no area owns: a deleted area's, and any a closed tab left written but unlisted. */
  function sweep() {
    return openCache().then(function (cache) {
      return cache.keys().then(function (requests) {
        var keep = new Set();
        readIndex().forEach(function (e) { owned(e).forEach(function (k) { keep.add(k); }); });
        return Promise.all(requests.map(function (r) {
          var key = keyOfCacheUrl(r.url);
          if (key === null || keep.has(key) || writing.has(key)) return null;
          return cache.delete(r.url);
        }));
      });
    }, function () { return null; });
  }

  /** Removes an area and every tile no other area still owns. */
  function deleteArea(id) {
    try {
      writeIndex(readIndex().filter(function (e) { return e.id !== id; }));
    } catch (e) {
      return Promise.reject(e);
    }
    return sweep().then(function () { changed(); });
  }

  // BEGIN download: the one request, made only when the person starts a download.
  var TILE_HOST = 'tiles.openfreemap.org';
  var TILEJSON_URL = 'https://tiles.openfreemap.org/planet';
  var MAX_IN_FLIGHT = 4;

  function onTileHost(url) {
    try {
      var u = new window.URL(url);
      return u.protocol === 'https:' && u.host === TILE_HOST;
    } catch (e) {
      return false;
    }
  }

  /**
   * No cookies, no referrer, no redirect followed, nothing cached: the request
   * names a tile and nothing else. A browser sends its own User-Agent, which a
   * page cannot replace.
   */
  function downloadRequest(url, signal) {
    if (!onTileHost(url)) return Promise.reject(fail('refusedHost', 'Only ' + TILE_HOST + ' is asked.'));
    return window.fetch(url, {
      method: 'GET', credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'error',
      cache: 'no-store', mode: 'cors', signal: signal,
    });
  }

  function fill(template, t) {
    return template.split('{z}').join(String(t.z)).split('{x}').join(String(t.x)).split('{y}').join(String(t.y));
  }

  /** The versioned tile URL template from OpenFreeMap's TileJSON; refused unless it is on the tile host. */
  function tileTemplate(signal) {
    return downloadRequest(TILEJSON_URL, signal).then(function (res) {
      if (!res.ok) throw fail('http', 'HTTP ' + res.status, { status: res.status });
      return res.json().catch(function () { return null; });
    }).then(function (json) {
      var first = json && Array.isArray(json.tiles) ? json.tiles[0] : null;
      if (typeof first !== 'string' || first.indexOf('{z}') < 0 || first.indexOf('{x}') < 0 || first.indexOf('{y}') < 0) {
        throw fail('badTemplate', 'The tile list could not be read.');
      }
      if (!onTileHost(fill(first, { z: 0, x: 0, y: 0 }))) throw fail('refusedHost', 'Only ' + TILE_HOST + ' is asked.');
      return first;
    });
  }

  function fetchTile(tile, template, id, signal) {
    return downloadRequest(fill(template, tile), signal).then(function (res) {
      if (res.status === 404 || res.status === 204) return putTile(id, tile, new ArrayBuffer(0)); // the sea: nothing there
      if (!res.ok) throw fail('http', 'HTTP ' + res.status, { status: res.status });
      return res.arrayBuffer().then(function (data) { return putTile(id, tile, data); });
    });
  }

  /**
   * Fills an area, four tiles at a time, skipping tiles it already holds, and
   * reports (done, total). A cancel (options.signal) asks for nothing more,
   * waits for every tile in flight, then -- with options.deleteOnCancel --
   * deletes the area, and only then rejects with code 'cancelled', so a list
   * read afterwards never shows it. Any other failure keeps what arrived and
   * rejects with err.areaId, for resume.
   */
  function run(id, p, onProgress, options) {
    var signal = options && options.signal;
    var cancelled = function () { return !!(signal && signal.aborted); };
    var report = typeof onProgress === 'function' ? onProgress : function () {};
    if (!findArea(readIndex(), id)) return Promise.reject(fail('unknownArea', 'That area is not in the index.'));

    var work = Promise.resolve().then(function () {
      if (cancelled()) throw fail('cancelled', 'Cancelled.');
      return tileTemplate(signal);
    }).then(function (template) {
      var entry = findArea(readIndex(), id);
      var have = entry ? owned(entry) : new Set();
      var pending = p.tiles.filter(function (t) { return !have.has(tileKey(t)); });
      var total = p.tiles.length;
      var done = total - pending.length;
      report(done, total);
      var next = 0;
      var failure = null;
      function lane() {
        if (failure || cancelled() || next >= pending.length) return Promise.resolve();
        var tile = pending[next++];
        return fetchTile(tile, template, id, signal).then(function () {
          done += 1;
          report(done, total);
        }, function (e) {
          if (!failure) failure = e;
        }).then(lane);
      }
      var lanes = [];
      for (var i = 0; i < Math.min(MAX_IN_FLIGHT, pending.length); i++) lanes.push(lane());
      return Promise.all(lanes).then(function () {
        if (cancelled()) throw fail('cancelled', 'Cancelled.');
        if (failure) throw failure;
        finishArea(id);
        return publicArea(findArea(readIndex(), id));
      });
    });

    return work.catch(function (e) {
      var err = cancelled() ? fail('cancelled', 'Cancelled.') : e;
      err.areaId = id;
      if (err.code === 'cancelled' && options && options.deleteOnCancel) {
        // The cancel is the answer whatever the clean-up does; a failed delete rides along.
        return deleteArea(id).then(function () { throw err; }, function (deleteError) {
          err.deleteError = deleteError;
          throw err;
        });
      }
      throw err;
    });
  }

  /** Begins an area and fills it. A cancel deletes it; any other failure leaves it to resume (err.areaId). */
  function download(p, name, onProgress, options) {
    var id;
    try {
      id = beginArea(p, name);
    } catch (e) {
      return Promise.reject(e);
    }
    return run(id, p, onProgress, { signal: options && options.signal, deleteOnCancel: true });
  }

  /** Fills an area begun before (Try again). A cancel keeps it unfinished, unless options.deleteOnCancel. */
  function resume(id, p, onProgress, options) {
    return run(id, p, onProgress, options || {});
  }
  // END download

  // MARK: - Local files only

  var REFUSED = 'liftmap://refused';
  var TILE_TEMPLATE = 'liftmap://tiles/{z}/{x}/{y}';
  var TILE_URL = /^liftmap:\/\/tiles\/(\d+)\/(\d+)\/(\d+)$/;

  /** The app's map folder on this origin, as an absolute address ending in '/'. */
  function baseUrl() {
    return new window.URL(cfg.base, window.location.href).href;
  }

  /** True only for liftmap:// and this app's own map folder on this origin. */
  function allowedMapUrl(url) {
    if (typeof url !== 'string' || !url) return false;
    if (url.indexOf('liftmap://') === 0) return true;
    var u;
    try {
      u = new window.URL(url, window.location.href);
    } catch (e) {
      return false;
    }
    if (u.origin !== window.location.origin) return false;
    return u.pathname.indexOf(new window.URL(baseUrl()).pathname) === 0;
  }

  /** A style template filled for the web: tiles from liftmap://, glyphs from the app's map folder. */
  function webStyle(template) {
    var s = JSON.parse(JSON.stringify(template));
    var source = s.sources && s.sources.openmaptiles;
    if (source) {
      delete source.url;
      source.tiles = [TILE_TEMPLATE];
      source.minzoom = 0;
      source.maxzoom = 14;
    }
    s.glyphs = baseUrl() + 'fonts/{fontstack}/{range}.pbf';
    return s;
  }

  function emptyFor(type) {
    if (type === 'json') return {};
    if (type === 'string') return '';
    return new ArrayBuffer(0);
  }

  /** MapLibre's liftmap:// loader: a tile from the cache, or an empty one. Never the network. */
  function serveLocal(params) {
    var m = TILE_URL.exec(params.url);
    if (!m) return Promise.resolve({ data: emptyFor(params.type) });
    return openCache()
      .then(function (cache) { return cache.match(cacheUrl(m[1] + '/' + m[2] + '/' + m[3])); })
      .then(function (res) { return res ? res.arrayBuffer() : null; })
      .then(function (data) { return { data: data || new ArrayBuffer(0) }; },
        function () { return { data: new ArrayBuffer(0) }; });
  }

  // MARK: - MapLibre, from the app's own map folder

  var prepared = new WeakSet();

  /** Registers liftmap:// once per MapLibre, and its stylesheet once per page. */
  function prepare(gl) {
    if (!prepared.has(gl)) {
      gl.addProtocol('liftmap', serveLocal);
      addStylesheet();
      prepared.add(gl);
    }
    return gl;
  }

  function addStylesheet() {
    var doc = window.document;
    if (!doc || !doc.head || doc.querySelector('link[data-liftmap]')) return;
    var link = doc.createElement('link');
    link.rel = 'stylesheet';
    link.href = baseUrl() + 'maplibre-gl.css';
    link.setAttribute('data-liftmap', '');
    doc.head.appendChild(link);
  }

  /** The page's MapLibre (window.maplibregl, from maplibre-gl.js), or null when it has none. */
  function engine() {
    var gl = window.maplibregl;
    if (!gl || typeof gl.Map !== 'function' || typeof gl.addProtocol !== 'function') return null;
    try {
      return prepare(gl);
    } catch (e) {
      return null;
    }
  }

  // MARK: - Drawing a route (RouteMap)

  var THEME = {
    light: { accent: '#B23C25', accentSecondary: '#56664F', textSecondary: '#665E52', background: '#F4EFE7' },
    dark: { accent: '#C1442C', accentSecondary: '#7C8B7A', textSecondary: '#A39C8E', background: '#1C1B19' },
  };
  var EDGE_PADDING = 24;
  /** The attribution's strip along the bottom: the route is fitted above it, never under it. */
  var ATTRIBUTION_CLEARANCE = 26;
  var LINE_WIDTH = 5;
  var START_RADIUS = 5; // a 10 px dot
  var END_RADIUS = 6; // a 12 px dot
  var MINIMUM_SPAN = 0.002;

  function themeColor(container, name, fallback) {
    try {
      var v = window.getComputedStyle(container).getPropertyValue(name).trim();
      return v || fallback;
    } catch (e) {
      return fallback;
    }
  }

  function clear(el) {
    if (typeof el.replaceChildren === 'function') el.replaceChildren();
    else while (el.firstChild) el.removeChild(el.firstChild);
  }

  function lineFeature(points) {
    return {
      type: 'Feature', properties: {},
      geometry: { type: 'LineString', coordinates: points.map(function (p) { var l = latLon(p); return [l[1], l[0]]; }) },
    };
  }

  function pointFeature(p) {
    var l = latLon(p);
    return { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [l[1], l[0]] } };
  }

  /**
   * Draws a route over the streets the person downloaded, or calls
   * options.fallback(container, points) -- the app's own plain line, exactly
   * as before maps -- when no finished area covers it. Partial cover is cover;
   * a missing tile is empty background. Decided again when an area finishes or
   * is deleted ('liftmap:changed', here or in another tab), and on update()
   * only when the route's bounds change, so a GPS fix inside them reads
   * nothing.
   *
   * options: aspect (width / height; none fills the container's height),
   * interactive (pan and pinch only; never rotate or tilt), dark, fallback.
   * Returns { update(points, {dark}?), destroy() }.
   *
   * The route stays the strongest thing on screen: a 5 px accent line with
   * round caps, the start dot in the secondary accent (10 px) and the end dot
   * in the accent (12 px). The view fits the whole route with 24 px to spare
   * (and the attribution's strip clear below it) and fits again as it grows. No location dot, no controls, no logo; the
   * attribution sits bottom-trailing in the secondary text color.
   */
  /** The handle drawing into each container, so a second mount replaces the first cleanly. */
  var mounted = new WeakMap();

  function mount(container, points, options) {
    var previous = mounted.get(container);
    if (previous) previous.destroy();
    var o = options || {};
    var pts = points || [];
    var dark = !!o.dark;
    var interactive = !!o.interactive;
    var map = null;
    var mapKey = null;
    var loaded = false;
    var memoKey;
    var memo = 'line';
    var failedKey = null;
    var cannotDraw = false;
    var destroyed = false;

    /** Decided again only when the route's bounds, the areas or the appearance change. */
    function decision() {
      var b = pts.length >= 2 ? around(pts) : null;
      var key = JSON.stringify([b, revision, dark]);
      if (key !== memoKey) {
        memoKey = key;
        memo = decide(pts, covers);
      }
      return memo;
    }

    function teardown() {
      if (map) {
        try { map.remove(); } catch (e) { /* already gone */ }
      }
      map = null;
      mapKey = null;
      loaded = false;
    }

    function drawLine() {
      teardown();
      clear(container);
      if (typeof o.fallback === 'function') o.fallback(container, pts);
    }

    function colors() {
      var t = dark ? THEME.dark : THEME.light;
      return {
        accent: themeColor(container, '--accent', t.accent),
        accentSecondary: themeColor(container, '--accent-2', t.accentSecondary),
        textSecondary: themeColor(container, '--muted', t.textSecondary),
        background: t.background,
      };
    }

    /** Puts the route on top of every street layer, or updates it in place. */
    function showRoute() {
      if (!map || !loaded || pts.length < 2) return;
      var line = lineFeature(pts);
      var start = pointFeature(pts[0]);
      var end = pointFeature(pts[pts.length - 1]);
      var source = map.getSource('lift-route');
      if (source) {
        source.setData(line);
        map.getSource('lift-route-start').setData(start);
        map.getSource('lift-route-end').setData(end);
        return;
      }
      var c = colors();
      map.addSource('lift-route', { type: 'geojson', data: line });
      map.addLayer({
        id: 'lift-route-line', type: 'line', source: 'lift-route',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': c.accent, 'line-width': LINE_WIDTH },
      });
      map.addSource('lift-route-start', { type: 'geojson', data: start });
      map.addLayer({
        id: 'lift-route-start-dot', type: 'circle', source: 'lift-route-start',
        paint: { 'circle-color': c.accentSecondary, 'circle-radius': START_RADIUS },
      });
      map.addSource('lift-route-end', { type: 'geojson', data: end });
      map.addLayer({
        id: 'lift-route-end-dot', type: 'circle', source: 'lift-route-end',
        paint: { 'circle-color': c.accent, 'circle-radius': END_RADIUS },
      });
    }

    /**
     * Fits the whole route with 24 px to spare, and the attribution's strip
     * clear at the bottom, once there is room; at least a block or two.
     */
    function fit() {
      if (!map || !loaded || pts.length < 2) return;
      var el = map.getContainer();
      var bottom = EDGE_PADDING + ATTRIBUTION_CLEARANCE;
      if (!el || el.clientWidth <= EDGE_PADDING * 2 + 1 || el.clientHeight <= EDGE_PADDING + bottom + 1) return;
      var b = around(pts);
      var mid;
      if (b.north - b.south < MINIMUM_SPAN) {
        mid = (b.north + b.south) / 2;
        b.south = mid - MINIMUM_SPAN / 2;
        b.north = mid + MINIMUM_SPAN / 2;
      }
      if (b.east - b.west < MINIMUM_SPAN) {
        mid = (b.east + b.west) / 2;
        b.west = mid - MINIMUM_SPAN / 2;
        b.east = mid + MINIMUM_SPAN / 2;
      }
      map.fitBounds([[b.west, b.south], [b.east, b.north]], {
        padding: { top: EDGE_PADDING, right: EDGE_PADDING, bottom: bottom, left: EDGE_PADDING },
        animate: false,
      });
    }

    /** The map's frame, the same shape the line takes, with the attribution on it. */
    function frame(c) {
      var doc = window.document;
      var outer = doc.createElement('div');
      outer.className = 'liftmap';
      outer.setAttribute('role', 'img');
      outer.setAttribute('aria-label', copy.routeLabel);
      var s = outer.style;
      s.position = 'relative';
      s.width = '100%';
      s.overflow = 'hidden';
      s.borderRadius = 'inherit';
      s.background = c.background;
      if (o.aspect) s.aspectRatio = String(o.aspect); else s.height = '100%';
      var host = doc.createElement('div');
      host.style.position = 'absolute';
      host.style.inset = '0';
      outer.appendChild(host);
      var credit = doc.createElement('div');
      credit.className = 'liftmap-attribution';
      credit.textContent = copy.attribution;
      var cs = credit.style;
      cs.position = 'absolute';
      cs.right = '6px';
      cs.bottom = '6px';
      cs.padding = '2px 6px';
      cs.borderRadius = '4px';
      cs.fontSize = '12px';
      cs.lineHeight = '1.3';
      cs.whiteSpace = 'nowrap';
      cs.color = c.textSecondary;
      cs.background = c.background + 'CC';
      cs.pointerEvents = 'none';
      outer.appendChild(credit);
      return { outer: outer, host: host };
    }

    function showMap(gl, key) {
      teardown();
      clear(container);
      var f = frame(colors());
      container.appendChild(f.outer);
      var made;
      try {
        // Made with no style, then given ours: MapLibre 5 reads transformStyle
        // only from setStyle, and the template's placeholders fail validation
        // unless it is applied first.
        made = new gl.Map({
          container: f.host,
          transformRequest: function (url) { return allowedMapUrl(url) ? { url: url } : { url: REFUSED }; },
          interactive: interactive,
          attributionControl: false,
          maplibreLogo: false,
          dragRotate: false,
          pitchWithRotate: false,
          touchPitch: false,
          keyboard: false,
          boxZoom: false,
          renderWorldCopies: false,
          refreshExpiredTiles: false,
        });
      } catch (e) {
        // No WebGL, or no MapLibre: the line, for the life of this view.
        cannotDraw = true;
        drawLine();
        return;
      }
      map = made;
      mapKey = key;
      if (interactive && made.touchZoomRotate && typeof made.touchZoomRotate.disableRotation === 'function') {
        made.touchZoomRotate.disableRotation();
      }
      made.on('load', function () {
        if (map !== made) return;
        loaded = true;
        showRoute();
        fit();
      });
      made.on('error', function () {
        // A style or font that never arrived: the line, never a blank square.
        if (map !== made || loaded) return;
        failedKey = key;
        drawLine();
      });
      made.on('resize', function () { if (map === made) fit(); });
      try {
        made.setStyle(baseUrl() + (dark ? 'style-dark.json' : 'style-light.json'), {
          transformStyle: function (previous, next) { return webStyle(next); },
        });
      } catch (e) {
        failedKey = key;
        drawLine();
      }
    }

    function render() {
      if (destroyed) return;
      var key = revision + '|' + dark;
      if (cannotDraw || failedKey === key || decision() === 'line') {
        drawLine();
        return;
      }
      if (map && mapKey === key) {
        showRoute();
        fit();
        return;
      }
      var gl = engine();
      if (gl) {
        showMap(gl, key);
        return;
      }
      // No MapLibre on this page: the line. A later update tries again.
      drawLine();
    }

    function onChanged() { render(); }
    if (typeof window.addEventListener === 'function') window.addEventListener(CHANGED, onChanged);

    var handle = {
      update: function (next, opts) {
        pts = next || [];
        if (opts && 'dark' in opts) dark = !!opts.dark;
        render();
      },
      destroy: function () {
        if (destroyed) return;
        destroyed = true;
        if (typeof window.removeEventListener === 'function') window.removeEventListener(CHANGED, onChanged);
        if (mounted.get(container) === handle) mounted.delete(container);
        teardown();
        clear(container);
      },
    };
    mounted.set(container, handle);
    render();
    return handle;
  }

  // MARK: - Setup

  /** { cachePrefix: 'lift-map-' | 'coach-map-', storageKey: 'lift.mapAreas' | 'coach.mapAreas', base: '/lift/map/' | '/coach/map/' } */
  function configure(options) {
    var o = options || {};
    if (typeof o.cachePrefix === 'string') cfg.cachePrefix = o.cachePrefix;
    if (typeof o.storageKey === 'string') cfg.storageKey = o.storageKey;
    if (typeof o.base === 'string') cfg.base = o.base.charAt(o.base.length - 1) === '/' ? o.base : o.base + '/';
    lastIndex = null;
    lastRaw = undefined;
    lastSignature = finishedSignature();
    return api;
  }

  // Another tab finished or deleted an area: decide again here too. A download
  // in another tab rewrites the index for every tile; those writes leave the
  // finished areas as they were and must not rebuild a single map.
  if (typeof window.addEventListener === 'function') {
    window.addEventListener('storage', function (e) {
      if (!e || (e.key !== cfg.storageKey && e.key !== null)) return;
      if (finishedSignature() !== lastSignature) changed();
    });
  }

  var api = {
    configure: configure,
    copy: copy,
    deleteTitle: deleteTitle,
    radiusText: radiusText,
    nameAround: nameAround,
    bytesText: bytesText,
    sizeText: sizeText,
    detailLine: detailLine,
    wideKm: WIDE_KM,
    detailChoices: DETAIL_CHOICES,
    startingKm: DETAIL_CHOICES[0],
    x: x,
    y: y,
    bounds: bounds,
    count: count,
    tiles: tiles,
    typicalBytes: typicalBytes,
    around: around,
    intersects: intersects,
    plan: plan,
    planForRoute: planForRoute,
    estimateBytes: estimateBytes,
    replan: replan,
    decide: decide,
    areas: areas,
    unfinishedAreas: unfinishedAreas,
    covers: covers,
    hasTile: hasTile,
    beginArea: beginArea,
    putTile: putTile,
    finishArea: finishArea,
    deleteArea: deleteArea,
    download: download,
    resume: resume,
    allowedMapUrl: allowedMapUrl,
    webStyle: webStyle,
    mount: mount,
  };

  lastSignature = finishedSignature();
  window.LiftMap = api;
})(window);
