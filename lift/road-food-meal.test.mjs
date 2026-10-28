import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';

// A port of LIFT iOS's RoadFoodMealTests, case for case.
const shim = { window: {} };
new Function('window', readFileSync('lift/road-food.js', 'utf8')).call(shim, shim.window);
const R = shim.window.LiftRoadFood;
const M = R.meal;

const sandwich = { id: 'x-sandwich', name: 'Sandwich', kcal: 420.4, proteinG: 31.6, fatG: 12, carbsG: 40 };
const milk = { id: 'x-milk', name: '1% Milk', kcal: 100, proteinG: 8, fatG: 2.5, carbsG: 12 };
const unlisted = { id: 'x-secret', name: 'Secret menu', kcal: 300, proteinG: null, fatG: 10, carbsG: 30 };
const menu = [sandwich, milk, unlisted];
const ids = (list) => list.map((i) => i.id);

test('items add up as they would be logged', () => {
  let meal = M.empty();
  meal = M.add(meal, sandwich);
  meal = M.add(meal, milk);
  meal = M.add(meal, milk);
  assert.equal(M.itemCount(meal), 3);
  assert.equal(M.count(meal, milk.id), 2);
  // Rounded per item, as each entry is logged: 420 + 100 + 100.
  assert.deepEqual(M.total(meal, menu), { kcal: 620, proteinG: 48 });
  assert.deepEqual(ids(M.items(meal, menu)), [sandwich.id, milk.id, milk.id]);
  // And it is the same rounding the logged entries carry.
  const logged = M.items(meal, menu).map((i) => R.entryFor(i, 'X'));
  assert.equal(logged.reduce((t, e) => t + e.calories, 0), 620);
  assert.equal(logged.reduce((t, e) => t + e.proteinG, 0), 48);
});

// An item that can't be added can't be in a total either: a sum missing one
// item's protein would be a smaller number passed off as the whole.
test('an item without its protein cannot be added', () => {
  let meal = M.empty();
  meal = M.add(meal, unlisted);
  assert.equal(M.isEmpty(meal), true);
  assert.equal(M.canAdd(unlisted), false);
  assert.equal(M.canAdd({ id: 'x-nokcal', name: 'n', proteinG: 5 }), false);
  assert.equal(M.canAdd(milk), true);
});

test('removing takes one and then the line', () => {
  let meal = M.empty();
  meal = M.add(meal, milk);
  meal = M.add(meal, milk);
  meal = M.remove(meal, milk);
  assert.equal(M.count(meal, milk.id), 1);
  meal = M.remove(meal, milk);
  assert.equal(M.isEmpty(meal), true);
  meal = M.remove(meal, milk);
  assert.equal(M.isEmpty(meal), true);
});

test('the line says what is left', () => {
  let meal = M.empty();
  meal = M.add(meal, sandwich);
  meal = M.add(meal, milk);
  assert.equal(M.line(meal, menu, { calories: 900.7, proteinG: 60 }),
    '2 items · 520 kcal · 40 g protein · fits, 380 kcal to spare');
  assert.equal(M.line(meal, menu, { calories: 400, proteinG: 60 }),
    '2 items · 520 kcal · 40 g protein · 120 kcal over what is left');
  assert.equal(M.line(meal, menu, { calories: 520, proteinG: 60 }),
    '2 items · 520 kcal · 40 g protein · uses exactly what is left');
  assert.equal(M.line(meal, menu, null), '2 items · 520 kcal · 40 g protein');
});

// A menu that has lost an item since it was added logs nothing for it.
test('an item no longer on the menu is dropped', () => {
  let meal = M.empty();
  meal = M.add(meal, sandwich);
  meal = M.add(meal, milk);
  assert.deepEqual(ids(M.items(meal, [milk])), [milk.id]);
});

// A plain value: nothing is changed in place.
test('adding returns a new meal and leaves the old one alone', () => {
  const before = M.add(M.empty(), milk);
  const after = M.add(before, milk);
  assert.equal(M.count(before, milk.id), 1);
  assert.equal(M.count(after, milk.id), 2);
});
