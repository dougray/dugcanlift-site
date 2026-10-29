import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { deflateRawSync } from 'node:zlib';

// Loaded the way the browser loads it, with node's own DecompressionStream,
// Blob and atob standing in for the browser's. Run from the repo root:
// node --test coach/*.test.mjs
const shim = { window: {} };
new Function('window', readFileSync('coach/recipe-link.js', 'utf8')).call(shim, shim.window);
const L = shim.window.CoachRecipeLink;

// recipe-import.js declares plain functions for app.js to call; hand the
// reader back out. Its text is never changed here: LIFT web copies the file.
const { recipeFromJsonLdPayload } = new Function(
  readFileSync('coach/recipe-import.js', 'utf8') + '\nreturn { recipeFromJsonLdPayload };')();

// app.js's own log-link reader, taken out of app.js as written, so the test
// below checks the function the page runs rather than a copy of it.
const appSource = readFileSync('coach/app.js', 'utf8');
const extractSource = appSource.match(/\nfunction extractFragment\(text\) \{[\s\S]*?\n\}\n/);
assert.ok(extractSource, 'extractFragment is no longer where this test expects it in app.js');
const extractFragment = new Function(extractSource[0] + '\nreturn extractFragment;')();

const fixture = (name) => readFileSync(`coach/fixtures/${name}`, 'utf8');
// Written by the bookmarklet itself (dugcanlift-kit bookmarklet/fixtures).
// Never regenerate either file from this code.
const recipeLink = fixture('recipe-link.txt').trim();
const expected = JSON.parse(fixture('recipe-link-expected.json'));
const logLink = fixture('plan-log-share-link.txt').trim();

const encode = (obj) => '#r1' + deflateRawSync(Buffer.from(JSON.stringify(obj)))
  .toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/* ---------------- the bundled bookmarklets ---------------- */

// The road-food.json check, for the same reason: the panel shows whatever is
// in this file, and a stale copy is a bookmark that opens the wrong page.
test("the bundled bookmarklets.json is the kit's file, byte for byte", () => {
  const sum = readFileSync('coach/bookmarklets.sha256', 'utf8').trim();
  assert.match(sum, /^[0-9a-f]{64}$/, 'coach/bookmarklets.sha256 should be one bare sha256 and nothing else');
  const actual = createHash('sha256').update(readFileSync('coach/bookmarklets.json')).digest('hex');
  assert.equal(actual, sum,
    'coach/bookmarklets.json does not match coach/bookmarklets.sha256.\n' +
    'Copy dugcanlift-kit/bookmarklet/bookmarklets.json AND bookmarklets.sha256 over together,\n' +
    'and bump CACHE in coach/sw.js. Never edit either file here, and never re-write the\n' +
    'checksum by hand: the kit writes it (bookmarklet/build-bookmarklets.mjs).');
});

test('the Coach web bookmarklet opens this app and names Coach', () => {
  const { coachWeb } = JSON.parse(readFileSync('coach/bookmarklets.json', 'utf8'));
  assert.match(coachWeb, /^javascript:/);
  const code = decodeURIComponent(coachWeb.slice('javascript:'.length));
  assert.ok(code.includes("'https://www.dugcanlift.com/coach/' + '#r1'"), code.slice(-80));
  assert.match(code, /no recipe Coach can read/);
});

/* ---------------- decoding ---------------- */

test('the fixture link decodes to the expected page', async () => {
  assert.deepEqual(await L.decodeRecipeLink(recipeLink), expected);
});

test('the reader finds the stew in the fixture, with the page address as its source', async () => {
  const found = L.recipeFrom(await L.decodeRecipeLink(recipeLink), recipeFromJsonLdPayload);
  assert.equal(found.url, 'https://example.com/recipes/stew');
  const fill = L.formFill(found);
  assert.equal(fill.name, 'Beef & barley stew — crème fraîche finish 🍲');
  assert.equal(fill.servings, 4, 'the page said 4');
  assert.deepEqual(fill.ingredientLines, ['600 g beef chuck, cubed', '150 g pearl barley',
    '2 carrots, diced', '1 onion, chopped', '1.2 L beef stock', '2 tbsp crème fraîche']);
  assert.equal(fill.steps.length, 3);
  assert.deepEqual(fill.nutritionPerServing, {
    calories: 520, proteinG: 38, carbsG: 44, fatG: 20,
    fiberG: null, saturatedFatG: null, sugarG: null, sodiumMg: null, estimated: true,
  });
  assert.equal(fill.source.sourceUrl, 'https://example.com/recipes/stew');
  assert.equal(fill.source.sourceAuthor, 'Ana Núñez');
  assert.ok(fill.source.sourceTranscript.startsWith(expected.jsonld[0]), 'the block as published');
  assert.ok(fill.source.sourceTranscript.endsWith(L.SITE_FIGURES_NOTE));
});

test('a page with no stated yield leaves servings unset, never guessed', async () => {
  const block = JSON.stringify({ '@type': 'Recipe', name: 'Toast', recipeIngredient: ['1 slice bread'] });
  const found = L.recipeFrom(
    await L.decodeRecipeLink(encode({ v: 1, url: 'https://a.example/t', jsonld: [block] })),
    recipeFromJsonLdPayload);
  const fill = L.formFill(found);
  assert.equal(fill.servings, null);
  assert.equal(fill.nutritionPerServing, null, 'no nutrition on the page is none, not zeros');
  assert.equal(fill.source.sourceTranscript, block, 'no site-figures note without site figures');
});

test('the first block holding a recipe wins; blocks with none find nothing', async () => {
  const crumbs = JSON.stringify({ '@type': 'BreadcrumbList', name: 'Recipes' });
  const recipe = JSON.stringify({ '@type': 'Recipe', name: 'Soup' });
  const decoded = await L.decodeRecipeLink(encode({ v: 1, url: 'https://a.example/s', jsonld: [crumbs, 'not json', recipe] }));
  assert.equal(L.recipeFrom(decoded, recipeFromJsonLdPayload).recipe.name, 'Soup');
  const none = await L.decodeRecipeLink(encode({ v: 1, url: 'https://a.example/s', jsonld: [crumbs] }));
  assert.ok(none, 'it decodes');
  assert.equal(L.recipeFrom(none, recipeFromJsonLdPayload), null, 'and holds no recipe');
});

test('refusals, the reference decoder\'s exactly', async () => {
  const ok = { v: 1, url: 'https://a.example/r', jsonld: ['{"@type":"Recipe"}'] };
  assert.ok(await L.decodeRecipeLink(encode(ok)));
  assert.equal(await L.decodeRecipeLink('dugcanliftcoach://recipe'), null, 'no fragment');
  assert.equal(await L.decodeRecipeLink('#1zabc'), null, 'a log link is not a recipe link');
  assert.equal(await L.decodeRecipeLink('#r1abc'), null, 'garbage');
  assert.equal(await L.decodeRecipeLink('#r1!!!'), null, 'not base64url');
  assert.equal(await L.decodeRecipeLink('#r1AAAA'), null, 'not deflate');
  assert.equal(await L.decodeRecipeLink('#r1'), null, 'no data');
  assert.equal(await L.decodeRecipeLink(encode({ ...ok, v: 2 })), null, 'unknown version');
  assert.equal(await L.decodeRecipeLink(encode({ ...ok, url: 'javascript:alert(1)' })), null, 'not http(s)');
  assert.equal(await L.decodeRecipeLink(encode({ ...ok, url: 7 })), null, 'url not a string');
  assert.equal(await L.decodeRecipeLink(encode({ ...ok, jsonld: 'x' })), null, 'jsonld not an array');
  assert.equal(await L.decodeRecipeLink(encode({ ...ok, jsonld: [] })), null, 'no blocks');
  assert.equal(await L.decodeRecipeLink(encode({ ...ok, jsonld: [3, null] })), null, 'no string blocks');
  assert.equal(await L.decodeRecipeLink('#r1' + deflateRawSync(Buffer.from('not json'))
    .toString('base64url')), null, 'not JSON');
  assert.equal(await L.decodeRecipeLink(null), null, 'not text');
});

test('a non-string block is dropped, not fatal', async () => {
  const doc = { v: 1, url: 'http://a.example/r', jsonld: [5, '{"@type":"Recipe"}'] };
  assert.deepEqual((await L.decodeRecipeLink(encode(doc))).jsonld, ['{"@type":"Recipe"}']);
});

test('more than MAX_BYTES once inflated is refused, and MAX_BYTES itself is not', async () => {
  // `{"v":1,"url":"https://a.example/r","jsonld":[""]}` is 48 bytes before
  // the block's own characters.
  const at = (n) => ({ v: 1, url: 'https://a.example/r', jsonld: ['x'.repeat(n)] });
  const overhead = JSON.stringify(at(0)).length;
  assert.equal(await L.decodeRecipeLink(encode(at(L.MAX_BYTES + 1))), null);
  assert.ok(await L.decodeRecipeLink(encode(at(L.MAX_BYTES - overhead))), 'exactly the cap');
  assert.equal(await L.decodeRecipeLink(encode(at(L.MAX_BYTES - overhead + 1))), null, 'one byte over');
});

/* ---------------- a log link and a recipe link are never confused ---------------- */

test('a recipe link is routed as a recipe and a log link as a log, by prefix', () => {
  assert.equal(L.isRecipeLink(recipeLink), true);
  assert.equal(L.isRecipeLink('https://www.dugcanlift.com/coach/#r1abc'), true);
  assert.equal(L.isRecipeLink('r1abc'), true, 'a bare fragment');
  assert.equal(L.isRecipeLink(logLink), false);
  assert.equal(L.isRecipeLink('#1zabc'), false);
  assert.equal(L.isRecipeLink('#1uabc'), false);
  assert.equal(L.isRecipeLink(''), false);
});

test("app.js's log reader refuses a recipe link, and this decoder refuses a log link", async () => {
  assert.equal(extractFragment(recipeLink), null);
  assert.equal(extractFragment('https://www.dugcanlift.com/coach/#r1abc'), null);
  assert.equal(await L.decodeRecipeLink(logLink), null);
  // And each still reads its own.
  assert.deepEqual(Object.keys(extractFragment(logLink)), ['version', 'codec', 'data']);
  assert.equal(extractFragment(logLink).codec, 'z');
});

/* ---------------- the shared words ---------------- */

// Every build says the same thing about the bookmarklet, with its own name in
// it. app.js and index.html need a DOM to run, so this reads them as text,
// with index.html's line wrapping folded away. Change these in every build or
// in none.
test('the bookmarklet panel, the error lines and the form note use the shared words', () => {
  const page = readFileSync('coach/index.html', 'utf8').replace(/\s+/g, ' ');
  const script = appSource.replace(/'\s*\+\s*'/g, '');
  [
    'Send recipes from your browser',
    'Save this as a bookmark once. On any recipe page, tap the bookmark and the recipe opens here for you to check. Coach never visits the page.',
    'Send to Coach',
    'On a computer, drag it to your bookmarks bar.',
    '<li>Tap Copy.</li>',
    '<li>Bookmark any page.</li>',
    '<li>Edit the bookmark. Name it Send to Coach, and paste over its address.</li>',
    '<li>On a recipe page, type Send to Coach in the address bar and tap the bookmark.</li>',
    'Coach on iPhone can share a recipe from Safari instead.',
    "A recipe website's address will not work here. Use Send recipes from your browser for a website instead.",
  ].forEach((s) => assert.ok(page.includes(s), `index.html: ${s}`));
  [
    'That recipe link could not be read, so nothing was added. Open the recipe page and tap Send to Coach again.',
    'That page has no recipe Coach can read. Copy the recipe text and use Paste a recipe instead.',
    '. Check it, then Save.',
    'The page did not say how many this serves; set it before saving.',
    'Copying was blocked. Select all of the text below and copy it.',
    'Drag it to your bookmarks bar, or tap Copy and save it as a bookmark. It works on a recipe page, not here.',
  ].forEach((s) => assert.ok(script.includes(s), `app.js: ${s}`));
});
