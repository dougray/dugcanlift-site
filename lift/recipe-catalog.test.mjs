import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

// Loaded the way the browser loads it, like road-food.test.mjs does.
const shim = { window: {} };
new Function('window', readFileSync('lift/recipe-catalog.js', 'utf8')).call(shim, shim.window);
const C = shim.window.LiftRecipeCatalog;

const raw = JSON.parse(readFileSync('lift/recipes.json', 'utf8'));
const all = C.parse(raw);
const byId = (id) => all.find((r) => r.id === id);

// MARK: - The bundled file

// recipes.json is exported once, in dugcanlift-kit/data/, from the same
// recipes.db the iPhone reads, and copied byte for byte into every build that
// cannot open SQLite. The shape checks below pass just as happily on a copy
// fifty recipes behind, so only the bytes can say it has fallen behind.
test('the bundled recipes.json is the kit\'s file, byte for byte', () => {
  const sum = readFileSync('lift/recipes.sha256', 'utf8').trim();
  assert.match(sum, /^[0-9a-f]{64}$/, 'lift/recipes.sha256 should be one bare sha256 and nothing else');
  // Read as bytes, never as a decoded string: the contract is over the file.
  const actual = createHash('sha256').update(readFileSync('lift/recipes.json')).digest('hex');
  assert.equal(actual, sum,
    'lift/recipes.json does not match lift/recipes.sha256.\n' +
    'Copy dugcanlift-kit/data/recipes.json AND data/recipes.sha256 over together, and bump\n' +
    'CACHE in sw.js. Never edit either file here, and never re-write the checksum by hand:\n' +
    'the kit\'s exporter (Tools/export_recipes_json.py) writes it.');
});

test('every recipe reads, with a name, a licence and a credit', () => {
  assert.equal(all.length, raw.recipes.length, 'no row was dropped');
  assert.ok(all.length >= 600, 'the "Search 600+ recipes" prompt is true');
  all.forEach((r) => {
    assert.ok(r.license, `${r.id} has a licence`);
    assert.ok(r.attribution, `${r.id} has an attribution`);
  });
});

test('exactly one of the two sets of macros is filled in', () => {
  all.forEach((r) => {
    if (r.servings == null) assert.equal(r.caloriesPerServing, null, `${r.id}: no yield, no per-serving figure`);
    else assert.equal(r.caloriesTotal, null, `${r.id}: a yield, no whole-dish total`);
  });
});

test('nothing in the file points the page anywhere but at its credit', () => {
  // The only URL a row carries is its source's, and nothing here requests it.
  const src = readFileSync('lift/recipe-catalog.js', 'utf8');
  ['fetch(', 'XMLHttpRequest', 'WebSocket', 'sendBeacon', 'import('].forEach((word) => {
    assert.ok(!src.includes(word), word);
  });
});

// MARK: - Macros

test('a published per-serving figure is used as it is, whatever the count', () => {
  const carbonara = byId('unitools:spaghetti-carbonara');
  assert.equal(carbonara.servings, 2);
  assert.equal(C.needsServings(carbonara), false);
  const at2 = C.nutrition(carbonara, 2);
  assert.deepEqual(at2, { calories: 690, proteinG: 32, carbsG: 62, fatG: 34 });
  assert.deepEqual(C.nutrition(carbonara, 9), at2, 'rescaling would second-guess the publisher');
});

test('a recipe with no stated yield carries the whole dish, divided by the count chosen', () => {
  const pie = byId('gutenberg-26558:beef-pot-pie');
  assert.equal(pie.servings, null);
  assert.ok(C.needsServings(pie));
  assert.ok(C.statesNoYield(pie));
  assert.equal(C.nutrition(pie, 1).calories, pie.caloriesTotal);
  assert.equal(C.nutrition(pie, 4).calories, pie.caloriesTotal / 4);
  assert.equal(C.nutrition(pie, 4).proteinG, pie.proteinTotal / 4);
  assert.equal(C.nutrition(pie, 0).calories, pie.caloriesTotal, 'a nonsense count divides by one');
});

test('no macros is null, never zeros', () => {
  const dressing = byId('gutenberg-26558:a-good-pennsylvania-dutch-salad-dressing');
  assert.equal(C.needsServings(dressing), false);
  assert.ok(C.statesNoYield(dressing));
  assert.equal(C.nutrition(dressing, 4), null);
  assert.equal(C.libraryFields(dressing, 4).nutritionPerServing, null);
  assert.ok(dressing.nutritionNote, 'and the note says why');
});

// MARK: - On screen

test('whole numbers on screen are rounded half away from zero, never truncated', () => {
  assert.equal(C.roundWhole(224.525), 225);
  assert.equal(C.roundWhole(2.5), 3);
  assert.equal(C.roundWhole(-2.5), -3, 'Math.round alone would say -2');
  assert.equal(C.roundWhole(2.4999), 2);
  assert.equal(C.roundWhole(0), 0);
  assert.equal(C.roundWhole(690), 690);
});

test('Beef Pot Pie at 4 servings reads 225 kcal', () => {
  const pie = byId('gutenberg-26558:beef-pot-pie');
  const n = C.nutrition(pie, 4);
  assert.equal(n.calories, 898.1 / 4, 'the quotient itself is not rounded');
  assert.ok(Math.trunc(n.calories) === 224, 'truncating would have said 224');
  assert.equal(C.macroLine(n),
    `225 kcal \u00b7 P ${C.roundWhole(pie.proteinTotal / 4)} \u00b7 C ${C.roundWhole(pie.carbsTotal / 4)} \u00b7 F ${C.roundWhole(pie.fatTotal / 4)}`);
  assert.match(C.macroLine(n), /^225 kcal /);
});

test('a browsing row rounds too, and says which kind of macros it has', () => {
  const carbonara = byId('unitools:spaghetti-carbonara');
  assert.equal(C.rowMacros(carbonara), '690 kcal per serving');
  assert.equal(C.rowMacros({ ...carbonara, caloriesPerServing: 412.5 }), '413 kcal per serving');
  assert.equal(C.rowMacros(byId('gutenberg-26558:beef-pot-pie')), 'Macros for the whole dish');
  assert.equal(C.rowMacros(byId('gutenberg-26558:a-good-pennsylvania-dutch-salad-dressing')), 'No macros');
});

test('the servings stepper shows for every recipe whose servings is null, and only those', () => {
  const nulls = all.filter((r) => r.servings == null);
  assert.equal(nulls.length, 121);
  assert.ok(nulls.some((r) => r.caloriesTotal == null), 'including ones with no macros to divide');
  all.forEach((r) => {
    assert.equal(C.showsServingsStepper(r), r.servings == null, r.id);
  });
});

test('the recipe form shows a stored macro as the cards do, and keeps the raw figure', () => {
  // showStoredMacro lifted out of app.js as it is now, against a stand-in field.
  const src = readFileSync('lift/app.js', 'utf8');
  const i = src.indexOf('function showStoredMacro(selector, value) {');
  const j = src.indexOf('function openRecipeForm(id) {', i);
  assert.ok(i >= 0 && j > i);
  const field = { value: '', dataset: {} };
  const trimNum = (v) => (Number.isInteger(v) ? String(v) : String(Math.round(v * 100) / 100));
  const show = new Function('$', 'trimNum', src.slice(i, j) + '\nreturn showStoredMacro;')(() => field, trimNum);
  const stored = 898.1 / 6;
  show('#r-cal', stored);
  assert.equal(field.value, '149.68');
  assert.equal(parseFloat(field.dataset.stored), stored, 'the quotient, unrounded, beside it');
  assert.equal(field.dataset.shown, '149.68');
  show('#r-cal', null);
  assert.deepEqual([field.value, field.dataset.stored], ['', '']);
});

// MARK: - The copy

test('a stated yield is the copy\'s serving count; the chosen one is ignored', () => {
  const carbonara = byId('unitools:spaghetti-carbonara');
  const fields = C.libraryFields(carbonara, 7);
  assert.equal(fields.servings, 2);
  assert.equal(fields.nutritionPerServing.calories, 690);
  assert.equal(fields.nutritionPerServing.estimated, true);
  assert.equal('fiberG' in fields.nutritionPerServing, false, 'the catalog states no fiber: unknown, not 0 g');
  assert.deepEqual(fields.steps, carbonara.steps);
  assert.equal(fields.sourceUrl, 'https://theunitools.com/recipes/spaghetti-carbonara');
  assert.equal(fields.sourceAuthor, 'UniTools — theunitools.com');
  assert.equal(fields.sourceTranscript, 'UniTools — theunitools.com\nCC BY-SA 4.0',
    'the credit travels with the copy; a null note adds no line');
  assert.equal(fields.prepMinutes, 10);
  assert.equal(fields.cookMinutes, 15);
  assert.equal(fields.totalWeightGrams, null);
  assert.equal('ingredients' in fields, false, 'ingredients are parsed on the save path, not here');
});

test('with no stated yield the copy takes the count chosen, and divides by it', () => {
  const pie = byId('gutenberg-26558:beef-pot-pie');
  const fields = C.libraryFields(pie, 6);
  assert.equal(fields.servings, 6);
  assert.equal(fields.nutritionPerServing.calories, pie.caloriesTotal / 6);
  assert.match(fields.sourceTranscript, /Public domain/);
  assert.ok(fields.sourceTranscript.endsWith(pie.nutritionNote), 'the costing caveat travels too');
});

test('the chosen count is held to the stepper: whole, 1 to 48, 4 when unreadable', () => {
  const pie = byId('gutenberg-26558:beef-pot-pie');
  assert.equal(C.servingsFor(pie, 0), 1);
  assert.equal(C.servingsFor(pie, 200), 48);
  assert.equal(C.servingsFor(pie, 2.6), 3);
  assert.equal(C.servingsFor(pie, 'x'), C.DEFAULT_SERVINGS);
  assert.equal(C.DEFAULT_SERVINGS, 4);
});

test('an estimate stays an estimate through the recipe form, edited or not', () => {
  // carryEstimated lifted out of app.js as it is now: LIFT iPhone's editor
  // never writes nutritionIsEstimated, so a save keeps whatever it was.
  const src = readFileSync('lift/app.js', 'utf8');
  const i = src.indexOf('function carryEstimated(nutrition, previous) {');
  const j = src.indexOf('const recipeLines', i);
  assert.ok(i >= 0 && j > i);
  const carry = new Function(src.slice(i, j) + '\nreturn carryEstimated;')();
  assert.ok(src.includes('carryEstimated(nutrition, editingRecipeId ? recipeById(editingRecipeId) : null);'),
    'the form\'s Save calls it with the recipe being edited');

  const copy = { nutritionPerServing: C.libraryFields(byId('unitools:spaghetti-carbonara'), 2).nutritionPerServing };
  const form = (calories) => ({ calories, proteinG: 32, carbsG: 62, fatG: 34, fiberG: 0 });

  assert.equal(carry(form(690), copy).estimated, true, 'saved untouched');
  assert.equal(carry(form(700), copy).estimated, true, 'a macro edited');
  const notEstimated = { nutritionPerServing: { ...copy.nutritionPerServing, estimated: false } };
  assert.equal(carry(form(700), notEstimated).estimated, false, 'false stays false');
  assert.equal('estimated' in carry(form(700), null), false, 'a new recipe has none');
  assert.equal('estimated' in carry(form(700), { nutritionPerServing: { calories: 1 } }), false,
    'a recipe that never said gains nothing');
  assert.equal(carry(null, copy), null, 'macros cleared: nowhere to hold it');
});

// MARK: - Browsing and searching

test('with no search typed, every recipe is listed, by name', () => {
  const page = C.browse(all);
  assert.equal(page.length, 622, 'all 622, not a first page');
  assert.equal(page.length, all.length);
  const names = page.map((r) => r.name);
  assert.deepEqual(names, [...names].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
  assert.equal(new Set(page.map((r) => r.id)).size, all.length, 'each once');
});

test('one character is no query', () => {
  assert.equal(C.isQuery('c'), false);
  assert.deepEqual(C.search(all, 'c'), []);
  assert.deepEqual(C.search(all, '  '), []);
});

test('carbonara is found, by a prefix of it, in any case', () => {
  ['carbonara', 'Carbon', 'CARB'].forEach((q) => {
    assert.ok(C.search(all, q).some((r) => r.id === 'unitools:spaghetti-carbonara'), q);
  });
  assert.equal(C.search(all, 'carbonara')[0].id, 'unitools:spaghetti-carbonara');
});

test('every word must match, and a name match outranks a summary match', () => {
  const both = C.search(all, 'spaghetti carbonara');
  assert.equal(both[0].id, 'unitools:spaghetti-carbonara');
  assert.ok(C.search(all, 'carbonara zzzz').length === 0);
  // "guanciale" is in carbonara's summary, not its name.
  assert.ok(C.search(all, 'guanciale').some((r) => r.id === 'unitools:spaghetti-carbonara'));
});

test('diacritics are ignored, as FTS5 unicode61 ignores them', () => {
  const accented = all.find((r) => /[À-ſ]/.test(r.name));
  assert.ok(accented, 'the file has an accented name to try');
  const plain = accented.name.normalize('NFD').replace(/\p{M}/gu, '');
  assert.ok(C.search(all, plain).some((r) => r.id === accented.id), plain);
});

test('a search returns at most forty', () => {
  assert.ok(C.search(all, 'ch').length <= 40);
});

test('the credits are every distinct attribution and licence, sorted', () => {
  const credits = C.credits(all);
  assert.deepEqual(credits, [...credits].sort());
  assert.ok(credits.includes('UniTools — theunitools.com — CC BY-SA 4.0'));
  assert.ok(credits.some((c) => c.endsWith(' — Public domain')));
});

// MARK: - The library card's estimated mark

// LIFT iPhone's CookView row says "estimated" after the macros of a recipe
// whose nutritionIsEstimated is set. Here the flag is nutritionPerServing's
// `estimated`, and the card shows the same word.
test('an estimated recipe\'s card says "estimated"', () => {
  assert.equal(C.ESTIMATED_MARK, 'estimated');
  const n = { calories: 450, proteinG: 30, carbsG: 40, fatG: 12, fiberG: 0, estimated: true };
  assert.equal(C.estimatedMark(n), 'estimated');
});

test('a recipe without the flag shows nothing new', () => {
  const macros = { calories: 450, proteinG: 30, carbsG: 40, fatG: 12, fiberG: 0 };
  assert.equal(C.estimatedMark(macros), null);
  assert.equal(C.estimatedMark({ ...macros, estimated: false }), null);
  assert.equal(C.estimatedMark({ ...macros, estimated: 'true' }), null, 'only a literal true');
  assert.equal(C.estimatedMark(null), null, 'no macros, no mark');
  assert.equal(C.estimatedMark(undefined), null);
});

test('a recipe copied from the catalogue carries the mark', () => {
  // Every catalogue recipe with macros is estimated: published figures are
  // not resolved against the food database, and the costed ones are costed.
  const r = all.find((x) => x.nutritionIsEstimated && x.caloriesPerServing != null);
  assert.ok(r);
  assert.equal(C.estimatedMark(C.libraryFields(r).nutritionPerServing), 'estimated');
});
