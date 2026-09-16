import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';

// Loaded the way the browser loads it, like backup.test.mjs does.
const shim = { window: {} };
new Function('window', readFileSync('lift/routines.js', 'utf8')).call(shim, shim.window);
const R = shim.window.LiftRoutines;

let n = 0;
const makeId = () => `id-${++n}`;
const splits = JSON.parse(readFileSync('lift/splits.json', 'utf8'));
const starters = R.parseStarters(splits, makeId, 1);

// MARK: - The shipped file

test('the ten starters are read, in five folders', () => {
  assert.deepEqual(starters.map((r) => r.name),
    ['Push', 'Pull', 'Legs', 'Upper', 'Lower', 'Full Body', 'Mobility', 'Active Rest', 'Short Run', 'Long Run']);
  assert.deepEqual(R.byFolder(starters).map((g) => g.folder),
    ['Push/Pull/Legs', 'Upper/Lower', 'Full Body', 'Mobility & Recovery', 'Running']);
});

test('every starter exercise is in the exercise library, with the stored equipment spelling', () => {
  // The reason splits waited on the library: a name that does not match
  // generates history that lines up with nothing.
  const lib = JSON.parse(readFileSync('lift/exercises.json', 'utf8'));
  const byName = new Map(lib.exercises.map(([name, , eq]) => [name, lib.equipment[eq] || '']));
  const titleCase = (t) => t.replace(/\b[a-z]/g, (c) => c.toUpperCase());
  starters.forEach((r) => r.exercises.forEach((e) => {
    assert.ok(byName.has(e.name), `${r.name}: ${e.name} is not in exercises.json`);
    assert.equal(e.equipment, titleCase(byName.get(e.name)), `${e.name} equipment`);
  }));
});

test('the plank is timed and not repped', () => {
  const plank = starters.find((r) => r.name === 'Full Body').exercises.at(-1);
  assert.equal(plank.name, 'Plank');
  assert.equal(plank.targetDurationSec, 45);
  assert.equal(plank.targetReps, null);
});

test('every read mints fresh ids', () => {
  const again = R.parseStarters(splits, makeId, 1);
  assert.notEqual(again[0].id, starters[0].id);
  assert.notEqual(again[0].exercises[0].id, starters[0].exercises[0].id);
});

// MARK: - Parsing

test('one bad entry costs that split, not the list', () => {
  const parsed = R.parseStarters({ routines: [
    { name: 'Good', exercises: [{ name: 'Plank', sets: 2, durationSec: 30 }] },
    { exercises: [{ name: 'No name' }] },
    { name: 'Empty', exercises: [] },
    null,
  ] }, makeId, 1);
  assert.deepEqual(parsed.map((r) => r.name), ['Good']);
});

test('a missing set count falls back rather than shipping zero sets', () => {
  const [r] = R.parseStarters({ routines: [{ name: 'X', exercises: [{ name: 'Squat', reps: 5 }] }] }, makeId, 1);
  assert.equal(r.exercises[0].targetSets, 3);
});

test('rubbish is an empty list, not a crash', () => {
  assert.deepEqual(R.parseStarters(null, makeId, 1), []);
  assert.deepEqual(R.parseStarters({ routines: 'no' }, makeId, 1), []);
});

// MARK: - Adding

test('a starter already added is recognised by folder and name, in any case', () => {
  const push = starters[0];
  assert.equal(R.alreadySaved(push, [{ name: 'PUSH', folder: 'push/pull/legs' }]), true);
  assert.equal(R.alreadySaved(push, [{ name: 'Push day', folder: 'Push/Pull/Legs' }]), false, 'a renamed copy gets it offered again');
  assert.equal(R.alreadySaved(push, [{ name: 'Push', folder: 'Other' }]), false);
});

test('adding makes a copy with its own ids', () => {
  const copy = R.copyOf(starters[0], makeId, 99);
  assert.notEqual(copy.id, starters[0].id);
  assert.notEqual(copy.exercises[0].id, starters[0].exercises[0].id);
  assert.equal(copy.exercises[0].name, starters[0].exercises[0].name);
  assert.equal(copy.createdAt, 99);
});

test('a blank folder groups under My Routines', () => {
  assert.deepEqual(R.byFolder([{ name: 'a', folder: '' }, { name: 'b', folder: '  ' }]).map((g) => g.folder), ['My Routines']);
});

// MARK: - Starting one

test('starting lays out one set per target set, with only the targets it has', () => {
  const push = starters[0];
  const session = R.toSession(push, '2026-09-16', makeId, 5);
  assert.equal(session.date, '2026-09-16');
  assert.equal(session.name, 'Push');
  const bench = session.exercises[0];
  assert.equal(bench.sets.length, 4);
  assert.deepEqual(Object.keys(bench.sets[0]).sort(), ['id', 'reps']);
  assert.equal(bench.sets[0].reps, 6);
  assert.equal('weightLb' in bench.sets[0], false, 'blank weight stays blank, never zero');
});

test('a timed starter becomes timed sets', () => {
  const run = R.toSession(starters.find((r) => r.name === 'Long Run'), '2026-09-16', makeId, 5);
  const trail = run.exercises.find((e) => e.name === 'Trail Running/Walking');
  assert.equal(trail.sets[0].durationSec, 3600);
  assert.equal('reps' in trail.sets[0], false);
});

// MARK: - Saving a workout as a routine

test('saving a workout keeps the common reps, the top weight and the set count', () => {
  const session = { name: 'Monday', exercises: [{ name: 'Squat', equipment: 'Barbell', sets: [
    { reps: 5, weightLb: 225 }, { reps: 5, weightLb: 245 }, { reps: 1, weightLb: 275 },
  ] }] };
  const r = R.fromSession(session, '', 'Mine', makeId, 1);
  assert.equal(r.name, 'Monday', 'falls back to the workout name');
  assert.equal(r.folder, 'Mine');
  const squat = r.exercises[0];
  assert.equal(squat.targetSets, 3);
  assert.equal(squat.targetReps, 5, 'one heavy single does not become the template');
  assert.equal(squat.targetWeightLb, 275);
});

test('saving a stretch session keeps its time', () => {
  const r = R.fromSession({ exercises: [{ name: 'Cat Stretch', sets: [{ durationSec: 45 }, { durationSec: 45 }] }] },
    'Evening', '', makeId, 1);
  assert.equal(r.exercises[0].targetDurationSec, 45);
  assert.equal(r.exercises[0].targetReps, null);
});

test('an exercise with no sets still saves as one set', () => {
  const r = R.fromSession({ exercises: [{ name: 'Row', sets: [] }] }, 'x', '', makeId, 1);
  assert.equal(r.exercises[0].targetSets, 1);
});
