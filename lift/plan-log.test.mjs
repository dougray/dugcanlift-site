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
  assert.deepEqual(r.counts, { booked: 3, logged: 1, notLogged: 1, toDo: 1, other: 1 });
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

test('nothing in this card tells a lifter what to do', () => {
  const every = PlanLog.lines(everyState()).join(' · ').toLowerCase();
  assert.ok(every.length > 400, 'the fixture should exercise the whole card');
  FORBIDDEN.concat(FORBIDDEN_HERE).forEach((word) => {
    assert.equal(every.includes(word), false, `"${word}" reached a screen: ${every}`);
  });
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
    ['counts', 'days', 'footer', 'from', 'head', 'range', 'to']);
  assert.deepEqual(Object.keys(r.counts).sort(),
    ['booked', 'logged', 'notLogged', 'other', 'toDo'],
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
  ['not logged', 'not booked', "'Asked '", "'Logged'", 'Asked \' + plural(']
    .forEach((phrase) => assert.ok(coach.includes(phrase),
      `${phrase} is no longer Coach’s wording -- the two have drifted`));
});
