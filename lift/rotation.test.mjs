import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';

// A port of LIFT iOS's RoutineRotationTests, case for case, on this build's
// routines and workouts. The cases after the ported ones are this build's
// own: how a session is known to have come from a routine.
const shim = { window: {} };
for (const file of ['lift/routines.js', 'lift/rotation.js']) {
  new Function('window', readFileSync(file, 'utf8')).call(shim, shim.window);
}
const R = shim.window.LiftRotation;
const LiftRoutines = shim.window.LiftRoutines;

let n = 0;
const makeId = () => `id-${++n}`;
const start = new Date(2027, 0, 15);
const day = (i) => {
  const d = new Date(start);
  d.setDate(d.getDate() + i);
  const p = (v) => String(v).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

const routine = (name, made, folder = 'PPL') => ({
  id: makeId(), name, folder, createdAt: start.getTime() + made * 86_400_000,
  exercises: [
    { id: makeId(), name: `${name} lift A`, equipment: 'Barbell', targetSets: 3, targetReps: 8 },
    { id: makeId(), name: `${name} lift B`, equipment: 'Cable', targetSets: 3, targetReps: 12 },
  ],
});

// Started the way this build starts one: LiftRoutines.toSession, the
// session's name and fresh ids. One exercise is kept, as iOS's `trained`
// keeps one ref: the rest were deleted, and it still came from the routine.
const trained = (r, on) => {
  const session = LiftRoutines.toSession(r, day(on), makeId, 0);
  session.exercises = session.exercises.slice(0, 1);
  return session;
};

const push = routine('Push', 0);
const pull = routine('Pull', 1);
const legs = routine('Legs', 2);
const ppl = [legs, push, pull];

test('before any is started the first made is up next', () => {
  assert.deepEqual(R.upNext('PPL', ppl, []), { routineId: push.id, after: null, lastDate: null });
});

test('the one after the last started is up next, and it wraps round', () => {
  assert.equal(R.upNext('PPL', ppl, [trained(push, 10)]).routineId, pull.id);
  assert.equal(R.upNext('PPL', ppl, [trained(push, 10), trained(legs, 12)]).routineId, push.id);
});

// Order is the order of the days, not of the list it was handed in.
test('the newest day decides', () => {
  const days = [trained(legs, 12), trained(pull, 14), trained(push, 10)];
  assert.equal(R.upNext('PPL', ppl, days).routineId, legs.id);
});

// A day logged by hand, or from another folder, moves nothing on.
test('a day from no routine of the folder is ignored', () => {
  const other = { id: makeId(), date: day(20), name: 'Arms', exercises: [{ name: 'Curl', equipment: 'Barbell', sets: [] }] };
  assert.equal(R.upNext('PPL', ppl, [trained(push, 10), other]).routineId, pull.id);
});

test('one routine, or the default folder, is no rotation', () => {
  assert.equal(R.upNext('PPL', [push], []), null);
  assert.equal(R.upNext('', ppl, []), null);
  assert.equal(R.upNext('  ', ppl, []), null);
});

// Two made at once (the same instant) go by name, so the order is stable.
test('a tie in when they were made goes by name', () => {
  const b = { ...routine('Day B', 0), createdAt: 1 };
  const a = { ...routine('Day A', 0), createdAt: 1 };
  assert.deepEqual(R.ordered([b, a]).map((r) => r.name), ['Day A', 'Day B']);
});

test('the current rotation is the one trained most recently', () => {
  const upper = routine('Upper', 3, 'Upper/Lower');
  const lower = routine('Lower', 4, 'Upper/Lower');
  const current = R.current([...ppl, upper, lower], [trained(push, 10), trained(upper, 15)]);
  assert.equal(current.folder, 'Upper/Lower');
  assert.equal(current.upNext.routineId, lower.id);
});

// Nobody asked for the first routine of every folder.
test('no rotation started suggests nothing', () => {
  assert.equal(R.current(ppl, []), null);
});

// MARK: - This build's own: which routine a session came from

// Nothing records the routine but the session's name, so the name has to be
// the routine's -- and the session has to hold one of its lifts, iOS's own
// condition, or a hand-logged "Push" of something else would turn the wheel.
test('a session came from a routine by its name and one of its lifts', () => {
  const session = trained(push, 10);
  assert.equal(R.startedFrom(session, push), true);
  assert.equal(R.startedFrom({ ...session, name: ' push ' }, push), true);
  assert.equal(R.startedFrom({ ...session, name: 'Push day' }, push), false);
  assert.equal(R.startedFrom({ ...session, exercises: [] }, push), false);
  // A same-named routine in another folder with other lifts is not this one.
  const otherPush = { ...routine('Push', 5, 'Bro split'),
    exercises: [{ id: makeId(), name: 'Dips', equipment: 'Body Only', targetSets: 3, targetReps: 10 }] };
  assert.equal(R.startedFrom(session, otherPush), false);
});

// Two of a folder's routines started on one date: the later one in the
// rotation is where it got to.
test('two started on one date count as the later in the rotation', () => {
  const days = [trained(pull, 10), trained(push, 10)];
  assert.equal(R.upNext('PPL', ppl, days).routineId, legs.id);
});

// A coach's session is the coach's, even when it shares a name and a lift
// with one of yours.
test('a coach session never turns a rotation', () => {
  const coachPull = trained(pull, 12);
  const training = [{ id: 't', date: day(12), startedSessionId: coachPull.id }];
  const own = R.ownSessions([trained(push, 10), coachPull], training, []);
  assert.equal(R.upNext('PPL', ppl, own).routineId, pull.id);
  const fromTemplate = R.ownSessions([trained(push, 10), trained(pull, 12)], [], [{ name: 'Pull' }]);
  assert.equal(R.upNext('PPL', ppl, fromTemplate).routineId, pull.id);
});

test('a named folder lists in its rotation order; the default folder as it was', () => {
  assert.deepEqual(R.listed('PPL', ppl).map((r) => r.name), ['Push', 'Pull', 'Legs']);
  assert.deepEqual(R.listed('', ppl).map((r) => r.name), ['Legs', 'Push', 'Pull']);
});

test('each folder has one up next, and the default folder none', () => {
  const mine = { ...routine('Mine', 9), folder: '' };
  const yours = { ...routine('Yours', 10), folder: '' };
  const ids = R.upNextIds([...ppl, mine, yours], [trained(push, 10)]);
  assert.deepEqual([...ids], [pull.id]);
});

// The starters arrive in their folders, so adding Push, Pull and Legs is a
// rotation with nothing else to do.
test('the starter splits added one by one are a rotation', () => {
  const splits = JSON.parse(readFileSync('lift/splits.json', 'utf8'));
  const starters = LiftRoutines.parseStarters(splits, makeId, 1)
    .filter((r) => r.folder === 'Push/Pull/Legs');
  const added = starters.map((s, i) => LiftRoutines.copyOf(s, makeId, 1000 + i));
  assert.equal(R.upNext('Push/Pull/Legs', added, []).routineId, added[0].id);
  const session = LiftRoutines.toSession(added[0], day(1), makeId, 0);
  assert.equal(R.upNext('Push/Pull/Legs', added, [session]).routineId, added[1].id);
});
