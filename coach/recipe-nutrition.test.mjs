import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';

// Loaded the way the browser loads it. Run from the repo root: node --test coach/
const shim = { window: {} };
new Function('window', readFileSync('coach/recipe-nutrition.js', 'utf8')).call(shim, shim.window);
const { mergeNutrition } = shim.window.CoachRecipeNutrition;

const imported = {
  calories: 350, proteinG: 20, carbsG: 40, fatG: 12, fiberG: 3,
  sugarG: 9, sodiumMg: 480,
};

test('an unchanged save keeps sugar and sodium', () => {
  assert.deepEqual(mergeNutrition([350, 20, 40, 12, 3], imported), imported);
});

test('changing the five shown macros still carries the extras', () => {
  const saved = mergeNutrition([400, 25, 45, 10, 4], imported);
  assert.deepEqual(saved, {
    calories: 400, proteinG: 25, carbsG: 45, fatG: 10, fiberG: 4,
    sugarG: 9, sodiumMg: 480,
  });
});

test('unknown keys from another app survive too', () => {
  const saved = mergeNutrition([100, 1, 2, 3, null], { calories: 90, saturatedFatG: 1.5 });
  assert.equal(saved.saturatedFatG, 1.5);
  assert.equal(saved.calories, 100);
});

test('the form wins for the keys it shows', () => {
  const saved = mergeNutrition([100, null, null, null, null], imported);
  assert.equal(saved.proteinG, 0);
  assert.equal(saved.fiberG, 0);
});

test('a blank form still means no nutrition', () => {
  assert.equal(mergeNutrition([null, null, null, null, null], imported), null);
});

test('a new recipe has no extras to carry', () => {
  assert.deepEqual(mergeNutrition([200, 10, 20, 5, null], null),
    { calories: 200, proteinG: 10, carbsG: 20, fatG: 5, fiberG: 0 });
});

test('the existing object is not mutated', () => {
  const before = JSON.stringify(imported);
  mergeNutrition([1, 2, 3, 4, 5], imported);
  assert.equal(JSON.stringify(imported), before);
});
