import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';

// A recipe's fiber is unknown when nobody stated it, never 0 g: Coach iPhone's
// `NutritionFacts.fiberG` rule, and Coach Android's since kit-android 1.10.0.
// A typed 0 is a figure, and so is every 0 an earlier build saved -- nobody can
// tell now which of those were unknown, so they keep meaning what they said.
//
// Loaded the way the browser loads them. Run from the repo root.
const shim = { window: {} };
new Function('window', readFileSync('coach/nutrients.js', 'utf8')).call(shim, shim.window);
new Function('window', readFileSync('coach/recipe-nutrition.js', 'utf8')).call(shim, shim.window);
const { mergeNutrition, storedFiber, planRecipe, hasMacros, cardMacroLine } = shim.window.CoachRecipeNutrition;
const { row } = shim.window.CoachNutrients;
const { parseFoodProduct, foodContribution } = new Function('CoachNutrients',
  readFileSync('coach/foods.js', 'utf8') + '\nreturn { parseFoodProduct, foodContribution };')(shim.window.CoachNutrients);

// ---- saving the form ----

test('a blank fiber field saves no fiberG key', () => {
  const saved = mergeNutrition([420, 30, 40, 12, null], null);
  assert.deepEqual(saved, { calories: 420, proteinG: 30, carbsG: 40, fatG: 12 });
  // A backup is the recipes array as JSON: unknown is no key there either.
  assert.equal(JSON.stringify(saved).includes('fiberG'), false);
});

test('a typed 0 is kept as 0', () => {
  assert.equal(mergeNutrition([420, 30, 40, 12, 0], null).fiberG, 0);
});

test('a typed figure is kept', () => {
  assert.equal(mergeNutrition([420, 30, 40, 12, 7.5], null).fiberG, 7.5);
});

test('clearing the field on a recipe that had fiber makes it unknown', () => {
  const saved = mergeNutrition([420, 30, 40, 12, null], { calories: 420, proteinG: 30, carbsG: 40, fatG: 12, fiberG: 6 });
  assert.equal('fiberG' in saved, false);
});

test('a recipe an earlier build saved keeps its 0 through reopening and saving unchanged', () => {
  const old = { calories: 420, proteinG: 30, carbsG: 40, fatG: 12, fiberG: 0 };
  const reopened = storedFiber(old);
  assert.equal(reopened, 0, 'a stored zero reopens as 0, not blank');
  assert.deepEqual(mergeNutrition([420, 30, 40, 12, reopened], old), old);
});

test('an imported recipe with no fiber saves none', () => {
  // recipe-import.js leaves fiberG null when the page states none, and Save
  // passes that nutrition through the merge as the existing figures.
  const page = { calories: 350, proteinG: 20, carbsG: 40, fatG: 12, fiberG: null, saturatedFatG: null, sugarG: 9, sodiumMg: 480 };
  const saved = mergeNutrition([350, 20, 40, 12, storedFiber(page)], page,
    { saturatedFatG: null, sugarG: 9, sodiumMg: 480 });
  assert.equal('fiberG' in saved, false);
  assert.equal(saved.sugarG, 9);
});

test('fiber alone is still nutrition', () => {
  const saved = mergeNutrition([null, null, null, null, 7], null);
  assert.deepEqual(saved, { calories: 0, proteinG: 0, carbsG: 0, fatG: 0, fiberG: 7 });
  assert.equal(hasMacros(saved), true);
});

test('a junk or negative fiber figure is not a reading', () => {
  assert.equal('fiberG' in mergeNutrition([420, 30, 40, 12, NaN], null), false);
  assert.equal('fiberG' in mergeNutrition([420, 30, 40, 12, -3], null), false);
});

// ---- reopening the form ----

test('unknown fiber reopens blank, absent or null', () => {
  assert.equal(storedFiber({ calories: 420, proteinG: 30, carbsG: 40, fatG: 12 }), null);
  assert.equal(storedFiber({ calories: 420, proteinG: 30, carbsG: 40, fatG: 12, fiberG: null }), null);
  assert.equal(storedFiber(null), null);
});

test('a stated figure reopens as itself', () => {
  assert.equal(storedFiber({ calories: 420, proteinG: 30, carbsG: 40, fatG: 12, fiberG: 6 }), 6);
});

test('placeholder macros on a sodium-only recipe reopen fiber blank', () => {
  assert.equal(storedFiber({ calories: 0, proteinG: 0, carbsG: 0, fatG: 0, fiberG: 0, sodiumMg: 480 }), null);
  assert.equal(storedFiber({ calories: 0, proteinG: 0, carbsG: 0, fatG: 0, sodiumMg: 480 }), null);
});

// ---- on screen and on the wire ----

test('the card line never shows fiber, so unknown cannot read as 0 g or NaN', () => {
  // Coach iPhone's CookView.macroLine and Coach Android's card show the four
  // macros only, and so does this one.
  const line = cardMacroLine({ calories: 420, proteinG: 30, carbsG: 40, fatG: 12 }, String);
  assert.equal(line, '420 kcal  P 30  C 40  F 12');
});

test('a plan link sends unknown fiber as 0, the only number u can hold', () => {
  const recipe = (n) => ({ name: 'Oats', servings: 2, nutritionPerServing: n, ingredients: [], steps: [] });
  assert.deepEqual(planRecipe(recipe({ calories: 320, proteinG: 12, carbsG: 52, fatG: 8 }), row).u, [320, 12, 52, 8, 0]);
  assert.deepEqual(planRecipe(recipe({ calories: 320, proteinG: 12, carbsG: 52, fatG: 8, fiberG: null }), row).u, [320, 12, 52, 8, 0]);
  assert.deepEqual(planRecipe(recipe({ calories: 320, proteinG: 12, carbsG: 52, fatG: 8, fiberG: 7 }), row).u, [320, 12, 52, 8, 7]);
});

// ---- ingredient lookups ----

const product = (nutriments) => ({ product_name: 'Oat drink', nutriments });

test('a packaged food that lists no fiber contributes none, not 0 g', () => {
  const hit = parseFoodProduct(product({ 'energy-kcal_100g': 45, proteins_100g: 1, fat_100g: 1.5, carbohydrates_100g: 6.6 }));
  assert.equal(hit.unit.fiberG, null);
  assert.equal(foodContribution(hit, 250).fiberG, null);
});

test('a packaged food that lists fiber contributes it, a listed 0 included', () => {
  const hit = parseFoodProduct(product({ 'energy-kcal_100g': 45, fiber_100g: 0.8 }));
  assert.ok(Math.abs(foodContribution(hit, 250).fiberG - 2) < 1e-9);
  const none = parseFoodProduct(product({ 'energy-kcal_100g': 45, fiber_100g: 0 }));
  assert.equal(foodContribution(none, 250).fiberG, 0);
});

test('a per-serving product without fiber contributes none either', () => {
  const hit = parseFoodProduct(product({ 'energy-kcal_serving': 120, proteins_serving: 3 }));
  assert.equal(hit.per, 'serving');
  assert.equal(foodContribution(hit, 2).fiberG, null);
});
