import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';

// Loaded the way the browser loads them, in index.html's order. Run from the
// repo root: node --test coach/
const shim = { window: {} };
['route.js', 'nutrients.js', 'recipe-nutrition.js', 'share-import.js'].forEach((file) => {
  new Function('window', readFileSync(`coach/${file}`, 'utf8')).call(shim, shim.window);
});
const { expandDay } = shim.window.CoachShareImport;
const { mergeNutrition } = shim.window.CoachRecipeNutrition;
const MEALS = ['Breakfast', 'Lunch', 'Dinner', 'Snack'];

// Built with LIFT web's own LiftNutrients.dayTotals and itemRows -- the
// functions its buildPayload calls -- never with this app's code, or it would
// prove only that Coach agrees with itself. Days: 2026-09-10 itemised with
// partial coverage, 2026-09-12 totals with every food recorded, 2026-09-15
// totals with nothing recorded.
const link = readFileSync('coach/fixtures/nutrient-share-link.txt', 'utf8').trim();
const payload = JSON.parse(inflateRawSync(Buffer.from(link.split('#1z')[1], 'base64url')));
const days = payload.d.map((raw) => expandDay(raw, payload.x, payload.fd, MEALS));

test('an itemised day keeps fx as sent and puts fe on each food, per serving', () => {
  const [day] = days;
  assert.deepEqual(day.nutrientTotals, {
    saturatedFatG: 2.1, sugarG: 12.3, sodiumMg: 689,
    foods: 3, withSaturatedFat: 1, withSugar: 2, withSodium: 2,
  });
  assert.deepEqual(day.food[0], {
    name: 'Chicken breast', servings: 2, calories: 165, proteinG: 31, fatG: 3.6, carbsG: 0, fiberG: 0,
    meal: 'Lunch', saturatedFatG: 1, sugarG: 0, sodiumMg: 74,
  });
  assert.equal(day.food[1].saturatedFatG, undefined, 'a leading null is unknown, and absent');
  assert.equal(day.food[1].sugarG, 12.3);
  assert.equal(day.food[1].sodiumMg, 540);
  assert.deepEqual(Object.keys(day.food[2]).sort(),
    ['calories', 'carbsG', 'fatG', 'fiberG', 'meal', 'name', 'proteinG', 'servings'],
    'a food with none of the three carries none of them');
});

test('a totals-only day keeps its fx, and a day recording nothing has none', () => {
  assert.deepEqual(days[1].nutrientTotals, {
    saturatedFatG: 4.2, sugarG: 9, sodiumMg: 1786,
    foods: 2, withSaturatedFat: 2, withSugar: 2, withSodium: 2,
  });
  assert.equal('nutrientTotals' in days[2], false);
  assert.equal(days[2].foodTotals.calories, 650);
});

test('an older link, with no fx or fe, expands as it always did', () => {
  const day = expandDay({ k: 0, f: [[0, 1, 100, 5, 2, 10, 1, 0]] }, [], ['Toast'], MEALS);
  assert.equal('nutrientTotals' in day, false);
  assert.deepEqual(day.food, [{ name: 'Toast', servings: 1, calories: 100, proteinG: 5, fatG: 2, carbsG: 10, fiberG: 1, meal: 'Breakfast' }]);
  assert.deepEqual(day.foodTotals, { calories: 100, proteinG: 5, fatG: 2, carbsG: 10, fiberG: 1 });
});

test('a stored client from before this change still reads', () => {
  const stored = { days: { '2026-09-01': { foodTotals: { calories: 2000, proteinG: 150, fatG: 60, carbsG: 200, fiberG: 30 },
    food: [{ name: 'Toast', servings: 1, calories: 100, proteinG: 5, fatG: 2, carbsG: 10, fiberG: 1, meal: '' }] } } };
  const N = shim.window.CoachNutrients;
  assert.deepEqual(N.dayLines(stored.days['2026-09-01'].nutrientTotals), []);
  assert.equal(N.foodLine(stored.days['2026-09-01'].food[0]), '');
});

// ---- backups ----
//
// A backup is { v: 2, clients, settings, recipes, plans, workouts, sessions }
// written with JSON.stringify (app.js saveBackup), and a restore copies each
// client's days back (loadBackup). The three survive only if they are plain
// JSON on the stored objects -- this pins that they are.

test('a backup round-trips a client day\'s totals and each food\'s values', () => {
  const client = { id: 'c', days: { '2026-09-10': days[0], '2026-09-12': days[1] } };
  const recipe = { id: 'r', name: 'Chilli', servings: 4,
    nutritionPerServing: mergeNutrition([420, 30, 35, 14, 6], null, { saturatedFatG: 5.3, sugarG: null, sodiumMg: 613 }) };
  const file = JSON.stringify({ v: 2, clients: [client], settings: {}, recipes: [recipe], plans: [], workouts: [], sessions: [] }, null, 1);
  const parsed = JSON.parse(file);

  const restored = { id: 'c', days: {} };
  Object.assign(restored.days, parsed.clients[0].days);
  assert.deepEqual(restored.days, client.days);
  assert.equal(restored.days['2026-09-10'].nutrientTotals.withSodium, 2);
  assert.equal(restored.days['2026-09-10'].food[1].sodiumMg, 540);

  assert.deepEqual(parsed.recipes[0].nutritionPerServing, {
    calories: 420, proteinG: 30, carbsG: 35, fatG: 14, fiberG: 6, saturatedFatG: 5.3, sodiumMg: 613,
  });
  assert.equal('sugarG' in parsed.recipes[0].nutritionPerServing, false, 'unknown is absent, never null or zero');
});
