import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';

// Loaded the way the browser loads it, like food-amount.test.mjs does.
const shim = { window: {} };
new Function('window', readFileSync('lift/backup.js', 'utf8')).call(shim, shim.window);
const LiftBackup = shim.window.LiftBackup;

// MARK: - Rule 1: ids compare case-insensitively

test('an id spelled in the other case is the same record', () => {
  // iOS writes upper case; the browser generates lower case.
  const food = [{ id: '8e1c4c2a-0000-4000-8000-000000000001', name: 'Oats' }];
  const added = LiftBackup.addMissing(food, [{ id: '8E1C4C2A-0000-4000-8000-000000000001', name: 'Oats' }]);
  assert.equal(added, 0);
  assert.equal(food.length, 1, 'a phone round trip must not duplicate the entry');
});

test('a genuinely new record is added', () => {
  const food = [{ id: 'a' }];
  assert.equal(LiftBackup.addMissing(food, [{ id: 'b' }]), 1);
  assert.deepEqual(food.map((e) => e.id), ['a', 'b']);
});

test('a file listing the same record twice adds it once', () => {
  const food = [];
  assert.equal(LiftBackup.addMissing(food, [{ id: 'X1' }, { id: 'x1' }]), 1);
});

test('a record with no id is not restored', () => {
  const food = [];
  assert.equal(LiftBackup.addMissing(food, [{ name: 'orphan' }, { id: '' }, null]), 0);
});

test('restoring never overwrites what the device already has', () => {
  const recipes = [{ id: 'r1', name: 'Newer, edited here' }];
  LiftBackup.addMissing(recipes, [{ id: 'R1', name: 'Older, from the file' }]);
  assert.equal(recipes[0].name, 'Newer, edited here');
});

// MARK: - Rule 3: a meal needs its recipe

test('a planned meal keeps its recipe when the recipe arrives in the same file', () => {
  const recipes = [];
  const plan = [];
  LiftBackup.addMissing(recipes, [{ id: 'R1', name: 'Chilli' }]);
  const added = LiftBackup.addMissingPlan(plan, [{ id: 'm1', recipeId: 'r1' }], recipes);
  assert.equal(added, 1, 'recipeId matches the recipe case-insensitively');
});

test('a planned meal whose recipe exists nowhere is skipped', () => {
  const plan = [];
  const added = LiftBackup.addMissingPlan(plan, [{ id: 'm1', recipeId: 'gone' }], [{ id: 'r1' }]);
  assert.equal(added, 0);
  assert.equal(plan.length, 0);
});

// MARK: - Rule 2: unknown sections survive

test('a section this build does not store is kept', () => {
  const unknown = LiftBackup.unknownSections({ food: [], recipes: [], swims: [{ id: 'x' }] });
  assert.deepEqual(unknown, { swims: [{ id: 'x' }] });
});

test('shopping ticks are never preserved or written', () => {
  assert.deepEqual(LiftBackup.unknownSections({ shopping: ['beef'] }), {});
  const data = LiftBackup.buildData({}, { shopping: ['beef'] });
  assert.equal('shopping' in data, false);
});

test('a preserved section goes back out unchanged', () => {
  const data = LiftBackup.buildData({ food: [] }, { swims: [{ id: 'x', laps: 3 }] });
  assert.deepEqual(data.swims, [{ id: 'x', laps: 3 }]);
});

test('a preserved section can never overwrite one this build stores', () => {
  // A stale copy of `recipes` sitting in the preserved bag must lose to the
  // device's own recipes, or saving would roll the library back.
  const data = LiftBackup.buildData({ recipes: [{ id: 'mine' }] }, { recipes: [{ id: 'stale' }] });
  assert.deepEqual(data.recipes, [{ id: 'mine' }]);
});

test('recipes and the plan are written', () => {
  const data = LiftBackup.buildData({ recipes: [{ id: 'r' }], plan: [{ id: 'm' }] }, {});
  assert.deepEqual(data.recipes, [{ id: 'r' }]);
  assert.deepEqual(data.plan, [{ id: 'm' }]);
});

// MARK: - Interop with the Android build

// Written by LIFT Android's own BackupStore.build -- never regenerate it here.
const android = JSON.parse(readFileSync('lift/fixtures/android-backup-recipes.json', 'utf8'));

test("Android's recipes and both planned meals restore", () => {
  const recipes = [];
  const plan = [];
  assert.equal(LiftBackup.addMissing(recipes, android.data.recipes), 1);
  assert.equal(LiftBackup.addMissingPlan(plan, android.data.plan, recipes), 2,
    'the servings meal and the gram-based meal both point at the restored recipe');
  assert.equal(recipes[0].totalWeightGrams, 600);
  assert.equal(plan.find((m) => m.amountGrams).amountGrams, 250);
});

test("Android's routines are stored now, not merely preserved", () => {
  // Android writes `routines`. The browser kept them as an unknown section
  // until it had routines of its own.
  assert.deepEqual(Object.keys(LiftBackup.unknownSections(android.data)), []);
  const routines = [];
  LiftBackup.addMissing(routines, android.data.routines);
  assert.equal(routines.length, android.data.routines.length);
});

test('routines and outdoor activities are written', () => {
  const data = LiftBackup.buildData({ routines: [{ id: 'r' }], outdoor: [{ id: 'o' }] }, {});
  assert.deepEqual(data.routines, [{ id: 'r' }]);
  assert.deepEqual(data.outdoor, [{ id: 'o' }]);
});

// MARK: - Interop with the iOS build

// Written by LIFT iOS's own BackupStore.build -- never regenerate it here.
const ios = JSON.parse(readFileSync('lift/fixtures/ios-backup-recipes.json', 'utf8'));

test("iOS's upper-case recipe and meal restore and stay linked", () => {
  const recipes = [];
  const plan = [];
  assert.equal(LiftBackup.addMissing(recipes, ios.data.recipes), 1);
  assert.equal(LiftBackup.addMissingPlan(plan, ios.data.plan, recipes), 1);
  assert.equal(recipes[0].totalWeightGrams, 900);
});

test("the same iOS recipe already on this device in lower case is not duplicated", () => {
  // The round trip that broke before: a browser record, restored on an iPhone,
  // saved there in upper case, and restored back here.
  const iosRecipe = ios.data.recipes[0];
  const recipes = [{ ...iosRecipe, id: iosRecipe.id.toLowerCase() }];
  assert.equal(LiftBackup.addMissing(recipes, ios.data.recipes), 0);
  assert.equal(recipes.length, 1);
});

// MARK: - Rule 4: sugar and sodium from an older iPhone file's ext.ios

const iosFile = JSON.parse(readFileSync('lift/fixtures/ios-backup-nutrients.json', 'utf8'));

test('food takes sugar and sodium from ext.ios when the common field is missing', () => {
  const food = LiftBackup.foodWithIosDetails(iosFile.data.food, iosFile.ext);
  const [granola, juice, egg] = food;
  assert.equal(granola.sugarG, 18.5);
  assert.equal(granola.sodiumMg, 0, 'a recorded zero is a value');
  assert.equal(granola.saturatedFatG, undefined, 'iOS never recorded saturated fat');
  assert.equal(juice.sugarG, 21, 'the common field wins over ext.ios');
  assert.equal(juice.sodiumMg, 2, 'and ext.ios still fills the one that is missing');
  assert.equal('sugarG' in egg, false, 'nothing in either place stays absent');
  assert.equal('sodiumMg' in egg, false);
  assert.equal(iosFile.data.food[0].sugarG, undefined, "the file's own objects are not changed");
});

test('ext.ios ids match case-insensitively', () => {
  const lower = iosFile.data.food.map((e) => ({ ...e, id: e.id.toLowerCase() }));
  assert.equal(LiftBackup.foodWithIosDetails(lower, iosFile.ext)[0].sugarG, 18.5);
});

test('recipes take them into nutritionPerServing, and only when it exists', () => {
  const [soup, stew] = LiftBackup.recipesWithIosDetails(iosFile.data.recipes, iosFile.ext);
  assert.equal(soup.nutritionPerServing.sugarG, 11);
  assert.equal(soup.nutritionPerServing.sodiumMg, 640);
  assert.equal(soup.nutritionPerServing.calories, 120);
  assert.equal(stew.nutritionPerServing, null, 'no macros, nowhere to hold them');
});

test('a file with no ext restores exactly as before', () => {
  const food = [{ id: 'a', calories: 1 }];
  assert.deepEqual(LiftBackup.foodWithIosDetails(food, undefined), food);
  assert.deepEqual(LiftBackup.recipesWithIosDetails([{ id: 'r', nutritionPerServing: { calories: 1 } }], {}),
    [{ id: 'r', nutritionPerServing: { calories: 1 } }]);
});

// MARK: - Sides

// The browser stores a workout in the backup file's own shape, so writing a
// backup and reading one are the same rule: `side: "left" | "right"` on a set,
// omitted when both. See coach/BACKUP-FORMAT.md and lift/sides.js.

const workoutWith = (id, sets) => ({
  id, date: '2026-09-20', name: 'Legs', startedAt: 1,
  exercises: [{ id: `${id}-e`, name: 'Bulgarian Split Squat', equipment: 'Dumbbell', sets }],
});

test('a set keeps its side through a backup, and an unsided one grows no field', () => {
  const stored = {
    workouts: [workoutWith('w1', [
      { id: 's1', weightLb: 60, reps: 8, side: 'left' },
      { id: 's2', weightLb: 60, reps: 8, side: 'right' },
      { id: 's3', weightLb: 135, reps: 5 },
    ])],
  };
  const file = JSON.parse(JSON.stringify({ data: LiftBackup.buildData(stored, {}) }));
  const sets = file.data.workouts[0].exercises[0].sets;
  assert.deepEqual(sets.map((s) => s.side), ['left', 'right', undefined]);
  assert.equal('side' in sets[2], false, 'both is absent, never written out');

  const restored = [];
  LiftBackup.addMissing(restored, file.data.workouts);
  assert.deepEqual(restored[0].exercises[0].sets.map((s) => s.side), ['left', 'right', undefined]);
});

test('a backup written before sides existed restores with none, and is not rewritten', () => {
  const old = workoutWith('w2', [{ id: 's1', weightLb: 225, reps: 3 }]);
  const restored = [];
  assert.equal(LiftBackup.addMissing(restored, [old]), 1);
  const set = restored[0].exercises[0].sets[0];
  assert.equal('side' in set, false);
  assert.deepEqual(Object.keys(set), ['id', 'weightLb', 'reps']);
});
