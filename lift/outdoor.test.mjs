import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';

const shim = { window: {} };
new Function('window', readFileSync('lift/outdoor.js', 'utf8')).call(shim, shim.window);
const O = shim.window.LiftOutdoor;

const t0 = 1_800_000_000_000;
const day = 86_400_000;

function activity(type, { dayOffset = 0, meters, seconds, points = 2 }) {
  const start = t0 + dayOffset * day;
  return {
    id: `${type}-${dayOffset}-${meters}`,
    activityType: type,
    startedAtEpochMs: start,
    endedAtEpochMs: seconds == null ? null : start + seconds * 1000,
    distanceMeters: meters,
    elevationGainMeters: 0,
    route: Array.from({ length: points }, (_, i) => [30 + i * 0.001, -97, 150, i * 5, 5]),
  };
}

// MARK: - Which fixes are kept

const coords = (lat, lon, accuracy = 5, altitude = null) => ({ latitude: lat, longitude: lon, accuracy, altitude });

test('the first good fix is kept, compactly', () => {
  const p = O.acceptFix(null, coords(30.2672001234, -97.7431, 8.4, 149.26), t0 + 2500, t0);
  assert.deepEqual(p, [30.2672, -97.7431, 149.3, 2.5, 8]);
});

test('a fix worse than 50 m is dropped', () => {
  assert.equal(O.acceptFix(null, coords(30, -97, 51), t0, t0), null);
  assert.notEqual(O.acceptFix(null, coords(30, -97, 50), t0, t0), null);
});

test('standing still does not add points', () => {
  const first = O.acceptFix(null, coords(30, -97), t0, t0);
  // ~1 m north, ten seconds later.
  assert.equal(O.acceptFix(first, coords(30.00001, -97), t0 + 10_000, t0), null);
});

test('a fix sooner than 3 s after the last is dropped even when it moved', () => {
  const first = O.acceptFix(null, coords(30, -97), t0, t0);
  assert.equal(O.acceptFix(first, coords(30.001, -97), t0 + 2_000, t0), null);
  assert.notEqual(O.acceptFix(first, coords(30.001, -97), t0 + 3_000, t0), null);
});

test('no altitude is stored as null, not sea level', () => {
  assert.equal(O.acceptFix(null, coords(30, -97), t0, t0)[2], null);
});

// MARK: - Route maths

test('distance sums the legs', () => {
  // 0.009 degrees of latitude is almost exactly a kilometre.
  const d = O.totalDistanceMeters([[30, -97, null, 0, 5], [30.0045, -97, null, 60, 5], [30.009, -97, null, 120, 5]]);
  assert.ok(Math.abs(d - 1000.8) < 1, `got ${d}`);
});

test('elevation gain ignores jitter and points with no altitude', () => {
  const pts = [[0, 0, 100], [0, 0, 101], [0, 0, null], [0, 0, 105], [0, 0, 103], [0, 0, 110]];
  // 100 -> 105 is +5; 105 -> 103 is under the 3 m threshold; 105 -> 110 is +5.
  assert.equal(O.elevationGainMeters(pts), 10);
  assert.equal(O.elevationGainMeters([[0, 0, null], [0, 0, null]]), 0);
});

// MARK: - Last route

test('the last route is the newest finished one', () => {
  const older = activity('RUN', { meters: 5000, seconds: 1500 });
  const newer = activity('HIKE', { dayOffset: 2, meters: 8000, seconds: 7200 });
  assert.equal(O.lastRoute([older, newer]), newer);
  assert.equal(O.lastRoute([newer, older]), newer);
});

test('a recording in progress, or a route with one fix, is not the last route', () => {
  const finished = activity('RUN', { meters: 5000, seconds: 1500 });
  assert.equal(O.lastRoute([finished, activity('WALK', { dayOffset: 1, meters: 900, seconds: null })]), finished);
  assert.equal(O.lastRoute([finished, activity('RUN', { dayOffset: 1, meters: 0, seconds: 60, points: 1 })]), finished);
  assert.equal(O.lastRoute([]), null);
});

// MARK: - Bests, the same cases iOS and Android pin

test('bests are per type in Start button order', () => {
  const b = O.bests([activity('HIKE', { meters: 9000, seconds: 10000 }), activity('RUN', { meters: 5000, seconds: 1500 })]);
  assert.deepEqual(b.map((x) => x.type), ['RUN', 'HIKE']);
});

test('farthest and longest can come from different activities', () => {
  const [run] = O.bests([activity('RUN', { meters: 10000, seconds: 3000 }), activity('RUN', { dayOffset: 1, meters: 6000, seconds: 3600 })]);
  assert.equal(run.count, 2);
  assert.equal(run.longestDistanceMeters, 10000);
  assert.equal(run.longestDurationMs, 3_600_000);
  assert.ok(Math.abs(run.fastestPaceSecondsPerMeter - 0.3) < 1e-9);
});

test('a short blip cannot set the fastest pace', () => {
  const [run] = O.bests([activity('RUN', { meters: 5000, seconds: 1500 }), activity('RUN', { dayOffset: 1, meters: 40, seconds: 5 })]);
  assert.ok(Math.abs(run.fastestPaceSecondsPerMeter - 0.3) < 1e-9);
});

test('no pace until a recording is long enough, and blank stays blank', () => {
  const [walk] = O.bests([activity('WALK', { meters: 800, seconds: 600 })]);
  assert.equal(walk.fastestPaceSecondsPerMeter, null);
  const [hike] = O.bests([activity('HIKE', { meters: 0, seconds: 900, points: 0 })]);
  assert.equal(hike.longestDistanceMeters, null);
  assert.equal(hike.longestDurationMs, 900_000);
});

test('an unfinished recording counts for nothing', () => {
  assert.deepEqual(O.bests([activity('RUN', { meters: 42000, seconds: null })]), []);
});

// MARK: - Formatting, identical strings to iOS and Android

test('duration, pace and distance text', () => {
  assert.equal(O.durationText(1_720_000), '28:40');
  assert.equal(O.durationText(3_730_000), '1:02:10');
  assert.equal(O.paceText(0.3, 'miles'), '8:03 /mi');
  assert.equal(O.paceText(0.3, 'kilometers'), '5:00 /km');
  assert.equal(O.distanceText(5000, 'miles'), '3.11 mi');
  assert.equal(O.distanceText(5000, 'kilometers'), '5.00 km');
});

// MARK: - Drawing

const inBox = (pts, w, h) => pts.every((p) => p.x >= 0 && p.x <= w && p.y >= 0 && p.y <= h);

test('every route shape stays inside square and wide boxes', () => {
  const shapes = [
    [[40, -74], [40.0001, -74.1]],
    [[40, -74], [40.2, -74.0001]],
    [[40, -74], [40.01, -74.01]],
  ].map((s) => s.map(([a, b]) => [a, b, null, 0, 5]));
  shapes.forEach((s) => {
    assert.ok(inBox(O.project(s, 1000, 1000), 1000, 1000));
    assert.ok(inBox(O.project(s, 1000, 450), 1000, 450));
  });
});

test('a route is centred, north up, and never stretched', () => {
  const line = O.project([[40, -74, null, 0, 5], [40.1, -74, null, 0, 5]], 1000, 450);
  assert.ok(Math.abs(line[0].x - 500) < 0.5 && Math.abs(line[1].x - 500) < 0.5);
  assert.ok(line[1].y < line[0].y, 'north is up');

  const lonSpan = 0.01 / Math.cos((40.00667 * Math.PI) / 180);
  const sq = O.project([[40, -74, null, 0, 5], [40, -74 + lonSpan, null, 0, 5], [40.01, -74 + lonSpan, null, 0, 5]], 1000, 450);
  assert.ok(Math.abs((sq[1].x - sq[0].x) - (sq[1].y - sq[2].y)) < 1);
});

// MARK: - Backup

test('an activity survives a backup round trip in Android field names', () => {
  const a = activity('WALK', { meters: 1234.5, seconds: 900, points: 3 });
  const out = O.toBackup(a);
  assert.equal(out.activityType, 'WALK');
  assert.deepEqual(Object.keys(out.routePoints[0]).sort(),
    ['altitudeMeters', 'horizontalAccuracyMeters', 'latitude', 'longitude', 'recordedAtEpochMs']);
  assert.equal(out.routePoints[1].recordedAtEpochMs, t0 + 5000);
  assert.deepEqual(O.fromBackup(JSON.parse(JSON.stringify(out))), a);
});

test('an unfinished or unknown activity is not restored', () => {
  const a = O.toBackup(activity('RUN', { meters: 10, seconds: 10 }));
  assert.equal(O.fromBackup({ ...a, endedAtEpochMs: null }), null);
  assert.equal(O.fromBackup({ ...a, activityType: 'SWIM' }), null);
  assert.equal(O.fromBackup({ ...a, id: '' }), null);
});

// MARK: - Sending to a coach (SHARE-FORMAT.md, "Outdoor")

const shareInput = JSON.parse(readFileSync('lift/fixtures/outdoor-share-input.json', 'utf8')).outdoor;
const shareExpected = JSON.parse(readFileSync('lift/fixtures/outdoor-share-expected.json', 'utf8'));
const shareActivities = shareInput.map((a) => O.fromBackup(a) || { ...a, route: [] });

test('the polyline matches Google\'s own worked example', () => {
  assert.equal(O.encodePolyline([[38.5, -120.2], [40.7, -120.95], [43.252, -126.453]]), '_p~iF~ps|U_ulLnnqC_mqNvxq`@');
  assert.deepEqual(O.decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@'), [[38.5, -120.2], [40.7, -120.95], [43.252, -126.453]]);
});

test('negative halves round the way the format says, not the way Math.round does', () => {
  // floor(v * 1e5 + 0.5): -0.000005 becomes 0, where a round-half-away-from-zero gives -1.
  assert.equal(O.encodePolyline([[0, -0.000005]]), '??');
});

test('the shared fixture still produces exactly what it says', () => {
  assert.deepEqual(O.shareDay(shareActivities), shareExpected.o);
  assert.deepEqual(O.shareBests(shareActivities), shareExpected.ob);
  assert.deepEqual(O.shareLastRoute(shareActivities), shareExpected.lr);
});

test('the first and last 200 m of a route never leave the phone', () => {
  const loop = shareActivities.find((a) => a.id === 'run-loop');
  const start = loop.route[0];
  const sent = O.decodePolyline(shareExpected.lr[5]);
  assert.equal(sent.length, 150, 'thinned to 150');
  sent.forEach(([lat, lon]) => {
    assert.ok(O.haversineMeters(start[0], start[1], lat, lon) > 150,
      'every point sent is well clear of the front door');
  });
});

test('a route with nothing left after trimming is not sent, and no older one is sent instead', () => {
  const walk = shareActivities.find((a) => a.id === 'walk-short');
  const olderLongRun = shareActivities.find((a) => a.id === 'run-long');
  assert.equal(O.trimAndThin(walk.route).length, 0);
  assert.equal(O.shareLastRoute([olderLongRun, walk]), null);
});

test('an unfinished activity is in neither the day nor the bests', () => {
  assert.equal(shareExpected.o.length, 3);
  assert.deepEqual(shareExpected.ob.map((b) => b[0]), [0, 1], 'no hike row');
});

test('the fixture link decodes to the same parts', async () => {
  const { inflateRawSync } = await import('node:zlib');
  const link = readFileSync('lift/fixtures/outdoor-share-link.txt', 'utf8').trim();
  const payload = JSON.parse(inflateRawSync(Buffer.from(link.split('#1z')[1], 'base64url')));
  assert.deepEqual(payload.ob, shareExpected.ob);
  assert.deepEqual(payload.lr, shareExpected.lr);
  assert.deepEqual(payload.d.flatMap((d) => d.o), shareExpected.o);
});
