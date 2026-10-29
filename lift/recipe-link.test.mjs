import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { deflateRawSync } from 'node:zlib';

// Loaded the way the browser loads it, like recipe-catalog.test.mjs does. Node
// has DecompressionStream, Blob, Response, atob and TextDecoder as globals, so
// this is the browser code running, not a node stand-in for it.
const shim = { window: {} };
new Function('window', readFileSync('lift/recipe-link.js', 'utf8')).call(shim, shim.window);
const L = shim.window.LiftRecipeLink;

const importer = { exports: {} };
new Function('module', readFileSync('lift/recipe-import.js', 'utf8'))(importer);
const { recipeFromJsonLdPayload } = importer.exports;

const fixture = (name) => readFileSync(`lift/fixtures/${name}`, 'utf8');
const bookmarklets = JSON.parse(readFileSync('lift/bookmarklets.json', 'utf8'));

// MARK: - The bundled bookmarklet

// bookmarklets.json is built in dugcanlift-kit/bookmarklet/ from send-recipe.js
// and copied byte for byte into every build that offers it. A copy behind the
// kit's would hand people a bookmarklet the other builds no longer agree on.
test('the bundled bookmarklets.json is the kit\'s file, byte for byte', () => {
  const sum = readFileSync('lift/bookmarklets.sha256', 'utf8').trim();
  assert.match(sum, /^[0-9a-f]{64}$/, 'lift/bookmarklets.sha256 should be one bare sha256 and nothing else');
  const actual = createHash('sha256').update(readFileSync('lift/bookmarklets.json')).digest('hex');
  assert.equal(actual, sum,
    'lift/bookmarklets.json does not match lift/bookmarklets.sha256.\n' +
    'Copy dugcanlift-kit/bookmarklet/bookmarklets.json AND bookmarklets.sha256 over together,\n' +
    'and bump CACHE in sw.js. Never edit either file here, and never re-write the checksum by\n' +
    'hand: the kit\'s build-bookmarklets.mjs writes it.');
});

test('LIFT offers the liftWeb bookmarklet, which opens this page', () => {
  const url = bookmarklets.liftWeb;
  assert.match(url, /^javascript:/);
  assert.ok(!url.includes('#'), 'a raw # would end the bookmark address early');
  const code = decodeURIComponent(url.slice('javascript:'.length));
  assert.ok(code.includes("'https://www.dugcanlift.com/lift/' + '#r1'"), 'it opens LIFT web');
  assert.ok(code.includes('no recipe LIFT can read'), 'and says LIFT by name');
});

// Runs a built javascript: URL the way a browser would, against a stand-in
// page, as the kit's own test does, and resolves with where it navigates.
function run(url, blocks, href = 'https://example.com/recipes/stew') {
  const code = decodeURIComponent(url.slice('javascript:'.length));
  return new Promise((resolve) => {
    const document = { querySelectorAll: () => blocks.map((textContent) => ({ textContent })) };
    const location = { get href() { return href; }, set href(next) { resolve({ navigated: next }); } };
    const alert = (message) => resolve({ alert: message });
    new Function('document', 'location', 'alert', code)(document, location, alert);
  });
}

test('what the bookmarklet sends, this decoder reads', async () => {
  const page = JSON.parse(readFileSync('lift/fixtures/recipe-link-expected.json', 'utf8'));
  const { navigated } = await run(bookmarklets.liftWeb, page.jsonld);
  assert.ok(navigated.startsWith('https://www.dugcanlift.com/lift/#r1'), navigated.slice(0, 40));
  assert.deepEqual(await L.decode(navigated), page);
});

// MARK: - The fixture pair

test('the fixture link decodes to the expected page', async () => {
  const link = fixture('recipe-link.txt').trim();
  assert.deepEqual(await L.decode(link), JSON.parse(fixture('recipe-link-expected.json')));
});

test('the fixture\'s fragment alone decodes the same, as location.hash hands it over', async () => {
  const link = fixture('recipe-link.txt').trim();
  const hash = link.slice(link.indexOf('#'));
  assert.ok(hash.startsWith('#r1'));
  assert.ok(L.isRecipeLink(hash));
  assert.deepEqual(await L.decode(hash), JSON.parse(fixture('recipe-link-expected.json')));
});

test('the fixture\'s blocks read as the stew, through the reader the form is filled from', async () => {
  const { jsonld } = await L.decode(fixture('recipe-link.txt').trim());
  const r = jsonld.map(recipeFromJsonLdPayload).find(Boolean);
  assert.equal(r.name, 'Beef & barley stew — crème fraîche finish \u{1F372}');
  assert.equal(r.servings, 4, 'from the page\'s own yield');
  assert.deepEqual(r.ingredientLines, ['600 g beef chuck, cubed', '150 g pearl barley', '2 carrots, diced',
    '1 onion, chopped', '1.2 L beef stock', '2 tbsp crème fraîche']);
  assert.deepEqual(r.steps, ['Brown the beef in batches.',
    'Add the vegetables, barley and stock; simmer 90 minutes.', 'Stir in the crème fraîche and serve.']);
  assert.equal(r.author, 'Ana Núñez');
  assert.deepEqual(
    [r.nutritionPerServing.calories, r.nutritionPerServing.proteinG, r.nutritionPerServing.carbsG,
      r.nutritionPerServing.fatG, r.nutritionPerServing.fiberG],
    [520, 38, 44, 20, null], 'the page\'s own nutrition, an unstated fibre left unknown');
});

// MARK: - Refusals, ported from the kit's recipe-link.test.mjs

const encode = (obj) => '#r1' + deflateRawSync(Buffer.from(JSON.stringify(obj)))
  .toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

test('refusals', async () => {
  const ok = { v: 1, url: 'https://a.example/r', jsonld: ['{"@type":"Recipe"}'] };
  assert.ok(await L.decode(encode(ok)));
  assert.equal(await L.decode('https://www.dugcanlift.com/lift/'), null, 'no fragment');
  assert.equal(await L.decode('#1zabc'), null, 'a log link is not a recipe link');
  assert.equal(L.isRecipeLink('#1zabc'), false);
  assert.equal(await L.decode('#r1!!!'), null, 'not base64url');
  assert.equal(await L.decode('#r1abc'), null, 'not deflate');
  assert.equal(await L.decode('#r1AAAA'), null, 'not deflate');
  assert.equal(await L.decode('#r1'), null, 'nothing after the prefix');
  assert.equal(await L.decode(encode({ ...ok, v: 2 })), null, 'unknown version');
  assert.equal(await L.decode(encode({ ...ok, url: 'javascript:alert(1)' })), null, 'not http(s)');
  assert.equal(await L.decode(encode({ ...ok, url: 7 })), null, 'url not a string');
  assert.equal(await L.decode(encode({ ...ok, jsonld: 'x' })), null, 'jsonld not an array');
  assert.equal(await L.decode(encode({ ...ok, jsonld: [] })), null, 'no blocks');
  assert.equal(await L.decode(encode({ ...ok, jsonld: [3, null] })), null, 'no string blocks');
  assert.equal(await L.decode(encode(null)), null, 'null');
  assert.equal(await L.decode('#r1' + deflateRawSync(Buffer.from('not json')).toString('base64url')), null, 'not JSON');
  assert.equal(await L.decode(undefined), null);
});

test('a non-string block is dropped, not fatal', async () => {
  const doc = { v: 1, url: 'http://a.example/r', jsonld: [5, '{"@type":"Recipe"}'] };
  assert.deepEqual((await L.decode(encode(doc))).jsonld, ['{"@type":"Recipe"}']);
});

test('more than MAX_BYTES once inflated is refused, and exactly MAX_BYTES is not', async () => {
  assert.equal(L.MAX_BYTES, 512 * 1024);
  const wrap = { v: 1, url: 'https://a.example/r', jsonld: [''] };
  const overhead = JSON.stringify(wrap).length;
  const fits = { ...wrap, jsonld: ['x'.repeat(L.MAX_BYTES - overhead)] };
  assert.equal(JSON.stringify(fits).length, L.MAX_BYTES);
  assert.ok(await L.decode(encode(fits)));
  const big = { ...wrap, jsonld: ['x'.repeat(L.MAX_BYTES + 1)] };
  assert.equal(await L.decode(encode(big)), null);
});

// MARK: - This build

test('nothing here can reach the network', () => {
  // The page's address rides in the link as text. It is never opened.
  const src = readFileSync('lift/recipe-link.js', 'utf8');
  ['fetch(', 'XMLHttpRequest', 'WebSocket', 'sendBeacon', 'import('].forEach((word) => {
    assert.ok(!src.includes(word), word);
  });
});
