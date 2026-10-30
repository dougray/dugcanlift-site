import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';

// A recipe's fiber is unknown when nobody stated it, never 0 g: LIFT iPhone's
// `NutritionFacts.fiberG` rule, and LIFT Android's since kit-android 1.10.0.
// A typed 0 is a figure, and so is every 0 an earlier build saved -- nobody can
// tell now which of those were unknown, so they keep meaning what they said.
//
// Loaded the way the browser loads them. Run from the repo root.
const shim = { window: {} };
new Function('window', readFileSync('lift/nutrients.js', 'utf8')).call(shim, shim.window);
new Function('window', readFileSync('lift/recipe-catalog.js', 'utf8')).call(shim, shim.window);
const N = shim.window.LiftNutrients;
const C = shim.window.LiftRecipeCatalog;
const { parseFoodProduct, foodContribution } = new Function('fetch', 'LiftNutrients',
  readFileSync('lift/foods.js', 'utf8') + '\nreturn { parseFoodProduct, foodContribution };')(null, N);

// ---- the recipe form ----

test('a blank fiber field saves no fiberG key', () => {
  const saved = N.recipeNutrition([420, 30, 40, 12, null]);
  assert.deepEqual(saved, { calories: 420, proteinG: 30, carbsG: 40, fatG: 12 });
  // A backup writes the recipe as JSON: unknown is no key there either.
  assert.equal(JSON.stringify(saved).includes('fiberG'), false);
});

test('a typed 0 is kept as 0, and a figure as itself', () => {
  assert.equal(N.recipeNutrition([420, 30, 40, 12, 0]).fiberG, 0);
  assert.equal(N.recipeNutrition([420, 30, 40, 12, 7.5]).fiberG, 7.5);
});

test('a blank form is still no nutrition, and fiber alone is some', () => {
  assert.equal(N.recipeNutrition([null, null, null, null, null]), null);
  assert.deepEqual(N.recipeNutrition([null, null, null, null, 7]),
    { calories: 0, proteinG: 0, carbsG: 0, fatG: 0, fiberG: 7 });
});

test('a junk or negative fiber figure is not a reading', () => {
  assert.equal('fiberG' in N.recipeNutrition([420, 30, 40, 12, NaN]), false);
  assert.equal('fiberG' in N.recipeNutrition([420, 30, 40, 12, -3]), false);
});

test('unknown fiber reopens blank; a stored figure, 0 included, reopens as itself', () => {
  assert.equal(N.storedFiber({ calories: 420, proteinG: 30, carbsG: 40, fatG: 12 }), null);
  assert.equal(N.storedFiber({ calories: 420, fiberG: null }), null);
  assert.equal(N.storedFiber(null), null);
  assert.equal(N.storedFiber({ calories: 420, fiberG: 6 }), 6);
  assert.equal(N.storedFiber({ calories: 420, fiberG: 0 }), 0);
});

test('a recipe an earlier build saved keeps its 0 through reopening and saving unchanged', () => {
  const old = { calories: 420, proteinG: 30, carbsG: 40, fatG: 12, fiberG: 0 };
  assert.deepEqual(N.recipeNutrition([420, 30, 40, 12, N.storedFiber(old)]), old);
});

test('the form\'s Save goes through recipeNutrition, and the editor through storedFiber', () => {
  const src = readFileSync('lift/app.js', 'utf8');
  assert.ok(src.includes('const nutrition = LiftNutrients.recipeNutrition(typed);'));
  assert.ok(src.includes('const fiber = LiftNutrients.storedFiber(n);'));
  assert.equal(src.includes('typed[4] || 0'), false, 'a blank fiber field must not save as 0');
  assert.equal(src.includes('raw.u[4] || 0'), false, 'a plan must not turn a missing u[4] into 0');
});

// ---- the catalog ----

test('a catalog copy states no fiber', () => {
  const raw = JSON.parse(readFileSync('lift/recipes.json', 'utf8'));
  const r = C.parse(raw).find((x) => x.id === 'unitools:spaghetti-carbonara');
  const n = C.libraryFields(r, 2).nutritionPerServing;
  assert.equal('fiberG' in n, false);
  assert.equal(N.storedFiber(n), null, 'and so opens blank in the editor');
});

// ---- a plan link's u ----

test('u[4] is taken as sent, 0 included', () => {
  assert.deepEqual(N.planNutrition([320, 12, 52, 8, 7]), { calories: 320, proteinG: 12, carbsG: 52, fatG: 8, fiberG: 7 });
  // Every Coach build sends 0 for unknown fiber; a receiver cannot tell it from a stated 0.
  assert.equal(N.planNutrition([320, 12, 52, 8, 0]).fiberG, 0);
});

test('a u with no number at 4 has unknown fiber, not 0 g', () => {
  assert.equal('fiberG' in N.planNutrition([320, 12, 52, 8]), false);
  assert.equal('fiberG' in N.planNutrition([320, 12, 52, 8, null]), false);
  assert.equal('fiberG' in N.planNutrition([320, 12, 52, 8, '7']), false);
});

test('no u is no nutrition', () => {
  assert.equal(N.planNutrition(undefined), null);
  assert.equal(N.planNutrition(null), null);
});

// ---- ingredient lookups ----

const product = (nutriments) => ({ product_name: 'Oat drink', nutriments });

test('a packaged food that lists no fiber contributes none, not 0 g', () => {
  const hit = parseFoodProduct(product({ 'energy-kcal_100g': 45, proteins_100g: 1, fat_100g: 1.5, carbohydrates_100g: 6.6 }));
  assert.equal(hit.unit.fiberG, null);
  assert.equal(foodContribution(hit, 250).fiberG, null);
  const perServing = parseFoodProduct(product({ 'energy-kcal_serving': 120 }));
  assert.equal(foodContribution(perServing, 2).fiberG, null);
});

test('a packaged food that lists fiber contributes it, a listed 0 included', () => {
  const hit = parseFoodProduct(product({ 'energy-kcal_100g': 45, fiber_100g: 0.8 }));
  assert.ok(Math.abs(foodContribution(hit, 250).fiberG - 2) < 1e-9);
  assert.equal(foodContribution(parseFoodProduct(product({ 'energy-kcal_100g': 45, fiber_100g: 0 })), 250).fiberG, 0);
});
