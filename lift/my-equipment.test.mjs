import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';

// Loaded the way the browser loads it, like routines.test.mjs does. A port of
// LIFT iOS's MyEquipmentTests, case for case.
const shim = { window: {} };
new Function('window', readFileSync('lift/my-equipment.js', 'utf8')).call(shim, shim.window);
const E = shim.window.LiftEquipment;

const identity = (v) => v;

function memoryStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    has: (k) => map.has(k),
  };
}

test('owning everything hides nothing', () => {
  assert.equal(E.allows('barbell', new Set()), true);
  const records = ['barbell', 'cable', null];
  const result = E.filter(records, new Set(), identity);
  assert.deepEqual(result.shown, records);
  assert.equal(result.leftOut, 0);
});

test('what you do not have is left out and counted', () => {
  const records = ['barbell', 'cable', 'dumbbell', 'Cable '];
  const result = E.filter(records, new Set(['cable']), identity);
  assert.deepEqual(result.shown, ['barbell', 'dumbbell']);
  assert.equal(result.leftOut, 2);
});

// Unknown is not "needs something you lack".
test('an exercise with no equipment listed always shows', () => {
  const everything = new Set(E.KINDS.map((k) => k.id));
  assert.equal(E.allows(null, everything), true);
  assert.equal(E.allows('  ', everything), true);
  assert.equal(E.allows('', everything), true);
});

test('owning everything stores no key', () => {
  const storage = memoryStorage();
  assert.deepEqual([...E.load(storage)], []);
  E.save(new Set(['machine', 'cable']), storage);
  assert.deepEqual([...E.load(storage)].sort(), ['cable', 'machine']);
  E.save(new Set(), storage);
  assert.equal(storage.has(E.STORAGE_KEY), false);
});

// A value in the data with no switch could never be turned off, and that
// exercise would show for someone who has none of it.
test('every equipment value in the data has a switch', () => {
  const lib = JSON.parse(readFileSync('lift/exercises.json', 'utf8'));
  assert.ok(lib.exercises.length > 800);
  const known = new Set(E.KINDS.map((k) => k.id));
  const values = new Set(lib.exercises.map(([, , eq]) => E.normalised(lib.equipment[eq])));
  values.delete('');
  assert.deepEqual([...values].filter((v) => !known.has(v)), []);
});

// This build's own: the picker files an exercise's equipment title-cased
// ("Body Only"), and a stored "E-Z Curl Bar" is still the same switch.
test('a title-cased equipment value is the same switch', () => {
  assert.equal(E.allows('E-Z Curl Bar', new Set(['e-z curl bar'])), false);
  assert.equal(E.allows('Body Only', new Set(['body only'])), false);
});

test('search says how many it left out, in iOS words', () => {
  assert.equal(E.leftOutText(1), "1 exercise needs equipment you don't have.");
  assert.equal(E.leftOutText(4), "4 exercises need equipment you don't have.");
  assert.equal(E.rowText(true, 12), 'Your equipment · 12 left out');
  assert.equal(E.rowText(true, 0), 'Your equipment');
  assert.equal(E.rowText(false, 12), 'All equipment');
});

test('a stored value that is not a list reads as nothing stored', () => {
  const storage = memoryStorage();
  storage.setItem(E.STORAGE_KEY, '{"cable":true}');
  assert.equal(E.load(storage).size, 0);
  storage.setItem(E.STORAGE_KEY, 'not json');
  assert.equal(E.load(storage).size, 0);
});
