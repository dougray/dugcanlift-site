import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';

// Loaded the way the browser loads it. Run from the repo root: node --test coach/
const shim = { window: {} };
new Function('window', readFileSync('coach/nutrients.js', 'utf8')).call(shim, shim.window);
const N = shim.window.CoachNutrients;
const US = 'en-US';

// ---- fx and fe, read off the wire ----

test('fx is stored exactly as sent, with its coverage counts', () => {
  assert.deepEqual(N.readDayTotals([21.5, 48, 2310, 6, 4, 5, 6]), {
    saturatedFatG: 21.5, sugarG: 48, sodiumMg: 2310,
    foods: 6, withSaturatedFat: 4, withSugar: 5, withSodium: 6,
  });
});

test('a null total stays null, and fx with nothing known is no totals', () => {
  const t = N.readDayTotals([null, null, 540, 3, 0, 0, 1]);
  assert.equal(t.saturatedFatG, null);
  assert.equal(t.sugarG, null);
  assert.equal(t.sodiumMg, 540);
  assert.equal(N.readDayTotals([null, null, null, 3, 0, 0, 0]), null);
  assert.equal(N.readDayTotals(undefined), null, 'an older link has no fx');
  assert.equal(N.readDayTotals('x'), null);
  assert.equal(N.readDayTotals([-1, 'lots', 5, 1, 0, 0, 1]).sugarG, null, 'unreadable is unknown, never zero');
});

test('a recorded zero is a value, not a gap', () => {
  assert.equal(N.readDayTotals([0, null, null, 1, 1, 0, 0]).saturatedFatG, 0);
  assert.deepEqual(N.parseRow([0]), { saturatedFatG: 0, sugarG: null, sodiumMg: null });
});

test('fe entries: short tuples mean trailing nulls, a leading null holds its slot', () => {
  assert.deepEqual(N.parseRow([null, 12]), { saturatedFatG: null, sugarG: 12, sodiumMg: null });
  assert.deepEqual(N.parseRow([3.1, 2, 540, 99]), { saturatedFatG: 3.1, sugarG: 2, sodiumMg: 540 });
  assert.equal(N.parseRow(null), null);
  assert.equal(N.parseRow([null, null]), null);
  assert.equal(N.parseRow([1, 'x', 3]), null, 'a bad slot makes the whole tuple unreadable');
});

test('fe is read only when it lines up with f', () => {
  assert.deepEqual(N.readItems([[1], null], 2), [{ saturatedFatG: 1, sugarG: null, sodiumMg: null }, null]);
  assert.equal(N.readItems([[1]], 2), null, 'a misaligned fe cannot say which food a value is on');
  assert.equal(N.readItems(undefined, 2), null);
});

test('assign writes the known three and never a null or a zero it did not have', () => {
  const entry = N.assign({ name: 'x', sodiumMg: 9 }, { saturatedFatG: null, sugarG: 0, sodiumMg: null });
  assert.deepEqual(entry, { name: 'x', sugarG: 0 });
});

// ---- ux ----

test('ux rounds grams to one decimal and sodium whole, half-up, trimming only trailing nulls', () => {
  assert.deepEqual(N.row({ saturatedFatG: 3.05, sugarG: 11.96, sodiumMg: 539.5 }), [3.1, 12, 540]);
  assert.deepEqual(N.row({ sugarG: 12 }), [null, 12]);
  assert.deepEqual(N.row({ saturatedFatG: 2 }), [2]);
  assert.equal(N.row({ calories: 400 }), null);
  assert.equal(N.row(null), null);
});

// ---- Open Food Facts ----

test('Open Food Facts sodium is grams, and salt stands in when sodium is missing', () => {
  assert.deepEqual(N.fromOpenFoodFacts({ 'saturated-fat_100g': '1.2', sugars_100g: 5, sodium_100g: 0.4 }, '100g'),
    { saturatedFatG: 1.2, sugarG: 5, sodiumMg: 400 });
  assert.equal(N.fromOpenFoodFacts({ salt_100g: 1 }, '100g').sodiumMg, 400);
  assert.deepEqual(N.fromOpenFoodFacts({}, 'serving'), { saturatedFatG: null, sugarG: null, sodiumMg: null });
});

// ---- the ingredient tally ----

test('a tallied value fills only when every looked-up ingredient recorded it', () => {
  const t = N.emptyTally();
  N.addToTally(t, { saturatedFatG: 2, sugarG: 1, sodiumMg: 300 });
  N.addToTally(t, { saturatedFatG: 4, sugarG: null, sodiumMg: 500 });
  assert.deepEqual(N.tallyPerServing(t, 4), { saturatedFatG: 1.5, sugarG: null, sodiumMg: 200 });
  assert.deepEqual(N.tallyPerServing(N.emptyTally(), 4), { saturatedFatG: null, sugarG: null, sodiumMg: null });
});

test('a tallied zero is still a value', () => {
  const t = N.addToTally(N.emptyTally(), { saturatedFatG: 0, sugarG: 0, sodiumMg: 0 });
  assert.deepEqual(N.tallyPerServing(t, 0), { saturatedFatG: 0, sugarG: 0, sodiumMg: 0 });
});

test('a form field read back: blank and nonsense are unknown, never zero', () => {
  assert.equal(N.parseField(''), null);
  assert.equal(N.parseField('  '), null);
  assert.equal(N.parseField('-2'), null);
  assert.equal(N.parseField('0'), 0);
  assert.equal(N.parseField('2.5'), 2.5);
});

// ---- display, matching Coach Android's NutrientDisplayTest ----

test('partial coverage says how many foods the total is from', () => {
  const lines = N.dayLines({ saturatedFatG: 21.5, sugarG: 48, sodiumMg: 1840, foods: 5,
    withSaturatedFat: 5, withSugar: 4, withSodium: 3 }, US);
  assert.deepEqual(lines.map((l) => l.text),
    ['Saturated fat 21.5 g', 'Sugar 48 g · from 4 of 5 foods', 'Sodium 1,840 mg · from 3 of 5 foods']);
  assert.deepEqual(lines[2], { label: 'Sodium', value: '1,840 mg · from 3 of 5 foods', text: 'Sodium 1,840 mg · from 3 of 5 foods' });
});

test('an unrecorded nutrient has no line, and no totals has no lines', () => {
  assert.deepEqual(N.dayLines({ saturatedFatG: null, sugarG: null, sodiumMg: 2310, foods: 6,
    withSaturatedFat: 0, withSugar: 0, withSodium: 6 }, US).map((l) => l.text), ['Sodium 2,310 mg']);
  assert.deepEqual(N.dayLines(null), []);
  assert.deepEqual(N.dayLines(undefined), []);
});

test('amounts round grams to one decimal and sodium to whole grouped milligrams', () => {
  assert.equal(N.amountText('sugarG', 0.05, US), '0.1 g');
  assert.equal(N.amountText('saturatedFatG', 11.96, US), '12 g');
  assert.equal(N.amountText('sodiumMg', 999.5, US), '1,000 mg');
  assert.equal(N.amountText('sodiumMg', 0, US), '0 mg');
});

test('an average always says how many days it is over', () => {
  assert.equal(N.averageLine({ field: 'sodiumMg', perDay: 2105.25, days: 4, partialDays: 0 }, US).text,
    'Sodium 2,105 mg a day · 4 days');
  assert.equal(N.averageLine({ field: 'sugarG', perDay: 30.5, days: 1, partialDays: 0 }, US).text,
    'Sugar 30.5 g a day · 1 day');
  assert.equal(N.averageLine({ field: 'saturatedFatG', perDay: 18.26, days: 3, partialDays: 1 }, US).text,
    'Saturated fat 18.3 g a day · 3 days, 1 from only some foods');
});

// ---- averages, matching Coach Android's NutrientAveragesTest ----

const totals = (s, g, na, foods, ws, wg, wn) => ({ saturatedFatG: s, sugarG: g, sodiumMg: na,
  foods, withSaturatedFat: ws, withSugar: wg, withSodium: wn });

test('averages count only days that recorded the nutrient', () => {
  const byField = Object.fromEntries(N.averages([
    totals(10, null, 2000, 4, 4, 0, 4),
    totals(null, 30, 1000, 3, 0, 3, 2),
    undefined, // a day with nothing of the three: not a zero-sodium day
  ]).map((a) => [a.field, a]));
  assert.deepEqual(byField.sodiumMg, { field: 'sodiumMg', perDay: 1500, days: 2, partialDays: 1 });
  assert.deepEqual(byField.saturatedFatG, { field: 'saturatedFatG', perDay: 10, days: 1, partialDays: 0 });
  assert.equal(byField.sugarG.perDay, 30);
});

test('nothing recorded is no average at all', () => {
  assert.deepEqual(N.averages([undefined, null]), []);
  assert.deepEqual(N.averages([]), []);
});

test("a food's line is as eaten: per serving times servings", () => {
  assert.equal(N.foodLine({ servings: 2, saturatedFatG: 1.04, sodiumMg: 74 }, US), 'Sat fat 2.1 g · Sodium 148 mg');
  assert.equal(N.foodLine({ servings: 1, calories: 200 }, US), '');
  assert.equal(N.foodLine(null), '');
});
