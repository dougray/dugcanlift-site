/* Outdoor tracking for the browser build: which GPS fixes to keep, the maths
 * on a route, the last route and personal bests, and drawing a route.
 *
 * The rules match LIFT for Android and iOS (LocationTracker, OutdoorActivityMath,
 * OutdoorRecords) so the same run gives the same numbers everywhere. Kept as its
 * own script so node tests them.
 *
 * Storage is compact because this is localStorage, which holds about 5 MB for
 * the whole app. A fix is `[lat, lon, altitude|null, secondsSinceStart,
 * accuracy]`, about 45 bytes, rather than Android's named-field object at
 * about 170 -- an hour's run is ~50 KB instead of ~200 KB. A backup file uses
 * Android's shape (`toBackup`/`fromBackup`), so the file stays readable.
 */
(function (global) {
  'use strict';

  var TYPES = [
    { key: 'RUN', label: 'Run' },
    { key: 'WALK', label: 'Walk' },
    { key: 'HIKE', label: 'Hike' },
  ];

  /** Android's LocationTracker filters, for the same reasons: a fix worse than
   *  50 m wanders across streets, and 5 m / 3 s keeps a route drawable without
   *  storing every jitter of a standing start. */
  var MAX_ACCURACY_METERS = 50;
  var MIN_DISTANCE_METERS = 5;
  var MIN_INTERVAL_SECONDS = 3;
  /** Shorter than this and a pace is mostly GPS noise. */
  var MINIMUM_PACE_DISTANCE_METERS = 1000;
  var METERS_PER_MILE = 1609.344;
  var EARTH_RADIUS_METERS = 6371000;
  /** ~11 m. Keeps a nearly stationary route from a wild zoom. */
  var MIN_SPAN_DEGREES = 0.0001;

  var LAT = 0, LON = 1, ALT = 2, T = 3, ACC = 4;

  var round = function (v, places) { var f = Math.pow(10, places); return Math.round(v * f) / f; };

  function haversineMeters(lat1, lon1, lat2, lon2) {
    var p1 = lat1 * Math.PI / 180, p2 = lat2 * Math.PI / 180;
    var dp = (lat2 - lat1) * Math.PI / 180, dl = (lon2 - lon1) * Math.PI / 180;
    var a = Math.sin(dp / 2) * Math.sin(dp / 2)
      + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) * Math.sin(dl / 2);
    return EARTH_RADIUS_METERS * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  /**
   * The point to keep from a browser position, or null to skip it.
   * `coords` is a GeolocationCoordinates; `atMs` the fix's time.
   */
  function acceptFix(last, coords, atMs, startedAtMs) {
    if (!coords || !Number.isFinite(coords.latitude) || !Number.isFinite(coords.longitude)) return null;
    if (!(coords.accuracy >= 0) || coords.accuracy > MAX_ACCURACY_METERS) return null;
    var t = round((atMs - startedAtMs) / 1000, 1);
    if (t < 0) return null;
    if (last) {
      if (t - last[T] < MIN_INTERVAL_SECONDS) return null;
      if (haversineMeters(last[LAT], last[LON], coords.latitude, coords.longitude) < MIN_DISTANCE_METERS) return null;
    }
    var alt = typeof coords.altitude === 'number' && Number.isFinite(coords.altitude) ? round(coords.altitude, 1) : null;
    return [round(coords.latitude, 6), round(coords.longitude, 6), alt, t, Math.round(coords.accuracy)];
  }

  function totalDistanceMeters(points) {
    var total = 0;
    for (var i = 1; i < (points || []).length; i++) {
      total += haversineMeters(points[i - 1][LAT], points[i - 1][LON], points[i][LAT], points[i][LON]);
    }
    return total;
  }

  /** The hysteresis filter iOS and Android use, with the same 3 m default.
   *  Many browsers report no altitude at all; those points are skipped rather
   *  than read as sea level, which would invent a climb. */
  function elevationGainMeters(points, minimumDelta) {
    var min = minimumDelta == null ? 3 : minimumDelta;
    var withAltitude = (points || []).filter(function (p) { return typeof p[ALT] === 'number'; });
    if (withAltitude.length < 2) return 0;
    var gain = 0, reference = withAltitude[0][ALT];
    withAltitude.slice(1).forEach(function (p) {
      var delta = p[ALT] - reference;
      if (delta >= min) { gain += delta; reference = p[ALT]; }
      else if (delta <= -min) reference = p[ALT];
    });
    return gain;
  }

  var durationMs = function (a) {
    return a && a.endedAtEpochMs != null ? a.endedAtEpochMs - a.startedAtEpochMs : null;
  };

  function paceSecondsPerMeter(a) {
    var d = durationMs(a);
    if (d == null || !(a.distanceMeters > 0)) return null;
    return (d / 1000) / a.distanceMeters;
  }

  /** The newest finished activity with a line to draw. */
  function lastRoute(activities) {
    return (activities || [])
      .filter(function (a) { return a && a.endedAtEpochMs != null && (a.route || []).length > 1; })
      .sort(function (a, b) { return b.startedAtEpochMs - a.startedAtEpochMs; })[0] || null;
  }

  /** One entry per type with a finished activity, in Start button order.
   *  Blank stays blank: no distance recorded is no farthest, not a farthest of 0. */
  function bests(activities) {
    var finished = (activities || []).filter(function (a) { return a && a.endedAtEpochMs != null; });
    return TYPES.map(function (type) {
      var ofType = finished.filter(function (a) { return a.activityType === type.key; });
      if (!ofType.length) return null;
      var max = function (xs) { return xs.length ? Math.max.apply(null, xs) : null; };
      var distances = ofType.map(function (a) { return a.distanceMeters; }).filter(function (v) { return v > 0; });
      var durations = ofType.map(durationMs).filter(function (v) { return v > 0; });
      var paces = ofType
        .filter(function (a) { return a.distanceMeters >= MINIMUM_PACE_DISTANCE_METERS; })
        .map(paceSecondsPerMeter)
        .filter(function (v) { return v > 0; });
      return {
        type: type.key,
        label: type.label,
        count: ofType.length,
        longestDistanceMeters: max(distances),
        longestDurationMs: max(durations),
        fastestPaceSecondsPerMeter: paces.length ? Math.min.apply(null, paces) : null,
      };
    }).filter(Boolean);
  }

  // MARK: - Formatting, identical to iOS and Android

  function durationText(ms) {
    var total = Math.round(ms / 1000);
    var h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), s = total % 60;
    var pad = function (n) { return String(n).padStart(2, '0'); };
    return h > 0 ? h + ':' + pad(m) + ':' + pad(s) : m + ':' + pad(s);
  }

  var unitMeters = function (unit) { return unit === 'kilometers' ? 1000 : METERS_PER_MILE; };
  var unitLabel = function (unit) { return unit === 'kilometers' ? 'km' : 'mi'; };

  function paceText(secondsPerMeter, unit) {
    var per = Math.round(secondsPerMeter * unitMeters(unit));
    return Math.floor(per / 60) + ':' + String(per % 60).padStart(2, '0') + ' /' + unitLabel(unit);
  }

  function distanceText(meters, unit) {
    return (meters / unitMeters(unit)).toFixed(2) + ' ' + unitLabel(unit);
  }

  // MARK: - Drawing

  /**
   * Android's projection: equirectangular, longitude scaled by cos(latitude),
   * one scale for both axes so a route is never stretched, centred in the box,
   * north up, 10% padding.
   */
  function project(points, width, height) {
    if (!points || !points.length) return [];
    var avgLat = points.reduce(function (t, p) { return t + p[LAT]; }, 0) / points.length;
    var lonScale = Math.cos(avgLat * Math.PI / 180);
    var xs = points.map(function (p) { return p[LON] * lonScale; });
    var ys = points.map(function (p) { return p[LAT]; });
    var minX = Math.min.apply(null, xs), maxX = Math.max.apply(null, xs);
    var minY = Math.min.apply(null, ys), maxY = Math.max.apply(null, ys);
    var padding = Math.min(width, height) * 0.1;
    var w = width - padding * 2, h = height - padding * 2;
    var scale = Math.max(Math.max(maxX - minX, MIN_SPAN_DEGREES) / w, Math.max(maxY - minY, MIN_SPAN_DEGREES) / h);
    var offsetX = (w - (maxX - minX) / scale) / 2;
    var offsetY = (h - (maxY - minY) / scale) / 2;
    return points.map(function (p, i) {
      return { x: padding + offsetX + (xs[i] - minX) / scale, y: padding + offsetY + (maxY - p[LAT]) / scale };
    });
  }

  // MARK: - Backup, in Android's field names

  function toBackup(a) {
    return {
      id: a.id,
      activityType: a.activityType,
      startedAtEpochMs: a.startedAtEpochMs,
      endedAtEpochMs: a.endedAtEpochMs,
      distanceMeters: a.distanceMeters,
      elevationGainMeters: a.elevationGainMeters,
      routePoints: (a.route || []).map(function (p) {
        return {
          latitude: p[LAT], longitude: p[LON], altitudeMeters: p[ALT],
          recordedAtEpochMs: Math.round(a.startedAtEpochMs + p[T] * 1000),
          horizontalAccuracyMeters: p[ACC],
        };
      }),
    };
  }

  /** Null for anything that is not a finished activity of a known type. */
  function fromBackup(o) {
    if (!o || o.id == null || o.id === '' || !Number.isFinite(o.startedAtEpochMs) || !Number.isFinite(o.endedAtEpochMs)) return null;
    if (!TYPES.some(function (t) { return t.key === o.activityType; })) return null;
    var route = (Array.isArray(o.routePoints) ? o.routePoints : [])
      .filter(function (p) { return p && Number.isFinite(p.latitude) && Number.isFinite(p.longitude); })
      .map(function (p) {
        return [p.latitude, p.longitude, typeof p.altitudeMeters === 'number' ? p.altitudeMeters : null,
          Number.isFinite(p.recordedAtEpochMs) ? round((p.recordedAtEpochMs - o.startedAtEpochMs) / 1000, 1) : 0,
          Number.isFinite(p.horizontalAccuracyMeters) ? p.horizontalAccuracyMeters : 0];
      });
    return {
      id: String(o.id),
      activityType: o.activityType,
      startedAtEpochMs: o.startedAtEpochMs,
      endedAtEpochMs: o.endedAtEpochMs,
      distanceMeters: Number.isFinite(o.distanceMeters) ? o.distanceMeters : totalDistanceMeters(route),
      elevationGainMeters: Number.isFinite(o.elevationGainMeters) ? o.elevationGainMeters : elevationGainMeters(route),
      route: route,
    };
  }

  // MARK: - Sending to a coach (SHARE-FORMAT.md, "Outdoor")

  var TRIM_METERS = 200;
  var MAX_SHARED_POINTS = 150;
  var typeIndex = function (key) { return TYPES.findIndex(function (t) { return t.key === key; }); };

  /** The day's `o` tuples, in start order. */
  function shareDay(activities) {
    return (activities || [])
      .filter(function (a) { return a && a.endedAtEpochMs != null && typeIndex(a.activityType) >= 0; })
      .sort(function (a, b) { return a.startedAtEpochMs - b.startedAtEpochMs; })
      .map(function (a) {
        return [typeIndex(a.activityType), Math.round(durationMs(a) / 1000),
          Math.round(a.distanceMeters || 0), Math.round(a.elevationGainMeters || 0)];
      });
  }

  /** `ob`, or null when there is nothing finished. */
  function shareBests(activities) {
    var out = bests(activities).map(function (b) {
      return [typeIndex(b.type), b.count,
        b.longestDistanceMeters == null ? null : Math.round(b.longestDistanceMeters),
        b.longestDurationMs == null ? null : Math.round(b.longestDurationMs / 1000),
        b.fastestPaceSecondsPerMeter == null ? null : Math.round(b.fastestPaceSecondsPerMeter * 1000)];
    });
    return out.length ? out : null;
  }

  /** The route with its first and last 200 m removed, then thinned to 150. */
  function trimAndThin(route) {
    var n = (route || []).length;
    if (n < 2) return [];
    var along = [0];
    for (var i = 1; i < n; i++) {
      along.push(along[i - 1] + haversineMeters(route[i - 1][LAT], route[i - 1][LON], route[i][LAT], route[i][LON]));
    }
    var total = along[n - 1];
    var kept = route.filter(function (p, i) { return along[i] >= TRIM_METERS && total - along[i] >= TRIM_METERS; });
    if (kept.length <= MAX_SHARED_POINTS) return kept;
    var thinned = [];
    for (var j = 0; j < MAX_SHARED_POINTS; j++) {
      thinned.push(kept[Math.floor(j * (kept.length - 1) / (MAX_SHARED_POINTS - 1) + 0.5)]);
    }
    return thinned;
  }

  /** Google's encoded polyline, precision 5, rounding as the format specifies. */
  function encodePolyline(points) {
    var out = '', prevLat = 0, prevLon = 0;
    var chunk = function (value) {
      var v = value < 0 ? ~(value << 1) : value << 1;
      while (v >= 0x20) { out += String.fromCharCode((0x20 | (v & 0x1f)) + 63); v >>= 5; }
      out += String.fromCharCode(v + 63);
    };
    points.forEach(function (p) {
      var lat = Math.floor(p[LAT] * 100000 + 0.5), lon = Math.floor(p[LON] * 100000 + 0.5);
      chunk(lat - prevLat); chunk(lon - prevLon);
      prevLat = lat; prevLon = lon;
    });
    return out;
  }

  /** Back to compact points `[lat, lon]`, for drawing. */
  function decodePolyline(text) {
    var points = [], index = 0, lat = 0, lon = 0;
    var next = function () {
      var result = 0, shift = 0, b;
      do {
        if (index >= text.length) return null;
        b = text.charCodeAt(index++) - 63;
        result |= (b & 0x1f) << shift;
        shift += 5;
      } while (b >= 0x20);
      return (result & 1) ? ~(result >> 1) : (result >> 1);
    };
    while (index < (text || '').length) {
      var dLat = next(), dLon = next();
      if (dLat === null || dLon === null) break;
      lat += dLat; lon += dLon;
      points.push([lat / 100000, lon / 100000]);
    }
    return points;
  }

  /** `lr`, or null: no finished route, or nothing left once trimmed. */
  function shareLastRoute(activities) {
    var last = lastRoute(activities);
    if (!last) return null;
    var kept = trimAndThin(last.route);
    if (kept.length < 2) return null;
    return [typeIndex(last.activityType), Math.floor(last.startedAtEpochMs / 1000),
      Math.round(durationMs(last) / 1000), Math.round(last.distanceMeters || 0),
      Math.round(last.elevationGainMeters || 0), encodePolyline(kept)];
  }

  global.LiftOutdoor = {
    TYPES: TYPES,
    MAX_ACCURACY_METERS: MAX_ACCURACY_METERS,
    MINIMUM_PACE_DISTANCE_METERS: MINIMUM_PACE_DISTANCE_METERS,
    acceptFix: acceptFix,
    haversineMeters: haversineMeters,
    totalDistanceMeters: totalDistanceMeters,
    elevationGainMeters: elevationGainMeters,
    durationMs: durationMs,
    paceSecondsPerMeter: paceSecondsPerMeter,
    lastRoute: lastRoute,
    bests: bests,
    durationText: durationText,
    paceText: paceText,
    distanceText: distanceText,
    project: project,
    toBackup: toBackup,
    fromBackup: fromBackup,
    shareDay: shareDay,
    shareBests: shareBests,
    shareLastRoute: shareLastRoute,
    trimAndThin: trimAndThin,
    encodePolyline: encodePolyline,
    decodePolyline: decodePolyline,
  };
})(typeof window !== 'undefined' ? window : globalThis);
