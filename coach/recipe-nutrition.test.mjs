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

// ---- saturated fat, sugar and sodium as form fields ----

new Function('window', readFileSync('coach/nutrients.js', 'utf8')).call(shim, shim.window);
const { hasMacros, planRecipe } = shim.window.CoachRecipeNutrition;
const { row } = shim.window.CoachNutrients;

test('the three form fields win over what the recipe held', () => {
  const saved = mergeNutrition([350, 20, 40, 12, 3], imported,
    { saturatedFatG: 4.5, sugarG: null, sodiumMg: 520 });
  assert.deepEqual(saved, {
    calories: 350, proteinG: 20, carbsG: 40, fatG: 12, fiberG: 3,
    saturatedFatG: 4.5, sodiumMg: 520,
  });
  assert.equal('sugarG' in saved, false, 'a cleared field is unknown, not zero');
});

test('other unknown keys still ride along when the three are shown', () => {
  const saved = mergeNutrition([100, 1, 2, 3, null], { calories: 90, potassiumMg: 300, sugarG: 2 },
    { saturatedFatG: null, sugarG: 2, sodiumMg: null });
  assert.equal(saved.potassiumMg, 300);
  assert.equal(saved.sugarG, 2);
});

test('only sodium entered keeps the sodium, with placeholder macros', () => {
  const saved = mergeNutrition([null, null, null, null, null], null,
    { saturatedFatG: null, sugarG: null, sodiumMg: 480 });
  assert.deepEqual(saved, { calories: 0, proteinG: 0, carbsG: 0, fatG: 0, fiberG: 0, sodiumMg: 480 });
  assert.equal(hasMacros(saved), false);
});

test('everything blank, the three included, is still no nutrition', () => {
  assert.equal(mergeNutrition([null, null, null, null, null], imported,
    { saturatedFatG: null, sugarG: null, sodiumMg: null }), null);
});

test('a typed zero for sugar is kept', () => {
  assert.equal(mergeNutrition([100, 0, 0, 0, 0], null, { saturatedFatG: null, sugarG: 0, sodiumMg: null }).sugarG, 0);
});

// ---- PLAN-FORMAT inline recipe: u and ux ----

const recipe = (nutritionPerServing) => ({
  name: 'Chilli', servings: 4, nutritionPerServing,
  ingredients: [{ rawText: '500 g beef' }], steps: ['Cook'],
});

test('ux is written per serving, rounded, trailing nulls trimmed', () => {
  const r = planRecipe(recipe({ calories: 420, proteinG: 30, carbsG: 35, fatG: 14, fiberG: 6,
    saturatedFatG: 5.26, sugarG: 7, sodiumMg: 612.5 }), row);
  assert.deepEqual(r, { n: 'Chilli', s: 4, u: [420, 30, 35, 14, 6], ux: [5.3, 7, 613], i: ['500 g beef'], t: ['Cook'] });
  assert.deepEqual(planRecipe(recipe({ calories: 1, proteinG: 0, carbsG: 0, fatG: 0, fiberG: 0, sugarG: 3 }), row).ux, [null, 3]);
});

test('ux is omitted when none of the three is known', () => {
  const r = planRecipe(recipe({ calories: 420, proteinG: 30, carbsG: 35, fatG: 14, fiberG: 0, sugarG: null }), row);
  assert.equal('ux' in r, false);
  assert.equal('ux' in planRecipe(recipe(null), row), false);
});

test('u is never sent as zeros', () => {
  const sodiumOnly = planRecipe(recipe({ calories: 0, proteinG: 0, carbsG: 0, fatG: 0, fiberG: 0, sodiumMg: 480 }), row);
  assert.equal('u' in sodiumOnly, false);
  assert.deepEqual(sodiumOnly.ux, [null, null, 480]);
  assert.equal('u' in planRecipe(recipe(null), row), false);
  assert.deepEqual(planRecipe(recipe({ calories: 200, proteinG: 10, carbsG: 20, fatG: 5 }), row).u, [200, 10, 20, 5, 0],
    'a missing fibre is sent as 0 beside real macros, as before');
});

// ---- the estimated mark: Coach iPhone's two lines ----

const { cardMacroLine, estimatedNote, isEstimated } = shim.window.CoachRecipeNutrition;
const trimNum = (v) => (Number.isInteger(v) ? String(v) : String(Math.round(v * 100) / 100));
const macros = { calories: 450, proteinG: 30.25, carbsG: 40, fatG: 12, fiberG: 0 };

test('an estimated recipe\'s card ends " · estimated", as Coach iPhone\'s does', () => {
  assert.equal(cardMacroLine({ ...macros, estimated: true }, trimNum),
    '450 kcal  P 30.25  C 40  F 12 · estimated');
});

test('a card without the flag reads as it did', () => {
  assert.equal(cardMacroLine(macros, trimNum), '450 kcal  P 30.25  C 40  F 12');
  assert.equal(cardMacroLine({ ...macros, estimated: false }, trimNum), '450 kcal  P 30.25  C 40  F 12');
  assert.equal(cardMacroLine({ ...macros, estimated: 'true' }, trimNum), '450 kcal  P 30.25  C 40  F 12',
    'only a literal true');
});

test('no macros is "Macros not set", estimated or not', () => {
  assert.equal(cardMacroLine(null, trimNum), 'Macros not set');
  assert.equal(cardMacroLine({ calories: 0, proteinG: 0, carbsG: 0, fatG: 0, fiberG: 0, sodiumMg: 480, estimated: true },
    trimNum), 'Macros not set');
});

test('an estimated recipe\'s editor says Coach iPhone\'s sentence, with the source\'s note', () => {
  const r = {
    name: 'Beef Pot Pie', nutritionPerServing: { ...macros, estimated: true },
    sourceTranscript: 'UniTools — theunitools.com\nCC BY-SA 4.0\nCosted from 6 of 9 lines',
  };
  assert.deepEqual(estimatedNote(r), {
    note: 'Estimated from an import — check these before sending.',
    source: 'UniTools — theunitools.com\nCC BY-SA 4.0\nCosted from 6 of 9 lines',
  });
  assert.deepEqual(estimatedNote({ ...r, sourceTranscript: '' }),
    { note: 'Estimated from an import — check these before sending.', source: null });
  assert.deepEqual(estimatedNote({ ...r, sourceTranscript: undefined }),
    { note: 'Estimated from an import — check these before sending.', source: null });
});

test('an editor for a recipe without the flag shows nothing new', () => {
  assert.equal(estimatedNote({ name: 'Oats', nutritionPerServing: macros, sourceTranscript: 'a note' }), null);
  assert.equal(estimatedNote({ name: 'Oats', nutritionPerServing: { ...macros, estimated: false } }), null);
  assert.equal(estimatedNote({ name: 'Oats', nutritionPerServing: null }), null);
  assert.equal(estimatedNote(null), null, 'a new recipe');
  assert.equal(isEstimated(undefined), false);
});

test('the flag survives a save, so the lines survive it too', () => {
  const saved = mergeNutrition([400, 30, 40, 12, null], { ...macros, estimated: true });
  assert.equal(isEstimated(saved), true);
});
