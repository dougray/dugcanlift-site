import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';

// fixtures/web-plan-per-side.txt: a plan link Coach web's own encoder wrote
// (dugcanlift-coach, coach/fixtures/, the same bytes). An each-side
// exercise (`b: 1`), an each-side exercise plus one extra left set, a named
// right set on a two-sided lift and a left-side conditioning piece, all as
// six-field tuples. Never regenerate it from a decoder here.
const FIXTURE = readFileSync('lift/fixtures/web-plan-per-side.txt', 'utf8').trim();

async function unpack(link) {
  const frag = link.slice(link.indexOf('#') + 1);
  const match = frag.match(/^(\d+)([zu])([A-Za-z0-9_-]+)$/);
  const bytes = Buffer.from(match[3], 'base64url');
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return JSON.parse(await new Response(stream).text());
}

// MARK: - Old decoder degradation

// importTraining's tuple mapping and startPrescribed's copy, as they stood on
// main before plan sides (dugcanlift-site c184639, lift/app.js), verbatim.
// Frozen here on purpose: the promise is that a LIFT build that has never
// heard of `b` or a sixth position still takes the plan in, with the right
// weights, reps and set count, as ordinary two-sided sets. Checked on
// 2026-09-22 against main itself, in node and in a browser, before anything
// here changed: it does.
const oldToTemplate = (raw) => ({
  name: raw.n || 'Session',
  exercises: (raw.e || []).map((exercise) => ({
    name: exercise.n || 'Exercise',
    equipment: exercise.q || '',
    note: exercise.c || '',
    sets: (exercise.s || []).map((tuple) => ({
      weightLb: tuple[0] ?? null,
      reps: tuple[1] ?? null,
      rpe: tuple[2] ?? null,
      durationSec: tuple[3] ?? null,
      distanceMeters: tuple[4] ?? null,
    })),
  })),
});
const oldCopy = (set) => {
  const copy = {};
  if (set.weightLb != null) copy.weightLb = set.weightLb;
  if (set.reps != null) copy.reps = set.reps;
  if (set.rpe != null) copy.rpe = set.rpe;
  if (set.durationSec != null) copy.durationSec = set.durationSec;
  if (set.distanceMeters != null) copy.distanceMeters = set.distanceMeters;
  return copy;
};

test('old decoder degradation: the per-side fixture reads as two-sided sets, weights and reps intact', async () => {
  const payload = await unpack(FIXTURE);
  assert.equal(payload.v, 1, 'no version bump, so an old build does not refuse the link');
  const template = oldToTemplate(payload.w[0]);
  const logged = template.exercises.map((e) => ({ name: e.name, sets: e.sets.map(oldCopy) }));
  assert.deepEqual(logged, [
    { name: 'Back Squat', sets: Array(3).fill({ weightLb: 225, reps: 5, rpe: 8 }) },
    { name: 'Single-Arm Dumbbell Row', sets: Array(3).fill({ weightLb: 30, reps: 8 }) },
    { name: 'Bulgarian Split Squat', sets: Array(4).fill({ weightLb: 40, reps: 8 }) },
    { name: 'Dumbbell Bench Press', sets: [{ weightLb: 60, reps: 8 }, { weightLb: 60, reps: 8 }, { weightLb: 40, reps: 10 }] },
    { name: 'Suitcase Carry', sets: [{ durationSec: 600, distanceMeters: 1600 }] },
  ]);
  // Nothing about a side leaks through: the sixth position is simply unread.
  logged.forEach((e) => e.sets.forEach((s) => assert.equal('side' in s, false)));
});

// MARK: - This build's decoder

// importTraining and startPrescribed, lifted out of app.js as they are now and
// run against stand-ins for storage, so the test reads the real code rather
// than a copy of it.
const shim = { window: {} };
new Function('window', readFileSync('lift/sides.js', 'utf8')).call(shim, shim.window);
const S = shim.window.LiftSides;

function liftApp() {
  const src = readFileSync('lift/app.js', 'utf8');
  const grab = (start, end) => {
    const i = src.indexOf(start);
    assert.ok(i >= 0, start);
    return src.slice(i, src.indexOf(end, i));
  };
  const code = [
    grab('function importTraining(payload)', 'const prescribedFor'),
    grab('function startPrescribed(prescription)', 'async function checkForIncomingPlan'),
    'return { importTraining, startPrescribed, state: () => ({ training, workouts, templates }) };',
  ].join('\n');
  const perSide = {};
  const setPerSide = (ex, on) => { perSide[`${ex.name}|${ex.equipment}`.toLowerCase()] = on; };
  let n = 0;
  const api = new Function('LiftSides', 'KEY', 'save', 'uid', 'render', 'setPerSide',
    'let training = [], workouts = [], templates = [];\n' + code)(
    S, {}, () => {}, () => 'id' + (++n), () => {}, setPerSide);
  return { ...api, perSide };
}

async function accepted() {
  const app = liftApp();
  app.importTraining(await unpack(FIXTURE));
  return app;
}

test('the fixture decodes with its sides: each side, a named left, a named right', async () => {
  const app = await accepted();
  const [template] = app.state().training;
  const ex = Object.fromEntries(template.exercises.map((e) => [e.name, e]));
  assert.equal('eachSide' in ex['Back Squat'], false);
  assert.equal(ex['Single-Arm Dumbbell Row'].eachSide, true);
  assert.equal(ex['Bulgarian Split Squat'].eachSide, true);
  assert.deepEqual(ex['Bulgarian Split Squat'].sets.map((s) => s.side), [undefined, undefined, undefined, 'left']);
  assert.deepEqual(ex['Dumbbell Bench Press'].sets.map((s) => s.side), [undefined, undefined, 'right']);
  assert.deepEqual(ex['Suitcase Carry'].sets,
    [{ weightLb: null, reps: null, rpe: null, durationSec: 600, distanceMeters: 1600, side: 'left' }]);
  // Weights and reps as the coach wrote them, every one.
  assert.deepEqual(ex['Dumbbell Bench Press'].sets.map((s) => [s.weightLb, s.reps]), [[60, 8], [60, 8], [40, 10]]);
});

test('accepting an each-side exercise turns per-side logging on for that lift, and only that', async () => {
  const app = await accepted();
  assert.deepEqual(app.perSide, {
    'single-arm dumbbell row|dumbbell': true,
    'bulgarian split squat|dumbbell': true,
  });
});

test('flags are masked, never compared: 2, 4, 3, 5, 6', async () => {
  const app = liftApp();
  app.importTraining({ v: 1, t: 'plan', w: [{ n: 'x', e: [{ n: 'Row', s:
    [2, 4, 3, 5, 6, 0, 1].map((f) => [30, 8, null, null, null, f]).concat([[30, 8]]) }] }] });
  const sets = app.state().templates[0].exercises[0].sets;
  assert.deepEqual(sets.map((s) => s.side), ['left', 'right', 'left', 'right', undefined, undefined, undefined, undefined]);
  sets.forEach((s) => { assert.equal(s.weightLb, 30); assert.equal(s.reps, 8); });
});

test('starting it logs sided sets as they are done, and copies two-sided ones as before', async () => {
  const app = await accepted();
  const [template] = app.state().training;
  app.startPrescribed(template);
  const logged = Object.fromEntries(app.state().workouts[0].exercises.map((e) => [e.name, e]));
  assert.equal(logged['Back Squat'].sets.length, 3, 'a two-sided lift is pre-filled as it always was');
  assert.equal('prescribed' in logged['Back Squat'], false);
  assert.equal(logged['Single-Arm Dumbbell Row'].sets.length, 0);
  assert.equal(logged['Bulgarian Split Squat'].sets.length, 0);
  assert.deepEqual(logged['Dumbbell Bench Press'].sets.map((s) => [s.weightLb, s.reps, s.side]),
    [[60, 8, undefined], [60, 8, undefined]], 'the two both-sides sets are copied; the right one waits');
  assert.equal(logged['Suitcase Carry'].sets.length, 0);
});

// MARK: - Targets and the side offered next

test('the header counts against the target: L 0/3 · R 0/3, and L 4/3 when over', async () => {
  const app = await accepted();
  app.startPrescribed(app.state().training[0]);
  const logged = Object.fromEntries(app.state().workouts[0].exercises.map((e) => [e.name, e]));
  const label = (e) => S.targetsLabel(e.prescribed, e.eachSide, e.sets);
  assert.equal(label(logged['Single-Arm Dumbbell Row']), 'L 0/3 · R 0/3');
  assert.equal(label(logged['Bulgarian Split Squat']), 'L 0/4 · R 0/3', 'the seven-set case');
  assert.equal(label(logged['Dumbbell Bench Press']), 'R 0/1 · 2/2 both');
  assert.equal(label(logged['Suitcase Carry']), 'L 0/1');
  assert.equal(label(logged['Back Squat']), '', 'nothing about sides: the plain count stands');

  const row = logged['Single-Arm Dumbbell Row'];
  row.sets = ['left', 'right', 'left', 'right', 'left', 'right', 'left'].map((side) => ({ weightLb: 30, reps: 8, side }));
  assert.equal(label(row), 'L 4/3 · R 3/3', 'over is shown, not capped');
});

test('the seven-set case expects four left and three right', () => {
  const plain = { weightLb: 40, reps: 8 };
  assert.deepEqual(S.prescribedTargets([plain, plain, plain, { ...plain, side: 'left' }], true),
    { left: 4, right: 3, both: 0 });
});

test('the offer starts on the side the next unfilled prescribed set names', () => {
  const L = { side: 'left' }; const R = { side: 'right' };
  const seven = [{}, {}, {}, { side: 'left' }];
  assert.equal(S.nextPrescribedSide(seven, true, []), 'left');
  assert.equal(S.nextPrescribedSide(seven, true, [L]), 'right');
  assert.equal(S.nextPrescribedSide(seven, true, [L, L, L]), 'right', 'three lefts first leave the rights');
  assert.equal(S.nextPrescribedSide(seven, true, [L, R, L, R, L, R]), 'left', 'the extra left set');
  assert.equal(S.nextPrescribedSide(seven, true, [L, R, L, R, L, R, L]), null, 'filled: back to whichever is behind');
  // A named right set on a two-sided lift: logged both-sides sets fill nothing.
  const bench = [{}, {}, { side: 'right' }];
  assert.equal(S.nextPrescribedSide(bench, false, [{}, {}]), 'right');
  assert.equal(S.nextPrescribedSide(bench, false, [{}, {}, R]), null);
  assert.equal(S.nextPrescribedSide(undefined, undefined, []), null, 'no prescription, no suggestion');
});

test('a new set on a side prefills from the prescribed set it answers', () => {
  const seven = [{ weightLb: 40, reps: 8 }, { weightLb: 40, reps: 8 }, { weightLb: 45, reps: 6 },
    { weightLb: 30, reps: 12, side: 'left' }];
  const L = { side: 'left' }; const R = { side: 'right' };
  assert.deepEqual(S.prescribedSetFor(seven, true, [], 'left'), seven[0]);
  assert.deepEqual(S.prescribedSetFor(seven, true, [L, R, L, R], 'left'), seven[2]);
  assert.deepEqual(S.prescribedSetFor(seven, true, [L, R, L, R, L, R], 'left'), seven[3]);
  assert.equal(S.prescribedSetFor(seven, true, [L, R, L, R, L, R], 'right'), null, 'right is used up');
  assert.equal(S.prescribedSetFor(seven, true, [], null), null);
});

test('a prescription without sides changes nothing', () => {
  assert.equal(S.prescribesSides([{ weightLb: 225, reps: 5 }], undefined), false);
  assert.equal(S.targetsLabel([{ weightLb: 225, reps: 5 }], undefined, []), '');
});
