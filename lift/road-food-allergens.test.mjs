import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';

// A port of LIFT iOS's RoadFoodAllergensTests, case for case. Loaded the way
// the browser loads the file, like road-food.test.mjs does.
const shim = { window: {} };
new Function('window', readFileSync('lift/road-food.js', 'utf8')).call(shim, shim.window);
const A = shim.window.LiftRoadFood.allergens;

const item = (id, allergens) => {
  const i = { id, name: id, kcal: 300, proteinG: 20, fatG: 10, carbsG: 30 };
  if (allergens !== undefined) i.allergens = allergens;
  return i;
};
const ids = (list) => list.map((i) => i.id);

const nine = A.all;
const noShellfish = A.all.filter((a) => a !== 'shellfish');

test('avoiding nothing shows everything', () => {
  const items = [item('a', ['milk']), item('b')];
  assert.deepEqual(A.filter(items, nine, []).shown, items);
  assert.deepEqual(A.verdict(items[0], nine, []), { kind: 'clear', list: [] });
});

test('an item containing what is avoided is hidden and counted', () => {
  const items = [item('bun', ['milk', 'wheat']), item('salad', []), item('wrap', ['wheat'])];
  const filtered = A.filter(items, nine, ['milk']);
  assert.deepEqual(ids(filtered.shown), ['salad', 'wrap']);
  assert.equal(filtered.hiddenCount, 1);
  assert.deepEqual(A.verdict(items[0], nine, ['milk', 'soy']), { kind: 'contains', list: ['milk'] });
});

// Never claimed free: an item the chart says nothing about stays, and says so.
test('an item not stated is shown and said to be not stated', () => {
  const unknown = item('mystery');
  const filtered = A.filter([unknown], nine, ['milk']);
  assert.deepEqual(filtered.shown, [unknown]);
  const verdict = A.verdict(unknown, nine, ['egg', 'milk']);
  assert.deepEqual(verdict, { kind: 'notStated', list: ['milk', 'egg'] });
  assert.equal(A.notStatedLine(verdict), 'Milk and egg not stated');
});

// A chart with no shellfish column says nothing about shellfish, even for an
// item it lists with no allergens at all.
test('an allergen the chart does not cover is not stated, even for an empty list', () => {
  const nuggets = item('nuggets', []);
  assert.deepEqual(A.verdict(nuggets, noShellfish, ['shellfish']), { kind: 'notStated', list: ['shellfish'] });
  assert.deepEqual(A.verdict(nuggets, noShellfish, ['milk']), { kind: 'clear', list: [] });
  // A chain with no chart at all: everything is not stated.
  assert.deepEqual(A.verdict(nuggets, [], ['milk']), { kind: 'notStated', list: ['milk'] });
  // And an absent allergensCovered is a chart that covers nothing.
  assert.deepEqual(A.verdict(nuggets, undefined, ['milk']), { kind: 'notStated', list: ['milk'] });
});

test('the contains line', () => {
  assert.equal(A.containsLine(item('a', ['milk', 'wheat', 'soy'])), 'Contains milk, wheat, and soy');
  assert.equal(A.containsLine(item('a', ['tree-nuts'])), 'Contains tree nuts');
  assert.equal(A.containsLine(item('a', [])), 'Contains none of the allergens its chart lists');
  assert.equal(A.containsLine(item('a')), null);
});

test('unknown strings are dropped and order is fixed', () => {
  assert.deepEqual(A.known(['SOY', 'gluten', 'milk', 'milk']), ['milk', 'soy']);
});

test('the avoid list is kept, and avoiding nothing stores no key', () => {
  const store = {};
  const storage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
  };
  A.save(['wheat', 'milk'], storage);
  assert.deepEqual(A.load(storage), ['milk', 'wheat']);
  A.save([], storage);
  assert.equal(storage.getItem(A.storageKey), null);
  assert.equal(A.storageKey in store, false);
});

// Web has no decoder, so the same cleaning happens where the fields are read.
test('the fields are read leniently and junk is dropped', () => {
  const chain = {
    allergensCovered: ['milk', 'wheat', 'dairy'],
    items: [item('c-a', ['wheat', 'nuts']), item('c-b')],
  };
  assert.deepEqual(A.known(chain.allergensCovered), ['milk', 'wheat']);
  assert.equal(A.containsLine(chain.items[0]), 'Contains wheat');
  assert.equal(A.containsLine(chain.items[1]), null);
  // "dairy" covers nothing: milk is covered, dairy is not an allergen here.
  assert.deepEqual(A.verdict(chain.items[0], chain.allergensCovered, ['milk']), { kind: 'clear', list: [] });
  // A value that is not a list is not stated.
  assert.equal(A.containsLine({ id: 'x', allergens: 'milk' }), null);
});

// Storage that throws (a private window, blocked site data) is avoiding nothing.
test('storage that throws reads as avoiding nothing', () => {
  const broken = {
    getItem: () => { throw new Error('denied'); },
    setItem: () => { throw new Error('denied'); },
    removeItem: () => { throw new Error('denied'); },
  };
  assert.deepEqual(A.load(broken), []);
  assert.deepEqual(A.save(['milk'], broken), ['milk']);
});

test('the note under the Avoid row', () => {
  const covers = { name: 'Sonic', allergenSource: 'https://example.test/chart.pdf', allergensCovered: nine };
  const listsOnly = { name: 'Starbucks', allergenSource: 'https://example.test/api' };
  const noChart = { name: 'Taco Bell' };
  assert.equal(A.avoidNote(0, covers),
    'Nothing here is listed as containing what you avoid. '
    + 'From the allergen chart Sonic publishes, which doesn’t cover cross-contact. Check with the restaurant.');
  assert.equal(A.avoidNote(1, covers).split('. ')[0],
    '1 item is hidden because its chart says it contains something you avoid');
  assert.equal(A.avoidNote(6, listsOnly),
    '6 items are hidden because their chart says they contain something you avoid. '
    + 'From the allergen chart Starbucks publishes. It says what items contain, not which allergens it '
    + 'covers, so nothing is marked free of anything. It doesn’t cover cross-contact either. '
    + 'Check with the restaurant.');
  // An empty or junk allergensCovered covers nothing, like an absent one.
  assert.equal(A.avoidNote(0, { ...listsOnly, allergensCovered: ['dairy'] }), A.avoidNote(0, listsOnly));
  const none = 'Nothing here is listed as containing what you avoid. '
    + 'This place publishes no allergen chart LIFT can read, so nothing is marked either way.';
  assert.equal(A.avoidNote(0, noChart), none);
  // A covered list with no source is still no chart read.
  assert.equal(A.avoidNote(0, { name: 'X', allergensCovered: nine }), none);
  // The gas station.
  assert.equal(A.avoidNote(0, null), none);
});

// Nothing this file can say about an item calls it safe or free of anything.
test('nothing here says safe', () => {
  const lines = [];
  const items = [item('a', ['milk']), item('b', []), item('c')];
  [[], ['milk'], ['milk', 'shellfish'], A.all].forEach((avoiding) => {
    [nine, noShellfish, []].forEach((covered) => {
      items.forEach((i) => {
        lines.push(A.containsLine(i), A.notStatedLine(A.verdict(i, covered, avoiding)));
      });
      [0, 1, 2].forEach((n) => lines.push(
        A.avoidNote(n, { name: 'X', allergenSource: 'u', allergensCovered: covered }),
        A.avoidNote(n, { name: 'X', allergenSource: 'u' }), A.avoidNote(n, null)));
    });
  });
  // "nothing is marked free of anything" is the one use of the word, and it
  // is the refusal to claim it.
  lines.filter(Boolean).forEach((l) => assert.doesNotMatch(l, /\bsafe\b|\bfree of (?!anything)|-free\b/i, l));
  assert.ok(lines.some((l) => l && l.includes('nothing is marked free of anything')));
});

// Where reading `localStorage` itself throws, the screen hands over nothing.
test('no storage at all reads as avoiding nothing', () => {
  assert.deepEqual(A.load(null), []);
  assert.deepEqual(A.save(['soy'], null), ['soy']);
});
