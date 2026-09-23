import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';

// Loaded the way the browser loads it, in index.html's order. Run from the
// repo root: node --test coach/
const shim = { window: {} };
['sides.js', 'prescriptions.js', 'road-picks.js'].forEach((file) => {
  new Function('window', readFileSync(`coach/${file}`, 'utf8')).call(shim, shim.window);
});
const R = shim.window.CoachRoadPicks;
const P = shim.window.CoachPrescriptions;

// The bundled file itself, the same bytes LIFT has.
const DATA = JSON.parse(readFileSync('coach/road-food.json', 'utf8'));

/* ---------------- the stored list ---------------- */

test('picks are trimmed strings, unique, in the order they were ticked', () => {
  assert.deepEqual(R.normalise([' b ', 'a', 'b', '', 'a', null, 7, {}, 'c']), ['b', 'a', 'c']);
  assert.deepEqual(R.normalise(null), []);
  assert.deepEqual(R.normalise('wendys-large-chili'), [], 'a bare string is not a list');
});

test('toggle adds at the end and removes by id', () => {
  assert.deepEqual(R.toggle(['a', 'b'], 'c', true), ['a', 'b', 'c']);
  assert.deepEqual(R.toggle(['a', 'b'], 'a', false), ['b']);
  assert.deepEqual(R.toggle(['a', 'b'], 'a', true), ['b', 'a'], 'ticking one already on is a no-op re-add');
  assert.deepEqual(R.toggle([], 'a', false), []);
});

test('toggleAll picks or clears one place without touching another', () => {
  const items = [{ id: 'x1' }, { id: 'x2' }];
  assert.deepEqual(R.toggleAll(['a'], items, true), ['a', 'x1', 'x2']);
  assert.deepEqual(R.toggleAll(['a', 'x1', 'x2'], items, false), ['a']);
  assert.deepEqual(R.toggleAll(['a', 'x1'], items, true), ['a', 'x1', 'x2'], 'no duplicates');
});

/* ---------------- the wire ---------------- */

test('no picks is no key at all, never an empty list', () => {
  assert.equal(R.wire([]), null);
  assert.equal(R.wire(null), null);
  assert.equal(R.wire(['', '  ']), null);
  // What app.js does with it: `if (picks) payload.rf = picks`. A plan with no
  // picks is byte for byte the plan main wrote.
  const payload = { v: 1, t: 'plan', l: 'a1b2c3d4', n: 'Doug', r: [], m: [] };
  const before = JSON.stringify(payload);
  const picks = R.wire([]);
  if (picks) payload.rf = picks;
  assert.equal(JSON.stringify(payload), before);
  assert.ok(!before.includes('rf'));
});

test('picks travel as a flat list of ids, in order', () => {
  assert.deepEqual(R.wire(['wendys-large-chili', 'chickfila-grilled-filet']),
    ['wendys-large-chili', 'chickfila-grilled-filet']);
});

test('a plan with picks reads them back exactly, and junk reads as none', () => {
  const ids = ['wendys-large-chili', 'snack-jack-links-original-beef-jerky'];
  assert.deepEqual(R.fromWire(JSON.parse(JSON.stringify(R.wire(ids)))), ids);
  [undefined, null, 0, 'wendys-large-chili', { a: 1 }].forEach((junk) => {
    assert.deepEqual(R.fromWire(junk), [], String(junk));
  });
  assert.deepEqual(R.fromWire(['a', 'a', 3, ' b']), ['a', 'b'], 'read leniently, never refused');
});

test('nothing is filtered against this app\'s own copy of the file on the way out', () => {
  // The coach's bundle and the client's are two builds updated at different
  // times, so only the receiver can say what it has. An id this copy does not
  // know still travels; LIFT skips it silently.
  const ids = ['wendys-large-chili', 'gone-from-the-menu-2019'];
  assert.deepEqual(R.wire(ids), ids);
  assert.deepEqual(R.missing(ids, DATA), ['gone-from-the-menu-2019']);
});

/* ---------------- against the bundled file ---------------- */

test('every id in the bundled file is unique: the ids are the whole contract', () => {
  const all = R.catalogue(DATA).map((e) => e.id);
  assert.equal(new Set(all).size, all.length);
  assert.ok(all.length > 50, 'chains and snacks both counted');
});

test('the catalogue covers chain items and gas-station snacks alike', () => {
  const index = R.index(DATA);
  const chilli = index['wendys-large-chili'];
  assert.equal(chilli.placeName, "Wendy's");
  const jerky = index['snack-jack-links-original-beef-jerky'];
  assert.equal(jerky.placeId, 'snacks');
  assert.equal(jerky.placeName, 'Gas station');
});

test('counts and the summary line count only what this copy has', () => {
  const wendys = DATA.chains.find((c) => c.id === 'wendys');
  const ids = ['wendys-large-chili', 'wendys-4-pc-tenders', 'gone-from-the-menu-2019'];
  assert.equal(R.countIn(ids, wendys.items), 2);
  assert.equal(R.summary(ids, DATA), '2 items at 1 place');
  assert.equal(R.summary(['wendys-large-chili', 'snack-rxbar-blueberry'], DATA),
    '2 items at 2 places');
  assert.equal(R.summary(['wendys-large-chili'], DATA), '1 item at 1 place');
  assert.equal(R.summary([], DATA), '');
  assert.equal(R.summary(['gone-from-the-menu-2019'], DATA), '',
    'an id nothing here knows is not counted on screen, though it still travels');
});
/* ---------------- the fixture ---------------- */

// coach/fixtures/web-plan-road-picks.txt: a link this app's own encoder wrote
// in a browser, with picks at two chains and a gas-station snack plus one id
// that is deliberately not in the file. The same bytes are checked into
// dugcanlift-site as lift/fixtures/web-plan-road-picks.txt, and the iOS and
// Android decoders read this file too. Never regenerate it from a decoder.
const FIXTURE = readFileSync('coach/fixtures/web-plan-road-picks.txt', 'utf8');

test('the road-picks fixture carries rf as a flat list of ids', async () => {
  const payload = JSON.parse(await P.unpack(FIXTURE));
  assert.equal(payload.v, 1, 'purely additive: no version bump');
  assert.equal(payload.t, 'plan');
  assert.ok(Array.isArray(payload.rf));
  assert.ok(payload.rf.every((id) => typeof id === 'string'));
  assert.deepEqual(R.fromWire(payload.rf), payload.rf, 'already normalised');

  const index = R.index(DATA);
  const places = new Set(payload.rf.filter((id) => index[id]).map((id) => index[id].placeId));
  assert.ok(places.size >= 3, 'two chains and the gas station at least');
  assert.ok(places.has('snacks'), 'a gas-station snack');
  assert.equal(R.missing(payload.rf, DATA).length, 1,
    'exactly one id the data does not have, so a decoder\'s skip rule is exercised');
});
