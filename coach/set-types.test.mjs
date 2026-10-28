import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';

// Set types: supersets and circuits (`g`), drop sets and rest-pause (flags
// bits 3-4). PLAN-FORMAT.md "Set types" has the rules. Loaded the way the
// browser loads them, in index.html's order. Run from the repo root:
// node --test coach/
const shim = { window: {} };
['sides.js', 'prescriptions.js'].forEach((file) => {
  new Function('window', readFileSync(`coach/${file}`, 'utf8')).call(shim, shim.window);
});
const P = shim.window.CoachPrescriptions;
const S = shim.window.CoachSides;

const set = (weightLb, reps, extra = {}) => ({
  weightLb, reps, rpe: null, durationSec: null, distanceM: null, ...extra,
});
const ex = (name, extra = {}, sets = [set(100, 5), set(100, 5)]) => ({
  name, equipment: '', note: '', sets, ...extra,
});

/* ---------------- a plan written today is unchanged ---------------- */

// setTuple, exerciseWire and workoutWire as they stood on main before set
// types (dugcanlift-coach a8e62ea, prescriptions.js), verbatim but for the
// side lookup. Frozen on purpose: the promise is that a plan with no groups
// and no kinds is the same bytes it always was, sides included, and the only
// honest check is against the code that wrote those bytes.
const mainSetTuple = (s0) => {
  const s = s0 || {};
  const values = [s.weightLb, s.reps, s.rpe, s.durationSec, s.distanceM].map((v) => (v == null ? null : v));
  const side = S.of(s);
  if (side) return values.concat([{ left: 1, right: 2 }[side] << 1]);
  while (values.length && values[values.length - 1] == null) values.pop();
  return values;
};
const mainExerciseWire = (exercise) => {
  const out = { n: exercise.name };
  if (exercise.equipment) out.q = exercise.equipment;
  if (exercise.eachSide === true) out.b = 1;
  out.s = (exercise.sets || []).map(mainSetTuple);
  if (exercise.note) out.c = exercise.note;
  return out;
};
const mainWorkoutWire = (w) => ({ n: w.name, e: (w.exercises || []).map(mainExerciseWire) });

test('a plan with no groups or kinds encodes byte for byte as main did', () => {
  const workout = {
    id: 'w1',
    name: 'Lower A',
    exercises: [
      ex('Back Squat', { equipment: 'Barbell', note: 'Belt on the last set.' },
        [set(225, 5, { rpe: 8 }), set(225, 5, { rpe: 8 }), set(245, 3, { rpe: 9 })]),
      ex('Walking Lunge', { eachSide: true }, [set(null, 12), set(0, 12)]),
      ex('Row', { equipment: 'Machine' },
        [set(null, null, { durationSec: 600, distanceM: 1600, side: 'left' }), set(null, null)]),
      ex('Split Squat', { eachSide: true }, [set(40, 8), set(40, 8, { side: 'right' })]),
      ex('Empty', { equipment: 'Cable' }, []),
    ],
  };
  assert.equal(JSON.stringify(P.workoutWire(workout)), JSON.stringify(mainWorkoutWire(workout)));
});

test('a lone or junk group and a straight or junk kind change no byte', () => {
  const workout = {
    name: 'Junk',
    exercises: [
      ex('A', { group: 1 }),
      ex('B', { group: 0 }),
      ex('C', { group: 1 }, [set(100, 5), set(90, 5, { kind: 'straight' }), set(80, 5, { kind: 'x' })]),
      ex('D', { group: '2' }),
      ex('E', { group: 2.5 }),
      ex('F', { group: -3 }),
    ],
  };
  assert.equal(JSON.stringify(P.workoutWire(workout)), JSON.stringify(mainWorkoutWire(workout)));
});

// The sibling fixtures, both written by this encoder before set types:
// decoded and encoded again, the JSON is unchanged to the character.
['web-plan-link.txt', 'web-plan-per-side.txt', 'web-plan-road-picks.txt'].forEach((file) => {
  test(`${file} re-encodes to the same JSON, with no g and no kind bits`, async () => {
    const json = await P.unpack(readFileSync(`coach/fixtures/${file}`, 'utf8'));
    const payload = JSON.parse(json);
    const again = { ...payload, w: payload.w.map((w) => P.workoutWire(P.decodeWorkout(w))) };
    assert.equal(JSON.stringify(again), json);
    assert.ok(!json.includes('"g"'));
    payload.w.forEach((w) => w.e.forEach((e) => e.s.forEach((t) => {
      assert.equal(((t[5] || 0) >> 3) & 3, 0);
    })));
  });
});

/* ---------------- kinds on the wire ---------------- */

test('a kind is flags bits 3-4: drop 8, rest-pause 16, OR\'d with the side', () => {
  assert.deepEqual(P.setTuple(set(50, 10, { kind: 'drop' })), [50, 10, null, null, null, 8]);
  assert.deepEqual(P.setTuple(set(65, 4, { kind: 'restPause' })), [65, 4, null, null, null, 16]);
  assert.deepEqual(P.setTuple(set(30, 12, { side: 'left', kind: 'drop' })), [30, 12, null, null, null, 10]);
  assert.deepEqual(P.setTuple(set(30, 12, { side: 'right', kind: 'drop' })), [30, 12, null, null, null, 12]);
  assert.deepEqual(P.setTuple(set(30, 12, { side: 'left', kind: 'restPause' })), [30, 12, null, null, null, 18]);
  assert.deepEqual(P.setTuple(set(30, 12, { side: 'right', kind: 'restPause' })), [30, 12, null, null, null, 20]);
});

test('a straight both-sides set still writes no sixth position', () => {
  assert.deepEqual(P.setTuple(set(225, 5)), [225, 5]);
  assert.deepEqual(P.setTuple(set(225, 5, { kind: 'straight' })), [225, 5]);
  assert.deepEqual(P.setTuple(set(225, 5, { kind: null })), [225, 5]);
});

test('only trailing nulls are trimmed: a rest-pause hold keeps its slots', () => {
  assert.deepEqual(P.setTuple(set(null, null, { durationSec: 20, kind: 'restPause' })),
    [null, null, null, 20, null, 16]);
  assert.deepEqual(P.setTuple(set(null, 6, { kind: 'drop' })), [null, 6, null, null, null, 8]);
});

test('an exercise\'s first set is never written as a drop or rest-pause', () => {
  const wire = P.exerciseWire(ex('Pushdown', {}, [
    set(70, 12, { kind: 'drop' }), set(50, 10, { kind: 'drop' })]));
  assert.deepEqual(wire.s, [[70, 12], [50, 10, null, null, null, 8]]);
  // The side on a first set survives; only the kind goes.
  const sided = P.exerciseWire(ex('Row', {}, [set(30, 8, { side: 'left', kind: 'restPause' })]));
  assert.deepEqual(sided.s, [[30, 8, null, null, null, 2]]);
});

test('the stored first set is left alone by encoding', () => {
  const first = set(70, 12, { kind: 'drop' });
  P.workoutWire({ name: 'x', exercises: [ex('Pushdown', {}, [first])] });
  assert.equal(first.kind, 'drop');
});

/* ---------------- kinds read back ---------------- */

test('kinds are masked, never compared: left and drop is 10, and reads both', () => {
  const read = (flags) => {
    const s = P.decodeSet([30, 8, null, null, null, flags]);
    return [s.side || 'both', s.kind || 'straight'];
  };
  assert.deepEqual(read(8), ['both', 'drop']);
  assert.deepEqual(read(16), ['both', 'restPause']);
  assert.deepEqual(read(10), ['left', 'drop']);
  assert.deepEqual(read(12), ['right', 'drop']);
  assert.deepEqual(read(18), ['left', 'restPause']);
  assert.deepEqual(read(20), ['right', 'restPause']);
  assert.deepEqual(read(9), ['both', 'drop'], 'bit 0 is ignored');
  assert.deepEqual(read(11), ['left', 'drop'], 'bit 0 is ignored with a side too');
  assert.deepEqual(read(24), ['both', 'straight'], '3 in bits 3-4 is never written and reads straight');
  assert.deepEqual(read(26), ['left', 'straight']);
  assert.deepEqual(read(2), ['left', 'straight']);
  assert.deepEqual(read(0), ['both', 'straight']);
  assert.deepEqual(read(32 + 8), ['both', 'drop'], 'bits above 4 are not ours');
});

test('a junk sixth position is a straight both-sides set', () => {
  [undefined, null, 'x', '8', {}, [], NaN, -1, 2.5].forEach((flags) => {
    const s = P.decodeSet([30, 8, null, null, null, flags]);
    assert.equal(s.weightLb, 30, String(flags));
    assert.equal(s.reps, 8, String(flags));
  });
  assert.equal(P.decodeSet([30, 8, null, null, null, 'x']).kind, undefined);
  assert.equal(P.decodeSet([30, 8, null, null, null, -1]).kind, undefined, '-1 is 3 in every pair of bits');
  assert.equal(P.decodeSet([30, 8]).kind, undefined, 'no sixth position is straight');
  assert.equal(P.decodeSet('junk').kind, undefined);
});

test('a kind on a first set is ignored on the way in', () => {
  const back = P.decodeExercise({ n: 'Pushdown', s: [[70, 12, null, null, null, 10], [50, 10, null, null, null, 8]] });
  assert.equal('kind' in back.sets[0], false);
  assert.equal(back.sets[0].side, 'left', 'its side is still read');
  assert.equal(back.sets[1].kind, 'drop');
});

/* ---------------- groups on the wire ---------------- */

test('g is written on a run of two or more adjacent exercises sharing a group', () => {
  const wire = P.workoutWire({ name: 'Upper B', exercises: [
    ex('Bench', { group: 1 }), ex('Row', { group: 1 }), ex('Curl')] });
  assert.deepEqual(wire.e.map((e) => e.g), [1, 1, undefined]);
});

test('key order is n q b g s c', () => {
  const wire = P.workoutWire({ name: 'x', exercises: [
    ex('Split Squat', { equipment: 'Dumbbell', eachSide: true, group: 3, note: 'Slow.' }, [set(40, 8)]),
    ex('Row', { equipment: 'Cable', group: 3 }, [set(100, 10)]),
  ] });
  assert.equal(JSON.stringify(wire.e[0]),
    '{"n":"Split Squat","q":"Dumbbell","b":1,"g":1,"s":[[40,8]],"c":"Slow."}');
  assert.equal(JSON.stringify(wire.e[1]), '{"n":"Row","q":"Cable","g":1,"s":[[100,10]]}');
});

test('groups are renumbered 1, 2, 3 in order of appearance', () => {
  const wire = P.workoutWire({ name: 'x', exercises: [
    ex('A', { group: 7 }), ex('B', { group: 7 }),
    ex('C'),
    ex('D', { group: 3 }), ex('E', { group: 3 }), ex('F', { group: 3 }),
    ex('G', { group: 7 }), ex('H', { group: 7 }),
  ] });
  assert.deepEqual(wire.e.map((e) => e.g), [1, 1, undefined, 2, 2, 2, 3, 3]);
});

test('adjacency makes the group, not the number', () => {
  const g = (groups) => P.wireGroups(groups.map((group) => ({ group })));
  assert.deepEqual(g([1, null, 1]), [null, null, null], 'two groups of one are no group');
  assert.deepEqual(g([1]), [null], 'a group of one is an ordinary exercise');
  assert.deepEqual(g([1, 1, 2, 2]), [1, 1, 2, 2], 'neighbours with different numbers are two groups');
  assert.deepEqual(g([1, 2, 1]), [null, null, null]);
  assert.deepEqual(g([5, 5, 5, 5]), [1, 1, 1, 1]);
  assert.deepEqual(g([0, 0]), [null, null], 'never 0');
  assert.deepEqual(g(['1', '1']), [null, null], 'a string is not a group');
  assert.deepEqual(g([1.5, 1.5]), [null, null]);
  assert.deepEqual(g([-1, -1]), [null, null]);
  assert.deepEqual(g([1, 1, 0, 1, 1]), [1, 1, null, 2, 2]);
});

test('an exercise encoded on its own never carries g', () => {
  assert.equal('g' in P.exerciseWire(ex('Bench', { group: 1 })), false);
});

/* ---------------- groups read back ---------------- */

test('g reads by adjacency, renumbered, and anything not a positive integer is not grouped', () => {
  const read = (gs) => P.decodeWorkout({ n: 'x', e: gs.map((g, i) => ({ n: `E${i}`, g, s: [] })) })
    .exercises.map((e) => e.group);
  assert.deepEqual(read([4, 4, undefined, 9, 9, 9]), [1, 1, undefined, 2, 2, 2]);
  assert.deepEqual(read([1, undefined, 1]), [undefined, undefined, undefined]);
  assert.deepEqual(read([1, 2, 2, 1]), [undefined, 1, 1, undefined]);
  assert.deepEqual(read([0, 0, '3', '3', 1.5, 1.5, -2, -2, null, null, true, true]),
    Array(12).fill(undefined));
  assert.deepEqual(read([1]), [undefined]);
});

/* ---------------- round trips ---------------- */

const roundTrip = (workout) => P.decodeWorkout(JSON.parse(JSON.stringify(P.workoutWire(workout))));

test('round trip: superset, circuit, drop, rest-pause and a left-side drop', () => {
  const workout = {
    name: 'Set types',
    exercises: [
      ex('Back Squat', {}, [set(225, 5), set(225, 5)]),
      ex('Bench', { group: 1 }, [set(60, 10), set(60, 10)]),
      ex('Row', { group: 1 }, [set(120, 12), set(120, 12)]),
      ex('Swing', { group: 2 }, [set(53, 15)]),
      ex('Push-Up', { group: 2 }, [set(null, 12)]),
      ex('Plank', { group: 2 }, [set(null, null, { durationSec: 45 })]),
      ex('Pushdown', {}, [set(70, 12), set(50, 10, { kind: 'drop' }), set(35, 10, { kind: 'drop' })]),
      ex('Curl', {}, [set(65, 8), set(65, 4, { kind: 'restPause' })]),
      ex('One-Arm Row', { eachSide: true }, [set(50, 10), set(30, 12, { side: 'left', kind: 'drop' })]),
    ],
  };
  assert.deepEqual(roundTrip(workout), JSON.parse(JSON.stringify(workout)));
});

/* ---------------- storage and the backup ---------------- */

test('a backup keeps group only as a positive integer and kind only as drop or restPause', () => {
  const w = { exercises: [
    ex('A', { group: 2 }, [set(1, 1), set(1, 1, { kind: 'Drop' }), set(1, 1, { kind: ' restpause ' })]),
    ex('B', { group: 2 }, [set(1, 1, { kind: 'drop' }), set(1, 1, { kind: 'sideways' }), set(1, 1, { kind: null })]),
    ex('C', { group: '3' }, [set(1, 1), set(1, 1, { kind: 'straight' })]),
    ex('D', { group: 0 }),
  ] };
  P.normaliseWorkout(w);
  const [a, b, c, d] = w.exercises;
  assert.equal(a.group, 1, 'renumbered as the wire would');
  assert.equal(b.group, 1);
  assert.equal(a.sets[1].kind, 'drop');
  assert.equal(a.sets[2].kind, 'restPause');
  assert.equal('kind' in b.sets[0], false, 'a first set has no kind');
  assert.equal('kind' in b.sets[1], false, 'junk reads straight');
  assert.equal('kind' in b.sets[2], false);
  assert.equal('group' in c, false, 'a string is not a group');
  assert.equal('kind' in c.sets[1], false, '"straight" is how nothing is spelt');
  assert.equal('group' in d, false);
});

test('a group of one is not kept in storage', () => {
  const w = { exercises: [ex('A', { group: 1 }), ex('B'), ex('C', { group: 1 })] };
  P.normaliseWorkout(w);
  assert.ok(w.exercises.every((e) => !('group' in e)));
});

test('a workout saved before set types restores unchanged', () => {
  const old = { id: 'w', name: 'Lower A', exercises: [
    { name: 'Back Squat', equipment: 'Barbell', note: '', sets: [set(225, 5), set(245, 3)] },
    { name: 'Split Squat', equipment: 'Dumbbell', note: '', eachSide: true,
      sets: [set(40, 8), set(40, 8, { side: 'left' })] }] };
  const copy = JSON.parse(JSON.stringify(old));
  P.normaliseWorkout(copy);
  assert.deepEqual(copy, old);
});

/* ---------------- the editor's join and split ---------------- */

const groupsOf = (list) => list.map((e) => e.group);

test('"Superset with next" joins two, and again makes a circuit of three', () => {
  const list = [ex('A'), ex('B'), ex('C'), ex('D')];
  assert.equal(P.groupedWithNext(list, 0), false);
  P.setGroupedWithNext(list, 0, true);
  assert.deepEqual(groupsOf(list), [1, 1, undefined, undefined]);
  assert.equal(P.groupedWithNext(list, 0), true);
  P.setGroupedWithNext(list, 1, true);
  assert.deepEqual(groupsOf(list), [1, 1, 1, undefined]);
  // Joining the exercise before a group takes the whole group.
  const before = [ex('A'), ex('B', { group: 1 }), ex('C', { group: 1 })];
  P.setGroupedWithNext(before, 0, true);
  assert.deepEqual(groupsOf(before), [1, 1, 1]);
});

test('joining two groups makes one', () => {
  const list = [ex('A', { group: 1 }), ex('B', { group: 1 }), ex('C', { group: 2 }), ex('D', { group: 2 })];
  P.setGroupedWithNext(list, 1, true);
  assert.deepEqual(groupsOf(list), [1, 1, 1, 1]);
});

test('splitting keeps what is before the split and gives the rest a group of their own', () => {
  const circuit = [ex('A', { group: 1 }), ex('B', { group: 1 }), ex('C', { group: 1 }), ex('D')];
  P.setGroupedWithNext(circuit, 0, false);
  assert.deepEqual(groupsOf(circuit), [undefined, 1, 1, undefined], 'a superset is left behind');
  const again = [ex('A', { group: 1 }), ex('B', { group: 1 }), ex('C', { group: 1 }), ex('D', { group: 1 })];
  P.setGroupedWithNext(again, 1, false);
  assert.deepEqual(groupsOf(again), [1, 1, 2, 2]);
  const pair = [ex('A', { group: 1 }), ex('B', { group: 1 })];
  P.setGroupedWithNext(pair, 0, false);
  assert.deepEqual(groupsOf(pair), [undefined, undefined]);
});

test('the last exercise has no next, and asking changes nothing', () => {
  const list = [ex('A'), ex('B')];
  P.setGroupedWithNext(list, 1, true);
  assert.deepEqual(groupsOf(list), [undefined, undefined]);
  assert.equal(P.groupedWithNext(list, 1), false);
});

test('removing the middle of a superset leaves no group of one; of a circuit, a superset', () => {
  const pair = [ex('A', { group: 1 }), ex('B', { group: 1 }), ex('C')];
  pair.splice(1, 1);
  P.regroup(pair);
  assert.deepEqual(groupsOf(pair), [undefined, undefined]);
  const circuit = [ex('A', { group: 1 }), ex('B', { group: 1 }), ex('C', { group: 1 })];
  circuit.splice(1, 1);
  P.regroup(circuit);
  assert.deepEqual(groupsOf(circuit), [1, 1]);
});

/* ---------------- how it reads ---------------- */

test('a group is labelled "Superset A" for two and "Circuit B" for three, members A1, A2', () => {
  const labels = P.groupLabels([
    ex('Plain'), ex('Bench', { group: 1 }), ex('Row', { group: 1 }),
    ex('Swing', { group: 2 }), ex('Push-Up', { group: 2 }), ex('Plank', { group: 2 }),
    ex('Curl', { group: 9 }),
  ]);
  assert.equal(labels[0], null);
  assert.deepEqual(labels.slice(1, 6).map((l) => `${l.group} · ${l.member}`), [
    'Superset A · A1', 'Superset A · A2', 'Circuit B · B1', 'Circuit B · B2', 'Circuit B · B3']);
  assert.equal(labels[6], null, 'a group of one is not labelled');
  assert.deepEqual(labels.map((l) => l && l.first), [null, true, false, true, false, false, null]);
});

test('the letters run on past Z', () => {
  const many = [];
  for (let g = 1; g <= 28; g++) many.push(ex('a', { group: g }), ex('b', { group: g }));
  const labels = P.groupLabels(many);
  assert.equal(labels[50].group, 'Superset Z');
  assert.equal(labels[52].group, 'Superset AA');
  assert.equal(labels[55].member, 'AB2');
});

test('a set reads with its kind as it reads with its side', () => {
  assert.equal(P.setText(set(50, 10, { kind: 'drop' })), '50 × 10 drop');
  assert.equal(P.setText(set(65, 4, { kind: 'restPause' })), '65 × 4 rest-pause');
  assert.equal(P.setText(set(30, 12, { side: 'left', kind: 'drop' })), '30 × 12 L drop');
  assert.equal(P.setText(set(30, 12)), '30 × 12');
  assert.equal(P.summary(ex('Pushdown', {}, [set(70, 12), set(70, 12), set(50, 10, { kind: 'drop' }), set(35, 10, { kind: 'drop' })])),
    '70 × 12, 70 × 12, 50 × 10 drop, 35 × 10 drop');
  assert.equal(P.summary(ex('Curl', {}, [set(65, 8), set(65, 4, { kind: 'restPause' })])),
    '65 × 8, 65 × 4 rest-pause');
});

test('each side keeps a kind in the summary, on the plain sets and the extras', () => {
  assert.equal(P.summary(ex('Row', { eachSide: true }, [set(50, 10), set(30, 12, { kind: 'drop' })])),
    '50 × 10, 30 × 12 drop each side');
  assert.equal(P.summary(ex('Row', { eachSide: true }, [set(50, 10), set(50, 10), set(30, 12, { side: 'left', kind: 'drop' })])),
    '2 × 50 × 10 each side + 30 × 12 L drop');
  // An extra that is the same set, kind and all, is still "+ 1 L".
  assert.equal(P.summary(ex('Row', { eachSide: true }, [set(50, 10), set(30, 12, { kind: 'drop' }), set(30, 12, { side: 'left', kind: 'drop' })])),
    '50 × 10, 30 × 12 drop each side + 30 × 12 L drop');
});

test('a kind does not change what an exercise asks for', () => {
  assert.deepEqual(P.targets(ex('Row', { eachSide: true }, [set(50, 10), set(30, 12, { side: 'left', kind: 'drop' })])),
    { left: 2, right: 1, both: 0 });
});

/* ---------------- an old decoder ---------------- */

// decodeSet and decodeExercise as they stood on main before set types,
// verbatim but for the side lookup: what a LIFT or Coach build that has never
// heard of `g` or bits 3-4 does with this plan.
const mainDecodeSet = (tuple) => {
  const t = Array.isArray(tuple) ? tuple : [];
  const orNull = (v) => (v == null ? null : v);
  const s = { weightLb: orNull(t[0]), reps: orNull(t[1]), rpe: orNull(t[2]),
    durationSec: orNull(t[3]), distanceM: orNull(t[4]) };
  const side = S.sideFromFlags(t[5]);
  if (side) s.side = side;
  return s;
};
const mainDecodeWorkout = (w) => ({
  name: w.n || 'Session',
  exercises: (w.e || []).map((x) => {
    const e = { name: x.n || 'Exercise', equipment: x.q || '', note: x.c || '', sets: (x.s || []).map(mainDecodeSet) };
    if (Number(x.b) === 1) e.eachSide = true;
    return e;
  }),
});

const strip = (workout) => ({
  ...workout,
  exercises: workout.exercises.map(({ group, ...e }) => ({
    ...e, sets: e.sets.map(({ kind, ...s }) => s),
  })),
});

/* ---------------- the interop fixture ---------------- */

// coach/fixtures/web-plan-set-types.txt was produced by this app's own
// encoder (planPayload's shape for one client and one booked session, packed
// by CoachPrescriptions.pack, in node, 2026-10-28) and is checked into the
// LIFT web, iOS and Android decoders' tests as proof of what Coach web sends.
// Never regenerate it from a decoder, or from Swift or Kotlin -- that would
// prove only that a decoder agrees with itself. These tests read it; nothing
// here writes it.
const FIXTURE = readFileSync('coach/fixtures/web-plan-set-types.txt', 'utf8');
const fixtureJson = () => P.unpack(FIXTURE);

test('fixture: the envelope is a v1 plan link, like its siblings', async () => {
  assert.ok(FIXTURE.startsWith('https://www.dugcanlift.com/lift/#1z'));
  const json = await fixtureJson();
  assert.ok(json.startsWith('{"v":1,"t":"plan","l":"a1b2c3d4"'), 'v stays 1');
});

test('fixture: the raw wire carries g and the kind bits as specified', async () => {
  const payload = JSON.parse(await fixtureJson());
  assert.deepEqual(payload.k, [{ d: '2026-11-02', x: 0 }]);
  const e = payload.w[0].e;
  assert.deepEqual(e.map((x) => x.n), [
    'Back Squat', 'Dumbbell Bench Press', 'Seated Cable Rows',
    'Kettlebell Swing', 'Push-Up', 'Plank',
    'Triceps Pushdown', 'Barbell Curl', 'Single-Arm Dumbbell Row']);
  assert.deepEqual(e.map((x) => x.g), [undefined, 1, 1, 2, 2, 2, undefined, undefined, undefined]);
  assert.deepEqual(e.map((x) => x.b), [undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, 1]);
  assert.deepEqual(e[0].s, [[225, 5, 8], [225, 5, 8], [225, 5, 8]], 'an ordinary exercise');
  assert.deepEqual(e[5].s, [[null, null, null, 45], [null, null, null, 45]], 'a circuit member with fewer sets');
  assert.deepEqual(e[6].s, [[70, 12], [70, 12], [50, 10, null, null, null, 8], [35, 10, null, null, null, 8]]);
  assert.deepEqual(e[7].s, [[65, 8], [65, 4, null, null, null, 16]]);
  assert.deepEqual(e[8].s, [[50, 10], [50, 10], [30, 12, null, null, null, 10]], 'left and drop is 10');
  // Key order, exercise by exercise: n q b g s c.
  e.forEach((x) => {
    const order = Object.keys(x).join(' ');
    assert.ok(/^n( q)?( b)?( g)? s( c)?$/.test(order), order);
  });
  // No first set anywhere carries a kind.
  e.forEach((x) => assert.equal(((x.s[0][5] || 0) >> 3) & 3, 0, x.n));
});

test('fixture: it decodes to the groups and kinds the editor wrote', async () => {
  const w = P.decodeWorkout(JSON.parse(await fixtureJson()).w[0]);
  assert.deepEqual(w.exercises.map((x) => x.group),
    [undefined, 1, 1, 2, 2, 2, undefined, undefined, undefined]);
  assert.deepEqual(P.groupLabels(w.exercises).map((l) => l && `${l.group} · ${l.member}`), [
    null, 'Superset A · A1', 'Superset A · A2',
    'Circuit B · B1', 'Circuit B · B2', 'Circuit B · B3',
    null, null, null]);
  const kinds = (i) => w.exercises[i].sets.map((s) => s.kind || 'straight');
  assert.deepEqual(kinds(6), ['straight', 'straight', 'drop', 'drop']);
  assert.deepEqual(kinds(7), ['straight', 'restPause']);
  assert.deepEqual(kinds(8), ['straight', 'straight', 'drop']);
  assert.equal(w.exercises[8].sets[2].side, 'left');
  assert.equal(w.exercises[8].eachSide, true);
  assert.deepEqual(w.exercises.map(P.summary), [
    '3 × 225 × 5 · @8',
    '3 × 60 × 10',
    '3 × 120 × 12',
    '3 × 53 × 15',
    '3 × 12 reps',
    '2 × 45s',
    '70 × 12, 70 × 12, 50 × 10 drop, 35 × 10 drop',
    '65 × 8, 65 × 4 rest-pause',
    '2 × 50 × 10 each side + 30 × 12 L drop',
  ]);
});

test('fixture: decoded and encoded again, it is the same JSON', async () => {
  const json = await fixtureJson();
  const payload = JSON.parse(json);
  const again = { ...payload, w: payload.w.map((w) => P.workoutWire(P.decodeWorkout(w))) };
  assert.equal(JSON.stringify(again), json);
});

test('fixture: an old decoder reads the right exercises, sets, numbers and sides', async () => {
  const wire = JSON.parse(await fixtureJson()).w[0];
  const old = mainDecodeWorkout(wire);
  assert.deepEqual(old, strip(P.decodeWorkout(wire)),
    'with g and bits 3-4 ignored, everything else is what this decoder reads');
  assert.equal(old.exercises.length, 9);
  assert.deepEqual(old.exercises.map((x) => x.sets.length), [3, 3, 3, 3, 3, 2, 4, 2, 3]);
  assert.deepEqual(old.exercises[6].sets.map((s) => [s.weightLb, s.reps]), [[70, 12], [70, 12], [50, 10], [35, 10]]);
  assert.equal(old.exercises[8].sets[2].side, 'left', 'the side bits read through the kind bits');
  assert.ok(old.exercises.slice(0, 8).every((x) => x.sets.every((s) => !s.side)),
    'a drop or rest-pause set is not mistaken for a side');
});
