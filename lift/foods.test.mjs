import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';

// foods.js is plain globals; run it with the pieces it reaches for supplied.
const shim = { window: {} };
new Function('window', readFileSync('lift/nutrients.js', 'utf8')).call(shim, shim.window);
const json = readFileSync('lift/foods.json', 'utf8');
const fetch = async () => ({ ok: true, json: async () => JSON.parse(json) });
const api = new Function('fetch', 'LiftNutrients',
  readFileSync('lift/foods.js', 'utf8')
  + '\nreturn { loadFoodLibrary, searchFoodLibrary, parseFoodProduct, foodContribution };')(fetch, shim.window.LiftNutrients);

test('foods.json keeps its seven columns and appends three, named', () => {
  const raw = JSON.parse(json);
  assert.equal(raw.basis, 'per 100 g');
  assert.deepEqual(raw.columns.slice(7), ['saturatedFatG', 'sugarG', 'sodiumMg']);
  assert.equal(raw.foods.length, 7793);
  assert.ok(raw.foods.every((r) => r.length === 10));
  // Unknown is null, never a zero: fibre's missing values were written as 0
  // before these columns existed, which is exactly what they must not repeat.
  assert.ok(raw.foods.some((r) => r[8] === null));
  assert.ok(raw.foods.every((r) => r.slice(7).every((v) => v === null || (typeof v === 'number' && v >= 0))));
});

test('a USDA row reads its details per gram, null where USDA has none', async () => {
  await api.loadFoodLibrary();
  const [butter] = api.searchFoodLibrary('butter salted');
  assert.match(butter.name, /^Butter, salted/);
  const raw = JSON.parse(json).foods.find((r) => r[0] === butter.name);
  assert.equal(butter.unit.saturatedFatG, raw[7] / 100);
  assert.equal(butter.unit.sodiumMg, raw[9] / 100);
  const missing = JSON.parse(json).foods.find((r) => r[8] === null && /^[A-Za-z ,]+$/.test(r[0]));
  const [hit] = api.searchFoodLibrary(missing[0], 10000).filter((h) => h.name === missing[0]);
  assert.equal(hit.unit.sugarG, null);
  const c = api.foodContribution(hit, 250);
  assert.equal(c.sugarG, null, 'a gap stays a gap when scaled');
  assert.equal(c.calories, hit.unit.calories * 250);
});

test('a packaged product carries its details on its own basis', () => {
  const per100 = api.parseFoodProduct({ product_name: 'Crisps', nutriments: {
    'energy-kcal_100g': 530, proteins_100g: 6, fat_100g: 32, carbohydrates_100g: 53,
    'saturated-fat_100g': 2.5, salt_100g: 1.5 } });
  assert.equal(per100.per, 'g');
  assert.equal(per100.unit.saturatedFatG, 0.025);
  assert.equal(per100.unit.sodiumMg, 6, '1.5 g salt per 100 g is 600 mg sodium, 6 mg a gram');
  assert.equal(per100.unit.sugarG, null);

  const perServing = api.parseFoodProduct({ product_name: 'Bar', nutriments: {
    'energy-kcal_serving': 200, sugars_serving: 14, sodium_serving: 0.12 } });
  assert.equal(perServing.per, 'serving');
  assert.equal(perServing.unit.sugarG, 14);
  assert.ok(Math.abs(perServing.unit.sodiumMg - 120) < 1e-9);
});
