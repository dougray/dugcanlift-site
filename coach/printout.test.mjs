import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';

// The printed week -- Coach iPhone's PlanPrintout and Coach Android's, line
// for line. Loaded the way the browser loads them, in index.html's order. Run
// from the repo root: node --test coach/*.test.mjs
const shim = { window: {} };
['sides.js', 'prescriptions.js', 'printout.js'].forEach((file) => {
  new Function('window', readFileSync(`coach/${file}`, 'utf8')).call(shim, shim.window);
});
const P = shim.window.CoachPrescriptions;
const Print = shim.window.CoachPrintout;

const set = (weightLb, reps, extra = {}) => ({
  weightLb, reps, rpe: null, durationSec: null, distanceM: null, ...extra,
});
const WEEK = ['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29',
  '2026-10-30', '2026-10-31', '2026-11-01'];
// Pinned to en-US so the test can assert a string; the page uses the reader's.
const enUS = (key) => Print.dayTitle(key, 'en-US');

const lowerA = {
  id: 'w-lower',
  name: 'Lower A',
  exercises: [
    { name: 'Back Squat', equipment: 'Barbell', note: 'Belt on the last set.',
      sets: [set(225, 5), set(225, 5), set(225, 5)] },
    { name: 'Walking Lunge', equipment: 'dumbbell', note: '', eachSide: true,
      sets: [set(40, 10), set(40, 10), set(40, 10, { side: 'left' })] },
    { name: 'Plank', equipment: '', note: '   ',
      sets: [set(null, null, { durationSec: 60 })] },
  ],
};
const upperA = {
  id: 'w-upper',
  name: 'Upper A',
  exercises: [
    { name: 'Bench Press', equipment: 'Barbell', note: '',
      sets: [set(185, 5), set(185, 5), set(135, 10, { kind: 'drop' })] },
  ],
};

const sessions = [
  { id: 's1', clientId: 'c1', date: '2026-10-29', workoutId: 'gone', workoutName: 'Old Pull' },
  { id: 's2', clientId: 'c1', date: '2026-10-26', workoutId: 'w-lower', workoutName: 'Lower A' },
  { id: 's3', clientId: 'c2', date: '2026-10-27', workoutId: 'w-upper', workoutName: 'Upper A' },
  { id: 's4', clientId: 'c1', date: '2026-10-26', workoutId: 'w-upper', workoutName: 'Upper A' },
  { id: 's5', clientId: 'c1', date: '2026-11-05', workoutId: 'w-upper', workoutName: 'Upper A' },
];

test('only booked days, in week order, for one client', () => {
  const days = Print.days(WEEK, 'c1', sessions, [lowerA, upperA], P.summary);
  assert.deepEqual(days.map((d) => d.dayKey), ['2026-10-26', '2026-10-29'],
    'c2\'s booking and the one outside the week are not printed');
});

test('two bookings on a day keep their stored order', () => {
  const days = Print.days(WEEK, 'c1', sessions, [lowerA, upperA], P.summary);
  assert.deepEqual(days[0].workouts.map((w) => w.name), ['Lower A', 'Upper A']);
});

test('a booking whose workout was deleted reads "Removed workout" and lists nothing', () => {
  const days = Print.days(WEEK, 'c1', sessions, [lowerA, upperA], P.summary);
  assert.deepEqual(days[1].workouts, [{ name: 'Removed workout', exercises: [] }],
    'not the name the session remembers: the template is gone');
});

test('each exercise reads exactly as the workout cards read it', () => {
  const days = Print.days(WEEK, 'c1', sessions, [lowerA, upperA], P.summary);
  lowerA.exercises.forEach((exercise, i) => {
    assert.equal(days[0].workouts[0].exercises[i].prescription, P.summary(exercise));
  });
  assert.deepEqual(days[0].workouts[0].exercises.map((e) => e.prescription),
    ['3 × 225 × 5', '2 × 40 × 10 each side + 1 L', '1:00']);
  assert.equal(days[0].workouts[1].exercises[0].prescription, '185 × 5, 185 × 5, 135 × 10 drop');
});

test('the equipment is titled word by word, and a bare name stays bare', () => {
  assert.equal(Print.exerciseName({ name: 'Back Squat', equipment: 'Barbell' }), 'Back Squat (Barbell)');
  assert.equal(Print.exerciseName({ name: 'Row', equipment: 'smith machine' }), 'Row (Smith Machine)');
  assert.equal(Print.exerciseName({ name: 'Plank', equipment: '' }), 'Plank');
  assert.equal(Print.exerciseName({ name: 'Plank', equipment: '  ' }), 'Plank');
  assert.equal(Print.exerciseName({ name: 'Plank' }), 'Plank');
});

test('the whole page, line by line, in order, with how each is set', () => {
  const days = Print.days(WEEK, 'c1', sessions, [lowerA, upperA], P.summary);
  assert.deepEqual(Print.lines('Jordan Reyes', '2026-10-26', 'Doug', days, enUS), [
    { text: 'Jordan Reyes', style: 'title', before: 0 },
    { text: 'Week of Mon, Oct 26 · from Doug', style: 'subtitle', before: 0 },
    { text: 'Mon, Oct 26', style: 'day', before: 16 },
    { text: 'Lower A', style: 'workout', before: 6 },
    { text: 'Back Squat (Barbell): 3 × 225 × 5', style: 'exercise', before: 2 },
    { text: 'Belt on the last set.', style: 'note', before: 0 },
    { text: 'Walking Lunge (Dumbbell): 2 × 40 × 10 each side + 1 L', style: 'exercise', before: 2 },
    { text: 'Plank: 1:00', style: 'exercise', before: 2 },
    { text: 'Upper A', style: 'workout', before: 6 },
    { text: 'Bench Press (Barbell): 185 × 5, 185 × 5, 135 × 10 drop', style: 'exercise', before: 2 },
    { text: 'Thu, Oct 29', style: 'day', before: 16 },
    { text: 'Removed workout', style: 'workout', before: 6 },
  ]);
});

test('no "from" clause without a coach name', () => {
  const lines = Print.lines('Jordan Reyes', '2026-10-26', '   ', [], enUS);
  assert.equal(lines[1].text, 'Week of Mon, Oct 26');
  assert.equal(Print.lines('Jordan Reyes', '2026-10-26', null, [], enUS)[1].text, 'Week of Mon, Oct 26');
  assert.equal(Print.lines('Jordan Reyes', '2026-10-26', ' Doug ', [], enUS)[1].text,
    'Week of Mon, Oct 26 · from Doug');
});

test('an empty week says so, and a nameless client is "Plan"', () => {
  assert.deepEqual(Print.lines('', '2026-10-26', null, [], enUS), [
    { text: 'Plan', style: 'title', before: 0 },
    { text: 'Week of Mon, Oct 26', style: 'subtitle', before: 0 },
    { text: 'Nothing is booked this week.', style: 'body', before: 12 },
  ]);
});

test('a day title is the reader\'s abbreviated weekday, day and month', () => {
  assert.equal(Print.dayTitle('2026-10-26', 'en-US'), 'Mon, Oct 26');
  assert.equal(Print.dayTitle('2026-11-01', 'en-US'), 'Sun, Nov 1');
  // A key that is not a day prints as itself rather than "Invalid Date".
  assert.equal(Print.dayTitle('2026-02-30', 'en-US'), '2026-02-30');
  assert.equal(Print.dayTitle('soon', 'en-US'), 'soon');
});

test('the file name is safe', () => {
  assert.equal(Print.fileName('Jo/Rey:es', '2026-10-26'), 'JoReyes – week of 2026-10-26.pdf');
  assert.equal(Print.fileName('', '2026-10-26'), 'Plan – week of 2026-10-26.pdf');
});

/* ---------------- the page ---------------- */

// The browser paginates, so there is no page count to assert here: a long
// week running onto a second page was checked by printing one to PDF in
// Chrome. What can be pinned is the stylesheet that makes it paginate well --
// no line split across pages, and no day or workout heading stranded at the
// foot of one with its first exercise on the next.
test('the print stylesheet prints only the week, and keeps headings with what follows', () => {
  const css = readFileSync('coach/style.css', 'utf8');
  const print = css.slice(css.indexOf('@media print'));
  assert.ok(css.includes('@media print'), 'style.css has a print stylesheet');
  assert.match(print, /body\.printing\s*>\s*\*:not\(#printout\)\s*\{[^}]*display:\s*none/);
  assert.match(print, /#printout\s+p\s*\{[^}]*break-inside:\s*avoid/);
  assert.match(print, /\.print-day,\s*#printout\s+\.print-workout\s*\{[^}]*break-after:\s*avoid/);
  assert.match(print, /@page\s*\{[^}]*size:\s*letter/);
});

test('printing records nothing', () => {
  const app = readFileSync('coach/app.js', 'utf8');
  const start = app.indexOf('function printWeek(');
  assert.ok(start >= 0, 'app.js has printWeek');
  const body = app.slice(start, app.indexOf('\n}\n', start));
  assert.doesNotMatch(body, /sendPlan|recordSentPlan|sentPlans/);
});
