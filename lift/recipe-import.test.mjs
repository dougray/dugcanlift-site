import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';

// Loaded as the classic script it is in the browser; module.exports at its foot
// hands node the same functions the page gets as globals.
const shim = { exports: {} };
new Function('module', readFileSync('lift/recipe-import.js', 'utf8'))(shim);
const { parseCaption, captionLines } = shim.exports;

// parseIngredient lifted out of app.js as it is now, so the last cases read the
// parser that really runs on Save rather than a copy of it.
function liftParseIngredient() {
  const src = readFileSync('lift/app.js', 'utf8');
  const i = src.indexOf("const COUNT_UNIT = '\\u0000count';");
  const j = src.indexOf('/* Counts print bare', i);
  assert.ok(i >= 0 && j > i, 'parseIngredient is where this test expects it');
  return new Function(src.slice(i, j) + '\nreturn parseIngredient;')();
}
const parseIngredient = liftParseIngredient();

// Ported case for case from Coach web's coach/recipe-import-test.html, caption
// half -- the same fixtures as CaptionRecipeTests (iOS) and CaptionRecipeTest
// (Android). The JSON-LD half is not ported: this build fetches no page.

// MARK: - Headings

test('a labelled caption splits on its own headings', () => {
  const tuscan = parseCaption(
    'Creamy Tuscan Chicken \u{1F357}\n\n'
    + 'Ingredients:\n- 2 chicken breasts\n- 1 cup heavy cream\n- 200g spinach\n\n'
    + 'Method:\n1. Sear the chicken\n2. Add the cream and wilt the spinach\n\n'
    + '#mealprep #highprotein');
  assert.equal(tuscan.split, 'labelled');
  assert.equal(tuscan.name, 'Creamy Tuscan Chicken \u{1F357}', 'the name is the first line');
  assert.deepEqual(tuscan.ingredientLines,
    ['2 chicken breasts', '1 cup heavy cream', '200g spinach'], 'bullets are stripped from ingredients');
  assert.deepEqual(tuscan.steps,
    ['Sear the chicken', 'Add the cream and wilt the spinach'], 'list numbering is stripped from steps');
});

test('headings are found through emoji and dashes', () => {
  const decorated = parseCaption('\u{1F6D2} INGREDIENTS \u{1F447}\n2 eggs\n— Instructions —\nWhisk them');
  assert.equal(decorated.split, 'labelled');
  assert.deepEqual(decorated.ingredientLines, ['2 eggs']);
  assert.deepEqual(decorated.steps, ['Whisk them']);
});

test("“what you'll need” and “how to make it” are headings", () => {
  const youll = parseCaption("What you'll need:\n1 banana\nHow to make it:\nMash it");
  assert.deepEqual(youll.ingredientLines, ['1 banana']);
  assert.deepEqual(youll.steps, ['Mash it']);
});

// MARK: - Bullets and numbering

test('numbering goes but a decimal quantity survives', () => {
  // "1.5 cups" losing its "1." would silently become five cups.
  assert.deepEqual(parseCaption('Ingredients\n1. 1.5 cups flour\n2) 2 eggs').ingredientLines,
    ['1.5 cups flour', '2 eggs']);
});

test('mixed bullet characters are all removed', () => {
  assert.deepEqual(
    parseCaption('Ingredients\n• 100 g rice\n▢ 1 tbsp oil\n* 2 cloves garlic').ingredientLines,
    ['100 g rice', '1 tbsp oil', '2 cloves garlic']);
});

// MARK: - Splits

test('one heading only is an inference, and says so', () => {
  assert.equal(parseCaption('Ingredients:\n2 eggs\n1 cup milk').split, 'inferred');
});

test('a method heading takes its ingredients from above and its steps from below', () => {
  const above = parseCaption('Garlic Butter Rice\n200 g rice\n2 cloves garlic\nMethod\nBoil the rice');
  assert.deepEqual(above.ingredientLines, ['200 g rice', '2 cloves garlic']);
  assert.deepEqual(above.steps, ['Boil the rice']);
});

test('method-first is still labelled', () => {
  const methodFirst = parseCaption('Instructions:\nMelt the butter\nIngredients:\n50 g butter');
  assert.equal(methodFirst.split, 'labelled');
  assert.deepEqual(methodFirst.steps, ['Melt the butter']);
  assert.deepEqual(methodFirst.ingredientLines, ['50 g butter']);
});

test('no headings means unsorted, not guessed at', () => {
  // Everything lands on one side. The editor cuts the method out; the parser
  // does not pretend to know where it starts.
  const unsorted = parseCaption('Banana Pancakes\n2 eggs\n1 banana\nBlend and fry');
  assert.equal(unsorted.split, 'unsorted');
  assert.deepEqual(unsorted.ingredientLines, ['2 eggs', '1 banana', 'Blend and fry']);
});

// MARK: - Yield

['Serves 4', 'Servings: 4', 'Makes about 4 bowls', 'Feeds 4'].forEach((line) => {
  test(`an explicit yield is read, and is not also an ingredient: ${line}`, () => {
    const y = parseCaption('Ingredients\n2 eggs\n' + line);
    assert.equal(y.servings, 4);
    assert.deepEqual(y.ingredientLines, ['2 eggs']);
  });
});

test('a cooking time is not a yield', () => {
  // The exact line that made yield inference a bad idea: it is a cooking time,
  // and reading it as a yield halves every macro in the dish.
  assert.equal(
    parseCaption('Ingredients\n1 ham bone\nMethod\nCook slowly with the ham bone for 2 hours').servings,
    null);
});

test('a yield word with no number is not a yield', () => {
  assert.equal(parseCaption('Ingredients\n100 g rice\nServes with rice').servings, null);
});

// MARK: - Title

test('a quantity line is never the name, and no line is lost to a wrong name', () => {
  // A title at the top is stated structure; a title in the middle is a guess,
  // and a wrong one takes a real line out of the recipe with it.
  const quantityFirst = parseCaption('2 eggs\n1 banana\nBlend');
  assert.equal(quantityFirst.name, null);
  assert.deepEqual(quantityFirst.ingredientLines, ['2 eggs', '1 banana', 'Blend']);
});

test('a line below the heading is never the name', () => {
  assert.equal(parseCaption('Ingredients\nSalt\nPepper').name, null);
});

test('the name is not also an ingredient', () => {
  assert.deepEqual(parseCaption('Banana Pancakes\n2 eggs').ingredientLines, ['2 eggs']);
});

// MARK: - Noise and edges

test('hashtag, mention and emoji lines are dropped', () => {
  assert.deepEqual(
    parseCaption('Ingredients\n2 eggs\n\u{1F525}\u{1F525}\u{1F525}\n#foodie #mealprep\n@somecreator').ingredientLines,
    ['2 eggs']);
});

test('an edited box reparses to lines', () => {
  assert.deepEqual(captionLines('- 2 eggs\n\n• 1 cup milk\n   \n3. 200 g flour'),
    ['2 eggs', '1 cup milk', '200 g flour']);
});

test('empty input is unsorted with no name', () => {
  const empty = parseCaption('');
  assert.deepEqual([empty.split, empty.name], ['unsorted', null]);
});

// MARK: - Quantities stay the ingredient parser's job

test('the caption reader leaves quantities to the parser, which still refuses a volume', () => {
  const oats = parseCaption('Ingredients\n- 1 1/2 cups oats\n- a handful of nuts');
  assert.equal(parseIngredient(oats.ingredientLines[0]).qty, 1.5);
  assert.equal(parseIngredient(oats.ingredientLines[0]).grams, null);
  assert.equal(parseIngredient(oats.ingredientLines[1]).qty, undefined, 'and still gives up cleanly on prose');
});

// MARK: - This build

test('the caption half is Coach web\'s text, unchanged', () => {
  // The two web apps give the same answer for the same text only while this
  // block is the same text. The deployed copy of Coach web is in this repo.
  const block = (src) => {
    const start = src.indexOf('/* ------------------------------------------------------------------ *\n * Caption reading');
    const endFn = src.indexOf('function captionLines(text) {', start);
    const end = src.indexOf('\n}\n', endFn) + 3;
    assert.ok(start >= 0 && endFn > start, 'the caption block is where this test expects it');
    return src.slice(start, end);
  };
  assert.equal(block(readFileSync('lift/recipe-import.js', 'utf8')),
    block(readFileSync('coach/recipe-import.js', 'utf8')));
});

test('nothing here can reach the network', () => {
  // The in-house rule: Paste a recipe reads what is pasted and nothing else.
  const src = readFileSync('lift/recipe-import.js', 'utf8');
  ['fetch(', 'XMLHttpRequest', 'WebSocket', 'sendBeacon', 'import('].forEach((word) => {
    assert.ok(!src.includes(word), word);
  });
});
