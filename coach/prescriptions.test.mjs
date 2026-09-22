import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';

// Loaded the way the browser loads them, in index.html's order. Run from the
// repo root: node --test coach/
const shim = { window: {} };
['sides.js', 'prescriptions.js'].forEach((file) => {
  new Function('window', readFileSync(`coach/${file}`, 'utf8')).call(shim, shim.window);
});
const P = shim.window.CoachPrescriptions;
const S = shim.window.CoachSides;

const set = (weightLb, reps, extra = {}) => ({
  weightLb, reps, rpe: null, durationSec: null, distanceM: null, ...extra,
});

/* ---------------- a plan written today is unchanged ---------------- */

// setTuple and the exercise mapping as they stood on main before sides
// (dugcanlift-coach 7b375d4, app.js), verbatim. Frozen here on purpose: the
// promise is that a plan without sides is the same bytes it always was, and
// the only honest check is against the code that wrote those bytes.
const oldSetTuple = (set) => {
  const values = [set.weightLb, set.reps, set.rpe, set.durationSec, set.distanceM];
  while (values.length && values[values.length - 1] == null) values.pop();
  return values.map((v) => (v == null ? null : v));
};
const oldWorkoutWire = (w) => ({
  n: w.name,
  e: (w.exercises || []).map((exercise) => ({
    n: exercise.name,
    ...(exercise.equipment ? { q: exercise.equipment } : {}),
    s: (exercise.sets || []).map(oldSetTuple),
    ...(exercise.note ? { c: exercise.note } : {}),
  })),
});

test('a plan with no sides encodes byte for byte as before', () => {
  const workout = {
    id: 'w1',
    name: 'Lower A',
    exercises: [
      { name: 'Back Squat', equipment: 'Barbell', note: 'Belt on the last set.',
        sets: [set(225, 5, { rpe: 8 }), set(225, 5, { rpe: 8 }), set(245, 3, { rpe: 9 })] },
      { name: 'Walking Lunge', equipment: '', note: '', sets: [set(null, 12), set(0, 12)] },
      { name: 'Row', equipment: 'Machine', note: '',
        sets: [set(null, null, { durationSec: 600, distanceM: 1600 }), set(null, null)] },
      { name: 'Empty', equipment: 'Cable', note: '', sets: [] },
    ],
  };
  assert.equal(JSON.stringify(P.workoutWire(workout)), JSON.stringify(oldWorkoutWire(workout)));
});

// Tests/Fixtures/web-plan-link.txt in coach-ios, captured from this app's
// encoder before sides existed. Decoded and re-encoded, the JSON must come
// back identical to the character. (The deflate bytes are not compared: two
// zlib builds may compress the same text differently, and the text is what
// every decoder reads.)
test('the web-plan-link fixture re-encodes to the same JSON', async () => {
  const link = readFileSync('coach/fixtures/web-plan-link.txt', 'utf8');
  const json = await P.unpack(link);
  const payload = JSON.parse(json);
  const again = { ...payload, w: payload.w.map((w) => P.workoutWire(P.decodeWorkout(w))) };
  assert.equal(JSON.stringify(again), json);
  assert.ok(!json.includes('"b"'), 'no each-side key');
  assert.ok(payload.w[0].e[0].s.every((t) => t.length <= 5), 'no sixth position');
});

/* ---------------- the wire ---------------- */

test('a both-sides set writes no sixth position; a named side always does', () => {
  assert.deepEqual(P.setTuple(set(225, 5)), [225, 5]);
  assert.deepEqual(P.setTuple(set(30, 8, { side: 'left' })), [30, 8, null, null, null, 2]);
  assert.deepEqual(P.setTuple(set(30, 8, { side: 'right' })), [30, 8, null, null, null, 4]);
  // "both" is how nothing is spelt, and junk is both.
  assert.deepEqual(P.setTuple(set(30, 8, { side: 'both' })), [30, 8]);
  assert.deepEqual(P.setTuple(set(30, 8, { side: 'L' })), [30, 8]);
});

test('only trailing nulls are trimmed: a left-side conditioning piece keeps its slots', () => {
  assert.deepEqual(
    P.setTuple(set(null, null, { durationSec: 600, distanceM: 1600, side: 'left' })),
    [null, null, null, 600, 1600, 2]);
  assert.deepEqual(P.setTuple(set(null, 5, { side: 'right' })), [null, 5, null, null, null, 4]);
});

test('each side is b: 1, omitted when not, never 0', () => {
  const ex = { name: 'Split Squat', equipment: 'Dumbbell', sets: [set(40, 8)] };
  assert.equal('b' in P.exerciseWire(ex), false);
  assert.equal('b' in P.exerciseWire({ ...ex, eachSide: false }), false);
  assert.equal(JSON.stringify(P.exerciseWire({ ...ex, eachSide: true })),
    '{"n":"Split Squat","q":"Dumbbell","b":1,"s":[[40,8]]}');
});

test('flags are masked, never compared: 2, 4, 3, 5, 6', () => {
  const side = (flags) => P.decodeSet([30, 8, null, null, null, flags]).side;
  assert.equal(side(2), 'left');
  assert.equal(side(4), 'right');
  assert.equal(side(3), 'left', 'bit 0 is ignored, not a reason to read both');
  assert.equal(side(5), 'right');
  assert.equal(side(6), undefined, '3 in bits 1-2 reads as both');
  assert.equal(side(0), undefined);
  assert.equal(side(1), undefined);
  assert.equal(P.decodeSet([30, 8]).side, undefined, 'no sixth position is both');
  assert.equal(P.decodeSet([30, 8, null, null, null, 'x']).side, undefined, 'junk is both');
  // The weight and the reps are the same whatever the flags say.
  [2, 4, 3, 5, 6].forEach((f) => {
    const s = P.decodeSet([30, 8, null, null, null, f]);
    assert.equal(s.weightLb, 30);
    assert.equal(s.reps, 8);
  });
});

test('b reads 1 as each side and everything else as not', () => {
  assert.equal(P.decodeExercise({ n: 'Row', b: 1, s: [] }).eachSide, true);
  [undefined, 0, 2, 'yes', null].forEach((b) => {
    assert.equal('eachSide' in P.decodeExercise({ n: 'Row', b, s: [] }), false, String(b));
  });
});

/* ---------------- round trips ---------------- */

const roundTrip = (workout) => P.decodeWorkout(JSON.parse(JSON.stringify(P.workoutWire(workout))));

test('round trip: both, left, right, each side, and the combination', () => {
  const workout = {
    name: 'Per side',
    exercises: [
      { name: 'Bench Press', equipment: 'Barbell', note: '', sets: [set(185, 5)] },
      { name: 'Row', equipment: 'Dumbbell', note: '',
        sets: [set(30, 8, { side: 'left' }), set(35, 8, { side: 'right' })] },
      { name: 'Split Squat', equipment: 'Dumbbell', note: '', eachSide: true,
        sets: [set(40, 8), set(40, 8)] },
      { name: 'Lunge', equipment: 'Dumbbell', note: 'Extra on the left', eachSide: true,
        sets: [set(40, 8), set(40, 8), set(40, 8), set(40, 8, { side: 'left' })] },
    ],
  };
  const back = roundTrip(workout);
  assert.deepEqual(back.exercises[0].sets, [set(185, 5)]);
  assert.equal('eachSide' in back.exercises[0], false);
  assert.deepEqual(back.exercises[1].sets.map((s) => s.side), ['left', 'right']);
  assert.deepEqual(back.exercises[1].sets.map((s) => s.weightLb), [30, 35]);
  assert.equal(back.exercises[2].eachSide, true);
  assert.deepEqual(back.exercises[2].sets, [set(40, 8), set(40, 8)]);
  assert.deepEqual(back, JSON.parse(JSON.stringify(workout)));
});

/* ---------------- what it asks for ---------------- */

test('the seven-set case: each side plus one left is three right and four left', () => {
  const ex = { name: 'Bulgarian Split Squat', eachSide: true,
    sets: [set(40, 8), set(40, 8), set(40, 8), set(40, 8, { side: 'left' })] };
  assert.deepEqual(P.targets(ex), { left: 4, right: 3, both: 0 });
  const back = roundTrip({ name: 'x', exercises: [ex] }).exercises[0];
  assert.deepEqual(P.targets(back), { left: 4, right: 3, both: 0 });
});

test('a named side on a two-sided lift is once on that side', () => {
  const ex = { name: 'Bench Press', sets: [set(185, 5), set(185, 5), set(95, 10, { side: 'right' })] };
  assert.deepEqual(P.targets(ex), { left: 0, right: 1, both: 2 });
});

/* ---------------- how it reads ---------------- */

test('an exercise with no side reads exactly as before', () => {
  assert.equal(P.summary({ sets: [set(225, 5), set(225, 5), set(225, 5)] }), '3 × 225 × 5');
  assert.equal(P.summary({ sets: [set(225, 5), set(245, 3)] }), '225 × 5, 245 × 3');
  assert.equal(P.summary({ sets: [] }), 'no sets yet');
  // Matching is on the stored set, as it was: these print alike and differ.
  assert.equal(P.summary({ sets: [set(225, 5), set(225.4, 5)] }), '225 × 5, 225 × 5');
});

test('each side reads "3 × 30 × 8 each side", and an extra set "+ 1 L"', () => {
  const each = [set(30, 8), set(30, 8), set(30, 8)];
  assert.equal(P.summary({ eachSide: true, sets: each }), '3 × 30 × 8 each side');
  assert.equal(P.summary({ eachSide: true, sets: [...each, set(30, 8, { side: 'left' })] }),
    '3 × 30 × 8 each side + 1 L');
  assert.equal(P.summary({ eachSide: true, sets: [...each, set(20, 12, { side: 'left' })] }),
    '3 × 30 × 8 each side + 20 × 12 L');
  assert.equal(P.summary({ eachSide: true, sets: [set(30, 8)] }), '30 × 8 each side');
});

test('a named set reads with its side: "30 × 8 L"', () => {
  assert.equal(P.setText(set(30, 8, { side: 'left' })), '30 × 8 L');
  assert.equal(P.setText(set(30, 8)), '30 × 8');
  assert.equal(P.summary({ sets: [set(185, 5), set(95, 10, { side: 'right' })] }),
    '185 × 5, 95 × 10 R');
});

/* ---------------- storage and backup ---------------- */

test('a backup writes eachSide only when true and side only for left and right', () => {
  const w = {
    exercises: [
      { name: 'A', eachSide: false, sets: [set(1, 1, { side: 'both' })] },
      { name: 'B', eachSide: true, sets: [set(1, 1, { side: 'Left' }), set(1, 1, { side: null })] },
      { name: 'C', eachSide: 'yes', sets: [set(1, 1, { side: 'sideways' })] },
    ],
  };
  P.normaliseWorkout(w);
  assert.equal('eachSide' in w.exercises[0], false);
  assert.equal('side' in w.exercises[0].sets[0], false);
  assert.equal(w.exercises[1].eachSide, true);
  assert.equal(w.exercises[1].sets[0].side, 'left');
  assert.equal('side' in w.exercises[1].sets[1], false);
  assert.equal('eachSide' in w.exercises[2], false, 'only true is each side');
  assert.equal('side' in w.exercises[2].sets[0], false, 'an unknown side reads as both');
});

test('a workout saved before sides restores unchanged', () => {
  const old = { id: 'w', name: 'Lower A', exercises: [
    { name: 'Back Squat', equipment: 'Barbell', note: '', sets: [set(225, 5)] }] };
  const copy = JSON.parse(JSON.stringify(old));
  P.normaliseWorkout(copy);
  assert.deepEqual(copy, old);
});

/* ---------------- the pre-tick ---------------- */

test('"Each side" starts ticked by LIFT\'s own unilateral guess', () => {
  ['Bulgarian Split Squat', 'Single-Arm Dumbbell Row', 'One Arm Overhead Press',
    'Walking Lunge', 'Pistol Squat', 'Step-Up', 'Kettlebell One-Legged Deadlift']
    .forEach((name) => assert.equal(S.looksUnilateral(name), true, name));
  ['Barbell Bench Press', 'Back Squat', 'Cold Plunge', 'Stepmill', 'Arm Curl']
    .forEach((name) => assert.equal(S.looksUnilateral(name), false, name));
});

test('the unilateral terms are LIFT web\'s, term for term', () => {
  // A port, not a second list: the two must never disagree about which
  // exercises start ticked. The site is a sibling checkout when present.
  let lift;
  try {
    lift = readFileSync(new URL('../../dugcanlift-site/lift/sides.js', import.meta.url), 'utf8');
  } catch (e) {
    return; // not checked out beside this repo; nothing to compare against
  }
  const terms = (src) => {
    const block = src.slice(src.indexOf('var UNILATERAL_TERMS = ['), src.indexOf('];', src.indexOf('var UNILATERAL_TERMS = [')));
    const code = block.split('\n').map((line) => line.replace(/\/\/.*$/, '')).join('\n');
    return [...code.matchAll(/'([^']+)'/g)].map((m) => m[1]);
  };
  assert.deepEqual(terms(readFileSync('coach/sides.js', 'utf8')), terms(lift));
});

/* ---------------- the interop fixture ---------------- */

// fixtures/web-plan-per-side.txt was produced by this app's own encoder
// (encodePlan, in a browser, 2026-09-22) and is checked into the iOS and
// Android decoders' tests as proof of what Coach web sends. Never regenerate
// it from a decoder -- that would prove only that a decoder agrees with
// itself. These tests read it; nothing here writes it.
const fixture = async () => JSON.parse(await P.unpack(readFileSync('coach/fixtures/web-plan-per-side.txt', 'utf8')));

test('fixture: the raw wire carries b and six-field tuples as specified', async () => {
  const json = await P.unpack(readFileSync('coach/fixtures/web-plan-per-side.txt', 'utf8'));
  assert.ok(json.startsWith('{"v":1,"t":"plan","l":"a1b2c3d4"'));
  const e = JSON.parse(json).w[0].e;
  assert.deepEqual(e.map((x) => x.b), [undefined, 1, 1, undefined, undefined]);
  assert.deepEqual(e[0].s, [[225, 5, 8], [225, 5, 8], [225, 5, 8]]);
  assert.deepEqual(e[2].s[3], [40, 8, null, null, null, 2]);
  assert.deepEqual(e[3].s[2], [40, 10, null, null, null, 4]);
  assert.deepEqual(e[4].s, [[null, null, null, 600, 1600, 2]]);
});

test('fixture: sets per side, exercise by exercise', async () => {
  const w = P.decodeWorkout((await fixture()).w[0]);
  const byName = Object.fromEntries(w.exercises.map((x) => [x.name, P.targets(x)]));
  assert.deepEqual(byName['Back Squat'], { left: 0, right: 0, both: 3 });
  assert.deepEqual(byName['Single-Arm Dumbbell Row'], { left: 3, right: 3, both: 0 });
  assert.deepEqual(byName['Bulgarian Split Squat'], { left: 4, right: 3, both: 0 }, 'the seven-set case');
  assert.deepEqual(byName['Dumbbell Bench Press'], { left: 0, right: 1, both: 2 });
  assert.deepEqual(byName['Suitcase Carry'], { left: 1, right: 0, both: 0 });
});

test('fixture: it reads the way the editor wrote it', async () => {
  const w = P.decodeWorkout((await fixture()).w[0]);
  assert.deepEqual(w.exercises.map(P.summary), [
    '3 × 225 × 5 · @8',
    '3 × 30 × 8 each side',
    '3 × 40 × 8 each side + 1 L',
    '60 × 8, 60 × 8, 40 × 10 R',
    '1,600 m · 10:00 L',
  ]);
});

test('fixture: decoded and encoded again, it is the same JSON', async () => {
  const json = await P.unpack(readFileSync('coach/fixtures/web-plan-per-side.txt', 'utf8'));
  const payload = JSON.parse(json);
  const again = { ...payload, w: payload.w.map((w) => P.workoutWire(P.decodeWorkout(w))) };
  assert.equal(JSON.stringify(again), json);
});
