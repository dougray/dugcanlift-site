import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

// Loaded the way the browser loads it, like sides.test.mjs does.
const shim = { window: {} };
new Function('window', readFileSync('lift/road-food.js', 'utf8')).call(shim, shim.window);
const R = shim.window.LiftRoadFood;

const item = (name, kcal, proteinG, sodiumMg) => ({ name, kcal, proteinG, sodiumMg });
const names = (list) => list.map((i) => i.name);

// MARK: - No goal

test('with no goal, everything is ranked by protein per 100 kcal alone', () => {
  const r = R.rank([
    item('low', 500, 10, 100),      // 2 per 100
    item('high', 200, 40, 900),     // 20 per 100
    item('mid', 400, 30, 300),      // 7.5 per 100
    item('huge', 2000, 120, 3000),  // 6 per 100 -- no calorie cut without a goal
  ], null);
  assert.equal(r.mode, 'noGoal');
  assert.deepEqual(names(r.fits), ['high', 'mid', 'huge', 'low']);
  assert.deepEqual(r.over, []);
});

test('a goal with no calorie number is no goal', () => {
  assert.equal(R.rank([item('a', 100, 10, 1)], { calories: null, proteinG: 50 }).mode, 'noGoal');
  assert.equal(R.rank([item('a', 100, 10, 1)], undefined).mode, 'noGoal');
});

// MARK: - Fits and a little over

test('everything fits: one ranked group and nothing over', () => {
  const r = R.rank([item('a', 300, 15, 500), item('b', 200, 30, 400), item('c', 640, 40, 1000)],
    { calories: 640, proteinG: 55 });
  assert.equal(r.mode, 'goal');
  assert.deepEqual(names(r.fits), ['b', 'c', 'a']);
  assert.deepEqual(r.over, []);
});

test('nothing fits: fits is empty, and only the 10% band is offered', () => {
  const r = R.rank([item('near', 330, 30, 500), item('far', 900, 60, 1200)], { calories: 300, proteinG: 55 });
  assert.deepEqual(r.fits, []);
  assert.deepEqual(names(r.over), ['near']);
});

test('a day already over its calories: only a zero-calorie item fits, and nothing is a little over', () => {
  const r = R.rank([item('cola', 0, 0, 40), item('bar', 200, 20, 180)], { calories: -150, proteinG: 10 });
  assert.deepEqual(names(r.fits), ['cola'], 'a zero-calorie drink still fits nothing left');
  assert.deepEqual(r.over, []);
});

test('the 10% boundary: exactly 10% over is a little over, one calorie past it is hidden', () => {
  const r = R.rank([
    item('exactly-left', 640, 30, 500),
    item('exactly-10', 704, 30, 500),
    item('past-10', 705, 30, 500),
  ], { calories: 640, proteinG: 55 });
  assert.deepEqual(names(r.fits), ['exactly-left']);
  assert.deepEqual(names(r.over), ['exactly-10']);
  // 30 x 1.1 is 33.000000000000004 in floating point; the integer comparison
  // must not let that decide it either way.
  const small = R.rank([item('33', 33, 1, 1), item('34', 34, 1, 1)], { calories: 30 });
  assert.deepEqual(names(small.over), ['33']);
});

test('the over group is ranked by the same rule as fits', () => {
  const r = R.rank([item('lean', 700, 60, 900), item('fatty', 690, 20, 900)], { calories: 640 });
  assert.deepEqual(names(r.over), ['lean', 'fatty']);
});

// MARK: - Blank stays blank

test('missing protein ranks after every known protein, never as zero', () => {
  const r = R.rank([
    { name: 'unknown', kcal: 300, sodiumMg: 100 },
    item('diet-cola', 0, 0, 40),
    item('some', 300, 5, 900),
  ], { calories: 640 });
  assert.deepEqual(names(r.fits), ['some', 'diet-cola', 'unknown']);
  assert.equal(R.proteinPer100({ kcal: 300 }), null);
  assert.equal(R.proteinPer100({ kcal: 300, proteinG: null }), null);
});

test('missing calories cannot fit, and ranks last with no goal', () => {
  const r = R.rank([{ name: 'no-kcal', proteinG: 30 }, item('ok', 300, 10, 1)], { calories: 640 });
  assert.deepEqual(names(r.fits), ['ok']);
  const n = R.rank([{ name: 'no-kcal', proteinG: 30 }, item('ok', 300, 10, 1)], null);
  assert.deepEqual(names(n.fits), ['ok', 'no-kcal']);
});

test('ties go to lower sodium, and a missing sodium loses the tie rather than winning as zero', () => {
  const r = R.rank([
    item('salty', 200, 20, 1200),
    { name: 'unlisted', kcal: 200, proteinG: 20 },
    item('mild', 200, 20, 300),
  ], { calories: 640 });
  assert.deepEqual(names(r.fits), ['mild', 'salty', 'unlisted']);
});

test('density, not grams: a small high-protein item beats a big one', () => {
  assert.deepEqual(names(R.rank([item('big', 600, 45, 1), item('small', 150, 25, 1)], null).fits), ['small', 'big']);
  assert.equal(R.proteinPer100(item('x', 200, 30)), 15);
  assert.equal(R.proteinPer100(item('x', 0, 0)), 0);
  assert.equal(R.proteinPer100(item('x', 0, 5)), Infinity);
});

// MARK: - A coach's picks

const withId = (id, kcal, proteinG, sodiumMg) => ({ id, name: id, kcal, proteinG, sodiumMg });

test("picks go to the top of a group and change nothing underneath", () => {
  const items = [
    withId('a', 300, 15, 500),   // 5 per 100
    withId('b', 200, 30, 400),   // 15
    withId('c', 640, 40, 1000),  // 6.25
    withId('d', 100, 2, 200),    // 2
  ];
  const remaining = { calories: 640, proteinG: 55 };
  const plain = R.rank(items, remaining);
  assert.deepEqual(names(plain.fits), ['b', 'c', 'a', 'd']);

  const picked = R.withPicks(R.rank(items, remaining), ['a', 'd']);
  assert.deepEqual(names(picked.fits), ['a', 'd', 'b', 'c']);
  assert.equal(picked.count, 2);
  assert.deepEqual(Object.keys(picked.picked).sort(), ['a', 'd']);
  // Within each part, the nutrition order is exactly what it was: the picks
  // in their own order, then everything else in theirs.
  assert.deepEqual(names(picked.fits).slice(0, 2), names(plain.fits).filter((n) => n === 'a' || n === 'd'));
  assert.deepEqual(names(picked.fits).slice(2), names(plain.fits).filter((n) => n !== 'a' && n !== 'd'));
  assert.equal(picked.mode, 'goal');
});

test('an id the bundled data does not have is skipped silently, never a row', () => {
  const items = [withId('a', 300, 15, 500), withId('b', 200, 30, 400)];
  const picked = R.withPicks(R.rank(items, { calories: 640 }), ['gone-2019', 'a', '', null, 7]);
  assert.deepEqual(names(picked.fits), ['a', 'b']);
  assert.equal(picked.count, 1, 'only what is here is counted, so no card promises a missing row');
  assert.equal(picked.fits.length, 2, 'nothing is added for an id nothing knows');
});

test('no picks at all leaves the ranking exactly as it was', () => {
  const items = [withId('a', 300, 15, 500), withId('b', 200, 30, 400), withId('c', 700, 60, 100)];
  const remaining = { calories: 640, proteinG: 55 };
  const plain = R.rank(items, remaining);
  [[], null, undefined].forEach((ids) => {
    const picked = R.withPicks(R.rank(items, remaining), ids);
    assert.deepEqual(names(picked.fits), names(plain.fits));
    assert.deepEqual(names(picked.over), names(plain.over));
    assert.equal(picked.count, 0);
  });
});

test('a pick that is a little over stays a little over: the fit rule is the day talking', () => {
  const items = [withId('fits', 300, 15, 500), withId('over', 700, 60, 100)];
  const picked = R.withPicks(R.rank(items, { calories: 640 }), ['over']);
  assert.deepEqual(names(picked.fits), ['fits']);
  assert.deepEqual(names(picked.over), ['over'], 'floated to the top of its own group, not out of it');
  assert.equal(picked.count, 1);
});

test('an item too far over is hidden whether or not it was picked', () => {
  const items = [withId('fits', 300, 15, 500), withId('way-over', 2000, 60, 100)];
  const picked = R.withPicks(R.rank(items, { calories: 640 }), ['way-over']);
  assert.deepEqual(names(picked.fits), ['fits']);
  assert.deepEqual(names(picked.over), []);
  assert.equal(picked.count, 0, 'a pick nobody can see is not counted as shown');
});

test('with no goal the picks lead the one ranked list', () => {
  const items = [withId('a', 500, 10, 100), withId('b', 200, 40, 900), withId('c', 400, 30, 300)];
  const picked = R.withPicks(R.rank(items, null), ['a']);
  assert.equal(picked.mode, 'noGoal');
  assert.deepEqual(names(picked.fits), ['a', 'b', 'c']);
});

test('pickCount counts a place without drawing its list', () => {
  const items = [withId('a', 1, 1, 1), withId('b', 1, 1, 1)];
  assert.equal(R.pickCount(items, ['b', 'gone']), 1);
  assert.equal(R.pickCount(items, []), 0);
  assert.equal(R.pickCount([], ['a']), 0);
});

// MARK: - How old the numbers are

test('six calendar months is the line, and a missing date is said to be missing', () => {
  assert.equal(R.isStale('2026-03-20', '2026-09-20'), false, 'exactly six months is not over');
  assert.equal(R.isStale('2026-03-20', '2026-09-21'), true);
  assert.equal(R.isStale('2026-09-20', '2026-09-20'), false);
  assert.equal(R.isStale('2026-03-31', '2026-09-30'), false, 'end of month clamps, not rolls');
  assert.equal(R.isStale('2026-03-31', '2026-10-01'), true);
  assert.equal(R.isStale(undefined, '2026-09-20'), null);
  assert.equal(R.isStale('2026-02-30', '2026-09-20'), null);
});

test("the warning keys off the chain's own document date, and falls back to when it was read", () => {
  // Burger King: a NOVEMBER 2022 chart read this morning. The day it was read
  // says nothing about how old the numbers are, so it is not what is measured.
  assert.equal(R.ageDate({ publishedOn: '2022-11', checkedOn: '2026-09-23' }), '2022-11');
  assert.equal(R.isStale(R.ageDate({ publishedOn: '2022-11', checkedOn: '2026-09-23' }), '2026-09-23'), true);
  // A chain whose document states no date is exactly as it was before this:
  // the day a person read it is all there is to go on.
  assert.equal(R.ageDate({ checkedOn: '2026-09-20' }), '2026-09-20');
  assert.equal(R.isStale(R.ageDate({ checkedOn: '2026-09-20' }), '2026-09-23'), false);
  assert.equal(R.isStale(R.ageDate({ checkedOn: '2025-12-01' }), '2026-09-23'), true);
  // A fresh document read long ago is not stale, and a stale document read
  // this morning is: the document is the fact, not the reading.
  assert.equal(R.isStale(R.ageDate({ publishedOn: '2026-09-02', checkedOn: '2025-01-01' }), '2026-09-23'), false);
  // Neither date is no date, which the screen says in its own words.
  assert.equal(R.ageDate({}), null);
  assert.equal(R.ageDate(null), null);
});

test('a month-only document date is read as the first of that month', () => {
  // "NOVEMBER 2022" is all Burger King's chart says, so no day is invented:
  // the first of the month can only make a document look older, never fresher.
  assert.equal(R.parseDocDay('2022-11').getTime(), new Date(2022, 10, 1).getTime());
  assert.equal(R.parseDocDay('2021-03-29').getTime(), new Date(2021, 2, 29).getTime());
  assert.equal(R.isStale('2026-03', '2026-09-01'), false, 'exactly six months is not over');
  assert.equal(R.isStale('2026-03', '2026-09-02'), true);
  assert.equal(R.parseDocDay('2022-13'), null);
  assert.equal(R.parseDocDay('2022'), null);
  assert.equal(R.parseDocDay(undefined), null);
  assert.equal(R.isStale('2022-13', '2026-09-23'), null);
});

// MARK: - Rules, picker, logging

test('plain rules apply everywhere; kinded ones only to their kind', () => {
  const rules = ['Grilled over fried', { text: 'Bowl not tortilla', kinds: ['mexican'] }, { text: 'Anywhere' }, 7];
  assert.deepEqual(R.rulesFor(rules, 'burgers'), ['Grilled over fried', 'Anywhere']);
  assert.deepEqual(R.rulesFor(rules, 'mexican'), ['Grilled over fried', 'Bowl not tortilla', 'Anywhere']);
  assert.deepEqual(R.rulesFor(undefined, 'x'), []);
});

test('recent chains first, most recent first, the rest by name', () => {
  const chains = [{ id: 'c', name: 'Cee' }, { id: 'a', name: 'Aye' }, { id: 'b', name: 'Bee' }];
  const o = R.orderChains(chains, ['b', 'gone', 'b']);
  assert.deepEqual(o.recent.map((c) => c.id), ['b']);
  assert.deepEqual(o.rest.map((c) => c.id), ['a', 'c']);
  assert.deepEqual(R.remember(['a', 'b', 'c'], 'c', 3), ['c', 'a', 'b']);
  assert.deepEqual(R.remember(['a', 'b', 'c'], 'd', 3), ['d', 'a', 'b']);
});

test('a logged item is an ordinary entry, and what it does not list is absent, not zero', () => {
  const e = R.entryFor({ name: 'Grilled Test Sandwich', kcal: 370, proteinG: 34, fatG: 10, carbsG: 37,
    saturatedFatG: 2.04, sodiumMg: 930.4 }, 'Sample Burger Co', { id: 'x', date: '2026-09-20', meal: 'LUNCH' });
  assert.deepEqual(e, {
    name: 'Grilled Test Sandwich (Sample Burger Co)', servings: 1,
    calories: 370, proteinG: 34, fatG: 10, carbsG: 37,
    saturatedFatG: 2, sodiumMg: 930,
    id: 'x', date: '2026-09-20', meal: 'LUNCH',
  });
  assert.equal('fiberG' in e, false);
  assert.equal('sugarG' in e, false);
  const zero = R.entryFor({ name: 'Diet Test Cola', kcal: 0, proteinG: 0, sugarG: 0 });
  assert.equal(zero.sugarG, 0, 'a listed zero is a value and is kept');
  assert.equal(zero.calories, 0);
});

// MARK: - The fixture is the spec's data format

test('the sample fixture uses only obviously fake names, in the spec shape', () => {
  const data = JSON.parse(readFileSync('lift/fixtures/road-food-sample.json', 'utf8'));
  assert.equal(data.version, 1);
  assert.ok(data.chains.every((c) => /^(Sample|Example|Fictional) /.test(c.name)));
  assert.ok(data.chains.every((c) => c.id && c.checkedOn && c.source && Array.isArray(c.items)));
  assert.ok(Array.isArray(data.snacks) && Array.isArray(data.rules));
  // One chain of each kind, so the sample shows all three states: a document
  // dated to the day, one that names only a month, and one that states none.
  const by = (id) => data.chains.find((c) => c.id === id);
  assert.equal(by('sample-burger-co').publishedOn, '2026-09-02');
  assert.equal(by('fictional-taco-stand').publishedOn, '2024-10');
  assert.equal('publishedOn' in by('example-chicken-shack'), false);
  // And the month-only one is old on its document date while its checked date
  // is recent, which is the whole point of the field.
  assert.equal(R.isStale(R.ageDate(by('fictional-taco-stand')), '2026-09-23'), true);
  assert.equal(R.isStale(by('fictional-taco-stand').checkedOn, '2026-09-23'), false);
});

test('every chain in the curated file states a usable pair of dates', () => {
  const data = JSON.parse(readFileSync('lift/road-food.json', 'utf8'));
  for (const c of data.chains) {
    assert.ok(R.parseDocDay(c.checkedOn), `${c.id} has no usable checkedOn`);
    if ('publishedOn' in c) {
      assert.ok(R.parseDocDay(c.publishedOn), `${c.id} has an unusable publishedOn`);
      assert.ok(R.parseDocDay(c.publishedOn) <= R.parseDocDay(c.checkedOn),
        `${c.id} claims a document published after it was read`);
    }
  }
  // The three charts this field exists for.
  const by = (id) => data.chains.find((c) => c.id === id);
  assert.equal(by('burgerking').publishedOn, '2022-11');
  assert.equal(by('whataburger').publishedOn, '2021-03-29');
  assert.equal(by('chipotle').publishedOn, '2024-10');
  for (const id of ['burgerking', 'whataburger', 'chipotle']) {
    assert.equal(R.isStale(by(id).checkedOn, '2026-09-23'), false, `${id} looks fresh by checkedOn alone`);
    assert.equal(R.isStale(R.ageDate(by(id)), '2026-09-23'), true, `${id} should be old by its own chart`);
  }
});

// MARK: - The copies are the same bytes

// road-food.json is curated once in dugcanlift-kit/data/ and copied byte for
// byte into five app repos. Nothing used to check that they matched: every
// repo said so in prose, and the shape checks above pass just as happily on a
// copy three chains behind, so nothing here would ever say it had. Item ids are
// the contract a coach's road picks travel on, and an id the receiving build
// does not have is skipped in silence, by design.
//
// So the kit writes the sha256 of the bytes to road-food.sha256, and that file
// is copied across with the JSON. Hashing the bytes here catches both ways the
// copy can rot: taking the JSON without the hash, and editing the JSON here.
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

// Read as bytes, never as a decoded string: the contract is over the file, and
// a re-encoded string is not guaranteed to be the same bytes.
const pinned = (jsonPath, sumPath) => {
  const sum = readFileSync(sumPath, 'utf8').trim();
  assert.match(sum, /^[0-9a-f]{64}$/, `${sumPath} should be one bare sha256 and nothing else`);
  return { sum, actual: sha256(readFileSync(jsonPath)) };
};

test('the bundled road-food.json is the kit\'s file, byte for byte', () => {
  const { sum, actual } = pinned('lift/road-food.json', 'lift/road-food.sha256');
  assert.equal(actual, sum,
    'lift/road-food.json does not match lift/road-food.sha256.\n' +
    'Copy dugcanlift-kit/data/road-food.json AND data/road-food.sha256 over together.\n' +
    'Never edit either file here, and never re-write the checksum by hand: the kit\'s\n' +
    'validator writes it (node data/validate-road-food.mjs --write-checksum) and the\n' +
    'other four app repos pin the same one.');
});

test('the sample fixture is the same bytes the other apps hold', () => {
  // The fixture is shared too: dugcanlift-lift's src/debug asset, lift-ios's
  // Tests/Fixtures copy and the inline copy in RoadFoodSample.swift are all
  // meant to be these exact bytes.
  const { sum, actual } = pinned('lift/fixtures/road-food-sample.json', 'lift/fixtures/road-food-sample.sha256');
  assert.equal(actual, sum,
    'lift/fixtures/road-food-sample.json does not match its checksum.\n' +
    'The fixture is shared with dugcanlift-lift and lift-ios. Change it in all three,\n' +
    'and re-write all three checksums:\n' +
    "  shasum -a 256 lift/fixtures/road-food-sample.json | cut -d' ' -f1 > lift/fixtures/road-food-sample.sha256");
});
