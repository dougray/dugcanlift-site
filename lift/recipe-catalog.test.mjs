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
    'the kit\'s exporter (tools/export_recipes_json.py) writes it.');
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

// MARK: - The copy

test('a stated yield is the copy\'s serving count; the chosen one is ignored', () => {
  const carbonara = byId('unitools:spaghetti-carbonara');
  const fields = C.libraryFields(carbonara, 7);
  assert.equal(fields.servings, 2);
  assert.equal(fields.nutritionPerServing.calories, 690);
  assert.equal(fields.nutritionPerServing.estimated, true);
  assert.equal(fields.nutritionPerServing.fiberG, 0, 'an unknown fibre as the recipe form writes one');
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

// MARK: - Browsing and searching

test('the opening page is the first sixty by name, both collections interleaved', () => {
  const page = C.browse(all);
  assert.equal(page.length, 60);
  const names = page.map((r) => r.name);
  assert.deepEqual(names, [...names].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
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
