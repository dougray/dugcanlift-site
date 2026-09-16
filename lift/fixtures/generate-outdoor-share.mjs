// Writes the outdoor share fixtures from LIFT web's own encoder. Run from the
// repo root: node lift/fixtures/generate-outdoor-share.mjs. The native apps test
// against its output, so only rerun it on a deliberate change to the format.
import { readFileSync, writeFileSync } from 'node:fs';
import { deflateRawSync } from 'node:zlib';
const s = { window: {} };
new Function('window', readFileSync('lift/outdoor.js', 'utf8'))(s.window);
const O = s.window.LiftOutdoor;

const T0 = 1789000000000; // 2026-09-10T00:26:40Z
const pt = (lat, lon, alt, ms, acc) => ({ latitude: lat, longitude: lon, altitudeMeters: alt, recordedAtEpochMs: ms, horizontalAccuracyMeters: acc });

// A 2.8 km loop, 400 fixes, starting and ending at the same door.
const loopStart = T0 + 3 * 86400000;
const loop = Array.from({ length: 400 }, (_, i) => {
  const a = (i / 399) * 2 * Math.PI;
  return pt(+(30.2672 + 0.004 * Math.sin(a)).toFixed(6), +(-97.7431 + 0.004 * (1 - Math.cos(a)) / Math.cos(30.2672 * Math.PI / 180)).toFixed(6),
    +(150 + 12 * Math.sin(a * 2)).toFixed(1), loopStart + i * 4000, 6);
});
// A straight 10 km out, 60 fixes, no altitude from the device.
const longStart = T0;
const long = Array.from({ length: 60 }, (_, i) => pt(+(30.3 + i * 0.0015245).toFixed(6), -97.8, null, longStart + i * 60000, 9));
// A 300 m walk: too short for a pace, and nothing survives the trim.
const walkStart = T0 + 2 * 86400000;
const walk = Array.from({ length: 12 }, (_, i) => pt(+(30.25 + i * 0.000245).toFixed(6), -97.75, 140, walkStart + i * 20000, 5));

const input = [
  { id: 'run-long', activityType: 'RUN', startedAtEpochMs: longStart, endedAtEpochMs: longStart + 3000000, distanceMeters: 0, elevationGainMeters: 0, routePoints: long },
  { id: 'walk-short', activityType: 'WALK', startedAtEpochMs: walkStart, endedAtEpochMs: walkStart + 240000, distanceMeters: 0, elevationGainMeters: 0, routePoints: walk },
  { id: 'run-loop', activityType: 'RUN', startedAtEpochMs: loopStart, endedAtEpochMs: loopStart + 1720000, distanceMeters: 0, elevationGainMeters: 0, routePoints: loop },
  { id: 'hike-unfinished', activityType: 'HIKE', startedAtEpochMs: loopStart + 86400000, endedAtEpochMs: null, distanceMeters: 900, elevationGainMeters: 0, routePoints: [] },
];
// Distances and climb as the recorder would have stored them.
input.forEach((a) => {
  const compact = a.routePoints.map((p) => [p.latitude, p.longitude, p.altitudeMeters, 0, 0]);
  if (a.routePoints.length) {
    a.distanceMeters = Math.round(O.totalDistanceMeters(compact) * 10) / 10;
    a.elevationGainMeters = Math.round(O.elevationGainMeters(compact) * 10) / 10;
  }
});

// What a sender reads: the finished ones through fromBackup; the unfinished one as a recorder holds it.
const activities = input.map((a) => O.fromBackup(a) || { ...a, route: [] });
const expected = {
  note: 'Exactly what SHARE-FORMAT.md "Outdoor" requires for outdoor-share-input.json. o is every activity in start order, as if all were one day. Produced by LIFT web; never regenerate from a native encoder.',
  o: O.shareDay(activities),
  ob: O.shareBests(activities),
  lr: O.shareLastRoute(activities),
  trimmedPointCount: O.trimAndThin(activities.find((a) => a.id === 'run-loop').route).length,
};
writeFileSync('lift/fixtures/outdoor-share-input.json', JSON.stringify({ note: 'Activities in BACKUP-FORMAT outdoor[] shape (hike-unfinished has no end, which a backup never writes, to prove senders skip it). See outdoor-share-expected.json.', outdoor: input }, null, 1) + '\n');
writeFileSync('lift/fixtures/outdoor-share-expected.json', JSON.stringify(expected, null, 1) + '\n');

// A whole link, for coach decoders.
const dayKey = (ms) => new Date(ms).toISOString().slice(0, 10); // UTC days, fixed for the fixture
const r = '2026-09-10';
const offset = (k) => Math.round((Date.parse(k) - Date.parse(r)) / 86400000);
const byDay = {};
activities.filter((a) => a.endedAtEpochMs != null).forEach((a) => { (byDay[dayKey(a.startedAtEpochMs)] ||= []).push(a); });
const payload = {
  v: 1,
  c: { i: 'outdoor-fixture', n: 'Outdoor Fixture', u: 'lb', p: 'web' },
  r, t: '2026-09-16', z: 1789500000, x: [],
  d: Object.keys(byDay).sort().map((k) => ({ k: offset(k), o: O.shareDay(byDay[k]) })),
  ob: expected.ob,
  lr: expected.lr,
};
const link = 'https://www.dugcanlift.com/coach/#1z' + deflateRawSync(Buffer.from(JSON.stringify(payload))).toString('base64url');
writeFileSync('lift/fixtures/outdoor-share-link.txt', link + '\n');
console.log(JSON.stringify({ o: expected.o, ob: expected.ob, lr: expected.lr.slice(0, 5), poly: expected.lr[5].length, pts: expected.trimmedPointCount, days: payload.d, linkKB: (link.length / 1024).toFixed(2) }));
