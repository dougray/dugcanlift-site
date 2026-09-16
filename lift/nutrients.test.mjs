import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';

// Loaded the way the browser loads it, like food-amount.test.mjs does.
const shim = { window: {} };
new Function('window', readFileSync('lift/nutrients.js', 'utf8')).call(shim, shim.window);
const N = shim.window.LiftNutrients;

// These mirror dugcanlift-kit-android's NutrientDetailsTest, the reference
// implementation of SHARE-FORMAT's fx/fe and PLAN-FORMAT's ux.

const entry = (servings, saturatedFatG, sugarG, sodiumMg) => {
  const e = { servings, calories: 100 };
  if (saturatedFatG !== undefined) e.saturatedFatG = saturatedFatG;
  if (sugarG !== undefined) e.sugarG = sugarG;
  if (sodiumMg !== undefined) e.sodiumMg = sodiumMg;
  return e;
};

// MARK: - fx

test('day totals multiply by servings, cover only known values and count every food', () => {
  assert.deepEqual(N.dayTotals([
    entry(2, 3.1, 2, 540),
    entry(1),
    entry(0.5, null, 12),
    entry(1, undefined, undefined, 100),
  ]), [6.2, 10, 1180, 4, 1, 2, 2]);
});

test('a total nobody recorded is null, and no details at all is no fx', () => {
  assert.deepEqual(N.dayTotals([entry(1, undefined, 4), entry(1)]), [null, 4, null, 2, 0, 1, 0]);
  assert.equal(N.dayTotals([entry(1), entry(3, null, null, null)]), null);
  assert.equal(N.dayTotals([]), null);
  assert.equal(N.dayTotals(undefined), null);
});

test('a recorded zero is a value, not a gap', () => {
  assert.deepEqual(N.dayTotals([entry(1, undefined, undefined, 0)]), [null, null, 0, 1, 0, 0, 1]);
  assert.deepEqual(N.row({ sodiumMg: 0 }), [null, null, 0]);
});

test('a non-finite, negative or non-numeric value counts as unrecorded', () => {
  assert.deepEqual(N.dayTotals([entry(1, 1, NaN, Infinity)]), [1, null, null, 1, 1, 0, 0]);
  assert.equal(N.row({ saturatedFatG: NaN }), null);
  assert.equal(N.row({ sugarG: -3, sodiumMg: true }), null);
});

test('rounding is half-up, grams to one decimal and sodium whole', () => {
  assert.equal(N.roundGrams(0.05), 0.1);
  assert.equal(N.roundGrams(12.25), 12.3);
  assert.equal(N.roundMilligrams(2.5), 3);
  assert.deepEqual(N.dayTotals([entry(0.5, 0.1, 1.94, 5)]), [0.1, 1, 3, 1, 1, 1, 1]);
});

test('totals are summed unrounded and rounded once', () => {
  // Three 0.04 g foods round to 0.0 each; the day holds 0.12 g, which is 0.1.
  assert.equal(N.dayTotals([entry(1, 0.04), entry(1, 0.04), entry(1, 0.04)])[0], 0.1);
});

test('a food with no servings counts once, as the macros do', () => {
  assert.deepEqual(N.dayTotals([{ sodiumMg: 200 }]), [null, null, 200, 1, 0, 0, 1]);
});

// MARK: - fe and ux

test('item rows trim trailing nulls only', () => {
  assert.deepEqual(N.row({ saturatedFatG: 3.14, sugarG: 2, sodiumMg: 539.6 }), [3.1, 2, 540]);
  assert.deepEqual(N.row({ sugarG: 12 }), [null, 12]);
  assert.deepEqual(N.row({ saturatedFatG: 1.5 }), [1.5]);
  assert.equal(N.row({}), null);
  assert.equal(N.row(null), null);
});

test("fe is aligned with f, and absent when no food recorded any", () => {
  const foods = [
    { servings: 1, saturatedFatG: 3.1, sugarG: 2, sodiumMg: 540 },
    { servings: 1 },
    { servings: 2, sugarG: 12 },
  ];
  assert.equal(JSON.stringify(N.itemRows(foods)), '[[3.1,2,540],null,[null,12]]');
  assert.equal(JSON.stringify(N.dayTotals(foods)), '[3.1,26,540,3,1,2,1]', "the spec's own example");
  assert.equal(N.itemRows([{ servings: 1 }, { servings: 1, sodiumMg: null }]), null);
});

test('ux reads per serving, trimmed tuples read, and malformed reads as null', () => {
  assert.deepEqual(N.parseRow([6.5, 8, 720]), { saturatedFatG: 6.5, sugarG: 8, sodiumMg: 720 });
  assert.deepEqual(N.parseRow([null, 12]), { saturatedFatG: null, sugarG: 12, sodiumMg: null });
  assert.deepEqual(N.parseRow([1, 2, 3, 99]), { saturatedFatG: 1, sugarG: 2, sodiumMg: 3 }, 'a longer tuple keeps its first three');
  for (const bad of ['x', ['6', 1], [], [null, null, null], {}, undefined, [1, true], [-1]]) {
    assert.equal(N.parseRow(bad), null, JSON.stringify(bad));
  }
});

// MARK: - Open Food Facts

test('Open Food Facts sodium is grams, and becomes milligrams', () => {
  const d = N.fromOpenFoodFacts({ 'saturated-fat_100g': 1.2, sugars_100g: '4.5', sodium_100g: 0.4, salt_100g: 1 }, '100g');
  assert.deepEqual(d, { saturatedFatG: 1.2, sugarG: 4.5, sodiumMg: 400 });
});

test('a product listing only salt gets sodium at 2.5 g salt per g sodium', () => {
  assert.deepEqual(N.fromOpenFoodFacts({ salt_serving: 1.25 }, 'serving'),
    { saturatedFatG: null, sugarG: null, sodiumMg: 500 });
});

test('a product listing none of them records none, not zeros', () => {
  assert.deepEqual(N.fromOpenFoodFacts({ 'energy-kcal_100g': 100 }, '100g'),
    { saturatedFatG: null, sugarG: null, sodiumMg: null });
  assert.deepEqual(N.fromOpenFoodFacts({ sugars_100g: 0 }, '100g').sugarG, 0, 'a listed zero is kept');
});

// MARK: - display

test('an entry line names only what is known, multiplied by servings', () => {
  assert.equal(N.entryLine({ servings: 2, saturatedFatG: 1.55, sodiumMg: 700 }),
    `Sat fat 3.1 g · Sodium ${(1400).toLocaleString()} mg`);
  assert.equal(N.entryLine({ servings: 1, calories: 50 }), '');
});

test('day rows say what they cover when it is not every food', () => {
  const rows = N.dayRows([
    { servings: 1, sodiumMg: 1000, sugarG: 5 },
    { servings: 1, sodiumMg: 840, sugarG: 3 },
    { servings: 1, sugarG: 1 },
  ]);
  assert.deepEqual(rows, [
    { label: 'Sugar', value: '9 g' },
    { label: 'Sodium', value: `${(1840).toLocaleString()} mg · from 2 of 3 foods` },
  ]);
  assert.deepEqual(N.dayRows([{ servings: 1, calories: 10 }]), [], 'nothing known, no rows');
});

test('a form field reads blank as null, never zero', () => {
  assert.equal(N.parseField(''), null);
  assert.equal(N.parseField('  '), null);
  assert.equal(N.parseField('abc'), null);
  assert.equal(N.parseField('-2'), null);
  assert.equal(N.parseField('0'), 0);
  assert.equal(N.parseField('2.5'), 2.5);
});

test('assign writes the known fields and removes the rest', () => {
  const target = { calories: 1, sugarG: 9, sodiumMg: 5 };
  N.assign(target, { saturatedFatG: 0, sugarG: null });
  assert.deepEqual(target, { calories: 1, saturatedFatG: 0 });
});
