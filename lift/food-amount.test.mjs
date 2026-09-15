import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';

// Loaded the way the browser loads it, like watch-scan.test.mjs does.
const shim = { window: {} };
new Function('window', readFileSync('lift/food-amount.js', 'utf8')).call(shim, shim.window);
const FoodAmount = shim.window.FoodAmount;

const chicken = { calories: 125, proteinG: 22, fatG: 4, carbsG: 0, fiberG: 0 };

test('a chicken breast logged by weight', () => {
  // The entry from Doug's report: Tyson breast, 125 kcal / 22 P per 100 g.
  // 175 g of it is the thing the browser could not express without baking
  // "per 100 g" into the food's own name.
  assert.deepEqual(FoodAmount.scaleFrom100g(chicken, 175),
    { calories: 219, proteinG: 39, fatG: 7, carbsG: 0, fiberG: 0 });
});

test('100 g is the macros unchanged', () => {
  assert.deepEqual(FoodAmount.scaleFrom100g(chicken, 100), chicken);
});

test('rounding happens once, at the end', () => {
  // Rounding per-gram first and multiplying after gives 21 protein here.
  // A few grams per entry is a few hundred calories across a week.
  assert.equal(FoodAmount.scaleFrom100g(chicken, 95).proteinG, 21);
  assert.equal(FoodAmount.scaleFrom100g({ calories: 0, proteinG: 1, fatG: 0, carbsG: 0, fiberG: 0 }, 1550).proteinG, 16);
});

test('an amount that is not a positive number is refused, not zeroed', () => {
  // A zero nobody entered is worse than no entry at all.
  for (const bad of [0, -5, NaN, Infinity, undefined]) {
    assert.equal(FoodAmount.scaleFrom100g(chicken, bad), null, `grams=${bad}`);
  }
  assert.equal(FoodAmount.scaleFrom100g(null, 100), null);
});

test('a missing macro counts as zero rather than NaN', () => {
  const partial = { calories: 200 };
  assert.deepEqual(FoodAmount.scaleFrom100g(partial, 50),
    { calories: 100, proteinG: 0, fatG: 0, carbsG: 0, fiberG: 0 });
});

test('every field the app totals is scaled', () => {
  // If a macro is ever added to the log and not to FIELDS, it silently
  // stays at its per-100 g value on every weighed entry.
  assert.deepEqual(FoodAmount.FIELDS,
    ['calories', 'proteinG', 'fatG', 'carbsG', 'fiberG']);
});

test('ounces convert on the same factor the native apps use', () => {
  assert.equal(FoodAmount.GRAMS_PER_OUNCE, 28.3495);
  assert.equal(FoodAmount.UNITS.oz.toGrams(1), 28.3495);
  assert.ok(Math.abs(FoodAmount.UNITS.oz.fromGrams(28.3495) - 1) < 1e-12);
});

test('a weighed entry reads as its weight', () => {
  assert.equal(FoodAmount.amountText({ amountGrams: 175, servings: 1 }, 'g'), '175 g');
  assert.equal(FoodAmount.amountText({ amountGrams: 175, servings: 1 }, 'oz'), '6.2 oz');
});

test('an older serving-based entry keeps its multiplier', () => {
  // There is no honest way to turn a serving into grams after the fact, so
  // these are left alone rather than guessed at.
  assert.equal(FoodAmount.amountText({ servings: 2 }, 'g'), 'x2');
  assert.equal(FoodAmount.amountText({ servings: 1 }, 'g'), '');
  assert.equal(FoodAmount.amountText({ servings: 1.5 }, 'g'), 'x1.5');
});

test('amounts trim to one decimal and never show a trailing zero', () => {
  assert.equal(FoodAmount.trim(175.0), '175');
  assert.equal(FoodAmount.trim(6.17), '6.2');
  assert.equal(FoodAmount.trim(0.04), '0');
});
