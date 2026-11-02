import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';

// A port of LIFT iOS's PlateMathTests, case for case, then this build's own:
// one pound rack in localStorage, and the line under a set.
const shim = { window: {} };
new Function('window', readFileSync('lift/plates.js', 'utf8')).call(shim, shim.window);
const P = shim.window.LiftPlates;

const plates = (perSide, total, shortBy) => ({ kind: 'plates', perSide, total, shortBy });

function memoryStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
  };
}

/* ---------------- which bar ---------------- */

test('the bar comes from the name and the equipment', () => {
  assert.equal(P.barOf('Barbell Squat', 'barbell'), 'barbell');
  assert.equal(P.barOf('Bench Press', 'Barbell'), 'barbell');
  assert.equal(P.barOf('EZ-Bar Curl', 'e-z curl bar'), 'ezBar');
  // The exercise data files some EZ-bar lifts under "barbell".
  assert.equal(P.barOf('Close-Grip EZ Bar Curl', 'barbell'), 'ezBar');
  // And every Smith machine lift under "machine", or even "barbell".
  assert.equal(P.barOf('Smith Machine Squat', 'machine'), 'smith');
  assert.equal(P.barOf('Smith Incline Shoulder Raise', 'barbell'), 'smith');
  assert.equal(P.barOf('Trap Bar Deadlift', null), 'trapBar');
  assert.equal(P.barOf('Hex Bar Deadlift', 'other'), 'trapBar');
  assert.equal(P.barOf('Back squat', 'Smith machine'), 'smith');
});

test('lifts without a bar get no plates', () => {
  assert.equal(P.barOf('Dumbbell Bench Press', 'dumbbell'), null);
  assert.equal(P.barOf('Leg Press', 'machine'), null);
  assert.equal(P.barOf('Pull-up', 'body only'), null);
  assert.equal(P.barOf('Bench Press', null), null);
  // One end in the floor: "per side" means nothing.
  assert.equal(P.barOf("Landmine 180's", 'barbell'), null);
  assert.equal(P.barOf('T-Bar Row with Handle', 'barbell'), null);
  assert.equal(P.barOf('Bent Over One-Arm Long Bar Row', 'barbell'), null);
  assert.equal(P.barOf('Single-Arm Linear Jammer', 'barbell'), null);
});

test('EZ bar spellings', () => {
  assert.equal(P.barOf('EZBar Curl', 'barbell'), 'ezBar');
  assert.equal(P.barOf('Reverse EZ Curl', 'barbell'), 'ezBar');
  // "Blacksmith" is not a Smith machine.
  assert.equal(P.barOf('Blacksmith Squat', 'barbell'), 'barbell');
});

/* ---------------- loading ---------------- */

const gymPounds = () => P.standard('lb');
const gymKilos = () => P.standard('kg');

test('an exact load in pounds', () => {
  assert.deepEqual(P.loadFor(225, 'barbell', gymPounds()), plates([45, 45], 225, 0));
  assert.deepEqual(P.loadFor(185, 'barbell', gymPounds()), plates([45, 25], 185, 0));
  assert.deepEqual(P.loadFor(140, 'barbell', gymPounds()), plates([45, 2.5], 140, 0));
});

test('an exact load in kilograms', () => {
  assert.deepEqual(P.loadFor(102.5, 'barbell', gymKilos()), plates([25, 15, 1.25], 102.5, 0));
});

// Fewest plates, then heavier plates first: 70 a side is 45 + 25, and 35 + 35
// only when there are no 25s.
test('fewest plates wins', () => {
  assert.equal(P.loadFor(185, 'barbell', gymPounds()).perSide.length, 2);
  const noTwentyFives = gymPounds();
  P.setPairs(noTwentyFives, 0, 25);
  assert.deepEqual(P.loadFor(185, 'barbell', noTwentyFives), plates([35, 35], 185, 0));
});

// A home gym with one pair of 45s and one of 25s cannot make 225.
test('what you own limits the load', () => {
  const home = gymPounds();
  home.plates.forEach((p) => P.setPairs(home, 0, p.weight));
  P.setPairs(home, 1, 45);
  P.setPairs(home, 1, 25);
  assert.deepEqual(P.loadFor(225, 'barbell', home), plates([45, 25], 185, 40));
});

// Greedy takes the 45 and then cannot make 15 out of 10s it does not own.
test('it is not greedy', () => {
  const setup = gymPounds();
  setup.plates.forEach((p) => P.setPairs(setup, 0, p.weight));
  P.setPairs(setup, 1, 45);
  P.setPairs(setup, 2, 30);
  assert.deepEqual(P.loadFor(165, 'barbell', setup), plates([30, 30], 165, 0));
});

test('a weight that needs half a plate is rounded down and says so', () => {
  assert.deepEqual(P.loadFor(227, 'barbell', gymPounds()), plates([45, 45], 225, 2));
});

// Heavier than the bar by less than the smallest plate owned: the bar, and how
// far short, never "just the bar" as if that were the set.
test('less than the smallest plate over the bar', () => {
  const load = P.loadFor(47.5, 'barbell', gymPounds());
  assert.deepEqual(load, plates([], 45, 2.5));
  assert.equal(P.line(load, 'lb'), 'Your plates make 45 lb, 2.5 short. Just the bar');
});

test('an absurd weight is bounded by the rack', () => {
  const load = P.loadFor(100000000, 'barbell', gymPounds());
  assert.equal(load.kind, 'plates');
  assert.equal(load.perSide.length, 60);
  assert.equal(load.total, 45 + 2 * 1225);
  assert.ok(load.shortBy > 0);
});

test('the bar alone, and less than the bar', () => {
  assert.deepEqual(P.loadFor(45, 'barbell', gymPounds()), { kind: 'justTheBar' });
  assert.deepEqual(P.loadFor(30, 'barbell', gymPounds()), { kind: 'lighterThanTheBar' });
  assert.deepEqual(P.loadFor(0, 'barbell', gymPounds()), { kind: 'nothing' });
});

test('each bar has its own weight', () => {
  assert.deepEqual(P.loadFor(75, 'ezBar', gymPounds()), plates([25], 75, 0));
  const setup = gymPounds();
  P.setBar(setup, 'trapBar', 60);
  assert.deepEqual(P.loadFor(150, 'trapBar', setup), plates([45], 150, 0));
});

// iOS's case is a weight stored in kilograms coming back to pounds as
// 224.99999. This build stores pounds, but the rounding is the same rule.
test('a converted weight is not short by a hair', () => {
  const total = (225 * 0.45359237) / 0.45359237;
  assert.deepEqual(P.loadFor(total, 'barbell', gymPounds()), plates([45, 45], 225, 0));
  assert.deepEqual(P.loadFor(224.999999, 'barbell', gymPounds()), plates([45, 45], 225, 0));
});

/* ---------------- words ---------------- */

test('the line', () => {
  assert.equal(P.line(plates([45, 25, 2.5], 190, 0), 'lb'), 'Per side: 45 · 25 · 2.5');
  assert.equal(P.line(plates([45, 25], 185, 40), 'lb'),
    'Your plates make 185 lb, 40 short. Per side: 45 · 25');
  assert.equal(P.line({ kind: 'justTheBar' }, 'lb'), 'Just the bar');
  assert.equal(P.line({ kind: 'lighterThanTheBar' }, 'kg'), 'Lighter than the bar');
  assert.equal(P.line({ kind: 'nothing' }, 'lb'), null);
});

test('the line under a set reads the pound rack, and only for a bar', () => {
  assert.equal(P.setLine('Barbell Squat', 'barbell', 225, gymPounds()), 'Per side: 45 · 45');
  assert.equal(P.setLine('Dumbbell Bench Press', 'dumbbell', 60, gymPounds()), null);
  assert.equal(P.setLine('Barbell Squat', 'barbell', null, gymPounds()), null);
  assert.equal(P.setLine('Barbell Squat', 'barbell', undefined, gymPounds()), null);
});

test('bar names are iOS\'s', () => {
  assert.deepEqual(P.BARS.map((b) => b.displayName), ['Barbell', 'EZ bar', 'Trap bar', 'Smith machine']);
  assert.equal(P.barName('ezBar'), 'EZ bar');
});

/* ---------------- setup ---------------- */

test('the standard racks', () => {
  assert.deepEqual(gymPounds().plates.map((p) => p.weight), [45, 35, 25, 10, 5, 2.5, 1.25]);
  assert.deepEqual(gymKilos().plates.map((p) => p.weight), [25, 20, 15, 10, 5, 2.5, 1.25, 0.5]);
  assert.equal(P.barWeight(gymPounds(), 'barbell'), 45);
  assert.equal(P.barWeight(gymKilos(), 'barbell'), 20);
  // Fractional plates are not in most gyms; they are there to be added.
  assert.equal(P.pairsOf(gymPounds(), 1.25), 0);
  assert.equal(P.pairsOf(gymKilos(), 0.5), 0);
});

test('a setup is kept per unit', () => {
  const storage = memoryStorage();
  assert.deepEqual(P.load('lb', storage), gymPounds());
  const mine = gymPounds();
  P.setPairs(mine, 2, 45);
  P.setBar(mine, 'barbell', 35);
  P.save(mine, 'lb', storage);
  assert.deepEqual(P.load('lb', storage), mine);
  assert.deepEqual(P.load('kg', storage), gymKilos());
  assert.equal(P.key('lb'), 'lift.plateSetup.pounds');
});

test('an unreadable setup is the standard one', () => {
  const storage = memoryStorage();
  storage.setItem(P.key('lb'), 'nonsense');
  assert.deepEqual(P.load('lb', storage), gymPounds());
  storage.setItem(P.key('lb'), JSON.stringify({ plates: [{ weight: 'x', pairs: 1 }], bars: {} }));
  assert.deepEqual(P.load('lb', storage), gymPounds());
  const throwing = { getItem: () => { throw new Error('blocked'); } };
  assert.deepEqual(P.load('lb', throwing), gymPounds());
});

test('pairs are held to what a rack holds, and a new plate goes in order', () => {
  const setup = gymPounds();
  P.setPairs(setup, 99, 45);
  assert.equal(P.pairsOf(setup, 45), P.MOST_PAIRS);
  P.setPairs(setup, -3, 45);
  assert.equal(P.pairsOf(setup, 45), 0);
  P.setPairs(setup, 2, 15);
  assert.deepEqual(setup.plates.map((p) => p.weight), [45, 35, 25, 15, 10, 5, 2.5, 1.25]);
  P.setBar(setup, 'smith', -5);
  assert.equal(P.barWeight(setup, 'smith'), 0);
});
