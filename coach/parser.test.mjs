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

// MARK: - Whitespace

// Every whitespace character in the line becomes a plain space before parsing:
// U+0009-U+000D, U+0020, U+00A0, U+1680, U+2000-U+200A, U+2028, U+2029,
// U+202F, U+205F, U+3000, U+FEFF. The same cases are in the other three
// parsers' suites.
const WHITESPACE_CASES = [
  ['1.5 pounds ground beef', 1.5, 'lb', 'ground beef'], // NBSP between number and unit
  ['2 cups rice', 2, 'cups', 'rice'], // NBSP between unit and item
  ['1 lb ground beef', 1, 'lb', 'ground beef'], // the item comes out with plain spaces
  ['2\tcups rice', 2, 'cups', 'rice'], // tab between number and unit
  ['\t2 cups rice', 2, 'cups', 'rice'], // a leading tab
  ['250 g flour', 250, 'g', 'flour'], // U+202F narrow no-break space
  ['1 1/2 cups flour', 1.5, 'cups', 'flour'], // "1 1/2" with an NBSP
  ['﻿400 g chicken thigh', 400, 'g', 'chicken thigh'], // a byte-order mark
];

const WHITESPACE = [
  0x09, 0x0A, 0x0B, 0x0C, 0x0D, 0x20, 0xA0, 0x1680,
  0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005, 0x2006, 0x2007, 0x2008, 0x2009, 0x200A,
  0x2028, 0x2029, 0x202F, 0x205F, 0x3000, 0xFEFF,
];

const bytes = (text) => [...Buffer.from(text, 'utf8')];

test('whitespace of every kind splits words like a space', () => {
  for (const [line, qty, unit, item] of WHITESPACE_CASES) {
    const parsed = parseIngredient(line);
    assert.equal(parsed.qty, qty, JSON.stringify(line));
    assert.equal(parsed.unit, unit, JSON.stringify(line));
    assert.equal(parsed.item, item, JSON.stringify(line));
  }
});

test('every character in the set is a space, wherever it falls', () => {
  for (const code of WHITESPACE) {
    const ws = String.fromCharCode(code);
    const hex = code.toString(16);
    const between = parseIngredient(`${ws}2${ws}1/2${ws}cups${ws}basmati${ws}rice${ws}`);
    assert.equal(between.qty, 2.5, hex);
    assert.equal(between.unit, 'cups', hex);
    assert.equal(between.item, 'basmati rice', hex);
  }
});

test('a character outside the set is not a space', () => {
  // U+200B zero-width space, U+001C file separator and U+0085 next line are
  // not in the set, so "cups" never becomes a unit through them.
  for (const ws of ['​', '\u001C', '\u0085']) {
    const parsed = parseIngredient(`2${ws}cups rice`);
    assert.equal(parsed.unit, COUNT_UNIT, ws.charCodeAt(0).toString(16));
    assert.equal(parsed.item, `${ws}cups rice`, ws.charCodeAt(0).toString(16));
  }
});

test('rawText keeps the line byte for byte', () => {
  const lines = WHITESPACE_CASES.map(([line]) => line).concat(['　salt to taste\t']);
  for (const line of lines) {
    assert.deepEqual(bytes(parseIngredient(line).rawText), bytes(line), JSON.stringify(line));
  }
});
