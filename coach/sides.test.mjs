import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';

// Loaded the way the browser loads them, in index.html's order. Run from the
// repo root: node --test coach/
const shim = { window: {} };
['route.js', 'nutrients.js', 'sides.js', 'recipe-nutrition.js', 'share-import.js'].forEach((file) => {
  new Function('window', readFileSync(`coach/${file}`, 'utf8')).call(shim, shim.window);
});
const S = shim.window.CoachSides;
const { expandSet, expandDay } = shim.window.CoachShareImport;
const MEALS = ['Breakfast', 'Lunch', 'Dinner', 'Snack'];

/* ---------------- the wire ---------------- */

// SHARE-FORMAT.md "flags": bit 0 warmup, bits 1-2 side, 0 and 3 both meaning
// both. Every value an encoder can produce, and the two it cannot.
test('the side bits are masked, never compared', () => {
  assert.equal(S.sideFromFlags(0), null, 'no flags at all is both');
  assert.equal(S.sideFromFlags(1), null, 'warmup alone says nothing about a side');
  assert.equal(S.sideFromFlags(2), 'left');
  assert.equal(S.sideFromFlags(3), 'left', 'a left-side warmup, not a working set');
  assert.equal(S.sideFromFlags(4), 'right');
  assert.equal(S.sideFromFlags(5), 'right', 'a right-side warmup');
  assert.equal(S.sideFromFlags(6), null, '3 in bits 1-2 is never written and reads as both');
  assert.equal(S.sideFromFlags(7), null);
  // Absent, junk and a float all read as an ordinary two-sided set rather
  // than throwing an import away.
  [undefined, null, '', 'left', NaN].forEach((junk) => {
    assert.equal(S.sideFromFlags(junk), null);
  });
});

test('a decoded set carries its warmup bit and its side independently', () => {
  const read = (flags) => expandSet([185, 5, null, null, null, flags]);
  assert.equal(read(0).warmup, false);
  assert.equal('side' in read(0), false, 'both is absent, never written out');
  assert.equal(read(1).warmup, true);
  assert.equal('side' in read(1), false);
  assert.deepEqual([read(2).warmup, read(2).side], [false, 'left']);
  assert.deepEqual([read(3).warmup, read(3).side], [true, 'left']);
  assert.deepEqual([read(4).warmup, read(4).side], [false, 'right']);
  assert.deepEqual([read(5).warmup, read(5).side], [true, 'right']);
  // The weight and the reps are the same in all six, which is the degradation
  // the format is designed around: a decoder that ignored the byte entirely
  // would still get the volume right.
  [0, 1, 2, 3, 4, 5].forEach((flags) => {
    assert.equal(read(flags).weightLb, 185);
    assert.equal(read(flags).reps, 5);
  });
});

test('a link written before per-limb logging decodes as both', () => {
  // Trailing nulls trimmed, so an ordinary set is just [185, 5] -- exactly
  // what every encoder sent before any of this existed.
  const day = expandDay({ k: 0, w: [[0, [[185, 5], [185, 5, 8], [95, 8, null, null, null, 1]]]] },
    ['Bench Press|Barbell'], [], MEALS);
  const sets = day.exercises[0].sets;
  assert.equal(sets.length, 3);
  sets.forEach((set) => assert.equal('side' in set, false));
  assert.equal(S.anySided(sets), false);
  assert.equal(S.countsLabel(sets), '', 'nothing sided, nothing to say');
  assert.equal(sets[2].warmup, true, 'the warmup bit still reads');
});

/* ---------------- reading a side ---------------- */

test('only "left" and "right" are a side; everything else is both', () => {
  assert.equal(S.of({ side: 'left' }), 'left');
  assert.equal(S.of({ side: ' Right ' }), 'right', 'lenient about case and space');
  ['both', 'L', 'R', '', 'LEFTISH', null, undefined, 0, 3].forEach((raw) => {
    assert.equal(S.of({ side: raw }), null, `${JSON.stringify(raw)} is not a side`);
  });
  assert.equal(S.of({}), null);
  assert.equal(S.of(null), null);
});

test('a set reads "L" or "R", and an unmarked one reads as nothing', () => {
  assert.equal(S.label({ side: 'left' }), 'L');
  assert.equal(S.label({ side: 'right' }), 'R');
  assert.equal(S.label({}), '');
  assert.equal(S.longLabel({ side: 'left' }), 'Left');
  assert.equal(S.longLabel({}), 'Both');
});

test('counts say how many a side has, including sets logged before the toggle', () => {
  const sets = [{ side: 'left' }, { side: 'right' }, { side: 'left' }, {}];
  assert.deepEqual(S.countsIn(sets), { left: 2, right: 1, both: 1 });
  assert.equal(S.countsLabel(sets), 'L 2 · R 1 · 1 both');
  assert.equal(S.countsLabel([{ side: 'left' }, { side: 'right' }]), 'L 1 · R 1');
});

/* ---------------- grouping ---------------- */

test('side joins name and equipment in a lift key', () => {
  const k = S.key;
  assert.notEqual(k('Row', 'Dumbbell', 'left'), k('Row', 'Dumbbell', 'right'));
  assert.notEqual(k('Row', 'Dumbbell', 'left'), k('Row', 'Dumbbell', null));
  // Equipment still separates a cable pulldown from a machine one, which is
  // the rule side is following.
  assert.notEqual(k('Pulldown', 'Cable', null), k('Pulldown', 'Machine', null));
  // Both spelt every way it can be spelt is one key.
  assert.equal(k('Row', 'Dumbbell', null), k('Row', 'Dumbbell', 'both'));
  assert.equal(k('Row', 'Dumbbell', undefined), k('Row', 'Dumbbell', 'both'));
  assert.equal(k(' Row ', 'Dumbbell', 'LEFT'), k('row', 'dumbbell', 'left'));
});

const topWeight = (sets) => ({ top: Math.max(...sets.map((s) => s.weightLb)) });

test('grouping keeps the two limbs in separate series', () => {
  const days = [
    { key: '2026-09-01', sets: [{ weightLb: 40, side: 'left' }, { weightLb: 45, side: 'right' }] },
    { key: '2026-09-03', sets: [{ weightLb: 45, side: 'left' }, { weightLb: 50, side: 'right' }] },
  ];
  const series = S.splitSessions('Split Squat', 'Dumbbell', days, topWeight);
  assert.deepEqual(series.map((s) => s.side), ['left', 'right']);
  assert.deepEqual(series.map((s) => s.id), [
    'split squat|dumbbell|left', 'split squat|dumbbell|right',
  ]);
  assert.deepEqual(series[0].points.map((p) => p.top), [40, 45]);
  assert.deepEqual(series[1].points.map((p) => p.top), [45, 50]);
  // Interleaved on the wire, never interleaved on the chart: each line is
  // monotonic here, which the merged single series would not have been.
  assert.deepEqual(series.map((s) => s.label), ['Left', 'Right']);
});

test('a two-sided lift is one series, unchanged', () => {
  const days = [
    { key: '2026-09-01', sets: [{ weightLb: 185 }, { weightLb: 195 }] },
    { key: '2026-09-03', sets: [{ weightLb: 200 }] },
  ];
  const series = S.splitSessions('Bench Press', 'Barbell', days, topWeight);
  assert.equal(series.length, 1);
  assert.equal(series[0].side, null);
  assert.equal(series[0].id, 'bench press|barbell|');
  assert.deepEqual(series[0].points.map((p) => p.top), [195, 200]);
});

test('a lift logged two-sided and then per-side keeps all three, sides first', () => {
  const days = [
    { key: '2026-09-01', sets: [{ weightLb: 40 }, { weightLb: 40 }] },
    { key: '2026-09-08', sets: [{ weightLb: 40, side: 'left' }, { weightLb: 45, side: 'right' }] },
  ];
  const series = S.splitSessions('Split Squat', 'Dumbbell', days, topWeight);
  assert.deepEqual(series.map((s) => s.side), ['left', 'right', null]);
  // A session with no sets on a side is a gap in that line, never a zero.
  assert.deepEqual(series[0].points.map((p) => p.key), ['2026-09-08']);
  assert.deepEqual(series[2].points.map((p) => p.key), ['2026-09-01']);
});

test('onSide asks for one limb, and null asks for the unmarked ones', () => {
  const sets = [{ id: 1, side: 'left' }, { id: 2, side: 'right' }, { id: 3 }];
  assert.deepEqual(S.onSide(sets, 'left').map((s) => s.id), [1]);
  assert.deepEqual(S.onSide(sets, 'right').map((s) => s.id), [2]);
  assert.deepEqual(S.onSide(sets, null).map((s) => s.id), [3]);
  assert.deepEqual(S.onSide(sets, 'both').map((s) => s.id), [3]);
});

/* ---------------- imbalance ---------------- */

test('no figure until both sides have three sessions', () => {
  assert.deepEqual(S.imbalance([100, 100], [100, 100, 100]),
    { enough: false, sessions: { left: 2, right: 3 } });
  assert.equal(S.imbalance([], []).enough, false);
  assert.equal(S.imbalance([100, 100, 100], []).enough, false);
  // A session with no estimate in it -- no weight, or reps out of range --
  // does not count towards the three.
  assert.equal(S.imbalance([100, null, 100, 0], [100, 100, 100]).enough, false);
});

test('the figure is the gap between each side\'s last three sessions', () => {
  // Left's last three mean 100, right's mean 90: a 10% gap, left ahead.
  const result = S.imbalance([80, 100, 100, 100], [80, 90, 90, 90]);
  assert.equal(result.enough, true);
  assert.equal(Math.round(result.percent * 1000) / 10, 10);
  assert.equal(result.strong, 'left');
  assert.equal(result.weak, 'right');
  // Not the best day, and not the latest: an extra strong session earlier is
  // averaged in, not taken as the number.
  assert.deepEqual(result.sessions, { left: 4, right: 4 });
});

test('a perfectly balanced pair has no strong side and no gap', () => {
  const result = S.imbalance([100, 100, 100], [100, 100, 100]);
  assert.equal(result.enough, true);
  assert.equal(result.percent, 0);
  assert.equal(result.strong, null);
  assert.equal(result.weak, null);
  assert.equal(result.trend, null, 'three sessions is not enough to compare against');
});

test('the trend needs four sessions a side, and half a point to move', () => {
  const three = S.imbalance([90, 95, 100], [100, 100, 100]);
  assert.equal(three.enough, true);
  assert.equal(three.trend, null, 'with three, both windows are the same sessions');
  assert.equal(three.was, null);

  // First three mean 80 vs 100 (20%), last three 95 vs 100 (5%).
  const closing = S.imbalance([80, 80, 80, 95, 95, 95], [100, 100, 100, 100, 100, 100]);
  assert.equal(closing.trend, 'closing');
  assert.equal(Math.round(closing.was * 100), 20);
  assert.equal(Math.round(closing.percent * 100), 5);

  const widening = S.imbalance([95, 95, 95, 80, 80, 80], [100, 100, 100, 100, 100, 100]);
  assert.equal(widening.trend, 'widening');

  // A tenth of a percentage point is noise in an estimate built out of an
  // estimate, so nothing has happened.
  const steady = S.imbalance([90, 90, 90, 90.1, 90.1, 90.1], [100, 100, 100, 100, 100, 100]);
  assert.equal(steady.trend, 'steady');
});

test('the lines say what is missing rather than nothing', () => {
  const notYet = S.imbalanceLines(S.imbalance([100], [100, 100, 100]));
  assert.equal(notYet.headline, '—');
  assert.equal(notYet.detail, 'Needs 3 sessions a side · 1 left, 3 right so far');

  const ahead = S.imbalanceLines(S.imbalance([80, 80, 80, 95, 95, 95], [100, 100, 100, 100, 100, 100]));
  assert.equal(ahead.headline, 'Right ahead by 5%');
  assert.equal(ahead.detail, 'Mean estimated 1RM of the last 3 sessions each · gap closing');

  assert.equal(S.imbalanceLines(S.imbalance([100, 100, 100], [100, 100, 100])).headline, 'Sides level');

  // Tracked and shown, never targeted: nothing here suggests a threshold, a
  // colour, or anything to do about it.
  const text = [notYet, ahead].map((l) => `${l.headline} ${l.detail}`).join(' ').toLowerCase();
  ['should', 'fix', 'warning', 'target', 'too ', 'concern'].forEach((word) => {
    assert.equal(text.includes(word), false, `"${word}" has no business in this card`);
  });
});

/* ---------------- the backup file ---------------- */

const clientWith = (sets) => ({
  id: 'c1',
  days: { '2026-09-10': { exercises: [{ name: 'Split Squat', equipment: 'Dumbbell', sets }] } },
});

const savedSets = (client) =>
  JSON.parse(JSON.stringify(client)).days['2026-09-10'].exercises[0].sets;

test('a backup writes side only for left and right, and omits both', () => {
  const client = clientWith([
    { weightLb: 40, reps: 8, side: 'left' },
    { weightLb: 45, reps: 8, side: 'right' },
    { weightLb: 45, reps: 8 },
  ]);
  S.normaliseClient(client);
  const sets = savedSets(client);
  assert.deepEqual(sets.map((s) => s.side), ['left', 'right', undefined]);
  assert.equal('side' in sets[2], false, 'absent is how both is spelt');
});

test('a backup round-trips a side, both ways', () => {
  const client = clientWith([
    { weightLb: 40, reps: 8, side: 'left' },
    { weightLb: 45, reps: 8, side: 'right' },
    { weightLb: 185, reps: 5 },
  ]);
  S.normaliseClient(client);
  const file = JSON.stringify({ v: 2, clients: [client], settings: {}, recipes: [], plans: [], workouts: [], sessions: [] }, null, 1);

  const parsed = JSON.parse(file);
  parsed.clients.forEach(S.normaliseClient);
  assert.deepEqual(parsed.clients[0], client, 'what went out is what comes back');

  const restored = parsed.clients[0].days['2026-09-10'].exercises[0].sets;
  assert.deepEqual(S.countsIn(restored), { left: 1, right: 1, both: 1 });
  // And the grouping survives the file, which is the point of carrying it.
  const series = S.splitSessions('Split Squat', 'Dumbbell',
    [{ key: '2026-09-10', sets: restored }], topWeight);
  assert.deepEqual(series.map((s) => s.side), ['left', 'right', null]);
});

test('an unrecognised side reads as both rather than failing the import', () => {
  const client = clientWith([
    { weightLb: 40, side: 'Both' },
    { weightLb: 40, side: 'L' },
    { weightLb: 40, side: null },
    { weightLb: 40, side: 7 },
    { weightLb: 40, side: ' LEFT ' },
  ]);
  S.normaliseClient(client);
  const sets = savedSets(client);
  assert.deepEqual(sets.map((s) => 'side' in s), [false, false, false, false, true]);
  assert.equal(sets[4].side, 'left', 'a spelling it does recognise is kept, lowercased');
  // Nothing was lost but the field itself.
  sets.forEach((s) => assert.equal(s.weightLb, 40));
});

test('a file written before per-limb logging restores exactly as it did', () => {
  const before = clientWith([{ weightLb: 185, reps: 5, warmup: false }]);
  const copy = JSON.parse(JSON.stringify(before));
  S.normaliseClient(copy);
  assert.deepEqual(copy, before, 'no side field appears, and nothing is rewritten');
  // A client with no days at all, and a day with no training, are both fine.
  assert.doesNotThrow(() => S.normaliseClient({ id: 'x' }));
  assert.doesNotThrow(() => S.normaliseClient({ id: 'x', days: { '2026-09-10': {} } }));
  assert.doesNotThrow(() => S.normaliseClient(null));
});

/* ---------------- interop ---------------- */
//
// Written by LIFT web's own encoder -- `buildLink`, calling `LiftSides
// .encodeSet` -- and not by anything in this repo, which is the only reason it
// proves anything. It is the same argument `PlanLinkInteropTests` makes on the
// iOS side: a fixture regenerated from the code under test agrees only with
// itself. Do not regenerate it from Coach.
//
// It carries an eight-week log with a per-side lift (a Bulgarian split squat
// whose left is behind and catching up), a two-sided one (a back squat), a
// left-side warmup, and a single-arm press with too few sessions to say
// anything about.

import { inflateRawSync } from 'node:zlib';

const interopLink = readFileSync('coach/fixtures/per-side-share-link.txt', 'utf8').trim();
const interopPayload = JSON.parse(
  inflateRawSync(Buffer.from(interopLink.split('#1z')[1], 'base64url')));
const interopDays = interopPayload.d.map((raw) =>
  expandDay(raw, interopPayload.x, interopPayload.fd || [], MEALS));
const liftNamed = (day, name) => (day.exercises || []).find((ex) => ex.name === name);

test('LIFT web writes side bits this app reads, warmup bit and all', () => {
  // The encoder emits exactly these: 2 left, 3 a left warmup, 4 right, and a
  // trimmed tuple for a two-sided set. A build comparing `flags === 1` would
  // call that 3 a working set.
  const flags = new Set();
  interopPayload.d.forEach((raw) => (raw.w || []).forEach(([, sets]) =>
    sets.forEach((s) => flags.add(s[5]))));
  assert.deepEqual([...flags].sort(), [2, 3, 4, undefined]);

  const day = interopDays[interopDays.length - 1];
  const split = liftNamed(day, 'Bulgarian Split Squat');
  assert.deepEqual(S.countsIn(split.sets), { left: 4, right: 3, both: 0 });
  assert.equal(split.sets[0].warmup, true);
  assert.equal(split.sets[0].side, 'left', 'flags 3 is a left-side warmup');
  assert.equal(split.sets[1].warmup, false);
  assert.equal(split.sets[1].side, 'left');
  assert.equal(split.sets[2].side, 'right');

  const squat = liftNamed(day, 'Back Squat');
  assert.equal(S.anySided(squat.sets), false, 'a two-sided lift stays two-sided');
  squat.sets.forEach((s) => assert.equal('side' in s, false));
});

test('the sides of a real log chart apart, and the gap is closing', () => {
  const days = interopDays
    .map((day, i) => ({ key: String(i).padStart(3, '0'), ex: liftNamed(day, 'Bulgarian Split Squat') }))
    .filter((d) => d.ex)
    .map((d) => ({ key: d.key, sets: d.ex.sets }));

  // Epley on the best working set, which is how the chart reads a session.
  const e1rm = (sets) => {
    const vals = sets.filter((s) => !s.warmup && s.weightLb && s.reps)
      .map((s) => s.weightLb * (1 + s.reps / 30));
    return { e1rm: vals.length ? Math.max(...vals) : null };
  };
  const series = S.splitSessions('Bulgarian Split Squat', 'Dumbbell', days, e1rm);
  assert.deepEqual(series.map((s) => s.side), ['left', 'right']);
  assert.equal(series[0].points.length, days.length);
  assert.equal(series[1].points.length, days.length);

  const gap = S.imbalance(series[0].points.map((p) => p.e1rm), series[1].points.map((p) => p.e1rm));
  assert.equal(gap.enough, true);
  assert.equal(gap.strong, 'right');
  assert.equal(gap.trend, 'closing');
  assert.equal(S.imbalanceLines(gap).detail,
    'Mean estimated 1RM of the last 3 sessions each · gap closing');

  // Volume is every set on both sides, which a build that ignored the bits
  // entirely would also have got right -- that is the degradation the format
  // is built around.
  const volume = days.flatMap((d) => d.sets)
    .reduce((t, s) => t + (s.warmup ? 0 : s.weightLb * s.reps), 0);
  assert.equal(volume, days.reduce((t, d) =>
    t + S.onSide(d.sets, 'left').concat(S.onSide(d.sets, 'right'))
      .reduce((u, s) => u + (s.warmup ? 0 : s.weightLb * s.reps), 0), 0));
  assert.ok(volume > 0);
});

test('a lift with two sessions a side gets a figure only when it has three', () => {
  const press = interopDays.map((d) => liftNamed(d, 'Single-Arm Overhead Press')).filter(Boolean);
  assert.equal(press.length, 2, 'two sessions, one set a side');
  const gap = S.imbalance(press.map(() => 40), press.map(() => 35));
  assert.equal(gap.enough, false);
  assert.deepEqual(gap.sessions, { left: 2, right: 2 });
  assert.equal(S.imbalanceLines(gap).headline, '—');
});
