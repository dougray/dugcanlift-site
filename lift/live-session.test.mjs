import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';

// A port of LIFT iOS's RestTimerTests, SessionRestTests (SetTypesTests.swift),
// LiveSessionScreen's rule and WatchPlanSettings' rest, case for case, then
// this build's own: a workout read as the rule reads it, and the ticks kept
// beside the log rather than on a set.
const shim = { window: {} };
for (const file of ['lift/set-types.js', 'lift/live-session.js']) {
  new Function('window', readFileSync(file, 'utf8')).call(shim, shim.window);
}
const L = shim.window.LiftLiveSession;

function memoryStorage() {
  const m = new Map();
  return {
    map: m,
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
  };
}

const now = 1800000000 * 1000;
const at = (seconds) => now + seconds * 1000;

/* ---------------- the countdown ---------------- */

test('a countdown counts down', () => {
  const rest = L.countdown(90, null, 'Bench Press', now);
  assert.equal(L.remaining(rest, now), 90);
  assert.equal(L.remaining(rest, at(30)), 60);
  assert.equal(L.isOver(rest, at(89)), false);
  assert.equal(L.isOver(rest, at(90)), true);
  assert.equal(L.remaining(rest, at(200)), 0);
});

test('fifteen seconds more or less', () => {
  const rest = L.countdown(90, null, null, now);
  const later = at(30);
  assert.equal(L.remaining(L.adjusted(rest, 15, later), later), 75);
  assert.equal(L.remaining(L.adjusted(rest, -15, later), later), 45);
  // The start stays where it was.
  assert.equal(L.adjusted(rest, 15, later).startedAt, now);
});

test('taking time off cannot go below nothing', () => {
  const rest = L.countdown(30, null, null, now);
  const later = at(20);
  const shorter = L.adjusted(rest, -15, later);
  assert.equal(L.remaining(shorter, later), 0);
  assert.equal(L.isOver(shorter, later), true);
});

test('a rest is never longer than fifteen minutes', () => {
  let rest = L.countdown(300, null, null, now);
  for (let i = 0; i < 100; i++) rest = L.adjusted(rest, 15, now);
  assert.equal(L.remaining(rest, now), L.LONGEST_REST_SECONDS);
  assert.equal(L.remaining(L.countdown(5000, null, null, now), now), 15 * 60);
});

test('adding to an over rest starts from now', () => {
  const rest = L.countdown(60, null, null, now);
  const late = at(100);
  assert.equal(L.remaining(L.adjusted(rest, 15, late), late), 15);
});

test('the clock', () => {
  assert.equal(L.clock(95), '1:35');
  assert.equal(L.clock(9), '0:09');
  assert.equal(L.clock(0), '0:00');
  // Rounded up, so it never shows 0:00 while there is still time left.
  assert.equal(L.clock(0.2), '0:01');
  assert.equal(L.clock(300), '5:00');
});

/* ---------------- the timer ---------------- */

const timer = () => new L.RestTimer(memoryStorage());

test('ticking a set starts the rest from settings', () => {
  const t = timer();
  t.setDone('set-1', 'Squat', 120, now);
  assert.equal(t.current.setId, 'set-1');
  assert.equal(L.remaining(t.current, now), 120);
});

test('no rest time means no rest', () => {
  const t = timer();
  t.setDone('set-1', null, null, now);
  assert.equal(t.current, null);
  t.setDone('set-1', null, 0, now);
  assert.equal(t.current, null);
});

// A second set ticked mid-rest starts a fresh rest; the old one is not left
// counting behind it.
test('the next set restarts the rest', () => {
  const t = timer();
  t.setDone('a', 'Squat', 90, now);
  t.setDone('b', 'Squat', 90, at(40));
  assert.equal(t.current.setId, 'b');
  assert.equal(L.remaining(t.current, at(40)), 90);
});

test('unticking the set cancels its rest', () => {
  const t = timer();
  t.setDone('a', null, 90, now);
  t.setUndone('other');
  assert.notEqual(t.current, null);
  t.setUndone('a');
  assert.equal(t.current, null);
});

test('adjust and skip', () => {
  const t = timer();
  t.setDone('a', null, 90, now);
  t.adjust(15, now);
  assert.equal(L.remaining(t.current, now), 105);
  t.skip();
  assert.equal(t.current, null);
  // Nothing to adjust or skip does nothing.
  t.adjust(15, now);
  t.skip();
  assert.equal(t.current, null);
});

// A reload, or a tab the browser discarded. Coming back, a rest still running
// is still on screen; one that ended a while ago is not.
test('a rest survives a reload until it is long over', () => {
  const storage = memoryStorage();
  new L.RestTimer(storage).setDone('a', 'Row', 90, now);

  const reloaded = new L.RestTimer(storage);
  reloaded.restore(at(30));
  assert.equal(reloaded.current.exerciseName, 'Row');
  assert.equal(L.remaining(reloaded.current, at(30)), 60, 'the time is worked out from the end, not from ticks');

  const muchLater = new L.RestTimer(storage);
  muchLater.restore(at(90 + L.KEEPS_OVER_FOR + 1));
  assert.equal(muchLater.current, null);
  assert.equal(storage.getItem(L.REST_STORE_KEY), null);
});

test('an unreadable stored rest is no rest', () => {
  const storage = memoryStorage();
  storage.setItem(L.REST_STORE_KEY, 'nonsense');
  assert.equal(new L.RestTimer(storage).current, null);
  storage.setItem(L.REST_STORE_KEY, JSON.stringify({ startedAt: 'x', endsAt: 1 }));
  assert.equal(new L.RestTimer(storage).current, null);
});

test('ending the session ends the rest', () => {
  const t = timer();
  t.setDone('a', null, 60, now);
  t.sessionEnded();
  assert.equal(t.current, null);
});

/* ---------------- set types (the timer) ---------------- */

// Inside a superset round, a tick starts no rest and ends the one still
// running: the next set has begun. The banner says what it is instead.
test('a tick with no rest ends the running rest and says what is next', () => {
  const t = timer();
  t.setDone('x', 'Bench', 90, now);
  t.apply('a1', { type: 'noRest', cue: 'Next: Seated Cable Rows' }, 'Bench', now);
  assert.equal(t.current, null);
  assert.deepEqual(t.cue, { setId: 'a1', text: 'Next: Seated Cable Rows' });

  // The round's last tick starts the full rest, and the cue goes.
  t.apply('b1', { type: 'rest', seconds: 90, before: 'Bench (dumbbell)' }, 'Rows', now);
  assert.equal(t.cue, null);
  assert.equal(t.current.exerciseName, 'Bench (dumbbell)');
});

test('unticking the set takes its cue back, and Done dismisses one', () => {
  const t = timer();
  t.setDoneNoRest('a', 'Drop set next');
  t.setUndone('other');
  assert.notEqual(t.cue, null);
  t.setUndone('a');
  assert.equal(t.cue, null);
  t.setDoneNoRest('a', 'Drop set next');
  t.skip();
  assert.equal(t.cue, null);
  assert.equal(t.current, null, 'a cue is not a rest');
});

test('rest-pause is a fifteen second rest', () => {
  const t = timer();
  t.apply('a', { type: 'rest', seconds: L.REST_PAUSE_SECONDS, before: null }, 'Barbell Curl', now);
  assert.equal(L.remaining(t.current, now), 15);
  assert.equal(t.current.exerciseName, 'Barbell Curl');
  t.skip();
  t.apply('b', { type: 'nothing' }, 'Barbell Curl', now);
  assert.equal(t.current, null, 'rest turned off starts nothing, as before');
});

test('ending the session takes the cue too', () => {
  const t = timer();
  t.setDoneNoRest('a', 'Next: Rows');
  t.sessionEnded();
  assert.equal(t.cue, null);
});

/* ---------------- the rest follows the round (SessionRestTests) ---------------- */

let seq = 0;
const S = (o = {}) => ({ id: o.id || `s${++seq}`, done: !!o.done, kind: o.kind || null });
const exercise = (name, group, sets) => ({ name, restName: `${name} (Gear)`, group, sets });

test('an ungrouped day rests as it always did', () => {
  const first = S(), second = S();
  const day = [exercise('Squat', null, [first, second])];
  assert.deepEqual(L.after(first.id, day, 120), { type: 'rest', seconds: 120, before: 'Squat (Gear)' });
  assert.deepEqual(L.after(second.id, day, 120), { type: 'rest', seconds: 120, before: 'Squat (Gear)' },
    'the last set rests too');
});

test('rest turned off starts and says nothing', () => {
  const a = S(), b = S();
  const day = [exercise('Bench', 1, [a]), exercise('Rows', 1, [b])];
  assert.deepEqual(L.after(a.id, day, null), { type: 'nothing' });
  assert.deepEqual(L.after(a.id, day, 0), { type: 'nothing' });
});

test('inside a superset round there is no rest until its last set', () => {
  const a1 = S(), a2 = S(), b1 = S(), b2 = S();
  const day = [exercise('Bench', 1, [a1, a2]), exercise('Seated Cable Rows', 1, [b1, b2])];
  assert.deepEqual(L.after(a1.id, day, 90), { type: 'noRest', cue: 'Next: Seated Cable Rows' });
  const done = structuredClone(day);
  done[0].sets[0].done = true;
  assert.deepEqual(L.after(b1.id, done, 90), { type: 'rest', seconds: 90, before: 'Bench (Gear)' },
    "the round's last starts the full rest");
});

test('a round is not over while an earlier set of it is unticked', () => {
  const a1 = S(), b1 = S(), a2 = S(), b2 = S();
  const day = [exercise('Bench', 1, [a1, a2]), exercise('Rows', 1, [b1, b2])];
  assert.deepEqual(L.after(b1.id, day, 90), { type: 'noRest', cue: 'Next: Bench' },
    'ticked out of order, Bench is still to do');
});

test('a circuit skips a member that has run out', () => {
  const swing = [S(), S(), S()], push = [S(), S(), S()], plank = [S(), S()];
  const day = [exercise('Kettlebell Swing', 2, swing), exercise('Push-Up', 2, push), exercise('Plank', 2, plank)];
  const steps = L.order(day).map((s) => `${s.exercise}${s.set}`);
  assert.deepEqual(steps, ['00', '10', '20', '01', '11', '21', '02', '12']);
  // Round three: Swing, then Push-Up, which is the round's last.
  for (let i = 0; i < 3; i++) { day[i].sets[0].done = true; day[i].sets[1].done = true; }
  day[0].sets[2].done = true;
  assert.deepEqual(L.after(push[2].id, day, 60), { type: 'rest', seconds: 60, before: 'Push-Up (Gear)' });
  day[1].sets[2].done = false;
  assert.deepEqual(L.after(swing[2].id, day, 60), { type: 'noRest', cue: 'Next: Push-Up' });
});

test('a drop set next means no rest', () => {
  const s = [0, 1, 2, 3].map((i) => S({ kind: i >= 2 ? 'drop' : null }));
  const day = [exercise('Triceps Pushdown', null, s)];
  assert.deepEqual(L.after(s[0].id, day, 90), { type: 'rest', seconds: 90, before: 'Triceps Pushdown (Gear)' });
  assert.deepEqual(L.after(s[1].id, day, 90), { type: 'noRest', cue: 'Drop set next' });
  assert.deepEqual(L.after(s[2].id, day, 90), { type: 'noRest', cue: 'Drop set next' }, 'a drop after a drop');
  assert.deepEqual(L.after(s[3].id, day, 90), { type: 'rest', seconds: 90, before: 'Triceps Pushdown (Gear)' });
});

test('rest-pause next is fifteen seconds', () => {
  const first = S(), pause = S({ kind: 'restPause' });
  const day = [exercise('Barbell Curl', null, [first, pause])];
  assert.deepEqual(L.after(first.id, day, 120), { type: 'rest', seconds: 15, before: 'Barbell Curl (Gear)' });
});

test('the next set to do skips ones already ticked', () => {
  const a = S(), b = S({ done: true }), c = S({ kind: 'drop' });
  const day = [exercise('Pushdown', null, [a, b, c])];
  assert.deepEqual(L.after(a.id, day, 90), { type: 'noRest', cue: 'Drop set next' });
});

// iOS reads its logged day with the first set always straight. Here the day is
// a workout as Train stores it, and the ticks are kept beside it.
test('the logged workout is read with the first set always straight', () => {
  const session = {
    id: 'w1',
    exercises: [{ id: 'e1', name: 'Curl', equipment: 'barbell', group: 3,
                  sets: [{ id: 'first', weightLb: 60, reps: 10, kind: 'drop' },
                         { id: 'second', weightLb: 60, reps: 8, kind: 'restPause' }] }],
  };
  assert.deepEqual(L.exercisesOf(session, ['second']), [{
    name: 'Curl', restName: 'Curl (barbell)', group: 3,
    sets: [{ id: 'first', done: false, kind: null }, { id: 'second', done: true, kind: 'restPause' }],
  }]);
  assert.equal(L.exercisesOf(session, new Set(['first']))[0].sets[0].done, true);
  assert.equal(L.restName({ name: 'Plank', equipment: '' }), 'Plank');
});

// A lone group number is no group: adjacency makes it, as everywhere else.
test('a group of one rests like an ordinary exercise', () => {
  const a = S(), b = S();
  const day = [exercise('Bench', 1, [a]), exercise('Rows', 2, [b])];
  assert.deepEqual(L.after(a.id, day, 90), { type: 'rest', seconds: 90, before: 'Bench (Gear)' });
});

/* ---------------- rest between sets (WatchPlanSettings) ---------------- */

test('never set is the default; a stored zero is no rest', () => {
  const storage = memoryStorage();
  assert.equal(L.restSeconds(storage), 90);
  storage.setItem(L.REST_KEY, '150');
  assert.equal(L.restSeconds(storage), 150);
  storage.setItem(L.REST_KEY, '0');
  assert.equal(L.restSeconds(storage), null);
  storage.setItem(L.REST_KEY, '-15');
  assert.equal(L.restSeconds(storage), null);
  // Junk is read as never set, not as zero.
  storage.setItem(L.REST_KEY, 'soon');
  assert.equal(L.restSeconds(storage), 90);
  assert.equal(L.restSeconds({ getItem: () => { throw new Error('blocked'); } }), 90);
});

test('the setting holds to 30 to 300 seconds in steps of 15', () => {
  const storage = memoryStorage();
  assert.equal(L.setRestSeconds(105, storage), 105);
  assert.equal(L.restSeconds(storage), 105);
  assert.equal(L.setRestSeconds(15, storage), 30);
  assert.equal(L.setRestSeconds(900, storage), 300);
  assert.equal(L.setRestSeconds(100, storage), 105);
});

/* ---------------- the screen (LiveSessionScreen) ---------------- */

test('a live session holds the screen, and stops after eight hours', () => {
  const start = now;
  assert.equal(L.holdsScreenOn([start], true, at(60)), true);
  assert.equal(L.holdsScreenOn([start], false, at(60)), false, 'switched off in settings');
  assert.equal(L.holdsScreenOn([], true, at(60)), false);
  assert.equal(L.holdsScreenOn([start], true, start + L.LONGEST_HOLD_MS - 1), true);
  assert.equal(L.holdsScreenOn([start], true, start + L.LONGEST_HOLD_MS), false);
  assert.equal(L.holdsScreenOn([start], true, start - 1000), false, 'a start in the future is a clock change');
});

test('the next cutoff is the earliest session still holding', () => {
  const a = now, b = now + 3600 * 1000;
  assert.equal(L.nextCutoff([a, b], at(60)), a + L.LONGEST_HOLD_MS);
  assert.equal(L.nextCutoff([a, b], a + L.LONGEST_HOLD_MS), b + L.LONGEST_HOLD_MS);
  assert.equal(L.nextCutoff([a], a + L.LONGEST_HOLD_MS + 1), null);
  assert.equal(L.nextCutoff([], now), null);
});

test('keep the screen on is on by default, and off is a stored false', () => {
  const storage = memoryStorage();
  assert.equal(L.screenEnabled(storage), true);
  L.setScreenEnabled(false, storage);
  assert.equal(storage.getItem(L.SCREEN_KEY), 'false');
  assert.equal(L.screenEnabled(storage), false);
  L.setScreenEnabled(true, storage);
  assert.equal(storage.getItem(L.SCREEN_KEY), null);
});

/* ---------------- which workout is live ---------------- */

test('ticks are kept beside the log and go with the session', () => {
  const storage = memoryStorage();
  let live = L.start('w1', now);
  assert.equal(L.isDone(live, 'a'), false);
  live = L.withTick(live, 'a', true);
  live = L.withTick(live, 'a', true);
  assert.deepEqual(live.done, ['a'], 'a tick is once');
  L.writeLive(live, storage);
  assert.deepEqual(L.readLive(storage), { sessionId: 'w1', startedAt: now, done: ['a'] });
  live = L.withTick(live, 'a', false);
  assert.equal(L.isDone(live, 'a'), false);
  L.writeLive(null, storage);
  assert.equal(L.readLive(storage), null);
  assert.equal(L.isDone(null, 'a'), false);
});

test('an unreadable live session is none', () => {
  const storage = memoryStorage();
  storage.setItem(L.LIVE_KEY, '{');
  assert.equal(L.readLive(storage), null);
  storage.setItem(L.LIVE_KEY, JSON.stringify({ sessionId: 7, startedAt: now }));
  assert.equal(L.readLive(storage), null);
  storage.setItem(L.LIVE_KEY, JSON.stringify({ sessionId: 'w', startedAt: now, done: [1, 'b'] }));
  assert.deepEqual(L.readLive(storage).done, ['b']);
});
