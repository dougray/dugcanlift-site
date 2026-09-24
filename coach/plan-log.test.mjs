import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';

// Loaded the way the browser loads it, in index.html's order. Run from the
// repo root: node --test coach/
const shim = { window: {} };
['route.js', 'nutrients.js', 'sides.js', 'prescriptions.js', 'share-import.js', 'plan-log.js']
  .forEach((file) => {
    new Function('window', readFileSync(`coach/${file}`, 'utf8')).call(shim, shim.window);
  });
const PlanLog = shim.window.CoachPlanLog;
const ShareImport = shim.window.CoachShareImport;

const MEALS = ['Breakfast', 'Lunch', 'Dinner', 'Snack'];

/* The share link decoded the way app.js decodes one, through this app's own
 * expandDay -- so the fixture is read across the real wire rather than handed
 * to the rule as a convenient object. */
const pad2 = (n) => String(n).padStart(2, '0');
const dateKey = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
function shiftKey(key, days) {
  const [y, m, d] = key.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + days);
  return dateKey(dt);
}

async function decodeShareLink(text) {
  const frag = text.trim().slice(text.trim().indexOf('#') + 1);
  const match = frag.match(/^(\d+)([zu])([A-Za-z0-9_-]+)$/);
  assert.ok(match, 'fixture is not a v1 share link');
  const bin = atob(match[3].replace(/-/g, '+').replace(/_/g, '/')
    + (match[3].length % 4 ? '='.repeat(4 - (match[3].length % 4)) : ''));
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  const json = match[2] === 'z'
    ? await new Response(new Blob([bytes]).stream()
      .pipeThrough(new DecompressionStream('deflate-raw'))).text()
    : new TextDecoder().decode(bytes);
  const payload = JSON.parse(json);
  const days = {};
  (payload.d || []).forEach((raw) => {
    days[shiftKey(payload.r, raw.k || 0)] = ShareImport.expandDay(raw, payload.x || [], payload.fd || [], MEALS);
  });
  return { days, coverage: [payload.r, payload.t || payload.r], unit: payload.c.u || 'lb' };
}

const sentPlan = JSON.parse(readFileSync('coach/fixtures/plan-log-sent-plan.json', 'utf8'));
const expected = JSON.parse(readFileSync('coach/fixtures/plan-log-expected.json', 'utf8'));
const shareLink = readFileSync('coach/fixtures/plan-log-share-link.txt', 'utf8');

const fixture = async (over = {}) => {
  const log = await decodeShareLink(shareLink);
  return PlanLog.compare({
    clientId: 'client-fixture',
    sentPlans: [sentPlan],
    days: log.days,
    coverage: log.coverage,
    unit: log.unit,
    today: '2026-10-18',
    weeks: 8,
    ...over,
  });
};

/* ---------------- the fixture pair ---------------- */

test('the fixture pair produces exactly the lines the fixture says', async () => {
  const result = await fixture();
  assert.deepEqual(PlanLog.lines(result), expected.lines);
});

test('the fixture pair produces exactly the counts and day states it says', async () => {
  const result = await fixture();
  assert.equal(result.groups.length, 1);
  assert.deepEqual(result.groups[0].counts, expected.counts);
  assert.deepEqual(result.groups[0].days.map((d) => d.state), expected.dayStates);
  assert.equal(result.groups[0].range, '12–17 Oct');
});

/* ---------------- the join, case by case ---------------- */

const plan = (bookings, workouts) => ({
  id: 'p1', clientId: 'c', sentAt: 1000, payloadHash: 'h',
  payload: { v: 1, t: 'plan', l: 'c', n: '', r: [], m: [], w: workouts, k: bookings },
});
const ex = (name, equipment, sets, eachSide) => {
  const out = { n: name, s: sets };
  if (equipment) out.q = equipment;
  if (eachSide) out.b = 1;
  return out;
};
const logged = (name, equipment, sets) => ({ name, equipment, sets });
const set = (weightLb, reps, extra = {}) =>
  ({ weightLb, reps, rpe: null, durationSec: null, distanceM: null, warmup: false, ...extra });

const run = (bookings, workouts, days, over = {}) => PlanLog.compare({
  clientId: 'c',
  sentPlans: [plan(bookings, workouts)],
  days,
  coverage: ['2026-10-01', '2026-10-31'],
  unit: 'lb',
  today: '2026-10-20',
  ...over,
});

const day = (result, i) => result.groups[0].days[i];

test('a booked day the client logged reads "logged"', () => {
  const r = run([{ d: '2026-10-12', x: 0 }],
    [{ n: 'Lower A', e: [ex('Back Squat', 'Barbell', [[225, 5]])] }],
    { '2026-10-12': { name: 'Lower A', exercises: [logged('Back Squat', 'Barbell', [set(225, 5)])] } });
  assert.equal(day(r, 0).text, 'Mon 12 Oct · Lower A · logged');
  assert.deepEqual(r.groups[0].counts,
    { booked: 1, training: 1, logged: 1, notLogged: 0, outside: 0, other: 0, meals: 0 });
});

test('a booked day with nothing logged reads "not logged", never "missed"', () => {
  const r = run([{ d: '2026-10-12', x: 0 }],
    [{ n: 'Lower A', e: [ex('Back Squat', 'Barbell', [[225, 5]])] }], {});
  assert.equal(day(r, 0).text, 'Mon 12 Oct · Lower A · not logged');
  assert.equal(r.groups[0].head, 'Booked 1 day, 12 Oct · logged 0');
});

test('a booked day outside the window the client sent is never called "not logged"', () => {
  const r = run([{ d: '2026-10-12', x: 0 }],
    [{ n: 'Lower A', e: [ex('Back Squat', 'Barbell', [[225, 5]])] }], {},
    { coverage: ['2026-09-01', '2026-10-05'] });
  assert.equal(day(r, 0).text, 'Mon 12 Oct · Lower A · outside the log they sent');
  assert.equal(r.groups[0].head, 'Booked 1 day, 12 Oct · no log covering them');
  assert.equal(PlanLog.lines(r).join(' ').includes('not logged'), false);
});

test('a client who has sent nothing at all gets "no log covering them", not "not logged"', () => {
  const r = run([{ d: '2026-10-12', x: 0 }],
    [{ n: 'Lower A', e: [ex('Back Squat', 'Barbell', [[225, 5]])] }], {}, { coverage: null });
  assert.equal(day(r, 0).state, 'outside');
});

test('a logged day inside the span with no booking reads "not booked"', () => {
  const r = run([{ d: '2026-10-12', x: 0 }, { d: '2026-10-16', x: 0 }],
    [{ n: 'Lower A', e: [ex('Back Squat', 'Barbell', [[225, 5]])] }],
    { '2026-10-13': { name: 'Upper B', exercises: [logged('Bench Press', 'Barbell', [set(185, 5)])] } });
  assert.deepEqual(r.groups[0].days.map((d) => d.text), [
    'Mon 12 Oct · Lower A · not logged',
    'Tue 13 Oct · Upper B · not booked',
    'Fri 16 Oct · Lower A · not logged',
  ]);
  assert.equal(r.groups[0].counts.other, 1);
  assert.match(r.groups[0].head, /1 other day logged$/);
});

test('a substitution shows as one pair on name alone, labelled', () => {
  const r = run([{ d: '2026-10-12', x: 0 }],
    [{ n: 'Lower A', e: [ex('Lat Pulldown', 'Cable', [[140, 10]])] }],
    { '2026-10-12': { exercises: [logged('Lat Pulldown', 'Machine', [set(140, 10)])] } });
  const e = day(r, 0).exercises;
  assert.equal(e.length, 1);
  assert.equal(e[0].substitution, 'Asked Cable · logged Machine');
  assert.equal(day(r, 0).alsoLogged.length, 0);
});

test('an exact name and equipment match always wins over a name-only one', () => {
  const r = run([{ d: '2026-10-12', x: 0 }],
    [{ n: 'Lower A', e: [ex('Lat Pulldown', 'Cable', [[140, 10]])] }],
    { '2026-10-12': { exercises: [
      logged('Lat Pulldown', 'Machine', [set(150, 10)]),
      logged('Lat Pulldown', 'Cable', [set(140, 10)]),
    ] } });
  const e = day(r, 0).exercises;
  assert.equal(e[0].substitution, null, 'the cable one is the match');
  assert.equal(e[0].logged.text, '140 × 10');
  assert.equal(day(r, 0).alsoLogged[0].text, 'Lat Pulldown (Machine) · 1 set');
});

test('the same lift prescribed twice in a day pools into one prescription', () => {
  const r = run([{ d: '2026-10-12', x: 0 }],
    [{ n: 'Lower A', e: [
      ex('Back Squat', 'Barbell', [[225, 5], [225, 5]]),
      ex('Back Squat', 'Barbell', [[245, 3]]),
    ] }],
    { '2026-10-12': { exercises: [logged('Back Squat', 'Barbell',
      [set(225, 5), set(225, 5), set(245, 3)])] } });
  const e = day(r, 0).exercises;
  assert.equal(e.length, 1);
  assert.equal(e[0].asked.text, '225 × 5 · 225 × 5 · 245 × 3');
  assert.equal(e[0].countLine, null);
});

test('the same lift logged twice in a day pools too', () => {
  const r = run([{ d: '2026-10-12', x: 0 }],
    [{ n: 'Lower A', e: [ex('Back Squat', 'Barbell', [[225, 5], [225, 5], [245, 3]])] }],
    { '2026-10-12': { exercises: [
      logged('Back Squat', 'Barbell', [set(225, 5), set(225, 5)]),
      logged('Back Squat', 'Barbell', [set(245, 3)]),
    ] } });
  const e = day(r, 0).exercises;
  assert.equal(e.length, 1);
  assert.equal(e[0].logged.text, '225 × 5 · 225 × 5 · 245 × 3');
  assert.equal(day(r, 0).alsoLogged.length, 0);
});

test('two sent plans booking two spans are two groups, newest first', () => {
  const workouts = [{ n: 'Lower A', e: [ex('Back Squat', 'Barbell', [[225, 5]])] }];
  const r = PlanLog.compare({
    clientId: 'c',
    sentPlans: [
      { ...plan([{ d: '2026-10-05', x: 0 }], workouts), id: 'old', sentAt: 1 },
      { ...plan([{ d: '2026-10-12', x: 0 }], workouts), id: 'new', sentAt: 2 },
    ],
    days: {}, coverage: ['2026-10-01', '2026-10-31'], unit: 'lb', today: '2026-10-20',
  });
  assert.deepEqual(r.groups.map((g) => g.id), ['new', 'old']);
  assert.deepEqual(r.groups.map((g) => g.range), ['12 Oct', '5 Oct']);
});

test('a plan booking nothing in the last eight weeks is not a group at all', () => {
  const r = run([{ d: '2026-05-01', x: 0 }],
    [{ n: 'Lower A', e: [ex('Back Squat', 'Barbell', [[225, 5]])] }], {});
  assert.deepEqual(r.groups, []);
  assert.deepEqual(PlanLog.lines(r), []);
});

test('a meal booked against a recipe the payload does not carry books nothing', () => {
  // `m.x` indexes `r`, exactly as `k.x` indexes `w`. A booking that indexes
  // nothing is skipped rather than drawn as a dish with no name.
  const r = PlanLog.compare({
    clientId: 'c',
    sentPlans: [{ id: 'p', clientId: 'c', sentAt: 1,
      payload: { v: 1, t: 'plan', l: 'c', r: [], m: [{ d: '2026-10-12', s: 2, x: 0, q: 1 }] } }],
    days: {}, coverage: ['2026-10-01', '2026-10-31'], unit: 'lb', today: '2026-10-20',
  });
  assert.deepEqual(r.groups, []);
});

test('no plan was ever sent: no card, and no explanation on screen', () => {
  const r = PlanLog.compare({ clientId: 'c', sentPlans: [], days: {}, today: '2026-10-20' });
  assert.deepEqual(r.groups, []);
  assert.deepEqual(r.byLift, []);
  assert.deepEqual(PlanLog.lines(r), [], 'not even the footer');
});

/* ---------------- sets ---------------- */

test('sets are counted, never paired one to one', () => {
  const r = run([{ d: '2026-10-12', x: 0 }],
    [{ n: 'Lower A', e: [ex('Romanian Deadlift', 'Barbell', [[185, 8], [185, 8], [185, 8], [185, 8]])] }],
    { '2026-10-12': { exercises: [logged('Romanian Deadlift', 'Barbell',
      [set(185, 8), set(185, 8), set(185, 6)])] } });
  const e = day(r, 0).exercises[0];
  assert.equal(e.countLine, 'Asked 4 sets · logged 3');
  assert.equal(e.asked.text, '185 × 8 · 185 × 8 · 185 × 8 · 185 × 8');
  assert.equal(e.logged.text, '185 × 8 · 185 × 8 · 185 × 6');
});

test('warmups are excluded from both counts', () => {
  const r = run([{ d: '2026-10-12', x: 0 }],
    [{ n: 'Lower A', e: [ex('Back Squat', 'Barbell', [[225, 5], [225, 5]])] }],
    { '2026-10-12': { exercises: [logged('Back Squat', 'Barbell',
      [set(135, 8, { warmup: true }), set(225, 5), set(225, 5)])] } });
  const e = day(r, 0).exercises[0];
  assert.equal(e.logged.text, '225 × 5 · 225 × 5');
  assert.equal(e.countLine, null);
});

test('flags are masked, never compared, for all six values', () => {
  // 0 both, 1 warmup, 2 left, 3 left warmup, 4 right, 5 right warmup.
  const wire = [0, 1, 2, 3, 4, 5].map((flags) => [100, 5, null, null, null, flags]);
  const day0 = ShareImport.expandDay({ k: 0, w: [[0, wire]] }, ['Curl|Dumbbell'], [], MEALS);
  const r = run([{ d: '2026-10-12', x: 0 }],
    [{ n: 'Arms', e: [ex('Curl', 'Dumbbell', [[100, 5]], true)] }],
    { '2026-10-12': day0 });
  const e = day(r, 0).exercises[0];
  // Working sets only: flags 0 (both), 2 (left) and 4 (right). 1, 3 and 5 are
  // warmups whatever side they name.
  assert.equal(e.sideLine, 'L 1/1 · R 1/1 · 1 both');
  assert.equal(e.logged.text, 'L 100 × 5   R 100 × 5   Both 100 × 5');
});

test('sides read L 3/3 · R 2/3, and over is never capped', () => {
  const sided = (n, side) => Array.from({ length: n }, () => set(40, 8, { side }));
  const r = run([{ d: '2026-10-12', x: 0 }],
    [{ n: 'Lower A', e: [ex('Bulgarian Split Squat', 'Dumbbell', [[40, 8], [40, 8], [40, 8]], true)] }],
    { '2026-10-12': { exercises: [logged('Bulgarian Split Squat', 'Dumbbell',
      [...sided(4, 'left'), ...sided(2, 'right')])] } });
  assert.equal(day(r, 0).exercises[0].sideLine, 'L 4/3 · R 2/3');
});

test("an each-side exercise's ask is twice its tuples", () => {
  const r = run([{ d: '2026-10-12', x: 0 }],
    [{ n: 'Lower A', e: [ex('Lunge', 'Dumbbell', [[40, 8], [40, 8], [40, 8]], true)] }],
    { '2026-10-12': { exercises: [logged('Lunge', 'Dumbbell', [set(40, 8, { side: 'left' })])] } });
  const e = day(r, 0).exercises[0];
  assert.equal(e.sideLine, 'L 1/3 · R 0/3', 'three tuples each side is six sets');
  assert.match(e.title, / · each side$/);
  assert.match(e.asked.text, / each side$/);
});

test('a plan with no sides produces no side line at all', () => {
  const r = run([{ d: '2026-10-12', x: 0 }],
    [{ n: 'Lower A', e: [ex('Back Squat', 'Barbell', [[225, 5]])] }],
    { '2026-10-12': { exercises: [logged('Back Squat', 'Barbell', [set(225, 5)])] } });
  assert.equal(day(r, 0).exercises[0].sideLine, null);
  assert.equal(day(r, 0).exercises[0].title, 'Back Squat (Barbell)');
});

test('blank stays blank: [null, 5] is 5 reps, never 0 × 5', () => {
  assert.equal(PlanLog.setText({ weightLb: null, reps: 5 }, 'lb'), '5 reps');
  assert.equal(PlanLog.setText({ weightLb: 225, reps: null }, 'lb'), '225 lb');
  assert.equal(PlanLog.setText({ weightLb: null, reps: null, durationSec: 600, distanceM: 1600 }, 'lb'),
    '1,600 m · 10:00');
  assert.equal(PlanLog.setText({}, 'lb'), 'as written');
});

test('a kg client reads kilograms on both rows, from one source', () => {
  const r = run([{ d: '2026-10-12', x: 0 }],
    [{ n: 'Lower A', e: [ex('Back Squat', 'Barbell', [[220, 5]])] }],
    { '2026-10-12': { exercises: [logged('Back Squat', 'Barbell', [set(220, 5)])] } },
    { unit: 'kg' });
  const e = day(r, 0).exercises[0];
  assert.equal(e.asked.text, '100 × 5');
  assert.equal(e.logged.text, '100 × 5');
  // The stored payload and the wire both stay pounds; only the display moved.
  assert.equal(plan([{ d: '2026-10-12', x: 0 }],
    [{ n: 'Lower A', e: [ex('Back Squat', 'Barbell', [[220, 5]])] }])
    .payload.w[0].e[0].s[0][0], 220);
});

/* ---------------- by lift ---------------- */

test('by lift stacks the same lines under one heading, by date', () => {
  const workouts = [{ n: 'Lower A', e: [ex('Back Squat', 'Barbell', [[225, 5]])] }];
  const r = run([{ d: '2026-10-12', x: 0 }, { d: '2026-10-15', x: 0 }], workouts,
    { '2026-10-12': { exercises: [logged('Back Squat', 'Barbell', [set(225, 5)])] },
      '2026-10-15': { exercises: [logged('Back Squat', 'Barbell', [set(230, 5)])] } });
  assert.equal(r.byLift.length, 1);
  assert.equal(r.byLift[0].title, 'Back Squat (Barbell)');
  assert.deepEqual(r.byLift[0].entries.map((e) => e.when), ['12 Oct', '15 Oct']);
  assert.deepEqual(r.byLift[0].entries.map((e) => e.exercise.logged.text), ['225 × 5', '230 × 5']);
});

test('by lift shows the weeks a lift was booked and not logged too', () => {
  const workouts = [{ n: 'Lower A', e: [ex('Back Squat', 'Barbell', [[225, 5]])] }];
  const r = run([{ d: '2026-10-12', x: 0 }, { d: '2026-10-15', x: 0 }, { d: '2026-10-19', x: 0 }],
    workouts,
    { '2026-10-12': { exercises: [logged('Back Squat', 'Barbell', [set(225, 5)])] } },
    { coverage: ['2026-10-01', '2026-10-16'] });
  // Shown only on the weeks it was logged, a lift reads steadier than it was.
  assert.deepEqual(r.byLift[0].entries.map((e) => [e.when, e.exercise.title]), [
    ['12 Oct', 'Back Squat (Barbell)'],
    ['15 Oct', 'Back Squat (Barbell) · not logged'],
    ['19 Oct', 'Back Squat (Barbell) · outside the log they sent'],
  ]);
  // And the heading is the lift, never one day's verdict on it.
  assert.equal(r.byLift[0].title, 'Back Squat (Barbell)');
});

test('the day view does not recite a missed day\'s prescription', () => {
  const r = run([{ d: '2026-10-12', x: 0 }],
    [{ n: 'Lower A', e: [ex('Back Squat', 'Barbell', [[225, 5]])] }], {});
  assert.deepEqual(day(r, 0).exercises, [], 'the row above already says it');
  assert.equal(day(r, 0).booked.length, 1, 'but by lift still has it');
});

/* ---------------- SentPlan ---------------- */

const row = (id, clientId, sentAt, payloadHash) =>
  ({ id, clientId, sentAt, payloadHash, payload: { v: 1, k: [] } });

test('an identical re-share replaces the newest row rather than adding one', () => {
  let rows = [row('a', 'c', 100, 'h1')];
  rows = PlanLog.record(rows, { id: 'b', clientId: 'c', sentAt: 200, payloadHash: 'h1', payload: { v: 1 } });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, 'a', 'the id stays, so a backup merges it as one row');
  assert.equal(rows[0].sentAt, 200);
});

test('a different plan is a new row, and an older matching one is left alone', () => {
  let rows = [row('a', 'c', 100, 'h1')];
  rows = PlanLog.record(rows, { id: 'b', clientId: 'c', sentAt: 200, payloadHash: 'h2', payload: { v: 1 } });
  rows = PlanLog.record(rows, { id: 'd', clientId: 'c', sentAt: 300, payloadHash: 'h1', payload: { v: 1 } });
  assert.deepEqual(PlanLog.forClient(rows, 'c').map((r) => r.id), ['d', 'b', 'a']);
});

test('the cap prunes oldest first, per client, leaving other clients alone', () => {
  let rows = [row('other', 'z', 1, 'h')];
  for (let i = 0; i < PlanLog.CAP + 4; i++) {
    rows = PlanLog.record(rows, { id: 'n' + i, clientId: 'c', sentAt: i + 1, payloadHash: 'h' + i, payload: { v: 1 } });
  }
  const mine = PlanLog.forClient(rows, 'c');
  assert.equal(mine.length, PlanLog.CAP);
  assert.equal(mine[0].id, 'n' + (PlanLog.CAP + 3), 'newest kept');
  assert.equal(mine[mine.length - 1].id, 'n4', 'oldest four pruned');
  assert.equal(PlanLog.forClient(rows, 'z').length, 1);
});

test('the hash is the canonical re-encode: key order does not change it', async () => {
  const a = await PlanLog.hash({ v: 1, t: 'plan', k: [{ d: '2026-10-12', x: 0 }] });
  const b = await PlanLog.hash({ k: [{ x: 0, d: '2026-10-12' }], t: 'plan', v: 1 });
  assert.equal(a, b);
  assert.match(a, /^[0-9a-f]{64}$/);
  // Array order is part of the plan, not incidental.
  const c = await PlanLog.hash({ k: [{ d: '2026-10-13', x: 0 }, { d: '2026-10-12', x: 0 }] });
  const d = await PlanLog.hash({ k: [{ d: '2026-10-12', x: 0 }, { d: '2026-10-13', x: 0 }] });
  assert.notEqual(c, d);
});

/* ---------------- the backup ---------------- */

test('a backup written before sentPlans existed restores unchanged', () => {
  const rows = [row('a', 'c', 100, 'h1')];
  const merged = PlanLog.mergeBackup(rows, undefined);
  assert.deepEqual(merged.rows, rows);
  assert.equal(merged.added, 0);
});

test('an older backup never deletes a newer send, and merges by id', () => {
  const rows = [row('new', 'c', 300, 'h2')];
  const merged = PlanLog.mergeBackup(rows, [row('old', 'c', 100, 'h1'), row('NEW', 'c', 1, 'h2')]);
  assert.deepEqual(PlanLog.forClient(merged.rows, 'c').map((r) => r.id), ['new', 'old']);
  assert.equal(merged.added, 1, 'NEW is new only in spelling');
  assert.equal(PlanLog.forClient(merged.rows, 'c')[0].sentAt, 300, 'the newer send is untouched');
});

test('a restore cannot leave a client with more rows than sending would', () => {
  const incoming = Array.from({ length: PlanLog.CAP + 5 },
    (_, i) => row('f' + i, 'c', i + 1, 'h' + i));
  const merged = PlanLog.mergeBackup([], incoming);
  assert.equal(PlanLog.forClient(merged.rows, 'c').length, PlanLog.CAP);
});

test('a round trip through the backup shape keeps every field', () => {
  const rows = PlanLog.record([], {
    id: 'a', clientId: 'c', sentAt: 1760745600, payloadHash: 'abc',
    payload: sentPlan.payload,
  });
  const file = JSON.parse(JSON.stringify({ sentPlans: rows }));
  const back = PlanLog.mergeBackup([], file.sentPlans);
  assert.deepEqual(back.rows, rows);
});


/* ---------------- meals ----------------
 *
 * A booked meal is a recipe in a slot on a day. What comes back is a list of
 * food entries -- free text, barcode scans, a recipe logged as a meal --
 * named out of the client's own food dictionary, with no id joining them to
 * anything, and itemised only if the client chose to itemise.
 *
 * So Coach says what it booked and what the log holds at that slot, and never
 * that the two are the same dish. The tests that matter most here are the
 * negative ones: nothing this card produces may tell a coach their client ate
 * something they did not.
 */

const recipe = (name) => ({ n: name, s: 4, u: [400, 30, 40, 12, 6], i: [], t: [] });
const meal = (date, slot, x, servings = 1) => ({ d: date, s: slot, x, q: servings });
const BREAKFAST = 0, LUNCH = 1, DINNER = 2, SNACK = 3;

const foodPlan = (recipes, meals, workouts = [], bookings = []) => ({
  id: 'p1', clientId: 'c', sentAt: 1000, payloadHash: 'h',
  payload: { v: 1, t: 'plan', l: 'c', n: '', r: recipes, m: meals, w: workouts, k: bookings },
});
/* A day's food as share-import.js expands it: macros per serving, `meal` the
 * word the wire's slot index names, '' when the entry carries no slot. */
const food = (name, slotWord = '') => ({
  name, servings: 1, calories: 400, proteinG: 30, fatG: 12, carbsG: 40, fiberG: 6,
  meal: slotWord,
});
const totalsOnly = { foodTotals: { calories: 2100, proteinG: 160, fatG: 70, carbsG: 210, fiberG: 28 } };

const runMeals = (recipes, meals, days, over = {}) => PlanLog.compare({
  clientId: 'c',
  sentPlans: [foodPlan(recipes, meals)],
  days,
  coverage: ['2026-10-01', '2026-10-31'],
  unit: 'lb',
  today: '2026-10-20',
  ...over,
});

test('a plan that books meals and no training is a card, not a skipped group', () => {
  const r = runMeals([recipe('Beef Chilli')], [meal('2026-10-12', DINNER, 0, 2)], {});
  assert.equal(r.groups.length, 1, 'the training-only card skipped this entirely');
  assert.equal(r.groups[0].head, 'Booked 1 day, 12 Oct · 1 meal booked');
  assert.equal(day(r, 0).text, 'Mon 12 Oct · 1 meal booked');
  assert.equal(day(r, 0).state, 'meals');
});

test('a meals-only day is never called "not logged"', () => {
  // There is no training booked to be logged or not. Saying "not logged"
  // against one would be Coach inventing a booking to hold against a client.
  const r = runMeals([recipe('Beef Chilli')], [meal('2026-10-12', DINNER, 0)], {});
  const every = PlanLog.lines(r).join(' · ');
  assert.equal(every.includes('not logged'), false, every);
  assert.deepEqual(r.groups[0].counts,
    { booked: 1, training: 0, logged: 0, notLogged: 0, outside: 0, other: 0, meals: 1 });
});

test('a session nobody booked is not swallowed by a meal booked that day', () => {
  // Coach iOS and Android found this first: a send that books meals across a
  // week puts a booking on every date, and the sweep for a session nobody
  // booked skipped any booked date -- so a session the client did on a day
  // they were booked to eat vanished, the row reading `1 meal booked` and
  // saying nothing about the training at all. The test is training, not
  // booking.
  const r = PlanLog.compare({
    clientId: 'c',
    sentPlans: [
      foodPlan([recipe('Beef Chilli')],
        [meal('2026-10-12', DINNER, 0), meal('2026-10-13', DINNER, 0)],
        [{ n: 'Lower A', e: [ex('Back Squat', 'Barbell', [[225, 5]])] }],
        [{ d: '2026-10-12', x: 0 }]),
    ],
    days: {
      '2026-10-13': { name: 'Conditioning', exercises: [logged('Row', 'Machine', [set(null, null)])] },
    },
    coverage: ['2026-10-01', '2026-10-31'],
    unit: 'lb',
    today: '2026-10-20',
  });
  const texts = r.groups[0].days.map((d) => d.text);
  assert.ok(texts.some((t) => t.includes('Tue 13 Oct') && t.includes('not booked')),
    'the session on a day booked for dinner was swallowed: ' + texts.join(' | '));
  assert.equal(r.groups[0].counts.other, 1);
});

test('a booked meal names the slot, the dish and the servings, and no macros', () => {
  const r = runMeals([recipe('Beef Chilli')], [meal('2026-10-12', DINNER, 0, 2)], {});
  const m = day(r, 0).meals[0];
  assert.equal(m.title, 'Dinner · Beef Chilli · 2 servings');
  // The recipe's own figures are in the payload and deliberately not on the
  // card: a planned calorie beside a logged one is a coach's target measured
  // against, which is the line this card does not cross.
  const every = PlanLog.lines(r).join(' · ');
  ['400', '30', 'kcal', 'protein'].forEach((token) => {
    assert.equal(every.includes(token), false, `${token} reached the card`);
  });
});

test('one serving is "1 serving", and two dishes at one slot are two rows', () => {
  const r = runMeals([recipe('Overnight Oats'), recipe('Protein Shake')],
    [meal('2026-10-12', BREAKFAST, 0), meal('2026-10-12', BREAKFAST, 1, 1)], {});
  assert.deepEqual(day(r, 0).meals.map((m) => m.title), [
    'Breakfast · Overnight Oats · 1 serving',
    'Breakfast · Protein Shake · 1 serving',
  ]);
});

test('meals read in the order a day is eaten, not the order they were booked', () => {
  const r = runMeals([recipe('Chilli'), recipe('Oats'), recipe('Bar')],
    [meal('2026-10-12', SNACK, 2), meal('2026-10-12', DINNER, 0), meal('2026-10-12', BREAKFAST, 1)], {});
  assert.deepEqual(day(r, 0).meals.map((m) => m.slotLabel), ['Breakfast', 'Dinner', 'Snack']);
});

/* ---------------- what the log can be asked ---------------- */

test('an itemised slot says what the log holds there, and never that it is the dish', () => {
  const r = runMeals([recipe('Beef Chilli')], [meal('2026-10-12', DINNER, 0, 2)],
    { '2026-10-12': { food: [food('Porridge', 'Breakfast'), food('Beef Chilli', 'Dinner'),
      food('Greek yoghurt', 'Dinner')] } });
  assert.equal(day(r, 0).foodContext, '3 foods logged that day');
  assert.equal(day(r, 0).meals[0].logged, 'Logged at dinner · Beef Chilli · Greek yoghurt');
  // The two facts are printed one above the other. Nothing anywhere claims
  // the logged Beef Chilli is the booked one -- the coach makes that join,
  // from the same two facts Coach has.
  const every = PlanLog.lines(r).join(' · ').toLowerCase();
  ['ate', 'as booked', 'as planned', 'matched', 'they had'].forEach((claim) => {
    assert.equal(every.includes(claim), false, `"${claim}" claims a match: ${every}`);
  });
});

test('a booked meal with nothing at that slot says so about the slot, not the client', () => {
  const r = runMeals([recipe('Chicken & Rice')], [meal('2026-10-12', LUNCH, 0)],
    { '2026-10-12': { food: [food('Porridge', 'Breakfast'), food('Steak', 'Dinner')] } });
  assert.equal(day(r, 0).meals[0].logged, 'Nothing logged at lunch');
  // And the day's own count sits above it, so "nothing at lunch" cannot be
  // read as "they ate nothing".
  assert.equal(day(r, 0).foodContext, '2 foods logged that day');
});

test('a day with meals booked and no food at all logged says exactly that', () => {
  const r = runMeals([recipe('Beef Chilli')], [meal('2026-10-12', DINNER, 0)],
    { '2026-10-12': { exercises: [] } });
  assert.equal(day(r, 0).foodContext, 'No food logged that day');
  assert.equal(day(r, 0).meals[0].logged, null, 'nothing to say per slot');
});

test('a day opened and left empty logged no food, and is not a slot verdict', () => {
  // SHARE-FORMAT: `ft: [0,0,0,0,0]` is a day opened and nothing logged.
  const r = runMeals([recipe('Beef Chilli')], [meal('2026-10-12', DINNER, 0)],
    { '2026-10-12': { foodTotals: { calories: 0, proteinG: 0, fatG: 0, carbsG: 0, fiberG: 0 } } });
  assert.equal(day(r, 0).foodContext, 'No food logged that day');
  assert.equal(day(r, 0).meals[0].logged, null);
});

test('a client who sent totals and not items gets no slot verdict at all', () => {
  // Itemisation is a choice the client makes per send. Calling a booked
  // dinner "nothing logged at dinner" here would contradict that choice with
  // a fact Coach does not have.
  const r = runMeals([recipe('Beef Chilli')], [meal('2026-10-12', DINNER, 0)],
    { '2026-10-12': totalsOnly });
  assert.equal(day(r, 0).foodContext, 'Food logged that day, not itemised');
  assert.equal(day(r, 0).meals[0].logged, null);
  assert.equal(PlanLog.lines(r).join(' ').includes('Nothing logged'), false);
});

test('foods the client tied to no meal are counted, so a quiet slot is not a verdict', () => {
  const r = runMeals([recipe('Chicken & Rice')], [meal('2026-10-12', LUNCH, 0)],
    { '2026-10-12': { food: [food('Flapjack'), food('Coffee'), food('Steak', 'Dinner')] } });
  assert.equal(day(r, 0).foodContext, '3 foods logged that day · 2 not tied to a meal');
  assert.equal(day(r, 0).meals[0].logged, 'Nothing logged at lunch');
});

test('a booked meal outside the log the client sent is never a slot verdict', () => {
  const r = runMeals([recipe('Beef Chilli')], [meal('2026-10-12', DINNER, 0)], {},
    { coverage: ['2026-09-01', '2026-10-05'] });
  assert.equal(day(r, 0).text, 'Mon 12 Oct · 1 meal booked · outside the log they sent');
  assert.equal(day(r, 0).meals[0].logged, null);
  assert.equal(day(r, 0).foodContext, null);
  assert.equal(r.groups[0].head, 'Booked 1 day, 12 Oct · 1 meal booked · no log covering them');
});

test("a client whose log predates the send gets no verdict on any meal of it", () => {
  const r = runMeals([recipe('Beef Chilli'), recipe('Oats')],
    [meal('2026-10-12', DINNER, 0), meal('2026-10-13', BREAKFAST, 1)],
    {}, { coverage: ['2026-08-01', '2026-09-30'] });
  assert.deepEqual(r.groups[0].days.map((d) => d.text), [
    'Mon 12 Oct · 1 meal booked · outside the log they sent',
    'Tue 13 Oct · 1 meal booked · outside the log they sent',
  ]);
  const every = PlanLog.lines(r).join(' · ');
  assert.equal(every.includes('Nothing logged'), false);
  assert.equal(every.includes('not logged'), false);
});

test("a client's own food name is printed as they wrote it, percent sign and all", () => {
  // The line discipline is about Coach's sentences, not about the client's
  // data: "2% milk" is what they logged and what Coach prints. Never
  // rewritten, never trimmed to fit a rule about the app's own words.
  const r = runMeals([recipe('Porridge')], [meal('2026-10-12', BREAKFAST, 0)],
    { '2026-10-12': { food: [food('2% milk', 'Breakfast')] } });
  assert.equal(day(r, 0).meals[0].logged, 'Logged at breakfast · 2% milk');
});

/* ---------------- meals beside training ---------------- */

test('a day that books both says the training verdict and the meal count', () => {
  const r = PlanLog.compare({
    clientId: 'c',
    sentPlans: [foodPlan([recipe('Beef Chilli'), recipe('Oats')],
      [meal('2026-10-12', DINNER, 0, 2), meal('2026-10-13', BREAKFAST, 1), meal('2026-10-13', DINNER, 0)],
      [{ n: 'Lower A', e: [ex('Back Squat', 'Barbell', [[225, 5]])] }],
      [{ d: '2026-10-12', x: 0 }])],
    days: { '2026-10-12': { name: 'Lower A',
      exercises: [logged('Back Squat', 'Barbell', [set(225, 5)])],
      food: [food('Beef Chilli', 'Dinner')] } },
    coverage: ['2026-10-01', '2026-10-31'], unit: 'lb', today: '2026-10-20',
  });
  assert.deepEqual(r.groups[0].days.map((d) => d.text), [
    'Mon 12 Oct · Lower A · logged · 1 meal booked',
    'Tue 13 Oct · 2 meals booked',
  ]);
  // "logged 2" under "Booked 5 days" would read as two of five when three of
  // them booked no training at all, so the figure names what it counts.
  assert.equal(r.groups[0].head,
    'Booked 2 days, 12–13 Oct · 3 meals booked · 1 training day, 1 logged');
  assert.deepEqual(r.groups[0].counts,
    { booked: 2, training: 1, logged: 1, notLogged: 0, outside: 0, other: 0, meals: 3 });
});

test('a training-only send reads exactly as it did before meals existed', () => {
  const r = run([{ d: '2026-10-12', x: 0 }],
    [{ n: 'Lower A', e: [ex('Back Squat', 'Barbell', [[225, 5]])] }],
    { '2026-10-12': { name: 'Lower A', exercises: [logged('Back Squat', 'Barbell', [set(225, 5)])] } });
  assert.equal(r.groups[0].head, 'Booked 1 day, 12 Oct · logged 1');
  assert.deepEqual(day(r, 0).meals, []);
  assert.equal(day(r, 0).foodContext, null);
  assert.equal(r.mealFooter, null, 'and no note about meals under a card with none');
});

test('a food plan does not hold up the training the coach never booked', () => {
  // `not booked` exists so a session lifted the day after the one it was
  // booked for sits beside that booking. A send with no training booked none
  // for it to sit beside, and listing a client's own sessions under a meal
  // plan would be Coach holding up work nobody set out to book.
  const r = runMeals([recipe('Beef Chilli')], [meal('2026-10-12', DINNER, 0), meal('2026-10-14', DINNER, 0)],
    { '2026-10-13': { name: 'Conditioning',
      exercises: [logged('Kettlebell Swing', 'Kettlebell', [set(53, 20)])] } });
  assert.deepEqual(r.groups[0].days.map((d) => d.text), [
    'Mon 12 Oct · 1 meal booked',
    'Wed 14 Oct · 1 meal booked',
  ]);
  assert.equal(r.groups[0].counts.other, 0);
  assert.equal(PlanLog.lines(r).join(' ').includes('not booked'), false);
});

test('a send that books both still shows a session it did not book', () => {
  const r = PlanLog.compare({
    clientId: 'c',
    sentPlans: [foodPlan([recipe('Beef Chilli')], [meal('2026-10-12', DINNER, 0)],
      [{ n: 'Lower A', e: [ex('Back Squat', 'Barbell', [[225, 5]])] }],
      [{ d: '2026-10-12', x: 0 }, { d: '2026-10-14', x: 0 }])],
    days: { '2026-10-13': { name: 'Conditioning',
      exercises: [logged('Kettlebell Swing', 'Kettlebell', [set(53, 20)])] } },
    coverage: ['2026-10-01', '2026-10-31'], unit: 'lb', today: '2026-10-20',
  });
  assert.equal(r.groups[0].days[1].text, 'Tue 13 Oct · Conditioning · not booked');
  assert.equal(r.groups[0].counts.other, 1);
});

test('by lift stays about lifts: a meals-only plan has none', () => {
  const r = runMeals([recipe('Beef Chilli')], [meal('2026-10-12', DINNER, 0)], {});
  assert.deepEqual(r.byLift, []);
  assert.equal(PlanLog.lines(r).includes('By lift'), false);
});

/* ---------------- a plan with nothing booked into a day ---------------- */

test('a library send -- recipes with nothing booked -- is not a card', () => {
  const r = runMeals([recipe('Beef Chilli'), recipe('Oats')], [], {});
  assert.deepEqual(r.groups, []);
  assert.deepEqual(PlanLog.lines(r), []);
});

test('a picks-only plan is still nothing to show', () => {
  const r = PlanLog.compare({
    clientId: 'c',
    sentPlans: [{ id: 'p', clientId: 'c', sentAt: 1, payloadHash: 'h',
      payload: { v: 1, t: 'plan', l: 'c', rf: ['wendys-large-chili', 'snack-beef-jerky'] } }],
    days: { '2026-10-12': { food: [food('Wendy’s chilli', 'Lunch')] } },
    coverage: ['2026-10-01', '2026-10-31'], unit: 'lb', today: '2026-10-20',
  });
  assert.deepEqual(r.groups, []);
  assert.equal(r.mealFooter, null);
});

test('the note about what a meal row does not claim is shown once, under a card that has one', () => {
  const r = runMeals([recipe('Beef Chilli')], [meal('2026-10-12', DINNER, 0)],
    { '2026-10-12': { food: [food('Beef Chilli', 'Dinner')] } });
  assert.equal(r.mealFooter, PlanLog.MEAL_NOTE);
  const out = PlanLog.lines(r);
  assert.equal(out.filter((l) => l === PlanLog.MEAL_NOTE).length, 1);
  assert.equal(out[out.length - 2], PlanLog.MEAL_NOTE, 'above the permanent footer');
  assert.equal(out[out.length - 1], PlanLog.FOOTER);
});

/* ---------------- the line discipline ---------------- */

/* The spirit of PerLimbTests.testNothingInTheseLinesTellsACoachWhatToDo and
 * its Coach web twin: the card counts, and never grades. */
const FORBIDDEN = ['should', 'fix', 'warning', 'target', 'too ', 'concern',
  'missed', 'skipped', 'failed', 'poor', 'behind', 'compliance', 'adherence',
  'streak', '%'];

/* Every meal state the card has, in one send: a slot the log holds something
 * at, a slot it holds nothing at, a day with no food at all, a day whose
 * client sent totals and not items, a day outside the window they sent, an
 * entry tied to no meal, and a meal day beside a training one.
 *
 * The food names here are plain on purpose. A client's own "2% milk" is
 * printed as they wrote it and would fail the list below -- the discipline is
 * about the sentences Coach writes, not about the client's data, and the test
 * above pins the passthrough. */
const mealFixture = () => PlanLog.compare({
  clientId: 'c',
  sentPlans: [foodPlan(
    [recipe('Beef Chilli'), recipe('Overnight Oats'), recipe('Chicken & Rice')],
    [meal('2026-10-12', DINNER, 0, 2), meal('2026-10-12', BREAKFAST, 1),
      meal('2026-10-13', LUNCH, 2), meal('2026-10-14', DINNER, 0),
      meal('2026-10-15', LUNCH, 2), meal('2026-10-19', DINNER, 0)],
    [{ n: 'Lower A', e: [ex('Back Squat', 'Barbell', [[225, 5]])] }],
    [{ d: '2026-10-12', x: 0 }],
  )],
  days: {
    '2026-10-12': { name: 'Lower A',
      exercises: [logged('Back Squat', 'Barbell', [set(225, 5)])],
      food: [food('Beef Chilli', 'Dinner'), food('Greek yoghurt', 'Dinner'),
        food('Porridge', 'Breakfast')] },
    '2026-10-13': { food: [food('Steak', 'Dinner'), food('Flapjack')] },
    '2026-10-14': { exercises: [] },
    '2026-10-15': totalsOnly,
  },
  coverage: ['2026-10-01', '2026-10-16'], unit: 'lb', today: '2026-10-20',
});

test('nothing in this card tells a coach what to do', async () => {
  // Every state the card has: a logged day, a day with nothing logged, a day
  // outside the window the client sent, a day logged and not booked; and a
  // matched lift, a substituted one, one short on a side, one short on sets,
  // one not logged at all and one nobody asked for.
  const training = PlanLog.lines(await fixture());
  const meals = PlanLog.lines(mealFixture());
  assert.ok(meals.length > 15, 'the meal fixture should exercise every meal state');
  const every = training.concat(meals).join(' · ').toLowerCase();
  assert.ok(every.length > 200, 'the fixture should exercise the whole card');
  FORBIDDEN.forEach((word) => {
    assert.equal(every.includes(word), false, `"${word}" reached a screen: ${every}`);
  });
});

test('no meal sentence claims a client ate anything', () => {
  // The whole reason the booked and the logged sides of a meal are two
  // separate statements. Coach can see a dish it booked and a list of foods
  // stamped with a slot; it cannot see that they are the same dinner, and a
  // wrong claim here tells a coach their client ate something they did not.
  const every = PlanLog.lines(mealFixture()).join(' · ').toLowerCase();
  ['ate', 'eaten', 'as booked', 'as planned', 'matched', 'they had',
    'on plan', 'off plan', 'followed', 'complied'].forEach((claim) => {
    assert.equal(every.includes(claim), false, `"${claim}" claims a meal was eaten: ${every}`);
  });
  // And the one sentence that says what the rows do not claim is there.
  assert.ok(every.includes(PlanLog.MEAL_NOTE.toLowerCase()));
});

test('nothing here aggregates a client into a score', async () => {
  const result = await fixture();

  // Counts hang off a day or a group of days, and there is nothing at the
  // top of the result to aggregate: no roster figure, no all-time total, no
  // trend across weeks.
  assert.deepEqual(Object.keys(result).sort(), ['byLift', 'footer', 'groups', 'mealFooter']);
  assert.deepEqual(Object.keys(result.groups[0].counts).sort(),
    ['booked', 'logged', 'meals', 'notLogged', 'other', 'outside', 'training'],
    'a group counts the days and the meals it booked, and nothing else');

  // And nothing anywhere in the tree is a score, a rate or a percentage.
  const banned = /score|percent|rate|ratio|average|total|streak|grade|adherence|compliance/i;
  const walk = (node, path) => {
    if (Array.isArray(node)) return node.forEach((v, i) => walk(v, path + '[' + i + ']'));
    if (node && typeof node === 'object') {
      return Object.keys(node).forEach((k) => {
        assert.equal(banned.test(k), false, `${path}.${k} reads as a grade`);
        walk(node[k], path + '.' + k);
      });
    }
    if (typeof node === 'string') {
      assert.equal(node.includes('%'), false, `${path} carries a percentage`);
    }
  };
  walk(result, 'result');

  // The exported surface offers nothing per client, per block or per roster.
  assert.deepEqual(Object.keys(PlanLog).filter((k) => banned.test(k)), []);

  // Meals are counted the same way and scored no more than training is:
  // a number of meals booked, and no figure beside it claiming how many of
  // them were eaten, because there is no such figure.
  const meals = mealFixture();
  assert.deepEqual(Object.keys(meals).sort(), ['byLift', 'footer', 'groups', 'mealFooter']);
  assert.equal(meals.groups[0].counts.meals, 6);
  walk(meals, 'meals');
});

test('the roster stays a roster: nothing in this feature reaches a roster row', () => {
  const source = readFileSync('coach/app.js', 'utf8');
  const start = source.indexOf('function renderRoster()');
  const end = source.indexOf("/* ---------------- one client ----------------", start);
  assert.ok(start > 0 && end > start, 'renderRoster moved; re-point this test');
  const roster = source.slice(start, end);
  ['CoachPlanLog', 'sentPlans', 'sentPlan', 'Booked', 'booked'].forEach((token) => {
    assert.equal(roster.includes(token), false,
      `renderRoster mentions ${token} -- the card counts per client and never across the roster`);
  });
});

test('the card draws every part of a row, clause included', () => {
  // Found on screen, not in a test: the card drew an each-side ask's set
  // groups and dropped its "each side" clause, so a plan asking for six sets
  // printed three while lines() -- and so every discipline test -- read the
  // full sentence. A row is groups plus a suffix, and a view that draws one
  // and not the other is a view that prints a plan nobody wrote.
  const source = readFileSync('coach/app.js', 'utf8');
  const start = source.indexOf('function bookedSets(');
  assert.ok(start > 0, 'bookedSets moved; re-point this test');
  const body = source.slice(start, source.indexOf('\n}', start));
  assert.ok(body.includes('row.groups'), 'bookedSets must draw the groups');
  assert.ok(body.includes('row.suffix'), 'bookedSets must draw the suffix');
});

test('the card draws both halves of a meal row, and the context above them', () => {
  // The same guard as the one above, for the half of the card where getting
  // it wrong is worse: a view that drew the booked dish and dropped the line
  // saying what the log holds at that meal would read as a claim the dish was
  // eaten, which is the one thing this feature refuses to say.
  const source = readFileSync('coach/app.js', 'utf8');
  const start = source.indexOf('function bookedMeals(');
  assert.ok(start > 0, 'bookedMeals moved; re-point this test');
  const body = source.slice(start, source.indexOf('\n}', start));
  assert.ok(body.includes('day.foodContext'), 'the day\'s own food count sits above the rows');
  assert.ok(body.includes('meal.title'), 'what was booked');
  assert.ok(body.includes('meal.logged'), 'what the log holds at that meal');
});

test('the card carries the note about what a meal row does not claim', () => {
  const source = readFileSync('coach/app.js', 'utf8');
  const start = source.indexOf('function renderBooked(');
  assert.ok(start > 0, 'renderBooked moved; re-point this test');
  const body = source.slice(start, source.indexOf('\nfunction ', start + 1));
  assert.ok(body.includes('result.mealFooter'), 'MEAL_NOTE must reach the screen');
  assert.ok(body.includes('result.footer'), 'and so must the permanent one');
});

test('a lift nobody asked for that was all warmups is not "0 sets" on screen', () => {
  const r = run([{ d: '2026-10-12', x: 0 }],
    [{ n: 'Lower A', e: [ex('Back Squat', 'Barbell', [[225, 5]])] }],
    { '2026-10-12': { exercises: [
      logged('Back Squat', 'Barbell', [set(225, 5)]),
      logged('Treadmill', 'Machine', [set(null, null, { warmup: true })]),
    ] } });
  assert.deepEqual(day(r, 0).alsoLogged, [], 'working sets are the claim everywhere else');
});
