import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';

// A port of LIFT iOS's ProgressionRuleTests, case for case, then this build's
// own: reading its log, its routines and its coach's sessions.
const shim = { window: {} };
for (const file of ['lift/routines.js', 'lift/rotation.js', 'lift/progression.js']) {
  new Function('window', readFileSync(file, 'utf8')).call(shim, shim.window);
}
const P = shim.window.LiftProgression;
const LiftRoutines = shim.window.LiftRoutines;

const monday = '2027-01-18';
const earlier = '2027-01-11';

const session = (weight, reps, date = monday) => ({ date, sets: reps.map((r) => ({ weight, reps: r })) });

test('every set reached its reps goes up a step', () => {
  const next = P.next(8, 3, [session(185, [8, 8, 9])], 5);
  assert.deepEqual(next, { kind: 'up', to: 190, from: 185, reps: 8, date: monday });
});

test('one short set means the same weight again', () => {
  const next = P.next(8, 3, [session(185, [8, 8, 6])], 5);
  assert.deepEqual(next, { kind: 'same', weight: 185, reps: [8, 8, 6], target: 8, date: monday });
});

// Two sets of eight is not three sets of eight.
test('fewer sets than the routine asks for is not done', () => {
  assert.equal(P.weightOf(P.next(8, 3, [session(185, [8, 8])], 5)), 185);
});

// The top weight decides: a lighter back-off set short of the reps does not
// hold back a session whose heavy sets all got there.
test("only the top weight's sets count", () => {
  const last = session(185, [8, 8, 8]);
  last.sets.push({ weight: 135, reps: 5 });
  assert.equal(P.weightOf(P.next(8, 3, [last], 5)), 190);
});

test('short twice running at the same weight backs off', () => {
  const next = P.next(8, 3, [session(185, [8, 7, 6]), session(185, [8, 6, 6], earlier)], 5);
  assert.deepEqual(next, { kind: 'backOff', to: 165, from: 185, target: 8 });
});

// Short now, but the time before was at a lighter weight: that was the first
// try at this one, not a stall.
test('short once after going up is not a stall', () => {
  const next = P.next(8, 3, [session(190, [8, 7, 6]), session(185, [8, 8, 8], earlier)], 5);
  assert.equal(P.weightOf(next), 190);
});

test('nothing honest to say is no suggestion', () => {
  assert.equal(P.next(8, 3, [], 5), null);
  assert.equal(P.next(0, 3, [session(185, [8])], 5), null);
  // Bodyweight: no step to take.
  assert.equal(P.next(8, 3, [session(0, [10, 10, 10])], 5), null);
});

// A weight that came through a conversion -- an iPhone's backup writes
// pounds from stored kilograms -- reads back a hair off; the next one is
// still a real plate pair.
test('a converted weight steps cleanly', () => {
  const stored = (185 / 2.2046226218) * 2.2046226218 - 1e-9;
  assert.notEqual(stored, 185);
  assert.equal(P.weightOf(P.next(8, 1, [session(stored, [8])], 5)), 190);
});

// iOS: two of the smallest plate owned for a bar, otherwise 5 lb or 2.5 kg.
// This build has no plates and weighs in pounds, so it is the jump.
test('the step is 5 lb, and 2.5 kg', () => {
  assert.equal(P.step('lb'), 5);
  assert.equal(P.step(), 5);
  assert.equal(P.step('kg'), 2.5);
});

test('the lines say why', () => {
  assert.ok(P.line({ kind: 'up', to: 190, from: 185, reps: 8, date: monday }, 'lb', 'en-US')
    .startsWith('Next: 190 lb. Every set reached 8 at 185 last time ('));
  assert.ok(P.line({ kind: 'same', weight: 185, reps: [8, 8, 6], target: 8, date: monday }, 'lb', 'en-US')
    .startsWith('Next: 185 lb again. 8, 8, 6 at 185 last time ('));
  assert.equal(P.line({ kind: 'backOff', to: 75, from: 82.5, target: 5 }, 'kg'),
    'Next: 75 kg. Short of 5 at 82.5 two sessions running, so back off and build up again.');
});

// MARK: - This build's own

test('the day is said the way a person says it', () => {
  assert.equal(P.line({ kind: 'up', to: 190, from: 185, reps: 8, date: monday }, 'lb', 'en-US'),
    'Next: 190 lb. Every set reached 8 at 185 last time (Mon, Jan 18).');
  assert.equal(P.line({ kind: 'same', weight: 185, reps: [8, 8, 6], target: 8, date: monday }, 'lb', 'en-US'),
    'Next: 185 lb again. 8, 8, 6 at 185 last time (Mon, Jan 18), aiming for 8.');
  assert.equal(P.buttonText({ kind: 'backOff', to: 72.5, from: 82.5, target: 5 }), 'Use 72.5 lb');
});

let n = 0;
const makeId = () => `id-${++n}`;
const bench = { name: 'Barbell Bench Press - Medium Grip', equipment: 'Barbell' };
const push = {
  id: 'push', name: 'Push', folder: 'Push/Pull/Legs', createdAt: 1,
  exercises: [{ id: 'rx', ...bench, targetSets: 3, targetReps: 8, targetWeightLb: null }],
};
const logged = (date, sets, extra = {}) => ({
  id: makeId(), date, name: 'Push', startedAt: Date.parse(date),
  exercises: [{ id: makeId(), ...bench, sets: sets.map((s) => ({ id: makeId(), ...s })) }],
  ...extra,
});

test('a day is a date: two sessions on one date are one session of the lift', () => {
  const days = P.sessions(bench, [
    logged(earlier, [{ weightLb: 185, reps: 8 }]),
    logged(earlier, [{ weightLb: 185, reps: 8 }, { weightLb: 185, reps: 9 }]),
  ], monday);
  assert.deepEqual(days, [{ date: earlier, sets: [
    { weight: 185, reps: 8 }, { weight: 185, reps: 8 }, { weight: 185, reps: 9 }] }]);
});

test('warmups, empty sets and today are not history; newest first', () => {
  const days = P.sessions(bench, [
    logged('2027-01-04', [{ weightLb: 180, reps: 8 }]),
    logged(earlier, [{ weightLb: 95, reps: 10, warmup: true }, { weightLb: 185, reps: 8 }, { reps: 8 }]),
    logged(monday, [{ weightLb: 190, reps: 8 }]),
  ], monday);
  assert.deepEqual(days.map((d) => d.date), [earlier, '2027-01-04']);
  assert.deepEqual(days[0].sets, [{ weight: 185, reps: 8 }]);
});

// Its sides are two lifts, and one number for both would be wrong for each.
test('a day logged a side at a time is left out', () => {
  const days = P.sessions(bench, [
    logged(earlier, [{ weightLb: 40, reps: 8, side: 'left' }, { weightLb: 40, reps: 8, side: 'right' }]),
  ], monday);
  assert.deepEqual(days, []);
});

const today = () => LiftRoutines.toSession(push, monday, makeId, 0);
const ctx = (workouts, extra = {}) => ({
  routines: [push], workouts, training: [], templates: [], today: monday, enabled: true, perSide: false, ...extra,
});
const lastWeek = logged(earlier, [{ weightLb: 185, reps: 8 }, { weightLb: 185, reps: 8 }, { weightLb: 185, reps: 8 }]);

test('an exercise started from your own routine gets the next weight', () => {
  const s = today();
  const next = P.suggestion(s, s.exercises[0], ctx([lastWeek, s]));
  assert.deepEqual(next, { kind: 'up', to: 190, from: 185, reps: 8, date: earlier });
});

test('none for a first session, a side at a time, a past day, or when turned off', () => {
  const s = today();
  assert.equal(P.suggestion(s, s.exercises[0], ctx([s])), null);
  assert.equal(P.suggestion(s, s.exercises[0], ctx([lastWeek, s], { perSide: true })), null);
  assert.equal(P.suggestion(s, s.exercises[0], ctx([lastWeek, s], { enabled: false })), null);
  assert.equal(P.suggestion(s, s.exercises[0], ctx([lastWeek, s], { today: '2027-01-19' })), null);
});

test('none for a routine exercise with no rep target', () => {
  const timed = { ...push, exercises: [{ ...push.exercises[0], targetReps: null }] };
  const s = LiftRoutines.toSession(timed, monday, makeId, 0);
  assert.equal(P.suggestion(s, s.exercises[0], ctx([lastWeek, s], { routines: [timed] })), null);
});

// The coach programmes those numbers: a second voice on the same set is a
// contradiction, not help.
test("none for a coach's session, even one named like your routine", () => {
  const s = today();
  const booked = [{ id: 't', date: monday, startedSessionId: s.id }];
  assert.equal(P.suggestion(s, s.exercises[0], ctx([lastWeek, s], { training: booked })), null);
  assert.equal(P.suggestion(s, s.exercises[0], ctx([lastWeek, s], { templates: [{ name: 'Push' }] })), null);
});

test('none for a lift added by hand to a routine session, or a session from no routine', () => {
  const s = today();
  const curl = { id: makeId(), name: 'Barbell Curl', equipment: 'Barbell', sets: [] };
  s.exercises.push(curl);
  assert.equal(P.suggestion(s, curl, ctx([lastWeek, s])), null);
  const byHand = { id: makeId(), date: monday, name: '', exercises: [{ id: makeId(), ...bench, sets: [] }] };
  assert.equal(P.suggestion(byHand, byHand.exercises[0], ctx([lastWeek, byHand])), null);
});

// No tick per set here: a set not done is one still as the routine laid it
// out -- its weight, or none -- and a warmup is never touched.
test('"Use" fills only the sets not done', () => {
  const rx = { ...push.exercises[0], targetWeightLb: 185 };
  const sets = [
    { id: 'a', weightLb: 185, reps: 8 },
    { id: 'b', reps: 8 },
    { id: 'c', weightLb: 175, reps: 8 },
    { id: 'd', weightLb: 190, reps: 8 },
    { id: 'e', weightLb: 95, reps: 10, warmup: true },
  ];
  assert.deepEqual(P.openSets({ sets }, rx, 190).map((s) => s.id), ['a', 'b']);
  assert.deepEqual(P.openSets({ sets }, push.exercises[0], 190).map((s) => s.id), ['b']);
});

test('turning it off is stored; on is no key', () => {
  const map = new Map();
  const storage = { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => map.set(k, v), removeItem: (k) => map.delete(k) };
  assert.equal(P.enabled(storage), true);
  P.setEnabled(false, storage);
  assert.equal(P.enabled(storage), false);
  P.setEnabled(true, storage);
  assert.equal(map.has(P.ENABLED_KEY), false);
});

// MARK: - Drop sets and rest-pause in your own routine
//
// A drop set is lighter on purpose and a rest-pause set is short on purpose,
// so neither is a working set at the top weight. The routine asks for its
// straight sets only, and the log's drop and rest-pause sets are not read.
const arms = {
  id: 'push', name: 'Push', folder: 'Push/Pull/Legs', createdAt: 1,
  exercises: [{ id: 'rx', ...bench, targetSets: 4, targetReps: 8, targetWeightLb: 185,
    setKinds: [null, null, 'drop', 'restPause'] }],
};

test('drop and rest-pause sets are not working sets of the day', () => {
  const days = P.sessions(bench, [
    logged(earlier, [{ weightLb: 185, reps: 8 }, { weightLb: 185, reps: 8 },
      { weightLb: 135, reps: 10, kind: 'drop' }, { weightLb: 185, reps: 3, kind: ' RestPause ' }]),
  ], monday);
  assert.deepEqual(days, [{ date: earlier, sets: [{ weight: 185, reps: 8 }, { weight: 185, reps: 8 }] }]);
});

test('a routine with two kinded sets of four asks for its two straight sets, and goes up', () => {
  const s = LiftRoutines.toSession(arms, monday, makeId, 0);
  const before = logged(earlier, [{ weightLb: 185, reps: 8 }, { weightLb: 185, reps: 8 },
    { weightLb: 135, reps: 10, kind: 'drop' }, { weightLb: 185, reps: 4, kind: 'restPause' }]);
  const next = P.suggestion(s, s.exercises[0], ctx([before, s], { routines: [arms] }));
  assert.deepEqual(next, { kind: 'up', to: 190, from: 185, reps: 8, date: earlier });
});

test('one straight set short of the reps is still the same weight again', () => {
  const s = LiftRoutines.toSession(arms, monday, makeId, 0);
  const before = logged(earlier, [{ weightLb: 185, reps: 8 }, { weightLb: 185, reps: 7 },
    { weightLb: 135, reps: 10, kind: 'drop' }, { weightLb: 185, reps: 4, kind: 'restPause' }]);
  const next = P.suggestion(s, s.exercises[0], ctx([before, s], { routines: [arms] }));
  assert.equal(next.kind, 'same');
  assert.deepEqual(next.reps, [8, 7], 'the rest-pause set is not one of the reps it quotes');
});

test('one straight set where the routine asks for two is not done', () => {
  const s = LiftRoutines.toSession(arms, monday, makeId, 0);
  const before = logged(earlier, [{ weightLb: 185, reps: 8 }, { weightLb: 135, reps: 10, kind: 'drop' }]);
  assert.equal(P.suggestion(s, s.exercises[0], ctx([before, s], { routines: [arms] })).kind, 'same');
});

// The weight "Use" writes is the top set's. A drop set is lighter on purpose
// and keeps its own number, and so does rest-pause.
test('"Use" leaves drop and rest-pause sets alone', () => {
  const rx = arms.exercises[0];
  const sets = [
    { id: 'a', weightLb: 185, reps: 8 },
    { id: 'b', reps: 8 },
    { id: 'c', weightLb: 185, reps: 8, kind: 'drop' },
    { id: 'd', reps: 8, kind: 'restPause' },
  ];
  assert.deepEqual(P.openSets({ sets }, rx, 190).map((s) => s.id), ['a', 'b']);
  const started = LiftRoutines.toSession(arms, monday, makeId, 0).exercises[0];
  assert.deepEqual(P.openSets(started, rx, 190).map((s) => s.kind || 'straight'), ['straight', 'straight']);
});
