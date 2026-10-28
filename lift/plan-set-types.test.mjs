import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';

// Set types: supersets and circuits (`g`), drop sets and rest-pause (flags
// bits 3-4). coach/PLAN-FORMAT.md "Set types" has the rules, and Coach web's
// coach/prescriptions.js is the reference implementation set-types.js ports.
//
// fixtures/web-plan-set-types.txt: a plan link Coach web's own encoder wrote
// (dugcanlift-coach, coach/fixtures/, the same bytes). A superset, a circuit
// of three with a member that has fewer sets, two drop sets, a rest-pause set,
// a left-side drop set (`10`) on an each-side exercise, and an ordinary
// exercise. Never regenerate it from a decoder here.
const FIXTURE = readFileSync('lift/fixtures/web-plan-set-types.txt', 'utf8').trim();

async function unpack(link) {
  const frag = link.slice(link.indexOf('#') + 1);
  const match = frag.match(/^(\d+)([zu])([A-Za-z0-9_-]+)$/);
  const bytes = Buffer.from(match[3], 'base64url');
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return JSON.parse(await new Response(stream).text());
}

// Loaded the way the browser loads them, in index.html's order.
const shim = { window: {} };
['sides.js', 'set-types.js', 'plan-log.js', 'routines.js', 'backup.js'].forEach((file) => {
  new Function('window', readFileSync(`lift/${file}`, 'utf8')).call(shim, shim.window);
});
const S = shim.window.LiftSides;
const T = shim.window.LiftSetTypes;
const R = shim.window.LiftRoutines;
const B = shim.window.LiftBackup;

// importTraining, startPrescribed and the prescription's set text, lifted out
// of app.js as they are now and run against stand-ins for storage, so the
// test reads the real code rather than a copy of it -- as plan-sides does.
function liftApp() {
  const src = readFileSync('lift/app.js', 'utf8');
  const grab = (start, end) => {
    const i = src.indexOf(start);
    assert.ok(i >= 0, start);
    return src.slice(i, src.indexOf(end, i));
  };
  const code = [
    grab('function formatPrescription(set, kind)', '/* An exercise\'s heading'),
    grab('function importTraining(payload)', 'const prescribedFor'),
    grab('function startPrescribed(prescription)', 'async function checkForIncomingPlan'),
    'return { importTraining, startPrescribed, formatPrescription,'
      + ' state: () => ({ training, workouts, templates }) };',
  ].join('\n');
  let n = 0;
  return new Function('LiftSides', 'LiftSetTypes', 'LiftPlanLog', 'KEY', 'save', 'uid', 'render', 'setPerSide',
    'let training = [], workouts = [], templates = [];\n' + code)(
    S, T, shim.window.LiftPlanLog, {}, () => {}, () => 'id' + (++n), () => {}, () => {});
}

async function accepted() {
  const app = liftApp();
  app.importTraining(await unpack(FIXTURE));
  return app;
}

// MARK: - The fixture

test('fixture: a v1 plan link, like its siblings', async () => {
  assert.ok(FIXTURE.startsWith('https://www.dugcanlift.com/lift/#1z'));
  const payload = await unpack(FIXTURE);
  assert.equal(payload.v, 1, 'v stays 1, so an old build does not refuse the link');
  assert.equal(payload.t, 'plan');
  assert.deepEqual(payload.k, [{ d: '2026-11-02', x: 0 }]);
});

test('fixture: the raw wire carries g and the kind bits as specified', async () => {
  const e = (await unpack(FIXTURE)).w[0].e;
  assert.deepEqual(e.map((x) => x.n), [
    'Back Squat', 'Dumbbell Bench Press', 'Seated Cable Rows',
    'Kettlebell Swing', 'Push-Up', 'Plank',
    'Triceps Pushdown', 'Barbell Curl', 'Single-Arm Dumbbell Row']);
  assert.deepEqual(e.map((x) => x.g), [undefined, 1, 1, 2, 2, 2, undefined, undefined, undefined]);
  assert.deepEqual(e[6].s, [[70, 12], [70, 12], [50, 10, null, null, null, 8], [35, 10, null, null, null, 8]]);
  assert.deepEqual(e[7].s, [[65, 8], [65, 4, null, null, null, 16]]);
  assert.deepEqual(e[8].s, [[50, 10], [50, 10], [30, 12, null, null, null, 10]], 'left and drop is 10');
});

test('fixture: it imports with its groups and kinds', async () => {
  const app = await accepted();
  const [day] = app.state().training;
  assert.equal(day.date, '2026-11-02');
  assert.deepEqual(day.exercises.map((x) => x.group),
    [undefined, 1, 1, 2, 2, 2, undefined, undefined, undefined]);
  const kinds = (i) => day.exercises[i].sets.map((s) => s.kind || 'straight');
  assert.deepEqual(kinds(0), ['straight', 'straight', 'straight']);
  assert.deepEqual(kinds(6), ['straight', 'straight', 'drop', 'drop']);
  assert.deepEqual(kinds(7), ['straight', 'restPause']);
  assert.deepEqual(kinds(8), ['straight', 'straight', 'drop']);
  // The kind bits did not disturb the side bits, or the reverse.
  assert.equal(day.exercises[8].sets[2].side, 'left');
  assert.equal(day.exercises[8].eachSide, true);
  assert.ok(day.exercises.slice(0, 8).every((x) => x.sets.every((s) => !s.side)),
    'a drop or rest-pause set is not mistaken for a side');
  // The numbers as the coach wrote them.
  assert.deepEqual(day.exercises[6].sets.map((s) => [s.weightLb, s.reps]), [[70, 12], [70, 12], [50, 10], [35, 10]]);
  assert.deepEqual(day.exercises[5].sets.map((s) => s.durationSec), [45, 45], 'a circuit member with fewer sets');
});

test('fixture: labelled "Superset A" and "Circuit B", members A1, A2, B1...', async () => {
  const [day] = (await accepted()).state().training;
  assert.deepEqual(T.groupLabels(day.exercises).map((l) => l && `${l.group} · ${l.member}`), [
    null, 'Superset A · A1', 'Superset A · A2',
    'Circuit B · B1', 'Circuit B · B2', 'Circuit B · B3',
    null, null, null]);
});

test('fixture: its sets read side then kind, as Coach web writes them', async () => {
  const app = await accepted();
  const [day] = app.state().training;
  const text = (i) => day.exercises[i].sets.map((s, n) => app.formatPrescription(s, T.kindAt(day.exercises[i].sets, n)));
  assert.deepEqual(text(6), ['70 x 12', '70 x 12', '50 x 10 drop', '35 x 10 drop']);
  assert.deepEqual(text(7), ['65 x 8', '65 x 4 rest-pause']);
  assert.deepEqual(text(8), ['50 x 10', '50 x 10', '30 x 12 L drop']);
  assert.deepEqual(text(0), ['225 x 5 @8', '225 x 5 @8', '225 x 5 @8']);
});

// MARK: - Old decoder degradation

// importTraining's toTemplate as it stood on main before set types
// (dugcanlift-site 957f219, lift/app.js), verbatim. Frozen on purpose: it is
// what a LIFT web build that has never heard of `g` or bits 3-4 does with a
// plan, and the promise is that it reads the right exercises, sets, numbers
// and sides from this one.
const mainToTemplate = (raw) => ({
  name: raw.n || 'Session',
  exercises: (raw.e || []).map((exercise) => ({
    name: exercise.n || 'Exercise',
    equipment: exercise.q || '',
    note: exercise.c || '',
    ...(Number(exercise.b) === 1 ? { eachSide: true } : {}),
    sets: (exercise.s || []).map((tuple) => {
      const set = {
        weightLb: tuple[0] ?? null,
        reps: tuple[1] ?? null,
        rpe: tuple[2] ?? null,
        durationSec: tuple[3] ?? null,
        distanceMeters: tuple[4] ?? null,
      };
      const side = S.sideFromFlags(tuple[5]);
      if (side) set.side = side;
      return set;
    }),
  })),
});

const strip = (body) => ({
  ...body,
  exercises: body.exercises.map(({ group, ...e }) => ({
    ...e, sets: e.sets.map(({ kind, ...s }) => s),
  })),
});

test('old decoder: with g and bits 3-4 ignored, the exercises, sets and numbers are the same', async () => {
  const payload = await unpack(FIXTURE);
  const old = mainToTemplate(payload.w[0]);
  const [day] = (await accepted()).state().training;
  const { id, date, fromCoach, startedSessionId, ...body } = day;
  assert.deepEqual(old, strip(body), 'everything but the groups and kinds is what main read');
  assert.equal(old.exercises.length, 9);
  assert.deepEqual(old.exercises.map((x) => x.sets.length), [3, 3, 3, 3, 3, 2, 4, 2, 3]);
  assert.deepEqual(old.exercises[6].sets.map((s) => [s.weightLb, s.reps]), [[70, 12], [70, 12], [50, 10], [35, 10]]);
  assert.equal(old.exercises[8].sets[2].side, 'left', 'the side bits read through the kind bits');
  assert.ok(old.exercises.slice(0, 8).every((x) => x.sets.every((s) => !s.side)),
    'main masks, so a drop set (8) or rest-pause (16) is not read as a side');
  old.exercises.forEach((x) => assert.equal('group' in x, false));
});

// MARK: - A plan without set types imports as it always did

// startPrescribed's copy as it stood on main before set types, verbatim but
// for the storage around it. With mainToTemplate above, it is the whole of
// what a plan becomes on this device.
function mainStart(prescription, uid) {
  return {
    id: uid(),
    date: prescription.date,
    name: prescription.name,
    note: '',
    exercises: prescription.exercises.map((exercise) => ({
      id: uid(),
      name: exercise.name,
      equipment: exercise.equipment,
      note: exercise.note || '',
      ...(S.prescribesSides(exercise.sets, exercise.eachSide) ? {
        prescribed: exercise.sets.map((set) => ({ ...set })),
        ...(exercise.eachSide ? { eachSide: true } : {}),
      } : {}),
      sets: exercise.sets.filter((set) => !exercise.eachSide && !S.of(set)).map((set) => {
        const copy = { id: uid() };
        if (set.weightLb != null) copy.weightLb = set.weightLb;
        if (set.reps != null) copy.reps = set.reps;
        if (set.rpe != null) copy.rpe = set.rpe;
        if (set.durationSec != null) copy.durationSec = set.durationSec;
        if (set.distanceMeters != null) copy.distanceMeters = set.distanceMeters;
        return copy;
      }),
    })),
  };
}

// The sibling fixtures, written by Coach web before set types, and a plan of
// every shape a set could take -- plus `g` values that make no group and kind
// bits on first sets, which must change nothing either.
const untyped = async () => [
  await unpack(readFileSync('lift/fixtures/web-plan-per-side.txt', 'utf8').trim()),
  await unpack(readFileSync('lift/fixtures/web-plan-road-picks.txt', 'utf8').trim()),
  { v: 1, t: 'plan', w: [{ n: 'Every shape', e: [
    { n: 'Back Squat', q: 'Barbell', c: 'Belt on the last set.', s: [[225, 5, 8], [245, 3, 9]] },
    { n: 'Walking Lunge', b: 1, s: [[null, 12], [0, 12]] },
    { n: 'Row', q: 'Machine', s: [[null, null, null, 600, 1600, 2], [null, null]] },
    { n: 'Lone', g: 1, s: [[100, 5], [100, 5]] },
    { n: 'Zero', g: 0, s: [[100, 5]] },
    { n: 'String', g: '2', s: [[100, 5]] },
    { n: 'String too', g: '2', s: [[100, 5]] },
    { n: 'Fraction', g: 2.5, s: [[100, 5]] },
    { n: 'Fraction too', g: 2.5, s: [[100, 5]] },
    { n: 'Negative', g: -3, s: [[100, 5]] },
    { n: 'Negative too', g: -3, s: [[100, 5]] },
    { n: 'Not after the lone one', g: 1, s: [[100, 5]] },
    { n: 'First set says drop', s: [[70, 12, null, null, null, 8], [70, 12, null, null, null, 24]] },
    { n: 'Empty', q: 'Cable', s: [] },
  ] }] },
];

test('a plan without set types is stored byte for byte as main stored it', async () => {
  for (const payload of await untyped()) {
    payload.w.forEach((raw) => {
      // A library send: filed as a template, its body nothing but toTemplate.
      const app = liftApp();
      app.importTraining({ v: 1, t: 'plan', w: [raw] });
      const { id, fromCoach, ...body } = app.state().templates[0];
      assert.equal(JSON.stringify(body), JSON.stringify(mainToTemplate(raw)), raw.n);
    });
  }
});

test('a plan without set types starts the same session main started', async () => {
  for (const payload of await untyped()) {
    for (const raw of payload.w) {
      const prescription = { id: 'p', date: '2026-11-02', ...mainToTemplate(raw) };
      const app = liftApp();
      app.startPrescribed(prescription);
      const { startedAt, ...session } = app.state().workouts[0];
      let n = 0;
      assert.equal(JSON.stringify(session), JSON.stringify(mainStart(prescription, () => 'id' + (++n))), raw.n);
    }
  }
});

// MARK: - Kinds are masked, never compared

test('flags bits 3-4: 8 drop, 16 rest-pause, OR\'d with the side, and 3 is straight', () => {
  const read = (flags) => {
    const app = liftApp();
    app.importTraining({ v: 1, t: 'plan', w: [{ n: 'x', e: [{ n: 'Row', s: [[30, 8], [30, 8, null, null, null, flags]] }] }] });
    const s = app.state().templates[0].exercises[0].sets[1];
    assert.equal(s.weightLb, 30, String(flags));
    assert.equal(s.reps, 8, String(flags));
    return [s.side || 'both', s.kind || 'straight'];
  };
  assert.deepEqual(read(8), ['both', 'drop']);
  assert.deepEqual(read(16), ['both', 'restPause']);
  assert.deepEqual(read(10), ['left', 'drop']);
  assert.deepEqual(read(12), ['right', 'drop']);
  assert.deepEqual(read(18), ['left', 'restPause']);
  assert.deepEqual(read(20), ['right', 'restPause']);
  assert.deepEqual(read(9), ['both', 'drop'], 'bit 0 is ignored');
  assert.deepEqual(read(24), ['both', 'straight'], '3 in bits 3-4 is never written and reads straight');
  assert.deepEqual(read(26), ['left', 'straight']);
  assert.deepEqual(read(2), ['left', 'straight']);
  assert.deepEqual(read(0), ['both', 'straight']);
  assert.deepEqual(read(40), ['both', 'drop'], 'bits above 4 are not ours');
  ['x', null, {}, [], NaN, -1, 2.5].forEach((junk) => assert.equal(read(junk)[1], 'straight', String(junk)));
});

test('a kind on an exercise\'s first set is ignored on the way in; its side is not', () => {
  const app = liftApp();
  app.importTraining({ v: 1, t: 'plan', w: [{ n: 'x', e: [{ n: 'Pushdown',
    s: [[70, 12, null, null, null, 10], [50, 10, null, null, null, 8]] }] }] });
  const [first, second] = app.state().templates[0].exercises[0].sets;
  assert.equal('kind' in first, false);
  assert.equal(first.side, 'left');
  assert.equal(second.kind, 'drop');
});

// MARK: - Groups read by adjacency

test('g reads by adjacency, renumbered, and anything not a positive integer is not grouped', () => {
  const read = (gs) => {
    const app = liftApp();
    app.importTraining({ v: 1, t: 'plan', w: [{ n: 'x', e: gs.map((g, i) => ({ n: `E${i}`, g, s: [] })) }] });
    return app.state().templates[0].exercises.map((e) => e.group);
  };
  assert.deepEqual(read([4, 4, undefined, 9, 9, 9]), [1, 1, undefined, 2, 2, 2]);
  assert.deepEqual(read([1, undefined, 1]), [undefined, undefined, undefined]);
  assert.deepEqual(read([1, 2, 2, 1]), [undefined, 1, 1, undefined]);
  assert.deepEqual(read([0, 0, '3', '3', 1.5, 1.5, -2, -2, null, null, true, true]),
    Array(12).fill(undefined));
  assert.deepEqual(read([1]), [undefined], 'a group of one is an ordinary exercise');
});

// MARK: - Starting it carries the types onto the day

test('starting the fixture copies its groups and kinds onto the logged session', async () => {
  const app = await accepted();
  app.startPrescribed(app.state().training[0]);
  const ex = app.state().workouts[0].exercises;
  assert.deepEqual(ex.map((e) => e.group), [undefined, 1, 1, 2, 2, 2, undefined, undefined, undefined]);
  assert.deepEqual(T.groupLabels(ex).map((l) => l && l.member),
    [null, 'A1', 'A2', 'B1', 'B2', 'B3', null, null, null], 'labelled as the card was');
  assert.deepEqual(ex[6].sets.map((s) => s.kind || 'straight'), ['straight', 'straight', 'drop', 'drop']);
  assert.deepEqual(ex[7].sets.map((s) => s.kind || 'straight'), ['straight', 'restPause']);
  // An each-side exercise is logged a side at a time, so its kinds wait in the
  // prescription it is logged against.
  assert.equal(ex[8].sets.length, 0);
  assert.deepEqual(ex[8].prescribed.map((s) => s.kind || 'straight'), ['straight', 'straight', 'drop']);
  assert.equal(ex[8].prescribed[2].side, 'left');
});

test('a logged set\'s kind never reaches the coach: the share tuple has no kind bits', async () => {
  const app = await accepted();
  app.startPrescribed(app.state().training[0]);
  const drop = app.state().workouts[0].exercises[6].sets[2];
  assert.equal(drop.kind, 'drop');
  assert.deepEqual(S.encodeSet(drop), [50, 10], 'an ordinary set with its real numbers');
});

test('a set shown first is straight, whatever it carries', () => {
  const sets = [{ weightLb: 50, reps: 10, kind: 'drop' }, { weightLb: 35, reps: 10, kind: 'drop' }];
  assert.equal(T.kindAt(sets, 0), null, 'the set before it was deleted');
  assert.equal(T.kindAt(sets, 1), 'drop');
  assert.equal(T.kindLabel(T.kindAt(sets, 1)), 'drop');
  assert.equal(T.kindLabel('restPause'), 'rest-pause');
  assert.equal(T.kindLabel(null), '');
});

// MARK: - Your routines

let n = 0;
const makeId = () => `id-${++n}`;
const routine = (groups) => ({
  id: 'r', name: 'Upper B', folder: '', createdAt: 1,
  exercises: groups.map((group, i) => ({
    id: `e${i}`, name: `E${i}`, equipment: '', targetSets: 3, targetReps: 10, targetWeightLb: null,
    targetRpe: null, targetDurationSec: null, targetDistanceMeters: null, note: '',
    ...(group != null ? { group } : {}),
  })),
});

test('a routine\'s superset is copied onto the day it starts', () => {
  const session = R.toSession(routine([null, 1, 1, null]), '2026-11-02', makeId, 1);
  assert.deepEqual(session.exercises.map((e) => e.group), [undefined, 1, 1, undefined]);
  assert.deepEqual(T.groupLabels(session.exercises).map((l) => l && l.group),
    [null, 'Superset A', 'Superset A', null]);
});

test('a routine without groups starts exactly as before: no group key at all', () => {
  const session = R.toSession(routine([null, null]), '2026-11-02', makeId, 1);
  session.exercises.forEach((e) => assert.deepEqual(Object.keys(e), ['id', 'name', 'equipment', 'note', 'sets']));
});

test('saving a session as a routine keeps its superset, and a copy keeps it too', () => {
  const session = R.toSession(routine([2, 2, 2]), '2026-11-02', makeId, 1);
  const kept = R.fromSession(session, 'Circuit day', '', makeId, 1);
  assert.deepEqual(kept.exercises.map((e) => e.group), [2, 2, 2]);
  assert.deepEqual(R.copyOf(kept, makeId, 1).exercises.map((e) => e.group), [2, 2, 2]);
  const plain = R.fromSession(R.toSession(routine([null]), 'd', makeId, 1), 'x', '', makeId, 1);
  assert.equal('group' in plain.exercises[0], false);
});

// MARK: - The editor's join and split

const groupsOf = (list) => list.map((e) => e.group);
const ex = (name, extra = {}) => ({ name, ...extra });

test('"Superset with next" joins two, and again makes a circuit of three', () => {
  const list = [ex('A'), ex('B'), ex('C'), ex('D')];
  assert.equal(T.groupedWithNext(list, 0), false);
  T.setGroupedWithNext(list, 0, true);
  assert.deepEqual(groupsOf(list), [1, 1, undefined, undefined]);
  assert.equal(T.groupedWithNext(list, 0), true);
  T.setGroupedWithNext(list, 1, true);
  assert.deepEqual(groupsOf(list), [1, 1, 1, undefined]);
  assert.equal(T.groupLabels(list)[0].group, 'Circuit A');
  // Joining the exercise before a group takes the whole group.
  const before = [ex('A'), ex('B', { group: 1 }), ex('C', { group: 1 })];
  T.setGroupedWithNext(before, 0, true);
  assert.deepEqual(groupsOf(before), [1, 1, 1]);
});

test('joining two groups makes one', () => {
  const list = [ex('A', { group: 1 }), ex('B', { group: 1 }), ex('C', { group: 2 }), ex('D', { group: 2 })];
  T.setGroupedWithNext(list, 1, true);
  assert.deepEqual(groupsOf(list), [1, 1, 1, 1]);
});

test('splitting keeps what is before the split and gives the rest a group of their own', () => {
  const circuit = [ex('A', { group: 1 }), ex('B', { group: 1 }), ex('C', { group: 1 }), ex('D')];
  T.setGroupedWithNext(circuit, 0, false);
  assert.deepEqual(groupsOf(circuit), [undefined, 1, 1, undefined], 'a superset is left behind');
  const four = [ex('A', { group: 1 }), ex('B', { group: 1 }), ex('C', { group: 1 }), ex('D', { group: 1 })];
  T.setGroupedWithNext(four, 1, false);
  assert.deepEqual(groupsOf(four), [1, 1, 2, 2]);
  const pair = [ex('A', { group: 1 }), ex('B', { group: 1 })];
  T.setGroupedWithNext(pair, 0, false);
  assert.deepEqual(groupsOf(pair), [undefined, undefined]);
  pair.forEach((e) => assert.equal('group' in e, false), 'no group of one is left in storage');
});

test('the last exercise has no next, and asking changes nothing', () => {
  const list = [ex('A'), ex('B')];
  T.setGroupedWithNext(list, 1, true);
  assert.deepEqual(groupsOf(list), [undefined, undefined]);
  assert.equal(T.groupedWithNext(list, 1), false);
});

test('a group is labelled "Superset" for two and "Circuit" for three, and the letters run on past Z', () => {
  const labels = T.groupLabels([ex('Plain'), ex('B', { group: 1 }), ex('R', { group: 1 }),
    ex('S', { group: 2 }), ex('P', { group: 2 }), ex('K', { group: 2 }), ex('Lone', { group: 9 })]);
  assert.deepEqual(labels.map((l) => l && `${l.group} · ${l.member}`), [null,
    'Superset A · A1', 'Superset A · A2', 'Circuit B · B1', 'Circuit B · B2', 'Circuit B · B3', null]);
  assert.deepEqual(labels.map((l) => l && l.first), [null, true, false, true, false, false, null]);
  const many = [];
  for (let g = 1; g <= 28; g++) many.push(ex('a', { group: g }), ex('b', { group: g }));
  assert.equal(T.groupLabels(many)[50].group, 'Superset Z');
  assert.equal(T.groupLabels(many)[52].group, 'Superset AA');
  assert.equal(T.groupLabels(many)[55].member, 'AB2');
});

// MARK: - The backup file

test('backup round trip: a routine\'s groups and a session\'s kinds come back as they went', () => {
  const routines = [routine([null, 1, 1, 2, 2, 2])];
  const workouts = [{ id: 'w', date: '2026-11-02', name: 'Upper B', exercises: [
    { id: 'x1', name: 'Pushdown', equipment: 'Cable', note: '', group: 1, sets: [
      { id: 's1', weightLb: 70, reps: 12 }, { id: 's2', weightLb: 50, reps: 10, kind: 'drop' }] },
    { id: 'x2', name: 'Curl', equipment: 'Barbell', note: '', group: 1, sets: [
      { id: 's3', weightLb: 65, reps: 8 }, { id: 's4', weightLb: 65, reps: 4, kind: 'restPause' }] },
  ] }];
  // saveBackup's half: normalised, then written.
  const stored = JSON.parse(JSON.stringify({ routines, workouts }));
  T.normaliseRecords(stored.routines);
  T.normaliseRecords(stored.workouts);
  const file = JSON.parse(JSON.stringify({ v: 1, app: 'lift', data: B.buildData(stored, {}) }));
  // loadBackup's half, onto an empty device.
  T.normaliseRecords(file.data.routines);
  T.normaliseRecords(file.data.workouts);
  const here = { routines: [], workouts: [] };
  B.addMissing(here.routines, file.data.routines);
  B.addMissing(here.workouts, file.data.workouts);
  assert.deepEqual(here, { routines, workouts });
  assert.ok(JSON.stringify(file).includes('"group":1'));
  assert.ok(JSON.stringify(file).includes('"kind":"restPause"'));
});

test('a backup reads set types leniently: junk is not grouped, or straight', () => {
  const records = [{ id: 'r', exercises: [
    { name: 'A', group: 2, sets: [{ reps: 1 }, { reps: 1, kind: 'Drop' }, { reps: 1, kind: ' restpause ' }] },
    { name: 'B', group: 2, sets: [{ reps: 1, kind: 'drop' }, { reps: 1, kind: 'sideways' }, { reps: 1, kind: null }] },
    { name: 'C', group: '3', sets: [{ reps: 1 }, { reps: 1, kind: 'straight' }] },
    { name: 'D', group: 0 },
    { name: 'E', group: 4 },
    { name: 'F', group: 1.5, targetSets: 3 },
  ] }, null, 'junk', { id: 'no exercises' }];
  T.normaliseRecords(records);
  const [a, b, c, d, e, f] = records[0].exercises;
  assert.equal(a.group, 1, 'renumbered as the wire would');
  assert.equal(b.group, 1);
  assert.equal(a.sets[1].kind, 'drop', 'case and space are forgiven');
  assert.equal(a.sets[2].kind, 'restPause');
  assert.equal('kind' in b.sets[0], false, 'a first set has no kind');
  assert.equal('kind' in b.sets[1], false, 'junk reads straight');
  assert.equal('kind' in b.sets[2], false);
  assert.equal('group' in c, false, 'a string is not a group');
  assert.equal('kind' in c.sets[1], false, '"straight" is how nothing is spelt');
  assert.equal('group' in d, false, 'never 0');
  assert.equal('group' in e, false, 'a group of one is none');
  assert.equal('group' in f, false);
  assert.deepEqual(records.slice(1), [null, 'junk', { id: 'no exercises' }]);
  assert.equal(T.normaliseRecords(undefined), undefined, 'a file with no section is fine');
});

test('a backup written before set types restores unchanged', () => {
  const old = [
    routine([null, null, null]),
    { id: 'w', date: '2026-10-01', name: 'Lower A', exercises: [
      { id: 'x', name: 'Split Squat', equipment: 'Dumbbell', note: '', sets: [
        { id: 's1', weightLb: 40, reps: 8, side: 'left' }, { id: 's2', weightLb: 40, reps: 8, side: 'right' }] },
      { id: 'y', name: 'Row', equipment: 'Cable', note: '', eachSide: true,
        prescribed: [{ weightLb: 30, reps: 8 }], sets: [] },
    ] },
  ];
  const copy = JSON.parse(JSON.stringify(old));
  T.normaliseRecords(copy);
  assert.equal(JSON.stringify(copy), JSON.stringify(old), 'byte for byte');
});
