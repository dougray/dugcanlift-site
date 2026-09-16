import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';

// Loaded the way the browser loads it. Run from the repo root: node --test coach/
const shim = { window: {} };
new Function('window', readFileSync('coach/route.js', 'utf8')).call(shim, shim.window);
const R = shim.window.CoachRoute;

// Written by LIFT web's own encoder -- never regenerate them here.
const link = readFileSync('coach/fixtures/outdoor-share-link.txt', 'utf8').trim();
const payload = JSON.parse(inflateRawSync(Buffer.from(link.split('#1z')[1], 'base64url')));
const expected = JSON.parse(readFileSync('coach/fixtures/outdoor-share-expected.json', 'utf8'));

test("LIFT web's link carries a day's activities", () => {
  const days = payload.d.map((d) => R.readDay(d.o));
  assert.deepEqual(days[0], [{ type: 0, durationSec: 3000, distanceM: 10001, climbM: 0 }]);
  assert.equal(days.flat().length, 3);
});

test("LIFT web's bests read back, blank staying blank", () => {
  const bests = R.readBests(payload.ob);
  assert.deepEqual(bests[0], { type: 0, count: 2, farthestM: 10001, longestSec: 3000, fastestSecPerKm: 300 });
  assert.equal(bests[1].fastestSecPerKm, null, 'a 300 m walk sets no pace');
});

test("LIFT web's last route decodes to the 150 trimmed points it sent", () => {
  const route = R.readLastRoute(payload.lr);
  assert.equal(route.points.length, expected.trimmedPointCount);
  assert.equal(route.type, 0);
  assert.equal(route.distanceM, 2795);
  assert.equal(route.startedAt, 1789259200000);
});

test('the polyline matches Google\'s worked example', () => {
  assert.deepEqual(R.decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@'), [[38.5, -120.2], [40.7, -120.95], [43.252, -126.453]]);
});

test('a broken route is no route, not a crash', () => {
  assert.equal(R.readLastRoute(null), null);
  assert.equal(R.readLastRoute([0, 1, 2, 3, 4, '_p~iF']), null, 'one half-point');
  assert.equal(R.readLastRoute([9, 1, 2, 3, 4, '_p~iF~ps|U_ulLnnqC']), null, 'unknown type');
  assert.deepEqual(R.readDay([[7, 1, 2, 3], 'x', [1, 60, 500, 0]]), [{ type: 1, durationSec: 60, distanceM: 500, climbM: 0 }]);
  assert.equal(R.readBests([]), null);
});

test('formatting matches LIFT', () => {
  assert.equal(R.durationText(1720), '28:40');
  assert.equal(R.durationText(3730), '1:02:10');
  assert.equal(R.paceText(300, 'km'), '5:00 /km');
  assert.equal(R.paceText(300, 'mi'), '8:03 /mi');
  assert.equal(R.distanceText(5000, 'mi'), '3.11 mi');
  assert.equal(R.distanceUnit('kg'), 'km');
  assert.equal(R.distanceUnit('lb'), 'mi');
  assert.equal(R.activityPace(900, 600, 'mi'), null, 'under 1 km has no pace');
});

test('a route stays inside its box, north up', () => {
  const pts = R.project(R.readLastRoute(payload.lr).points, 600, 300);
  assert.ok(pts.every((p) => p.x >= 0 && p.x <= 600 && p.y >= 0 && p.y <= 300));
  const line = R.project([[40, -74], [40.1, -74]], 600, 300);
  assert.ok(line[1].y < line[0].y);
});
