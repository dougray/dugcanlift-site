import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';

// parser.js and foods.js declare plain functions for app.js to call; hand them
// back out, the way recipe-catalogue.test.mjs does.
const { parseIngredient, COUNT_UNIT } = new Function(
  readFileSync('coach/parser.js', 'utf8') + '\nreturn { parseIngredient, COUNT_UNIT };')();
const { gramsFor } = new Function(
  readFileSync('coach/foods.js', 'utf8') + '\nreturn { gramsFor };')();

// MARK: - Spelled-out units

// The case table for spelled-out units. The same lines and answers are in
// IngredientParserTests (dugcanlift-kit, iOS), IngredientParserTest
// (dugcanlift-kit-android), and lift/ingredient-parser.test.mjs (dugcanlift-site): all four parsers must give the same answer.
const SPELLED_CASES = [
  ['1.5 pounds ground beef', 1.5, 'lb', 'ground beef'],
  ['2 Tablespoons olive oil', 2, 'tbsp', 'olive oil'],
  ['500 grams flour', 500, 'g', 'flour'],
  ['1 kilo potatoes', 1, 'kg', 'potatoes'],
  ['8 ounces cream cheese, softened', 8, 'oz', 'cream cheese, softened'],
  ['1 litre stock', 1, 'l', 'stock'],
  ['250 millilitres milk', 250, 'ml', 'milk'],
  ['3 Teaspoons. sea salt', 3, 'tsp', 'sea salt'],
  // The known cost of the rule, pinned on purpose: "pound cake" is read as a
  // pound of cake, exactly as "1 lb cake mix" already is.
  ['1 pound cake mix', 1, 'lb', 'cake mix'],
  ['1 lb cake mix', 1, 'lb', 'cake mix'],
  // Lines that parsed before are unchanged.
  ['2 eggs', 2, COUNT_UNIT, 'eggs'],
  ['2 lbs chicken', 2, 'lbs', 'chicken'],
  ['1 1/2 cups flour', 1.5, 'cups', 'flour'],
];

const near = (actual, expected, label) =>
  assert.ok(Math.abs(actual - expected) < 1e-6, `${label}: got ${actual}, wanted ${expected}`);

test('spelled-out units are stored as their abbreviation', () => {
  for (const [line, qty, unit, item] of SPELLED_CASES) {
    const parsed = parseIngredient(line);
    near(parsed.qty, qty, line);
    assert.equal(parsed.unit, unit, line);
    assert.equal(parsed.item, item, line);
    assert.equal(parsed.rawText, line, line);
  }
});

test('spelled-out weights are costed and volumes are not', () => {
  const grams = (line) => gramsFor(parseIngredient(line));
  near(grams('1.5 pounds ground beef'), 680.388, 'pounds');
  near(grams('500 grams flour'), 500, 'grams');
  near(grams('1 kilo potatoes'), 1000, 'kilo');
  near(grams('8 ounces cream cheese, softened'), 226.796, 'ounces');
  assert.equal(parseIngredient('500 grams flour').grams, 500);
  assert.equal(parseIngredient('1.5 pounds ground beef').grams, null,
    'the stored grams field is for g only, as it is for lb');
  assert.equal(grams('2 Tablespoons olive oil'), null, 'a volume is never costed, spelled out or not');
  assert.equal(grams('1 litre stock'), null);
  assert.equal(grams('250 millilitres milk'), null);
});

test('every spelled-out word maps to its abbreviation in any case', () => {
  const table = [
    ['gram', 'g'], ['grams', 'g'], ['gramme', 'g'], ['grammes', 'g'],
    ['kilogram', 'kg'], ['kilograms', 'kg'], ['kilogramme', 'kg'], ['kilogrammes', 'kg'],
    ['kilo', 'kg'], ['kilos', 'kg'],
    ['milligram', 'mg'], ['milligrams', 'mg'], ['milligramme', 'mg'], ['milligrammes', 'mg'],
    ['ounce', 'oz'], ['ounces', 'oz'],
    ['pound', 'lb'], ['pounds', 'lb'],
    ['teaspoon', 'tsp'], ['teaspoons', 'tsp'],
    ['tablespoon', 'tbsp'], ['tablespoons', 'tbsp'],
    ['milliliter', 'ml'], ['milliliters', 'ml'], ['millilitre', 'ml'], ['millilitres', 'ml'],
    ['liter', 'l'], ['liters', 'l'], ['litre', 'l'], ['litres', 'l'],
  ];
  for (const [word, abbreviation] of table) {
    for (const spelling of [word, word.toUpperCase(), word[0].toUpperCase() + word.slice(1)]) {
      const line = `2 ${spelling}, rice`;
      const parsed = parseIngredient(line);
      assert.equal(parsed.unit, abbreviation, line);
      assert.equal(parsed.item, 'rice', line);
    }
  }
});

test('a unit with nothing after it is still not an ingredient', () => {
  // "3 Teaspoons." alone names no ingredient, exactly as "3 tsp." does.
  for (const line of ['3 Teaspoons.', '3 tsp.']) {
    assert.deepEqual(parseIngredient(line), { rawText: line }, line);
  }
});

test('out-of-scope units are still counts', () => {
  for (const line of ['2 t sugar', '2 T butter', '1 c. milk', '1 pt cream', '1 qt stock', '1 stick butter', '2 fl oz rum']) {
    assert.equal(parseIngredient(line).unit, COUNT_UNIT, line);
  }
});

test('a word that only looks like a table key is not a unit', () => {
  // The table is a plain object; its prototype's names must not read as units.
  for (const line of ['2 constructor bolts', '1 toString cake', '3 __proto__ things']) {
    assert.equal(parseIngredient(line).unit, COUNT_UNIT, line);
  }
});
