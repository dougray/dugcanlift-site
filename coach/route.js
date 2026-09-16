/* A client's runs, walks and hikes, as SHARE-FORMAT.md "Outdoor" sends them:
 * reading the tuples, decoding the route, and drawing it.
 *
 * Kept as its own script so node tests it (route.test.mjs). The sending side
 * is LIFT web's outdoor.js; the shared fixtures in fixtures/ were written by
 * it, and this file must read them back exactly.
 */
(function (global) {
  'use strict';

  var TYPES = ['Run', 'Walk', 'Hike'];
  var METERS_PER_MILE = 1609.344;
  /** ~11 m. Keeps a nearly stationary route from a wild zoom. */
  var MIN_SPAN_DEGREES = 0.0001;

  var whole = function (v) { return typeof v === 'number' && isFinite(v) ? v : null; };
  var typeLabel = function (t) { return TYPES[t] || null; };

  /** A day's `o`. Tuples of an unknown type are skipped, not guessed at. */
  function readDay(o) {
    return (Array.isArray(o) ? o : []).map(function (t) {
      if (!Array.isArray(t) || !typeLabel(t[0])) return null;
      return { type: t[0], durationSec: whole(t[1]), distanceM: whole(t[2]) || 0, climbM: whole(t[3]) || 0 };
    }).filter(Boolean);
  }

  /** `ob`. Null fields stay null: no best is not a best of zero. */
  function readBests(ob) {
    var rows = (Array.isArray(ob) ? ob : []).map(function (t) {
      if (!Array.isArray(t) || !typeLabel(t[0])) return null;
      var positive = function (v) { v = whole(v); return v != null && v > 0 ? v : null; };
      return { type: t[0], count: whole(t[1]) || 0, farthestM: positive(t[2]),
        longestSec: positive(t[3]), fastestSecPerKm: positive(t[4]) };
    }).filter(Boolean);
    return rows.length ? rows : null;
  }

  /** `lr`, or null when absent, malformed, or with fewer than two points. */
  function readLastRoute(lr) {
    if (!Array.isArray(lr) || !typeLabel(lr[0]) || typeof lr[5] !== 'string') return null;
    var points = decodePolyline(lr[5]);
    if (points.length < 2) return null;
    return { type: lr[0], startedAt: (whole(lr[1]) || 0) * 1000, durationSec: whole(lr[2]),
      distanceM: whole(lr[3]) || 0, climbM: whole(lr[4]) || 0, points: points };
  }

  /** Google's encoded polyline, precision 5. Stops at the first broken pair. */
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

  /** LIFT's projection: longitude scaled by cos(latitude), one scale for both
   *  axes so a route is never stretched, centred, north up, 10% padding. */
  function project(points, width, height) {
    if (!points || !points.length) return [];
    var avgLat = points.reduce(function (t, p) { return t + p[0]; }, 0) / points.length;
    var lonScale = Math.cos(avgLat * Math.PI / 180);
    var xs = points.map(function (p) { return p[1] * lonScale; });
    var ys = points.map(function (p) { return p[0]; });
    var minX = Math.min.apply(null, xs), maxX = Math.max.apply(null, xs);
    var minY = Math.min.apply(null, ys), maxY = Math.max.apply(null, ys);
    var padding = Math.min(width, height) * 0.1;
    var w = width - padding * 2, h = height - padding * 2;
    var scale = Math.max(Math.max(maxX - minX, MIN_SPAN_DEGREES) / w, Math.max(maxY - minY, MIN_SPAN_DEGREES) / h);
    var offsetX = (w - (maxX - minX) / scale) / 2;
    var offsetY = (h - (maxY - minY) / scale) / 2;
    return points.map(function (p, i) {
      return { x: padding + offsetX + (xs[i] - minX) / scale, y: padding + offsetY + (maxY - p[0]) / scale };
    });
  }

  // MARK: - Formatting, the same strings LIFT shows

  /** Miles for a client who reads pounds, kilometres for one who reads kilograms. */
  var distanceUnit = function (weightUnit) { return weightUnit === 'kg' ? 'km' : 'mi'; };
  var unitMeters = function (unit) { return unit === 'km' ? 1000 : METERS_PER_MILE; };

  function durationText(seconds) {
    var total = Math.round(seconds);
    var h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), s = total % 60;
    var pad = function (n) { return String(n).padStart(2, '0'); };
    return h > 0 ? h + ':' + pad(m) + ':' + pad(s) : m + ':' + pad(s);
  }

  function distanceText(meters, unit) {
    return (meters / unitMeters(unit)).toFixed(2) + ' ' + unit;
  }

  function paceText(secondsPerKm, unit) {
    var per = Math.round(secondsPerKm / 1000 * unitMeters(unit));
    return Math.floor(per / 60) + ':' + String(per % 60).padStart(2, '0') + ' /' + unit;
  }

  /** An activity's own pace, only past 1 km, as LIFT decides a best. */
  function activityPace(distanceM, durationSec, unit) {
    if (!(distanceM >= 1000) || !(durationSec > 0)) return null;
    return paceText(durationSec / distanceM * 1000, unit);
  }

  global.CoachRoute = {
    TYPES: TYPES,
    typeLabel: typeLabel,
    readDay: readDay,
    readBests: readBests,
    readLastRoute: readLastRoute,
    decodePolyline: decodePolyline,
    project: project,
    distanceUnit: distanceUnit,
    durationText: durationText,
    distanceText: distanceText,
    paceText: paceText,
    activityPace: activityPace,
  };
})(typeof window !== 'undefined' ? window : globalThis);
