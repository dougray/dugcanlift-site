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

/* ---------------- editing a logged entry ---------------- */

const logged = {
  id: 'a1', name: 'Chicken', servings: 1, amountGrams: 175,
  calories: 219, proteinG: 39, fatG: 7, carbsG: 0, fiberG: 0,
  date: '2026-09-16', loggedAt: 1, meal: 'LUNCH',
};

test('a weighed entry prefills per 100 g, whole numbers', () => {
  assert.deepEqual(FoodAmount.per100From(logged),
    { calories: 125, proteinG: 22, fatG: 4, carbsG: 0, fiberG: 0 });
  assert.equal(FoodAmount.per100From({ servings: 2, calories: 100 }), null,
    'a serving-based entry has no per-100 g figures');
});

test('saving an untouched weighed entry changes nothing', () => {
  // 219 -> 125 per 100 g -> 219 happens to round-trip. A kilogram of stew
  // stored at 1234 kcal does not: 123.4 shows as 123, and 123 per 100 g is
  // 1230. The stored total must win over the rounded figure on screen.
  const stew = { amountGrams: 1000, calories: 1234, proteinG: 87, fatG: 46, carbsG: 118, fiberG: 19 };
  const shown = FoodAmount.per100From(stew);
  assert.equal(FoodAmount.scaleFrom100g(shown, 1000).calories, 1230, 'the trap is real');
  assert.deepEqual(FoodAmount.editWeighed(stew, shown, 1000),
    { calories: 1234, proteinG: 87, fatG: 46, carbsG: 118, fiberG: 19 });
  assert.deepEqual(FoodAmount.editWeighed(logged, FoodAmount.per100From(logged), 175),
    { calories: 219, proteinG: 39, fatG: 7, carbsG: 0, fiberG: 0 });
});

test('changing only the amount scales the stored totals exactly', () => {
  const shown = FoodAmount.per100From(logged);
  assert.deepEqual(FoodAmount.editWeighed(logged, shown, 350),
    { calories: 438, proteinG: 78, fatG: 14, carbsG: 0, fiberG: 0 });
});

test('a changed macro is read as per 100 g, like the add form', () => {
  const typed = { ...FoodAmount.per100From(logged), proteinG: 30 };
  const out = FoodAmount.editWeighed(logged, typed, 200);
  assert.equal(out.proteinG, 60);
  assert.equal(out.calories, 250, 'untouched calories scale from 219 at 175 g');
});

test('blank stays blank; a cleared value is zero; blank calories refuse', () => {
  const noFibre = { amountGrams: 100, calories: 50, proteinG: 2, fatG: 1, carbsG: 8 };
  const shown = FoodAmount.per100From(noFibre);
  assert.equal(shown.fiberG, null, 'prefills blank, not 0');
  const out = FoodAmount.editWeighed(noFibre, shown, 100);
  assert.equal(out.fiberG, undefined, 'saves absent, not 0');
  assert.equal(FoodAmount.editWeighed(noFibre, { ...shown, fatG: null }, 100).fatG, 0);
  assert.equal(FoodAmount.editWeighed(noFibre, { ...shown, calories: null }, 100), null);
  assert.equal(FoodAmount.editWeighed(noFibre, shown, 0), null);
  assert.equal(FoodAmount.editWeighed(noFibre, shown, NaN), null);
});

test('a serving-based entry edits per serving and never gains a weight', () => {
  const old = { servings: 2, calories: 150, proteinG: 12.5, fatG: 5, carbsG: 10 };
  const typed = { calories: 150, proteinG: 12.5, fatG: 5, carbsG: 10, fiberG: null };
  assert.deepEqual(FoodAmount.editServings(old, typed, 3),
    { servings: 3, calories: 150, proteinG: 12.5, fatG: 5, carbsG: 10, fiberG: undefined });
  assert.equal(FoodAmount.editServings(old, typed, 0), null);
  assert.equal(FoodAmount.editServings(old, { ...typed, calories: null }, 2), null);
});

test('an untouched amount in ounces keeps the exact stored weight', () => {
  const entry = { amountGrams: 350 };
  assert.equal(FoodAmount.editedGrams(entry, '12.3', 'oz'), 350,
    '12.3 oz is 348.7 g; the entry weighed 350');
  assert.equal(FoodAmount.editedGrams(entry, '350', 'g'), 350);
  assert.equal(FoodAmount.editedGrams(entry, '12.4', 'oz'), 12.4 * 28.3495, 'a changed amount converts');
  assert.equal(FoodAmount.editedGrams(entry, '', 'g'), null);
  assert.equal(FoodAmount.editedGrams(entry, '0', 'g'), null);
});
