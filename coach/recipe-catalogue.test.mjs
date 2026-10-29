import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

// Loaded the way the browser loads it. Run from the repo root:
// node --test coach/*.test.mjs
const shim = { window: {} };
new Function('window', readFileSync('coach/recipe-catalogue.js', 'utf8')).call(shim, shim.window);
const C = shim.window.CoachRecipeCatalogue;

// parser.js declares plain functions for app.js to call; hand them back out.
const { parseIngredient, COUNT_UNIT } = new Function(
  readFileSync('coach/parser.js', 'utf8') + '\nreturn { parseIngredient, COUNT_UNIT };')();

const RECIPES = C.fromFile(JSON.parse(readFileSync('coach/recipes.json', 'utf8')));
const byId = (id) => RECIPES.find((r) => r.id === id);

/* ---------------- the bundled data ---------------- */

// The same check road-picks.test.mjs makes on road-food.json, for the same
// reason: every test below passes as happily on a copy several exports behind.
// It reads the file as BYTES, never a re-encoded string, because the contract
// is over the file itself.
test("the bundled recipes.json is the kit's file, byte for byte", () => {
  const sum = readFileSync('coach/recipes.sha256', 'utf8').trim();
  assert.match(sum, /^[0-9a-f]{64}$/, 'coach/recipes.sha256 should be one bare sha256 and nothing else');
  const actual = createHash('sha256').update(readFileSync('coach/recipes.json')).digest('hex');
  assert.equal(actual, sum,
    'coach/recipes.json does not match coach/recipes.sha256.\n' +
    'Copy dugcanlift-kit/data/recipes.json AND data/recipes.sha256 over together,\n' +
    'and bump CACHE in coach/sw.js. Never edit either file here, and never re-write the\n' +
    'checksum by hand: the kit writes it (Tools/export_recipes_json.py).');
});

test('the catalogue reads as 622 recipes, each with its own licence and credit', () => {
  assert.equal(RECIPES.length, 622);
  RECIPES.forEach((r) => {
    assert.ok(r.license && r.attribution, `${r.id} is missing its licence or attribution`);
    assert.ok(r.ingredients.length, `${r.id} has no ingredients`);
  });
});

test('exactly one of the two macro sets is ever filled in, and totals only without a yield', () => {
  RECIPES.forEach((r) => {
    assert.ok(!(r.caloriesPerServing != null && r.caloriesTotal != null), r.id);
    if (r.caloriesTotal != null) assert.equal(r.servings, null, `${r.id} has totals and a yield`);
    if (r.caloriesPerServing != null) assert.ok(r.servings > 0, `${r.id} has per-serving figures and no yield`);
  });
});

test('a file that is not a catalogue is refused, and junk rows are dropped', () => {
  assert.throws(() => C.fromFile({ chains: [] }));
  assert.throws(() => C.fromFile(null));
  const read = C.fromFile({ recipes: [null, { id: 'a' }, { id: 'b', name: 'B', ingredients: ['1 egg', '', 7] }] });
  assert.equal(read.length, 1);
  assert.deepEqual(read[0].ingredients, ['1 egg']);
  assert.deepEqual(read[0].steps, []);
});

/* ---------------- servings and macros ---------------- */

test('a stated yield uses the published per-serving figures and ignores the count', () => {
  const carbonara = byId('unitools:spaghetti-carbonara');
  assert.equal(C.needsServings(carbonara), false);
  const expected = { calories: 690, proteinG: 32, carbsG: 62, fatG: 34 };
  assert.deepEqual(C.nutrition(carbonara, 2), expected);
  assert.deepEqual(C.nutrition(carbonara, 9), expected, 'rescaling a measured figure invents one');
  assert.equal(C.servingsFor(carbonara, 9), 2, 'the stated yield wins over the stepper');
});

test('no stated yield divides the whole-dish totals by the count picked, never guessed', () => {
  const pie = byId('gutenberg-26558:beef-pot-pie');
  assert.equal(pie.servings, null);
  assert.equal(C.needsServings(pie), true);
  const at4 = C.nutrition(pie, 4);
  const at6 = C.nutrition(pie, 6);
  assert.equal(at4.calories, pie.caloriesTotal / 4);
  assert.equal(at6.calories, pie.caloriesTotal / 6);
  assert.equal(at4.proteinG, pie.proteinTotal / 4);
  assert.equal(C.servingsFor(pie, undefined), 4, 'four when nothing was picked');
  assert.equal(C.servingsFor(pie, 6), 6);
  assert.equal(C.nutrition(pie, 0).calories, pie.caloriesTotal, 'a zero count divides by one, never by zero');
});

test('whole numbers on screen round half away from zero, never truncate', () => {
  const pie = byId('gutenberg-26558:beef-pot-pie');
  assert.equal(pie.caloriesTotal / 4, 224.525);
  assert.match(C.macroLine(C.nutrition(pie, 4)), /^225 kcal · /, 'Beef Pot Pie at 4 servings reads 225 kcal');
  assert.equal(C.roundHalfAway(2.5), 3);
  assert.equal(C.roundHalfAway(-2.5), -3, 'away from zero, where Math.round alone gives -2');
  assert.equal(C.roundHalfAway(2.4999), 2);
  assert.equal(C.macroSummary({ caloriesPerServing: 689.5, ingredients: [] }), '690 kcal per serving');
});

test('the servings stepper shows for every recipe whose servings is null, and only those', () => {
  const nulls = RECIPES.filter((r) => r.servings == null);
  assert.equal(nulls.length, 121);
  nulls.forEach((r) => assert.equal(C.showsServingsStepper(r), true, r.id));
  assert.ok(nulls.some((r) => C.nutrition(r, 4) === null), 'including the ones with no macros at all');
  RECIPES.filter((r) => r.servings != null)
    .forEach((r) => assert.equal(C.showsServingsStepper(r), false, r.id));
});

test('the stepper holds whole servings from 1 to 48', () => {
  assert.equal(C.clampServings('6'), 6);
  assert.equal(C.clampServings(0), 1);
  assert.equal(C.clampServings(-3), 1);
  assert.equal(C.clampServings(99), 48);
  assert.equal(C.clampServings(2.6), 3);
  assert.equal(C.clampServings('x'), 4);
  assert.equal(C.clampServings(''), 4, 'an emptied field is the default, not Number("") = 0');
  assert.equal(C.clampServings(null), 4);
});

test('a recipe with no macros has none, and says so in the list', () => {
  const dressing = byId('gutenberg-26558:a-good-pennsylvania-dutch-salad-dressing');
  assert.equal(C.nutrition(dressing, 4), null);
  assert.equal(C.needsServings(dressing), false);
  assert.equal(C.macroSummary(dressing), 'No macros');
  assert.match(dressing.nutritionNote, /^No macros/);
});

test("the list's lines are the iPhone's", () => {
  assert.equal(C.rowLine(byId('unitools:spaghetti-carbonara')), '690 kcal per serving · 7 ingredients');
  assert.equal(C.macroSummary(byId('gutenberg-26558:beef-pot-pie')), 'Macros for the whole dish');
  assert.equal(C.macroLine({ calories: 224.9, proteinG: 10.99, carbsG: 0.4, fatG: 3 }),
    '225 kcal · P 11 · C 0 · F 3', 'rounded, never truncated');
  assert.equal(C.macroLine(null), null);
});

/* ---------------- browse and search ---------------- */

test('with no search typed, all 622 recipes are listed by name, in SQLite binary order', () => {
  const page = C.browse(RECIPES);
  assert.equal(page.length, 622);
  assert.equal(new Set(page.map((r) => r.id)).size, 622);
  for (let i = 1; i < page.length; i++) assert.ok(page[i - 1].name <= page[i].name);
  assert.equal(page[0].name, [...RECIPES].map((r) => r.name).sort()[0]);
});

test('search finds carbonara by name', () => {
  const found = C.search(RECIPES, 'carbonara');
  assert.equal(found[0].id, 'unitools:spaghetti-carbonara');
});

test('every word of the query must open a word, and order does not matter', () => {
  const names = C.search(RECIPES, 'pot pie').map((r) => r.name);
  assert.ok(names.includes('Beef Pot Pie'));
  assert.deepEqual(C.search(RECIPES, 'pie pot').map((r) => r.name), names);
  assert.ok(C.search(RECIPES, 'carbon').some((r) => r.id === 'unitools:spaghetti-carbonara'), 'prefix');
  assert.deepEqual(C.search(RECIPES, 'carbonara zzzz'), []);
});

test('search reads the summary and the country, as recipes_fts indexes them', () => {
  // "guanciale" is in carbonara's summary and not its name.
  assert.ok(C.search(RECIPES, 'guanciale').some((r) => r.id === 'unitools:spaghetti-carbonara'));
  const jamaica = C.search(RECIPES, 'jm', 500);
  assert.ok(jamaica.length > 0);
  assert.ok(jamaica.every((r) => r.country === 'JM'
    || /\bjm/i.test(`${r.name} ${r.summary || ''}`)));
});

test('category is not searched, because the iPhone does not index it', () => {
  const soups = RECIPES.filter((r) => r.category === 'dessert'
    && !/dessert/i.test(`${r.name} ${r.summary || ''} ${r.country || ''}`));
  assert.ok(soups.length, 'the data has a dessert that never says so');
  const found = new Set(C.search(RECIPES, 'dessert', 1000).map((r) => r.id));
  soups.forEach((r) => assert.ok(!found.has(r.id), r.id));
});

test('case, accents and plurals do not stop a match', () => {
  assert.equal(C.search(RECIPES, 'CARBONARA')[0].id, 'unitools:spaghetti-carbonara');
  const fake = [{ id: 'x', name: 'Crème brûlée', ingredients: [] },
    { id: 'y', name: 'Berry tart', ingredients: [] },
    { id: 'z', name: 'Stuffed tomatoes', ingredients: [] }];
  assert.deepEqual(C.search(fake, 'creme brulee').map((r) => r.id), ['x']);
  assert.deepEqual(C.search(fake, 'berries').map((r) => r.id), ['y']);
  assert.deepEqual(C.search(fake, 'tomato').map((r) => r.id), ['z']);
});

test('a name match outranks a summary match, then the shorter name wins', () => {
  const fake = [
    { id: 'a', name: 'A long dish of many things', summary: 'with lemon', ingredients: [] },
    { id: 'b', name: 'Lemon tart with a long name', ingredients: [] },
    { id: 'c', name: 'Lemon tart', ingredients: [] },
  ];
  assert.deepEqual(C.search(fake, 'lemon').map((r) => r.id), ['c', 'b', 'a']);
});

test('fewer than two characters searches nothing, and results stop at 40', () => {
  assert.deepEqual(C.search(RECIPES, 'a'), []);
  assert.deepEqual(C.search(RECIPES, ' '), []);
  assert.ok(C.search(RECIPES, 'the').length <= 40);
});

test('the credits are each distinct attribution with its licence', () => {
  const list = C.credits(RECIPES);
  assert.deepEqual(list, [...list].sort());
  assert.equal(new Set(list).size, list.length);
  assert.ok(list.includes('UniTools — theunitools.com — CC BY-SA 4.0'));
  RECIPES.forEach((r) => assert.ok(list.includes(`${r.attribution} — ${r.license}`)));
});

/* ---------------- copying into the library ---------------- */

test('Add writes the recipe form body, with every line reparsed from its raw text', () => {
  const r = byId('unitools:spaghetti-carbonara');
  const body = C.libraryRecipe(r, 4, parseIngredient, 1700000000000);
  assert.equal(body.name, 'Spaghetti carbonara');
  assert.equal(body.servings, 2);
  assert.deepEqual(body.ingredients.map((i) => i.rawText), r.ingredients);
  assert.deepEqual(body.ingredients[0], parseIngredient('200 g Spaghetti'));
  assert.equal(body.ingredients[0].grams, 200);
  assert.equal(body.ingredients[2].unit, COUNT_UNIT, '"3 Egg yolks" is a count');
  assert.equal(body.ingredients[6].qty, undefined, '"Salt for the water" is kept as written');
  assert.deepEqual(body.steps, r.steps);
  assert.deepEqual(body.nutritionPerServing,
    { calories: 690, proteinG: 32, carbsG: 62, fatG: 34, estimated: true });
  assert.equal(body.totalWeightGrams, null);
  assert.equal(body.importedAt, 1700000000000);
  assert.equal(body.prepMinutes, 10);
  assert.equal(body.cookMinutes, 15);
});

test('Add keeps the credit and the coverage note on the copy', () => {
  const pie = byId('gutenberg-26558:beef-pot-pie');
  const body = C.libraryRecipe(pie, 6, parseIngredient, 0);
  assert.equal(body.sourceAuthor, pie.attribution);
  assert.equal(body.sourceUrl, pie.sourceURL);
  assert.equal(body.sourceTranscript, [pie.attribution, pie.license, pie.nutritionNote].join('\n'));
  assert.equal(body.servings, 6);
  // The raw quotient, unrounded, as every other build stores it.
  assert.equal(body.nutritionPerServing.calories, pie.caloriesTotal / 6);
  assert.equal(body.nutritionPerServing.proteinG, pie.proteinTotal / 6);
  assert.equal(body.nutritionPerServing.carbsG, pie.carbsTotal / 6);
  assert.equal(body.nutritionPerServing.fatG, pie.fatTotal / 6);
  assert.notEqual(body.nutritionPerServing.calories, 149.7, 'not stored to a tenth');
  assert.equal(body.nutritionPerServing.estimated, pie.nutritionIsEstimated);
});

test('Add of a recipe without macros writes no macros, never zeros', () => {
  const body = C.libraryRecipe(byId('gutenberg-26558:a-good-pennsylvania-dutch-salad-dressing'),
    4, parseIngredient, 0);
  assert.equal(body.nutritionPerServing, null);
  assert.equal(body.servings, 4);
});

test('nothing in the catalogue module reaches for the network', () => {
  const src = readFileSync('coach/recipe-catalogue.js', 'utf8');
  ['fetch(', 'XMLHttpRequest', 'WebSocket', 'sendBeacon', 'import('].forEach((call) => {
    assert.ok(!src.includes(call), `recipe-catalogue.js calls ${call}`);
  });
});

/* ---------------- the recipe form, on a copied recipe ---------------- */

test('the recipe form shows a stored macro as the cards do, and keeps the raw figure', () => {
  // showStoredMacro lifted out of app.js as it is now, against a stand-in field.
  const src = readFileSync('coach/app.js', 'utf8');
  const i = src.indexOf('function showStoredMacro(selector, value) {');
  const j = src.indexOf('function openRecipeForm(id) {', i);
  assert.ok(i >= 0 && j > i, 'showStoredMacro sits just above openRecipeForm');
  const field = { value: '', dataset: {} };
  const trimNum = (v) => (Number.isInteger(v) ? String(v) : String(Math.round(v * 100) / 100));
  const show = new Function('$', 'trimNum', src.slice(i, j) + '\nreturn showStoredMacro;')(() => field, trimNum);
  const stored = 898.1 / 6;
  show('#r-cal', stored);
  assert.equal(field.value, '149.68', 'two places, as the recipe card prints it');
  assert.equal(parseFloat(field.dataset.stored), stored, 'the quotient, unrounded, beside it');
  assert.equal(field.dataset.shown, '149.68');
  show('#r-cal', 690);
  assert.deepEqual([field.value, field.dataset.stored], ['690', '690']);
  show('#r-cal', null);
  assert.deepEqual([field.value, field.dataset.stored, field.dataset.shown], ['', '', '']);
});

test("Save writes the stored figure back for a field left as shown, and the typed one otherwise", () => {
  // The num() reader inside the form's Save handler, lifted out as it is now.
  const src = readFileSync('coach/app.js', 'utf8');
  const i = src.indexOf('  const num = (sel) => {');
  const j = src.indexOf('  const typed = [num(', i);
  assert.ok(i >= 0 && j > i);
  const fields = {};
  const num = new Function('$', src.slice(i, j) + '\nreturn num;')((sel) => fields[sel]);
  const stored = 898.1 / 6;
  fields['#r-cal'] = { value: '149.68', dataset: { stored: String(stored), shown: '149.68' } };
  fields['#r-p'] = { value: '9', dataset: { stored: String(40 / 6), shown: '6.67' } };
  fields['#r-c'] = { value: '', dataset: { stored: '', shown: '' } };
  fields['#r-f'] = { value: '12.5', dataset: { stored: '', shown: '' } };
  assert.equal(num('#r-cal'), stored, 'untouched: the raw quotient, not 149.68');
  assert.equal(num('#r-p'), 9, 'edited: what was typed');
  assert.equal(num('#r-c'), null, 'blank stays blank');
  assert.equal(num('#r-f'), 12.5, 'a field with no stored figure reads as typed');
});

// Coach iPhone keeps `nutritionIsEstimated` on the recipe and its editor's
// save never touches it (RecipeEditorView.save, MacroFields.entered): editing
// a macro on an estimated recipe leaves it estimated. Here the flag is
// nutritionPerServing.estimated (BACKUP-FORMAT), and mergeNutrition carries
// every key the form does not show, so the form keeps it the same way.
test('saving a copied recipe through the form keeps its estimated flag, as the iPhone does', () => {
  const s = { window: {} };
  new Function('window', readFileSync('coach/recipe-nutrition.js', 'utf8')).call(s, s.window);
  const N = s.window.CoachRecipeNutrition;
  const pie = byId('gutenberg-26558:beef-pot-pie');
  const existing = C.libraryRecipe(pie, 6, parseIngredient, 0).nutritionPerServing;
  assert.equal(existing.estimated, true);

  const untouched = N.mergeNutrition([existing.calories, existing.proteinG, existing.carbsG, existing.fatG, null],
    existing, { saturatedFatG: null, sugarG: null, sodiumMg: null });
  assert.equal(untouched.estimated, true);
  assert.equal(untouched.calories, pie.caloriesTotal / 6, 'a rename rounds nothing');

  const edited = N.mergeNutrition([existing.calories, 9, existing.carbsG, existing.fatG, null],
    existing, { saturatedFatG: null, sugarG: null, sodiumMg: null });
  assert.equal(edited.estimated, true, 'editing a macro does not clear it');
  assert.equal(edited.proteinG, 9);
  assert.equal(edited.calories, pie.caloriesTotal / 6);
});
