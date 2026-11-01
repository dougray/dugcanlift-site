import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';

// Loaded the way the browser loads it, like sides.test.mjs does. A port of
// LIFT iOS's WorkoutCSVTests, case for case, against the same fixtures:
// fixtures/csv-*.csv are the iPhone's Tests/Fixtures/csv-*.csv byte for byte.
// They are built from the shapes of real exports people have published (none
// of the three apps documents its format), not copied from a maker.
const shim = { window: {} };
new Function('window', readFileSync('lift/workout-csv.js', 'utf8')).call(shim, shim.window);
const C = shim.window.LiftWorkoutCSV;

const fixture = (name) => readFileSync(`lift/fixtures/${name}.csv`, 'utf8');
const pad = (n) => String(n).padStart(2, '0');
const day = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
// The iPhone asserts kilograms; LIFT web stores pounds, kept to two decimals
// when the file was in kilograms.
const lb = (kg) => Math.round(kg * C.LB_PER_KG * 100) / 100;
const near = (actual, expected, accuracy = 0.001) =>
  assert.ok(Math.abs(actual - expected) <= accuracy, `${actual} is not ${expected}`);

// MARK: - Reading

test("Strong's semicolon export is kilograms and skips its pseudo-rows", () => {
  const reading = C.read(fixture('csv-strong-semicolon'));
  assert.equal(reading.source, 'Strong');
  assert.equal(reading.needsUnit, false);
  const workouts = reading.parse(null);
  assert.deepEqual(workouts.map((w) => w.name), ['Upper A', 'Lower A']);
  const bench = workouts[0].exercises[0];
  assert.equal(bench.name, 'Bench Press');
  assert.equal(bench.equipment, 'Barbell');
  // The Note and Rest Timer rows are not sets; W is a warm-up; F is a working
  // set.
  assert.equal(bench.sets[0].warmup, true);
  assert.equal(bench.sets.length, 4);
  assert.equal(bench.sets[3].reps, 4);
  assert.equal(bench.sets[3].weightLb, lb(80));
  assert.equal(bench.sets[3].warmup, false);
  assert.ok(!bench.sets.some((s) => s.reps == null && s.weightLb == null && s.durationSec == null));
  const pulldown = workouts[0].exercises.find((e) => e.name === 'Lat Pulldown');
  assert.deepEqual(pulldown.sets.map((s) => s.weightLb), [lb(55), lb(40)]); // D is a working set
  assert.ok(pulldown.sets.every((s) => !s.warmup));
  const plank = workouts[0].exercises.find((e) => e.name === 'Plank');
  assert.equal(plank.sets[0].durationSec, 60);
  assert.equal(plank.sets[0].weightLb, null); // blank stays blank
  assert.equal(day(workouts[1].date), '2026-03-04');
  // "0.0" is the column a bodyweight set did not use, not a weight.
  const pullUp = workouts[1].exercises.find((e) => e.name === 'Pull Up');
  assert.equal(pullUp.sets[0].weightLb, null);
  assert.equal(pullUp.sets[0].reps, 8);
});

// No unit anywhere in the file, so nothing is built until one is chosen, and
// the choice decides the numbers.
test("Strong's comma export asks for the unit", () => {
  const reading = C.read(fixture('csv-strong-comma'));
  assert.equal(reading.needsUnit, true);
  const pounds = reading.parse('lb');
  const kilos = reading.parse('kg');
  const benchLb = pounds[0].exercises[0].sets[0];
  assert.equal(benchLb.weightLb, 135); // pounds are kept exactly
  assert.equal(kilos[0].exercises[0].sets[0].weightLb, lb(135));
  // Zero distance and seconds are unused columns, not a 0 m run.
  assert.equal(benchLb.distanceMeters, null);
  assert.equal(benchLb.durationSec, null);
});

test('Hevy names its unit and its set types', () => {
  const reading = C.read(fixture('csv-hevy'));
  assert.equal(reading.source, 'Hevy');
  const workouts = reading.parse(null);
  assert.deepEqual(workouts.map((w) => w.name), ['Morning run', 'Push A']); // oldest first
  const run = workouts[0].exercises[0].sets[0];
  near(run.distanceMeters, 5210);
  assert.equal(run.durationSec, 1860);
  const bench = workouts[1].exercises[0];
  assert.deepEqual(bench.sets.map((s) => s.warmup), [true, false, false]);
  assert.equal(bench.sets[1].rpe, 8);
  assert.equal(workouts[1].exercises[workouts[1].exercises.length - 1].name, 'Triceps Pushdown');
  assert.equal(workouts[1].exercises[workouts[1].exercises.length - 1].equipment, null);
});

test('Hevy in pounds is kept in pounds', () => {
  const text = [
    '"title","start_time","end_time","description","exercise_title","superset_id","exercise_notes","set_index","set_type","weight_lbs","reps","distance_miles","duration_seconds","rpe"',
    '"A","Oct 1, 2026, 8:28 PM","Oct 1, 2026, 9:10 PM","","Squat (Barbell)",,"",0,"normal",225,5,,,',
    '"A","Oct 1, 2026, 8:28 PM","Oct 1, 2026, 9:10 PM","","Walk",,"",0,"normal",,,1.5,,',
  ].join('\n');
  const workouts = C.read(text).parse(null);
  assert.equal(workouts[0].exercises[0].sets[0].weightLb, 225);
  near(workouts[0].exercises[1].sets[0].distanceMeters, 2414.016);
  assert.equal(day(workouts[0].date), '2026-10-01');
  assert.equal(workouts[0].date.getHours(), 20);
});

// FitNotes says the unit on every row, and one file can mix them.
test('FitNotes mixes units row by row', () => {
  const reading = C.read(fixture('csv-fitnotes'));
  assert.equal(reading.source, 'FitNotes');
  const workouts = reading.parse(null);
  assert.equal(workouts.length, 2);
  const raise = workouts[0].exercises.find((e) => e.name === 'Dumbbell Lateral Raise');
  assert.equal(raise.sets[0].weightLb, 25);
  assert.equal(raise.primaryMuscle, 'shoulders');
  assert.equal(workouts[0].exercises[0].sets[1].weightLb, lb(80));
  const run = workouts[1].exercises[0];
  assert.equal(run.primaryMuscle, null); // Cardio is not a muscle
  near(run.sets[0].distanceMeters, 3.2 * 1609.344);
  assert.equal(run.sets[0].durationSec, 31 * 60);
});

test('a file from somewhere else is refused', () => {
  assert.throws(() => C.read('Name,Calories\nApple,95\n'), (e) => e.failure === 'notRecognised');
  assert.throws(() => C.read(''), (e) => e.failure === 'empty');
});

test('the CSV reader handles quotes, a BOM and CRLF', () => {
  assert.deepEqual(C.parse('﻿a,b\r\n"x, ""y""",2\r\n'), [['a', 'b'], ['x, "y"', '2']]);
});

test('equipment comes out of the name', () => {
  assert.deepEqual(C.splitEquipment('Bench Press (Barbell)'), ['Bench Press', 'Barbell']);
  assert.deepEqual(C.splitEquipment('Pull Up'), ['Pull Up', null]);
  assert.deepEqual(C.splitEquipment('(Odd)'), ['(Odd)', null]);
});

test('numbers are digits and a point, and clocks are read', () => {
  assert.equal(C.number('80.0'), 80);
  assert.equal(C.number('1,000'), null);
  assert.equal(C.number('-5'), null);
  assert.equal(C.number(''), null);
  assert.equal(C.clockSeconds('0:01:30'), 90);
  assert.equal(C.clockSeconds('1:30'), 90);
  assert.equal(C.clockSeconds('0:00'), null);
  assert.equal(C.hevyDate('Oct 1, 2026, 12:05 AM').getHours(), 0);
  assert.equal(C.hevyDate('31 Feb 2026, 10:00'), null);
});

test('what a file holds is said before it is imported', () => {
  const workouts = C.read(fixture('csv-strong-semicolon')).parse(null);
  assert.equal(C.describe(workouts, 'en-US'), '2 workouts, 9 sets, Mar 2, 2026 to Mar 4, 2026.');
  assert.equal(C.describe([], 'en-US'), 'No sets found in this file.');
});

// MARK: - Into the log

let n = 0;
const makeId = () => `id-${++n}`;

// A day already trained is left alone, and the same file twice adds nothing
// the second time.
test('a day already logged is left alone, and a reimport adds nothing', () => {
  const workouts = C.read(fixture('csv-strong-semicolon')).parse(null);
  const mine = { id: 'mine', date: day(workouts[1].date), name: 'Mine', note: '',
    exercises: [{ id: 'x', name: 'My squat', equipment: '', sets: [] }] };
  const log = [mine];

  const first = C.apply(workouts, log, makeId);
  assert.equal(first.daysAdded, 1);
  assert.equal(first.daysSkipped, 1);
  assert.ok(first.setsAdded > 0);
  assert.deepEqual(mine.exercises.map((e) => e.name), ['My squat']);

  const again = C.apply(workouts, log, makeId);
  assert.equal(again.daysAdded, 0);
  assert.equal(again.daysSkipped, 2);
  assert.equal(log.length, 2);
});

test("an import is LIFT web's own shape, blanks left out", () => {
  const log = [{ id: 'empty', date: '2026-03-02', name: '', note: '', exercises: [] }];
  const outcome = C.apply(C.read(fixture('csv-fitnotes')).parse(null), log, makeId);
  assert.deepEqual(outcome, { daysAdded: 2, setsAdded: 6, daysSkipped: 0 });
  // The empty workout already started that day is filled, not doubled.
  assert.equal(log.length, 2);
  const bench = log[0].exercises[0];
  assert.equal(bench.name, 'Flat Barbell Bench Press');
  assert.equal(bench.equipment, '');
  assert.equal(bench.primaryMuscle, 'chest');
  assert.deepEqual(Object.keys(bench.sets[0]).sort(), ['id', 'reps', 'weightLb']);
  const run = log[1];
  assert.equal(run.date, '2026-03-04');
  assert.deepEqual(Object.keys(run.exercises[0].sets[0]).sort(), ['distanceMeters', 'durationSec', 'id']);
  assert.equal(C.summary(outcome), 'Added 2 days (6 sets).');
  assert.equal(C.summary({ daysAdded: 1, setsAdded: 1, daysSkipped: 1 }),
    'Added 1 day (1 set). 1 day you already had training on was left as it was.');
  assert.equal(C.summary({ daysAdded: 0, setsAdded: 0, daysSkipped: 2 }),
    'Added 0 days (0 sets). 2 days you already had training on were left as they were.');
});

test('two workouts on one day become one day, named after the first', () => {
  const text = [
    '"title","start_time","end_time","description","exercise_title","superset_id","exercise_notes","set_index","set_type","weight_kg","reps","distance_km","duration_seconds","rpe"',
    '"Evening","2 Mar 2026, 18:04","2 Mar 2026, 19:06","","Curl (Dumbbell)",,"",0,"normal",10,12,,,',
    '"Morning","2 Mar 2026, 07:00","2 Mar 2026, 07:30","","Running",,"",0,"normal",,,5,1800,',
  ].join('\n');
  const log = [];
  C.apply(C.read(text).parse(null), log, makeId);
  assert.equal(log.length, 1);
  assert.equal(log[0].name, 'Morning');
  assert.deepEqual(log[0].exercises.map((e) => e.name), ['Running', 'Curl']);
});

// MARK: - Out

test('the export is one row a set, in kilograms', () => {
  const text = C.exportText([
    { dayKey: '2026-10-26', workout: 'Push, heavy', exercise: 'Bench Press', equipment: 'Barbell',
      set: 1, isWarmup: true, side: null, weightKg: 60, reps: 8, rpe: null, seconds: null, distanceMeters: null },
    { dayKey: '2026-10-26', workout: 'Push, heavy', exercise: 'Split "Squat"', equipment: null,
      set: 1, isWarmup: false, side: 'left', weightKg: 22.5, reps: 10, rpe: 8.5, seconds: null, distanceMeters: null },
  ]);
  assert.equal(text, [
    'Date,Workout,Exercise,Equipment,Set,Warmup,Side,Weight (kg),Reps,RPE,Seconds,Distance (m)',
    '2026-10-26,"Push, heavy",Bench Press,Barbell,1,yes,,60,8,,,',
    '2026-10-26,"Push, heavy","Split ""Squat""",,1,,left,22.5,10,8.5,,',
  ].join('\n') + '\n');
});

// LIFT web stores pounds; the file is kilograms on every build.
test("LIFT web's log exports in kilograms, oldest day first, blanks blank", () => {
  const rows = C.exportRows([
    { id: 'b', date: '2026-10-27', name: 'Pull', startedAt: 2, exercises: [
      { name: 'Plank', equipment: '', sets: [{ durationSec: 60 }] }] },
    { id: 'a', date: '2026-10-26', name: 'Push', startedAt: 1, exercises: [
      { name: 'Bench Press', equipment: 'Barbell', sets: [
        { weightLb: 135, reps: 5, warmup: true }, { weightLb: 132.277, reps: 5, side: 'right' }] }] },
  ]);
  assert.equal(C.exportText(rows), [
    C.EXPORT_HEADER.join(','),
    '2026-10-26,Push,Bench Press,Barbell,1,yes,,61.23,5,,,',
    '2026-10-26,Push,Bench Press,Barbell,2,,right,60,5,,,',
    '2026-10-27,Pull,Plank,,1,,,,,,60,',
  ].join('\n') + '\n');
});

test('a file that is not UTF-8 is read as Latin-1', () => {
  assert.equal(C.decode(new Uint8Array([0x43, 0x61, 0x66, 0xE9])), 'Café');
  assert.equal(C.decode(new TextEncoder().encode('Café')), 'Café');
});
