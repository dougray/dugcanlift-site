import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';

// Loaded the way the browser loads it, like backup.test.mjs does.
const shim = { window: {} };
new Function('window', readFileSync('lift/sides.js', 'utf8')).call(shim, shim.window);
const S = shim.window.LiftSides;

// MARK: - Absent means both

test('a set with no side is both, and so is anything that is not left or right', () => {
  assert.equal(S.of({ weightLb: 185, reps: 5 }), null);
  assert.equal(S.of({ side: undefined }), null);
  assert.equal(S.of({ side: '' }), null);
  assert.equal(S.of({ side: 'both' }), null);
  assert.equal(S.of({ side: 'L' }), null);
  assert.equal(S.of({ side: 17 }), null);
  assert.equal(S.of(null), null);
});

test('left and right are read whatever case or padding they arrive in', () => {
  assert.equal(S.of({ side: 'left' }), 'left');
  assert.equal(S.of({ side: 'RIGHT' }), 'right');
  assert.equal(S.of({ side: ' Left ' }), 'left');
});

test('a set is never marked both; that is what leaving it off means', () => {
  const tuple = S.encodeSet({ weightLb: 185, reps: 5 });
  assert.deepEqual(tuple, [185, 5]);
  assert.equal('side' in S.decodeSet(tuple), false);
});

// MARK: - The per-exercise guess

test('names that read unilateral are pre-ticked', () => {
  ['Bulgarian Split Squat', 'Single-Arm Dumbbell Row', 'One Arm Overhead Press',
    'Walking Lunge', 'Reverse Lunges', 'Pistol Squat', 'Step-Up', 'Step Ups',
    'Single Leg Deadlift', 'Unilateral Leg Press'].forEach((name) => {
    assert.equal(S.looksUnilateral(name), true, name);
  });
});

test('punctuation and case are not part of the name', () => {
  // The same normalisation LIFT for Android runs: anything that is not a
  // letter or a digit is a space, so one term covers every spelling of it.
  ['SINGLE_ARM ROW', 'single-arm row', 'Single Arm Row', '1 Arm Row',
    '1-Arm Dumbbell Row', '1 Leg Romanian Deadlift'].forEach((name) => {
    assert.equal(S.looksUnilateral(name), true, name);
  });
});

test('ordinary two-sided lifts are not', () => {
  ['Barbell Bench Press', 'Back Squat', 'Deadlift', 'Lat Pulldown', 'Plank',
    'Leg Press', 'Arm Curl', 'Armed Forces Press']
    .forEach((name) => assert.equal(S.looksUnilateral(name), false, name));
});

test('the -ed spellings count too, as in One-Legged Deadlift', () => {
  for (const name of ['Kettlebell One-Legged Deadlift', 'One-Legged Cable Kickback',
                      'Single-Legged Press', 'One-Armed Row']) {
    assert.equal(S.looksUnilateral(name), true, name);
  }
});

test('a term inside a longer word is not that term', () => {
  // Why the terms are matched as whole words and both numbers of each are
  // listed, rather than looked for anywhere in the name: a substring rule
  // ticks a cold plunge for "lunge" and a stepmill for "step up".
  ['Cold Plunge', 'Stepmill', 'Plunger Press', 'Bulgarianesque']
    .forEach((name) => assert.equal(S.looksUnilateral(name), false, name));
});

// MARK: - Logging

test('the next side is the one with fewer sets, so it alternates', () => {
  assert.equal(S.nextSide([]), 'left');
  assert.equal(S.nextSide([{ side: 'left' }]), 'right');
  assert.equal(S.nextSide([{ side: 'left' }, { side: 'right' }]), 'left');
  assert.equal(S.nextSide([{ side: 'right' }, { side: 'right' }, { side: 'left' }]), 'left');
});

test('unmarked sets do not tip the next side either way', () => {
  assert.equal(S.nextSide([{}, {}, {}]), 'left');
  assert.equal(S.nextSide([{}, { side: 'left' }]), 'right');
});

test('the header counts each side, and says so when older sets have none', () => {
  assert.equal(S.countsLabel([{ side: 'left' }, { side: 'right' }, { side: 'left' }]),
    'L 2 · R 1');
  assert.equal(S.countsLabel([{ side: 'left' }, {}, {}]), 'L 1 · R 0 · 2 both');
  // Nothing sided: an exercise logged the way it always was says nothing new.
  assert.equal(S.countsLabel([{}, {}]), '');
  assert.equal(S.countsLabel([]), '');
});

// MARK: - Grouping

test('left and right are different lifts; name and equipment still matter', () => {
  const left = S.key('Dumbbell Row', 'Dumbbell', 'left');
  const right = S.key('Dumbbell Row', 'Dumbbell', 'right');
  assert.notEqual(left, right);
  assert.notEqual(left, S.key('Dumbbell Row', 'Cable', 'left'));
  assert.notEqual(left, S.key('Dumbbell Row', 'Dumbbell', null));
});

test('a two-sided lift keeps one key however the side is spelled absent', () => {
  const both = S.key('Bench Press', 'Barbell', null);
  assert.equal(S.key('Bench Press', 'Barbell', undefined), both);
  assert.equal(S.key('Bench Press', 'Barbell', 'both'), both);
  assert.equal(S.key(' Bench Press ', 'Barbell', ''), both);
});

test('sets split by side, and the unmarked ones are their own group', () => {
  const sets = [{ id: 1, side: 'left' }, { id: 2, side: 'right' }, { id: 3 }];
  assert.deepEqual(S.onSide(sets, 'left').map((s) => s.id), [1]);
  assert.deepEqual(S.onSide(sets, 'right').map((s) => s.id), [2]);
  assert.deepEqual(S.onSide(sets, null).map((s) => s.id), [3]);
});

// MARK: - The share link's flags

test('side rides in bits 1-2, warmup keeps bit 0', () => {
  assert.equal(S.flagsOf({}), 0);
  assert.equal(S.flagsOf({ side: 'left' }), 2);
  assert.equal(S.flagsOf({ side: 'right' }), 4);
  assert.equal(S.flagsOf({ warmup: true }), 1);
  assert.equal(S.flagsOf({ warmup: true, side: 'left' }), 3);
  assert.equal(S.flagsOf({ warmup: true, side: 'right' }), 5);
});

test('both, left and right survive a round trip through the tuple', () => {
  [null, 'left', 'right'].forEach((side) => {
    const set = { weightLb: 135, reps: 8, rpe: 7.5 };
    if (side) set.side = side;
    const back = S.decodeSet(S.encodeSet(set));
    assert.equal(S.of(back), side, String(side));
    assert.equal(back.weightLb, 135);
    assert.equal(back.reps, 8);
    assert.equal(back.rpe, 7.5);
    assert.equal(back.warmup, false);
  });
});

test('a warmup on one side keeps both facts', () => {
  const back = S.decodeSet(S.encodeSet({ weightLb: 45, reps: 10, warmup: true, side: 'right' }));
  assert.equal(back.warmup, true);
  assert.equal(back.side, 'right');
});

test('a link written before sides existed decodes as both', () => {
  // [185, 5, 8] is what every LIFT client has sent since the format shipped.
  const back = S.decodeSet([185, 5, 8]);
  assert.equal(S.of(back), null);
  assert.equal(back.weightLb, 185);
  assert.equal(back.reps, 5);
  // And a flags field of 0 is still both, not left.
  assert.equal(S.of(S.decodeSet([185, 5, 8, null, null, 0])), null);
});

test('a bit pattern nobody defined reads as an ordinary set, not an invented side', () => {
  assert.equal(S.sideFromFlags(6), null);      // bits 1-2 both set
  assert.equal(S.sideFromFlags(undefined), null);
  // Bits above ours are somebody else's and are not our business.
  assert.equal(S.sideFromFlags(8 | 2), 'left');
});

test('a reader that ignores flags still gets the weight, the reps and the volume', () => {
  // Exactly the decoder Coach web shipped before sides: it reads five fields
  // and one warmup bit, and never looks at bits 1-2.
  const oldReader = (t) => ({
    weightLb: t[0] ?? null, reps: t[1] ?? null, rpe: t[2] ?? null,
    durationSec: t[3] ?? null, distanceM: t[4] ?? null, warmup: !!((t[5] || 0) & 1),
  });
  const sets = [
    { weightLb: 100, reps: 8, side: 'left' },
    { weightLb: 100, reps: 8, side: 'right' },
    { weightLb: 95, reps: 10 },
  ];
  const read = sets.map((s) => oldReader(S.encodeSet(s)));
  assert.deepEqual(read.map((s) => s.reps), [8, 8, 10]);
  assert.equal(read.reduce((t, s) => t + s.weightLb * s.reps, 0), 2550);
  assert.deepEqual(read.map((s) => s.warmup), [false, false, false]);
});

test('a trimmed tuple is no longer than it was before sides', () => {
  assert.deepEqual(S.encodeSet({ weightLb: 185, reps: 5, rpe: 8 }), [185, 5, 8]);
  // A sided set has to carry flags, so the nulls between come back — that is
  // what the positions are for.
  assert.deepEqual(S.encodeSet({ weightLb: 185, reps: 5, side: 'right' }),
    [185, 5, null, null, null, 4]);
});

// MARK: - The backup's named field

test('the backup field is a name, omitted when both', () => {
  // The browser build stores a set in the backup's own shape, so this is the
  // storage rule and the file rule at once.
  const stored = { id: 'a', weightLb: 135, reps: 8, side: 'left' };
  const file = JSON.parse(JSON.stringify(stored));
  assert.equal(file.side, 'left');
  assert.equal(S.of(file), 'left');

  const plain = { id: 'b', weightLb: 135, reps: 8 };
  assert.equal('side' in JSON.parse(JSON.stringify(plain)), false);
});

test('a backup written without the field restores as both', () => {
  const fromOldFile = { id: 'c', weightLb: 225, reps: 3 };
  assert.equal(S.of(fromOldFile), null);
  assert.equal(S.label(fromOldFile), '');
});

// MARK: - Imbalance

const sessions = (...values) => values;

test('two sessions a side is not a finding', () => {
  const out = S.imbalance(sessions(100, 102), sessions(120, 118));
  assert.equal(out.enough, false);
  assert.deepEqual(out.sessions, { left: 2, right: 2 });
  assert.equal(out.percent, undefined);
});

test('a gap on one side only is still not enough', () => {
  const out = S.imbalance(sessions(100, 102, 104, 106), sessions(120, null, null));
  assert.equal(out.enough, false);
  assert.deepEqual(out.sessions, { left: 4, right: 1 });
});

test('sessions where the side was not trained do not count towards the three', () => {
  const out = S.imbalance(sessions(100, null, 102, null, 104), sessions(100, null, 102, null, 104));
  assert.equal(out.enough, true);
  assert.deepEqual(out.sessions, { left: 3, right: 3 });
});

test('perfectly balanced is zero, with no strong side and no trend to report', () => {
  const out = S.imbalance(sessions(100, 105, 110), sessions(100, 105, 110));
  assert.equal(out.enough, true);
  assert.equal(out.percent, 0);
  assert.equal(out.strong, null);
  assert.equal(out.weak, null);
  // Three sessions each: the first three and the last three are the same
  // sessions, so there is nothing to compare and we say nothing.
  assert.equal(out.trend, null);
});

test('a real gap reads as (strong - weak) / strong on the last three sessions', () => {
  const out = S.imbalance(sessions(100, 100, 100), sessions(120, 120, 120));
  assert.equal(out.enough, true);
  assert.equal(Math.round(out.percent * 1000) / 1000, 0.167);
  assert.equal(out.strong, 'right');
  assert.equal(out.weak, 'left');
});

test('the weaker side catching up reads as closing', () => {
  //            first three: 80 vs 100 = 20%      last three: 96 vs 100 = 4%
  const out = S.imbalance(sessions(80, 80, 80, 96, 96, 96), sessions(100, 100, 100, 100, 100, 100));
  assert.equal(out.trend, 'closing');
  assert.equal(Math.round(out.was * 100), 20);
  assert.equal(Math.round(out.percent * 100), 4);
});

test('the weaker side falling behind reads as widening', () => {
  const out = S.imbalance(sessions(96, 96, 96, 80, 80, 80), sessions(100, 100, 100, 100, 100, 100));
  assert.equal(out.trend, 'widening');
});

test('a gap that has not moved reads as steady, and half a point is not movement', () => {
  const flat = S.imbalance(sessions(90, 90, 90, 90), sessions(100, 100, 100, 100));
  assert.equal(flat.trend, 'steady');
  const noise = S.imbalance(sessions(90, 90, 90, 90.2), sessions(100, 100, 100, 100));
  assert.equal(noise.trend, 'steady');
});

test('the side that is stronger can swap without the figure going negative', () => {
  const out = S.imbalance(sessions(120, 120, 120), sessions(100, 100, 100));
  assert.equal(out.strong, 'left');
  assert.ok(out.percent > 0);
});

test('bodyweight work with no estimated 1RM never reaches a percentage', () => {
  const out = S.imbalance(sessions(null, null, null), sessions(null, null, null));
  assert.equal(out.enough, false);
});

test('estimated 1RM is Epley on the best set of that side', () => {
  const sets = [
    { weightLb: 100, reps: 10, side: 'left' },
    { weightLb: 120, reps: 3, side: 'left' },
    { weightLb: 200, reps: 5, side: 'right' },
  ];
  assert.equal(Math.round(S.e1rm(S.onSide(sets, 'left'))), 133);   // 100 x 10 = 133.3
  assert.equal(Math.round(S.e1rm(S.onSide(sets, 'right'))), 233);
  assert.equal(S.e1rm([{ durationSec: 60, side: 'left' }]), null);
  assert.equal(S.e1rm([]), null);
});
