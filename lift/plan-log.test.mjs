import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';

// Loaded the way the browser loads it, in index.html's order, like
// sides.test.mjs does. Run from the repo root: node --test lift/*.test.mjs
const shim = { window: {} };
['sides.js', 'plan-log.js'].forEach((file) => {
  new Function('window', readFileSync(`lift/${file}`, 'utf8')).call(shim, shim.window);
});
const PlanLog = shim.window.LiftPlanLog;

/* The week everything below sits in: Mon 12 Oct 2026 to Sun 18 Oct 2026.
 * "today" is Thu 15 Oct unless a test says otherwise, so the week has three
 * days behind it, one being lived, and three still ahead -- which is the
 * state this card exists for. */
const MON = '2026-10-12';
const TUE = '2026-10-13';
const WED = '2026-10-14';
const THU = '2026-10-15';
const FRI = '2026-10-16';
const SAT = '2026-10-17';
const SUN = '2026-10-18';
const TODAY = THU;

let seq = 0;
const id = () => `id${++seq}`;

/** A prescribed set, as importTraining writes one: every field present, and
 *  unprescribed is null rather than absent. */
const ask = (weightLb, reps, extra = {}) => ({
  weightLb, reps, rpe: null, durationSec: null, distanceMeters: null, ...extra,
});
/** A logged set, as the session screen writes one: only fields that were
 *  actually filled in. */
const did = (weightLb, reps, extra = {}) => {
  const set = { id: id() };
  if (weightLb != null) set.weightLb = weightLb;
  if (reps != null) set.reps = reps;
  return { ...set, ...extra };
};

const asked = (name, equipment, sets, extra = {}) =>
  ({ name, equipment, note: '', sets, ...extra });
const logged = (name, equipment, sets) => ({ id: id(), name, equipment, sets });

const plan = (date, name, exercises, extra = {}) =>
  ({ id: id(), date, fromCoach: 'Doug', startedSessionId: null, name, exercises, ...extra });
const session = (date, name, exercises) => ({ id: id(), date, name, note: '', exercises });

/** A meal a coach booked, as importPlan writes one out of a plan's `m` entry:
 *  the dish's name snapshotted beside the slot, and `fromCoach` on it exactly
 *  as a prescribed session carries it. */
const meal = (date, slot, recipeName, servings = 1, extra = {}) => ({
  id: id(), recipeId: id(), recipeName, date, meal: slot, servings,
  snapshotNutrition: { calories: 600, proteinG: 40, fatG: 20, carbsG: 50, fiberG: 6 },
  loggedFoodEntryId: null, fromCoach: 'Doug', ...extra,
});
/** A meal placed on this device, which carries no coach at all. */
const myMeal = (date, slot, recipeName, servings = 1) => {
  const m = meal(date, slot, recipeName, servings);
  delete m.fromCoach;
  return m;
};
/** A food entry, as the Food screen writes one. The card is handed these and
 *  reads not one field of them -- see the tests below. */
const ate = (date, slot, name) => ({
  id: id(), name, servings: 1, calories: 600, proteinG: 40, fatG: 20, carbsG: 50,
  fiberG: 6, date, loggedAt: 1, meal: slot,
});

const run = (training, workouts, over = {}) => PlanLog.compare({
  training, workouts, today: TODAY, anchor: TODAY, ...over,
});
const day = (result, i) => result.days[i];

/* A fixed pair used by several tests: Monday's "Lower A" booked and logged
 * whole, Tuesday's "Upper B" booked and nothing logged, Wednesday free and
 * trained anyway, Friday booked and still ahead. */
const WEEK_TRAINING = () => [
  plan(MON, 'Lower A', [
    asked('Back Squat', 'Barbell', [ask(225, 5), ask(225, 5), ask(245, 3)]),
    asked('Romanian Deadlift', 'Barbell', [ask(185, 8), ask(185, 8), ask(185, 8), ask(185, 8)]),
    asked('Bulgarian Split Squat', 'Dumbbell', [ask(40, 8), ask(40, 8), ask(40, 8)], { eachSide: true }),
    asked('Overhead Press', 'Barbell', [ask(95, 8)]),
  ]),
  plan(TUE, 'Upper B', [asked('Bench Press', 'Barbell', [ask(185, 5), ask(185, 5)])]),
  plan(FRI, 'Lower B', [
    asked('Front Squat', 'Barbell', [ask(165, 5), ask(165, 5)]),
    asked('Split Squat', 'Dumbbell', [ask(35, 10), ask(35, 10)], { eachSide: true }),
  ]),
];
const WEEK_WORKOUTS = () => [
  session(MON, 'Lower A', [
    logged('Back Squat', 'Barbell', [did(225, 5), did(225, 5), did(245, 2)]),
    logged('Romanian Deadlift', 'Barbell', [did(185, 8), did(185, 8), did(185, 6)]),
    logged('Bulgarian Split Squat', 'Dumbbell', [
      did(40, 8, { side: 'left' }), did(40, 8, { side: 'left' }), did(40, 5, { side: 'left' }),
      did(40, 8, { side: 'right' }), did(40, 8, { side: 'right' })]),
    logged('Leg Press', 'Machine', [did(300, 10), did(300, 10), did(300, 10)]),
  ]),
  session(WED, 'Arms', [logged('Barbell Curl', 'Barbell', [did(65, 10), did(65, 10)])]),
];

/* ---------------- a week with a plan and a complete log ---------------- */

test('a week booked and logged whole reads back as logged, lift by lift', () => {
  const r = run(
    [plan(MON, 'Lower A', [
      asked('Back Squat', 'Barbell', [ask(225, 5), ask(225, 5), ask(245, 3)])])],
    [session(MON, 'Lower A', [
      logged('Back Squat', 'Barbell', [did(225, 5), did(225, 5), did(245, 3)])])]);
  assert.equal(r.head, 'Booked 1 day, 12–18 Oct · logged 1');
  assert.deepEqual(PlanLog.lines(r), [
    'Booked 1 day, 12–18 Oct · logged 1',
    'Mon 12 Oct · Lower A · logged',
    'Back Squat (Barbell)',
    'Asked 225 x 5 · 225 x 5 · 245 x 3',
    'Logged 225 x 5 · 225 x 5 · 245 x 3',
    PlanLog.FOOTER,
  ]);
});

/* ---------------- a partial log ---------------- */

test('a partial log prints both rows and aligns nothing', () => {
  const r = run(WEEK_TRAINING(), WEEK_WORKOUTS());
  const mon = day(r, 0);
  assert.equal(mon.state, 'logged');
  const rdl = mon.exercises.find((e) => e.key.startsWith('romanian'));
  assert.equal(rdl.countLine, 'Asked 4 sets · logged 3');
  assert.equal(rdl.asked.text, '185 x 8 · 185 x 8 · 185 x 8 · 185 x 8');
  assert.equal(rdl.logged.text, '185 x 8 · 185 x 8 · 185 x 6');
});

test('a lift the plan asked for and the log does not hold reads "not logged"', () => {
  const r = run(WEEK_TRAINING(), WEEK_WORKOUTS());
  const press = day(r, 0).exercises.find((e) => e.key.startsWith('overhead press'));
  assert.equal(press.title, 'Overhead Press (Barbell) · not logged');
  assert.equal(press.asked, null, 'a lift nothing was logged against is one line, not a recital');
  assert.equal(press.logged, null);
});

test('a lift nobody asked for is counted against nothing, under Also logged', () => {
  const r = run(WEEK_TRAINING(), WEEK_WORKOUTS());
  assert.deepEqual(day(r, 0).alsoLogged.map((e) => e.text), ['Leg Press (Machine) · 3 sets']);
});

test('a booked day in the past with nothing logged reads "not logged", never "missed"', () => {
  const r = run(WEEK_TRAINING(), WEEK_WORKOUTS());
  const tue = r.days.find((d) => d.key === TUE);
  assert.equal(tue.state, 'notLogged');
  assert.equal(tue.text, 'Tue 13 Oct · Upper B · not logged');
  assert.deepEqual(tue.exercises.map((e) => e.title), ['Bench Press (Barbell) · not logged']);
  assert.deepEqual(tue.exercises.map((e) => e.asked), [null],
    'the day is one tap away and its own prescribed card still holds every set');
});

test('the head counts the week without grading it', () => {
  const r = run(WEEK_TRAINING(), WEEK_WORKOUTS());
  assert.equal(r.head,
    'Booked 3 days, 12–18 Oct · logged 1 · 1 to do · 1 other day logged');
  assert.deepEqual(r.counts,
    { booked: 3, training: 3, meals: 0, logged: 1, notLogged: 1, toDo: 1, other: 1 });
});

/* ---------------- days still ahead ---------------- */

test('a booked day that has not happened yet is "to do", not an absence', () => {
  const r = run(WEEK_TRAINING(), WEEK_WORKOUTS());
  const fri = r.days.find((d) => d.key === FRI);
  assert.equal(fri.state, 'toDo');
  assert.equal(fri.text, 'Fri 16 Oct · Lower B · to do');
  assert.equal(fri.openable, false, 'Train cannot be scrolled to a day that has not happened');
});

test('a day still ahead prints what it asks for, because nowhere else can', () => {
  const r = run(WEEK_TRAINING(), WEEK_WORKOUTS());
  const fri = r.days.find((d) => d.key === FRI);
  assert.deepEqual(fri.exercises.map((e) => e.title),
    ['Front Squat (Barbell)', 'Split Squat (Dumbbell) · each side']);
  assert.equal(fri.exercises[0].asked.text, '165 x 5 · 165 x 5');
  assert.equal(fri.exercises[1].asked.text, '35 x 10 · 35 x 10 each side');
  assert.equal(fri.exercises[0].logged, null);
});

test('a day still ahead is never a row of noughts', () => {
  const r = run(WEEK_TRAINING(), WEEK_WORKOUTS());
  const fri = r.days.find((d) => d.key === FRI);
  assert.equal(fri.exercises[1].sideLine, 'Each side · L 2 · R 2');
  assert.equal(fri.exercises[0].sideLine, null);
  assert.equal(fri.exercises[0].countLine, null);
});

test('today is still to do until something is logged against it', () => {
  const r = run([plan(THU, 'Upper A', [asked('Bench Press', 'Barbell', [ask(185, 5)])])], []);
  assert.equal(day(r, 0).state, 'toDo');
  assert.equal(day(r, 0).text, 'Thu 15 Oct · Upper A · to do');
  assert.equal(day(r, 0).openable, true);
});

test('a week booked entirely in the days ahead does not open with a nought', () => {
  const r = run([plan(FRI, 'Lower B', [asked('Front Squat', 'Barbell', [ask(165, 5)])]),
    plan(SAT, 'Upper B', [asked('Bench Press', 'Barbell', [ask(185, 5)])])], []);
  assert.equal(r.head, 'Booked 2 days, 12–18 Oct · 2 to do');
});

test('a week that is over says what it counted, whatever it counted', () => {
  const r = run([plan(MON, 'Lower A', [asked('Back Squat', 'Barbell', [ask(225, 5)])])], [],
    { today: '2026-10-25', anchor: THU });
  assert.equal(r.head, 'Booked 1 day, 12–18 Oct · logged 0');
  assert.equal(day(r, 0).state, 'notLogged');
});

/* ---------------- a session done on a different day ---------------- */

test('a session lifted the day after the one it was booked for is two rows, adjacent', () => {
  const r = run(
    [plan(TUE, 'Upper B', [asked('Bench Press', 'Barbell', [ask(185, 5), ask(185, 5)])])],
    [session(WED, 'Upper B', [logged('Bench Press', 'Barbell', [did(185, 5), did(185, 5)])])]);
  assert.deepEqual(r.days.map((d) => d.text), [
    'Tue 13 Oct · Upper B · not logged',
    'Wed 14 Oct · Upper B · not booked',
  ]);
  assert.equal(r.head, 'Booked 1 day, 12–18 Oct · logged 0 · 1 other day logged');
});

test('nothing claims the moved session answered the booking', () => {
  const r = run(
    [plan(TUE, 'Upper B', [asked('Bench Press', 'Barbell', [ask(185, 5)])])],
    [session(WED, 'Upper B', [logged('Bench Press', 'Barbell', [did(185, 5)])])]);
  const wed = r.days.find((d) => d.key === WED);
  assert.equal(wed.state, 'notBooked');
  assert.deepEqual(wed.exercises, [], 'a day nobody booked is held against no prescription');
  assert.deepEqual(wed.alsoLogged.map((e) => e.text), ['Bench Press (Barbell) · 1 set']);
  assert.equal(r.counts.logged, 0);
});

test('a day of your own inside a week nobody booked is not a card at all', () => {
  assert.equal(run([], WEEK_WORKOUTS()), null);
});

/* ---------------- sides ---------------- */

test('an each-side lift short on one side reads L 3/3 · R 2/3', () => {
  const r = run(WEEK_TRAINING(), WEEK_WORKOUTS());
  const split = day(r, 0).exercises.find((e) => e.key.startsWith('bulgarian'));
  assert.equal(split.title, 'Bulgarian Split Squat (Dumbbell) · each side');
  assert.equal(split.sideLine, 'L 3/3 · R 2/3');
  assert.equal(split.asked.text, '40 x 8 · 40 x 8 · 40 x 8 each side');
  assert.equal(split.logged.text,
    'L 40 x 8 · 40 x 8 · 40 x 5   R 40 x 8 · 40 x 8');
});

test('the side counts are the session header’s own, not a second reading', () => {
  const Sides = shim.window.LiftSides;
  const askedSets = [ask(40, 8), ask(40, 8), ask(40, 8)];
  const loggedSets = [did(40, 8, { side: 'left' }), did(40, 8, { side: 'left' }),
    did(40, 5, { side: 'left' }), did(40, 8, { side: 'right' }), did(40, 8, { side: 'right' })];
  const r = run(
    [plan(MON, 'Lower A', [asked('Split Squat', 'Dumbbell', askedSets, { eachSide: true })])],
    [session(MON, 'Lower A', [logged('Split Squat', 'Dumbbell', loggedSets)])]);
  assert.equal(day(r, 0).exercises[0].sideLine,
    Sides.targetsLabel(askedSets, true, loggedSets));
});

test('over is shown as over, never capped', () => {
  const r = run(
    [plan(MON, 'Lower A', [
      asked('Split Squat', 'Dumbbell', [ask(40, 8), ask(40, 8), ask(40, 8)], { eachSide: true })])],
    [session(MON, 'Lower A', [logged('Split Squat', 'Dumbbell', [
      did(40, 8, { side: 'left' }), did(40, 8, { side: 'left' }),
      did(40, 8, { side: 'left' }), did(40, 8, { side: 'left' }),
      did(40, 8, { side: 'right' }), did(40, 8, { side: 'right' }),
      did(40, 8, { side: 'right' })])])]);
  assert.equal(day(r, 0).exercises[0].sideLine, 'L 4/3 · R 3/3');
});

test('an each-side exercise’s ask is twice its tuples', () => {
  const r = run(
    [plan(MON, 'Lower A', [
      asked('Split Squat', 'Dumbbell', [ask(40, 8), ask(40, 8), ask(40, 8)], { eachSide: true })])],
    [session(MON, 'Lower A', [logged('Split Squat', 'Dumbbell', [did(40, 8, { side: 'left' })])])]);
  assert.equal(day(r, 0).exercises[0].sideLine, 'L 1/3 · R 0/3');
});

test('a named side on a lift that is not each side is one set on that side', () => {
  const r = run(
    [plan(MON, 'Lower A', [asked('Calf Raise', 'Machine',
      [ask(90, 12), ask(90, 12, { side: 'left' })])])],
    [session(MON, 'Lower A', [logged('Calf Raise', 'Machine',
      [did(90, 12), did(90, 12, { side: 'left' })])])]);
  const ex = day(r, 0).exercises[0];
  assert.equal(ex.title, 'Calf Raise (Machine)', 'not each side');
  assert.equal(ex.sideLine, 'L 1/1 · 1/1 both');
  assert.equal(ex.asked.text, 'L 90 x 12   Both 90 x 12');
});

test('a plan with no sides produces no side line at all', () => {
  const r = run(
    [plan(MON, 'Lower A', [asked('Back Squat', 'Barbell', [ask(225, 5), ask(225, 5)])])],
    [session(MON, 'Lower A', [logged('Back Squat', 'Barbell', [did(225, 5), did(225, 5)])])]);
  assert.equal(day(r, 0).exercises[0].sideLine, null);
});

test('sides logged against a plan that asked for none are still said', () => {
  const r = run(
    [plan(MON, 'Lower A', [asked('Calf Raise', 'Machine', [ask(90, 12), ask(90, 12)])])],
    [session(MON, 'Lower A', [logged('Calf Raise', 'Machine',
      [did(90, 12, { side: 'left' }), did(90, 12, { side: 'right' })])])]);
  assert.equal(day(r, 0).exercises[0].sideLine, 'L 1 · R 1');
});

test('sets logged before per-side logging are a Both group beside the two limbs', () => {
  const r = run(
    [plan(MON, 'Lower A', [asked('Calf Raise', 'Machine', [ask(90, 12)])])],
    [session(MON, 'Lower A', [logged('Calf Raise', 'Machine',
      [did(90, 12), did(90, 12, { side: 'left' }), did(90, 12, { side: 'right' })])])]);
  assert.equal(day(r, 0).exercises[0].logged.text,
    'L 90 x 12   R 90 x 12   Both 90 x 12');
});

/* ---------------- warmups ---------------- */

test('warmups are excluded from the counts on both sides', () => {
  const r = run(
    [plan(MON, 'Lower A', [asked('Back Squat', 'Barbell', [ask(225, 5), ask(225, 5)])])],
    [session(MON, 'Lower A', [logged('Back Squat', 'Barbell', [
      did(95, 5, { warmup: true }), did(135, 5, { warmup: true }),
      did(225, 5), did(225, 5)])])]);
  const ex = day(r, 0).exercises[0];
  assert.equal(ex.logged.text, '225 x 5 · 225 x 5');
  assert.equal(ex.countLine, null, 'two working sets asked, two logged');
});

test('a lift that was all warmups is not a lift that was logged', () => {
  const r = run(
    [plan(MON, 'Lower A', [asked('Back Squat', 'Barbell', [ask(225, 5)])])],
    [session(MON, 'Lower A', [
      logged('Back Squat', 'Barbell', [did(225, 5)]),
      logged('Treadmill', 'Machine', [did(null, null, { warmup: true })])])]);
  assert.deepEqual(day(r, 0).alsoLogged, []);
});

test('a warmup on a side is still a warmup: flags are masked, never compared', () => {
  // flags 0, 1, 2, 3, 4, 5 -- the six a client can send. Only 1, 3 and 5 are
  // warmups, and `warmup === true` on a sided set is the case `flags === 1`
  // used to get wrong.
  const Sides = shim.window.LiftSides;
  const sets = [0, 1, 2, 3, 4, 5].map((flags) => ({ id: id(), ...Sides.decodeSet([90, 12, null, null, null, flags]) }));
  const r = run(
    [plan(MON, 'Lower A', [asked('Calf Raise', 'Machine', [ask(90, 12)])])],
    [session(MON, 'Lower A', [logged('Calf Raise', 'Machine', sets)])]);
  // 0, 2 and 4 survive: both, left, right. 1, 3 and 5 are their warmups.
  assert.equal(day(r, 0).exercises[0].logged.text,
    'L 90 x 12   R 90 x 12   Both 90 x 12');
});

/* ---------------- a lift substituted ---------------- */

test('a substitution is one pair on name alone, labelled', () => {
  const r = run(
    [plan(MON, 'Lower A', [asked('Bench Press', 'Barbell', [ask(185, 5), ask(185, 5)])])],
    [session(MON, 'Lower A', [logged('Bench Press', 'Smith machine', [did(185, 5), did(185, 5)])])]);
  const ex = day(r, 0).exercises[0];
  assert.equal(ex.state, 'logged');
  assert.equal(ex.substitution, 'Asked Barbell · logged Smith machine');
  assert.deepEqual(day(r, 0).alsoLogged, [], 'a substitution is one row, not two');
});

test('an exact name and equipment match always wins over a name-only one', () => {
  const r = run(
    [plan(MON, 'Pull', [
      asked('Lat Pulldown', 'Cable', [ask(120, 10)]),
      asked('Lat Pulldown', 'Machine', [ask(140, 10)])])],
    [session(MON, 'Pull', [
      logged('Lat Pulldown', 'Machine', [did(140, 10)]),
      logged('Lat Pulldown', 'Cable', [did(120, 10)])])]);
  const [cable, machine] = day(r, 0).exercises;
  assert.equal(cable.logged.text, '120 x 10');
  assert.equal(machine.logged.text, '140 x 10');
  assert.equal(cable.substitution, null);
  assert.equal(machine.substitution, null);
});

test('a lift with no equipment either side says so in words', () => {
  const r = run(
    [plan(MON, 'Core', [asked('Plank', '', [ask(null, null, { durationSec: 60 })])])],
    [session(MON, 'Core', [logged('Plank', 'Band', [did(null, null, { durationSec: 45 })])])]);
  assert.equal(day(r, 0).exercises[0].substitution,
    'Asked no equipment · logged Band');
});

/* ---------------- pooling ---------------- */

test('the same lift asked for twice in a day is one prescription of more sets', () => {
  const r = run(
    [plan(MON, 'Lower A', [
      asked('Back Squat', 'Barbell', [ask(225, 5)]),
      asked('Back Squat', 'Barbell', [ask(245, 3)])])],
    [session(MON, 'Lower A', [logged('Back Squat', 'Barbell', [did(225, 5), did(245, 3)])])]);
  assert.equal(day(r, 0).exercises.length, 1);
  assert.equal(day(r, 0).exercises[0].asked.text, '225 x 5 · 245 x 3');
});

test('the same lift logged twice in a day pools too', () => {
  const r = run(
    [plan(MON, 'Lower A', [asked('Back Squat', 'Barbell', [ask(225, 5), ask(245, 3)])])],
    [session(MON, 'Lower A', [
      logged('Back Squat', 'Barbell', [did(225, 5)]),
      logged('Back Squat', 'Barbell', [did(245, 3)])])]);
  assert.equal(day(r, 0).exercises[0].logged.text, '225 x 5 · 245 x 3');
  assert.deepEqual(day(r, 0).alsoLogged, []);
});

/* ---------------- which session answers a booking ---------------- */

test('the session started from the booking is the one compared', () => {
  const booked = session(MON, 'Lower A', [logged('Back Squat', 'Barbell', [did(225, 5)])]);
  const own = session(MON, 'Arms', [logged('Barbell Curl', 'Barbell', [did(65, 10)])]);
  const r = run(
    [plan(MON, 'Lower A', [asked('Back Squat', 'Barbell', [ask(225, 5)])],
      { startedSessionId: booked.id })],
    [own, booked]);
  assert.equal(day(r, 0).exercises[0].logged.text, '225 x 5');
  assert.deepEqual(day(r, 0).alsoLogged.map((e) => e.text), ['Barbell Curl (Barbell) · 1 set']);
});

test('a booking whose started session was deleted falls back to the day', () => {
  const r = run(
    [plan(MON, 'Lower A', [asked('Back Squat', 'Barbell', [ask(225, 5)])],
      { startedSessionId: 'gone' })],
    [session(MON, 'Lower A', [logged('Back Squat', 'Barbell', [did(225, 5)])])]);
  assert.equal(day(r, 0).state, 'logged');
  assert.equal(day(r, 0).exercises[0].logged.text, '225 x 5');
});

test('a booked day whose only session is empty has nothing logged against it', () => {
  const r = run(
    [plan(MON, 'Lower A', [asked('Back Squat', 'Barbell', [ask(225, 5)])])],
    [session(MON, '', [])]);
  assert.equal(day(r, 0).state, 'notLogged');
  assert.equal(r.days.length, 1, 'an empty session is not an "other day logged" either');
});

/* ---------------- blank stays blank ---------------- */

test('blank stays blank: reps with no weight is "5 reps", never "0 x 5"', () => {
  assert.equal(PlanLog.setText({ reps: 5 }), '5 reps');
  assert.equal(PlanLog.setText({ weightLb: 225 }), '225 lb');
  assert.equal(PlanLog.setText({}), 'as written');
  assert.equal(PlanLog.setText({ durationSec: 600, distanceMeters: 1600 }), '1600 m 10:00');
  assert.equal(PlanLog.setText({ durationSec: 45 }), '45s');
  assert.equal(PlanLog.setText({ weightLb: 225, reps: 5, rpe: 8 }), '225 x 5 @8');
});

test('a conditioning piece keeps its blanks through the card', () => {
  const r = run(
    [plan(MON, 'Conditioning', [asked('Row', 'Machine',
      [ask(null, null, { durationSec: 600, distanceMeters: 1600 })])])],
    [session(MON, 'Conditioning', [logged('Row', 'Machine',
      [did(null, null, { durationSec: 540, distanceMeters: 1600 })])])]);
  const ex = day(r, 0).exercises[0];
  assert.equal(ex.asked.text, '1600 m 10:00');
  assert.equal(ex.logged.text, '1600 m 9:00');
});

/* ---------------- the week ---------------- */

test('the week runs Monday to Sunday, whichever day it is anchored on', () => {
  assert.deepEqual(PlanLog.weekOf(MON), [MON, SUN]);
  assert.deepEqual(PlanLog.weekOf(THU), [MON, SUN]);
  assert.deepEqual(PlanLog.weekOf(SUN), [MON, SUN]);
  assert.deepEqual(PlanLog.weekOf('2026-10-19'), ['2026-10-19', '2026-10-25']);
});

test('a week that crosses a month says both months', () => {
  assert.equal(PlanLog.rangeText('2026-09-28', '2026-10-04'), '28 Sep–4 Oct');
  assert.equal(PlanLog.rangeText(MON, SUN), '12–18 Oct');
  assert.equal(PlanLog.rangeText(MON, MON), '12 Oct');
});

test('only the anchored week is read: last week’s plan is not this week’s', () => {
  const r = run([plan('2026-10-05', 'Lower A', [asked('Back Squat', 'Barbell', [ask(225, 5)])])],
    []);
  assert.equal(r, null);
  const back = run([plan('2026-10-05', 'Lower A', [asked('Back Squat', 'Barbell', [ask(225, 5)])])],
    [], { anchor: '2026-10-05' });
  assert.equal(back.head, 'Booked 1 day, 5–11 Oct · logged 0');
});

test('a day row says which day it is, because a week can cross a month', () => {
  const r = run([plan('2026-10-01', 'Lower A', [asked('Back Squat', 'Barbell', [ask(225, 5)])])],
    [], { anchor: '2026-10-01', today: '2026-10-01' });
  assert.equal(day(r, 0).text, 'Thu 1 Oct · Lower A · to do');
  assert.equal(r.head, 'Booked 1 day, 28 Sep–4 Oct · 1 to do');
});

test('the arrows move between weeks a coach booked, never into an empty one', () => {
  const training = [
    plan('2026-09-28', 'Lower A', [asked('Back Squat', 'Barbell', [ask(225, 5)])]),
    plan(MON, 'Lower A', [asked('Back Squat', 'Barbell', [ask(225, 5)])]),
    plan('2026-11-02', 'Lower A', [asked('Back Squat', 'Barbell', [ask(225, 5)])]),
  ];
  // Two empty weeks sit between 12 Oct and 2 Nov, and the arrow skips both --
  // a card that vanished on the way would take its own arrows with it.
  assert.equal(PlanLog.adjacentWeek(training, MON, 1), '2026-11-02');
  assert.equal(PlanLog.adjacentWeek(training, MON, -1), '2026-09-28');
  assert.equal(PlanLog.adjacentWeek(training, '2026-09-28', -1), null);
  assert.equal(PlanLog.adjacentWeek(training, '2026-11-02', 1), null);
  assert.equal(PlanLog.adjacentWeek([], MON, 1), null);
});

test('a week reached by an arrow is the same card as one reached by a date', () => {
  const training = [plan('2026-09-28', 'Lower A', [asked('Back Squat', 'Barbell', [ask(225, 5)])])];
  const back = PlanLog.adjacentWeek(training, MON, -1);
  const r = run(training, [], { anchor: back });
  assert.equal(r.head, 'Booked 1 day, 28 Sep\u20134 Oct \u00b7 logged 0');
});

/* ---------------- a week with no plan at all ---------------- */

test('a plan never accepted is no card and no explanation', () => {
  assert.equal(run([], []), null);
  assert.equal(PlanLog.lines(null).length, 0);
});

test('a week with no booking is no card, however much was logged in it', () => {
  const r = run([plan('2026-10-05', 'Lower A', [asked('Back Squat', 'Barbell', [ask(225, 5)])])],
    WEEK_WORKOUTS());
  assert.equal(r, null, 'your own training is never held up against a plan nobody wrote');
});

test('a prescription with no date, or a junk one, books nothing', () => {
  assert.equal(run([{ id: 'x', name: 'Lower A', exercises: [] }], []), null);
  assert.equal(run([{ id: 'x', date: 17, name: 'Lower A', exercises: [] }], []), null);
});

/* ---------------- the meals a coach booked ----------------
 *
 * The card states them and says nothing about the food log, whatever the food
 * log holds. Coach's card does the other half -- the foods a client stamped
 * with that slot, a count above them, a note under the card -- and none of it
 * is repeated here: see the head of plan-log.js for why at length. */

const MEAL_WEEK = () => [
  meal(MON, 'BREAKFAST', 'Overnight Oats', 1),
  meal(MON, 'DINNER', 'Beef Chilli', 2),
  meal(FRI, 'DINNER', 'Beef Chilli', 2),
];

/* The four shapes a day's food can take, none of which the card reads. Coach
 * distinguishes three of them because a client chooses per send whether to
 * itemise; on this device a log is always itemised, so "totals only" cannot
 * even arise -- it is pinned anyway, so the card cannot start reading one. */
const FULL_LOG = () => [ate(MON, 'BREAKFAST', 'Overnight Oats'), ate(MON, 'DINNER', 'Beef Chilli')];
const PARTIAL_LOG = () => [ate(MON, 'DINNER', 'Beef Chilli')];
const TOTALS_ONLY = () => [ate(MON, null, 'Monday')];

test('a week of booked meals states each one, in the order a day is eaten', () => {
  const r = run(WEEK_TRAINING(), WEEK_WORKOUTS(), { plan: MEAL_WEEK(), food: FULL_LOG() });
  const mon = day(r, 0);
  assert.deepEqual(mon.meals.map((m) => m.title), [
    'Breakfast · Overnight Oats · 1 serving',
    'Dinner · Beef Chilli · 2 servings',
  ]);
  assert.equal(mon.text, 'Mon 12 Oct · Lower A · logged · 2 meals booked');
});

test('a meal row is the slot, the dish and how much of it, and nothing else', () => {
  const r = run([], [], { plan: [meal(MON, 'DINNER', 'Beef Chilli', 2)], today: MON, anchor: MON });
  const row = day(r, 0).meals[0];
  // `spokenTitle` is `title` said -- the same three facts with the `·`
  // between them read as a comma, and no fourth fact.
  assert.deepEqual(Object.keys(row).sort(),
    ['date', 'detail', 'name', 'servings', 'slot', 'slotLabel', 'spokenTitle', 'title']);
  assert.equal(row.spokenTitle, 'Dinner, Beef Chilli, 2 servings');
  // The whole line and its two columns cannot drift: the view draws the
  // columns and the tests read the line.
  assert.equal(row.title, `${row.slotLabel} · ${row.detail}`);
  assert.equal(row.detail, 'Beef Chilli · 2 servings');
});

test('nothing on a meal row says anything about what was eaten', () => {
  const r = run(WEEK_TRAINING(), WEEK_WORKOUTS(), { plan: MEAL_WEEK(), food: FULL_LOG() });
  const every = PlanLog.lines(r).join(' · ').toLowerCase();
  ['logged at', 'nothing logged at', 'not itemised', 'no food logged',
    'foods logged', 'not tied to a meal', 'only they know', 'only you know at'
  ].forEach((phrase) => assert.equal(every.includes(phrase), false,
    `"${phrase}" reached a screen: ${every}`));
  // Coach's per-slot verdict and its note have no counterpart here at all.
  assert.equal(r.mealFooter, undefined);
  r.days.forEach((d) => d.meals.forEach((m) => {
    assert.equal(m.logged, undefined, 'a meal row holds no verdict');
    assert.equal(m.state, undefined);
  }));
  assert.equal(r.days.some((d) => d.foodContext !== undefined), false);
});

test('what the food log holds changes nothing on a meal row', () => {
  const lines = (food) => PlanLog.lines(
    run(WEEK_TRAINING(), WEEK_WORKOUTS(), { plan: MEAL_WEEK(), food }));
  const full = lines(FULL_LOG());
  // Itemised whole, itemised in part, shaped like a day's totals with nothing
  // tied to a meal, and no food at all: one card, four times.
  assert.deepEqual(lines(PARTIAL_LOG()), full);
  assert.deepEqual(lines(TOTALS_ONLY()), full);
  assert.deepEqual(lines([]), full);
  assert.deepEqual(lines(undefined), full);
});

test('the card reads no food log, in the source as well as in its output', () => {
  // Comments are stripped first: the head of the file discusses the food log at
  // length, and says loggedFoodEntryId by name to explain why it is not read.
  const code = readFileSync('lift/plan-log.js', 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  ['food', 'Food', 'calorie', 'kcal', 'nutrition', 'Nutrition', 'macro',
    'proteinG', 'loggedFoodEntryId', 'snapshotNutrition']
    .forEach((token) => assert.equal(code.includes(token), false,
      `${token} is read by the card`));
});

test('a meal you placed yourself is not your coach’s plan', () => {
  const own = [myMeal(MON, 'DINNER', 'Beef Chilli', 2), myMeal(FRI, 'LUNCH', 'Overnight Oats')];
  // Your own note-taking is not an expectation, and Cook is where you move it.
  assert.equal(run([], [], { plan: own }), null);
  const r = run(WEEK_TRAINING(), WEEK_WORKOUTS(), { plan: own.concat(MEAL_WEEK()) });
  assert.deepEqual(day(r, 0).meals.map((m) => m.title), [
    'Breakfast · Overnight Oats · 1 serving',
    'Dinner · Beef Chilli · 2 servings',
  ]);
  assert.equal(r.counts.meals, 3);
  assert.deepEqual(PlanLog.bookedMeals(own), []);
});

test('a plan of meals with no training is a card, where before there was none', () => {
  const r = run([], [], { plan: MEAL_WEEK() });
  assert.notEqual(r, null);
  assert.deepEqual(PlanLog.lines(r), [
    'Booked 2 days, 12–18 Oct · 3 meals booked · 1 to do',
    'Mon 12 Oct · 2 meals booked',
    'Meals',
    'Breakfast · Overnight Oats · 1 serving',
    'Dinner · Beef Chilli · 2 servings',
    'Fri 16 Oct · 1 meal booked · to do',
    'Meals',
    'Dinner · Beef Chilli · 2 servings',
    PlanLog.FOOTER,
  ]);
  assert.deepEqual(r.days.map((d) => d.state), ['meals', 'toDo']);
  assert.deepEqual(r.days.map((d) => d.exercises), [[], []]);
});

test('a booked meal on a day still ahead is to do, not an absence', () => {
  const r = run([], [], { plan: [meal(FRI, 'DINNER', 'Beef Chilli', 2)] });
  assert.equal(day(r, 0).state, 'toDo');
  assert.equal(day(r, 0).text, 'Fri 16 Oct · 1 meal booked · to do');
  assert.equal(r.head, 'Booked 1 day, 12–18 Oct · 1 meal booked · 1 to do');
});

test('a day in the past that booked only food carries no verdict at all', () => {
  const r = run([], [], { plan: [meal(MON, 'DINNER', 'Beef Chilli', 2)], food: FULL_LOG() });
  assert.equal(day(r, 0).state, 'meals');
  assert.equal(day(r, 0).text, 'Mon 12 Oct · 1 meal booked');
  // Never "not logged" against a meal, and no word standing in for one.
  Object.values(PlanLog.WORDS).forEach((word) =>
    assert.equal(day(r, 0).text.includes(word), false, `${word} judged a meal`));
  assert.equal(r.head, 'Booked 1 day, 12–18 Oct · 1 meal booked');
});

test('a day booked for food that you trained anyway says both, on one row', () => {
  const r = run([], [session(MON, 'Arms', [logged('Barbell Curl', 'Barbell', [did(65, 10)])])],
    { plan: [meal(MON, 'DINNER', 'Beef Chilli', 2)] });
  // Coach's word for training nobody booked, on the row rather than in a second
  // row of its own: this card opens one date at a time.
  assert.deepEqual(r.days.map((d) => d.text),
    ['Mon 12 Oct · Arms · not booked · 1 meal booked']);
  assert.deepEqual(day(r, 0).alsoLogged.map((e) => e.text), ['Barbell Curl (Barbell) · 1 set']);
  assert.deepEqual(day(r, 0).meals.map((m) => m.title), ['Dinner · Beef Chilli · 2 servings']);
  assert.equal(r.counts.other, 1);
});

test('a booked session keeps its own name and its blank', () => {
  // The fallback to a logged session's name is for a day that books no session
  // at all. A booking with a blank name reads as it always has.
  const r = run([plan(MON, '', [asked('Back Squat', 'Barbell', [ask(225, 5)])])],
    [session(MON, 'Arms', [logged('Back Squat', 'Barbell', [did(225, 5)])])]);
  assert.equal(day(r, 0).text, 'Mon 12 Oct · logged');
});

test('two dishes at one meal are two dishes, in the order they were booked', () => {
  const r = run([], [], { plan: [
    meal(MON, 'DINNER', 'Beef Chilli', 2), meal(MON, 'DINNER', 'Overnight Oats', 1),
    meal(MON, 'SNACK', 'Overnight Oats', 1), meal(MON, 'LUNCH', 'Beef Chilli', 1)] });
  assert.deepEqual(day(r, 0).meals.map((m) => m.title), [
    'Lunch · Beef Chilli · 1 serving',
    'Dinner · Beef Chilli · 2 servings',
    'Dinner · Overnight Oats · 1 serving',
    'Snack · Overnight Oats · 1 serving',
  ]);
});

test('a slot this build cannot read is still a dish a coach booked', () => {
  const r = run([], [], { plan: [
    meal(MON, 'BRUNCH', 'Beef Chilli', 1), meal(MON, 'BREAKFAST', 'Overnight Oats', 1)] });
  // Sorted last rather than dropped: hiding it would hide the plan.
  assert.deepEqual(day(r, 0).meals.map((m) => m.title), [
    'Breakfast · Overnight Oats · 1 serving',
    'Beef Chilli · 1 serving',
  ]);
  assert.equal(day(r, 0).meals[1].slotLabel, '');
});

test('the servings are the coach’s own number, and a dish always has a name', () => {
  const r = run([], [], { plan: [
    meal(MON, 'LUNCH', 'Beef Chilli', 0.5),
    meal(MON, 'DINNER', '', 0),
    meal(MON, 'SNACK', 'Overnight Oats', 3)] });
  assert.deepEqual(day(r, 0).meals.map((m) => m.detail), [
    'Beef Chilli · 0.5 servings',
    'Recipe · 1 serving',
    'Overnight Oats · 3 servings',
  ]);
});

test('a meal booked outside the week on screen is not in it', () => {
  const r = run(WEEK_TRAINING(), WEEK_WORKOUTS(), { plan: [meal('2026-10-19', 'DINNER', 'Beef Chilli')] });
  assert.equal(r.counts.meals, 0);
  assert.equal(r.days.every((d) => !d.meals.length), true);
});

test('the head counts meals booked, and never meals eaten', () => {
  const r = run(WEEK_TRAINING(), WEEK_WORKOUTS(), { plan: MEAL_WEEK(), food: FULL_LOG() });
  // `logged 1` under `Booked 3 days` would read as one day of three when one of
  // them booked no session, so once meals are in the line the figure says what
  // it counts. Coach's sentence, for Coach's reason.
  assert.equal(r.head, 'Booked 3 days, 12–18 Oct · 3 meals booked '
    + '· 3 training days, 1 logged · 1 to do · 1 other day logged');
  assert.deepEqual(r.counts,
    { booked: 3, training: 3, meals: 3, logged: 1, notLogged: 1, toDo: 1, other: 1 });
});

test('a week of food entirely ahead does not open with a nought', () => {
  const r = run([], [], { plan: [meal(FRI, 'DINNER', 'Beef Chilli'), meal(SAT, 'LUNCH', 'Beef Chilli')] });
  assert.equal(r.head, 'Booked 2 days, 12–18 Oct · 2 meals booked · 2 to do');
});

test('the arrows reach a week a coach booked food in', () => {
  const plans = [meal('2026-10-05', 'DINNER', 'Beef Chilli')];
  assert.equal(PlanLog.adjacentWeek([], MON, -1, plans), '2026-10-05');
  assert.equal(PlanLog.adjacentWeek([], MON, -1), null, 'and only when there are meals to reach');
  // A meal placed on this device books no week: the arrow would land on a card
  // that is not there.
  assert.equal(PlanLog.adjacentWeek([], MON, -1, [myMeal('2026-10-05', 'DINNER', 'Beef Chilli')]), null);
});

test('a week of food is signed by whoever sent it', () => {
  const plans = MEAL_WEEK();
  const r = run([], [], { plan: plans });
  assert.equal(PlanLog.sentBy(r, [], plans), 'From Doug');
  assert.equal(PlanLog.sentBy(r, [], [myMeal(MON, 'DINNER', 'Beef Chilli')]), 'From your coach');
});

/* ---------------- who sent it ---------------- */

test('the week is signed the way the prescribed card signs a session', () => {
  const training = WEEK_TRAINING();
  const r = run(training, WEEK_WORKOUTS());
  assert.equal(PlanLog.sentBy(r, training), 'From Doug');
  assert.equal(PlanLog.sentBy(r, [plan(MON, 'Lower A', [], { fromCoach: true })]),
    'From your coach');
});

/* ---------------- the line discipline ----------------
 *
 * Coach web's list, word for word (coach/plan-log.test.mjs), plus the words
 * this screen could reach for and Coach's could not. Coach reads about
 * somebody else and can only patronise them by accident; this reads about the
 * person holding the phone, which is where a training app turns into a
 * scolding one. */
const FORBIDDEN = ['should', 'fix', 'warning', 'target', 'too ', 'concern',
  'missed', 'skipped', 'failed', 'poor', 'behind', 'compliance', 'adherence',
  'streak', '%'];

const FORBIDDEN_HERE = ['score', 'grade', 'percent', 'rate', 'average',
  'well done', 'good job', 'great work', 'keep it up', 'nice work', 'on track',
  'off track', 'slack', 'lazy', 'proud', 'ashamed', 'congrat', 'deserve',
  'reward', 'excuse', 'must ', 'need to', 'make up', 'catch up', 'you did not',
  'you have not', 'perfect week', 'consistency'];

/* And the words food reaches for, which is where a training app turns into a
 * diet one fastest. Nothing here says what was eaten, so none of these has
 * anywhere to come from -- which is the point of listing them: the day one
 * does, this fails. */
const FORBIDDEN_FOOD = ['ate ', 'eaten', 'logged at', 'not itemised',
  'no food', 'foods logged', 'calorie', 'kcal', 'macro', 'protein', 'cheat',
  'treat', 'diet', 'junk', 'clean eating', 'binge', 'indulge', 'craving',
  'hungry', 'willpower', 'over budget', 'under budget', 'left today'];

/* Every state the card has, in one week: a day booked and logged whole, a day
 * booked and logged in part, a day booked with nothing logged, a day still
 * ahead, a day logged that nothing was booked for; and a matched lift, a
 * substituted one, one short on a side, one short on sets, one not logged at
 * all and one nobody asked for. */
const everyState = () => {
  const training = WEEK_TRAINING();
  training.push(plan(SAT, 'Upper A', [asked('Bench Press', 'Barbell', [ask(185, 5)])]));
  const workouts = WEEK_WORKOUTS();
  workouts[0].exercises.push(logged('Bench Press', 'Smith machine', [did(185, 5)]));
  training[0].exercises.push(asked('Bench Press', 'Barbell', [ask(185, 5)]));
  return run(training, workouts);
};

/* The same week with the food half of a plan in it, and a day in the past that
 * booked food and nothing else -- the one state the training card could not
 * have. */
const everyStateWithMeals = () => {
  const training = WEEK_TRAINING();
  training.push(plan(SAT, 'Upper A', [asked('Bench Press', 'Barbell', [ask(185, 5)])]));
  const workouts = WEEK_WORKOUTS();
  workouts[0].exercises.push(logged('Bench Press', 'Smith machine', [did(185, 5)]));
  training[0].exercises.push(asked('Bench Press', 'Barbell', [ask(185, 5)]));
  // The session nobody booked moves to today, leaving Wednesday free to be the
  // one state the training card could not have: a day in the past that booked
  // food and nothing else.
  workouts[1].date = THU;
  return run(training, workouts, {
    plan: MEAL_WEEK().concat([meal(TUE, 'LUNCH', 'Beef Chilli', 1),
      meal(WED, 'BREAKFAST', 'Overnight Oats', 1), meal(THU, 'LUNCH', 'Beef Chilli', 1),
      meal(SAT, 'SNACK', 'Overnight Oats', 1)]),
    food: FULL_LOG(),
  });
};

test('nothing in this card tells a lifter what to do', () => {
  [everyState(), everyStateWithMeals()].forEach((fixture) => {
    const every = PlanLog.lines(fixture).join(' · ').toLowerCase();
    assert.ok(every.length > 400, 'the fixture should exercise the whole card');
    FORBIDDEN.concat(FORBIDDEN_HERE).concat(FORBIDDEN_FOOD).forEach((word) => {
      assert.equal(every.includes(word), false, `"${word}" reached a screen: ${every}`);
    });
  });
});

test('every state the food half has is in that fixture too', () => {
  const r = everyStateWithMeals();
  assert.deepEqual([...new Set(r.days.map((d) => d.state))].sort(),
    ['logged', 'meals', 'notBooked', 'notLogged', 'toDo']);
  // A day booked for a session and for food; a day booked for food alone, in
  // the past and still ahead; a day booked for food that was trained anyway.
  assert.ok(r.days.some((d) => d.meals.length && d.exercises.length));
  assert.ok(r.days.some((d) => d.meals.length && d.state === 'meals'));
  assert.ok(r.days.some((d) => d.meals.length && d.state === 'toDo'));
  assert.ok(r.days.some((d) => d.meals.length && d.state === 'notBooked'));
  assert.equal(r.counts.meals, 7);
});

test('a week a coach booked no meals in reads exactly as it did', () => {
  // Frozen from the card as it shipped on 2026-09-24, before any of this: the
  // whole week, every line, in order. The meal count, the clause and the rows
  // appear only where there is a booked meal to carry them, so a training week
  // is untouched -- and an empty `plan`, a `plan` of this device's own meals,
  // and no `plan` at all are the same week.
  const BEFORE = [
    'Booked 4 days, 12–18 Oct · logged 1 · 2 to do · 1 other day logged',
    'Mon 12 Oct · Lower A · logged',
    'Back Squat (Barbell)',
    'Asked 225 x 5 · 225 x 5 · 245 x 3',
    'Logged 225 x 5 · 225 x 5 · 245 x 2',
    'Romanian Deadlift (Barbell)',
    'Asked 4 sets · logged 3',
    'Asked 185 x 8 · 185 x 8 · 185 x 8 · 185 x 8',
    'Logged 185 x 8 · 185 x 8 · 185 x 6',
    'Bulgarian Split Squat (Dumbbell) · each side',
    'L 3/3 · R 2/3',
    'Asked 40 x 8 · 40 x 8 · 40 x 8 each side',
    'Logged L 40 x 8 · 40 x 8 · 40 x 5   R 40 x 8 · 40 x 8',
    'Overhead Press (Barbell) · not logged',
    'Bench Press (Barbell)',
    'Asked 185 x 5',
    'Logged 185 x 5',
    'Asked Barbell · logged Smith machine',
    'Also logged',
    'Leg Press (Machine) · 3 sets',
    'Tue 13 Oct · Upper B · not logged',
    'Bench Press (Barbell) · not logged',
    'Wed 14 Oct · Arms · not booked',
    'Also logged',
    'Barbell Curl (Barbell) · 2 sets',
    'Fri 16 Oct · Lower B · to do',
    'Front Squat (Barbell)',
    'Asked 165 x 5 · 165 x 5',
    'Split Squat (Dumbbell) · each side',
    'Each side · L 2 · R 2',
    'Asked 35 x 10 · 35 x 10 each side',
    'Sat 17 Oct · Upper A · to do',
    'Bench Press (Barbell)',
    'Asked 185 x 5',
    PlanLog.FOOTER,
  ];
  assert.deepEqual(PlanLog.lines(everyState()), BEFORE);
  const week = (booked) => {
    const training = WEEK_TRAINING();
    training.push(plan(SAT, 'Upper A', [asked('Bench Press', 'Barbell', [ask(185, 5)])]));
    training[0].exercises.push(asked('Bench Press', 'Barbell', [ask(185, 5)]));
    const workouts = WEEK_WORKOUTS();
    workouts[0].exercises.push(logged('Bench Press', 'Smith machine', [did(185, 5)]));
    return PlanLog.lines(run(training, workouts, { plan: booked }));
  };
  assert.deepEqual(week([]), BEFORE);
  assert.deepEqual(week(undefined), BEFORE);
  assert.deepEqual(week([myMeal(MON, 'DINNER', 'Beef Chilli', 2)]), BEFORE);
  assert.deepEqual(everyState().counts.meals, 0);
});

test('every state the card has is in that fixture', () => {
  const r = everyState();
  assert.deepEqual([...new Set(r.days.map((d) => d.state))].sort(),
    ['logged', 'notBooked', 'notLogged', 'toDo']);
  const states = r.days.flatMap((d) => d.exercises.map((e) => e.state));
  assert.deepEqual([...new Set(states)].sort(), ['logged', 'notLogged', 'toDo']);
  assert.ok(r.days.some((d) => d.alsoLogged.length), 'a lift nobody asked for');
  assert.ok(r.days.some((d) => d.exercises.some((e) => e.substitution)), 'a substitution');
  assert.ok(r.days.some((d) => d.exercises.some((e) => e.sideLine)), 'a side line');
  assert.ok(r.days.some((d) => d.exercises.some((e) => e.countLine)), 'a count line');
});

test('nothing here aggregates a week into a score', () => {
  const r = everyState();

  // Counts hang off the week the card is looking at, and there is nothing
  // above them: no all-time figure, no trend, nothing carried to next week.
  assert.deepEqual(Object.keys(r).sort(),
    ['counts', 'days', 'footer', 'from', 'head', 'range', 'spokenHead', 'to']);
  // `training` and `meals` are counts of what a coach wrote -- days that book a
  // session, and dishes booked. Neither carries a figure for what came back:
  // `logged` is that figure for training, and there is none for a meal.
  assert.deepEqual(Object.keys(r.counts).sort(),
    ['booked', 'logged', 'meals', 'notLogged', 'other', 'toDo', 'training'],
    'a week counts the days it booked and the days it holds, and nothing else');

  const banned = /score|percent|rate|ratio|average|total|streak|grade|adherence|compliance|best|record/i;
  const walk = (node, path) => {
    if (Array.isArray(node)) return node.forEach((v, i) => walk(v, `${path}[${i}]`));
    if (node && typeof node === 'object') {
      return Object.keys(node).forEach((k) => {
        assert.equal(banned.test(k), false, `${path}.${k} reads as a grade`);
        walk(node[k], `${path}.${k}`);
      });
    }
    if (typeof node === 'string') {
      assert.equal(node.includes('%'), false, `${path} carries a percentage`);
    }
  };
  walk(r, 'result');

  assert.deepEqual(Object.keys(PlanLog).filter((k) => banned.test(k)), []);
});

test('nothing in this feature carries from one week to the next', () => {
  const source = readFileSync('lift/plan-log.js', 'utf8');
  ['lastWeek', 'previousWeek', 'allTime', 'sinceStart', 'runOf', 'inARow']
    .forEach((token) => {
      assert.equal(source.includes(token), false,
        `${token} would carry a week into another one`);
    });
  // compare() is handed one week and reads one week: its own window is the
  // only stretch of the log it ever touches.
  const r = run(WEEK_TRAINING().concat(
    [plan('2026-10-05', 'Lower A', [asked('Back Squat', 'Barbell', [ask(225, 5)])])]),
  WEEK_WORKOUTS());
  assert.equal(r.counts.booked, 3);
  assert.ok(r.days.every((d) => d.key >= MON && d.key <= SUN));
});

test('the footer is this card’s own, not the one written for a coach', () => {
  assert.equal(PlanLog.FOOTER,
    'Your coach’s plan beside your own log. What else the week held, only you know.');
  // Neither of Coach's two third-party sentences can reach this screen, in
  // any state the card has: one is about a link somebody else received, the
  // other about a window somebody else chose to send.
  const every = PlanLog.lines(everyState()).join(' · ');
  assert.equal(every.includes('opened it, only they know'), false,
    'Coach’s footer is a sentence about somebody else');
  assert.equal(every.includes('outside the log they sent'), false,
    'the log is right here; the state cannot arise');
  assert.equal(Object.values(PlanLog.WORDS).includes('outside the log they sent'), false);

  // Coach's third is its meal note, which exists to disclaim a join Coach
  // cannot make. This card names no logged food at all, so it has nothing to
  // disclaim and the footer it already had is the footer it keeps.
  const withMeals = everyStateWithMeals();
  assert.equal(withMeals.footer, PlanLog.FOOTER);
  assert.equal(withMeals.mealFooter, undefined);
  assert.equal(PlanLog.MEAL_NOTE, undefined);
  assert.equal(PlanLog.lines(withMeals).filter((line) => line === PlanLog.FOOTER).length, 1);
  assert.equal(PlanLog.lines(withMeals).includes('was this dish, only they know'), false);
});

test('the words a coach reads and the words a lifter reads are the same words', () => {
  // The four verdicts, and the two row labels, taken from Coach web's
  // plan-log.js unchanged -- so describing a week to each other does not mean
  // translating it first. `to do` is the one this side adds, because only the
  // person living the week has a day that has not happened yet.
  assert.deepEqual(PlanLog.WORDS, {
    logged: 'logged', toDo: 'to do', notLogged: 'not logged', notBooked: 'not booked',
  });
  const coach = readFileSync('coach/plan-log.js', 'utf8');
  // The meal clause and the slots are Coach's too: a booked dinner is the same
  // fact read by two people, and `2 meals booked` is how Coach says it.
  ['not logged', 'not booked', "'Asked '", "'Logged'", 'Asked \' + plural(',
    "'meal booked', 'meals booked'", "'Breakfast', 'Lunch', 'Dinner', 'Snack'",
    "'serving', 'servings'", "out.push('Meals')"]
    .forEach((phrase) => assert.ok(coach.includes(phrase),
      `${phrase} is no longer Coach’s wording -- the two have drifted`));
});

/* ---------------- how it reads aloud ----------------
 *
 * The card is built out of short muted lines with `·` between their clauses,
 * which is a comma sighted and a fragment aloud. `spokenLines` is the same
 * card said, and these pin the rules rather than the strings.
 */

test('a day row is one sentence, not four fragments', () => {
  const spoken = PlanLog.spokenLines(everyStateWithMeals());
  assert.equal(spoken.some((l) => l.includes(' · ')), false, spoken.join(' | '));
  assert.ok(spoken.includes('Monday 12 October, Lower A, logged, 2 meals booked'),
    `no spoken day row: ${JSON.stringify(spoken.slice(0, 4))}`);
});

test('the date a day row says is the date it draws, in words', () => {
  assert.equal(PlanLog.dayLabel('2026-09-28'), 'Mon 28 Sep');
  assert.equal(PlanLog.spokenDayLabel('2026-09-28'), 'Monday 28 September');
});

test('a week is a range aloud, not an en dash', () => {
  assert.equal(PlanLog.rangeText('2026-09-28', '2026-10-04'), '28 Sep–4 Oct');
  assert.equal(PlanLog.spokenRange('2026-09-28', '2026-10-04'),
    '28 September to 4 October');
  assert.equal(PlanLog.spokenRange('2026-10-12', '2026-10-18'), '12 to 18 October');
  assert.equal(PlanLog.spokenRange('2026-10-12', '2026-10-12'), '12 October');
});

test('the asked row and the logged row are one comparison, under the lift', () => {
  const r = run([plan(MON, 'Lower A', [
    asked('Back Squat', 'Barbell', [ask(225, 5), ask(225, 5), ask(245, 3)])])],
    [session(MON, 'Lower A', [logged('Back Squat', 'Barbell', [did(225, 5), did(225, 5)])])]);
  const ex0 = day(r, 0).exercises[0];
  assert.equal(ex0.spoken,
    'Back Squat (Barbell). Asked 3 sets, logged 2. '
    + 'Asked 225 by 5, 225 by 5, 245 by 3. Logged 225 by 5, 225 by 5');
  // ` x ` never reaches it: read literally it is the letter.
  assert.equal(/ x /.test(ex0.spoken), false);
});

test('L 3/3 · R 2/3 is said as left 3 of 3, right 2 of 3', () => {
  const r = run([plan(MON, 'Lower A', [
    asked('Split Squat', 'Dumbbell', [ask(40, 8), ask(40, 8), ask(40, 8)],
      { eachSide: true })])],
    [session(MON, 'Lower A', [logged('Split Squat', 'Dumbbell', [
      did(40, 8, { side: 'left' }), did(40, 8, { side: 'left' }),
      did(40, 8, { side: 'left' }), did(40, 8, { side: 'right' }),
      did(40, 8, { side: 'right' })])])]);
  const ex0 = day(r, 0).exercises[0];
  assert.equal(ex0.sideLine, 'L 3/3 · R 2/3', 'the drawn line is unchanged');
  assert.equal(ex0.spokenSideLine, 'left 3 of 3, right 2 of 3');
  assert.equal(ex0.logged.spoken,
    'Logged left 40 by 8, 40 by 8, 40 by 8; right 40 by 8, 40 by 8');
  // "each side" is a clause on the ask and is said, or the plan asks for half
  // of what it asks for.
  assert.ok(ex0.asked.spoken.endsWith(' each side'), ex0.asked.spoken);
});

test('a day still ahead says its each-side ask in words, not in noughts', () => {
  const r = run([plan(FRI, 'Lower B', [
    asked('Split Squat', 'Dumbbell', [ask(35, 10), ask(35, 10)], { eachSide: true })])], []);
  const ahead = r.days.find((d) => d.key === FRI);
  assert.equal(ahead.exercises[0].sideLine, 'Each side · L 2 · R 2');
  assert.equal(ahead.exercises[0].spokenSideLine, 'Each side, left 2, right 2');
});

test('nothing a screen reader is handed changes what the card draws', () => {
  // The spoken layer is labels, and the drawn lines keep their punctuation:
  // the frozen list in "the card reads the same as it did" pins them exactly,
  // and this is the guard that they were not quietly said instead of drawn.
  const drawn = PlanLog.lines(everyStateWithMeals());
  assert.ok(drawn.some((l) => l.includes(' · ')), 'the card still draws `·`');
  assert.ok(drawn.some((l) => l.includes('L 3/3')), 'and still draws `L 3/3`');
  assert.ok(drawn.some((l) => / x /.test(l)), 'and still draws ` x `');
});

test('nothing a screen reader is handed tells a lifter what to do', () => {
  // The same discipline as the drawn lines, over the announced ones: a label
  // is a sentence you read, and "not logged" must be as flat aloud as it is
  // on screen.
  [everyState(), everyStateWithMeals()].forEach((fixture) => {
    const every = PlanLog.spokenLines(fixture).join(' · ').toLowerCase();
    assert.ok(every.length > 400, 'the fixture should exercise the whole card');
    FORBIDDEN.concat(FORBIDDEN_HERE).concat(FORBIDDEN_FOOD).forEach((word) => {
      assert.equal(every.includes(word), false,
        `"${word}" reached a screen reader: ${every}`);
    });
  });
});

test('the arrows have names, and say when they have nowhere to go', () => {
  const source = readFileSync('lift/app.js', 'utf8');
  const start = source.indexOf('function renderPlanWeek(');
  assert.ok(start > 0, 'renderPlanWeek moved; re-point this test');
  const body = source.slice(start, source.indexOf('\nfunction ', start + 1));
  assert.ok(body.includes("'Previous booked week'"), 'a glyph is not a name');
  assert.ok(body.includes("'Next booked week'"));
  assert.ok(body.includes("aria-disabled"), 'grey is not a state');
  // A row says what it is, that it opens, and -- where it does -- that
  // opening it moves Train.
  assert.ok(body.includes('aria-expanded'));
  assert.ok(body.includes('Opens this day on Train'));
  assert.ok(body.includes('day.spoken'), 'a row is named by its sentence');
});
