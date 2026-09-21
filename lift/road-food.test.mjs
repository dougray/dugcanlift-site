import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';

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
});
